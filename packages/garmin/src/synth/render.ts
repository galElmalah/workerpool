/**
 * 1 Hz detail renderer: interpolates the coarse grid, adds zero-sum high-frequency noise,
 * GPS jitter, sensor dropouts; derives laps and strength sets.
 */
import type { ActivityStreams, Lap, StrengthSet } from '@cadence/core/domain';
import { blockValues, noiseFor } from './channels';
import type { Model } from './model';
import { CH, noiseKey, tri } from './noise';
import { rngFor } from './prng';
import { coursePos, courseP, metersPerDegLat, type LatLng } from './routes';
import { altGrade } from './terrain';
import type { Base } from './simulate';
import { round, upperIndex } from './util';

export interface Rendered {
  streams?: ActivityStreams;
  laps: Lap[];
  strengthSets?: StrengthSet[];
}

/** Null runs (sensor dropouts) for a channel: list of [startIdx, endIdx). */
function dropouts(seed: number, id: number, ch: string, n: number, prob: number, maxLen: number): [number, number][] {
  const rng = rngFor(seed, 'drop', id, ch);
  const out: [number, number][] = [];
  if (n < 600 || !rng.chance(prob)) return out;
  const count = rng.int(1, 2);
  for (let i = 0; i < count; i++) {
    const s = rng.int(120, n - 120);
    out.push([s, s + rng.int(4, maxLen)]);
  }
  return out;
}

function applyNulls(arr: (number | null)[], runs: [number, number][]): void {
  for (const [a, b] of runs) for (let i = a; i < b && i < arr.length; i++) arr[i] = null;
}

export function render(m: Model, b: Base): Rendered {
  const dur = m.dur;
  // recorded seconds
  const t: number[] = [];
  for (let s = 0; s < dur; s++) if (b.rec[Math.floor(s / b.dt)]) t.push(s);
  const N = t.length;
  const fam = m.family;
  const buf = new Float64Array(10);

  /** Render a grid channel to 1 Hz with noise and a rounding function. */
  const chan = (c: Float64Array, ch: 'power' | 'hr' | 'cad' | 'speed' | 'temp', digits: number, min = 0): (number | null)[] => {
    const nz = noiseFor(m, ch);
    const out: (number | null)[] = new Array(N);
    let i = 0;
    for (let k = 0; k < b.n && i < N; k++) {
      if (!b.rec[k]) continue;
      const cnt = blockValues(c, b, k, nz, buf);
      for (let j = 0; j < cnt; j++) out[i++] = round(Math.max(min, buf[j]!), digits);
    }
    return out;
  };

  const streams: ActivityStreams = { t };
  const hr = chan(b.hr, 'hr', 0, 40);
  applyNulls(hr, dropouts(m.seed, m.header.id, 'hr', N, fam === 'swim_pool' || fam === 'swim_ow' ? 0.5 : 0.22, 25));
  streams.hr = hr;

  if (b.power) {
    const p = chan(b.power, 'power', 0);
    if (fam === 'bike' && !m.indoor) applyNulls(p, dropouts(m.seed, m.header.id, 'pw', N, 0.12, 12));
    streams.power = p;
  }
  if (m.swim) {
    renderSwim(m, t, streams);
  } else if (b.dist && b.speed) {
    // distance (no noise, exact interpolation) and speed (noisy)
    const dist: (number | null)[] = new Array(N);
    const nzNone = { key: 0, sd: 0, mul: false };
    let i = 0;
    for (let k = 0; k < b.n && i < N; k++) {
      if (!b.rec[k]) continue;
      const cnt = blockValues(b.dist, b, k, nzNone, buf);
      for (let j = 0; j < cnt; j++) dist[i++] = round(buf[j]!, 1);
    }
    streams.distance = dist;
    streams.speed = chan(b.speed, 'speed', 3);
    if (b.cad) streams.cadence = chan(b.cad, 'cad', 0);
    if (m.course) {
      const alt: (number | null)[] = new Array(N);
      const grade: (number | null)[] = new Array(N);
      const lat: (number | null)[] = new Array(N);
      const lng: (number | null)[] = new Array(N);
      const tg = { alt: 0, grade: 0 };
      const pos: LatLng = { lat: 0, lng: 0 };
      const cp = { p: 0, dir: 1 };
      const kx = noiseKey(m.seed, m.header.id, CH.gpsX);
      const ky = noiseKey(m.seed, m.header.id, CH.gpsY);
      const gpsSd = fam === 'swim_ow' ? 4 : m.header.subSport === 'track' ? 2.5 : 1.6;
      let ex = 0;
      let ey = 0;
      const phi = Math.exp(-1 / 25);
      const kk = Math.sqrt(1 - phi * phi) * gpsSd * 2.45;
      const cosLat = Math.cos((m.course.path?.origin.lat ?? m.course.oval!.origin.lat) * (Math.PI / 180));
      for (let s = 0; s < N; s++) {
        const d = dist[s]!;
        courseP(m.course, d, cp);
        altGrade(m.course.terrain, cp.p, tg);
        alt[s] = round(tg.alt, 1);
        grade[s] = round(tg.grade * cp.dir, 3);
        coursePos(m.course, cp.p, pos);
        ex = ex * phi + kk * tri(kx, t[s]!);
        ey = ey * phi + kk * tri(ky, t[s]!);
        lat[s] = round(pos.lat + ey / metersPerDegLat, 6);
        lng[s] = round(pos.lng + ex / (metersPerDegLat * cosLat), 6);
      }
      // occasional GPS loss (tree cover / underpass)
      const gpsLoss = dropouts(m.seed, m.header.id, 'gps', N, 0.1, 20);
      applyNulls(lat, gpsLoss);
      applyNulls(lng, gpsLoss);
      streams.altitude = alt;
      streams.grade = grade;
      streams.lat = lat;
      streams.lng = lng;
    }
  }
  if (fam !== 'strength' && fam !== 'yoga') streams.temp = chan(b.temp, 'temp', 0, -20);

  const laps = buildLaps(m, streams);
  const out: Rendered = { streams, laps };
  if (m.strength) {
    out.strengthSets = m.strength.items.map((it, i) => {
      const s: StrengthSet = { index: i, exercise: it.exercise, durationSec: Math.round(it.dur) };
      if (it.isRest) s.isRest = true;
      else s.category = it.category;
      if (it.reps !== undefined) s.reps = it.reps;
      if (it.weightKg !== undefined) s.weightKg = it.weightKg;
      return s;
    });
  }
  return out;
}

