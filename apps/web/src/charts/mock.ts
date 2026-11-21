/**
 * Seeded mock data for the chart gallery (and for feature agents' stories/tests).
 * Deterministic: the same seed always produces the same athlete.
 */
import type { ActivityStreams, FitnessDay, FormZone, Lap, LocalDate, PeakPoint, Sport, SportTotals, WeekSummary, WellnessDay, ZoneTime } from '@cadence/core';
import { isoWeekOf } from '@cadence/core';
import { DAY_MS, addDaysLD, dateMs, msDate } from './format';

export const MOCK_TODAY: LocalDate = '2026-11-21';

export function rng(seed = 1) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () => {
    const u = Math.max(1e-9, next());
    const v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return { next, normal, range: (lo: number, hi: number) => lo + (hi - lo) * next() };
}

export function formZoneOf(form: number): FormZone {
  if (form > 25) return 'transition';
  if (form > 5) return 'fresh';
  if (form > -10) return 'neutral';
  if (form > -30) return 'productive';
  return 'overreaching';
}

interface Session {
  sport: Sport;
  sec: number;
  load: number;
  distanceM: number;
  key: boolean;
  bucket: 'easy' | 'moderate' | 'hard';
}
export interface MockDay {
  date: LocalDate;
  sessions: Session[];
  planned: Session[];
  projected: boolean;
}

/** Weekly template (Mon..Sun) of sessions; scaled by block progression. */
const TEMPLATE: Session[][] = [
  [],
  [{ sport: 'bike', sec: 5400, load: 95, distanceM: 48000, key: true, bucket: 'hard' }, { sport: 'strength', sec: 2400, load: 25, distanceM: 0, key: false, bucket: 'moderate' }],
  [{ sport: 'run', sec: 3000, load: 48, distanceM: 10000, key: false, bucket: 'easy' }, { sport: 'swim', sec: 2700, load: 35, distanceM: 2600, key: false, bucket: 'easy' }],
  [{ sport: 'bike', sec: 4500, load: 82, distanceM: 40000, key: true, bucket: 'hard' }],
  [{ sport: 'swim', sec: 2400, load: 30, distanceM: 2400, key: false, bucket: 'easy' }, { sport: 'strength', sec: 2100, load: 22, distanceM: 0, key: false, bucket: 'moderate' }],
  [{ sport: 'bike', sec: 12600, load: 190, distanceM: 98000, key: true, bucket: 'easy' }],
  [{ sport: 'run', sec: 5400, load: 92, distanceM: 17500, key: false, bucket: 'easy' }, { sport: 'other', sec: 1800, load: 6, distanceM: 0, key: false, bucket: 'easy' }],
];

/** Generates a year of sessions + a planned future (default 42 days). */
export function mockDays(seed = 7, today: LocalDate = MOCK_TODAY, back = 364, ahead = 42): MockDay[] {
  const r = rng(seed);
  const out: MockDay[] = [];
  const t0 = dateMs(today) - back * DAY_MS;
  const sickStart = 150 + Math.floor(r.next() * 20);
  for (let i = 0; i <= back + ahead; i++) {
    const ms = t0 + i * DAY_MS;
    const date = msDate(ms);
    const dow = (new Date(ms).getUTCDay() + 6) % 7;
    const week = Math.floor(i / 7);
    const blockPos = week % 4; // 3 build weeks + 1 recovery
    const season = 0.62 + 0.5 * Math.min(1, i / (back * 0.95));
    const scale = season * (blockPos === 3 ? 0.62 : 0.92 + blockPos * 0.08);
    const sick = i >= sickStart && i < sickStart + 9;
    const vacation = i >= 250 && i < 257;
    const projected = ms > dateMs(today);
    const planned = TEMPLATE[dow].map((s) => ({ ...s, sec: Math.round(s.sec * scale), load: Math.round(s.load * scale * (0.95 + r.next() * 0.1)), distanceM: Math.round(s.distanceM * scale) }));
    let sessions: Session[] = [];
    if (!projected && !sick) {
      sessions = planned
        .filter(() => r.next() > (vacation ? 0.65 : 0.07))
        .map((s) => {
          const f = 0.82 + r.next() * 0.33;
          return { ...s, sec: Math.round(s.sec * f), load: Math.round(s.load * f * (0.9 + r.next() * 0.2)), distanceM: Math.round(s.distanceM * f) };
        });
      if (vacation && r.next() > 0.5) sessions.push({ sport: 'hike', sec: 10800, load: 70, distanceM: 16000, key: false, bucket: 'easy' });
      if (!vacation && r.next() > 0.93) sessions.push({ sport: 'run', sec: 1800, load: 26, distanceM: 6000, key: false, bucket: 'easy' });
    }
    out.push({ date, sessions, planned: sick ? [] : planned, projected });
  }
  return out;
}

