/**
 * The "everything else" a Garmin watch reports for the synthetic athlete: place names, start/end
 * position, elevation range and descent, temperature, maxima, running dynamics (HRM-Pro), pedal
 * power balance (dual-sided pedals), Garmin training load and primary benefit.
 *
 * Kept separate from the summary/stream generators and driven by its own PRNG keys, so adding
 * these fields does not change any value the generator produced before.
 */
import type { Model } from './model';
import { CH, noiseKey, tri } from './noise';
import { rngFor } from './prng';
import { courseP, coursePos, PLACES, type LatLng } from './routes';
import type { Base } from './simulate';
import type { Summary } from './summary';
import type { SynthActivity } from './types';
import { clamp, round } from './util';

/** Garmin Connect-style place names for the course origins (reverse-geocoded town names). */
const PLACE_NAMES: Array<[LatLng, string]> = [
  [PLACES.home, 'Girona'],
  [PLACES.track, 'Girona'],
  [PLACES.devesa, 'Girona'],
  [PLACES.banyolesLake, 'Banyoles'],
  [PLACES.platjaDaro, "Castell-Platja d'Aro"],
  [PLACES.nuria, 'Queralbs'],
  [PLACES.gavarres, 'Quart'],
  [PLACES.lisbonHotel, 'Lisboa'],
];

/** Place name of an outdoor model's course; none indoors / without GPS. */
export function locationOf(m: Model): string | undefined {
  if (!m.hasGps || !m.course) return undefined;
  const o = m.course.path?.origin ?? m.course.oval?.origin;
  if (!o) return undefined;
  for (const [p, name] of PLACE_NAMES) if (Math.abs(p.lat - o.lat) < 1e-4 && Math.abs(p.lng - o.lng) < 1e-4) return name;
  return undefined;
}

/** Athlete-constant running dynamics at speed v (m/s): ground contact (ms), vertical oscillation (cm). */
export function gctAt(v: number): number {
  return clamp(252 - 34 * (v - 3.3), 185, 330);
}
export function voAt(v: number): number {
  return clamp(8.7 + 0.32 * (v - 3.3), 6.5, 11.5);
}
/** Slight left-side bias (the athlete's calf story). */
export const GCT_BALANCE_LEFT = 49.4;

export type ExtraFields = Pick<
  SynthActivity,
  | 'locationName'
  | 'startLat'
  | 'startLng'
  | 'endLat'
  | 'endLng'
  | 'elevationLossM'
  | 'minElevationM'
  | 'maxElevationM'
  | 'maxSpeedMps'
  | 'avgTempC'
  | 'minTempC'
  | 'maxTempC'
  | 'maxCadence'
  | 'avgGroundContactMs'
  | 'avgGroundContactBalancePct'
  | 'avgVerticalOscillationCm'
  | 'avgVerticalRatioPct'
  | 'avgStrideLengthM'
  | 'steps'
  | 'powerBalanceLeftPct'
  | 'deviceLoad'
  | 'trainingEffectLabel'
>;

function label(m: Model, s: Summary): string | undefined {
  const f = m.family;
  if (f === 'strength' || f === 'yoga') return undefined;
  if (s.aerobicEffect < 1) return 'RECOVERY';
  if (s.anaerobicEffect >= 2.8) return 'ANAEROBIC_CAPACITY';
  switch (m.intensity) {
    case 'recovery':
      return 'RECOVERY';
    case 'endurance':
      return 'BASE';
    case 'tempo':
      return 'TEMPO';
    case 'threshold':
      return 'LACTATE_THRESHOLD';
    case 'high':
      return 'VO2MAX';
    case 'race':
      return s.anaerobicEffect >= 2 ? 'VO2MAX' : 'LACTATE_THRESHOLD';
    default:
      return 'BASE';
  }
}

