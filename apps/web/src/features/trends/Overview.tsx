/**
 * /trends — the overview answers "am I progressing?" in two seconds: four headline figures for this
 * week (hours, load, fitness, form — each with its change), then one chart per section on the canvas:
 * Fitness · Fatigue · Form (hero), weekly volume, week-over-week progression, intensity, consistency.
 * One control row (range + Filter). Everything the v1 tiles carried (distance, sessions, key sessions,
 * fatigue, plan progress, ramp) is on the week review page, in the chart tooltips or on the sub-pages.
 */
import type { Activity, CalendarResponse, FitnessDay, LocalDate, Sport, WeekSummary } from '@cadence/core';
import { addDays, isoWeekday, weekStart } from '@cadence/core/time';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowRight } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState, type ReactNode } from 'react';
import {
  ConsistencyHeatmap,
  FitnessChart,
  IntensityDistribution,
  WeeklyBars,
  WowDeltaBars,
  createHoverSync,
  type ChartEvent,
  type ChartPhase,
  type FitnessSelection,
  type WowItem,
} from '@/charts';
import { formatDayMonth, formatIsoWeek, formatNumber, formatPercent, formatSigned, weekdayShort } from '@/lib/format';
import { useCalendar } from '@/lib/queries/training';
import { spring, tween } from '@/motion/tokens';
import { Section, Segmented, Skeleton, StatRow, StatTile } from '@/ui';
import {
  METRIC_NAME,
  METRIC_VALUE,
  baselineOf,
  chartRange,
  filterWeeks,
  rangeLabel,
  rangeWeeks,
  sessionsDone,
  todayIndex,
  trimLeading,
  useApiToday,
  useConsistency,
  useFitness,
  useIntensity,
  useWeekly,
  wowSentence,
  type CompareKey,
  type Metric,
} from './data';
import { FilterPopover, InlineError, RangeControl, TitleLink, TrendsFrame, activeOf, compareFilter, compareGroup, sportFilter, sportGroup, useTrendsSearch } from './shared';

// ───────────────────────── formatting ─────────────────────────

