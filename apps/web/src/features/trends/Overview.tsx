/**
 * /trends — the overview. Top-down story: this week vs the comparison (tiles), Fitness · Fatigue ·
 * Form, weekly volume, week-over-week progression, intensity distribution, consistency.
 */
import type { Activity, CalendarResponse, FitnessDay, LocalDate, Sport, WeekSummary } from '@cadence/core';
import { addDays, isoWeekday, isoWeekOf, weekStart } from '@cadence/core/time';
import { useNavigate } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { useMemo, useState, type ReactNode } from 'react';
import {
  ConsistencyHeatmap,
  FitnessChart,
  IntensityDistribution,
  SparkBars,
  WeeklyBars,
  WowDeltaBars,
  createHoverSync,
  type ChartEvent,
  type ChartPhase,
  type FitnessSelection,
  type WowItem,
} from '@/charts';
import { cn } from '@/lib/cn';
import { formatDateMedium, formatDayMonth, formatIsoWeek, formatNumber, formatPercent, formatSigned, weekdayShort } from '@/lib/format';
import { useCalendar } from '@/lib/queries/training';
import { distanceUnit, useUnits } from '@/lib/units';
import { Ticker } from '@/motion/Ticker';
import { spring } from '@/motion/tokens';
import { DeltaBadge, FormZoneLabel, Meter, Skeleton, Tooltip } from '@/ui';
import {
  COMPARE_LABEL,
  METRIC_NAME,
  METRIC_VALUE,
  baselineOf,
  chartRange,
  filterWeeks,
  rampBand,
  rangeLabel,
  rangeWeeks,
  sessionsDone,
  sessionsPlanned,
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
import { ChartCard, CompareControl, InlineError, RangeControl, SportChips, TrendsFrame, useTrendsSearch } from './shared';

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
    const set = new Set<Sport>();
    (weekly.data ?? []).slice(-nWeeks).forEach((w) => w.bySport.forEach((s) => s.doneSec > 0 && set.add(s.sport)));
    return [...set];
  }, [weekly.data, nWeeks]);
  const weekSync = useMemo(() => createHoverSync<string>(), []);
  const intensity = useIntensity(Math.min(104, nWeeks));
  const intensityItems = useMemo(
    () => (intensity.data?.weeks ?? []).filter((w) => w.easy + w.moderate + w.hard > 0).map((w) => ({ key: w.isoWeek, label: formatDayMonth(w.startDate), easy: w.easy, moderate: w.moderate, hard: w.hard })),
    [intensity.data],
  );

  const first = weeks[0];
  const last = weeks[weeks.length - 1];
  const eyebrow = first && last ? `${rangeLabel(range)} · ${formatIsoWeek(first.isoWeek)}–${formatIsoWeek(last.isoWeek)} · ${formatDayMonth(first.startDate)} – ${formatDayMonth(last.endDate)}` : rangeLabel(range);

  return (
    <TrendsFrame
      title="Trends"
      eyebrow={eyebrow}
      controls={
        <>
          <RangeControl value={range} onChange={(r) => set({ range: r })} />
          <CompareControl value={compare} onChange={(c) => set({ compare: c })} />
          <SportChips sports={sports} value={sport} onChange={(s) => set({ sport: s })} />
        </>
      }
    >
      <section aria-label="This week">
        {weekly.isError ? (
          <InlineError onRetry={() => weekly.refetch()}>Couldn't load your weekly totals.</InlineError>
        ) : (
          <WowTiles all={all} today={today} compare={compare} sport={sport} fitness={fitness.data?.days} loading={!weekly.data} />
        )}
      </section>

      <FitnessSection data={fitness.data} loading={!fitness.data} error={fitness.isError} retry={() => fitness.refetch()} range={range} onRange={(r) => set({ range: r })} today={today} sport={sport} />

      <section>
        <ChartCard title="Weekly volume" to="/trends/volume" question="How much am I training, in which sports, and is it trending up?">
          <WeeklyBars
            weeks={weeks}
            loading={!weekly.data}
            metric={metric}
            onMetricChange={(m) => set({ metric: m })}
            sync={weekSync}
            height={240}
            onWeekClick={(w) => navigate({ to: '/week/$isoWeek', params: { isoWeek: w } })}
          />
        </ChartCard>
      </section>

      <section className="grid gap-6 lg:grid-cols-12">
        <WowSection all={all} weeks={weeks} metric={metric} compare={compare} sync={weekSync} loading={!weekly.data} onMetric={(m) => set({ metric: m })} onOpen={(w) => navigate({ to: '/week/$isoWeek', params: { isoWeek: w } })} />
        <ChartCard className="lg:col-span-5" title="Intensity distribution" to="/trends/intensity" question={`Easy, moderate and hard time per week${sport ? ' (all sports)' : ''}. Polarized, pyramidal or drifting into the grey zone?`}>
          <IntensityDistribution items={intensityItems} loading={!intensity.data} sync={weekSync} height={168} onItemClick={(w) => navigate({ to: '/week/$isoWeek', params: { isoWeek: w } })} />
        </ChartCard>
      </section>

      <section>
        <ChartCard title="Consistency" question="Did I show up? Every day of the last year, tone = Load, dot = key session.">
          {consistency.isError ? (
            <InlineError onRetry={() => consistency.refetch()} />
          ) : (
            <ConsistencySection data={consistency.data} onDay={(d) => navigate({ to: '/calendar/day/$date', params: { date: d } })} />
          )}
        </ChartCard>
      </section>
    </TrendsFrame>
  );
}

