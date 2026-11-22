/**
 * Weekly summary (product.md §3.2) in four layouts:
 *   column — the sticky right column of the month view (≥ xl): everything, stacked
 *   narrow — lg…xl: hours, load, form only
 *   row    — below lg: one horizontal line under the week
 *   header — the week view's horizontal summary header
 * Planned, Done and Target are always labelled separately; projections are marked "proj.".
 */
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowRight, CalendarClock, CopyPlus, Ellipsis, NotebookPen, Pilcrow, Star, TriangleAlert } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import type { Sport, WeekSummary } from '@cadence/core/domain';
import { SportMixBar, SplitBar } from '@/charts';
import { cn } from '@/lib/cn';
import { distanceParts, formatDuration, formatIsoWeek, formatLoad, formatPercent, formatSigned, NBSP } from '@/lib/format';
import { useUnits } from '@/lib/units';
import { links } from '@/shell/links';
import { SportGlyph } from '@/ui/domain/SportGlyph';
import { FormZoneLabel } from '@/ui/domain/Status';
import { IconButton } from '@/ui/Button';
import { Menu } from '@/ui/Menu';
import { Skeleton } from '@/ui/Skeleton';
import type { PhaseInfo, WeekData } from './data';

const DIST_SPORTS = new Set<Sport>(['bike', 'run', 'swim', 'row', 'walk', 'hike', 'ski']);

export interface SummaryMenuHandlers {
  onCopyWeek?: (isoWeek: string, anchor: HTMLElement) => void;
  onShift?: (from: string, anchor: HTMLElement) => void;
}

/**
 * Static twins of DeltaBadge / SparkBars for virtualized rows: no Motion components (each one
 * mounts a projection node that forces a document-scroll read), same encodings.
 */
function Delta({ value, caution, flatBelow = 0.03 }: { value: number | null | undefined; caution?: boolean; flatBelow?: number }) {
  if (value == null || !Number.isFinite(value)) return <span className="text-mono-sm text-fg-4">—</span>;
  const dir = Math.abs(value) < flatBelow ? 'flat' : value > 0 ? 'up' : 'down';
  const text = dir === 'flat' ? '±0%' : formatPercent(value, { signed: true });
  return (
    <span className={cn('inline-flex items-center gap-0.5 whitespace-nowrap text-mono-sm', caution || dir === 'up' ? 'font-[600] text-fg-1' : dir === 'down' ? 'text-fg-2' : 'text-fg-3')}>
      {caution ? (
        <TriangleAlert className="size-3 shrink-0" aria-hidden />
      ) : (
        <ArrowRight className={cn('size-3 shrink-0', dir === 'up' && '-rotate-45', dir === 'down' && 'rotate-45')} strokeWidth={2} aria-hidden />
      )}
      <span className="num">{text}</span>
      <span className="sr-only">{dir === 'up' ? 'increase' : dir === 'down' ? 'decrease' : 'no change'} week over week</span>
    </span>
  );
}

function DaySpark({ values, planned, todayIndex }: { values: number[]; planned: number[]; todayIndex?: number }) {
  const h = 14;
  const bw = 4;
  const gap = 2;
  const m = Math.max(1, ...values, ...planned);
  const y = (v: number) => (v > 0 ? Math.max(1.5, (v / m) * h) : 0);
  return (
    <svg width={values.length * (bw + gap) - gap} height={h + 3} className="block overflow-visible" role="img" aria-label={`Daily load ${values.map((v) => Math.round(v)).join(', ')}`}>
      {values.map((v, i) => {
        const x = i * (bw + gap);
        const p = planned[i] ?? 0;
        return (
          <g key={i}>
            <rect x={x} y={h - 1} width={bw} height={1} className="fill-line-2" />
            {p > v && <rect x={x + 0.5} y={h - y(p) + 0.5} width={bw - 1} height={Math.max(0, y(p) - y(v) - 1)} rx={1} className="fill-none stroke-line-3" />}
            {v > 0 && <rect x={x} y={h - y(v)} width={bw} height={y(v)} rx={1} className="fill-accent" />}
            {todayIndex === i && <rect x={x - 1} y={h + 1.5} width={bw + 2} height={1.5} rx={0.75} className="fill-fg-1" />}
          </g>
        );
      })}
    </svg>
  );
}

