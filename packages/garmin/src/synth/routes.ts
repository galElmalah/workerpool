/**
 * Route geometry around real-looking anchors near Girona. Routes are smooth Catmull-Rom curves
 * in a local east/north metre frame, scaled to an exact length, then mapped to lat/lng.
 *
 * A course maps travelled distance d → course position p:
 *   loop     p = d mod L
 *   outback  p = triangle wave over [0, L] (out to the turnaround, back home on the same road)
 *   oval     400 m athletics track (lane 1)
 */
import type { Rng } from './prng';
import { makeTerrain, type Terrain, type TerrainOpts } from './terrain';
import { upperIndex } from './util';

export interface LatLng {
  lat: number;
  lng: number;
}

export const PLACES = {
  home: { lat: 41.9794, lng: 2.8214, alt: 76 },
  track: { lat: 41.9668, lng: 2.8302, alt: 70 },
  devesa: { lat: 41.9862, lng: 2.8141, alt: 68 }, // riverside park
  banyolesLake: { lat: 42.1238, lng: 2.7598, alt: 173 },
  platjaDaro: { lat: 41.8165, lng: 3.0679, alt: 4 },
  nuria: { lat: 42.3972, lng: 2.1536, alt: 1967 },
  gavarres: { lat: 41.9545, lng: 2.8577, alt: 120 },
  lisbonHotel: { lat: 38.7223, lng: -9.1393, alt: 60 },
} as const;

interface Path {
  origin: LatLng;
  xs: Float64Array;
  ys: Float64Array;
  cum: Float64Array;
  len: number;
}

export interface Course {
  mode: 'loop' | 'outback' | 'oval';
  L: number;
  path?: Path;
  oval?: { origin: LatLng; heading: number };
  terrain: Terrain;
  /** Altitude offset applied to the terrain base (already in terrain.base). */
}

const M_PER_DEG = 111_320;

function catmull(pts: [number, number][], closed: boolean, per = 10): [number, number][] {
  const n = pts.length;
  const out: [number, number][] = [];
  const get = (i: number) => (closed ? pts[((i % n) + n) % n]! : pts[Math.max(0, Math.min(n - 1, i))]!);
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    for (let j = 0; j < per; j++) {
      const t = j / per;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(closed ? out[0]! : pts[n - 1]!);
  return out;
}

function makePath(origin: LatLng, pts: [number, number][], closed: boolean, targetLen: number): Path {
  const sm = catmull(pts, closed, 12);
  let len = 0;
  for (let i = 1; i < sm.length; i++) len += Math.hypot(sm[i]![0] - sm[i - 1]![0], sm[i]![1] - sm[i - 1]![1]);
  const s = len > 0 ? targetLen / len : 1;
  const xs = new Float64Array(sm.length);
  const ys = new Float64Array(sm.length);
  const cum = new Float64Array(sm.length);
  for (let i = 0; i < sm.length; i++) {
    xs[i] = (sm[i]![0] - sm[0]![0]) * s;
    ys[i] = (sm[i]![1] - sm[0]![1]) * s;
    if (i > 0) cum[i] = cum[i - 1]! + Math.hypot(xs[i]! - xs[i - 1]!, ys[i]! - ys[i - 1]!);
  }
  return { origin, xs, ys, cum, len: cum[cum.length - 1]! };
}

/** Closed loop starting/ending at origin, heading roughly `heading` (radians, 0 = east, CCW). */
function loopPoints(rng: Rng, heading: number, wobble = 0.28): [number, number][] {
  const m = 7;
  const R = 1000;
  const cx = R * Math.cos(heading);
  const cy = R * Math.sin(heading);
  const pts: [number, number][] = [];
  const dir = rng.chance(0.5) ? 1 : -1;
  for (let i = 0; i < m; i++) {
    const ang = heading + Math.PI + dir * ((2 * Math.PI * i) / m);
    const r = i === 0 ? R : R * (1 + rng.range(-wobble, wobble));
    pts.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang)]);
  }
  return pts;
}

/** Open wandering path from origin. */
function outPoints(rng: Rng, heading: number, wander = 0.35): [number, number][] {
  const pts: [number, number][] = [[0, 0]];
  let x = 0;
  let y = 0;
  let h = heading;
  for (let i = 0; i < 8; i++) {
    h = heading + rng.range(-wander, wander);
    x += 1000 * Math.cos(h);
    y += 1000 * Math.sin(h);
    pts.push([x, y]);
  }
  return pts;
}

export interface CourseOpts {
  kind: 'loop' | 'outback' | 'oval' | 'triangle';
  origin: LatLng & { alt: number };
  /** Total distance the athlete expects to cover. */
  distM: number;
  heading?: number;
  /** Total ascent over the whole activity distance. */
  gain: number;
  climb?: { len: number; gain: number };
  laps?: number;
}