function renderSwim(m: Model, t: number[], streams: ActivityStreams): void {
  const sw = m.swim!;
  const N = t.length;
  const speed: (number | null)[] = new Array(N);
  const dist: (number | null)[] = new Array(N);
  const cad: (number | null)[] = new Array(N);
  let li = 0;
  let done = 0;
  for (let i = 0; i < N; i++) {
    const s = t[i]!;
    while (li < sw.lengths.length && s >= sw.lengths[li]!.start + sw.lengths[li]!.dur) {
      done += sw.poolLengthM;
      li++;
    }
    const len = sw.lengths[li];
    if (len && s >= len.start) {
      speed[i] = round(sw.poolLengthM / len.dur, 3);
      dist[i] = round(done + (sw.poolLengthM * (s - len.start)) / len.dur, 1);
      cad[i] = len.strokes > 0 ? Math.round((len.strokes / len.dur) * 60) : 0;
    } else {
      speed[i] = 0;
      dist[i] = done;
      cad[i] = 0;
    }
  }
  // the last sample closes the final length
  if (N > 0 && li >= sw.lengths.length) dist[N - 1] = done;
  streams.speed = speed;
  streams.distance = dist;
  streams.cadence = cad;
}

interface LapRange {
  start: number;
  end: number;
}

function lapRanges(m: Model, s: ActivityStreams): LapRange[] {
  if (m.laps) return m.laps;
  if (m.swim) return m.swim.laps.map((l) => ({ start: l.start, end: l.start + l.dur }));
  const out: LapRange[] = [];
  if (m.autoLapM > 0 && s.distance) {
    let next = m.autoLapM;
    let st = 0;
    for (let i = 0; i < s.t.length; i++) {
      const d = s.distance[i];
      if (d !== null && d !== undefined && d >= next) {
        out.push({ start: st, end: s.t[i]! });
        st = s.t[i]!;
        next += m.autoLapM;
      }
    }
    if (m.dur - st >= 10 || out.length === 0) out.push({ start: st, end: m.dur });
    else out[out.length - 1]!.end = m.dur;
    return out;
  }
  return [{ start: 0, end: m.dur }];
}

