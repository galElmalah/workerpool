/**
 * Activity summary from the coarse grid. Sums use the closed form of the 1 Hz interpolation so
 * averages equal what the rendered streams give (noise is zero-sum per 5 s block); maxima are
 * evaluated exactly on the few candidate blocks.
 */
import type { Thr } from './internal';
import type { Model } from './model';
import { blockLen, blockValues, noiseFor } from './channels';
import { xFromHr } from './physio';
import { DT, type Base } from './simulate';
import { clamp, round } from './util';

export interface Summary {
  durationSec: number;
  movingSec: number;
  recordedSec: number;
  distanceM?: number;
  elevationGainM?: number;
  avgHr?: number;
  maxHr?: number;
  avgPower?: number;
  normPower?: number;
  maxPower?: number;
  avgSpeedMps?: number;
  avgCadence?: number;
  calories: number;
  aerobicEffect: number;
  anaerobicEffect: number;
  poolLengthM?: number;
  strokes?: number;
  avgSwolf?: number;
  totalSets?: number;
  totalReps?: number;
  /** Internal load estimate (TSS-scaled). */
  load: number;
  intensityFactor?: number;
  secAboveThreshold: number;
}

/** Σ of interpolated values over block k (no noise); closed form 3a + 2b for full blocks. */
function blockSum(c: Float64Array, base: Base, k: number, m: number): number {
  const a = c[k]!;
  const b = k + 1 < base.n ? c[k + 1]! : a;
  return m === DT ? 3 * a + 2 * b : m * a + ((b - a) * ((m * (m - 1)) / 2)) / DT;
}

function exactMax(c: Float64Array, base: Base, m: Model, ch: 'hr' | 'power'): number {
  const nz = noiseFor(m, ch);
  const n = base.n;
  const rec = base.rec;
  // candidate blocks: endpoints close enough to the grid maximum that noise could win
  let M = 0;
  for (let k = 0; k < n; k++) if (rec[k] && c[k]! > M) M = c[k]!;
  const lim = nz.mul ? M / (1 + 5 * nz.sd) : M - 5 * nz.sd;
  const out = new Float64Array(5);
  let best = 0;
  for (let k = 0; k < n; k++) {
    if (!rec[k] || (c[k]! < lim && (k + 1 >= n || c[k + 1]! < lim))) continue;
    const cnt = blockValues(c, base, k, nz, out);
    for (let j = 0; j < cnt; j++) {
      const v = Math.round(Math.max(0, out[j]!));
      if (v > best) best = v;
    }
  }
  return best;
}

