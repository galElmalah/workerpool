/**
 * Trends data layer: query hooks for every /api/trends/* endpoint, the API "today" and small
 * pure helpers (range math, sport filtering, compare baselines, plain-language WoW copy).
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { FitnessDay, LocalDate, Sport, WeekSummary } from '@cadence/core';
import { addDays, isoWeekOf, weekStart } from '@cadence/core/time';
import type { FitnessRange } from '@/charts';
import { api, call } from '@/lib/api';
import { qk } from '@/lib/query';
import type { TrendsSearch } from '@/shell/search';

export type TrendRange = NonNullable<TrendsSearch['range']>;
export type CompareKey = NonNullable<TrendsSearch['compare']>;
export type Metric = NonNullable<TrendsSearch['metric']>;

export const RANGE_OPTIONS: { value: TrendRange; label: string; weeks: number }[] = [
  { value: '6w', label: '6W', weeks: 6 },
  { value: '12w', label: '12W', weeks: 12 },
  { value: '6m', label: '6M', weeks: 26 },
  { value: '1y', label: '1Y', weeks: 52 },
  { value: 'all', label: 'All', weeks: 104 },
];
export const rangeWeeks = (r: TrendRange) => (r === '3m' ? 13 : (RANGE_OPTIONS.find((o) => o.value === r)?.weeks ?? 12));
export const chartRange = (r: TrendRange): FitnessRange => (r === '3m' ? '12w' : r);
export const rangeLabel = (r: TrendRange) =>
  ({ '6w': 'Last 6 weeks', '12w': 'Last 12 weeks', '3m': 'Last 3 months', '6m': 'Last 6 months', '1y': 'Last 12 months', all: 'All time' })[r];

const str = (n: number) => String(n);

// ───────────────────────── queries ─────────────────────────

/** The API's notion of today (user timezone), from a tiny consistency call. Never the browser clock. */
export function useApiToday() {
  const q = useQuery({
    queryKey: qk.trends.of('today'),
    queryFn: () => call(api.trends.consistency.$get({ query: { days: str(7) } as never })),
    staleTime: 60_000,
  });
  return { today: q.data?.to as LocalDate | undefined, isError: q.isError, refetch: q.refetch };
}

export function useConsistency(days = 365) {
  return useQuery({
    queryKey: qk.trends.of('consistency', days),
    queryFn: () => call(api.trends.consistency.$get({ query: { days: str(days) } as never })),
  });
}

/** Up to 104 weeks ending with the current week; slice client-side so ranges morph without refetch. */
export function useWeekly(weeks = 104, end?: LocalDate) {
  return useQuery({
    queryKey: qk.trends.of('weekly', { weeks, end }),
    queryFn: () => call(api.trends.weekly.$get({ query: { weeks: str(weeks), ...(end ? { end } : {}) } as never })) as Promise<WeekSummary[]>,
    placeholderData: keepPreviousData,
  });
}

export function useFitness(today: LocalDate | undefined, sport?: Sport, backDays = 760) {
  const from = today ? addDays(today, -backDays) : undefined;
  const to = today ? addDays(today, 56) : undefined;
  return useQuery({
    queryKey: qk.trends.of('fitness', { from, to, sport }),
    queryFn: () => call(api.trends.fitness.$get({ query: { from: from!, to: to!, ...(sport ? { sport } : {}) } })),
    enabled: !!today,
    placeholderData: keepPreviousData,
  });
}

export function useIntensity(weeks: number) {
  return useQuery({
    queryKey: qk.trends.of('intensity', weeks),
    queryFn: () => call(api.trends.intensity.$get({ query: { weeks: str(weeks) } as never })),
    placeholderData: keepPreviousData,
  });
}

export function usePeaks(sport: Sport, ranges = '42d,90d,season,all') {
  return useQuery({
    queryKey: qk.trends.of('peaks', { sport, ranges }),
    queryFn: () => call(api.trends.peaks.$get({ query: { sport, ranges } })),
    placeholderData: keepPreviousData,
  });
}

export function useThresholdHistory() {
  return useQuery({ queryKey: qk.trends.of('thresholds'), queryFn: () => call(api.trends.thresholds.$get()) });
}

export function useWellness(from: LocalDate | undefined, to: LocalDate | undefined) {
  return useQuery({
    queryKey: qk.trends.of('wellness', { from, to }),
    queryFn: () => call(api.trends.wellness.$get({ query: { from: from!, to: to! } })),
    enabled: !!from && !!to,
    placeholderData: keepPreviousData,
  });
}

export function useSportTrend(sport: Sport, weeks: number) {
  return useQuery({
    queryKey: qk.trends.of('sport', { sport, weeks }),
    queryFn: () => call(api.trends.sport[':sport'].$get({ param: { sport }, query: { weeks: str(weeks) } as never })),
    placeholderData: keepPreviousData,
  });
}

// ───────────────────────── helpers ─────────────────────────

/** Drop leading weeks with no data at all (before history starts). */
export function trimLeading(weeks: WeekSummary[]): WeekSummary[] {
  const i = weeks.findIndex((w) => w.doneSec > 0 || w.plannedSec > 0);
  return i < 0 ? [] : weeks.slice(i);
}