export function makeCourse(rng: Rng, o: CourseOpts): Course {
  const heading = o.heading ?? rng.range(0, 2 * Math.PI);
  if (o.kind === 'oval') {
    return {
      mode: 'oval',
      L: 400,
      oval: { origin: o.origin, heading },
      terrain: makeTerrain(rng, { L: 400, periodic: true, base: o.origin.alt, gain: 0 }),
    };
  }
  if (o.kind === 'outback') {
    const L = Math.max(500, o.distM / 2);
    const path = makePath(o.origin, outPoints(rng, heading), false, L);
    const t: TerrainOpts = { L, periodic: false, base: o.origin.alt, gain: o.gain / 2 };
    if (o.climb) t.climb = { len: Math.min(o.climb.len, L * 0.8), gain: o.climb.gain };
    return { mode: 'outback', L, path, terrain: makeTerrain(rng, t) };
  }
  const laps = o.laps ?? 1;
  const L = Math.max(300, o.distM / laps);
  const pts = o.kind === 'triangle' ? trianglePoints(rng, heading) : loopPoints(rng, heading);
  const path = makePath(o.origin, pts, true, L);
  return { mode: 'loop', L, path, terrain: makeTerrain(rng, { L, periodic: true, base: o.origin.alt, gain: o.gain / laps }) };
}

function trianglePoints(rng: Rng, heading: number): [number, number][] {
  const s = 300;
  const pts: [number, number][] = [[0, 0]];
  for (let i = 1; i <= 3; i++) {
    const a = heading + ((i - 1) * 2 * Math.PI) / 3 + rng.range(-0.15, 0.15);
    const prev = pts[i - 1]!;
    if (i < 3) pts.push([prev[0] + s * Math.cos(a), prev[1] + s * Math.sin(a)]);
  }
  // add slack midpoints so the swimmer's line bows a little
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    out.push(a, [(a[0] + b[0]) / 2 + rng.range(-12, 12), (a[1] + b[1]) / 2 + rng.range(-12, 12)]);
  }
  return out;
}

/** Map travelled distance to course position p and travel direction along the course (+1/−1). */
export function courseP(c: Course, d: number, out: { p: number; dir: number } = { p: 0, dir: 1 }): { p: number; dir: number } {
  if (c.mode === 'outback') {
    const m = d % (2 * c.L);
    if (m <= c.L) {
      out.p = m;
      out.dir = 1;
    } else {
      out.p = 2 * c.L - m;
      out.dir = -1;
    }
    return out;
  }
  out.p = d % c.L;
  out.dir = 1;
  return out;
}

const OVAL_STRAIGHT = 84.39;
const OVAL_R = 36.8;

export function coursePos(c: Course, p: number, out: LatLng): void {
  let x: number;
  let y: number;
  let origin: LatLng;
  if (c.mode === 'oval') {
    const o = c.oval!;
    origin = o.origin;
    const half = OVAL_STRAIGHT / 2;
    let u = p % 400;
    let lx: number;
    let ly: number;
    const arc = Math.PI * OVAL_R;
    if (u < OVAL_STRAIGHT) {
      lx = -half + u;
      ly = -OVAL_R;
    } else if ((u -= OVAL_STRAIGHT) < arc) {
      const a = -Math.PI / 2 + u / OVAL_R;
      lx = half + OVAL_R * Math.cos(a);
      ly = OVAL_R * Math.sin(a);
    } else if ((u -= arc) < OVAL_STRAIGHT) {
      lx = half - u;
      ly = OVAL_R;
    } else {
      u -= OVAL_STRAIGHT;
      const a = Math.PI / 2 + u / OVAL_R;
      lx = -half + OVAL_R * Math.cos(a);
      ly = OVAL_R * Math.sin(a);
    }
    const ch = Math.cos(o.heading);
    const sh = Math.sin(o.heading);
    x = lx * ch - ly * sh;
    y = lx * sh + ly * ch;
  } else {
    const pa = c.path!;
    origin = pa.origin;
    const i = Math.max(0, Math.min(pa.cum.length - 2, upperIndex(pa.cum, p)));
    const seg = pa.cum[i + 1]! - pa.cum[i]!;
    const f = seg > 0 ? (p - pa.cum[i]!) / seg : 0;
    x = pa.xs[i]! + (pa.xs[i + 1]! - pa.xs[i]!) * f;
    y = pa.ys[i]! + (pa.ys[i + 1]! - pa.ys[i]!) * f;
  }
  out.lat = origin.lat + y / M_PER_DEG;
  out.lng = origin.lng + x / (M_PER_DEG * Math.cos((origin.lat * Math.PI) / 180));
}

export const metersPerDegLat = M_PER_DEG;
