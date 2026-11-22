/**
 * WorkoutCard — the shared card for planned workouts, activities and paired items (DESIGN_V2 §5).
 * Calm by default: no borders, no edge rails. Colour carries data only (DESIGN_V2 §8): the glyph
 * wears the sport colour, a completed card gets a soft (12%) sport tint as its fill, the intensity
 * dot wears its zone colour; the key star and all text stay neutral.
 *   chip    (month view): glyph · [key star] title (one line when it fits, two at most; 28 → 44px)
 *           · intensity dot · duration, top-right on the first line
 *   compact / full (week view, lists): glyph · [star] title (≤ 2 lines; a compliance mark floats
 *           right only when it deviates from plan); then intensity dot · duration (· distance-or-load
 *           in full) in fg-3. Glyph and star are inline so the title keeps the card's full width.
 *           `profile` adds the step-profile sparkline (workout page / Today only); `meta` adds the
 *           note and Garmin icons.
 * Done = sport-tinted surface step; planned = no fill, tinted glyph; missed = fg-4 struck through
 * and a neutral glyph; skipped = fg-4, neutral glyph.
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
import { ComplianceGlyph, complianceDeviates, complianceStyles } from './Compliance';
import { sportVars } from './dataColor';
import { IntensityDot } from './Intensity';
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
  /** Renders the quiet placeholder left behind by a drag. */
  ghost?: boolean;
  /** Override the morph id (default model.id). */
  morphId?: string;
  className?: string;
  style?: CSSProperties;
  /** Extra trailing node (quick actions). */
  trailing?: ReactNode;
  /** Show the step-profile sparkline (full density; workout page / Today only). Default false. */
  profile?: boolean;
  /** Show the note / Garmin icons on the second line (full density). Default false. */
  meta?: boolean;
  /** Hover fill even without link/onClick (when a parent handles the click). */
  hoverable?: boolean;
}

/** Props that make any element a morph source: set the target just in time (capture phase). */
export function morphSourceProps(id: string) {
  return { onClickCapture: () => morph.set(id), 'data-morph-id': id } as const;
}

type Tone = 'done' | 'planned' | 'missed' | 'skipped';
const toneOf = (state: ComplianceState): Tone => (state === 'planned' ? 'planned' : state === 'missed' ? 'missed' : state === 'excused' ? 'skipped' : 'done');

/**
 * Card-state classes shared with the calendar's own faces (CardItem). The done fill is the sport
 * tint: set `--sport` on the same element with `sportVars(sport)` (neutral without it).
 * `neutralGlyph`: missed / skipped cards draw their glyph without the sport colour.
 */
export function cardTone(state: ComplianceState) {
  const tone = toneOf(state);
  return {
    tone,
    fill: tone === 'done' ? 'bg-sport-tint' : 'bg-transparent',
    hover: tone === 'done' ? 'hover:bg-sport-tint-hover' : 'hover:bg-surface-2',
    neutralGlyph: tone === 'missed' || tone === 'skipped',
    title: tone === 'done' ? 'text-fg-1' : tone === 'planned' ? 'text-fg-2' : tone === 'missed' ? 'text-fg-4 line-through decoration-fg-4' : 'text-fg-4',
    meta: tone === 'done' ? 'text-fg-3' : tone === 'planned' ? 'text-fg-3' : tone === 'missed' ? 'text-fg-4 line-through decoration-fg-4' : 'text-fg-4',
    glyph: tone === 'done' ? 'text-fg-2' : tone === 'planned' ? 'text-fg-3' : 'text-fg-4',
  };
}

