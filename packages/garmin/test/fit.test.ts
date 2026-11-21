import { describe, expect, it } from 'vitest';
import { Profile } from '@garmin/fitsdk';
import { zipSync } from 'fflate';
import { ActivityStreams, Lap, StrengthSet } from '@cadence/core/domain';
import { extractFitFromDownload, isFitBytes, mapFitSport, parseFit } from '../src';
import { fakeDetail, fakeEncodeFit, looseEncoder, makeAthlete } from './helpers/fake-athlete';

const athlete = makeAthlete();
const fitOf = (id: number) => fakeEncodeFit(fakeDetail(athlete, id));

describe('@garmin/fitsdk', () => {
  it('imports as ESM with the expected API', async () => {
    const mod = await import('@garmin/fitsdk');
    expect(typeof mod.Decoder).toBe('function');
    expect(typeof mod.Encoder).toBe('function');
    expect(mod.Profile.MesgNum.RECORD).toBe(20);
  });
});

describe('parseFit round trip (Encoder → parseFit)', () => {
  it('run: summary, offset, streams (semicircles → degrees, enhanced speed), per-leg cadence doubled, laps', () => {
    const r = parseFit(fitOf(21_000_000_001));
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
    expect(r).toMatchObject({ fitSport: 'running', sport: 'run', subSport: 'road_run', startedAt: '2026-11-12T06:30:00Z', utcOffsetMin: 60, localDate: '2026-11-12', sessionCount: 1 });
    expect(r.summary).toMatchObject({ durationSec: 2700, movingSec: 2670, distanceM: 8100, avgHr: 138, maxHr: 152, avgCadence: 172, calories: 560, elevationGainM: 40 });
    const s = r.streams!;
    expect(ActivityStreams.safeParse(s).success).toBe(true);
    expect(s.t).toHaveLength(120);
    expect(s.t[0]).toBe(0);
    expect(s.t[119]).toBe(119);
    expect(s.lat![0]).toBeCloseTo(47.5, 5);
    expect(s.lng![10]).toBeCloseTo(11.1001, 5);
    expect(s.speed![5]).toBeCloseTo(3.0, 2);
    expect(s.cadence![0]).toBe(172);
    expect(s.altitude![2]).toBeCloseTo(101, 0);
    expect(s.power).toBeUndefined();
    expect(r.laps).toHaveLength(2);
    expect(r.laps.every((l) => Lap.safeParse(l).success)).toBe(true);
    expect(r.laps[1]).toMatchObject({ index: 1, startSec: 60, durationSec: 60, avgHr: 143 });
  });

  it('bike: power stream, device TSS/IF/FTP, work J → kJ', () => {
    const r = parseFit(fitOf(21_000_000_002));
    expect(r.sport).toBe('bike');
    expect(r.summary).toMatchObject({ avgPower: 205, weightedPower: 228, deviceTss: 80.5, deviceIf: 0.82, thresholdPower: 260, avgCadence: 88 });
    expect(r.summary.workKj).toBeCloseTo((205 * 5370) / 1000, 0);
    expect(r.streams!.power![0]).toBe(175);
  });

  it('pool swim: lengths → laps with dominant stroke and SWOLF; rest lap flagged', () => {
    const r = parseFit(fitOf(21_000_000_003));
    expect(r).toMatchObject({ sport: 'swim', subSport: 'pool' });
    expect(r.summary).toMatchObject({ poolLengthM: 25, strokes: 1400, activeLengths: 8, avgSwolf: 38 });
    expect(r.laps).toEqual([
      { index: 0, startSec: 0, durationSec: 88, movingSec: 88, distanceM: 100, lengths: 4, stroke: 'free', swolf: 38 },
      { index: 1, startSec: 88, durationSec: 20, movingSec: 0, distanceM: 0, lengths: 0, isRest: true },
      { index: 2, startSec: 108, durationSec: 88, movingSec: 88, distanceM: 100, lengths: 4, stroke: 'free', swolf: 38 },
    ]);
    expect(r.streams?.lat).toBeUndefined(); // indoor
  });

  it('strength: FIT set messages → named sets with volume', () => {
    const r = parseFit(fitOf(21_000_000_004));
    expect(r.sport).toBe('strength');
    expect(r.strengthSets).toEqual([
      { index: 0, exercise: 'Barbell Back Squat', category: 'SQUAT', reps: 8, weightKg: 80, durationSec: 40 },
      { index: 1, exercise: 'Rest', durationSec: 90, isRest: true },
      { index: 2, exercise: 'Barbell Bench Press', category: 'BENCH_PRESS', reps: 8, weightKg: 60, durationSec: 35 },
    ]);
    expect(r.strengthSets!.every((s) => StrengthSet.safeParse(s).success)).toBe(true);
    expect(r.summary).toMatchObject({ totalSets: 2, totalReps: 16, volumeKg: 1120 });
  });

  it('row erg maps to row/erg', () => {
    expect(parseFit(fitOf(21_000_000_005))).toMatchObject({ sport: 'row', subSport: 'erg' });
  });

  it('lengths without lap messages are grouped into laps', () => {
    const e = looseEncoder();
    const M = Profile.MesgNum;
    const t0 = Date.parse('2026-11-14T06:00:00Z');
    e.onMesg(M.FILE_ID!, { type: 'activity', manufacturer: 'development', product: 1, timeCreated: new Date(t0), serialNumber: 1 });
    const len = (i: number, type: string, stroke?: string) =>
      e.onMesg(M.LENGTH!, { messageIndex: i, startTime: new Date(t0 + i * 25_000), timestamp: new Date(t0 + (i + 1) * 25_000), totalElapsedTime: 25, totalTimerTime: 25, lengthType: type, ...(stroke ? { swimStroke: stroke, totalStrokes: 15 } : {}) });
    len(0, 'active', 'breaststroke');
    len(1, 'active', 'breaststroke');
    len(2, 'idle');
    len(3, 'active', 'butterfly');
    e.onMesg(M.SESSION!, { messageIndex: 0, startTime: new Date(t0), timestamp: new Date(t0 + 100_000), sport: 'swimming', subSport: 'lapSwimming', poolLength: 25, totalElapsedTime: 100, totalTimerTime: 75 });
    const r = parseFit(e.close());
    expect(r.laps.map((l) => [l.lengths, l.stroke, l.isRest ?? false, l.distanceM])).toEqual([
      [2, 'breast', false, 50],
      [0, undefined, true, undefined],
      [1, 'fly', false, 25],
    ]);
    expect(r.laps[0]!.swolf).toBe(40);
  });

  it('developer fields do not break parsing', () => {
    const M = Profile.MesgNum;
    const dev = { developerDataIndex: 0, applicationId: Array(16).fill(1), applicationVersion: 1 };
    const field = { developerDataIndex: 0, fieldDefinitionNumber: 0, fitBaseTypeId: 132, fieldName: 'Doughnuts', units: 'n' };
    const e = looseEncoder({ fieldDescriptions: { 0: { developerDataIdMesg: dev, fieldDescriptionMesg: field } } } as never);
    const t0 = new Date('2026-11-14T06:00:00Z');
    e.onMesg(M.FILE_ID!, { type: 'activity', manufacturer: 'development', product: 1, timeCreated: t0, serialNumber: 1 });
    e.onMesg(M.DEVELOPER_DATA_ID!, dev);
    e.onMesg(M.FIELD_DESCRIPTION!, field);
    e.onMesg(M.RECORD!, { timestamp: t0, heartRate: 100, developerFields: { 0: 3 } });
    e.onMesg(M.SESSION!, { messageIndex: 0, startTime: t0, timestamp: t0, sport: 'running', totalElapsedTime: 1, totalTimerTime: 1 });
    const r = parseFit(e.close());
    expect(r.ok).toBe(true);
    expect(r.streams?.hr).toEqual([100]);
  });
});

