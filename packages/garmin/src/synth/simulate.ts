/**
 * Coarse simulation (5 s grid) of an activity model: power, HR (first-order kinetics + cardiac
 * drift + slow component), cadence, speed (cycling physics / grade-adjusted running), distance,
 * altitude. Everything with a time-scale ≥ 5 s lives here; the 1 Hz renderer only interpolates
 * and adds zero-mean high-frequency noise, so summaries computed from this grid match streams.
 */
import type { Thr } from './internal';
import type { Model } from './model';
import { bikeSpeed, minettiFactor, runCadence, SPORT_HR_OFFSET, steadyHr, toblerSpeed } from './physio';
import { rngFor } from './prng';
import { courseP } from './routes';
import { altGrade } from './terrain';
import { clamp, rowSpeedFromPower } from './util';

/** Fine grid step (s); steady activities use a 10 s grid (see chooseDt). */
export const DT = 5;

export interface Base {
  /** Grid step in seconds (5 or 10). */
  dt: number;
  /** Number of grid samples (τ_k = dt·k, k = 0..n−1). */
  n: number;
  dur: number;
  rec: Uint8Array;
  hr: Float64Array;
  temp: Float64Array;
  power?: Float64Array;
  cad?: Float64Array;
  speed?: Float64Array;
  dist?: Float64Array;
  alt?: Float64Array;
  grade?: Float64Array;
}

export function gridSize(dur: number, dt: number = DT): number {
  return Math.max(2, Math.ceil((dur - 1) / dt) + 1);
}

/**
 * 10 s grid when nothing in the activity is shorter than 30 s and every auto-pause boundary
 * falls on the 10 s grid (they are generated that way); otherwise 5 s.
 */
export function chooseDt(m: Model): number {
  const segs = m.segs;
  for (let i = 0; i < segs.length; i++) {
    const g = segs[i]!;
    if (g.kind === 'pause' && (g.start % 10 !== 0 || g.dur % 10 !== 0)) return DT;
    if (i < segs.length - 1 && g.dur < 30) return DT;
  }
  return 10;
}

/** Reusable scratch buffers so the summary pass over a whole season allocates almost nothing. */
export class BasePool {
  private bufs = new Map<string, Float64Array>();
  private recBuf = new Uint8Array(0);
  f64(name: string, n: number): Float64Array {
    let b = this.bufs.get(name);
    if (!b || b.length < n) {
      b = new Float64Array(Math.max(n, 2048));
      this.bufs.set(name, b);
    }
    return b.subarray(0, n);
  }
  rec(n: number): Uint8Array {
    if (this.recBuf.length < n) this.recBuf = new Uint8Array(Math.max(n, 2048));
    return this.recBuf.subarray(0, n);
  }
}