/** Done / planned progress with a ghost "projected" segment and a target tick. */
export function ProgressLine({ done, planned, projected, target, className }: { done: number; planned: number; projected?: number; target?: number; className?: string }) {
  const max = Math.max(done, planned, projected ?? 0, target ?? 0, 1);
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  return (
    <div className={cn('relative h-[3px] w-full rounded-full bg-surface-3', className)} aria-hidden>
      {projected != null && projected > done && <span className="absolute inset-y-0 left-0 rounded-full bg-hatch-fg opacity-70" style={{ width: pct(projected) }} />}
      {planned > 0 && <span className="absolute -top-px -bottom-px w-px bg-fg-3" style={{ left: pct(planned) }} />}
      <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: pct(done) }} />
      {target != null && target > 0 && <span className="absolute -top-0.5 -bottom-0.5 w-0.5 rounded-full bg-fg-1" style={{ left: pct(target) }} />}
    </div>
  );
}

function plannedDaily(week: WeekData): number[] {
  return week.days.map((d) => d.cards.reduce((a, c) => a + (c.workout && !c.activity && c.model.compliance?.state === 'planned' ? (c.workout.plannedLoad ?? 0) : 0), 0));
}

function WeekMenu({ week, handlers, className }: { week: WeekData; handlers: SummaryMenuHandlers; className?: string }) {
  const navigate = useNavigate();
  let anchor: HTMLElement | null = null;
  return (
    <span ref={(el) => void (anchor = el?.closest<HTMLElement>('[data-summary]') ?? el)} className={className}>
      <Menu
        trigger={<IconButton label={`${formatIsoWeek(week.isoWeek)} actions`} icon={<Ellipsis />} size="sm" tooltip={false} className="!size-6 text-fg-3" />}
        items={[
          { label: 'Copy week to…', icon: <CopyPlus />, onSelect: () => anchor && handlers.onCopyWeek?.(week.isoWeek, anchor) },
          { label: 'Shift plan from here…', icon: <CalendarClock />, kbd: 's', onSelect: () => anchor && handlers.onShift?.(week.start, anchor) },
          { type: 'separator' },
          { label: 'Open weekly review', icon: <NotebookPen />, onSelect: () => void navigate(links.week(week.isoWeek)) },
        ]}
      />
    </span>
  );
}

function WeekLabel({ week, phase, size = 'sm' }: { week: WeekData; phase?: PhaseInfo; size?: 'sm' | 'md' }) {
  return (
    <Link {...links.week(week.isoWeek)} className="group/wl flex min-w-0 items-baseline gap-1.5 outline-none" onClick={(e) => e.stopPropagation()}>
      <span className={cn('text-fg-1 transition-colors group-hover/wl:text-accent-ink', size === 'md' ? 'text-mono font-[600]' : 'text-mono-sm font-[600]')}>
        {formatIsoWeek(week.isoWeek)}
      </span>
      {phase && (
        <span className="truncate text-micro text-fg-3">
          {phase.phase.label}
          <span className="text-fg-4"> · {phase.index}/{phase.count}</span>
        </span>
      )}
    </Link>
  );
}

