import { describe, expect, it } from 'vitest';
import type { ActivityStreams } from '../../src/domain';
import { computeActivityMetrics, MMP_DURATIONS, type ActivityMetricsInput } from '../../src/metrics';
import { blocks, near, now, rng } from './helpers';

const secs = (n: number) => Array.from({ length: n }, (_, i) => i);
const HR = { lthr: 170, hrMax: 190, hrRest: 50 };

function run(input: Partial<ActivityMetricsInput> & Pick<ActivityMetricsInput, 'sport'>) {
  return computeActivityMetrics({ summary: { durationSec: 0 }, thresholds: {}, sex: 'male', ...input });
}

describe('computeActivityMetrics — bike', () => {
  const t = secs(3600);
  const streams: ActivityStreams = { t, power: blocks([3600, 200]), hr: blocks([3600, 150]) };

  it('power stream: TV-1 numbers, zones, peaks, intensity', () => {
    const m = run({ sport: 'bike', streams, summary: { durationSec: 3600 }, thresholds: { ftp: 250, ...HR } });
    expect(m.loadSource).toBe('power');
    expect(m.estimated).toBe(false);
    near(m.load, 64);
    near(m.intensityFactor!, 0.8);
    near(m.weightedPower!, 200);
    near(m.variability!, 1);
    near(m.workKj!, 720);
    near(m.loads.hr!, 63.3429);
    near(m.efficiency!, 200 / 150);
    expect(m.movingSec).toBe(3600);
    expect(m.zones.power!.find((z) => z.zone === 3)!.seconds).toBe(3600);
    expect(m.zones.hr!.reduce((a, z) => a + z.seconds, 0)).toBe(3600);
    expect(m.peaks.power!.length).toBe(MMP_DURATIONS.filter((d) => d <= 3600).length);
    near(m.peaks.hr![0].value, 150);
    expect(m.intensityAuto).toBe('tempo');
    expect(m.intensitySec).toEqual({ easy: 0, moderate: 3600, hard: 0 });
    expect(m.sparkline).toHaveLength(48);
    expect(m.decouplingPct).toBeCloseTo(0, 9);
  });

  it('no FTP → HR load; no HR params → duration estimate', () => {
    const a = run({ sport: 'bike', streams, summary: { durationSec: 3600 }, thresholds: HR });
    expect(a.loadSource).toBe('hr');
    near(a.load, 63.3429);
    near(a.weightedPower!, 200); // still reported
    expect(a.intensityFactor).toBeUndefined();
    const b = run({ sport: 'bike', streams, summary: { durationSec: 3600 }, thresholds: {} });
    expect(b.loadSource).toBe('duration');
    expect(b.estimated).toBe(true);
    near(b.load, 50);
  });

  it('power coverage < 80 % makes power ineligible', () => {
    const power = t.map((i) => (i % 60 < 30 ? 200 : null));
    const m = run({ sport: 'bike', streams: { t, power, hr: streams.hr }, summary: { durationSec: 3600 }, thresholds: { ftp: 250, ...HR } });
    expect(m.loads.power).toBeUndefined();
    expect(m.loadSource).toBe('hr');
  });

  it('summary-only: power from avg/weighted power, then avg HR', () => {
    const a = run({ sport: 'bike', summary: { durationSec: 3700, movingSec: 3600, avgPower: 190, weightedPower: 200 }, thresholds: { ftp: 250 } });
    expect(a.loadSource).toBe('power');
    near(a.load, 64);
    expect(a.flags).toContain('summary_only');
    near(a.workKj!, 684);
    const b = run({ sport: 'bike', summary: { durationSec: 3600, avgHr: 150 }, thresholds: HR });
    expect(b.loadSource).toBe('hr');
    near(b.load, 63.3429);
    expect(b.flags).toContain('hr_from_average');
    expect(b.sparkline).toEqual([]);
  });

  it('decoupling only for steady ≥ 60 min with HR coverage ≥ 90 %', () => {
    const t2 = secs(7200);
    const m = run({
      sport: 'bike',
      streams: { t: t2, power: blocks([7200, 200]), hr: blocks([3600, 140], [3600, 147]) },
      summary: { durationSec: 7200 },
      thresholds: { ftp: 250, ...HR },
    });
    near(m.decouplingPct!, 4.7619);
    const short = run({ sport: 'bike', streams: { t: secs(1800), power: blocks([1800, 200]), hr: blocks([1800, 140]) }, summary: { durationSec: 1800 }, thresholds: { ftp: 250, ...HR } });
    expect(short.decouplingPct).toBeUndefined();
  });

  it('manual override wins', () => {
    const m = run({ sport: 'bike', streams, summary: { durationSec: 3600, manualLoad: 42 }, thresholds: { ftp: 250 } });
    expect(m).toMatchObject({ load: 42, loadSource: 'manual', estimated: false });
    near(m.loads.power!, 64);
  });

  it('performance: 5 h ride end-to-end', () => {
    const n = 5 * 3600;
    const r = rng(3);
    const tt = secs(n);
    const s: ActivityStreams = {
      t: tt,
      power: tt.map(() => 120 + 200 * r()),
      hr: tt.map((i) => 120 + 30 * Math.sin(i / 600)),
      speed: tt.map(() => 8 + r()),
      distance: tt.map((i) => i * 8.5),
    };
    const t0 = now();
    const m = run({ sport: 'bike', streams: s, summary: { durationSec: n }, thresholds: { ftp: 250, ...HR } });
    const ms = now() - t0;
    expect(m.loadSource).toBe('power');
    expect(m.peaks.power!.length).toBe(MMP_DURATIONS.length);
    expect(ms).toBeLessThan(2000);
  });
});