export function simulate(m: Model, thr: Thr, hrOffset: number, pool?: BasePool): Base {
  const DT = chooseDt(m);
  const n = gridSize(m.dur, DT);
  const f64 = (name: string) => (pool ? pool.f64(name, n) : new Float64Array(n));
  const rng = rngFor(m.seed, 'sim', m.header.id);
  const fam = m.family;
  const hasPower = fam === 'bike' || fam === 'row';
  const moving = fam === 'bike' || fam === 'run' || fam === 'swim_ow' || fam === 'row' || fam === 'walk' || fam === 'hike';
  const b: Base = {
    dt: DT,
    n,
    dur: m.dur,
    rec: pool ? pool.rec(n) : new Uint8Array(n),
    hr: f64('hr'),
    temp: f64('temp'),
  };
  if (hasPower) b.power = f64('power');
  if (moving) {
    b.speed = f64('speed');
    b.dist = f64('dist');
    b.cad = f64('cad');
  }
  const course = m.course;
  if (course) {
    b.alt = f64('alt');
    b.grade = f64('grade');
  }
  const hrP = { hrRest: thr.hrRest, lthr: thr.lthr, hrMax: thr.hrMax };
  const sportOff = (SPORT_HR_OFFSET[fam] ?? 0) + hrOffset;
  const outdoorTemp = !m.indoor;
  const heat = outdoorTemp ? Math.max(0, m.tempC - 20) : fam === 'bike' || fam === 'row' ? 3 : 0;
  const driftRate = 0.0042 * (1 + heat / 10);

  const ouPhi = Math.exp(-DT / 25);
  const ouSd = fam === 'bike' ? (m.indoor ? 0.018 : 0.085) : fam === 'row' ? 0.025 : 0.02;
  const ouK = ouSd * Math.sqrt(1 - ouPhi * ouPhi);
  const aV = 1 - Math.exp(-DT / (fam === 'bike' ? 14 : 4));
  const tg = { alt: 0, grade: 0 };
  const cp = { p: 0, dir: 1 };
  const aUp = 1 - Math.exp(-DT / 24);
  const aDown = 1 - Math.exp(-DT / 42);
  const aPause = 1 - Math.exp(-DT / 60);
  /** cheap approx. standard normal (Irwin–Hall, 3 uniforms) */
  const gauss = () => (rng.next() + rng.next() + rng.next() - 1.5) * 2;

  let hr = thr.hrRest + 24 + rng.range(0, 12);
  let drift = 0;
  let slow = 0;
  let v = 0;
  let d = 0;
  let ou = 0;
  let surge = 0;
  let surgeP = 0;
  let coast = 0;
  let si = 0;
  const segs = m.segs;
  // course state at current distance
  let grade = 0;
  if (course) {
    altGrade(course.terrain, 0, tg);
    grade = tg.grade;
  }

  for (let k = 0; k < n; k++) {
    const tau = k * DT;
    while (si < segs.length - 1 && tau >= segs[si]!.start + segs[si]!.dur) si++;
    const seg = segs[si]!;
    const f = seg.dur > 0 ? clamp((tau - seg.start) / seg.dur, 0, 1) : 0;
    const x = seg.x0 + (seg.x1 - seg.x0) * f;
    const paused = seg.kind === 'pause';
    const still = paused || seg.kind === 'stop' || seg.kind === 'rest';
    b.rec[k] = paused ? 0 : 1;
    let xe = 0;
    let P = 0;
    let cad = 0;
    let vNew = 0;
    ou = ou * ouPhi + ouK * gauss();

    switch (fam) {
      case 'bike': {
        if (!still) {
          const pT = x * thr.ftp;
          if (m.indoor) {
            P = pT * (1 + ou);
          } else {
            const g = grade;
            let gm: number;
            if (seg.role === 'active' && x > 0.85) gm = 1 + clamp(2 * g, -0.1, 0.12);
            else gm = g > 0 ? Math.min(1.55, 1 + 5.5 * g) : g < -0.015 ? Math.max(0, 1 + 16 * (g + 0.015)) : 1;
            P = pT * gm * (1 + ou);
            // coasting on proper descents, decided per 400 m stretch so it is persistent
            if (g < -0.035 && ((Math.floor(d / 400) * 2654435761) >>> 0) % 10 < 7) P = 0;
            // occasional surges: town sign sprints, roundabouts, short kickers
            // freewheeling through corners, junctions and short dips
            if (coast > 0) {
              coast--;
              P = 0;
            } else if ((seg.role !== 'active' || x < 0.85) && rng.chance((g < -0.01 ? 0.15 : 0.032) * (DT / 5))) coast = DT === 5 ? rng.int(1, 2) : 1;
            if (surge > 0) {
              surge--;
              P = Math.max(P, surgeP);
            } else if (seg.role !== 'active' || x < 0.85) {
              if (rng.chance(0.003 * (DT / 5))) {
                surge = DT === 5 ? rng.int(1, 2) : 1;
                surgeP = thr.ftp * rng.range(1.25, 2.3);
              }
            }
          }
          if (P < 0) P = 0;
          const gEff = m.indoor ? 0 : grade;
          const vss = Math.min(16.5, bikeSpeed(P, gEff, m.bike, v || 8));
          vNew = v + (vss - v) * aV;
          if (vNew < 0.3 && P > 0) vNew = Math.min(vss, 1.5);
          const baseCad = seg.cad ?? 86 + 10 * (x - 0.65);
          cad = P > 0 ? clamp(baseCad - (m.indoor ? 0 : 22 * Math.max(0, grade)) + 3 * ou * 10, 55, 125) : 0;
        }
        xe = P / thr.ftp;
        break;
      }
      case 'run': {
        if (!still) {
          const g = m.header.subSport === 'treadmill' ? 0 : grade;
          const fM = minettiFactor(g);
          let vss = (x * thr.runMps) / Math.sqrt(fM * Math.sqrt(fM));
          if (m.header.subSport === 'trail') {
            vss *= 0.9;
            if (g > 0.12) vss = Math.min(vss, 1.35);
          }
          vNew = v + (vss - v) * aV;
          xe = (vNew * fM) / thr.runMps;
          cad = runCadence(vNew) + (m.header.subSport === 'trail' ? -4 : 0);
        }
        break;
      }
      case 'swim_ow': {
        if (!still) {
          const vss = x * thr.cssMps * 0.97 * (1 + 0.6 * ou);
          vNew = v + (vss - v) * aV;
          xe = vNew / (thr.cssMps * 0.97);
          cad = clamp(29 + 14 * (x - 0.9), 22, 40);
        }
        break;
      }
      case 'swim_pool':
      case 'strength':
      case 'yoga':
        xe = still ? Math.min(x, 0.12) : x;
        break;
      case 'row': {
        if (!still) {
          P = x * thr.rowW * (1 + ou);
          vNew = rowSpeedFromPower(P);
          cad = seg.spm ?? (x < 0.75 ? 19 : x < 0.95 ? 23 : 27);
        }
        xe = P / thr.rowW;
        break;
      }
      case 'walk':
      case 'hike': {
        if (!still) {
          const g = grade;
          const vss = fam === 'hike' ? (x * toblerSpeed(g)) / toblerSpeed(0) : x * (1 - 1.5 * Math.abs(g));
          vNew = v + (Math.max(0.4, vss) - v) * aV;
          xe = 0.12 * vNew + 2.6 * Math.max(0, g) * vNew + (fam === 'hike' ? 0.06 : 0.02);
          cad = clamp(96 + 11 * vNew - 40 * Math.abs(g), 70, 130);
        }
        break;
      }
    }

    // distance / course
    if (b.dist) {
      if (k > 0) d += (DT * (v + vNew)) / 2;
      v = vNew;
      b.speed![k] = vNew;
      b.dist[k] = d;
      b.cad![k] = cad;
      if (course) {
        courseP(course, d, cp);
        altGrade(course.terrain, cp.p, tg);
        grade = tg.grade * cp.dir;
        b.alt![k] = tg.alt;
        b.grade![k] = grade;
      }
    }
    if (b.power) b.power[k] = P;

    // heart rate
    if (paused) {
      hr += (thr.hrRest + 28 - hr) * aPause;
    } else {
      if (xe > 0.3) drift += DT * driftRate * (xe - 0.3);
      else drift -= (DT * drift) / 1800;
      slow += DT * 0.05 * Math.max(0, xe - 0.95) - (DT * slow) / 150;
      const target = steadyHr(xe, hrP, sportOff + Math.min(14, drift) + slow + 0.25 * heat);
      hr += (target - hr) * (target > hr ? aUp : aDown);
    }
    if (hr > thr.hrMax) hr = thr.hrMax;
    b.hr[k] = hr;

    // temperature (device): outdoor warms through the morning, indoor rooms warm up
    b.temp[k] = outdoorTemp
      ? m.family === 'swim_ow'
        ? m.tempC - 3
        : m.tempC + 1.5 + (tau / 3600) * 1.2
      : fam === 'swim_pool'
        ? 28
        : 22 + Math.min(3, tau / 1800);
  }
  return b;
}