export function summarize(m: Model, b: Base, thr: Thr): Summary {
  let recorded = 0;
  let hrSum = 0;
  let pSum = 0;
  let cadSum = 0;
  let cadN = 0;
  let movingSec = 0;
  let above = 0;
  const blockMeans: number[] = [];
  for (let k = 0; k < b.n; k++) {
    const len = k * DT + DT <= b.dur ? DT : blockLen(b, k);
    if (!b.rec[k] || len === 0) continue;
    recorded += len;
    hrSum += blockSum(b.hr, b, k, len);
    if (b.power) {
      const s = blockSum(b.power, b, k, len);
      pSum += s;
      blockMeans.push(s / len);
      const a = b.power[k]!;
      const bb = k + 1 < b.n ? b.power[k + 1]! : a;
      if (m.family === 'bike' ? (a + bb) / 2 > 1.04 * thr.ftp : (a + bb) / 2 > 1.04 * thr.rowW) above += len;
    }
    if (b.cad) {
      const a = b.cad[k]!;
      const bb = k + 1 < b.n ? b.cad[k + 1]! : a;
      if (a > 0 && bb > 0) {
        cadSum += blockSum(b.cad, b, k, len);
        cadN += len;
      }
    }
    if (b.speed && m.family !== 'row') {
      const a = b.speed[k]!;
      const bb = k + 1 < b.n ? b.speed[k + 1]! : a;
      if (a >= 0.5 && bb >= 0.5) movingSec += len;
      else if (a >= 0.5 || bb >= 0.5) for (let j = 0; j < len; j++) if (a + ((bb - a) * j) / DT >= 0.5) movingSec++;
      if (m.family === 'run' && (a + bb) / 2 > 1.02 * thr.runMps) above += len;
    } else if (b.power) {
      const a = b.power[k]!;
      const bb = k + 1 < b.n ? b.power[k + 1]! : a;
      for (let j = 0; j < len; j++) if (a + ((bb - a) * j) / DT > 0) movingSec++;
    }
  }
  if (!b.speed && !b.power) movingSec = recorded;

  const s: Summary = {
    durationSec: m.dur,
    movingSec,
    recordedSec: recorded,
    calories: 0,
    aerobicEffect: 0,
    anaerobicEffect: 0,
    load: 0,
    secAboveThreshold: above,
  };
  s.avgHr = Math.round(hrSum / recorded);
  s.maxHr = exactMax(b.hr, b, m, 'hr');

  if (b.power) {
    s.avgPower = Math.round(pSum / recorded);
    s.maxPower = exactMax(b.power, b, m, 'power');
    // NP from 5 s block means, 30 s rolling window = 6 blocks
    if (blockMeans.length >= 6) {
      let w = 0;
      for (let i = 0; i < 6; i++) w += blockMeans[i]!;
      let q = (w / 6) * (w / 6);
      let acc = q * q;
      let c = 1;
      for (let i = 6; i < blockMeans.length; i++) {
        w += blockMeans[i]! - blockMeans[i - 6]!;
        q = (w / 6) * (w / 6);
        acc += q * q;
        c++;
      }
      s.normPower = Math.round((acc / c) ** 0.25);
    } else s.normPower = s.avgPower;
  }
  if (b.dist) {
    const t = m.dur - 1;
    const k = Math.floor(t / DT);
    const j = t - k * DT;
    const a = b.dist[k]!;
    const bb = k + 1 < b.n ? b.dist[k + 1]! : a;
    s.distanceM = round(a + ((bb - a) * j) / DT, 1);
    s.avgSpeedMps = movingSec > 0 ? round(s.distanceM / movingSec, 3) : 0;
  }
  if (b.alt) {
    let up = 0;
    for (let k = 1; k < b.n; k++) {
      const dlt = b.alt[k]! - b.alt[k - 1]!;
      if (dlt > 0) up += dlt;
    }
    s.elevationGainM = Math.round(up);
  }
  if (cadN > 0) s.avgCadence = Math.round(cadSum / cadN);

  // pool swim from the length model
  if (m.swim) {
    const L = m.swim.poolLengthM;
    let dist = 0;
    let mov = 0;
    let strokes = 0;
    let swolfSum = 0;
    let swolfN = 0;
    let strokeTime = 0;
    for (const len of m.swim.lengths) {
      dist += L;
      mov += len.dur;
      strokes += len.strokes;
      if (len.strokes > 0) {
        swolfSum += Math.round(len.dur) + len.strokes;
        swolfN++;
        strokeTime += len.dur;
      }
    }
    s.distanceM = dist;
    s.movingSec = Math.round(mov);
    s.avgSpeedMps = round(dist / mov, 3);
    s.poolLengthM = L;
    s.strokes = strokes;
    if (swolfN) s.avgSwolf = Math.round(swolfSum / swolfN);
    if (strokeTime > 0) s.avgCadence = Math.round((strokes / strokeTime) * 60);
  }
  if (m.strength) {
    const active = m.strength.items.filter((i) => !i.isRest && i.reps !== undefined);
    const work = m.strength.items.filter((i) => !i.isRest && i.category !== 'WARM_UP');
    s.totalSets = work.length;
    s.totalReps = active.reduce((a, i) => a + (i.reps ?? 0), 0);
  }

  // load / intensity / energy
  const hMov = Math.max(1, s.movingSec) / 3600;
  let IF = 0;
  switch (m.family) {
    case 'bike':
      IF = (s.normPower ?? 0) / thr.ftp;
      break;
    case 'row':
      IF = (s.normPower ?? 0) / thr.rowW;
      break;
    case 'run':
      IF = ((s.avgSpeedMps ?? 0) / thr.runMps) * 1.02;
      break;
    case 'swim_pool':
    case 'swim_ow':
      IF = (s.avgSpeedMps ?? 0) / thr.cssMps / (m.family === 'swim_ow' ? 0.97 : 1);
      break;
    default:
      IF = Math.max(0.3, xFromHr(s.avgHr ?? thr.hrRest, thr)) * 0.9;
  }
  s.intensityFactor = round(IF, 3);
  s.load =
    m.family === 'strength'
      ? hMov * 60
      : m.family === 'yoga'
        ? hMov * 20
        : m.family === 'swim_pool' || m.family === 'swim_ow'
          ? 100 * hMov * IF ** 3
          : 100 * hMov * IF * IF;
  const w = thr.weightKg;
  switch (m.family) {
    case 'bike':
    case 'row':
      s.calories = Math.round(((s.avgPower ?? 0) * s.recordedSec) / 1000 * (m.family === 'row' ? 1.1 : 1.0) + 40);
      break;
    case 'run':
      s.calories = Math.round(((s.distanceM ?? 0) / 1000) * w * 1.02 + 15);
      break;
    case 'swim_pool':
    case 'swim_ow':
      s.calories = Math.round((s.movingSec / 60) * 9.5 * IF + 30);
      break;
    case 'walk':
      s.calories = Math.round((s.recordedSec / 60) * 4.6);
      break;
    case 'hike':
      s.calories = Math.round((s.recordedSec / 60) * 6.8 + (s.elevationGainM ?? 0) * 0.35);
      break;
    case 'strength':
      s.calories = Math.round((s.recordedSec / 60) * 5.8);
      break;
    case 'yoga':
      s.calories = Math.round((s.recordedSec / 60) * 3.3);
      break;
  }
  s.aerobicEffect = round(clamp(0.6 + 4.3 * (1 - Math.exp(-s.load / 95)) * clamp(IF + 0.25, 0.6, 1.05), 0, 5), 1);
  s.anaerobicEffect = round(clamp(above > 0 ? 0.6 + 2.6 * (1 - Math.exp(-above / 600)) : IF > 0.8 ? 0.4 : 0.0, 0, 4.6), 1);
  return s;
}
