import { Hono } from 'hono';
import { z } from 'zod';
import {
  INTENSITY_META,
  LocalDate,
  SPORTS,
  Sport,
  THRESHOLD_KINDS,
  type BestEffort,
  type IntensityClass,
  type PeakPoint,
  type Threshold,
  type ThresholdKind,
  type WellnessDay,
  type ZoneTime,
} from '@cadence/core/domain';
import {
  classifyDistribution,
  dayStreak,
  estimateFtp,
  estimateThresholds,
  fitCriticalPower,
  hrvBaseline,
  mergeCurves,
  readiness,
  restingHrTrend,
  type ThresholdHistory,
} from '@cadence/core/metrics';
import { addDays, diffDays, eachDay, eachWeek, isoWeekOf, isoWeekStart, weekStart } from '@cadence/core/time';
import type { AppEnv } from '../env';
import { dailyTotals, listPeaks, selectActivityFields, sportTotals, type ActivityExtras } from '../db/activities';
import { listEvents, listPhases, listWellness } from '../db/furniture';
import { listThresholds } from '../db/thresholds';
import { badRequest } from '../lib/http';
import { getToday, validate } from '../services/context';
import { batchedEnv, fitnessSeries, weekSummaries } from '../services/analytics';

const r1 = (v: number) => Math.round(v * 10) / 10;
const r = (v: number | null | undefined, dp = 1): number | null => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10 ** dp) / 10 ** dp);

// ───────────────────────────── peaks ─────────────────────────────

type PeakRow = Awaited<ReturnType<typeof listPeaks>>[number];
type RangeKey = string;