describe('never throws on odd input', () => {
  it('garbage → ok false with a warning', () => {
    const r = parseFit(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]));
    expect(r.ok).toBe(false);
    expect(r.warnings[0]).toMatch(/not a FIT/);
    expect(parseFit(new Uint8Array()).ok).toBe(false);
  });

  it('truncated file → partial result + warnings', () => {
    const full = fitOf(21_000_000_002);
    const r = parseFit(full.slice(0, Math.floor(full.length * 0.6)));
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.ok).toBe(true);
    expect(r.streams!.t.length).toBeGreaterThan(10);
    expect(r.streams!.t.length).toBeLessThan(120);
  });

  it('fuzzed bytes never throw', () => {
    const base = fitOf(21_000_000_001);
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    for (let k = 0; k < 25; k++) {
      const b = base.slice();
      for (let j = 0; j < 20; j++) b[14 + Math.floor(rnd() * (b.length - 14))] = Math.floor(rnd() * 256);
      expect(() => parseFit(b)).not.toThrow();
    }
  });
});

describe('download unwrapping', () => {
  it('extracts the .fit from a ZIP and passes bare FIT through', () => {
    const fit = fitOf(21_000_000_001);
    expect(isFitBytes(fit)).toBe(true);
    expect(extractFitFromDownload(fit)).toBe(fit);
    const zip = zipSync({ 'readme.txt': new TextEncoder().encode('hi'), '21000000001_ACTIVITY.fit': fit });
    expect(extractFitFromDownload(zip)).toEqual(fit);
    expect(extractFitFromDownload(new TextEncoder().encode('<html>'))).toBeUndefined();
  });

  it('FIT sport mapping covers indoor/virtual/subsports', () => {
    expect(mapFitSport('cycling', 'indoorCycling')).toEqual({ sport: 'bike', subSport: 'indoor' });
    expect(mapFitSport('cycling', 'virtualActivity')).toEqual({ sport: 'bike', subSport: 'virtual' });
    expect(mapFitSport('running', 'treadmill')).toEqual({ sport: 'run', subSport: 'treadmill' });
    expect(mapFitSport('swimming', 'openWater')).toEqual({ sport: 'swim', subSport: 'open_water' });
    expect(mapFitSport('training', 'yoga')).toEqual({ sport: 'yoga', subSport: 'generic' });
    expect(mapFitSport('fitnessEquipment', 'indoorRowing')).toEqual({ sport: 'row', subSport: 'erg' });
    expect(mapFitSport(254, undefined)).toEqual({ sport: 'other', subSport: 'generic' });
  });
});