/** Summary-level extras from the coarse grid (cheap; runs once per activity in the season pass). */
export function summaryExtras(m: Model, b: Base, s: Summary): ExtraFields {
  const out: ExtraFields = {};
  const rng = rngFor(m.seed, 'extras', m.header.id);
  const rec = b.rec;
  const n = b.n;
  out.locationName = locationOf(m);
  if (m.course && m.hasGps) {
    const pos: LatLng = { lat: 0, lng: 0 };
    const cp = { p: 0, dir: 1 };
    coursePos(m.course, courseP(m.course, 0, cp).p, pos);
    out.startLat = round(pos.lat, 6);
    out.startLng = round(pos.lng, 6);
    coursePos(m.course, courseP(m.course, Math.max(0, (s.distanceM ?? 0) - 1), cp).p, pos);
    out.endLat = round(pos.lat, 6);
    out.endLng = round(pos.lng, 6);
  }
  if (b.alt) {
    let lo = Infinity;
    let hi = -Infinity;
    let down = 0;
    for (let k = 0; k < n; k++) {
      const v = b.alt[k]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      if (k > 0 && v < b.alt[k - 1]!) down += b.alt[k - 1]! - v;
    }
    if (Number.isFinite(lo)) {
      out.minElevationM = round(lo, 1);
      out.maxElevationM = round(hi, 1);
      out.elevationLossM = Math.round(down);
    }
  }
  if (m.family !== 'strength' && m.family !== 'yoga') {
    let lo = Infinity;
    let hi = -Infinity;
    let sum = 0;
    let c = 0;
    for (let k = 0; k < n; k++) {
      if (!rec[k]) continue;
      const v = b.temp[k]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      sum += v;
      c++;
    }
    if (c) {
      out.avgTempC = Math.round(sum / c);
      out.minTempC = Math.round(lo);
      out.maxTempC = Math.round(hi);
    }
  }
  if (b.speed && !m.swim) {
    let hi = 0;
    for (let k = 0; k < n; k++) if (rec[k] && b.speed[k]! > hi) hi = b.speed[k]!;
    if (hi > 0) out.maxSpeedMps = round(hi * (1 + rng.range(0.02, 0.05)), 3); // 1 Hz peaks sit above the 5 s grid
  }
  if (b.cad) {
    let hi = 0;
    for (let k = 0; k < n; k++) if (rec[k] && b.cad[k]! > hi) hi = b.cad[k]!;
    if (hi > 0) out.maxCadence = Math.round(hi + rng.range(1, 4));
  }
  if (m.family === 'run' && s.avgSpeedMps && s.avgCadence) {
    const v = s.avgSpeedMps;
    const step = (v * 60) / s.avgCadence;
    out.avgStrideLengthM = round(step, 2);
    out.avgGroundContactMs = Math.round(gctAt(v));
    out.avgGroundContactBalancePct = round(GCT_BALANCE_LEFT + rng.range(-0.4, 0.4), 1);
    out.avgVerticalOscillationCm = round(voAt(v), 1);
    out.avgVerticalRatioPct = round((voAt(v) / (step * 100)) * 100, 1);
  }
  if ((m.family === 'run' || m.family === 'walk' || m.family === 'hike') && s.avgCadence) out.steps = Math.round((s.avgCadence * s.movingSec) / 60);
  if (m.family === 'bike' && !m.indoor && b.power) out.powerBalanceLeftPct = round(49.1 + rng.range(-0.6, 0.6), 1);
  if (s.load > 0) out.deviceLoad = Math.round(s.load * (m.family === 'strength' ? 0.85 : 1.12) * rng.range(0.92, 1.08));
  out.trainingEffectLabel = label(m, s);
  return out;
}

/** Per-second running dynamics aligned with the rendered streams (null when not running). */
export interface Dynamics {
  gct: (number | null)[];
  vo: (number | null)[];
  vr: (number | null)[];
  step: (number | null)[];
}

export function renderDynamics(m: Model, t: readonly number[], speed: ReadonlyArray<number | null> | undefined, cad: ReadonlyArray<number | null> | undefined): Dynamics | undefined {
  if (m.family !== 'run' || !speed || !cad) return undefined;
  const kg = noiseKey(m.seed, m.header.id, CH.temp + 11);
  const kv = noiseKey(m.seed, m.header.id, CH.temp + 12);
  const N = t.length;
  const out: Dynamics = { gct: new Array(N), vo: new Array(N), vr: new Array(N), step: new Array(N) };
  for (let i = 0; i < N; i++) {
    const v = speed[i];
    const c = cad[i];
    if (v == null || c == null || v < 1.2 || c < 100) {
      out.gct[i] = out.vo[i] = out.vr[i] = out.step[i] = null;
      continue;
    }
    const step = (v * 60) / c;
    const vo = voAt(v) + tri(kv, t[i]!) * 0.35;
    out.gct[i] = Math.round(gctAt(v) + tri(kg, t[i]!) * 9);
    out.vo[i] = round(vo, 1);
    out.step[i] = round(step, 2);
    out.vr[i] = round((vo / (step * 100)) * 100, 1);
  }
  return out;
}