// ───────────────────────── WoW tiles ─────────────────────────

function WowTiles({ all, today, compare, sport, fitness, loading }: { all: WeekSummary[]; today?: LocalDate; compare: CompareKey; sport?: Sport; fitness?: FitnessDay[]; loading: boolean }) {
  const units = useUnits();
  const du = distanceUnit('run', units);
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

  const spark = (f: (w: WeekSummary) => number, proj?: (w: WeekSummary) => number) => {
    const ws12 = all.slice(-12);
    return { values: ws12.map(f), planned: proj ? ws12.map((w) => (w.isProjected ? proj(w) : 0)) : undefined };
  };
  const pct = (a?: number, b?: number | null) => (a == null || b == null ? null : b > 0 ? a / b - 1 : a > 0 ? null : 0);
  const byDay = inProgress ? ` by ${today ? weekdayShort(today) : ''}` : '';
  const refText = (v: string) =>
    compare === 'prev' ? `vs ${v}${byDay} last wk` : compare === 'avg' ? `vs ${v} 4-wk avg${byDay}` : `vs ${v}${byDay} last year`;
  const noBase = compare === 'year' ? 'No data for this week last year' : 'No earlier weeks yet';

  const fIdx = fitness ? todayIndex(fitness, today) : -1;
  const fd = fIdx >= 0 ? fitness![fIdx] : null;
  const lag = compare === 'prev' ? 7 : compare === 'avg' ? 28 : 364;
  const fPrev = fIdx >= 0 && fIdx - lag >= 0 ? fitness![fIdx - lag] : null;
  const fSpark = fitness && fIdx >= 0 ? fitness.slice(Math.max(0, fIdx - 83), fIdx + 1).filter((_, i) => i % 7 === 6 || i === Math.min(83, fIdx)) : [];
  const lagLabel = compare === 'prev' ? 'vs 7 days ago' : compare === 'avg' ? 'vs 4 weeks ago' : 'vs a year ago';
  const band = rampBand(fd?.ramp);

  const tiles: ReactNode[] = cur && curT
    ? [
        <WowTile key="h" label="Hours" value={curT.hours} format={fmtHours} unit="h" delta={pct(curT.hours, base?.hours)} refText={base ? refText(fmtHours(base.hours)) : baseLoading ? '' : noBase} spark={spark((w) => w.doneSec / 3600, (w) => w.projectedSec / 3600)} plan={cur.isProjected ? { done: curT.hours, total: cur.projectedSec / 3600, fmt: fmtHours, target: cur.targetHours } : undefined} />,
        <WowTile key="l" label="Load" value={curT.load} format={fmtInt} delta={pct(curT.load, base?.load)} refText={base ? refText(fmtInt(base.load)) : baseLoading ? '' : noBase} spark={spark((w) => w.doneLoad, (w) => w.projectedLoad)} plan={cur.isProjected ? { done: curT.load, total: cur.projectedLoad, fmt: fmtInt, target: cur.targetLoad } : undefined} signal good={(pct(curT.load, base?.load) ?? 0) > 0 && (pct(curT.load, base?.load) ?? 0) <= 0.15} warning={(pct(curT.load, base?.load) ?? 0) > 0.15 && !inProgress} />,
        <WowTile key="d" label="Distance" value={curT.distanceM / du.mPer} format={fmtInt} unit={du.unit} delta={pct(curT.distanceM, base?.distanceM)} refText={base ? refText(`${fmtInt(base.distanceM / du.mPer)} ${du.unit}`) : baseLoading ? '' : noBase} spark={spark((w) => w.doneDistanceM, (w) => Math.max(w.doneDistanceM, w.plannedDistanceM))} plan={cur.isProjected ? { done: curT.distanceM / du.mPer, total: Math.max(cur.doneDistanceM, cur.plannedDistanceM) / du.mPer, fmt: fmtInt } : undefined} />,
        <WowTile key="s" label="Sessions" value={curT.sessions} format={fmtInt} delta={base ? curT.sessions - base.sessions : null} deltaKind="number" refText={base ? refText(formatNumber(base.sessions, compare === 'avg' ? 1 : 0, { trim: true })) : baseLoading ? '' : noBase} spark={spark(sessionsDone, (w) => Math.max(sessionsDone(w), sessionsPlanned(w)))} plan={cur.isProjected ? { done: curT.sessions, total: Math.max(curT.sessions, sessionsPlanned(cur)), fmt: fmtInt } : undefined} />,
        <WowTile
          key="k"
          label="Key sessions"
          value={cur.keyDone}
          format={fmtInt}
          unit={`/ ${cur.keyPlanned}`}
          delta={base ? cur.keyDone - base.key : null}
          deltaKind="number"
          refText={base ? refText(formatNumber(base.key, compare === 'avg' ? 1 : 0, { trim: true })) : baseLoading ? '' : noBase}
          spark={spark((w) => w.keyDone, (w) => w.keyPlanned)}
          plan={cur.keyPlanned ? { done: cur.keyDone, total: cur.keyPlanned, fmt: fmtInt, label: cur.keyDone >= cur.keyPlanned ? 'All key sessions hit' : `${cur.keyPlanned - cur.keyDone} still to do` } : undefined}
          good={cur.keyPlanned > 0 && cur.keyDone >= cur.keyPlanned}
        />,
        <WowTile
          key="f"
          label="Fitness"
          value={fd?.fitness ?? null}
          format={(v) => formatNumber(v, 0)}
          delta={fd && fPrev ? fd.fitness - fPrev.fitness : null}
          deltaKind="number"
          refText={fPrev ? `${lagLabel} (${formatNumber(fPrev.fitness, 0)})` : ''}
          sparkLine={fSpark.map((d) => d.fitness)}
          signal
          good={!!fd && !!fPrev && fd.fitness > fPrev.fitness}
          footer={fd?.ramp != null ? <RampBand ramp={fd.ramp} band={band} /> : null}
        />,
        <WowTile key="fa" label="Fatigue" value={fd?.fatigue ?? null} format={(v) => formatNumber(v, 0)} delta={fd && fPrev ? fd.fatigue - fPrev.fatigue : null} deltaKind="number" refText={fPrev ? `${lagLabel} (${formatNumber(fPrev.fatigue, 0)})` : ''} sparkLine={fSpark.map((d) => d.fatigue)} footer={<span className="text-body-sm text-fg-3">7-day load average</span>} />,
        <WowTile
          key="fo"
          label="Form"
          value={fd?.form ?? null}
          format={(v) => formatSigned(Math.round(v))}
          delta={fd && fPrev ? fd.form - fPrev.form : null}
          deltaKind="number"
          refText={fPrev ? `${lagLabel} (${formatSigned(Math.round(fPrev.form))})` : ''}
          sparkLine={fSpark.map((d) => d.form)}
          footer={
            <span className="inline-flex items-center gap-2">
              <FormZoneLabel zone={fd?.formZone} />
              {fd?.formPct != null && <span className="font-mono text-mono-sm text-fg-3">{formatSigned(Math.round(fd.formPct))}%</span>}
            </span>
          }
        />,
      ]
    : [];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-title-3 text-fg-1">
          {cur ? (
            <>
              This week <span className="text-fg-3">· {formatIsoWeek(cur.isoWeek)}{inProgress ? ` · so far, ${7 - dow} day${7 - dow === 1 ? '' : 's'} to go` : ''}</span>
            </>
          ) : (
            'This week'
          )}
        </h2>
        <span className="text-micro uppercase text-fg-3">{COMPARE_LABEL[compare]}{inProgress && compare !== 'year' ? ' · same weekday' : ''}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {loading || !tiles.length
          ? Array.from({ length: 8 }, (_, i) => <TileSkeleton key={i} />)
          : tiles.map((t, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.smooth, delay: Math.min(i * 0.035, 0.24) }} className="min-w-0">
                {t}
              </motion.div>
            ))}
      </div>
    </div>
  );
}

