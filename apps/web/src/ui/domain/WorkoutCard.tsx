/**
 * WorkoutCard — the shared card for planned workouts, activities and paired items (DESIGN_V2 §5).
 * Calm by default: no borders, no edge rails. Colour carries data only (DESIGN_V2 §8): the glyph
 * wears the sport colour, a completed card gets a soft (12%) sport tint as its fill, the intensity
 * dot wears its zone colour; the key star and all text stay neutral.
 *   chip    (month view): glyph · [key star] title (one line when it fits, two at most; 28 → 44px;
 *           the first-line break is measured so line 2 runs the full width — see ChipBody)
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
import { forwardRef, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
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

  const body = chip ? <ChipBody m={m} t={t} on={on} /> : null;
  const fullBody = chip ? null : (
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
    chip ? 'min-h-7 items-start rounded-md px-1.5 py-1.5' : cn('flex-col gap-1 rounded-lg py-2.5', density === 'compact' ? 'px-2.5' : 'px-3'),
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
        {body ?? fullBody}
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
        {body ?? fullBody}
        {trailing}
      </button>
    );
  return (
    <div ref={ref as React.Ref<HTMLDivElement>} {...shared}>
      {body ?? fullBody}
      {trailing}
    </div>
  );
});

// ───────────────────────── month chip title ─────────────────────────
//
// Two lines at most, and both used fully: the first line is glyph · [star] start of the title ·
// (dot, duration on the right); the second line is the rest of the title at the chip's full width,
// cut with an ellipsis mid-word only when even that runs out. Plain CSS wrapping cannot do this
// (a word that does not fit moves down whole, so line 2 ends early and a key star could be left
// alone on line 1), so the first-line break is measured: text widths via a shared hidden span, slot
// widths from layout, re-measured when the chip resizes or the web font arrives.

// Measured with a hidden DOM span that copies the slot's text styles: canvas `measureText` ignores
// the app's tabular figures and letter-spacing and is off by a few pixels.
let measurer: HTMLSpanElement | null = null;
const widthCache = new Map<string, number>();
// Widths measured before the web font loaded are fallback-font widths: drop them once it has.
let fontsSettled = typeof document === 'undefined' || !document.fonts;
if (!fontsSettled)
  void document.fonts.ready.then(() => {
    widthCache.clear();
    fontsSettled = true;
  });
function textWidth(style: CSSStyleDeclaration, text: string): number {
  const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}|${style.letterSpacing}|${style.fontFeatureSettings}|${style.fontVariantNumeric}`;
  const key = `${font}|${text}`;
  const hit = widthCache.get(key);
  if (hit !== undefined) return hit;
  if (!measurer) {
    measurer = document.createElement('span');
    measurer.setAttribute('aria-hidden', 'true');
    measurer.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;white-space:pre;contain:layout style';
    document.body.appendChild(measurer);
  }
  const m = measurer.style;
  m.fontStyle = style.fontStyle;
  m.fontWeight = style.fontWeight;
  m.fontSize = style.fontSize;
  m.fontFamily = style.fontFamily;
  m.letterSpacing = style.letterSpacing;
  m.fontFeatureSettings = style.fontFeatureSettings;
  m.fontVariantNumeric = style.fontVariantNumeric;
  measurer.textContent = text;
  const w = measurer.getBoundingClientRect().width;
  if (widthCache.size > 4000) widthCache.clear();
  widthCache.set(key, w);
  return w;
}

export interface ChipSplit {
  /** Title text on the first line (after the glyph and star). */
  line1: string;
  /** The rest, on the full-width second line. */
  line2: string;
  /** The star moves to line 2 with the title (the first word does not fit beside the duration). */
  starOn2: boolean;
}

/**
 * Where the first line of a chip title breaks. `avail` = width of the first-line text slot,
 * `starW` = the star's width incl. its gap (0 when not key), `measure` = text width.
 * Breaks between words; when not even the first word fits beside the glyph and duration, the whole
 * title (with its star) starts on line 2 so the star never sits alone.
 */