const wowOf = (a: number, b: number | undefined) => (b && b > 0 ? a / b - 1 : null);

/** Re-express week summaries for one sport (totals, sport stack, WoW recomputed). */
export function filterWeeks(weeks: WeekSummary[], sport?: Sport): WeekSummary[] {
  if (!sport) return weeks;
  const out = weeks.map((w): WeekSummary => {
    const s = w.bySport.find((x) => x.sport === sport);
    const doneSec = s?.doneSec ?? 0;
    const plannedSec = s?.plannedSec ?? 0;
    const doneLoad = s?.doneLoad ?? 0;
    const plannedLoad = s?.plannedLoad ?? 0;
    return {
      ...w,
      doneSec,
      plannedSec,
      doneLoad,
      plannedLoad,
      doneDistanceM: s?.doneDistanceM ?? 0,
      plannedDistanceM: s?.plannedDistanceM ?? 0,
      elevationGainM: s?.elevationGainM ?? 0,
      projectedSec: w.isProjected ? Math.max(doneSec, plannedSec) : doneSec,
      projectedLoad: w.isProjected ? Math.max(doneLoad, plannedLoad) : doneLoad,
      targetHours: undefined,
      targetLoad: undefined,
      bySport: s ? [s] : [],
    };
  });
  return out.map((w, i) => ({
    ...w,
    wowSec: wowOf(w.doneSec, out[i - 1]?.doneSec),
    wowLoad: wowOf(w.doneLoad, out[i - 1]?.doneLoad),
    wowDistanceM: wowOf(w.doneDistanceM, out[i - 1]?.doneDistanceM),
  }));
}

export const sessionsDone = (w: WeekSummary) => w.bySport.reduce((a, s) => a + s.doneCount, 0);
export const sessionsPlanned = (w: WeekSummary) => w.bySport.reduce((a, s) => a + s.plannedCount, 0);

export const METRIC_VALUE: Record<Metric, (w: WeekSummary) => number> = {
  hours: (w) => w.doneSec / 3600,
  load: (w) => w.doneLoad,
  distance: (w) => w.doneDistanceM / 1000,
};
export const METRIC_NAME: Record<Metric, string> = { hours: 'Hours', load: 'Load', distance: 'Distance' };

/** Baseline week value for a compare mode: previous week, mean of the 4 before, or same ISO week a year ago. */
export function baselineOf(all: WeekSummary[], idx: number, mode: CompareKey, f: (w: WeekSummary) => number): number | null {
  if (mode === 'prev') return idx > 0 ? f(all[idx - 1]) : null;
  if (mode === 'avg') {
    const win = all.slice(Math.max(0, idx - 4), idx);
    return win.length ? win.reduce((a, w) => a + f(w), 0) / win.length : null;
  }
  const w = all[idx];
  const target = isoWeekOf(addDays(w.startDate, -364));
  const hit = all.find((x) => x.isoWeek === target);
  return hit && (hit.doneSec > 0 || hit.plannedSec > 0) ? f(hit) : null;
}

export const COMPARE_LABEL: Record<CompareKey, string> = { prev: 'vs last week', avg: 'vs 4-week avg', year: 'vs last year' };

/** "Load is up 3 weeks running: +6 %, +9 %, +4 %" from complete weeks' deltas (oldest → newest). */
export function wowSentence(name: string, deltas: (number | null)[], fmtPct: (v: number) => string): string {
  const d = deltas.filter((v): v is number => v != null);
  if (!d.length) return `Not enough history yet to compare ${name.toLowerCase()} week over week.`;
  const last = d[d.length - 1];
  const dir = Math.abs(last) < 0.02 ? 0 : Math.sign(last);
  let run = 0;
  for (let i = d.length - 1; i >= 0; i--) {
    const s = Math.abs(d[i]) < 0.02 ? 0 : Math.sign(d[i]);
    if (s === dir) run++;
    else break;
  }
  const seq = d.slice(-run).slice(-4).map(fmtPct).join(', ');
  const caution = d.slice(-run).some((v) => v > 0.15) && dir > 0;
  if (dir === 0) return `${name} held steady last week (${fmtPct(last)}).`;
  if (run >= 2) return `${name} is ${dir > 0 ? 'up' : 'down'} ${run} weeks running: ${seq}.${caution ? ' One jump is above the +15 % caution line.' : ''}`;
  const prev = d.length > 1 ? d[d.length - 2] : null;
  const after = prev == null ? '' : prev > 0.02 ? ' after a rise' : prev < -0.02 ? ' after a drop' : ' after a steady week';
  return `${name} ${dir > 0 ? 'rose' : 'fell'} ${fmtPct(Math.abs(last)).replace('+', '')} last week${after}.${caution ? ' That is above the +15 % caution line.' : ''}`;
}

/** Index of the fitness day for `today` (or last non-projected). */
export function todayIndex(days: FitnessDay[], today?: LocalDate): number {
  let i = days.length - 1;
  while (i > 0 && (today ? days[i].date > today : days[i].projected)) i--;
  return i;
}

export const rampBand = (r: number | null | undefined) => (r == null ? null : r > 8 ? 'risky' : r > 5 ? 'aggressive' : r < -5 ? 'detraining' : 'normal');

export { weekStart, addDays, isoWeekOf };