/** Fitness model (42/7-day EWMA) over mock days. */
export function mockFitness(days: MockDay[], today: LocalDate = MOCK_TODAY): FitnessDay[] {
  let fit = 38;
  let fat = 40;
  const fits: number[] = [];
  const res: FitnessDay[] = [];
  const kf = 1 - Math.exp(-1 / 42);
  const ka = 1 - Math.exp(-1 / 7);
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    const done = d.sessions.reduce((a, s) => a + s.load, 0);
    const plannedLoad = d.date >= today ? d.planned.reduce((a, s) => a + s.load, 0) : 0;
    const form = fit - fat; // yesterday's values
    const load = d.projected ? plannedLoad : done;
    fit += (load - fit) * kf;
    fat += (load - fat) * ka;
    fits.push(fit);
    res.push({
      date: d.date,
      load: d.projected ? 0 : done,
      plannedLoad: d.projected ? plannedLoad : d.date === today ? Math.max(0, plannedLoad - done) : 0,
      fitness: fit,
      fatigue: fat,
      form,
      formPct: fit > 0 ? form / fit : null,
      formZone: formZoneOf(form),
      ramp: i >= 7 ? fit - fits[i - 7] : null,
      projected: d.projected,
    });
  }
  return res;
}


/** Aggregates mock days into ISO-week summaries (last `n` weeks up to and including the current week). */
export function mockWeeks(days: MockDay[], fitness: FitnessDay[], n = 26, today: LocalDate = MOCK_TODAY, seed = 11): WeekSummary[] {
  const r = rng(seed);
  const byDate = new Map(days.map((d, i) => [d.date, { d, f: fitness[i] }]));
  const tMs = dateMs(today);
  const dow = (new Date(tMs).getUTCDay() + 6) % 7;
  const curMonday = tMs - dow * DAY_MS;
  const out: WeekSummary[] = [];
  for (let w = n - 1; w >= 0; w--) {
    const start = curMonday - w * 7 * DAY_MS;
    const sport = new Map<Sport, SportTotals>();
    const tot = { plannedSec: 0, doneSec: 0, plannedLoad: 0, doneLoad: 0, plannedDistanceM: 0, doneDistanceM: 0, keyPlanned: 0, keyDone: 0 };
    const intensity = { easy: 0, moderate: 0, hard: 0 };
    const daily: number[] = [];
    let remainingSec = 0;
    let remainingLoad = 0;
    for (let k = 0; k < 7; k++) {
      const date = msDate(start + k * DAY_MS);
      const e = byDate.get(date);
      if (!e) {
        daily.push(0);
        continue;
      }
      const st = (s: Sport) => {
        let v = sport.get(s);
        if (!v) {
          v = { sport: s, plannedSec: 0, doneSec: 0, plannedLoad: 0, doneLoad: 0, plannedDistanceM: 0, doneDistanceM: 0, plannedCount: 0, doneCount: 0, elevationGainM: 0 };
          sport.set(s, v);
        }
        return v;
      };
      for (const p of e.d.planned) {
        const v = st(p.sport);
        v.plannedSec += p.sec;
        v.plannedLoad += p.load;
        v.plannedDistanceM += p.distanceM;
        v.plannedCount++;
        tot.plannedSec += p.sec;
        tot.plannedLoad += p.load;
        tot.plannedDistanceM += p.distanceM;
        if (p.key) tot.keyPlanned++;
        if (date > today) {
          remainingSec += p.sec;
          remainingLoad += p.load;
        }
      }
      let dl = 0;
      for (const s of e.d.sessions) {
        const v = st(s.sport);
        v.doneSec += s.sec;
        v.doneLoad += s.load;
        v.doneDistanceM += s.distanceM;
        v.doneCount++;
        v.elevationGainM += s.sport === 'bike' ? s.distanceM * 0.009 : s.sport === 'run' || s.sport === 'hike' ? s.distanceM * 0.012 : 0;
        tot.doneSec += s.sec;
        tot.doneLoad += s.load;
        tot.doneDistanceM += s.distanceM;
        dl += s.load;
        if (s.key) tot.keyDone++;
        intensity[s.bucket] += s.sec;
      }
      daily.push(dl);
    }
    // Spread a realistic intensity mix (time in zone, not session label)
    const tSec = intensity.easy + intensity.moderate + intensity.hard;
    const hardF = 0.1 + r.next() * 0.1;
    const modF = 0.04 + r.next() * (w % 5 === 2 ? 0.22 : 0.08);
    const intensitySec = { easy: tSec * (1 - hardF - modF), moderate: tSec * modF, hard: tSec * hardF };
    const endDate = msDate(start + 6 * DAY_MS);
    const f = byDate.get(endDate)?.f ?? fitness[fitness.length - 1];
    const fPrev = byDate.get(msDate(start - DAY_MS))?.f;
    const prev = out[out.length - 1];
    const isProjected = endDate > today;
    const doneSecForWow = tot.doneSec;
    out.push({
      isoWeek: isoWeekOf(msDate(start)),
      startDate: msDate(start),
      endDate,
      ...tot,
      elevationGainM: [...sport.values()].reduce((a, s) => a + s.elevationGainM, 0),
      projectedSec: tot.doneSec + remainingSec,
      projectedLoad: tot.doneLoad + remainingLoad,
      targetHours: w % 4 === 3 ? undefined : Math.round((tot.plannedSec / 3600) * 1.05 * 2) / 2,
      targetLoad: w % 4 === 3 ? undefined : Math.round(tot.plannedLoad * 1.04 / 10) * 10,
      bySport: [...sport.values()],
      intensitySec,
      compliancePct: tot.plannedLoad ? Math.min(1.2, tot.doneLoad / Math.max(1, tot.plannedLoad - remainingLoad)) : null,
      fitness: f.fitness,
      fatigue: f.fatigue,
      form: f.form,
      formPct: f.formPct,
      formZone: f.formZone,
      fitnessDelta: fPrev ? f.fitness - fPrev.fitness : 0,
      wowSec: prev && prev.doneSec ? doneSecForWow / prev.doneSec - 1 : null,
      wowLoad: prev && prev.doneLoad ? tot.doneLoad / prev.doneLoad - 1 : null,
      wowDistanceM: prev && prev.doneDistanceM ? tot.doneDistanceM / prev.doneDistanceM - 1 : null,
      isProjected,
      hasNote: r.next() > 0.7,
      dailyLoad: daily,
    });
  }
  return out;
}