/** '42d' | '90d' | 'season' (calendar year) | 'all' | 'YYYY' → [from, to]. */
function rangeOf(key: RangeKey, today: LocalDate): { from: LocalDate; to: LocalDate } | null {
  const m = /^(\d{1,4})d$/.exec(key);
  if (m) return { from: addDays(today, -(Number(m[1]) - 1)), to: today };
  if (key === 'season') return { from: `${today.slice(0, 4)}-01-01`, to: today };
  if (key === 'last_season') {
    const y = Number(today.slice(0, 4)) - 1;
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
  if (key === 'all') return { from: '1970-01-01', to: today };
  if (/^\d{4}$/.test(key)) return { from: `${key}-01-01`, to: `${key}-12-31` };
  return null;
}

interface SourcedPoint extends PeakPoint {
  activityId?: string;
  date?: LocalDate;
}

function mergeChannel(rows: PeakRow[], ch: 'power' | 'hr' | 'speed', dateOf: Map<string, LocalDate>): SourcedPoint[] {
  const merged = mergeCurves(rows.filter((x) => x.peaks[ch]?.length).map((x) => ({ id: x.id, points: x.peaks[ch]! })));
  return merged.map((p) => {
    const o: SourcedPoint = { durationSec: p.durationSec, value: p.value };
    if (p.sourceId) {
      o.activityId = p.sourceId;
      o.date = dateOf.get(p.sourceId);
    }
    return o;
  });
}

function bestEffortsOf(rows: PeakRow[]): Array<BestEffort & { activityId: string; date: LocalDate }> {
  const best = new Map<number, BestEffort & { activityId: string; date: LocalDate }>();
  for (const row of rows) {
    for (const e of row.peaks.efforts ?? []) {
      const cur = best.get(e.distanceM);
      if (!cur || e.timeSec < cur.timeSec) best.set(e.distanceM, { distanceM: e.distanceM, timeSec: e.timeSec, activityId: row.id, date: row.localDate });
    }
  }
  return [...best.values()].sort((a, b) => a.distanceM - b.distanceM);
}

// ───────────────────────────── queries ─────────────────────────────

const FitnessQuery = z.object({ from: LocalDate.optional(), to: LocalDate.optional(), sport: Sport.optional() });
const WeeklyQuery = z.object({ weeks: z.coerce.number().int().min(1).max(104).default(12), end: LocalDate.optional() });
const PeaksQuery = z.object({ sport: Sport.default('bike'), ranges: z.string().max(100).default('42d,90d,season,all') });
const WeeksQuery = z.object({ weeks: z.coerce.number().int().min(1).max(104).default(12) });
const WellnessQuery = z.object({ from: LocalDate.optional(), to: LocalDate.optional() });
const ConsistencyQuery = z.object({ days: z.coerce.number().int().min(7).max(1100).default(365) });
const CompareQuery = z.object({
  a: z.string().regex(/^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/).optional(),
  b: z.string().regex(/^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/).optional(),
  preset: z.enum(['week', '4w', 'ytd']).default('week'),
});
const SportQuery = z.object({ weeks: z.coerce.number().int().min(1).max(104).default(26), refHr: z.coerce.number().min(60).max(220).optional() });

/** Which threshold kinds matter for a sport's fitness view. */
const KINDS_FOR: Partial<Record<Sport, ThresholdKind[]>> = {
  bike: ['ftp', 'lthr', 'hr_max', 'hr_rest', 'weight'],
  run: ['run_threshold', 'lthr', 'hr_max', 'hr_rest', 'weight'],
  swim: ['swim_css', 'lthr', 'hr_max', 'hr_rest'],
  row: ['row_threshold', 'lthr', 'hr_max', 'hr_rest', 'weight'],
};

function splitRange(v: string): { from: LocalDate; to: LocalDate } {
  const [from, to] = v.split('..');
  if (to < from) throw badRequest(`Bad range ${v}`);
  return { from, to };
}

interface ZonesRow {
  id: string;
  local_date: string;
  sport: Sport;
  moving_sec: number;
  duration_sec: number;
  intensity_auto: IntensityClass;
  intensity_override: IntensityClass | null;
  zones: string;
}

const secOf = (x: { moving_sec: number; duration_sec: number }) => (x.moving_sec > 0 ? x.moving_sec : x.duration_sec) || 0;

/** Mounted at /api — define full paths here (see docs/ARCHITECTURE.md → API surface). */
export const trendsRoutes = new Hono<AppEnv>()
  .get('/trends/fitness', validate('query', FitnessQuery), async (c) => {
    const q = c.req.valid('query');
    const { env } = batchedEnv(c.env);
    const today = await getToday(env);
    const from = q.from ?? addDays(today, -180);
    let to = q.to ?? addDays(today, 42);
    if (to > addDays(today, 56)) to = addDays(today, 56); // projection horizon ≈ 8 weeks
    if (to < from) throw badRequest('`to` must not be before `from`');
    const [days, events, phases, thresholds] = await Promise.all([
      fitnessSeries(c.env, { from, to, sport: q.sport }),
      listEvents(env.DB, { from, to }),
      listPhases(env.DB, { from, to }),
      listThresholds(env.DB),
    ]);
    const kinds = q.sport ? KINDS_FOR[q.sport] : undefined;
    const thresholdChanges = thresholds
      .filter((t) => t.effectiveFrom >= from && t.effectiveFrom <= to)
      .filter((t) => !q.sport || ((!kinds || kinds.includes(t.kind)) && (t.sport === q.sport || t.sport === 'all')))
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    return c.json({ from, to, today, days, events, phases, thresholdChanges });
  })
  .get('/trends/weekly', validate('query', WeeklyQuery), async (c) => {
    const q = c.req.valid('query');
    const end = q.end ?? (await getToday(c.env));
    const from = addDays(weekStart(end), -(q.weeks - 1) * 7);
    return c.json(await weekSummaries(c.env, { from, to: end }));
  })
  .get('/trends/peaks', validate('query', PeaksQuery), async (c) => {
    const q = c.req.valid('query');
    const today = await getToday(c.env);
    const keys = [...new Set(q.ranges.split(',').map((s) => s.trim()).filter(Boolean))].slice(0, 6);
    const ranges = keys.map((key) => ({ key, range: rangeOf(key, today) }));
    const bad = ranges.find((x) => !x.range);
    if (bad) throw badRequest(`Unknown range "${bad.key}" (use e.g. 42d, 90d, season, last_season, all, 2025)`);
    const earliest = ranges.reduce((m, x) => (x.range!.from < m ? x.range!.from : m), today);
    const rows = await listPeaks(c.env.DB, { sport: q.sport, from: earliest, to: today });
    const dateOf = new Map(rows.map((x) => [x.id, x.localDate] as const));
    const withPower = q.sport === 'bike' || q.sport === 'row';
    const withEfforts = q.sport === 'run' || q.sport === 'swim' || q.sport === 'row' || q.sport === 'walk' || q.sport === 'hike';
    const out = ranges.map(({ key, range }) => {
      const sel = rows.filter((x) => x.localDate >= range!.from && x.localDate <= range!.to);
      const o: Record<string, unknown> = { key, from: range!.from, to: range!.to, activities: sel.length };
      if (withPower) o.power = mergeChannel(sel, 'power', dateOf);
      if (q.sport === 'run') o.speed = mergeChannel(sel, 'speed', dateOf);
      if (withEfforts) o.efforts = bestEffortsOf(sel);
      o.hr = mergeChannel(sel, 'hr', dateOf);
      return o;
    });
    // Latest estimate from the last 90 days (suggestion only — never applied automatically).
    const recent = rows.filter((x) => x.localDate >= addDays(today, -89));
    const estimate: Record<string, unknown> = {};
    if (withPower) {
      const curve = mergeCurves(recent.filter((x) => x.peaks.power?.length).map((x) => ({ id: x.id, points: x.peaks.power! })));
      const ftp = estimateFtp(curve);
      if (ftp) estimate.ftp = { value: Math.round(ftp.value), basis: ftp.basis };
      const cp = fitCriticalPower(curve);
      if (cp) estimate.criticalPower = { cp: Math.round(cp.cp), wPrime: Math.round(cp.wPrime), r2: r(cp.r2, 3), valid: cp.valid, ...(cp.reason ? { reason: cp.reason } : {}) };
    }
    if (withEfforts || q.sport === 'run') {
      const sug = estimateThresholds({
        runSpeedCurve: q.sport === 'run' ? mergeCurves(recent.filter((x) => x.peaks.speed?.length).map((x) => ({ points: x.peaks.speed! }))) : undefined,
        runEfforts: q.sport === 'run' ? bestEffortsOf(recent) : undefined,
        rowEfforts: q.sport === 'row' ? bestEffortsOf(recent) : undefined,
        swimEfforts: q.sport === 'swim' ? bestEffortsOf(recent) : undefined,
      }).filter((s) => s.kind !== 'hr_max' && s.kind !== 'hr_rest');
      if (sug.length) estimate.thresholds = sug.map((s) => ({ ...s, value: r(s.value, 3) }));
    }
    return c.json({ sport: q.sport, today, ranges: out, estimate });
  })
  .get('/trends/intensity', validate('query', WeeksQuery), async (c) => {
    const q = c.req.valid('query');
    const today = await getToday(c.env);
    const from = addDays(weekStart(today), -(q.weeks - 1) * 7);
    const rows = await selectActivityFields<ZonesRow>(
      c.env.DB,
      { from, to: today },
      'id, local_date, sport, moving_sec, duration_sec, intensity_auto, intensity_override, zones',
    );
    const weeks = new Map(eachWeek(from, today).map((w) => [w, { isoWeek: w, startDate: isoWeekStart(w), easy: 0, moderate: 0, hard: 0, keyBySource: { zones: 0, class: 0 } }]));
    const bySport = new Map<Sport, { sport: Sport; seconds: number; hr: Map<number, ZoneTime>; power: Map<number, ZoneTime>; pace: Map<number, ZoneTime> }>();
    const total = { easy: 0, moderate: 0, hard: 0 };
    for (const row of rows) {
      const zones = JSON.parse(row.zones || '{}') as ActivityExtras['zones'];
      const w = weeks.get(isoWeekOf(row.local_date));
      const sec = secOf(row);
      let split: { easy: number; moderate: number; hard: number };
      if (zones.three && zones.three.easy + zones.three.moderate + zones.three.hard > 0) {
        split = zones.three;
        if (w) w.keyBySource.zones++;
      } else {
        const b = INTENSITY_META[row.intensity_override ?? row.intensity_auto]?.bucket ?? 'easy';
        split = { easy: 0, moderate: 0, hard: 0, [b]: sec };
        if (w) w.keyBySource.class++;
      }
      for (const k of ['easy', 'moderate', 'hard'] as const) {
        if (w) w[k] += split[k];
        total[k] += split[k];
      }
      let s = bySport.get(row.sport);
      if (!s) bySport.set(row.sport, (s = { sport: row.sport, seconds: 0, hr: new Map(), power: new Map(), pace: new Map() }));
      s.seconds += sec;
      for (const ch of ['hr', 'power', 'pace'] as const) {
        for (const z of zones[ch] ?? []) {
          const cur = s[ch].get(z.zone);
          if (cur) cur.seconds += z.seconds;
          else s[ch].set(z.zone, { zone: z.zone, name: z.name, low: null, high: null, seconds: z.seconds });
        }
      }
    }
    const pct = (x: { easy: number; moderate: number; hard: number }) => {
      const t = x.easy + x.moderate + x.hard;
      return t > 0 ? { easy: r1((100 * x.easy) / t), moderate: r1((100 * x.moderate) / t), hard: r1((100 * x.hard) / t) } : null;
    };
    return c.json({
      weeks: [...weeks.values()].map(({ keyBySource, ...w }) => ({
        ...w,
        easy: Math.round(w.easy),
        moderate: Math.round(w.moderate),
        hard: Math.round(w.hard),
        pct: pct(w),
        distribution: w.easy + w.moderate + w.hard > 0 ? classifyDistribution(w.easy, w.moderate, w.hard) : null,
        source: keyBySource,
      })),
      total: { ...total, pct: pct(total), distribution: total.easy + total.moderate + total.hard > 0 ? classifyDistribution(total.easy, total.moderate, total.hard) : null },
      bySport: SPORTS.filter((s) => bySport.has(s)).map((sp) => {
        const s = bySport.get(sp)!;
        const list = (m: Map<number, ZoneTime>) => [...m.values()].sort((a, b) => a.zone - b.zone).map((z) => ({ zone: z.zone, name: z.name, seconds: Math.round(z.seconds) }));
        const o: Record<string, unknown> = { sport: sp, seconds: Math.round(s.seconds) };
        if (s.hr.size) o.hr = list(s.hr);
        if (s.power.size) o.power = list(s.power);
        if (s.pace.size) o.pace = list(s.pace);
        return o;
      }),
    });
  })
  .get('/trends/wellness', validate('query', WellnessQuery), async (c) => {
    const q = c.req.valid('query');
    const { env } = batchedEnv(c.env);
    const today = await getToday(env);
    const to = q.to ?? today;
    const from = q.from ?? addDays(to, -89);
    if (to < from || diffDays(from, to) > 800) throw badRequest('Bad range');
    const [list, fitness] = await Promise.all([listWellness(env.DB, { from: addDays(from, -60), to }), fitnessSeries(c.env, { from, to })]);
    const formOf = new Map(fitness.map((f) => [f.date, f] as const));
    const byDate = new Map(list.map((w) => [w.date, w] as const));
    const ms = (v: number | null) => (v === null ? null : r(Math.exp(v), 1));
    const days = eachDay(from, to).map((date) => {
      const w: WellnessDay = byDate.get(date) ?? { date };
      const hrv = hrvBaseline(list, date);
      const rhr = restingHrTrend(list, date);
      const f = formOf.get(date);
      const rd = readiness(list, date, { formPct: f?.formPct ?? null });
      return {
        ...w,
        load: f?.load ?? 0,
        hrvBaseline: { b7Ms: r(hrv.b7Ms, 1), lowMs: ms(hrv.low), highMs: ms(hrv.high), cv7: r(hrv.cv7, 2), status: hrv.status },
        restingHrTrend: { rhr7: r(rhr.rhr7, 1), rhr60: r(rhr.rhr60, 1), elevated: rhr.elevated },
        readiness: { state: rd.state, reasons: rd.reasons, inputs: rd.inputs },
      };
    });
    return c.json({ from, to, today, days, readinessLabel: 'Heuristic, not a validated or medical score' });
  })
  .get('/trends/consistency', validate('query', ConsistencyQuery), async (c) => {
    const q = c.req.valid('query');
    const today = await getToday(c.env);
    const from = addDays(today, -(q.days - 1));
    const rows = await dailyTotals(c.env.DB, { from, to: today });
    const byDate = new Map(rows.map((x) => [x.date, x] as const));
    const days = eachDay(from, today).map((date) => {
      const x = byDate.get(date);
      return { date, load: r1(x?.load ?? 0), durationSec: Math.round(x?.durationSec ?? 0), count: x?.count ?? 0, key: (x?.key ?? 0) === 1 };
    });
    const ds = dayStreak(rows.filter((x) => x.count > 0).map((x) => x.date), today);
    // Week streaks: weeks with ≥ 1 session (and ≥ 3 sessions); a still-running current week does not break them.
    const weekCounts = new Map<string, number>();
    for (const x of rows) weekCounts.set(isoWeekOf(x.date), (weekCounts.get(isoWeekOf(x.date)) ?? 0) + x.count);
    const weeksList = eachWeek(from, today); // oldest → newest
    const streaks = (min: number) => {
      let longest = 0;
      let run = 0;
      for (const w of weeksList) {
        run = (weekCounts.get(w) ?? 0) >= min ? run + 1 : 0;
        longest = Math.max(longest, run);
      }
      let current = 0;
      for (let i = weeksList.length - 1; i >= 0; i--) {
        if ((weekCounts.get(weeksList[i]) ?? 0) >= min) current++;
        else if (i === weeksList.length - 1) continue;
        else break;
      }
      return { current, longest };
    };
    let daysSinceRest = 0;
    for (let d = today; d >= from && (byDate.get(d)?.count ?? 0) > 0; d = addDays(d, -1)) daysSinceRest++;
    const w1 = streaks(1);
    const w3 = streaks(3);
    return c.json({
      from,
      to: today,
      days,
      streaks: {
        currentDays: ds.current,
        longestDays: ds.longest,
        currentWeeks: w1.current,
        longestWeeks: w1.longest,
        currentWeeks3: w3.current,
        longestWeeks3: w3.longest,
        daysSinceRest,
      },
    });
  })
  .get('/trends/thresholds', async (c) => {
    const { env } = batchedEnv(c.env);
    const today = await getToday(env);
    const [thresholds, peaks, wellness] = await Promise.all([
      listThresholds(env.DB),
      listPeaks(env.DB, { from: addDays(today, -364), to: today }),
      listWellness(env.DB, { from: addDays(today, -29), to: today }),
    ]);
    const history = Object.fromEntries(
      THRESHOLD_KINDS.map((k) => [k, thresholds.filter((t) => t.kind === k).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.sport.localeCompare(b.sport))]),
    ) as Record<ThresholdKind, Threshold[]>;
    const recent = peaks.filter((x) => x.localDate >= addDays(today, -89));
    const curve = (sport: Sport, ch: 'power' | 'speed' | 'hr', rows = recent) =>
      mergeCurves(rows.filter((x) => x.sport === sport && x.peaks[ch]?.length).map((x) => ({ points: x.peaks[ch]! })));
    const efforts = (sport: Sport) => bestEffortsOf(recent.filter((x) => x.sport === sport));
    const hrCurves: ThresholdHistory['hrCurves'] = {};
    for (const s of ['bike', 'run'] as const) {
      const cv = curve(s, 'hr');
      if (cv.length) hrCurves[s] = cv;
    }
    const maxHrSamples = peaks.map((x) => x.peaks.hr?.find((p) => p.durationSec === 5)?.value).filter((v): v is number => typeof v === 'number');
    const suggestions = estimateThresholds({
      bikePowerCurve: curve('bike', 'power'),
      rowPowerCurve: curve('row', 'power'),
      runSpeedCurve: curve('run', 'speed'),
      runEfforts: efforts('run'),
      rowEfforts: efforts('row'),
      swimEfforts: efforts('swim'),
      hrCurves,
      maxHrSamples,
      restingHr: wellness.map((w) => w.restingHr).filter((v): v is number => typeof v === 'number'),
    }).map((s) => {
      const current = thresholds
        .filter((t) => t.kind === s.kind && (t.sport === s.sport || t.sport === 'all') && t.effectiveFrom <= today)
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
      return { ...s, value: r(s.value, s.kind.includes('threshold') || s.kind === 'swim_css' ? 3 : 0)!, ...(current ? { current: current.value } : {}) };
    });
    return c.json({ today, history, suggestions });
  })
  .get('/trends/compare', validate('query', CompareQuery), async (c) => {
    const q = c.req.valid('query');
    const today = await getToday(c.env);
    let a: { from: LocalDate; to: LocalDate };
    let b: { from: LocalDate; to: LocalDate };
    if (q.a && q.b) {
      a = splitRange(q.a);
      b = splitRange(q.b);
    } else if (q.preset === '4w') {
      a = { from: addDays(today, -27), to: today };
      b = { from: addDays(today, -55), to: addDays(today, -28) };
    } else if (q.preset === 'ytd') {
      const y = Number(today.slice(0, 4));
      a = { from: `${y}-01-01`, to: today };
      const md = today.slice(5) === '02-29' ? '02-28' : today.slice(5);
      b = { from: `${y - 1}-01-01`, to: `${y - 1}-${md}` };
    } else {
      const ws = weekStart(today);
      a = { from: ws, to: today };
      b = { from: addDays(ws, -7), to: addDays(ws, -1) };
    }
    const { env } = batchedEnv(c.env);
    const [ra, rb] = await Promise.all([sportTotals(env.DB, a), sportTotals(env.DB, b)]);
    const period = (range: { from: LocalDate; to: LocalDate }, rows: typeof ra) => {
      const totals = rows.reduce(
        (t, x) => ({ count: t.count + x.count, durationSec: t.durationSec + x.durationSec, distanceM: t.distanceM + x.distanceM, load: t.load + x.load, elevationGainM: t.elevationGainM + x.elevationGainM }),
        { count: 0, durationSec: 0, distanceM: 0, load: 0, elevationGainM: 0 },
      );
      const round = <T extends { durationSec: number; distanceM: number; load: number; elevationGainM: number }>(x: T): T => ({
        ...x,
        durationSec: Math.round(x.durationSec),
        distanceM: Math.round(x.distanceM),
        load: r1(x.load),
        elevationGainM: Math.round(x.elevationGainM),
      });
      return { ...range, totals: round(totals), bySport: rows.map(round) };
    };
    const pa = period(a, ra);
    const pb = period(b, rb);
    const d = (x: number, y: number) => (y > 0 ? r((x - y) / y, 3) : null);
    return c.json({
      a: pa,
      b: pb,
      delta: {
        count: d(pa.totals.count, pb.totals.count),
        durationSec: d(pa.totals.durationSec, pb.totals.durationSec),
        distanceM: d(pa.totals.distanceM, pb.totals.distanceM),
        load: d(pa.totals.load, pb.totals.load),
        elevationGainM: d(pa.totals.elevationGainM, pb.totals.elevationGainM),
      },
    });
  })
  .get('/trends/sport/:sport', validate('query', SportQuery), async (c) => {
    const parsed = Sport.safeParse(c.req.param('sport'));
    if (!parsed.success) throw badRequest('Unknown sport');
    const sport = parsed.data;
    const q = c.req.valid('query');
    const { env } = batchedEnv(c.env);
    const today = await getToday(env);
    const from = addDays(weekStart(today), -(q.weeks - 1) * 7);
    const [rows, thresholds] = await Promise.all([
      selectActivityFields<{
        id: string;
        local_date: string;
        moving_sec: number;
        duration_sec: number;
        distance_m: number | null;
        load: number;
        elevation_gain_m: number | null;
        avg_hr: number | null;
        weighted_power: number | null;
        avg_power: number | null;
        avg_speed_mps: number | null;
        adjusted_speed_mps: number | null;
        efficiency: number | null;
        decoupling_pct: number | null;
        avg_swolf: number | null;
        volume_kg: number | null;
        is_key: number;
      }>(
        env.DB,
        { from, to: today, sport },
        'id, local_date, moving_sec, duration_sec, distance_m, load, elevation_gain_m, avg_hr, weighted_power, avg_power, avg_speed_mps, adjusted_speed_mps, efficiency, decoupling_pct, avg_swolf, volume_kg, is_key',
      ),
      listThresholds(env.DB),
    ]);
    const lthr = thresholds.filter((t) => t.kind === 'lthr' && (t.sport === sport || t.sport === 'all') && t.effectiveFrom <= today).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]?.value;
    const refHr = q.refHr ?? (lthr ? Math.round(lthr * 0.85) : 140);
    // Output at the reference HR, assuming output ∝ HR around aerobic intensities (EF × refHr).
    const outputAtRef = (x: (typeof rows)[number]): number | null => {
      if (!x.avg_hr || x.avg_hr < 60) return null;
      if (sport === 'bike' || sport === 'row') {
        const p = x.weighted_power ?? x.avg_power;
        return p ? (p / x.avg_hr) * refHr : null;
      }
      const v = x.adjusted_speed_mps ?? x.avg_speed_mps;
      return v ? (v / x.avg_hr) * refHr : null;
    };
    const points = rows.map((x) => ({
      activityId: x.id,
      date: x.local_date,
      durationSec: Math.round(secOf(x)),
      distanceM: x.distance_m ?? undefined,
      load: x.load,
      efficiency: x.efficiency ?? undefined,
      decouplingPct: x.decoupling_pct ?? undefined,
      outputAtRefHr: r(outputAtRef(x), 3) ?? undefined,
      avgSwolf: x.avg_swolf ?? undefined,
      volumeKg: x.volume_kg ?? undefined,
      isKey: x.is_key === 1,
    }));
    const mean = (xs: Array<number | undefined>) => {
      const v = xs.filter((x): x is number => typeof x === 'number');
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    const weeks = eachWeek(from, today).map((w) => {
      const start = isoWeekStart(w);
      const end = addDays(start, 6);
      const p = points.filter((x) => x.date >= start && x.date <= end);
      return {
        isoWeek: w,
        startDate: start,
        count: p.length,
        durationSec: p.reduce((a, x) => a + x.durationSec, 0),
        distanceM: Math.round(p.reduce((a, x) => a + (x.distanceM ?? 0), 0)),
        load: r1(p.reduce((a, x) => a + x.load, 0)),
        elevationGainM: Math.round(rows.filter((x) => x.local_date >= start && x.local_date <= end).reduce((a, x) => a + (x.elevation_gain_m ?? 0), 0)),
        efficiency: r(mean(p.map((x) => x.efficiency)), 4),
        decouplingPct: r(mean(p.filter((x) => x.durationSec >= 3600).map((x) => x.decouplingPct)), 2),
        outputAtRefHr: r(mean(p.map((x) => x.outputAtRefHr)), 3),
        avgSwolf: r(mean(p.map((x) => x.avgSwolf)), 1),
        volumeKg: r(p.reduce((a, x) => a + (x.volumeKg ?? 0), 0), 0),
      };
    });
    const unit = sport === 'bike' || sport === 'row' ? 'W' : 'm/s';
    return c.json({ sport, from, to: today, refHr, outputUnit: unit, weeks, points });
  });