describe('computeActivityMetrics — run', () => {
  const thr = 1000 / 240;
  const t = secs(1800);
  const dist = t.map((i) => i * 3);
  const alt = dist.map((d) => 100 + 0.05 * d);

  it('grade-adjusted Pace Load from altitude & distance (≈ TV-6a)', () => {
    const m = run({ sport: 'run', streams: { t, speed: blocks([1800, 3]), distance: dist, altitude: alt }, summary: { durationSec: 1800 }, thresholds: { runThresholdMps: thr } });
    expect(m.loadSource).toBe('pace');
    near(m.load, 43.9021, 0.5); // edges of the grade window differ slightly from a constant grade
    near(m.adjustedSpeedMps!, 3.90433, 0.05);
    expect(m.zones.pace).toBeDefined();
    expect(m.peaks.efforts!.map((e) => e.distanceM)).toEqual([400, 1000, 1609.344, 5000]);
    near(m.peaks.efforts![1].timeSec, 1000 / 3);
    near(m.peaks.speed![0].value, 3);
  });

  it('device grade is used when present; treadmill ignores altitude', () => {
    const g = run({ sport: 'run', streams: { t, speed: blocks([1800, 3]), grade: blocks([1800, 0.05]) }, summary: { durationSec: 1800 }, thresholds: { runThresholdMps: thr } });
    near(g.load, 43.9021);
    const tm = run({ sport: 'run', subSport: 'treadmill', streams: { t, speed: blocks([1800, 3]), distance: dist, altitude: alt }, summary: { durationSec: 1800 }, thresholds: { runThresholdMps: thr } });
    near(tm.load, 100 * 0.5 * (3 / thr) ** 2);
  });

  it('trail runs prefer HR; summary-only pace from distance / moving time', () => {
    const tr = run({ sport: 'run', subSport: 'trail', streams: { t, speed: blocks([1800, 3]), hr: blocks([1800, 150]) }, summary: { durationSec: 1800 }, thresholds: { runThresholdMps: thr, ...HR } });
    expect(tr.loadSource).toBe('hr');
    expect(tr.loads.pace).toBeDefined();
    const s = run({ sport: 'run', summary: { durationSec: 3700, movingSec: 3600, distanceM: 12000 }, thresholds: { runThresholdMps: thr } });
    expect(s.loadSource).toBe('pace');
    near(s.load, 100 * (12000 / 3600 / thr) ** 2);
    near(s.avgSpeedMps!, 12000 / 3600);
  });

  it('stopped samples are excluded from moving time', () => {
    const speed = t.map((i) => (i >= 600 && i < 900 ? 0 : 3));
    const m = run({ sport: 'run', streams: { t, speed }, summary: { durationSec: 1800 }, thresholds: { runThresholdMps: thr } });
    expect(m.movingSec).toBe(1500);
    expect(m.elapsedSec).toBe(1800);
  });
});

