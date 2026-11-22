/**
 * Weekly summary (DESIGN_V2 §5 "three lines") in four layouts:
 *   column — the month view's right column (≥ xl): `W47 · Run base` / hours done (hero) of planned
 *            + one thin bar / `Load 464 · Form −6` with at most one WoW delta
 *   narrow — lg…xl: the same three lines, tighter
 *   row    — below lg: one quiet line under the week
 *   header — the week view's single totals strip
 * Everything else (per-sport distance, key count, fitness, fatigue, intensity split, targets) is in
 * the hover card (Peek) and on the weekly review page the week label links to.
 */
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowRight, CalendarClock, CopyPlus, Ellipsis, NotebookPen, TriangleAlert } from 'lucide-react';
import { memo } from 'react';
import { cn } from '@/lib/cn';
import { formatDuration, formatIsoWeek, formatLoad, formatPercent, formatSigned, NBSP } from '@/lib/format';
import { links } from '@/shell/links';
import { FORM_ZONE_META } from '@/ui/domain/Status';
import { IconButton } from '@/ui/Button';
import { Menu } from '@/ui/Menu';
import { Skeleton } from '@/ui/Skeleton';
import type { WeekData } from './data';
import { usePeekTrigger } from './Peek';

export interface SummaryMenuHandlers {
  onCopyWeek?: (isoWeek: string, anchor: HTMLElement) => void;
  onShift?: (from: string, anchor: HTMLElement) => void;
}

/** Static twin of DeltaBadge for virtualized rows (no Motion projection nodes), same encoding. */
function Delta({ value, caution, flatBelow = 0.03, label, iconOnly }: { value: number | null | undefined; caution?: boolean; flatBelow?: number; label: string; iconOnly?: boolean }) {
  if (value == null || !Number.isFinite(value)) return null;
  const dir = Math.abs(value) < flatBelow ? 'flat' : value > 0 ? 'up' : 'down';
  const text = dir === 'flat' ? '±0%' : formatPercent(value, { signed: true });
  return (
    <span
      className={cn('inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap text-label num', caution ? 'font-medium text-fg-1' : dir === 'up' ? 'text-fg-2' : 'text-fg-3')}
      title={`${label} ${text} vs last week${caution ? ' — a big jump' : ''}`}
    >
      {caution ? (
        <TriangleAlert className="size-3 shrink-0" aria-hidden />
      ) : (
        <ArrowRight className={cn('size-3 shrink-0', dir === 'up' && '-rotate-45', dir === 'down' && 'rotate-45')} strokeWidth={2} aria-hidden />
      )}
      {iconOnly ? <span className="sr-only">{text}</span> : text}
      <span className="sr-only">
        {label} {dir === 'up' ? 'increase' : dir === 'down' ? 'decrease' : 'no change'} week over week
      </span>
    </span>
  );
}