function TileSkeleton() {
  return (
    <div className="flex h-[158px] flex-col gap-2 rounded-lg border border-line-1 bg-surface-1 p-4" aria-hidden>
      <Skeleton className="h-3.5 w-16" />
      <Skeleton className="h-9 w-24" />
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-auto h-1 w-full" />
    </div>
  );
}

function WowTile({
  label,
  value,
  format,
  unit,
  delta,
  deltaKind = 'percent',
  refText,
  spark,
  sparkLine,
  plan,
  signal,
  good,
  warning,
  footer,
}: {
  label: string;
  value: number | null;
  format: (v: number) => string;
  unit?: string;
  delta: number | null;
  deltaKind?: 'percent' | 'number';
  refText: string;
  spark?: { values: number[]; planned?: number[] };
  sparkLine?: number[];
  plan?: { done: number; total: number; fmt: (v: number) => string; target?: number; label?: string };
  signal?: boolean;
  good?: boolean;
  warning?: boolean;
  footer?: ReactNode;
}) {
  return (
    <div className="spotlight flex h-full min-h-[158px] min-w-0 flex-col gap-2 rounded-lg border border-line-1 bg-surface-1 p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="truncate text-micro uppercase text-fg-3">{label}</span>
        {spark && spark.values.length > 1 && <SparkBars values={spark.values} planned={spark.planned} todayIndex={spark.values.length - 1} barWidth={4} gap={2} height={18} ariaLabel={`${label}, last ${spark.values.length} weeks`} className="max-sm:hidden" />}
        {sparkLine && sparkLine.length > 1 && <MiniLine values={sparkLine} accent={signal} />}
      </div>
      <div className={cn('flex min-w-0 items-baseline gap-1 text-stat-md', signal ? 'text-accent-ink' : 'text-fg-1')}>
        {value == null ? <span className="text-fg-4">—</span> : <Ticker value={value} format={format} />}
        {unit && <span className="text-[1.05rem] font-[450] tracking-normal text-fg-3">{unit}</span>}
      </div>
      <div className="flex min-h-5 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <DeltaBadge value={delta} kind={deltaKind} good={good} warning={warning} decimals={deltaKind === 'number' && delta != null && Math.abs(delta) < 10 && !Number.isInteger(delta) ? 1 : 0} />
        <span className="truncate text-body-sm text-fg-3">{refText}</span>
      </div>
      <div className="mt-auto pt-1">
        {plan ? (
          <div className="flex flex-col gap-1.5">
            <Meter value={plan.done} max={plan.total} ghost={plan.total} target={plan.target} size="xs" aria-label={`${label}: ${plan.fmt(plan.done)} of ${plan.fmt(plan.total)}`} />
            <span className="truncate font-mono text-mono-sm text-fg-3">
              {plan.label ?? (
                <>
                  <span className="text-fg-4">on track for</span> {plan.fmt(plan.total)}{plan.target ? ` · target ${plan.fmt(plan.target)}` : ''}
                </>
              )}
            </span>
          </div>
        ) : (
          footer
        )}
      </div>
    </div>
  );
}

