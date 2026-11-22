/**
 * Activity "facts" derived from stored 1 Hz streams: the figures the activity page shows that are
 * not training metrics (elevation range and loss, temperature, max cadence / speed, pauses, start
 * and end position, steepest grade, row strokes) plus per-lap maxima. Pure and tolerant: a channel
 * that is missing or all-null yields no fact, never a zero.
 *
 * Streams are the stored representation: `t` = whole elapsed seconds with paused seconds removed
 * (a gap in `t` is a pause), channels aligned with `t`, `null` = no sample.
 */
import type { ActivityFacts, ActivityStreams, Lap, Sport } from '../domain';
import type { NumSeries } from './util';

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const rnd = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;

/** Cumulative descent with a 2 m hysteresis (the same filter as the gain on the activity row). */
export function elevationLossOf(alt: NumSeries | undefined): number | undefined {
  if (!alt) return undefined;
  let loss = 0;
  let ref = NaN;
  let any = false;
  for (let i = 0; i < alt.length; i++) {
    const v = alt[i];
    if (!fin(v)) continue;
    any = true;
    if (Number.isNaN(ref)) ref = v;
    else if (ref - v >= 2) {
      loss += ref - v;
      ref = v;
    } else if (v > ref) ref = v;
  }
  return any ? loss : undefined;
}

function range(x: NumSeries | undefined, opts: { positive?: boolean } = {}): { min: number; max: number; mean: number } | undefined {
  if (!x) return undefined;
  let min = Infinity;
  let max = -Infinity;
  let s = 0;
  let c = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    if (!fin(v) || (opts.positive && v <= 0)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    s += v;
    c++;
  }
  return c ? { min, max, mean: s / c } : undefined;
}