/** One thin neutral done/planned bar (no accent: done is neutral). */
export function ProgressLine({ done, planned, projected, target, className }: { done: number; planned: number; projected?: number; target?: number; className?: string }) {
  void projected;
  void target;
  const max = Math.max(done, planned, 1);
  return (
    <div className={cn('relative h-[3px] w-full overflow-hidden rounded-full bg-surface-3', className)} aria-hidden>
      <span className="absolute inset-y-0 left-0 rounded-full bg-fg-2" style={{ width: `${Math.min(100, (done / max) * 100)}%` }} />
    </div>
  );
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

/** The week label link — its text is exactly `W47` (the demo tour and tests find it by that). */
function WeekLink({ week, className }: { week: WeekData; className?: string }) {
  return (
    <Link
      {...links.week(week.isoWeek)}
      onClick={(e) => e.stopPropagation()}
      className={cn('shrink-0 rounded-xs font-semibold text-fg-1 outline-none transition-colors duration-(--dur-fast) hover:text-accent-ink focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus', className)}
    >
      {formatIsoWeek(week.isoWeek)}
    </Link>
  );
}

export interface SummaryProps extends SummaryMenuHandlers {
  week: WeekData;
  variant: 'column' | 'narrow' | 'row' | 'header';
  todayIndex?: number;
  className?: string;
}

export const WeekSummaryBlock = memo(function WeekSummaryBlock({ week, variant, todayIndex, className, ...handlers }: SummaryProps) {
  const peek = usePeekTrigger({ kind: 'week', key: week.isoWeek });
  const s = week.summary;
  if (!s) return <SummarySkeleton variant={variant} className={className} />;
  const current = todayIndex != null;
  const future = !current && s.isProjected && s.doneSec === 0;
  const caution = !future && (s.wowLoad ?? 0) > 0.15;
  const phase = week.phase?.phase.label;
  const hours = future ? s.plannedSec : s.doneSec;
  const load = future ? s.plannedLoad : s.doneLoad;
  // One WoW badge at most, and only when it is actionable: a big load jump in a finished week.
  // (A running week's WoW is always "down"; the full deltas are in the hover card.)
  const delta = caution && !current ? <Delta value={s.wowLoad} caution label="Load" iconOnly={variant !== 'row'} /> : null;
  const stripDelta = future || current ? delta : <Delta value={s.wowLoad} caution={caution} label="Load" />;
  const formTitle = `End-of-week form${s.isProjected ? ' (projected)' : ''}${s.formZone ? ` · ${FORM_ZONE_META[s.formZone].label}` : ''}`;
  const empty = s.plannedSec === 0 && s.doneSec === 0;
  const peekProps = { onPointerEnter: peek.onPointerEnter, onPointerLeave: peek.onPointerLeave, onPointerDown: peek.onPointerDown };

  if (variant === 'row')
    return (
      <div data-summary {...peekProps} className={cn('group/sum flex min-w-0 items-center gap-3 rounded-lg px-2 py-2 text-label', className)}>
        <span className="flex min-w-0 items-baseline gap-1">
          <WeekLink week={week} className="text-body-sm" />
          {phase && <span className="truncate text-fg-3 max-sm:hidden">· {phase}</span>}
        </span>
        {!empty && (
          <>
            <span className="flex items-baseline gap-1 whitespace-nowrap num">
              <span className={cn('text-body-sm font-medium', future ? 'text-fg-2' : 'text-fg-1')}>{formatDuration(hours)}</span>
              <span className="text-fg-3">{future ? 'planned' : `of ${formatDuration(s.plannedSec)}`}</span>
            </span>
            <span className="whitespace-nowrap text-fg-3 num max-sm:hidden">
              Load <span className="text-fg-2">{formatLoad(load)}</span>
            </span>
          </>
        )}
        <span className="ml-auto flex items-center gap-2">
          <span className="max-md:hidden">{delta}</span>
          <WeekMenu week={week} handlers={handlers} />
        </span>
      </div>
    );

  if (variant === 'header')
    return (
      <div data-summary className={cn('flex min-w-0 flex-wrap items-center gap-x-8 gap-y-3', className)}>
        <div className="flex min-w-[12rem] flex-col gap-2">
          <span className="flex items-baseline gap-1.5 num">
            <span className={cn('text-stat-md', future ? 'text-fg-2' : 'text-fg-1')}>{formatDuration(hours)}</span>
            <span className="text-body-sm text-fg-3">{future ? 'planned' : `of ${formatDuration(s.plannedSec)}`}</span>
          </span>
          <ProgressLine done={future ? 0 : s.doneSec} planned={s.plannedSec} className="w-48" />
        </div>
        <span className="text-body-sm text-fg-3 num">
          Load <span className="text-fg-1">{formatLoad(load)}</span>
          {!future && <> of {formatLoad(s.plannedLoad)}</>}
        </span>
        <span className="text-body-sm text-fg-3 num" title={formTitle}>
          Form <span className="text-fg-1">{formatSigned(s.form, 0)}</span>
          {s.formZone && <> · {FORM_ZONE_META[s.formZone].label}</>}
          {s.isProjected && <span className="sr-only"> (projected)</span>}
        </span>
        {s.keyPlanned + s.keyDone > 0 && (
          <span className="text-body-sm text-fg-3 num">
            Key <span className="text-fg-1">{s.keyDone}</span> of {Math.max(s.keyPlanned, s.keyDone)}
          </span>
        )}
        {stripDelta}
        <span className="ml-auto flex items-center gap-1">
          <Link {...links.week(week.isoWeek)} className="rounded-sm px-2 py-1 text-body-sm text-fg-3 outline-none transition-colors hover:bg-surface-2 hover:text-fg-1 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus">
            Weekly review
          </Link>
          <WeekMenu week={week} handlers={handlers} />
        </span>
      </div>
    );

  const narrow = variant === 'narrow';
  if (empty)
    return (
      <div data-summary className={cn('group/sum flex min-w-0 flex-col gap-1.5 rounded-lg', narrow ? 'px-2.5 py-2.5' : 'px-3 py-3', current && 'bg-surface-1', className)}>
        <div className="flex h-5 min-w-0 items-center gap-1 text-body-sm">
          <WeekLink week={week} className="!font-medium !text-fg-3 hover:!text-fg-1" />
          {phase && <span className="truncate text-fg-4">· {phase}</span>}
          <WeekMenu
            week={week}
            handlers={handlers}
            className="-mr-1.5 ml-auto opacity-0 transition-opacity duration-(--dur-fast) group-hover/sum:opacity-100 focus-within:opacity-100 has-[[data-popup-open]]:opacity-100"
          />
        </div>
      </div>
    );
  return (
    <div
      data-summary
      {...peekProps}
      className={cn('group/sum flex min-w-0 flex-col gap-1.5 rounded-lg', narrow ? 'px-2.5 py-2.5' : 'px-3 py-3', current && 'bg-surface-1', className)}
    >
      <div className="flex min-h-5 min-w-0 items-start gap-1 text-body-sm">
        <WeekLink week={week} />
        {phase && <span className="min-w-0 text-fg-3">· {phase}</span>}
        <WeekMenu
          week={week}
          handlers={handlers}
          className="-mr-1.5 ml-auto opacity-0 transition-opacity duration-(--dur-fast) group-hover/sum:opacity-100 focus-within:opacity-100 has-[[data-popup-open]]:opacity-100"
        />
      </div>
      <span className="flex items-baseline gap-1.5 pt-1 whitespace-nowrap num">
        <span className={cn(narrow ? 'text-stat-sm' : 'text-stat-md', future ? 'text-fg-2' : 'text-fg-1')}>{formatDuration(hours)}</span>
        <span className="truncate text-body-sm text-fg-3">{future ? 'planned' : `of${NBSP}${formatDuration(s.plannedSec)}`}</span>
      </span>
      <ProgressLine done={future ? 0 : s.doneSec} planned={s.plannedSec} />
      <span className={cn('flex items-center gap-1 pt-0.5 text-label whitespace-nowrap num', s.isProjected ? 'text-fg-3' : 'text-fg-2')} title={formTitle}>
        Load {formatLoad(load)}
        {delta && <span className="-ml-0.5">{delta}</span>}
        <span className="text-fg-4">·</span> Form {formatSigned(s.form, 0)}
      </span>
    </div>
  );
});

export function SummarySkeleton({ variant, className }: { variant: SummaryProps['variant']; className?: string }) {
  if (variant === 'row' || variant === 'header')
    return (
      <div className={cn('flex items-center gap-4 px-2 py-2', className)}>
        <Skeleton className="h-3.5 w-10" />
        <Skeleton className="h-3.5 w-20" />
        <Skeleton className="h-3.5 w-16" />
      </div>
    );
  return (
    <div className={cn('flex flex-col gap-2.5 px-3.5 py-3', className)}>
      <Skeleton className="h-3.5 w-24" />
      <Skeleton className="h-5 w-20" />
      <Skeleton className="h-[3px] w-full" />
      <Skeleton className="h-3 w-3/4" />
    </div>
  );
}
