import { describe, expect, it } from 'vitest';
import { Decoder, Stream } from '@garmin/fitsdk';
import { encodeFit, generateActivityDetail, type SynthActivity } from '../../src/synth';
import { athlete } from './fixtures';

function decode(bytes: Uint8Array) {
  const integrity = new Decoder(Stream.fromByteArray(bytes)).checkIntegrity();
  const { messages, errors } = new Decoder(Stream.fromByteArray(bytes)).read({ convertDateTimesToDates: true });
  return { integrity, messages, errors };
}

describe('encodeFit round-trip', () => {
  const a = athlete();
  const pick = (f: (x: SynthActivity) => boolean) => a.activities.filter(f).at(-1)!;

  it('long outdoor ride: records, positions, pauses, laps, session totals', () => {
    const x = a.activities.filter((v) => v.sport === 'bike' && v.subSport === 'road' && v.durationSec > 9000).sort((p, q) => q.durationSec - p.durationSec)[0]!;
    const d = generateActivityDetail(a, x.garminActivityId);
    const bytes = encodeFit(d);
    expect(bytes.length).toBeLessThan(900_000); // a 3–4 h ride stays a few hundred KB
    const { integrity, messages, errors } = decode(bytes);
    expect(integrity).toBe(true);
    expect(errors).toEqual([]);
    expect(messages.fileIdMesgs![0]!.type).toBe('activity');
    expect(messages.fileIdMesgs![0]!.manufacturer).toBe('garmin');
    expect(messages.deviceInfoMesgs!.length).toBeGreaterThanOrEqual(2);
    expect(messages.recordMesgs!.length).toBe(d.streams!.t.length);
    const r = messages.recordMesgs!.find((m) => m.positionLat !== undefined)!;
    expect((r.positionLat! * 180) / 2 ** 31).toBeCloseTo(41.9, 0);
    const s = messages.sessionMesgs![0]!;
    expect(s.sport).toBe('cycling');
    expect(s.subSport).toBe('road');
    expect(s.totalElapsedTime).toBeCloseTo(x.durationSec, 0);
    expect(s.totalDistance).toBeCloseTo(x.distanceM!, 0);
    expect(s.avgHeartRate).toBe(x.avgHr);
    expect(s.avgPower).toBe(x.avgPower);
    expect(s.normalizedPower).toBe(x.normPower);
    expect(s.totalAscent).toBe(x.elevationGainM);
    expect(s.totalTrainingEffect).toBeCloseTo(x.aerobicEffect!, 1);
    expect(messages.lapMesgs!.length).toBe(d.laps.length);
    expect(messages.activityMesgs![0]!.numSessions).toBe(1);
    const gaps = d.streams!.t.filter((t, i) => i > 0 && t - d.streams!.t[i - 1]! > 1).length;
    const stops = messages.eventMesgs!.filter((e) => e.event === 'timer' && e.eventType === 'stopAll').length;
    expect(stops).toBe(gaps + 1);
  });

  it('pool swim: length messages, pool length, strokes', () => {
    const x = pick((v) => v.subSport === 'pool');
    const d = generateActivityDetail(a, x.garminActivityId);
    const { integrity, messages, errors } = decode(encodeFit(d));
    expect(integrity).toBe(true);
    expect(errors).toEqual([]);
    const s = messages.sessionMesgs![0]!;
    expect(s.sport).toBe('swimming');
    expect(s.subSport).toBe('lapSwimming');
    expect(s.poolLength).toBe(25);
    expect(s.totalDistance).toBe(x.distanceM);
    expect(s.totalCycles).toBe(x.strokes);
    const activeLengths = d.laps.filter((l) => !l.isRest).reduce((acc, l) => acc + (l.lengths ?? 0), 0);
    expect(messages.lengthMesgs!.length).toBe(activeLengths);
    expect(messages.lapMesgs!.some((l) => l.intensity === 'rest')).toBe(true);
  });

  it('strength: set messages with reps and weights', () => {
    const x = pick((v) => v.sport === 'strength' && v.subSport === 'gym');
    const d = generateActivityDetail(a, x.garminActivityId);
    const { integrity, messages } = decode(encodeFit(d));
    expect(integrity).toBe(true);
    expect(messages.sessionMesgs![0]!.sport).toBe('training');
    expect(messages.sessionMesgs![0]!.subSport).toBe('strengthTraining');
    expect(messages.setMesgs!.length).toBe(d.strengthSets!.length);
    const active = messages.setMesgs!.filter((m) => m.setType === 'active' && m.repetitions !== undefined);
    expect(active.some((m) => (m.weight ?? 0) > 40)).toBe(true);
    expect(active.some((m) => Array.isArray(m.category) && m.category[0] === 'squat')).toBe(true);
  });

  it('run, open water, erg, indoor ride and hike all encode with the right FIT sport', () => {
    const cases: [(v: SynthActivity) => boolean, string, string][] = [
      [(v) => v.sport === 'run' && v.subSport === 'road_run', 'running', 'generic'],
      [(v) => v.subSport === 'track', 'running', 'track'],
      [(v) => v.subSport === 'open_water', 'swimming', 'openWater'],
      [(v) => v.sport === 'row', 'rowing', 'indoorRowing'],
      [(v) => v.sport === 'bike' && v.subSport === 'indoor', 'cycling', 'indoorCycling'],
      [(v) => v.sport === 'hike', 'hiking', 'generic'],
    ];
    for (const [f, sport, sub] of cases) {
      const x = pick(f);
      const d = generateActivityDetail(a, x.garminActivityId);
      const { integrity, messages, errors } = decode(encodeFit(d));
      expect(integrity, x.title).toBe(true);
      expect(errors, x.title).toEqual([]);
      expect(messages.sessionMesgs![0]!.sport, x.title).toBe(sport);
      expect(messages.sessionMesgs![0]!.subSport, x.title).toBe(sub);
      expect(messages.recordMesgs!.length).toBe(d.streams!.t.length);
      if (x.sport === 'run') {
        // FIT stores running cadence as strides/min
        const c = messages.recordMesgs!.map((m) => m.cadence ?? 0).filter((v) => v > 0);
        expect(c.reduce((p, q) => p + q, 0) / c.length).toBeLessThan(100);
      }
    }
  });
});