describe('computeActivityMetrics — swim, row, strength', () => {
  it('pool swim: TV-7a from summary; rest unknown flagged without moving time', () => {
    const m = run({ sport: 'swim', subSport: 'pool', summary: { durationSec: 2700, movingSec: 2400, distanceM: 2000 }, thresholds: { swimCssMps: 200 / 210 } });
    expect(m.loadSource).toBe('swim_pace');
    near(m.load, 44.6615);
    near(m.intensityFactor!, 0.875);
    const r = run({ sport: 'swim', summary: { durationSec: 2700, distanceM: 2000 }, thresholds: { swimCssMps: 200 / 210 } });
    expect(r.flags).toContain('swim_rest_unknown');
    near(r.load, 35.2881);
  });

  it('pool laps give moving time and best efforts', () => {
    const laps = [20, 20, 0, 21, 21].map((d, i) => ({ distanceM: d ? 25 : 0, durationSec: d || 30, isRest: i === 2 }));
    const m = run({ sport: 'swim', subSport: 'pool', summary: { durationSec: 112, distanceM: 100 }, thresholds: { swimCssMps: 1 } });
    expect(m.movingSec).toBe(112);
    const l = run({ sport: 'swim', subSport: 'pool', summary: { durationSec: 112, distanceM: 100, laps }, thresholds: { swimCssMps: 1 } });
    expect(l.movingSec).toBe(82);
    expect(l.peaks.efforts).toEqual([{ distanceM: 50, timeSec: 40, startSec: 0 }]);
  });

  it('swim without CSS: pool prefers RPE over HR; open water prefers HR', () => {
    const summary = { durationSec: 3600, distanceM: 2500, avgHr: 150, rpe: 5 };
    expect(run({ sport: 'swim', subSport: 'pool', summary, thresholds: HR }).loadSource).toBe('rpe');
    const ow = run({ sport: 'swim', subSport: 'open_water', summary, thresholds: HR });
    expect(ow.loadSource).toBe('hr');
    expect(ow.flags).toContain('open_water');
  });

  it('erg: power derived from pace per second (TV-9); on-water uses HR', () => {
    const t = secs(1800);
    const m = run({ sport: 'row', subSport: 'erg', streams: { t, speed: blocks([1800, 4]) }, summary: { durationSec: 1800 }, thresholds: { rowThresholdW: 200 } });
    expect(m.loadSource).toBe('power');
    expect(m.flags).toContain('power_from_pace');
    near(m.load, 40.1408);
    near(m.weightedPower!, 179.2);
    expect(m.zones.power!.length).toBe(6);
    const s = run({ sport: 'row', summary: { durationSec: 1800, distanceM: 7200 }, thresholds: { rowThresholdW: 200 } });
    near(s.load, 40.1408);
    const w = run({ sport: 'row', subSport: 'on_water', streams: { t, speed: blocks([1800, 4]), hr: blocks([1800, 150]) }, summary: { durationSec: 1800 }, thresholds: { rowThresholdW: 200, ...HR } });
    expect(w.loadSource).toBe('hr');
    expect(w.loads.power).toBeUndefined();
  });

  it('strength: RPE (TV-8), then HR, then duration × intensity class', () => {
    const a = run({ sport: 'strength', summary: { durationSec: 2700, rpe: 7 }, thresholds: {} });
    expect(a).toMatchObject({ loadSource: 'rpe', sessionRpe: 315, intensityAuto: 'threshold' });
    near(a.load, 60);
    near(run({ sport: 'strength', summary: { durationSec: 2700, rpe: 7 }, thresholds: {}, options: { strengthLoadFactor: 0.5 } }).load, 30);
    expect(run({ sport: 'strength', summary: { durationSec: 3600, avgHr: 150 }, thresholds: HR }).loadSource).toBe('hr');
    const d = run({ sport: 'strength', summary: { durationSec: 3600 }, thresholds: {}, options: { intensityClass: 'tempo' } });
    expect(d).toMatchObject({ loadSource: 'duration', estimated: true, intensityAuto: 'tempo' });
    near(d.load, 52);
    expect(run({ sport: 'yoga', summary: { durationSec: 3600 }, thresholds: {} })).toMatchObject({ load: 20, intensityAuto: 'recovery' });
    expect(run({ sport: 'hike', summary: { durationSec: 7200, rpe: 4 }, thresholds: {} }).loadSource).toBe('rpe');
  });
});

describe('computeActivityMetrics — robustness', () => {
  it('never throws on dirty or nonsense input', () => {
    const dirty: ActivityStreams = {
      t: [5, 3, 3, NaN, 20000, 1, 2],
      power: [null, -5, 9999, 100, 200, NaN as never, 150],
      hr: [300, 10, null, 150],
      speed: [],
      distance: [10, 5, null, 3, 2, 1, 0],
    };
    for (const sport of ['bike', 'run', 'swim', 'row', 'strength', 'hike', 'yoga', 'ski', 'other'] as const) {
      const m = run({ sport, streams: dirty, summary: { durationSec: NaN, movingSec: -1, distanceM: NaN, avgHr: NaN, rpe: NaN }, thresholds: { ftp: 0, lthr: -1 } });
      expect(Number.isFinite(m.load)).toBe(true);
      expect(m.load).toBeGreaterThanOrEqual(0);
    }
    const e = computeActivityMetrics(undefined as unknown as ActivityMetricsInput);
    expect(e.flags).toContain('error');
    const e2 = computeActivityMetrics({ sport: 'run', summary: undefined as never, thresholds: {} });
    expect(e2).toMatchObject({ loadSource: 'duration', flags: ['error'] });
  });

  it('empty streams behave like summary-only', () => {
    const m = run({ sport: 'bike', streams: { t: [] }, summary: { durationSec: 3600, avgPower: 200 }, thresholds: { ftp: 250 } });
    expect(m.flags).toContain('summary_only');
    near(m.load, 64);
  });

  it('short efforts (< 30 s) fall back to mean power', () => {
    const m = run({ sport: 'bike', streams: { t: secs(20), power: blocks([20, 300]) }, summary: { durationSec: 20 }, thresholds: { ftp: 300 } });
    expect(m.flags).toContain('wp_fallback');
    near(m.load, 100 * (20 / 3600));
  });
});
