/**
 * Stream preparation (metrics.md §1): 1 Hz resampling, pause detection,
 * invalid-value masking, stopped-time removal, plus generic series helpers
 * (rolling means, LTTB downsampling, the calendar-card effort sparkline).
 *
 * Internal series are Float64Array with NaN = missing sample.
 */
import type { ActivityStreams, Sport, SubSport } from '../domain';
import { isNum, toF64, type NumSeries } from './util';

/** Gaps longer than this (s) between samples are pauses (§1.1 step 2). */
export const MAX_GAP_SEC = 10;
/** Power spike cap (W); values above are treated as missing (§1.1 step 4, DECISION). */
export const POWER_CAP_W = 2500;
/** A run of ≥ this many seconds of zero power and no speed is a stop (bike/row, §1.1 step 5). */
export const STOP_MIN_SEC = 60;
/** Below this speed (m/s) a sample counts as stopped. */
export const STOP_SPEED_MPS = 0.5;

/** A cleaned 1 Hz series. All channels share the length of `t`; NaN = missing. */
export interface Series1Hz {
  /** Seconds from the first sample. */
  t: Float64Array;
  power?: Float64Array; // W
  hr?: Float64Array; // bpm
  speed?: Float64Array; // m/s
  cadence?: Float64Array;
  altitude?: Float64Array; // m
  distance?: Float64Array; // cumulative m
  grade?: Float64Array; // fraction
}

export interface PreparedStreams {
  /**
   * Every second from start to end. Paused seconds carry power 0, speed 0,
   * cadence 0, HR/altitude/grade missing and distance carried forward.
   * Used for peak curves and best efforts so an effort never bridges a pause.
   */
  elapsed: Series1Hz & { paused: Uint8Array };
  /** Recorded, non-paused, non-stopped samples, concatenated (Load, zones, averages). */
  active: Series1Hz;
  /** For each active sample, its index in `elapsed`. */
  activeIndex: Int32Array;
  /** Active series length (s). */
  movingSec: number;
  /** Last t − first t (s). */
  elapsedSec: number;
  /** Non-paused seconds (s). */
  timerSec: number;
}

export interface PrepareOptions {
  sport?: Sport;
  subSport?: SubSport;
  /** Pause gap threshold (s), default 10. */
  maxGapSec?: number;
  powerCapW?: number;
  /** Explicit timer-stop intervals [startSec, endSec) (FIT timer events); merged with gap detection. */
  pauses?: ReadonlyArray<readonly [number, number]>;
}

const CHANNELS = ['power', 'hr', 'speed', 'cadence', 'altitude', 'distance', 'grade'] as const;
type Channel = (typeof CHANNELS)[number];

function speedCap(sport: Sport | undefined): number {
  if (sport === 'run' || sport === 'walk' || sport === 'hike') return 12;
  if (sport === 'swim') return 3;
  return 30; // ours: generous cap for bike/row/ski/other
}

function validator(ch: Channel, sport: Sport | undefined, powerCap: number): (v: number) => boolean {
  switch (ch) {
    case 'power':
      return (v) => v >= 0 && v <= powerCap;
    case 'hr':
      return (v) => v >= 25 && v <= 250;
    case 'speed': {
      const cap = speedCap(sport);
      return (v) => v >= 0 && v <= cap;
    }
    case 'cadence':
      return (v) => v >= 0 && v <= 300;
    case 'distance':
      return (v) => v >= 0;
    case 'grade':
      return (v) => v >= -1 && v <= 1;
    default:
      return () => true;
  }
}

function emptyPrepared(): PreparedStreams {
  const z = new Float64Array(0);
  return {
    elapsed: { t: z, paused: new Uint8Array(0) },
    active: { t: z },
    activeIndex: new Int32Array(0),
    movingSec: 0,
    elapsedSec: 0,
    timerSec: 0,
  };
}

/**
 * Clean and resample raw streams to 1 Hz (metrics.md §1.1). Never throws on
 * dirty input: unsorted/duplicate timestamps, nulls, spikes and gaps are handled.
 * Complexity O(n log n) for unsorted input, O(n) otherwise.
 */