function firstLast(lat: NumSeries | undefined, lng: NumSeries | undefined): { start?: [number, number]; end?: [number, number] } {
  if (!lat || !lng) return {};
  const n = Math.min(lat.length, lng.length);
  let start: [number, number] | undefined;
  let end: [number, number] | undefined;
  for (let i = 0; i < n; i++) {
    const a = lat[i];
    const b = lng[i];
    if (fin(a) && fin(b) && !(a === 0 && b === 0)) {
      start = [a, b];
      break;
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    const a = lat[i];
    const b = lng[i];
    if (fin(a) && fin(b) && !(a === 0 && b === 0)) {
      end = [a, b];
      break;
    }
  }
  return { start, end };
}

/**
 * Steepest sustained grade over a moving window of `windowM` metres of distance (percent).
 * Returns undefined when there is too little distance/altitude to judge.
 */
export function sustainedGrade(distance: NumSeries | undefined, altitude: NumSeries | undefined, windowM = 200): { max: number; min: number } | undefined {
  if (!distance || !altitude) return undefined;
  const d: number[] = [];
  const a: number[] = [];
  const n = Math.min(distance.length, altitude.length);
  for (let i = 0; i < n; i++) {
    const x = distance[i];
    const y = altitude[i];
    if (fin(x) && fin(y) && (!d.length || x >= d[d.length - 1]!)) {
      d.push(x);
      a.push(y);
    }
  }
  if (d.length < 2 || d[d.length - 1]! - d[0]! < windowM * 2) return undefined;
  let max = -Infinity;
  let min = Infinity;
  let j = 0;
  for (let i = 0; i < d.length; i++) {
    while (j < d.length && d[j]! - d[i]! < windowM) j++;
    if (j >= d.length) break;
    const g = ((a[j]! - a[i]!) / (d[j]! - d[i]!)) * 100;
    if (g > max) max = g;
    if (g < min) min = g;
  }
  return Number.isFinite(max) ? { max: rnd(max, 1), min: rnd(min, 1) } : undefined;
}

/** Facts derivable from stored streams. */
export function streamFacts(s: ActivityStreams | null | undefined, opts: { sport: Sport }): ActivityFacts {
  const out: ActivityFacts = {};
  if (!s?.t?.length) return out;
  const t = s.t;
  // pauses = gaps in the stored time axis
  let pausedSec = 0;
  let pauseCount = 0;
  for (let k = 0; k + 1 < t.length; k++) {
    const gap = t[k + 1]! - t[k]!;
    if (gap > 1.5) {
      pausedSec += gap - 1;
      pauseCount++;
    }
  }
  if (pauseCount) {
    out.pauseCount = pauseCount;
    out.pausedSec = Math.round(pausedSec);
  }
  const { start, end } = firstLast(s.lat, s.lng);
  if (start) [out.startLat, out.startLng] = [rnd(start[0], 6), rnd(start[1], 6)];
  if (end) [out.endLat, out.endLng] = [rnd(end[0], 6), rnd(end[1], 6)];

  const alt = range(s.altitude);
  if (alt) {
    out.minAltitudeM = rnd(alt.min, 1);
    out.maxAltitudeM = rnd(alt.max, 1);
    const loss = elevationLossOf(s.altitude);
    if (loss !== undefined) out.elevationLossM = rnd(loss, 1);
    const g = sustainedGrade(s.distance, s.altitude);
    if (g) {
      out.maxGradePct = g.max;
      out.minGradePct = g.min;
    }
  }
  const temp = range(s.temp);
  if (temp) {
    out.avgTempC = rnd(temp.mean, 1);
    out.minTempC = rnd(temp.min, 1);
    out.maxTempC = rnd(temp.max, 1);
  }
  const hr = range(s.hr, { positive: true });
  if (hr) out.minHr = Math.round(hr.min);
  const cad = range(s.cadence, { positive: true });
  if (cad) out.maxCadence = Math.round(cad.max);
  const sp = range(s.speed, { positive: true });
  if (sp && opts.sport !== 'swim') out.maxSpeedMps = rnd(sp.max, 3);

  // rowing: strokes from the stroke-rate channel (1 Hz → rate/60 strokes per sample)
  if (opts.sport === 'row' && s.cadence && s.distance) {
    let strokes = 0;
    for (let i = 0; i < s.cadence.length; i++) {
      const c = s.cadence[i];
      if (fin(c) && c > 0) strokes += c / 60;
    }
    const d = range(s.distance);
    if (strokes > 10 && d && d.max - d.min > 0) {
      out.totalStrokes = Math.round(strokes);
      out.avgDistancePerStrokeM = rnd((d.max - d.min) / strokes, 2);
    }
  }
  return out;
}

/**
 * Fill per-lap maxima (power, speed, cadence), descent and temperature from the stored streams —
 * only where the lap does not already carry the value. Laps are matched by their
 * [startSec, startSec + durationSec) window on the stream's elapsed time axis.
 */
export function enrichLaps(laps: readonly Lap[], s: ActivityStreams | null | undefined, opts: { sport: Sport }): Lap[] {
  if (!s?.t?.length || !laps.length) return laps.slice();
  const t = s.t;
  const lower = (x: number) => {
    let lo = 0;
    let hi = t.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (t[mid]! < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return laps.map((lap) => {
    const a = lower(lap.startSec);
    const z = lower(lap.startSec + lap.durationSec);
    if (z - a < 2) return { ...lap };
    const out: Lap = { ...lap };
    const slice = (ch: NumSeries | undefined) => (ch ? Array.prototype.slice.call(ch, a, z) as Array<number | null> : undefined);
    if (out.maxPower === undefined) {
      const r = range(slice(s.power));
      if (r && r.max > 0) out.maxPower = Math.round(r.max);
    }
    if (out.maxSpeedMps === undefined && opts.sport !== 'swim') {
      const r = range(slice(s.speed), { positive: true });
      if (r) out.maxSpeedMps = rnd(r.max, 3);
    }
    if (out.maxCadence === undefined) {
      const r = range(slice(s.cadence), { positive: true });
      if (r) out.maxCadence = Math.round(r.max);
    }
    if (out.elevationLossM === undefined && s.altitude) {
      const l = elevationLossOf(slice(s.altitude));
      if (l !== undefined) out.elevationLossM = Math.round(l);
    }
    if (out.avgTempC === undefined) {
      const r = range(slice(s.temp));
      if (r) out.avgTempC = rnd(r.mean, 1);
    }
    return out;
  });
}

/** Merge fact sources: earlier sources win field by field; empty values are skipped. */
export function mergeFacts(...sources: Array<ActivityFacts | null | undefined>): ActivityFacts {
  const out: Record<string, unknown> = {};
  for (const src of sources) {
    if (!src) continue;
    for (const [k, v] of Object.entries(src)) {
      if (out[k] !== undefined || v === undefined || v === null || v === '') continue;
      if (typeof v === 'number' && !Number.isFinite(v)) continue;
      if (Array.isArray(v) && !v.length) continue;
      out[k] = v;
    }
  }
  return out as ActivityFacts;
}