export interface MockInterval {
  startSec: number;
  durationSec: number;
  pct: number;
  pctEnd?: number;
  role: 'warmup' | 'active' | 'recovery' | 'cooldown';
}

/** The structured session behind the mock ride (2 h 30). */
export const RIDE_PLAN: MockInterval[] = (() => {
  const out: MockInterval[] = [];
  let t = 0;
  const push = (durationSec: number, pct: number, role: MockInterval['role'], pctEnd?: number) => {
    out.push({ startSec: t, durationSec, pct, pctEnd, role });
    t += durationSec;
  };
  push(1200, 0.5, 'warmup', 0.75);
  for (let i = 0; i < 3; i++) {
    push(720, 0.98, 'active');
    push(300, 0.55, 'recovery');
  }
  push(2100, 0.72, 'active');
  for (let i = 0; i < 5; i++) {
    push(180, 1.18, 'active');
    push(180, 0.5, 'recovery');
  }
  push(9000 - t, 0.55, 'cooldown', 0.45);
  return out;
})();

/** A 2.5 h 1 Hz ride with intervals, HR lag, a stop, a short dropout and a GPS loop. */
export function mockRide(seed = 3, ftp = 290, durationSec = 9000): { streams: ActivityStreams; laps: Lap[]; ftp: number } {
  const r = rng(seed);
  const n = durationSec;
  const t: number[] = new Array(n);
  const power: (number | null)[] = new Array(n);
  const hr: (number | null)[] = new Array(n);
  const speed: (number | null)[] = new Array(n);
  const cadence: (number | null)[] = new Array(n);
  const altitude: (number | null)[] = new Array(n);
  const distance: (number | null)[] = new Array(n);
  const lat: (number | null)[] = new Array(n);
  const lng: (number | null)[] = new Array(n);
  const plan = durationSec === 9000 ? RIDE_PLAN : RIDE_PLAN.map((p) => ({ ...p, startSec: (p.startSec * durationSec) / 9000, durationSec: (p.durationSec * durationSec) / 9000 }));
  const total = 76_000; // m, approximate loop length
  const elev = (f: number) => 420 + 160 * Math.sin(f * Math.PI * 2 - 0.6) + 55 * Math.sin(f * Math.PI * 9) + 22 * Math.sin(f * Math.PI * 23);
  let h = 92;
  let d = 0;
  let p = 0;
  let drift = 0;
  const stopAt = Math.round(n * 0.69);
  const dropAt = Math.round(n * 0.43);
  for (let i = 0; i < n; i++) {
    t[i] = i;
    const step = plan.find((s) => i >= s.startSec && i < s.startSec + s.durationSec) ?? plan[plan.length - 1];
    const frac = (i - step.startSec) / step.durationSec;
    const pct = step.pctEnd != null ? step.pct + (step.pctEnd - step.pct) * frac : step.pct;
    drift += r.normal() * 0.6;
    drift *= 0.97;
    const coast = r.next() < 0.015;
    const stopped = i >= stopAt && i < stopAt + 150;
    const target = stopped || coast ? 0 : Math.max(0, ftp * pct + drift * 6 + r.normal() * (step.role === 'active' && pct > 1 ? 22 : 14));
    p += (target - p) * (coast ? 0.6 : 0.45);
    const pw = Math.max(0, Math.round(p));
    const grade = (elev((d + 1) / total) - elev(d / total)) / 1;
    const v = stopped ? 0 : Math.max(2, Math.min(17, 8.6 * Math.cbrt(Math.max(30, pw) / 240) - grade * 40 + r.normal() * 0.2));
    d += v;
    const hrTarget = 92 + (pw / ftp) * 72 + i / 400;
    h += (hrTarget - h) * (hrTarget > h ? 0.028 : 0.018);
    const dropout = i >= dropAt && i < dropAt + 25;
    power[i] = dropout ? null : pw;
    hr[i] = Math.round(h + r.normal() * 0.6);
    speed[i] = stopped ? 0 : +v.toFixed(2);
    cadence[i] = dropout ? null : pw < 5 ? 0 : Math.round(82 + (pct - 0.7) * 22 + r.normal() * 2.5);
    distance[i] = Math.round(d);
  }
  // Second pass: place the samples on a closed loop whose length is the ridden distance.
  for (let i = 0; i < n; i++) {
    const f = Math.min(1, (distance[i] ?? 0) / d);
    const th = f * Math.PI * 2;
    const rad = 0.105 * (1 + 0.22 * Math.sin(3 * th + 0.4) + 0.08 * Math.cos(5 * th));
    altitude[i] = +elev(f).toFixed(1);
    lat[i] = +(47.05 + rad * Math.sin(th) * 0.72).toFixed(6);
    lng[i] = +(8.3 + rad * Math.cos(th)).toFixed(6);
  }
  const laps: Lap[] = plan.map((s, idx) => {
    const a = Math.round(s.startSec);
    const b = Math.min(n, Math.round(s.startSec + s.durationSec));
    let ps = 0;
    let pc = 0;
    let hs = 0;
    for (let i = a; i < b; i++) {
      if (power[i] != null) {
        ps += power[i]!;
        pc++;
      }
      hs += hr[i]!;
    }
    return { index: idx, startSec: a, durationSec: b - a, distanceM: (distance[b - 1] ?? 0) - (distance[a] ?? 0), avgPower: pc ? ps / pc : undefined, avgHr: hs / (b - a) };
  });
  return { streams: { t, power, hr, speed, cadence, altitude, distance, lat, lng }, laps, ftp };
}