export function prepareStreams(raw: ActivityStreams | null | undefined, opts: PrepareOptions = {}): PreparedStreams {
  if (!raw || !raw.t || raw.t.length === 0) return emptyPrepared();
  const maxGap = opts.maxGapSec ?? MAX_GAP_SEC;
  const powerCap = opts.powerCapW ?? POWER_CAP_W;
  const sport = opts.sport;

  // 1. sort by t, drop duplicate timestamps (keep last).
  const rawT = raw.t;
  let idx: number[] = [];
  for (let i = 0; i < rawT.length; i++) if (isNum(rawT[i])) idx.push(i);
  if (idx.length === 0) return emptyPrepared();
  let sorted = true;
  for (let k = 1; k < idx.length; k++) if (rawT[idx[k]] < rawT[idx[k - 1]]) { sorted = false; break; }
  if (!sorted) idx.sort((a, b) => rawT[a] - rawT[b] || a - b);
  const dedup: number[] = [];
  for (const i of idx) {
    if (dedup.length && rawT[dedup[dedup.length - 1]] === rawT[i]) dedup[dedup.length - 1] = i;
    else dedup.push(i);
  }
  idx = dedup;
  const m = idx.length;
  const ts = new Float64Array(m);
  for (let k = 0; k < m; k++) ts[k] = rawT[idx[k]];
  const t0 = ts[0];
  const N = Math.floor(ts[m - 1] - t0) + 1;

  // 2. pauses: gaps > maxGap, plus explicit timer pauses.
  const paused = new Uint8Array(N);
  for (let k = 0; k + 1 < m; k++) {
    const a = ts[k] - t0;
    const b = ts[k + 1] - t0;
    if (b - a > maxGap) for (let g = Math.floor(a) + 1; g < Math.ceil(b) && g < N; g++) paused[g] = 1;
  }
  if (opts.pauses) {
    for (const [s, e] of opts.pauses) {
      for (let g = Math.max(0, Math.ceil(s - t0)); g < N && t0 + g < e; g++) paused[g] = 1;
    }
  }

  // 3/4. per channel: invalidate, then interpolate onto the grid across gaps ≤ maxGap.
  const t = new Float64Array(N);
  for (let g = 0; g < N; g++) t[g] = g;
  const elapsed: Series1Hz & { paused: Uint8Array } = { t, paused };
  for (const ch of CHANNELS) {
    const src = raw[ch] as NumSeries | undefined;
    if (!src || src.length === 0) continue;
    const ok = validator(ch, sport, powerCap);
    const px: number[] = [];
    const py: number[] = [];
    for (let k = 0; k < m; k++) {
      const v = src[idx[k]];
      if (typeof v === 'number' && Number.isFinite(v) && ok(v)) {
        px.push(ts[k] - t0);
        py.push(v);
      }
    }
    if (px.length === 0) continue;
    const out = new Float64Array(N).fill(NaN);
    let j = 0;
    for (let g = 0; g < N; g++) {
      while (j + 1 < px.length && px[j + 1] <= g) j++;
      if (px[j] === g) out[g] = py[j];
      else if (px[j] < g && j + 1 < px.length && px[j + 1] - px[j] <= maxGap) {
        const f = (g - px[j]) / (px[j + 1] - px[j]);
        out[g] = py[j] + f * (py[j + 1] - py[j]);
      }
    }
    if (ch === 'distance') {
      let last = NaN;
      for (let g = 0; g < N; g++) {
        const v = out[g];
        if (Number.isNaN(v)) continue;
        if (!Number.isNaN(last) && v < last) out[g] = last;
        last = out[g];
      }
    }
    elapsed[ch] = out;
  }

  // Derive speed from distance when the device did not record it.
  if (!elapsed.speed && elapsed.distance) {
    const d = elapsed.distance;
    const sp = new Float64Array(N).fill(NaN);
    for (let g = 1; g < N; g++) if (!Number.isNaN(d[g]) && !Number.isNaN(d[g - 1])) sp[g] = d[g] - d[g - 1];
    if (N > 1) sp[0] = sp[1];
    const cap = speedCap(sport);
    for (let g = 0; g < N; g++) if (sp[g] > cap) sp[g] = NaN;
    elapsed.speed = sp;
  }

  // Fill paused seconds.
  let lastDist = NaN;
  for (let g = 0; g < N; g++) {
    if (elapsed.distance && !Number.isNaN(elapsed.distance[g])) lastDist = elapsed.distance[g];
    if (!paused[g]) continue;
    if (elapsed.power) elapsed.power[g] = 0;
    if (elapsed.speed) elapsed.speed[g] = 0;
    if (elapsed.cadence) elapsed.cadence[g] = 0;
    if (elapsed.hr) elapsed.hr[g] = NaN;
    if (elapsed.altitude) elapsed.altitude[g] = NaN;
    if (elapsed.grade) elapsed.grade[g] = NaN;
    if (elapsed.distance) elapsed.distance[g] = lastDist;
  }

  // 5/6. stopped-time removal.
  const stopped = new Uint8Array(N);
  const power = elapsed.power;
  const speed = elapsed.speed;
  const isStill = (g: number) => !speed || Number.isNaN(speed[g]) || speed[g] < STOP_SPEED_MPS;
  if (sport === 'bike' || sport === 'row') {
    const zero = power
      ? (g: number) => power[g] === 0 && isStill(g)
      : speed
        ? (g: number) => !Number.isNaN(speed[g]) && speed[g] < STOP_SPEED_MPS
        : null;
    if (zero) {
      let runStart = -1;
      for (let g = 0; g <= N; g++) {
        const z = g < N && !paused[g] && zero(g);
        if (z && runStart < 0) runStart = g;
        if (!z && runStart >= 0) {
          if (g - runStart >= STOP_MIN_SEC) for (let k = runStart; k < g; k++) stopped[k] = 1;
          runStart = -1;
        }
      }
    }
  } else if ((sport === 'run' || sport === 'walk' || sport === 'hike') && speed) {
    for (let g = 0; g < N; g++) if (!Number.isNaN(speed[g]) && speed[g] < STOP_SPEED_MPS) stopped[g] = 1;
  }

  let timer = 0;
  let nActive = 0;
  for (let g = 0; g < N; g++) {
    if (!paused[g]) timer++;
    if (!paused[g] && !stopped[g]) nActive++;
  }
  const activeIndex = new Int32Array(nActive);
  for (let g = 0, k = 0; g < N; g++) if (!paused[g] && !stopped[g]) activeIndex[k++] = g;
  const active: Series1Hz = { t: new Float64Array(nActive) };
  for (let k = 0; k < nActive; k++) active.t[k] = k;
  for (const ch of CHANNELS) {
    const src = elapsed[ch];
    if (!src) continue;
    const out = new Float64Array(nActive);
    for (let k = 0; k < nActive; k++) out[k] = src[activeIndex[k]];
    active[ch] = out;
  }

  return { elapsed, active, activeIndex, movingSec: nActive, elapsedSec: ts[m - 1] - t0, timerSec: timer };
}