export function splitChipTitle(title: string, avail: number, starW: number, measure: (s: string) => number): ChipSplit {
  const fits = (s: string) => starW + measure(s) <= avail + 0.25; // sub-pixel rounding
  if (fits(title)) return { line1: title, line2: '', starOn2: false };
  let best = -1;
  for (let i = title.indexOf(' '); i > 0; i = title.indexOf(' ', i + 1)) {
    if (fits(title.slice(0, i))) best = i;
    else break;
  }
  if (best < 0) return { line1: '', line2: title, starOn2: true };
  return { line1: title.slice(0, best), line2: title.slice(best + 1), starOn2: false };
}

const chipObservers = new Map<Element, () => void>();
let chipRO: ResizeObserver | null = null;
function observeChip(el: Element, fn: () => void): () => void {
  if (typeof ResizeObserver === 'undefined') return () => {};
  chipRO ??= new ResizeObserver((entries) => entries.forEach((e) => chipObservers.get(e.target)?.()));
  chipObservers.set(el, fn);
  chipRO.observe(el);
  return () => {
    chipObservers.delete(el);
    chipRO?.unobserve(el);
  };
}

function ChipBody({ m, t, on }: { m: WorkoutCardModel; t: ReturnType<typeof cardTone>; on: boolean }) {
  const slot = useRef<HTMLSpanElement>(null);
  const star = useRef<HTMLSpanElement>(null);
  const key = m.isKey;
  const [split, setSplit] = useState<ChipSplit>({ line1: m.title, line2: '', starOn2: false });
  useLayoutEffect(() => {
    const el = slot.current;
    if (!el) return;
    let lastW = -1;
    const run = (force = false) => {
      const avail = el.clientWidth;
      if (!force && avail === lastW) return;
      lastW = avail;
      const cs = getComputedStyle(el);
      const starW = key ? (star.current?.offsetWidth ?? 12) + 4 : 0;
      const next = splitChipTitle(m.title, avail, starW, (s) => textWidth(cs, s));
      setSplit((p) => (p.line1 === next.line1 && p.line2 === next.line2 && p.starOn2 === next.starOn2 ? p : next));
    };
    run(true);
    let alive = true;
    if (!fontsSettled) void document.fonts?.ready.then(() => alive && run(true));
    const stop = observeChip(el, () => run());
    return () => {
      alive = false;
      stop();
    };
  }, [m.title, key]);

  const strong = key && t.tone !== 'missed' && t.tone !== 'skipped';
  const text = cn('text-body-sm leading-4', t.title, strong && 'font-semibold !text-fg-1');
  const starEl = (
    <span ref={star} className="mr-1 inline-flex align-[-1px]">
      <KeyStar pressed readOnly size="xs" />
    </span>
  );
  return (
    <span className="flex min-w-0 flex-1 flex-col" style={vt(on, 'title')}>
      <span className="flex h-4 min-w-0 items-center">
        <SportGlyph sport={m.sport} subSport={m.subSport} size={14} style={vt(on, 'glyph')} neutral={t.neutralGlyph} className={cn('mr-1 shrink-0', t.glyph)} />
        <span ref={slot} className={cn('min-w-0 flex-1 basis-0 overflow-hidden whitespace-nowrap', text)}>
          {key && !split.starOn2 && starEl}
          {split.line1}
        </span>
        <span className="ml-1 flex h-4 shrink-0 items-center gap-1">
          <IntensityDot intensity={m.intensity} />
          <span className={cn('text-label num', t.meta)}>{formatDuration(m.durationSec)}</span>
        </span>
      </span>
      {(split.line2 || split.starOn2) && (
        <span className={cn('block truncate', text)}>
          {key && split.starOn2 && starEl}
          {split.line2}
        </span>
      )}
    </span>
  );
}