export const CURVE_DURATIONS = [1, 2, 3, 5, 8, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300, 420, 600, 900, 1200, 1800, 2700, 3600, 5400, 7200, 10800, 14400, 18000];

/** Mean-max curve from a CP/W′ model with a sprint cap and a long-duration decay. */
export function mockPowerCurve(cp = 285, wPrime = 21000, pmax = 1050, maxSec = 18000, seed = 5): PeakPoint[] {
  const r = rng(seed);
  return CURVE_DURATIONS.filter((s) => s <= maxSec).map((s) => {
    const model = cp + wPrime / (s + wPrime / (pmax - cp));
    const tail = s > 3600 ? 1 - 0.075 * Math.log(s / 3600) : 1;
    return { durationSec: s, value: Math.round(model * tail * (0.985 + r.next() * 0.02)) };
  });
}

export function mockWellness(days = 120, today: LocalDate = MOCK_TODAY, seed = 9): WellnessDay[] {
  const r = rng(seed);
  const out: WellnessDay[] = [];
  let hrv = 64;
  let w = 72.9;
  for (let i = days - 1; i >= 0; i--) {
    const date = addDaysLD(today, -i);
    const dow = (new Date(dateMs(date)).getUTCDay() + 6) % 7;
    const hardYesterday = dow === 2 || dow === 4 || dow === 6;
    hrv += (64 - hrv) * 0.25 + r.normal() * 4 - (hardYesterday ? 4 : 0) - (i > 30 && i < 40 ? 3 : 0);
    w += (72.2 - w) * 0.01 + r.normal() * 0.18;
    const missing = r.next() < 0.04;
    out.push({
      date,
      hrvMs: missing ? undefined : Math.round(hrv),
      restingHr: missing ? undefined : Math.round(45 + (64 - hrv) * 0.12 + r.normal() * 1.1 + (i > 30 && i < 40 ? 3 : 0)),
      sleepSec: Math.round((7.3 + r.normal() * 0.65 + (dow >= 5 ? 0.5 : 0)) * 3600),
      sleepScore: Math.round(78 + r.normal() * 8),
      weightKg: r.next() < 0.7 ? +w.toFixed(1) : undefined,
      readiness: Math.round(60 + (hrv - 60) * 1.5 + r.normal() * 6),
    });
  }
  return out;
}