/** 64×18 line sparkline (weekly samples), accent for load-like series. */
function MiniLine({ values, accent }: { values: number[]; accent?: boolean }) {
  const w = 64;
  const h = 18;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (w - 3) + 1.5, 2 + (1 - (v - lo) / (hi - lo || 1)) * (h - 4)] as const);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const lp = pts[pts.length - 1];
  return (
    <svg width={w} height={h} className="block shrink-0 overflow-visible max-sm:hidden" aria-hidden>
      <motion.path d={d} fill="none" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={accent ? 'stroke-accent' : 'stroke-fg-2'} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={spring.gentle} />
      <circle cx={lp[0]} cy={lp[1]} r={2.2} className={accent ? 'fill-accent' : 'fill-fg-1'} />
    </svg>
  );
}

/** Ramp/wk with the guidance band (≤5 normal · 5–8 aggressive · >8 risky). */
function RampBand({ ramp, band }: { ramp: number; band: string | null }) {
  const min = -6;
  const max = 12;
  const pos = (v: number) => ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * 100;
  const segs = [
    { a: min, b: 0, cls: 'bg-surface-3' },
    { a: 0, b: 5, cls: 'bg-accent-a3' },
    { a: 5, b: 8, cls: 'bg-hatch-fg bg-surface-3' },
    { a: 8, b: max, cls: 'bg-fg-3' },
  ];
  return (
    <Tooltip content="Ramp = Fitness change over 7 days. Up to +5/wk is a sustainable build, 5–8 is aggressive, above 8 is risky.">
      <div className="flex flex-col gap-1.5" tabIndex={0}>
        <div className="relative flex h-1.5 gap-px overflow-visible">
          {segs.map((s) => (
            <span key={s.a} className={cn('h-full rounded-[1px]', s.cls)} style={{ width: `${((s.b - s.a) / (max - min)) * 100}%` }} />
          ))}
          <motion.span className="absolute -top-1 h-3.5 w-0.5 rounded-full bg-fg-1" initial={false} animate={{ left: `calc(${pos(ramp)}% - 1px)` }} transition={spring.smooth} />
        </div>
        <span className="font-mono text-mono-sm text-fg-3">
          Ramp <span className="text-fg-1">{formatSigned(ramp, 1)}</span>/wk · {band}
        </span>
      </div>
    </Tooltip>
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

function FitnessSection({ data, loading, error, retry, range, onRange, today, sport }: { data: FitnessData; loading: boolean; error: boolean; retry: () => void; range: ReturnType<typeof useTrendsSearch>['search']['range'] & string; onRange: (r: '6w' | '12w' | '6m' | '1y' | 'all') => void; today?: LocalDate; sport?: Sport }) {
  const [sel, setSel] = useState<FitnessSelection | null>(null);
  const events = useMemo(() => chartEvents(data), [data]);
  const phases = useMemo(() => chartPhases(data), [data]);
  const next = data?.events.find((e) => today && e.date > today && (e.priority === 'A' || e.priority === 'B'));
  return (
    <section>
      <ChartCard
        title={sport ? 'Fitness · Fatigue · Form (filtered)' : 'Fitness · Fatigue · Form'}
        to="/trends/fitness"
        question={next ? `Is fitness building? Dashed lines project your plan to ${next.name} (${formatDateMedium(next.date)}). Drag across the chart to measure a block.` : 'Is fitness building, and am I fresh or buried? Drag across the chart to measure a block.'}
      >
        {error ? (
          <InlineError onRetry={retry} />
        ) : (
          <FitnessChart days={data?.days ?? []} loading={loading} today={today} range={chartRange(range)} onRangeChange={onRange} showRangeControl={false} events={events} phases={phases} showRamp height={240} onSelect={setSel} />
        )}
        <SelectionReadout sel={sel} />
      </ChartCard>
    </section>
  );
}

export function SelectionReadout({ sel }: { sel: FitnessSelection | null }) {
  return (
    <motion.div initial={false} animate={{ opacity: sel ? 1 : 0.6 }} className="mt-3 flex min-h-11 flex-wrap items-center gap-x-6 gap-y-2 border-t border-line-1 pt-3">
      {sel ? (
        <>
          <span className="text-label text-fg-1">
            {formatDayMonth(sel.from)} – {formatDayMonth(sel.to)} <span className="text-fg-3">· {sel.days} days</span>
          </span>
          <Stat label="Load">{fmtInt(sel.load)}</Stat>
          <Stat label="Per day">{fmtInt(sel.avgLoad)}</Stat>
          <Stat label="Fitness">{formatSigned(sel.fitnessDelta, 1)}</Stat>
          <Stat label="Fatigue">{formatSigned(sel.fatigueDelta, 1)}</Stat>
          <Stat label="Form at end">{formatSigned(Math.round(sel.formEnd))}</Stat>
          <span className="text-body-sm text-fg-4 max-md:hidden">Esc or double-click clears</span>
        </>
      ) : (
        <span className="text-body-sm text-fg-3">Drag across the chart to measure a block: Load, Fitness gained and Form at the end.</span>
      )}
    </motion.div>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-micro uppercase text-fg-3">{label}</span>
      <span className="font-mono text-mono text-fg-1">{children}</span>
    </span>
  );
}

// ───────────────────────── week over week ─────────────────────────

function WowSection({ all, weeks, metric, compare, sync, loading, onMetric, onOpen }: { all: WeekSummary[]; weeks: WeekSummary[]; metric: Metric; compare: CompareKey; sync: ReturnType<typeof createHoverSync<string>>; loading: boolean; onMetric: (m: Metric) => void; onOpen: (w: string) => void }) {
  const f = METRIC_VALUE[metric];
  const offset = all.length - weeks.length;
  const complete = weeks.filter((w) => !w.isProjected);
  const items: WowItem[] = complete.map((w) => {
    const i = all.indexOf(w);
    const b = baselineOf(all, i, compare, f);
    const v = f(w);
    return { key: w.isoWeek, label: formatDayMonth(w.startDate), value: b && b > 0 ? v / b - 1 : null, detail: b != null ? `${fmtM(metric, v)} vs ${fmtM(metric, b)}` : undefined };
  });
  void offset;
  const vals = items.map((i) => i.value).filter((v): v is number => v != null);
  const lastV = vals.at(-1);
  const above = vals.filter((v) => v > 0.02).length;
  const sentence =
    compare === 'prev' || lastV == null
      ? wowSentence(METRIC_NAME[metric], items.map((i) => i.value), fmtPct)
      : `Last week's ${METRIC_NAME[metric].toLowerCase()} was ${fmtPct(lastV)} ${compare === 'avg' ? 'against the 4 weeks before it' : 'against the same week last year'}; ${above} of ${vals.length} weeks came in above.`;
  const name = { prev: 'the week before', avg: 'the previous 4-week average', year: 'the same week last year' }[compare];
  return (
    <ChartCard
      className="lg:col-span-7"
      title="Week-over-week progression"
      question={`Each complete week's ${METRIC_NAME[metric].toLowerCase()} against ${name}. Hatched bars are above the +15 % ramp caution line.`}
      actions={
        <div className="flex gap-1" role="group" aria-label="Metric">
          {(['hours', 'load', 'distance'] as Metric[]).map((m) => (
            <button key={m} type="button" aria-pressed={m === metric} onClick={() => onMetric(m)} className={cn('h-6 rounded-xs px-2 text-micro uppercase transition-colors', m === metric ? 'bg-surface-3 text-fg-1' : 'text-fg-3 hover:text-fg-1')}>
              {METRIC_NAME[m]}
            </button>
          ))}
        </div>
      }
    >
      <motion.p key={sentence} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={spring.smooth} className="mb-4 text-body-lg text-fg-1">
        {sentence}
      </motion.p>
      <WowDeltaBars items={items} loading={loading} sync={sync} height={150} onItemClick={onOpen} />
    </ChartCard>
  );
}

const fmtM = (m: Metric, v: number) => (m === 'hours' ? `${fmtHours(v)} h` : m === 'load' ? fmtInt(v) : `${fmtInt(v)} km`);

// ───────────────────────── consistency ─────────────────────────

function ConsistencySection({ data, onDay }: { data: ReturnType<typeof useConsistency>['data']; onDay: (d: LocalDate) => void }) {
  if (!data) return <Skeleton className="h-[150px] w-full" />;
  const s = data.streaks;
  const heat = data.days.map((d) => ({ date: d.date, load: d.load, sessions: d.count, key: d.key }));
  const year = data.days.filter((d) => d.count > 0).length;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
        <Streak value={s.currentWeeks3} unit="wk" label="Weeks with ≥ 3 sessions, in a row" best={s.longestWeeks3} />
        <Streak value={s.currentDays} unit="d" label="Training days in a row" best={s.longestDays} />
        <Streak value={s.daysSinceRest} unit="d" label="Since the last full rest day" />
        <Streak value={year} unit="d" label={`Days trained in the last ${data.days.length} days`} />
      </div>
      <ConsistencyHeatmap days={heat} today={data.to} onDayClick={onDay} showStreaks={false} />
    </div>
  );
}

function Streak({ value, unit, label, best }: { value: number; unit: string; label: string; best?: number }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="flex items-baseline gap-1 text-stat-sm text-fg-1">
        <Ticker value={value} from={0} />
        <span className="text-body text-fg-3">{unit}</span>
        {best != null && best > value && <span className="ml-1 font-mono text-mono-sm text-fg-3">best {best}</span>}
        {best != null && best <= value && value > 1 && <span className="ml-1 text-micro uppercase text-accent-ink">best</span>}
      </span>
      <span className="text-body-sm text-fg-3">{label}</span>
    </div>
  );
}