export const fmtHours = (h: number) => {
  const m = Math.round(Math.abs(h) * 60);
  return `${h < 0 ? '−' : ''}${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};
const fmtInt = (v: number) => formatNumber(v, 0);
const fmtPct = (v: number) => formatPercent(v, { signed: true });

// ───────────────────────── to-date totals (same weekday comparisons) ─────────────────────────

interface Totals {
  hours: number;
  load: number;
  distanceM: number;
  sessions: number;
  key: number;
}

function totalsThrough(cal: Pick<CalendarResponse, 'activities' | 'workouts'> | undefined, start: LocalDate, through: LocalDate, sport?: Sport): Totals | null {
  if (!cal) return null;
  const acts = cal.activities.filter((a: Activity) => a.localDate >= start && a.localDate <= through && (!sport || a.sport === sport));
  const keyIds = new Set(cal.workouts.filter((w) => w.isKey && w.pairedActivityId).map((w) => w.pairedActivityId!));
  return {
    hours: acts.reduce((s, a) => s + (a.movingSec || a.durationSec), 0) / 3600,
    load: acts.reduce((s, a) => s + a.load, 0),
    distanceM: acts.reduce((s, a) => s + (a.distanceM ?? 0), 0),
    sessions: acts.length,
    key: acts.filter((a) => a.isKey || keyIds.has(a.id)).length,
  };
}

const weekTotals = (w: WeekSummary): Totals => ({ hours: w.doneSec / 3600, load: w.doneLoad, distanceM: w.doneDistanceM, sessions: sessionsDone(w), key: w.keyDone });

const METRIC_OPTIONS = (['hours', 'load', 'distance'] as Metric[]).map((m) => ({ value: m, label: METRIC_NAME[m] }));

// ───────────────────────── page ─────────────────────────

export function OverviewPage() {
  const { search, set } = useTrendsSearch();
  const range = search.range ?? '12w';
  const compare: CompareKey = search.compare ?? 'prev';
  const metric: Metric = search.metric ?? 'hours';
  const sport = search.sport;
  const navigate = useNavigate();
  const { today } = useApiToday();
  const weekly = useWeekly(104);
  const fitness = useFitness(today, sport);
  const consistency = useConsistency(365);

  const all = useMemo(() => filterWeeks(trimLeading(weekly.data ?? []), sport), [weekly.data, sport]);
  const nWeeks = rangeWeeks(range);
  const weeks = useMemo(() => all.slice(-nWeeks), [all, nWeeks]);
  const sports = useMemo(() => {
    const s = new Set<Sport>();
    (weekly.data ?? []).slice(-nWeeks).forEach((w) => w.bySport.forEach((x) => x.doneSec > 0 && s.add(x.sport)));
    if (sport) s.add(sport);
    return [...s];
  }, [weekly.data, nWeeks, sport]);
  const weekSync = useMemo(() => createHoverSync<string>(), []);
  const intensity = useIntensity(Math.min(104, nWeeks));
  const intensityItems = useMemo(
    () => (intensity.data?.weeks ?? []).filter((w) => w.easy + w.moderate + w.hard > 0).map((w) => ({ key: w.isoWeek, label: formatDayMonth(w.startDate), easy: w.easy, moderate: w.moderate, hard: w.hard })),
    [intensity.data],
  );
  const openWeek = (w: string) => navigate({ to: '/week/$isoWeek', params: { isoWeek: w } });

  const first = weeks[0];
  const last = weeks[weeks.length - 1];
  const eyebrow = first && last ? `${rangeLabel(range)} · ${formatDayMonth(first.startDate)} – ${formatDayMonth(last.endDate)}` : rangeLabel(range);
  const filters = activeOf(sportFilter(sport, () => set({ sport: undefined })), compareFilter(compare, () => set({ compare: undefined })));

  return (
    <TrendsFrame
      title="Trends"
      eyebrow={eyebrow}
      filters={filters}
      toolbar={
        <>
          <RangeControl value={range} onChange={(r) => set({ range: r })} />
          <FilterPopover active={filters.length} groups={[compareGroup(compare, (c) => set({ compare: c === 'prev' ? undefined : c })), sportGroup(sports, sport, (s) => set({ sport: s }))]} />
        </>
      }
    >
      {weekly.isError ? (
        <InlineError onRetry={() => weekly.refetch()}>Couldn't load your weekly totals.</InlineError>
      ) : (
        <Headline all={all} today={today} compare={compare} sport={sport} fitness={fitness.data?.days} loading={!weekly.data} />
      )}

      <FitnessSection data={fitness.data} loading={!fitness.data} error={fitness.isError} retry={() => fitness.refetch()} range={range} onRange={(r) => set({ range: r })} today={today} sport={sport} />

      <Section
        title={<TitleLink to="/trends/volume">Weekly volume</TitleLink>}
        description={`Completed ${metric === 'hours' ? 'hours' : metric === 'load' ? 'load' : 'distance'} per week, ${sport ? 'this sport only' : 'all sports'}. Click a week to review it.`}
        actions={<Segmented aria-label="Metric" size="sm" value={metric} onValueChange={(m) => set({ metric: m })} options={METRIC_OPTIONS} />}
      >
        {weekly.isError ? (
          <InlineError onRetry={() => weekly.refetch()} />
        ) : (
          <WeeklyBars weeks={weeks} loading={!weekly.data} metric={metric} onMetricChange={(m) => set({ metric: m })} showMetricToggle={false} stack="total" sync={weekSync} height={240} onWeekClick={openWeek} />
        )}
      </Section>

      <WowSection all={all} weeks={weeks} metric={metric} compare={compare} sync={weekSync} loading={!weekly.data} onMetric={(m) => set({ metric: m })} onOpen={openWeek} />

      <Section title={<TitleLink to="/trends/intensity">Intensity distribution</TitleLink>} description={`Easy, moderate and hard time per week${sport ? ', all sports' : ''}.`}>
        {intensity.isError ? (
          <InlineError onRetry={() => intensity.refetch()} />
        ) : (
          <IntensityDistribution items={intensityItems} loading={!intensity.data} sync={weekSync} height={180} onItemClick={openWeek} />
        )}
      </Section>

      <Section title="Consistency" description={<ConsistencyLine data={consistency.data} />}>
        {consistency.isError ? (
          <InlineError onRetry={() => consistency.refetch()} />
        ) : !consistency.data ? (
          <Skeleton className="h-[150px] w-full" />
        ) : (
          <ConsistencyHeatmap
            days={consistency.data.days.map((d) => ({ date: d.date, load: d.load, sessions: d.count, key: d.key }))}
            today={consistency.data.to}
            onDayClick={(d) => navigate({ to: '/calendar/day/$date', params: { date: d } })}
            showStreaks={false}
          />
        )}
      </Section>
    </TrendsFrame>
  );
}

// ───────────────────────── headline figures ─────────────────────────

/**
 * Hours, Load, Fitness, Form for this week, each with one line of context (its change against the
 * chosen comparison). Distance, sessions and key sessions live on the week review (linked).
 */
function Headline({ all, today, compare, sport, fitness, loading }: { all: WeekSummary[]; today?: LocalDate; compare: CompareKey; sport?: Sport; fitness?: FitnessDay[]; loading: boolean }) {
  const idx = all.length - 1;
  const cur = all[idx];
  const dow = today && cur && today <= cur.endDate ? isoWeekday(today) : 7;
  const inProgress = dow < 7;
  const ws = cur?.startDate;
  // Calendar window: the 4 previous weeks + this one (to-date comparisons), and last year's week.
  const calFrom = ws ? addDays(ws, -28) : '1970-01-01';
  const cal = useCalendar(calFrom, ws ? addDays(ws, 6) : '1970-01-01', { enabled: !!ws });
  const lyStart = ws ? weekStart(addDays(ws, -364)) : '1970-01-01';
  const calLy = useCalendar(lyStart, addDays(lyStart, 6), { enabled: !!ws && compare === 'year' });

  const curT = cur ? weekTotals(cur) : null;
  const base: Totals | null = useMemo(() => {
    if (!ws) return null;
    const through = (start: LocalDate) => addDays(start, dow - 1);
    if (compare === 'prev') return totalsThrough(cal.data, addDays(ws, -7), through(addDays(ws, -7)), sport);
    if (compare === 'avg') {
      const parts = [1, 2, 3, 4].map((k) => totalsThrough(cal.data, addDays(ws, -7 * k), through(addDays(ws, -7 * k)), sport));
      if (parts.some((p) => !p)) return null;
      const avg = (f: (t: Totals) => number) => parts.reduce((s, p) => s + f(p!), 0) / 4;
      return { hours: avg((t) => t.hours), load: avg((t) => t.load), distanceM: avg((t) => t.distanceM), sessions: avg((t) => t.sessions), key: avg((t) => t.key) };
    }
    const t = totalsThrough(calLy.data, lyStart, through(lyStart), sport);
    return t && (t.sessions > 0 ? t : null);
  }, [cal.data, calLy.data, compare, ws, dow, sport, lyStart]);
  const baseLoading = compare === 'year' ? calLy.isPending : cal.isPending;

  const pct = (a?: number, b?: number | null) => (a == null || b == null ? null : b > 0 ? a / b - 1 : a > 0 ? null : 0);
  const refText = (v: string) => `vs ${v}`;
  const noBase = baseLoading ? '' : compare === 'year' ? 'no data last year' : 'no earlier weeks yet';

  const fIdx = fitness ? todayIndex(fitness, today) : -1;
  const fd = fIdx >= 0 ? fitness![fIdx] : null;
  const lag = compare === 'prev' ? 7 : compare === 'avg' ? 28 : 364;
  const fPrev = fIdx >= 0 && fIdx - lag >= 0 ? fitness![fIdx - lag] : null;
  const lagLabel = compare === 'prev' ? 'in 7 days' : compare === 'avg' ? 'in 4 weeks' : 'in a year';
  const zone = fd?.formZone ? fd.formZone[0].toUpperCase() + fd.formZone.slice(1) : null;
  const hoursDelta = pct(curT?.hours, base?.hours);
  const loadDelta = pct(curT?.load, base?.load);

  const basis = compare === 'prev' ? (inProgress && today ? `last week by ${weekdayShort(today)}` : 'last week') : compare === 'avg' ? 'the 4-week average' : 'the same week last year';
  const description = cur ? `${formatIsoWeek(cur.isoWeek)}${inProgress ? ` · ${7 - dow} day${7 - dow === 1 ? '' : 's'} to go` : ''}${sport ? ' · this sport only' : ''} · changes against ${basis}` : undefined;

  return (
    <Section
      title="This week"
      description={description}
      actions={
        cur ? (
          <Link to="/week/$isoWeek" params={{ isoWeek: cur.isoWeek }} className="group inline-flex h-7 items-center gap-1 rounded-md px-2 text-label text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg-1">
            Week review <ArrowRight className="size-3.5 transition-transform duration-(--dur-fast) group-hover:translate-x-0.5" aria-hidden />
          </Link>
        ) : null
      }
    >
      <StatRow columns={4}>
        {loading || !cur || !curT ? (
          Array.from({ length: 4 }, (_, i) => <StatTile.Skeleton key={i} />)
        ) : (
          <>
            <StatTile label="Hours" value={curT.hours} format={fmtHours} unit="h" delta={hoursDelta} hint={base ? refText(fmtHours(base.hours)) : noBase} />
            <StatTile
              label="Load"
              value={curT.load}
              format={fmtInt}
              delta={loadDelta}
              warning={(loadDelta ?? 0) > 0.15 && !inProgress}
              hint={base ? refText(fmtInt(base.load)) : noBase}
            />
            <StatTile label="Fitness" value={fd?.fitness ?? null} format={fmtInt} delta={fd && fPrev ? fd.fitness - fPrev.fitness : null} deltaKind="number" good={!!fd && !!fPrev && fd.fitness > fPrev.fitness} hint={fPrev ? lagLabel : ''} />
            <StatTile label="Form" value={fd?.form ?? null} format={(v) => formatSigned(Math.round(v))} delta={fd && fPrev ? fd.form - fPrev.form : null} deltaKind="number" hint={zone ?? ''} />
          </>
        )}
      </StatRow>
    </Section>
  );
}

// ───────────────────────── fitness ─────────────────────────

type FitnessData = ReturnType<typeof useFitness>['data'];

export function chartEvents(data: FitnessData): ChartEvent[] {
  if (!data) return [];
  const ev: ChartEvent[] = data.events.map((e) => ({ date: e.date, label: e.name.replace(/ (Triathlon|Marathon)$/, ''), priority: e.priority }));
  const thr = data.thresholdChanges.filter((t) => t.kind === 'ftp' || t.kind === 'run_threshold' || t.kind === 'swim_css');
  for (const t of thr) ev.push({ date: t.effectiveFrom, label: t.kind === 'ftp' ? `FTP ${Math.round(t.value)}` : t.kind === 'swim_css' ? 'CSS test' : 'Run test', kind: 'threshold' });
  return ev;
}
export const chartPhases = (data: FitnessData): ChartPhase[] => (data ? data.phases.map((p) => ({ startDate: p.startDate, endDate: p.endDate, label: p.label })) : []);

/** One plain sentence: is fitness building over the range, and where does the plan take it? */
function fitnessSentence(data: FitnessData, today: LocalDate | undefined, rangeDays: number): string | null {
  if (!data?.days.length) return null;
  const days = data.days;
  const ti = todayIndex(days, today);
  const now = days[ti];
  const then = days[Math.max(0, ti - rangeDays)];
  if (!now || !then) return null;
  const d = now.fitness - then.fitness;
  const span = rangeDays >= 300 ? 'in a year' : rangeDays >= 150 ? 'in 6 months' : `in ${Math.round(rangeDays / 7)} weeks`;
  const trend = Math.abs(d) < 1 ? `Fitness held steady ${span}` : `Fitness ${d > 0 ? 'rose' : 'fell'} ${formatNumber(Math.abs(d), 0)} ${span}, to ${formatNumber(now.fitness, 0)}`;
  const next = data.events.find((e) => today && e.date > today && (e.priority === 'A' || e.priority === 'B'));
  return next ? `${trend}. Dashed lines follow the plan to ${next.name.replace(/ (Triathlon|Marathon)$/, '')} on ${formatDayMonth(next.date)}.` : `${trend}.`;
}

const RANGE_DAYS: Record<string, number> = { '6w': 42, '12w': 84, '3m': 91, '6m': 182, '1y': 365, all: 730 };

function FitnessSection({ data, loading, error, retry, range, onRange, today, sport }: { data: FitnessData; loading: boolean; error: boolean; retry: () => void; range: ReturnType<typeof useTrendsSearch>['search']['range'] & string; onRange: (r: '6w' | '12w' | '6m' | '1y' | 'all') => void; today?: LocalDate; sport?: Sport }) {
  const [sel, setSel] = useState<FitnessSelection | null>(null);
  const events = useMemo(() => chartEvents(data), [data]);
  const phases = useMemo(() => chartPhases(data), [data]);
  const sentence = fitnessSentence(data, today, RANGE_DAYS[range] ?? 84);
  return (
    <Section title={<TitleLink to="/trends/fitness">Fitness · Fatigue · Form</TitleLink>} description={sentence ?? (sport ? 'From this sport only.' : 'Is fitness building, and am I fresh?')}>
      {error ? (
        <InlineError onRetry={retry} />
      ) : (
        // Today's Fitness and Form are the headline figures above; the chart's own readout would repeat them.
        <FitnessChart days={data?.days ?? []} loading={loading} today={today} range={chartRange(range)} onRangeChange={onRange} showRangeControl={false} showHeader={false} events={events} phases={phases} height={260} onSelect={setSel} />
      )}
      <SelectionReadout sel={sel} />
    </Section>
  );
}

/** Measured block under a Fitness chart: appears only while a range is selected (drag on the plot). */
export function SelectionReadout({ sel }: { sel: FitnessSelection | null }) {
  return (
    <AnimatePresence initial={false}>
      {sel && (
        <motion.div
          key="sel"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto', transition: spring.smooth }}
          exit={{ opacity: 0, height: 0, transition: tween('fast', 'in') }}
          className="overflow-hidden"
        >
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 pt-4 text-body-sm">
            <span className="font-medium text-fg-1">
              {formatDayMonth(sel.from)} – {formatDayMonth(sel.to)} <span className="font-normal text-fg-3">· {sel.days} days</span>
            </span>
            <Stat label="Load">{fmtInt(sel.load)}</Stat>
            <Stat label="per day">{fmtInt(sel.avgLoad)}</Stat>
            <Stat label="Fitness">{formatSigned(sel.fitnessDelta, 1)}</Stat>
            <Stat label="Fatigue">{formatSigned(sel.fatigueDelta, 1)}</Stat>
            <Stat label="Form at end">{formatSigned(Math.round(sel.formEnd))}</Stat>
            <span className="text-fg-3 max-md:hidden">Esc clears</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-fg-3">{label}</span>
      <span className="text-fg-1">{children}</span>
    </span>
  );
}

// ───────────────────────── week over week ─────────────────────────

const fmtM = (m: Metric, v: number) => (m === 'hours' ? `${fmtHours(v)} h` : m === 'load' ? fmtInt(v) : `${fmtInt(v)} km`);

function WowSection({ all, weeks, metric, compare, sync, loading, onMetric, onOpen }: { all: WeekSummary[]; weeks: WeekSummary[]; metric: Metric; compare: CompareKey; sync: ReturnType<typeof createHoverSync<string>>; loading: boolean; onMetric: (m: Metric) => void; onOpen: (w: string) => void }) {
  const f = METRIC_VALUE[metric];
  const complete = weeks.filter((w) => !w.isProjected);
  const items: WowItem[] = complete.map((w) => {
    const i = all.indexOf(w);
    const b = baselineOf(all, i, compare, f);
    const v = f(w);
    return { key: w.isoWeek, label: formatDayMonth(w.startDate), value: b && b > 0 ? v / b - 1 : null, detail: b != null ? `${fmtM(metric, v)} vs ${fmtM(metric, b)}` : undefined };
  });
  const vals = items.map((i) => i.value).filter((v): v is number => v != null);
  const lastV = vals.at(-1);
  const above = vals.filter((v) => v > 0.02).length;
  const sentence =
    compare === 'prev' || lastV == null
      ? wowSentence(METRIC_NAME[metric], items.map((i) => i.value), fmtPct)
      : `Last week's ${METRIC_NAME[metric].toLowerCase()} was ${fmtPct(lastV)} ${compare === 'avg' ? 'against the 4 weeks before it' : 'against the same week last year'}; ${above} of ${vals.length} weeks came in above.`;
  const lastItem = [...items].reverse().find((i) => i.value != null);
  // A calmer read under the headline: the last 4 complete weeks against the 4 before them.
  const four = (k: number) => {
    const ws = complete.slice(complete.length - 4 * (k + 1), complete.length - 4 * k);
    return ws.length === 4 ? ws.reduce((a, w) => a + f(w), 0) / 4 : null;
  };
  const a4 = four(0);
  const b4 = four(1);
  const trend4 = a4 != null && b4 ? ` The last 4 weeks averaged ${fmtM(metric, a4)}, ${fmtPct(a4 / b4 - 1)} on the 4 before.` : '';
  return (
    <Section title="Week-over-week progression" actions={<Segmented aria-label="Progression metric" size="sm" value={metric} onValueChange={onMetric} options={METRIC_OPTIONS} />}>
      <div className="flex flex-col gap-2">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p key={sentence} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0, transition: spring.smooth }} exit={{ opacity: 0, transition: tween('fast', 'in') }} className="max-w-[60ch] text-title-2 font-medium text-fg-1">
            {sentence}
          </motion.p>
        </AnimatePresence>
        <p className="text-body text-fg-2">
          {lastItem?.detail ? `Last week: ${lastItem.detail}.` : ''}
          {trend4}
        </p>
      </div>
      <div className="mt-8">
        <WowDeltaBars items={items} loading={loading} sync={sync} height={180} onItemClick={onOpen} />
      </div>
    </Section>
  );
}

// ───────────────────────── consistency ─────────────────────────

function ConsistencyLine({ data }: { data: ReturnType<typeof useConsistency>['data'] }) {
  if (!data) return <>Did I show up?</>;
  const s = data.streaks;
  const trained = data.days.filter((d) => d.count > 0).length;
  const best = s.currentWeeks3 >= s.longestWeeks3 && s.currentWeeks3 > 1;
  return (
    <span title={`Training days in a row: ${s.currentDays} (best ${s.longestDays}). Longest run of weeks with 3+ sessions: ${s.longestWeeks3}. Days since the last full rest day: ${s.daysSinceRest}.`}>
      {s.currentWeeks3} week{s.currentWeeks3 === 1 ? '' : 's'} in a row with 3+ sessions{best ? ', your best' : ` (best ${s.longestWeeks3})`} · {trained} of {data.days.length} days trained
    </span>
  );
}