/** Time in power zones (Coggan 7) from a power stream. */
export function zonesFromPower(power: (number | null)[], ftp: number): ZoneTime[] {
  const bounds = [0, 0.55, 0.75, 0.9, 1.05, 1.2, 1.5, Infinity];
  const names = ['Recovery', 'Endurance', 'Tempo', 'Threshold', 'VO2max', 'Anaerobic', 'Neuromuscular'];
  const secs = new Array(7).fill(0);
  for (const p of power) {
    if (p == null) continue;
    const f = p / ftp;
    let z = 0;
    while (z < 6 && f >= bounds[z + 1]) z++;
    secs[z]++;
  }
  return names.map((name, i) => ({ zone: i + 1, name, low: Math.round(bounds[i] * ftp), high: Number.isFinite(bounds[i + 1]) ? Math.round(bounds[i + 1] * ftp) - 1 : null, seconds: secs[i] }));
}

export const mockEvents = (today: LocalDate = MOCK_TODAY) => [
  { date: addDaysLD(today, -160), label: 'Gran Fondo', priority: 'B' as const },
  { date: addDaysLD(today, -96), label: 'FTP 278→290', priority: 'C' as const, kind: 'threshold' as const },
  { date: addDaysLD(today, -44), label: 'Hill TT', priority: 'C' as const },
  { date: addDaysLD(today, 34), label: 'A race · Tour', priority: 'A' as const },
];

export const mockPhases = (today: LocalDate = MOCK_TODAY) => {
  const monday = (offW: number) => {
    const ms = dateMs(today);
    const dow = (new Date(ms).getUTCDay() + 6) % 7;
    return msDate(ms - dow * DAY_MS + offW * 7 * DAY_MS);
  };
  return [
    { startDate: monday(-20), endDate: addDaysLD(monday(-8), -1), label: 'Base 2' },
    { startDate: monday(-8), endDate: addDaysLD(monday(-4), -1), label: 'Build 1' },
    { startDate: monday(-4), endDate: addDaysLD(monday(1), -1), label: 'Build 2' },
    { startDate: monday(1), endDate: addDaysLD(monday(4), -1), label: 'Peak' },
    { startDate: monday(4), endDate: addDaysLD(monday(5), 6), label: 'Taper' },
  ];
};

/** Heatmap input: daily load + key + missed. */
export function mockHeatDays(days: MockDay[], today: LocalDate = MOCK_TODAY) {
  return days
    .filter((d) => d.date <= today)
    .map((d) => ({
      date: d.date,
      load: d.sessions.reduce((a, s) => a + s.load, 0),
      sessions: d.sessions.length,
      key: d.sessions.some((s) => s.key),
      missed: d.planned.length > 0 && d.sessions.length === 0,
    }));
}