function Stat({ value, of, unit, label, delta, caution }: { value: string; of?: string; unit?: string; label: string; delta?: ReactNode; caution?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-baseline justify-between gap-1">
        <span className="flex min-w-0 items-baseline gap-1 whitespace-nowrap">
          <span className="text-stat-sm text-fg-1 num">{value}</span>
          {of && <span className="text-mono-sm text-fg-3">/{NBSP}{of}</span>}
          {unit && <span className="text-label text-fg-3">{unit}</span>}
        </span>
        {delta && <span className={cn('shrink-0 rounded-xs px-0.5', caution && 'ring-1 ring-accent')}>{delta}</span>}
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** Compact two-up stat: micro label + delta, value / planned, progress line. */
function MiniStat({ label, value, of, delta, caution, line }: { label: string; value: string; of?: string; delta?: ReactNode; caution?: boolean; line: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="flex h-3.5 items-center justify-between gap-1">
        <span className="text-micro text-fg-3">{label}</span>
        {delta && <span className={cn('-mr-0.5 rounded-xs px-0.5', caution && 'ring-1 ring-accent')}>{delta}</span>}
      </div>
      <span className="flex min-w-0 items-baseline gap-0.5 whitespace-nowrap">
        <span className="text-stat-sm text-fg-1 num">{value}</span>
        {of && <span className="truncate text-mono-sm text-fg-3">/{of}</span>}
      </span>
      {line}
    </div>
  );
}

function SportLines({ s, max = 4 }: { s: WeekSummary; max?: number }) {
  const units = useUnits();
  const list = s.bySport.filter((x) => x.plannedCount + x.doneCount > 0).sort((a, b) => b.plannedSec + b.doneSec - (a.plannedSec + a.doneSec)).slice(0, max);
  if (!list.length) return null;
  return (
    <div className="grid grid-cols-2 gap-x-2 gap-y-1">
      {list.map((x) => {
        const dist = DIST_SPORTS.has(x.sport) && (x.plannedDistanceM > 0 || x.doneDistanceM > 0);
        // swims over 1 km read in km so a line never wraps ("4.8/4.8 km", not "4,800/4,800 m")
        const fmtSport = x.sport === 'swim' && Math.max(x.doneDistanceM, x.plannedDistanceM) >= 1000 ? 'run' : x.sport;
        const dec = (m: number) => (fmtSport === 'swim' ? undefined : m < 10_000 ? 1 : 0);
        const done = distanceParts(x.doneDistanceM, fmtSport, units, dec(x.doneDistanceM));
        const plan = distanceParts(x.plannedDistanceM, fmtSport, units, dec(x.plannedDistanceM));
        return (
          <span key={x.sport} className="flex min-w-0 items-center gap-1 text-mono-sm text-fg-2" title={`${x.sport}: done ${formatDuration(x.doneSec)} of ${formatDuration(x.plannedSec)} planned`}>
            <SportGlyph sport={x.sport} size={14} className="shrink-0 text-fg-3" />
            <span className="truncate">
              {dist ? (
                <>
                  <span className="text-fg-1">{x.doneDistanceM > 0 ? done.value : '0'}</span>
                  {x.plannedDistanceM > 0 && <span className="text-fg-3">/{plan.value}</span>}
                  <span className="font-sans text-fg-3">{NBSP}{done.unit}</span>
                </>
              ) : (
                <>
                  <span className="text-fg-1">{x.doneCount}</span>
                  <span className="text-fg-3">/{x.plannedCount}</span>
                </>
              )}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function FormLine({ s, compact, trailing }: { s: WeekSummary; compact?: boolean; trailing?: ReactNode }) {
  const proj = s.isProjected;
  return (
    <div className="flex flex-col gap-1">
      <div className={cn('flex flex-wrap items-baseline gap-x-2 text-mono-sm whitespace-nowrap', proj ? 'text-fg-3' : 'text-fg-2')}>
        <span title="Fitness at week end">
          <span className="font-sans text-micro text-fg-3">Fit </span>
          <span className={proj ? 'text-fg-2' : 'text-fg-1'}>{Math.round(s.fitness)}</span>
          {!compact && <span className="text-fg-3"> {formatSigned(s.fitnessDelta, 0)}</span>}
        </span>
        <span title="Fatigue at week end">
          <span className="font-sans text-micro text-fg-3">Fat </span>
          <span className={proj ? 'text-fg-2' : 'text-fg-1'}>{Math.round(s.fatigue)}</span>
        </span>
        <span title="Form at week end">
          <span className="font-sans text-micro text-fg-3">Form </span>
          <span className={proj ? 'text-fg-2' : 'text-fg-1'}>{formatSigned(s.form, 0)}</span>
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <FormZoneLabel zone={s.formZone} className={cn('!text-micro ', proj && 'opacity-70')} />
        {proj && <span className="text-mono-sm text-fg-3 italic">proj.</span>}
        {trailing && <span className="ml-auto">{trailing}</span>}
      </div>
    </div>
  );
}

const pctInt = (n: number, t: number) => (t > 0 ? Math.round((n / t) * 100) : 0);

export interface SummaryProps extends SummaryMenuHandlers {
  week: WeekData;
  variant: 'column' | 'narrow' | 'row' | 'header';
  todayIndex?: number;
  className?: string;
}

export const WeekSummaryBlock = memo(function WeekSummaryBlock({ week, variant, todayIndex, className, ...handlers }: SummaryProps) {
  const s = week.summary;
  if (!s) return <SummarySkeleton variant={variant} className={className} />;
  const future = todayIndex == null && !!week.summary && s.isProjected && s.doneSec === 0;
  const caution = !future && (s.wowLoad ?? 0) > 0.15;
  const hours = <Delta value={s.wowSec} />;
  const load = <Delta value={s.wowLoad} caution={caution} />;
  const it = s.intensitySec;
  const itT = it.easy + it.moderate + it.hard;
  const mix = s.bySport.map((x) => ({ sport: x.sport, value: s.doneSec > 0 ? x.doneSec : x.plannedSec }));
  const keyLine = s.keyPlanned + s.keyDone > 0 && (
    <span className="flex items-center gap-1 text-mono-sm text-fg-2" title="Key sessions done / planned">
      <Star className="size-3 fill-accent text-accent" strokeWidth={1.5} aria-hidden />
      <span className="text-fg-1">{s.keyDone}</span>/{Math.max(s.keyPlanned, s.keyDone)}
      <span className="font-sans text-fg-3"> key</span>
    </span>
  );
  const split = itT > 0 && (
    <span className="flex min-w-0 flex-1 items-center gap-1.5" title="Intensity split of done time">
      <span className="shrink-0 text-mono-sm text-fg-3">
        E<span className="text-fg-2">{pctInt(it.easy, itT)}</span> M<span className="text-fg-2">{pctInt(it.moderate, itT)}</span> H<span className="text-fg-2">{pctInt(it.hard, itT)}</span>
      </span>
      <SplitBar easy={it.easy} moderate={it.moderate} hard={it.hard} height={3} className="min-w-3 flex-1" />
    </span>
  );
  const spark = <DaySpark values={s.dailyLoad} planned={plannedDaily(week).map((p, i) => p + s.dailyLoad[i]!)} todayIndex={todayIndex} />;
  const hoursStat = future ? (
    <Stat value={formatDuration(s.plannedSec)} unit="h planned" label="planned hours" />
  ) : (
    <Stat value={formatDuration(s.doneSec)} of={formatDuration(s.plannedSec)} unit="h" label="hours done of planned" delta={hours} />
  );
  const loadStat = future ? (
    <Stat value={formatLoad(s.plannedLoad)} unit="load planned" label="planned load" />
  ) : (
    <Stat value={formatLoad(s.doneLoad)} of={formatLoad(s.plannedLoad)} unit="load" label="load done of planned" delta={load} caution={caution} />
  );
  const hoursLine = <ProgressLine done={s.doneSec} planned={s.plannedSec} projected={s.projectedSec} target={s.targetHours ? s.targetHours * 3600 : undefined} />;
  const loadLine = <ProgressLine done={s.doneLoad} planned={s.plannedLoad} projected={s.projectedLoad} target={s.targetLoad} />;
  const note = s.hasNote && <Pilcrow className="size-3 text-fg-3" aria-label="Week note" />;

  if (variant === 'row')
    return (
      <div data-summary className={cn('flex min-w-0 items-center gap-4 overflow-hidden px-3 py-2', className)}>
        <WeekLabel week={week} phase={week.phase} />
        <span className="flex items-baseline gap-1 text-mono-sm text-fg-3">
          {future ? (
            <>
              <span className="text-mono text-fg-1">{formatDuration(s.plannedSec)}</span>
              <span className="font-sans">h planned</span>
            </>
          ) : (
            <>
              <span className="text-mono text-fg-1">{formatDuration(s.doneSec)}</span>/{formatDuration(s.plannedSec)}
              <span className="font-sans">h</span>
            </>
          )}
        </span>
        <span className="flex items-baseline gap-1 text-mono-sm text-fg-3 max-sm:hidden">
          <span className="text-mono text-fg-1">{formatLoad(future ? s.plannedLoad : s.doneLoad)}</span>
          {!future && `/${formatLoad(s.plannedLoad)}`}
          <span className="font-sans">load</span>
        </span>
        {!future && <span className="max-md:hidden">{load}</span>}
        <span className="max-md:hidden">{keyLine}</span>
        <span className="flex items-baseline gap-1 text-mono-sm text-fg-2 max-sm:hidden">
          <span className="font-sans text-micro text-fg-3">Form</span>
          {formatSigned(s.form, 0)}
          {s.isProjected && <span className="text-fg-3 italic">proj.</span>}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {note}
          <span className="max-sm:hidden">{spark}</span>
          <WeekMenu week={week} handlers={handlers} />
        </span>
      </div>
    );

  if (variant === 'header')
    return (
      <div data-summary className={cn('grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-[repeat(3,minmax(0,1fr))_auto] xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.1fr)_auto]', className)}>
        <div className="flex flex-col gap-1.5">
          <span className="text-micro text-fg-3">Hours</span>
          {hoursStat}
          {hoursLine}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-micro text-fg-3">Load</span>
          {loadStat}
          {loadLine}
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-micro text-fg-3">Sports</span>
          <SportLines s={s} />
          {mix.some((m) => m.value > 0) && <SportMixBar segments={mix} height={4} />}
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-micro text-fg-3">Key · Intensity</span>
          {keyLine || <span className="text-mono-sm text-fg-4">No key sessions</span>}
          {split}
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-micro text-fg-3">End of week</span>
          <FormLine s={s} />
        </div>
        <div className="flex flex-col items-end justify-between gap-2">
          <span className="flex items-center gap-2">
            {note}
            <WeekMenu week={week} handlers={handlers} />
          </span>
          {spark}
        </div>
      </div>
    );

  if (variant === 'narrow')
    return (
      <div data-summary className={cn('flex min-w-0 flex-col gap-1.5 px-2.5 py-2', className)}>
        <div className="flex h-5 items-center justify-between gap-1">
          <WeekLabel week={week} phase={undefined} />
          <span className="flex items-center gap-1">
            {note}
            <WeekMenu week={week} handlers={handlers} className="-mr-1.5" />
          </span>
        </div>
        <MiniStat label={future ? 'Hours · plan' : 'Hours'} value={formatDuration(future ? s.plannedSec : s.doneSec)} of={future ? undefined : formatDuration(s.plannedSec)} delta={future ? undefined : hours} line={hoursLine} />
        <MiniStat label={future ? 'Load · plan' : 'Load'} value={formatLoad(future ? s.plannedLoad : s.doneLoad)} of={future ? undefined : formatLoad(s.plannedLoad)} delta={future ? undefined : load} caution={caution} line={loadLine} />
        <FormLine s={s} compact />
      </div>
    );

  return (
    <div data-summary className={cn('flex min-w-0 flex-col gap-1.5 px-2.5 py-2', className)}>
      <div className="flex h-5 items-center gap-2">
        <Link
          {...links.week(week.isoWeek)}
          onClick={(e) => e.stopPropagation()}
          title={week.phase ? `${week.phase.phase.label} · week ${week.phase.index} of ${week.phase.count}` : undefined}
          className="text-mono-sm font-[600] text-fg-1 outline-none transition-colors hover:text-accent-ink"
        >
          {formatIsoWeek(week.isoWeek)}
        </Link>
        <FormZoneLabel zone={s.formZone} withScale={false} className={cn('shrink-0 !text-micro ', s.isProjected ? 'text-fg-3' : 'text-fg-2')} />
        {s.isProjected && <span className="text-mono-sm text-fg-3 italic">proj.</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {note}
          <WeekMenu week={week} handlers={handlers} className="-mr-1.5" />
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-3">
        <MiniStat label={future ? 'Hours · plan' : 'Hours'} value={formatDuration(future ? s.plannedSec : s.doneSec)} of={future ? undefined : formatDuration(s.plannedSec)} delta={future ? undefined : hours} line={hoursLine} />
        <MiniStat label={future ? 'Load · plan' : 'Load'} value={formatLoad(future ? s.plannedLoad : s.doneLoad)} of={future ? undefined : formatLoad(s.plannedLoad)} delta={future ? undefined : load} caution={caution} line={loadLine} />
      </div>
      <SportLines s={s} />
      <div className="flex h-3.5 items-center gap-2">
        {keyLine}
        {split}
        <span className="ml-auto shrink-0">{spark}</span>
      </div>
      <div
        className={cn('flex items-baseline gap-2 text-mono-sm whitespace-nowrap', s.isProjected ? 'text-fg-3' : 'text-fg-2')}
        title={`End of week${s.isProjected ? ' (projected)' : ''}: fitness ${Math.round(s.fitness)}, fatigue ${Math.round(s.fatigue)}, form ${Math.round(s.form)}`}
      >
        <span>
          <span className="font-sans text-micro text-fg-3">Fit </span>
          <span className={s.isProjected ? 'text-fg-2' : 'text-fg-1'}>{Math.round(s.fitness)}</span>
          <span className="text-fg-3"> {formatSigned(s.fitnessDelta, 0)}</span>
        </span>
        <span>
          <span className="font-sans text-micro text-fg-3">Fat </span>
          <span className={s.isProjected ? 'text-fg-2' : 'text-fg-1'}>{Math.round(s.fatigue)}</span>
        </span>
        <span>
          <span className="font-sans text-micro text-fg-3">Form </span>
          <span className={s.isProjected ? 'text-fg-2' : 'text-fg-1'}>{formatSigned(s.form, 0)}</span>
        </span>
      </div>
    </div>
  );
});

export function SummarySkeleton({ variant, className }: { variant: SummaryProps['variant']; className?: string }) {
  if (variant === 'row')
    return (
      <div className={cn('flex items-center gap-4 px-3 py-2', className)}>
        <Skeleton className="h-3.5 w-10" />
        <Skeleton className="h-3.5 w-20" />
        <Skeleton className="h-3.5 w-16" />
      </div>
    );
  return (
    <div className={cn('flex flex-col gap-3 p-3', className)}>
      <Skeleton className="h-3.5 w-24" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-8" />
        <Skeleton className="h-8" />
      </div>
      <Skeleton className="h-3 w-3/4" />
      <Skeleton className="h-1 w-full" />
      <Skeleton className="h-6 w-full" />
    </div>
  );
}