export const WorkoutCard = forwardRef<HTMLElement, WorkoutCardProps>(function WorkoutCard(
  { model: m, density = 'full', link, onClick, selected, ghost, morphId, className, style, trailing, profile, meta, hoverable },
  ref,
) {
  const units = useUnits();
  const mid = morphId ?? m.id;
  const on = useIsMorphTarget(mid);
  const state = m.compliance?.state ?? (m.kind === 'activity' ? 'unplanned' : 'planned');
  const s = complianceStyles(state);
  const t = cardTone(state);
  const dist = m.distanceM ? distanceParts(m.distanceM, m.sport, units) : null;
  const hasSpark = profile && !!m.sparkline && m.sparkline.length > 1;
  const label = `${m.title}, ${formatDuration(m.durationSec, 'short')}, ${s.label}${m.isKey ? ', key workout' : ''}`;
  const chip = density === 'chip';

  // Glyph and star sit inline and the duration floats top-right, so only the first line yields
  // width to them; the second line runs the full chip width (two lines at most, then an ellipsis).
  const body = chip ? (
    <>
      <span
        className={cn('line-clamp-2 min-w-0 flex-1 text-body-sm leading-4 break-words', t.title, m.isKey && t.tone !== 'missed' && t.tone !== 'skipped' && 'font-semibold !text-fg-1')}
        style={vt(on, 'title')}
      >
        <span className="float-right ml-1 flex h-4 items-center gap-1 font-normal no-underline">
          <IntensityDot intensity={m.intensity} />
          <span className={cn('text-label num', t.meta)}>{formatDuration(m.durationSec)}</span>
        </span>
        <SportGlyph sport={m.sport} subSport={m.subSport} size={14} style={vt(on, 'glyph')} neutral={t.neutralGlyph} className={cn('mr-1 align-[-2px]', t.glyph)} />
        {m.isKey && <KeyStar pressed readOnly size="xs" className="mr-1 inline align-[-1px]" />}
        {m.title}
      </span>
    </>
  ) : (
    <>
      <span
        className={cn('line-clamp-2 min-w-0 text-body-sm break-words', m.isKey ? 'font-semibold' : 'font-medium', t.tone === 'planned' ? 'text-fg-1' : t.title)}
        style={vt(on, 'title')}
      >
        {complianceDeviates(state) && (
          <span className="float-right mt-0.5 ml-1.5 flex no-underline">
            <ComplianceGlyph state={state} />
          </span>
        )}
        <SportGlyph sport={m.sport} subSport={m.subSport} size={14} style={vt(on, 'glyph')} neutral={t.neutralGlyph} className={cn('mr-1.5 align-[-2px]', t.glyph)} />
        {m.isKey && <KeyStar pressed readOnly size="xs" className="mr-1 inline align-[-1px]" />}
        {m.title}
      </span>
      <div className="flex min-w-0 items-center gap-1.5">
        <IntensityDot intensity={m.intensity} />
        <span className={cn('min-w-0 flex-1 truncate text-label num', t.meta)}>
          {formatDuration(m.durationSec)}
          {density === 'full' &&
            (dist ? (
              <>
                {SEP}
                {dist.value}
                {NBSP}
                {dist.unit}
              </>
            ) : m.load != null ? (
              <>
                {SEP}
                {formatLoad(m.load)}
                {NBSP}load
              </>
            ) : null)}
          {state === 'excused' && <>{SEP}Skipped{m.skipReason ? ` · ${m.skipReason}` : ''}</>}
        </span>
        {meta && density === 'full' && m.hasNote && <Pilcrow className="size-3 shrink-0 text-fg-3" aria-label="Has notes" />}
        {meta && density === 'full' && m.kind === 'planned' && <GarminStateIcon state={m.garminState} />}
      </div>
      {density === 'full' && hasSpark && (
        <div className="pt-1">
          <MiniProfile values={m.sparkline!} height={16} className="min-w-0" />
        </div>
      )}
    </>
  );

  const interactive = !!(link || onClick);
  const cls = cn(
    'group/card relative flex min-w-0 overflow-hidden text-left outline-none transition-[background-color,opacity] duration-(--dur-fast) ease-out',
    'focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-focus',
    chip ? 'min-h-7 items-start gap-1.5 rounded-md px-1.5 py-1.5' : cn('flex-col gap-1 rounded-lg py-2.5', density === 'compact' ? 'px-2.5' : 'px-3'),
    density === 'full' && interactive && 'spotlight',
    t.fill,
    (interactive || hoverable) && t.hover,
    selected && '!bg-surface-3 outline-1 outline-solid -outline-offset-1 outline-line-3',
    ghost && '!bg-surface-1 opacity-60 [&>*]:invisible',
    className,
  );

  const shared = {
    className: cls,
    style: { ...sportVars(m.sport), ...style, ...vt(on, 'card') },
    'data-morph-id': mid,
    'aria-label': label,
    onPointerMove: density === 'full' && interactive ? onSpotlightMove : undefined,
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
        {body}
        {trailing}
      </button>
    );
  return (
    <div ref={ref as React.Ref<HTMLDivElement>} {...shared}>
      {body}
      {trailing}
    </div>
  );
});