function np(p: (number | null)[], a: number, z: number): number | undefined {
  const n = z - a;
  if (n < 30) return undefined;
  let w = 0;
  for (let i = a; i < a + 30; i++) w += p[i] ?? 0;
  let acc = (w / 30) ** 4;
  let c = 1;
  for (let i = a + 30; i < z; i++) {
    w += (p[i] ?? 0) - (p[i - 30] ?? 0);
    acc += (w / 30) ** 4;
    c++;
  }
  return Math.round((acc / c) ** 0.25);
}

function buildLaps(m: Model, s: ActivityStreams): Lap[] {
  const ranges = lapRanges(m, s);
  const t = s.t;
  const laps: Lap[] = [];
  ranges.forEach((r, idx) => {
    const a = Math.max(0, upperIndex(t, r.start - 1) + 1);
    const z = Math.max(a, upperIndex(t, r.end - 1) + 1);
    const lap: Lap = { index: idx, startSec: r.start, durationSec: round(r.end - r.start, 1) };
    let hrS = 0;
    let hrN = 0;
    let hrMax = 0;
    let pS = 0;
    let cS = 0;
    let cN = 0;
    let mov = 0;
    let up = 0;
    for (let i = a; i < z; i++) {
      const h = s.hr?.[i];
      if (h !== null && h !== undefined) {
        hrS += h;
        hrN++;
        if (h > hrMax) hrMax = h;
      }
      if (s.power) pS += s.power[i] ?? 0;
      const c = s.cadence?.[i];
      if (c) {
        cS += c;
        cN++;
      }
      const v = s.speed?.[i];
      if (v === undefined || (v !== null && v >= 0.5) || (s.power && (s.power[i] ?? 0) > 0)) mov++;
      if (s.altitude && i > a) {
        const d = (s.altitude[i] ?? 0) - (s.altitude[i - 1] ?? 0);
        if (d > 0) up += d;
      }
    }
    const n = z - a;
    lap.movingSec = mov;
    if (s.distance && n > 0) {
      const d0 = a > 0 ? (s.distance[a - 1] ?? 0) : 0;
      const d1 = s.distance[z - 1] ?? d0;
      lap.distanceM = round(d1 - d0, 1);
      if (mov > 0) lap.avgSpeedMps = round(lap.distanceM / mov, 3);
    }
    if (hrN) {
      lap.avgHr = Math.round(hrS / hrN);
      lap.maxHr = hrMax;
    }
    if (s.power && n > 0) {
      lap.avgPower = Math.round(pS / n);
      const w = np(s.power, a, z);
      if (w !== undefined) lap.weightedPower = w;
    }
    if (cN) lap.avgCadence = Math.round(cS / cN);
    if (s.altitude) lap.elevationGainM = Math.round(up);
    if (m.swim) {
      const sl = m.swim.laps[idx]!;
      lap.isRest = sl.isRest;
      lap.lengths = sl.lengths;
      lap.stroke = sl.stroke;
      lap.distanceM = sl.distM;
      if (!sl.isRest) {
        const lens = m.swim.lengths.filter((l) => l.start >= sl.start - 1e-6 && l.start < sl.start + sl.dur - 1e-6);
        const sw = lens.filter((l) => l.strokes > 0);
        if (sw.length) lap.swolf = Math.round(sw.reduce((acc, l) => acc + Math.round(l.dur) + l.strokes, 0) / sw.length);
        const mv = lens.reduce((acc, l) => acc + l.dur, 0);
        lap.movingSec = Math.round(mv);
        lap.avgSpeedMps = round(sl.distM / mv, 3);
      } else {
        lap.movingSec = 0;
        delete lap.avgSpeedMps;
      }
    }
    laps.push(lap);
  });
  return laps;
}