/**
 * Rolling mean over `window` samples, ignoring NaN. `trailing` (default) uses
 * samples i−w+1..i (partial at the start); `centered` uses a centred window.
 * Entries whose window holds no finite value are NaN. O(n).
 */
export function rollingMean(x: NumSeries, window: number, mode: 'trailing' | 'centered' = 'trailing'): Float64Array {
  const n = x.length;
  const out = new Float64Array(n);
  const w = Math.max(1, Math.floor(window));
  const ps = new Float64Array(n + 1);
  const pc = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const v = x[i];
    const ok = typeof v === 'number' && Number.isFinite(v);
    ps[i + 1] = ps[i] + (ok ? (v as number) : 0);
    pc[i + 1] = pc[i] + (ok ? 1 : 0);
  }
  const back = mode === 'trailing' ? w - 1 : Math.floor((w - 1) / 2);
  const fwd = mode === 'trailing' ? 0 : w - 1 - back;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - back);
    const b = Math.min(n, i + fwd + 1);
    const c = pc[b] - pc[a];
    out[i] = c > 0 ? (ps[b] - ps[a]) / c : NaN;
  }
  return out;
}

/**
 * Largest-Triangle-Three-Buckets downsampling (Steinarsson 2013) to at most
 * `n` points. Points with a non-finite x or y are dropped first. O(len).
 */
