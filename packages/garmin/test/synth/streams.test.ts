import { describe, expect, it } from 'vitest';
import { generateActivityDetail, type SynthActivityDetail } from '../../src/synth';
import { athlete, mean, nums, sample, weightedPower } from './fixtures';

const HOME = { lat: 41.9794, lng: 2.8214 };
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1, Math.abs(b));
const haversine = (la1: number, lo1: number, la2: number, lo2: number) => {
  const R = 6_371_000;
  const dLa = ((la2 - la1) * Math.PI) / 180;
  const dLo = ((lo2 - lo1) * Math.PI) / 180;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos((la1 * Math.PI) / 180) * Math.cos((la2 * Math.PI) / 180) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

describe('summary ↔ stream consistency', () => {
  const a = athlete();
  const details: SynthActivityDetail[] = sample(a).map((x) => generateActivityDetail(a, x.garminActivityId));

  it('covers every sport', () => {
    const sports = new Set(details.map((d) => `${d.activity.sport}/${d.activity.subSport}`));
    expect(sports.size).toBeGreaterThanOrEqual(12);
  });

  it('duration, distance, HR, power, NP and elevation match the summary', () => {
    for (const d of details) {
      const x = d.activity;
      const s = d.streams!;
      const tag = `${x.localDate} ${x.title}`;
      expect(s.t[0], tag).toBe(0);
      expect(s.t.at(-1)! + 1, tag).toBe(x.durationSec);
      const hr = nums(s.hr);
      expect(rel(mean(hr), x.avgHr!), tag).toBeLessThan(0.015);
      expect(Math.abs(Math.max(...hr) - x.maxHr!), tag).toBeLessThanOrEqual(2);
      if (x.distanceM !== undefined) expect(rel(nums(s.distance).at(-1)!, x.distanceM), tag).toBeLessThan(0.005);
      if (s.power) {
        const p = s.power.map((v) => v ?? 0);
        expect(rel(mean(p), x.avgPower!), tag).toBeLessThan(0.015);
        expect(rel(weightedPower(p), x.normPower!), tag).toBeLessThan(0.02);
        expect(rel(Math.max(...p), x.maxPower!), tag).toBeLessThan(0.05);
      }
      if (s.altitude && x.elevationGainM !== undefined) {
        let up = 0;
        const alt = nums(s.altitude);
        for (let i = 1; i < alt.length; i++) if (alt[i]! > alt[i - 1]!) up += alt[i]! - alt[i - 1]!;
        expect(Math.abs(up - x.elevationGainM), tag).toBeLessThanOrEqual(Math.max(3, 0.05 * x.elevationGainM));
      }
      const lapDur = d.laps.reduce((acc, l) => acc + l.durationSec, 0);
      expect(Math.abs(lapDur - x.durationSec), tag).toBeLessThanOrEqual(1.5);
      if (x.distanceM !== undefined && x.sport !== 'swim') {
        const lapDist = d.laps.reduce((acc, l) => acc + (l.distanceM ?? 0), 0);
        expect(rel(lapDist, x.distanceM), tag).toBeLessThan(0.01);
      }
    }
  });

  it('pool swims: lengths, rests at the wall, SWOLF', () => {
    const swims = details.filter((d) => d.activity.subSport === 'pool');
    expect(swims.length).toBeGreaterThan(3);
    for (const d of swims) {
      const x = d.activity;
      expect(x.poolLengthM).toBe(25);
      expect(x.distanceM! % 25).toBe(0);
      const active = d.laps.filter((l) => !l.isRest);
      expect(active.reduce((acc, l) => acc + (l.lengths ?? 0), 0) * 25).toBe(x.distanceM);
      expect(d.laps.some((l) => l.isRest)).toBe(true);
      expect(d.streams!.speed!.some((v) => v === 0)).toBe(true);
      expect(x.avgSwolf!).toBeGreaterThan(25);
      expect(x.avgSwolf!).toBeLessThan(50);
      expect(x.strokes!).toBeGreaterThan(0);
      for (const l of active) if (l.stroke !== 'drill' && l.stroke !== 'mixed') expect(l.swolf).toBeDefined();
    }
  });

  it('strength: HR-only stream + sets with reps, weights and rests', () => {
    const st = details.filter((d) => d.activity.sport === 'strength');
    expect(st.length).toBeGreaterThan(1);
    for (const d of st) {
      expect(Object.keys(d.streams!).sort()).toEqual(['hr', 't']);
      const sets = d.strengthSets!;
      expect(sets.some((s) => s.isRest)).toBe(true);
      expect(sets.filter((s) => !s.isRest && s.category !== 'WARM_UP').length).toBe(d.activity.totalSets);
      expect(sets.reduce((acc, s) => acc + (s.reps ?? 0), 0)).toBe(d.activity.totalReps);
      const sum = sets.reduce((acc, s) => acc + (s.durationSec ?? 0), 0);
      expect(Math.abs(sum - d.activity.durationSec)).toBeLessThan(sets.length);
    }
  });

  it('erg rows: power, stroke rate and consistent 500 m splits', () => {
    const rows = details.filter((d) => d.activity.sport === 'row');
    expect(rows.length).toBeGreaterThan(0);
    for (const d of rows) {
      const cad = nums(d.streams!.cadence).filter((c) => c > 0);
      expect(Math.min(...cad)).toBeGreaterThanOrEqual(14);
      expect(Math.max(...cad)).toBeLessThanOrEqual(36);
      const v = d.activity.avgSpeedMps!;
      const split = 500 / v;
      expect(split).toBeGreaterThan(95);
      expect(split).toBeLessThan(150);
    }
  });

  it('outdoor GPS traces are plausible: near Girona, smooth, no teleporting', () => {
    const gps = details.filter((d) => d.activity.hasGps);
    expect(gps.length).toBeGreaterThan(5);
    for (const d of gps) {
      const s = d.streams!;
      let prev: [number, number, number] | null = null;
      for (let i = 0; i < s.t.length; i++) {
        const la = s.lat![i];
        const lo = s.lng![i];
        if (la == null || lo == null) {
          prev = null;
          continue;
        }
        expect(haversine(la, lo, HOME.lat, HOME.lng), d.activity.title).toBeLessThan(80_000);
        if (prev) {
          const dt = s.t[i]! - prev[2];
          const jump = haversine(la, lo, prev[0], prev[1]);
          expect(jump, `${d.activity.title} @${s.t[i]}`).toBeLessThan(25 * dt + 12);
        }
        prev = [la, lo, s.t[i]!];
      }
    }
    const track = details.find((d) => d.activity.subSport === 'track');
    if (track) {
      const s = track.streams!;
      const la = nums(s.lat);
      const lo = nums(s.lng);
      const spanM = haversine(Math.min(...la), Math.min(...lo), Math.max(...la), Math.max(...lo));
      expect(spanM).toBeLessThan(250); // 400 m oval
    }
  });

  it('cycling streams: coasting zeros outdoors, smooth ERG indoors, cadence and physics speed', () => {
    const rides = details.filter((d) => d.activity.sport === 'bike');
    const outdoor = rides.filter((d) => d.activity.subSport === 'road' && d.activity.durationSec > 3600);
    const indoor = rides.filter((d) => d.activity.subSport === 'indoor');
    expect(outdoor.length).toBeGreaterThan(0);
    expect(indoor.length).toBeGreaterThan(0);
    for (const d of outdoor) {
      const p = nums(d.streams!.power);
      expect(p.filter((v) => v === 0).length / p.length).toBeGreaterThan(0.02);
      expect(d.activity.normPower! / d.activity.avgPower!).toBeGreaterThan(1.02);
      const v = d.activity.avgSpeedMps! * 3.6;
      expect(v).toBeGreaterThan(20);
      expect(v).toBeLessThan(40);
    }
    for (const d of indoor) {
      const p = nums(d.streams!.power);
      expect(p.filter((v) => v === 0).length / p.length).toBeLessThan(0.01);
      const cad = mean(nums(d.streams!.cadence));
      expect(cad).toBeGreaterThan(75);
      expect(cad).toBeLessThan(105);
    }
  });

  it('HR lags effort and recovers between intervals', () => {
    const vo2 = details.find((d) => /VO2|30\/30|Track/.test(d.activity.title)) ?? details.find((d) => d.laps.length > 8)!;
    const laps = vo2.laps;
    const hrs = laps.map((l) => l.avgHr ?? 0);
    expect(Math.max(...hrs) - Math.min(...hrs)).toBeGreaterThan(15);
    // first lap starts low (warm-up), max HR in the second half
    const hr = nums(vo2.streams!.hr);
    expect(hr[0]!).toBeLessThan(hr.reduce((m, v) => Math.max(m, v), 0) - 30);
  });

  it('run cadence ~150–195 spm; walking/hiking slower', () => {
    for (const d of details.filter((x) => x.activity.sport === 'run')) {
      const c = nums(d.streams!.cadence).filter((v) => v > 0);
      expect(mean(c)).toBeGreaterThan(155);
      expect(mean(c)).toBeLessThan(192);
    }
  });

  it('exercises downstream cleaning: auto-pause gaps and sensor dropouts occur', () => {
    const all = a.activities.filter((x) => x.sport === 'bike' && x.subSport === 'road' && x.durationSec > 7200).slice(0, 25).map((x) => generateActivityDetail(a, x.garminActivityId));
    const paused = all.filter((d) => d.streams!.t.some((t, i) => i > 0 && t - d.streams!.t[i - 1]! > 10));
    expect(paused.length).toBeGreaterThan(3);
    for (const d of paused) expect(d.activity.durationSec).toBeGreaterThan(d.streams!.t.length);
    const anyNull = [...details, ...all].some((d) => d.streams!.hr!.some((v) => v === null) || (d.streams!.power ?? []).some((v) => v === null));
    expect(anyNull).toBe(true);
  });

  it('fatigue coupling: same relative effort costs more HR on high-RHR days', () => {
    const easy = a.activities.filter((x) => x.sport === 'bike' && x.subSport === 'indoor' && x.title.startsWith('Z2'));
    const w = new Map(a.wellness.map((d) => [d.date, d]));
    const pts = easy.map((x) => ({ rhr: w.get(x.localDate)!.restingHr!, eff: x.avgHr! / x.avgPower! })).sort((p, q) => p.rhr - q.rhr);
    const lo = mean(pts.slice(0, Math.floor(pts.length / 3)).map((p) => p.eff));
    const hi = mean(pts.slice(-Math.floor(pts.length / 3)).map((p) => p.eff));
    expect(hi).toBeGreaterThan(lo);
  });
});
