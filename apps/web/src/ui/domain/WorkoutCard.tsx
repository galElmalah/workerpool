/**
 * WorkoutCard — the shared card for planned workouts, activities and paired items, in three
 * densities (product.md §3.3–3.4, design.md §2.4 / §4.3):
 *   full    (cell ≥ 170px): glyph, title (2 lines), duration · distance · load, compliance glyph,
 *           key star, intensity pips, note & Garmin icons, step-profile sparkline, compliance bar
 *   compact (120–169px):    glyph, title (1 line), duration, compliance glyph, key star, pips
 *   chip    (< 120px):      28px; glyph 14 + title + duration (mono-sm); compliance by chip shape
 *
 * Morph: carries `wk-card` / `wk-glyph` / `wk-title` ONLY while it is the morph target (set just
 * in time on click), so names stay unique on the page. Pass `link` to make it a TanStack Link.
 *
 *   <WorkoutCard model={vm} density="full" link={links.workout(vm.id)} />
 */
import type { ComplianceState, IntensityClass, Sport, SubSport } from '@cadence/core';
import { Link, type LinkProps } from '@tanstack/react-router';
import { Pilcrow } from 'lucide-react';
import { forwardRef, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { distanceParts, formatDuration, formatLoad, NBSP } from '@/lib/format';
import { useUnits } from '@/lib/units';
import { morph, useIsMorphTarget, vt } from '@/motion/morph';
import { onSpotlightMove } from '@/motion/pointer';
import { ComplianceBar, ComplianceGlyph, complianceStyles } from './Compliance';
import { IntensityPips } from './Intensity';
import { KeyStar } from './KeyStar';
import { MiniProfile } from './MiniProfile';
import { SportGlyph } from './SportGlyph';
import { GarminStateIcon, type GarminState } from './Status';

export interface WorkoutCardModel {
  id: string;
  kind: 'planned' | 'activity' | 'paired';
  sport: Sport;
  subSport?: SubSport | null;
  title: string;
  durationSec?: number | null;
  distanceM?: number | null;
  load?: number | null;
  isKey: boolean;
  intensity?: IntensityClass | null;
  compliance?: { state: ComplianceState; ratio?: number | null } | null;
  hasNote?: boolean;
  garminState?: GarminState | null;
  /** ≤ 48 values 0..1 (planned structure or actual effort profile). */
  sparkline?: number[] | null;
  /** 'HH:MM' planned start. */
  startTime?: string | null;
  skipReason?: string | null;
}

const SEP = `${NBSP}·${NBSP}`;

export type CardDensity = 'full' | 'compact' | 'chip';

/** Pick a density from the available cell width (product.md §3.3). */
export const densityForWidth = (px: number): CardDensity => (px >= 170 ? 'full' : px >= 120 ? 'compact' : 'chip');

export interface WorkoutCardProps {
  model: WorkoutCardModel;
  density?: CardDensity;
  /** Navigate on click (TanStack link options, e.g. links.workout(id)). */
  link?: LinkProps;
  onClick?: (e: MouseEvent) => void;
  selected?: boolean;
  /** Renders the hatched ghost placeholder (source of a drag). */
  ghost?: boolean;
  /** Override the morph id (default model.id). */
  morphId?: string;
  className?: string;
  style?: CSSProperties;
  /** Extra trailing node (quick actions). */
  trailing?: ReactNode;
}

/** Props that make any element a morph source: set the target just in time (capture phase). */
export function morphSourceProps(id: string) {
  return { onClickCapture: () => morph.set(id), 'data-morph-id': id } as const;
}

export const WorkoutCard = forwardRef<HTMLElement, WorkoutCardProps>(function WorkoutCard(
  { model: m, density = 'full', link, onClick, selected, ghost, morphId, className, style, trailing },
  ref,
) {
  const units = useUnits();
  const mid = morphId ?? m.id;
  const on = useIsMorphTarget(mid);
  const state = m.compliance?.state ?? (m.kind === 'activity' ? 'unplanned' : 'planned');
  const s = complianceStyles(state);
  const missed = state === 'missed';
  const dist = m.distanceM ? distanceParts(m.distanceM, m.sport, units) : null;
  const rail = s.rail ?? (m.isKey ? 'bg-accent' : null);
  const hasSpark = !!m.sparkline && m.sparkline.length > 1;
  const label = `${m.title}, ${formatDuration(m.durationSec, 'short')}, ${s.label}${m.isKey ? ', key workout' : ''}`;

  const body =
    density === 'chip' ? (
      <>
        <SportGlyph sport={m.sport} subSport={m.subSport} size={14} style={vt(on, 'glyph')} className="text-fg-1" />
        <span className={cn('min-w-0 flex-1 truncate text-body-sm text-fg-1', s.title)} style={vt(on, 'title')}>
          {m.title}
        </span>
        {m.isKey && <KeyStar pressed readOnly size="sm" />}
        <span className={cn('shrink-0 text-mono-sm text-fg-2', missed && 'line-through')}>{formatDuration(m.durationSec)}</span>
      </>
    ) : (
      <>
        <div className="flex min-w-0 items-start gap-2">
          <SportGlyph sport={m.sport} subSport={m.subSport} size={16} style={vt(on, 'glyph')} className="mt-px text-fg-1" />
          <span
            className={cn('min-w-0 flex-1 text-body-sm font-[520] text-fg-1', density === 'full' ? 'line-clamp-2' : 'truncate', s.title)}
            style={vt(on, 'title')}
          >
            {m.title}
          </span>
          <span className="mt-0.5 flex shrink-0 items-center gap-1">
            {m.isKey && <KeyStar pressed readOnly size="sm" />}
            {m.compliance && <ComplianceGlyph state={state} />}
            {density === 'full' && m.hasNote && <Pilcrow className="size-3 text-fg-3" aria-label="Has notes" />}
            {density === 'full' && m.kind === 'planned' && <GarminStateIcon state={m.garminState} />}
          </span>
        </div>
        <div className="flex items-center gap-2 pl-6">
          <span className={cn('min-w-0 flex-1 truncate text-mono-sm text-fg-2', missed && 'line-through')}>
            {formatDuration(m.durationSec)}
            {density === 'full' && dist && (
              <>
                {SEP}
                {dist.value}
                {NBSP}
                {dist.unit}
              </>
            )}
            {density === 'full' && m.load != null && (
              <>
                {SEP}
                {formatLoad(m.load)}
                <span className="font-sans text-fg-3">{NBSP}load</span>
              </>
            )}
          </span>
          {m.intensity && !(density === 'full' && hasSpark) && <IntensityPips intensity={m.intensity} />}
        </div>
        {s.microLabel && density === 'full' && <span className="pl-6 text-micro text-fg-3">{s.microLabel}</span>}
        {state === 'excused' && m.skipReason && density === 'full' && (
          <span className="pl-6 text-micro text-fg-3">Skipped · {m.skipReason}</span>
        )}
        {density === 'full' && hasSpark && (
          <div className="flex items-end gap-2 pl-6">
            <MiniProfile values={m.sparkline!} height={16} className="min-w-0 flex-1" />
            {m.intensity && <IntensityPips intensity={m.intensity} />}
          </div>
        )}
        {density === 'full' && m.compliance?.ratio != null && m.kind !== 'planned' && (
          <ComplianceBar ratio={m.compliance.ratio} state={state} className="pl-6" />
        )}
      </>
    );

  const cls = cn(
    'group/card relative flex min-w-0 overflow-hidden text-left outline-none transition-[background-color,border-color,opacity] duration-(--dur-fast) ease-out',
    'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
    density === 'chip' ? 'h-7 items-center gap-1.5 rounded-sm pr-2 pl-2.5' : 'flex-col gap-1 rounded-md py-2 pr-2.5 pl-3',
    density === 'full' && 'spotlight',
    s.card,
    (link || onClick) && 'hover:border-line-3 hover:bg-surface-3',
    s.dim && 'opacity-55',
    selected && 'ring-1 ring-fg-1 ring-inset',
    ghost && 'border-dashed !border-line-3 !bg-transparent bg-hatch-faint opacity-60 [&>*]:invisible',
    className,
  );

  const railEl = rail && !ghost && (
    <span className={cn('absolute left-0 rounded-r-full', density === 'chip' ? 'inset-y-1 w-0.5' : 'inset-y-1.5 w-[3px]', rail)} aria-hidden />
  );

  const shared = {
    className: cls,
    style: { ...style, ...vt(on, 'card') },
    'data-morph-id': mid,
    'aria-label': label,
    onPointerMove: density === 'full' ? onSpotlightMove : undefined,
  };

  if (link)
    return (
      <Link
        {...link}
        ref={ref as React.Ref<HTMLAnchorElement>}
        {...shared}
        onClickCapture={() => morph.set(mid)}
        onClick={onClick}
      >
        {railEl}
        {body}
        {trailing}
      </Link>
    );
  if (onClick)
    return (
      <button
        type="button"
        ref={ref as React.Ref<HTMLButtonElement>}
        {...shared}
        onClickCapture={() => morph.set(mid)}
        onClick={onClick}
      >
        {railEl}
        {body}
        {trailing}
      </button>
    );
  return (
    <div ref={ref as React.Ref<HTMLDivElement>} {...shared}>
      {railEl}
      {body}
      {trailing}
    </div>
  );
});