export function lttb(x: NumSeries, y: NumSeries, n: number): { x: number[]; y: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  const len = Math.min(x.length, y.length);
  for (let i = 0; i < len; i++) {
    const a = x[i];
    const b = y[i];
    if (isNum(a) && isNum(b)) {
      xs.push(a);
      ys.push(b);
    }
  }
  const L = xs.length;
  const target = Math.floor(n);
  if (target >= L || target <= 0) return target <= 0 ? { x: [], y: [] } : { x: xs, y: ys };
  if (target === 1) return { x: [xs[0]], y: [ys[0]] };
  if (target === 2) return { x: [xs[0], xs[L - 1]], y: [ys[0], ys[L - 1]] };
  const ox = [xs[0]];
  const oy = [ys[0]];
  const every = (L - 2) / (target - 2);
  let a = 0;
  for (let i = 0; i < target - 2; i++) {
    let avgStart = Math.floor((i + 1) * every) + 1;
    let avgEnd = Math.min(Math.floor((i + 2) * every) + 1, L);
    if (avgStart >= avgEnd) avgStart = avgEnd - 1;
    let ax = 0;
    let ay = 0;
    for (let j = avgStart; j < avgEnd; j++) {
      ax += xs[j];
      ay += ys[j];
    }
    const cnt = avgEnd - avgStart;
    ax /= cnt;
    ay /= cnt;
    const start = Math.floor(i * every) + 1;
    const end = Math.floor((i + 1) * every) + 1;
    let maxArea = -1;
    let pick = start;
    for (let j = start; j < end; j++) {
      const area = Math.abs((xs[a] - ax) * (ys[j] - ys[a]) - (xs[a] - xs[j]) * (ay - ys[a]));
      if (area > maxArea) {
        maxArea = area;
        pick = j;
      }
    }
    ox.push(xs[pick]);
    oy.push(ys[pick]);
    a = pick;
  }
  ox.push(xs[L - 1]);
  oy.push(ys[L - 1]);
  return { x: ox, y: oy };
}

/** Number of buckets in the calendar-card sparkline. */
export const SPARKLINE_BUCKETS = 48;

function isPrepared(s: ActivityStreams | PreparedStreams): s is PreparedStreams {
  return (s as PreparedStreams).elapsed !== undefined;
}

/**
 * Effort profile for the calendar card: ≤ 48 equal-time buckets over the
 * elapsed series, values 0..1. Channel: power, else speed (run/swim/row/walk/hike),
 * else HR. Power/speed are scaled by the highest bucket; HR is scaled between
 * 60 % of the highest bucket and the highest bucket (resting HR would otherwise
 * flatten the profile). Paused buckets read 0. Returns [] without usable data.
 */
export function effortSparkline(
  streams: ActivityStreams | PreparedStreams | null | undefined,
  sport: Sport,
  buckets: number = SPARKLINE_BUCKETS,
): number[] {
  if (!streams) return [];
  const prep = isPrepared(streams) ? streams : prepareStreams(streams, { sport });
  const e = prep.elapsed;
  const N = e.t.length;
  if (N === 0) return [];
  const speedFirst = sport !== 'bike';
  const candidates: Array<{ ch: Float64Array | undefined; kind: 'lin' | 'hr' }> = [
    { ch: e.power, kind: 'lin' },
    { ch: speedFirst ? e.speed : undefined, kind: 'lin' },
    { ch: e.hr, kind: 'hr' },
    { ch: e.speed, kind: 'lin' },
  ];
  let chosen: { ch: Float64Array; kind: 'lin' | 'hr' } | null = null;
  for (const c of candidates) {
    if (!c.ch) continue;
    let any = false;
    for (let g = 0; g < N; g++) if (c.ch[g] > 0) { any = true; break; }
    if (any) { chosen = { ch: c.ch, kind: c.kind }; break; }
  }
  if (!chosen) return [];
  const B = Math.max(1, Math.min(Math.floor(buckets), N));
  const vals = new Array<number>(B).fill(0);
  for (let b = 0; b < B; b++) {
    const a = Math.floor((b * N) / B);
    const z = Math.floor(((b + 1) * N) / B);
    let s = 0;
    let c = 0;
    for (let g = a; g < z; g++) {
      const v = chosen.ch[g];
      if (!Number.isNaN(v) && !e.paused[g]) {
        s += v;
        c++;
      }
    }
    vals[b] = c ? s / c : 0;
  }
  const max = Math.max(...vals);
  if (!(max > 0)) return vals.map(() => 0);
  const floor = chosen.kind === 'hr' ? 0.6 * max : 0;
  return vals.map((v) => (v <= 0 ? 0 : Math.max(0, Math.min(1, (v - floor) / (max - floor)))));
}
