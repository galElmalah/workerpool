/**
 * FitnessChart — Fitness / Fatigue / Form (PMC) with projection, annotations, range morph.
 * design.md §6.2 "PMC"; product.md §6.1 row 2 and §6.2 /trends/fitness.
 */
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform, type MotionValue } from 'motion/react';
import { area, curveMonotoneX, line } from 'd3-shape';
import { bisectCenter } from 'd3-array';
import type { FitnessDay, FormZone, LocalDate } from '@cadence/core';
import { ChartDefs, useChartDefs } from './core/ChartDefs';
import { ChartFrame } from './core/ChartFrame';
import { dateTicks, linearTicks, thinTicks, AxisY, Grid } from './core/Axis';
import { EndLabelRow, EndLabels, type EndLabel } from './core/EndLabels';
import { EventFlags, layoutFlags } from './core/Annotations';
import { ChartTooltip, CrosshairDot, CrosshairRule, TooltipBody, type TooltipRow } from './core/Tooltip';
import { ChartSegmented, CautionGlyph } from './core/controls';
import { Reveal, FadeIn, springTo } from './core/animated';
import { T } from './core/tokens';
import { useChartSize } from './core/useChartSize';
import { useHoverSync, useHoverValue, type HoverSync } from './core/hover';
import { useChartPointer } from './core/useChartPointer';
import { mergeHandlers, useBrushX } from './core/useBrushX';
import { DAY_MS, dateMs, fmtDayLong, fmtNum, fmtSigned } from './format';
import { dur, ease } from './motion';

export type FitnessRange = '6w' | '12w' | '6m' | '1y' | 'all';
export const FITNESS_RANGES: { value: FitnessRange; label: string; days: number }[] = [
  { value: '6w', label: '6W', days: 42 },
  { value: '12w', label: '12W', days: 84 },
  { value: '6m', label: '6M', days: 182 },
  { value: '1y', label: '1Y', days: 365 },
  { value: 'all', label: 'All', days: Infinity },
];

export interface ChartEvent {
  date: LocalDate;
  label: string;
  /** 'A' renders the flag in accent. */
  priority?: 'A' | 'B' | 'C';
  kind?: 'event' | 'threshold' | 'note';
}
export interface ChartPhase {
  startDate: LocalDate;
  endDate: LocalDate;
  label: string;
}

/** Form bands (absolute form units). Override via `formBands`. */
export interface FormBand {
  zone: FormZone;
  label: string;
  min: number;
  max: number;
}
export const DEFAULT_FORM_BANDS: FormBand[] = [
  { zone: 'transition', label: 'Transition', min: 25, max: Infinity },
  { zone: 'fresh', label: 'Fresh', min: 5, max: 25 },
  { zone: 'neutral', label: 'Neutral', min: -10, max: 5 },
  { zone: 'productive', label: 'Productive', min: -30, max: -10 },
  { zone: 'overreaching', label: 'Overreaching', min: -Infinity, max: -30 },
];

export interface FitnessSelection {
  from: LocalDate;
  to: LocalDate;
  days: number;
  load: number;
  avgLoad: number;
  fitnessDelta: number;
  fatigueDelta: number;
  formEnd: number;
}

export interface FitnessChartProps {
  days: FitnessDay[];
  /** Defaults to the last non-projected day. */
  today?: LocalDate;
  range?: FitnessRange;
  defaultRange?: FitnessRange;
  onRangeChange?: (r: FitnessRange) => void;
  showRangeControl?: boolean;
  events?: ChartEvent[];
  phases?: ChartPhase[];
  /** Daily load lollipops at the bottom of the top panel. */
  showLoad?: boolean;
  /** Weekly ramp-rate strip under the form panel. */
  showRamp?: boolean;
  /** Days of projection shown after today (default 42). */
  projectionDays?: number;
  height?: number;
  formHeight?: number;
  formBands?: FormBand[];
  loading?: boolean;
  /** Share the crosshair (keyed by LocalDate) with other date charts. */
  sync?: HoverSync<LocalDate>;
  onDayClick?: (date: LocalDate) => void;
  /** Drag across the plot to select a range. `null` when cleared. */
  onSelect?: (sel: FitnessSelection | null) => void;
  className?: string;
}

interface Prepared {
  ms: Float64Array;
  dates: LocalDate[];
  fit: Float64Array;
  fat: Float64Array;
  form: Float64Array;
  load: Float64Array;
  planned: Float64Array;
  todayIdx: number;
  weeks: { ms: number; ramp: number }[];
}

function prepare(days: FitnessDay[], today?: LocalDate): Prepared {
  const n = days.length;
  const ms = new Float64Array(n);
  const fit = new Float64Array(n);
  const fat = new Float64Array(n);
  const form = new Float64Array(n);
  const load = new Float64Array(n);
  const planned = new Float64Array(n);
  let todayIdx = -1;
  days.forEach((d, i) => {
    ms[i] = dateMs(d.date);
    fit[i] = d.fitness;
    fat[i] = d.fatigue;
    form[i] = d.form;
    load[i] = d.load;
    planned[i] = d.projected ? d.plannedLoad : 0;
    if (today ? d.date <= today : !d.projected) todayIdx = i;
  });
  const weeks: Prepared['weeks'] = [];
  for (let i = 0; i < n; i++) {
    if (new Date(ms[i]).getUTCDay() === 0 && i >= 7) weeks.push({ ms: ms[i] - 3 * DAY_MS, ramp: fit[i] - fit[i - 7] });
  }
  return { ms, dates: days.map((d) => d.date), fit, fat, form, load, planned, todayIdx: Math.max(0, todayIdx), weeks };
}

interface Layout {
  width: number;
  left: number;
  right: number;
  plotW: number;
  top0: number;
  top1: number;
  form0: number;
  form1: number;
  ramp0: number;
  ramp1: number;
  axisY: number;
  height: number;
  compact: boolean;
}

function computeLayout(width: number, height: number, formHeight: number, showRamp: boolean, flagRows: number): Layout {
  const compact = width < 480;
  const left = 34;
  const right = compact ? 8 : 112;
  const top0 = 18 + flagRows * 13;
  const top1 = top0 + height;
  const form0 = top1 + 16;
  const form1 = form0 + formHeight;
  const ramp0 = form1 + (showRamp ? 22 : 0);
  const ramp1 = ramp0 + (showRamp ? 26 : 0);
  const axisY = ramp1 + 8;
  return { width, left, right, plotW: Math.max(10, width - left - right), top0, top1, form0, form1, ramp0, ramp1, axisY, height: axisY + 16, compact };
}

/** Domain targets per range. */
function domainFor(p: Prepared, range: FitnessRange, projectionDays: number) {
  const n = p.ms.length;
  const todayMs = p.ms[p.todayIdx];
  const end = Math.min(p.ms[n - 1], todayMs + projectionDays * DAY_MS);
  const days = FITNESS_RANGES.find((r) => r.value === range)?.days ?? 84;
  const start = Math.max(p.ms[0], Number.isFinite(days) ? todayMs - days * DAY_MS : p.ms[0]);
  let max = 10;
  let lmax = 10;
  for (let i = 0; i < n; i++) {
    if (p.ms[i] < start || p.ms[i] > end) continue;
    max = Math.max(max, p.fit[i], p.fat[i]);
    lmax = Math.max(lmax, p.load[i], p.planned[i]);
  }
  const yMax = Math.ceil((max * 1.12) / 20) * 20;
  return { x0: start, x1: end, yMax, lMax: lmax };
}

type Dom = [number, number, number, number]; // x0, x1, yMax, lMax

export function FitnessChart(props: FitnessChartProps) {
  const { days, loading, height = 220, formHeight = 96, showRamp = false, className } = props;
  const [ref, size] = useChartSize<HTMLDivElement>();
  const [rangeState, setRangeState] = useState<FitnessRange>(props.defaultRange ?? '12w');
  const range = props.range ?? rangeState;
  const setRange = (r: FitnessRange) => {
    setRangeState(r);
    props.onRangeChange?.(r);
  };
  const p = useMemo(() => prepare(days, props.today), [days, props.today]);
  const empty = days.length < 2;
  const today = p.dates[p.todayIdx];
  const summary = empty
    ? 'Fitness chart: no data'
    : `Fitness ${fmtNum(p.fit[p.todayIdx])}, fatigue ${fmtNum(p.fat[p.todayIdx])}, form ${fmtNum(p.form[p.todayIdx])} on ${fmtDayLong(today)}. Fitness ${fmtSigned(p.fit[p.todayIdx] - p.fit[Math.max(0, p.todayIdx - 42)])} over 6 weeks.`;
  const table = useMemo(
    () => ({
      caption: 'Daily fitness, fatigue, form and load',
      columns: ['Date', 'Fitness', 'Fatigue', 'Form', 'Load'],
      rows: days.slice(-120).map((d) => [d.date + (d.projected ? ' (projected)' : ''), fmtNum(d.fitness), fmtNum(d.fatigue), fmtNum(d.form), fmtNum(d.projected ? d.plannedLoad : d.load)]),
    }),
    [days],
  );
  const totalH = height + formHeight + (showRamp ? 48 : 0) + 66;
  return (
    <div className={`min-w-0 ${className ?? ''}`}>
      <ChartFrame summary={summary} table={table} loading={loading} empty={empty} height={totalH} emptyHint="Fitness builds from completed workouts. Sync or log activities to see it here.">
        <div ref={ref} className="w-full">
          {size.width > 0 && <FitnessInner {...props} p={p} width={size.width} range={range} setRange={setRange} height={height} formHeight={formHeight} />}
        </div>
      </ChartFrame>
    </div>
  );
}

function FitnessInner({
  p,
  width,
  range,
  setRange,
  height,
  formHeight,
  showRangeControl = true,
  showLoad = true,
  showRamp = false,
  projectionDays = 42,
  events = [],
  phases = [],
  formBands = DEFAULT_FORM_BANDS,
  sync: extSync,
  onDayClick,
  onSelect,
}: FitnessChartProps & { p: Prepared; width: number; range: FitnessRange; setRange: (r: FitnessRange) => void; height: number; formHeight: number }) {
  const defs = useChartDefs();
  const chartId = useId();
  const reduce = useReducedMotion();
  const sync = useHoverSync<LocalDate>(extSync);
  const target = useMemo(() => domainFor(p, range, projectionDays), [p, range, projectionDays]);

  // Flags: pre-layout to know how many label rows we need.
  const flagRows = useMemo(() => {
    const L0 = computeLayout(width, height, formHeight, showRamp, 1);
    const toX = (ms: number) => L0.left + ((ms - target.x0) / (target.x1 - target.x0)) * L0.plotW;
    const laid = layoutFlags(events.filter((e) => dateMs(e.date) >= target.x0 && dateMs(e.date) <= target.x1).map((e) => ({ key: e.date + e.label, x: toX(dateMs(e.date)), label: e.label })));
    return laid.some((f) => f.row === 1) ? 2 : laid.length ? 1 : 0;
  }, [events, target, width, height, formHeight, showRamp]);
  const L = computeLayout(width, height, formHeight, showRamp, Math.max(1, flagRows));

  // Animated domain (gentle spring), driving every path through one transform.
  const x0 = useMotionValue(target.x0);
  const x1 = useMotionValue(target.x1);
  const yMax = useMotionValue(target.yMax);
  const lMax = useMotionValue(target.lMax);
  useEffect(() => {
    const cs = [springTo(x0, target.x0, reduce), springTo(x1, target.x1, reduce), springTo(yMax, target.yMax, reduce), springTo(lMax, target.lMax, reduce)];
    return () => cs.forEach((c) => c.stop());
  }, [target, reduce, x0, x1, yMax, lMax]);

  // Form domain is fixed per dataset (bands stay put while the x-domain morphs).
  const formDom = useMemo(() => {
    let lo = -40;
    let hi = 30;
    for (let i = 0; i < p.form.length; i++) {
      lo = Math.min(lo, p.form[i] - 5);
      hi = Math.max(hi, p.form[i] + 5);
    }
    return [Math.floor(lo / 10) * 10, Math.ceil(hi / 10) * 10] as [number, number];
  }, [p]);
  const yForm = useCallback((v: number) => L.form1 - ((v - formDom[0]) / (formDom[1] - formDom[0])) * (L.form1 - L.form0), [L.form0, L.form1, formDom]);

  const paths = useTransform([x0, x1, yMax, lMax] as MotionValue<number>[], (v: number[]) => buildPaths(p, L, v as Dom, yForm));

  const toX = useCallback((ms: number) => L.left + ((ms - target.x0) / (target.x1 - target.x0)) * L.plotW, [L.left, L.plotW, target]);
  const yTop = useCallback((v: number) => L.top1 - (v / target.yMax) * (L.top1 - L.top0), [L.top0, L.top1, target.yMax]);

  // Visible index range (target domain) for keys / end labels.
  const vis = useMemo(() => {
    let a = 0;
    while (a < p.ms.length && p.ms[a] < target.x0) a++;
    let b = p.ms.length - 1;
    while (b > 0 && p.ms[b] > target.x1) b--;
    return [a, b] as const;
  }, [p, target]);
  const keys = useMemo(() => p.dates.slice(vis[0], vis[1] + 1), [p, vis]);
  const indexOf = useMemo(() => new Map(p.dates.map((d, i) => [d, i])), [p]);

  const keyAt = useCallback(
    (x: number) => {
      if (x < L.left - 4 || x > L.left + L.plotW + 4) return null;
      const ms = target.x0 + ((x - L.left) / L.plotW) * (target.x1 - target.x0);
      const i = Math.max(vis[0], Math.min(vis[1], bisectCenter(p.ms, ms)));
      return p.dates[i];
    },
    [L.left, L.plotW, target, p, vis],
  );

  // Selection (brush)
  const [sel, setSel] = useState<{ from: LocalDate; to: LocalDate } | null>(null);
  useEffect(() => setSel(null), [range]);
  const commit = useCallback(
    (px0: number, px1: number) => {
      const a = keyAt(px0);
      const b = keyAt(px1);
      if (!a || !b) return;
      setSel({ from: a, to: b });
      const i0 = indexOf.get(a)!;
      const i1 = indexOf.get(b)!;
      let ld = 0;
      for (let i = i0; i <= i1; i++) ld += p.load[i] || p.planned[i];
      onSelect?.({ from: a, to: b, days: i1 - i0 + 1, load: ld, avgLoad: ld / (i1 - i0 + 1), fitnessDelta: p.fit[i1] - p.fit[Math.max(0, i0 - 1)], fatigueDelta: p.fat[i1] - p.fat[Math.max(0, i0 - 1)], formEnd: p.form[i1] });
    },
    [keyAt, indexOf, p, onSelect],
  );
  const clear = useCallback(() => {
    setSel(null);
    onSelect?.(null);
  }, [onSelect]);
  const brush = useBrushX({ enabled: !!onSelect, left: L.left, right: L.left + L.plotW, onCommit: commit, onClear: clear });

  const describe = useCallback(
    (d: LocalDate) => {
      const i = indexOf.get(d)!;
      return `${fmtDayLong(d)}: fitness ${fmtNum(p.fit[i])}, fatigue ${fmtNum(p.fat[i])}, form ${fmtNum(p.form[i])}`;
    },
    [indexOf, p],
  );
  const { handlers, live } = useChartPointer<LocalDate>({ keys, keyAt, sync, id: chartId, onActivate: onDayClick, describe, initialKey: p.dates[p.todayIdx] });
  const allHandlers = mergeHandlers(brush.handlers, handlers, {
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && sel) clear();
    },
  });

  // Ticks
  const yTicks = linearTicks([0, target.yMax], [L.top1, L.top0], 4, (v) => fmtNum(v));
  const formTicks = linearTicks(formDom, [L.form1, L.form0], 3, (v) => fmtNum(v)).filter((t) => t.pos > L.form0 + 4 && t.pos < L.form1 - 4);
  const xTicksRaw = dateTicks(toX, target.x0, target.x1, L.plotW);
  const xTicks = thinTicks(xTicksRaw);

  // End labels (last visible point)
  const last = vis[1];
  const lastProjected = last > p.todayIdx;
  const endLabels: EndLabel[] = [
    { id: 'fit', y: yTop(p.fit[last]), value: fmtNum(p.fit[last]), name: 'Fitness', tone: 'accent', suffix: lastProjected ? 'PROJ.' : undefined },
    { id: 'fat', y: yTop(p.fat[last]), value: fmtNum(p.fat[last]), name: 'Fatigue', tone: 'fg1', suffix: lastProjected ? 'PROJ.' : undefined },
  ];
  const formLabel: EndLabel = { id: 'form', y: yForm(p.form[last]), value: fmtNum(p.form[last]), name: 'Form', tone: 'fg2', dashed: true };

  const flags = events.map((e) => ({ key: e.date + e.label, ms: dateMs(e.date), label: e.label, emphasis: e.priority === 'A', kind: e.kind ?? 'event' }));
  const clipId = defs.id('plot');
  const todayMs = p.ms[p.todayIdx];

  return (
    <div className="relative">
      <Header p={p} sync={sync} indexOf={indexOf} range={range} setRange={setRange} showRangeControl={showRangeControl} compact={L.compact} last={last} />
      {L.compact && (
        <div className="mb-1">
          <EndLabelRow labels={[...endLabels, formLabel]} />
        </div>
      )}
      <div className="relative">
        <svg
          width={L.width}
          height={L.height}
          className="block touch-pan-y select-none overflow-visible rounded-xs focus-visible:outline-offset-4"
          role="group"
          aria-roledescription="chart"
          aria-label="Fitness, fatigue and form. Use arrow keys to inspect days."
          tabIndex={0}
          {...allHandlers}
          style={{ cursor: onSelect ? 'crosshair' : 'default' }}
        >
          <ChartDefs ids={defs} />
          <clipPath id={clipId}>
            <rect x={L.left} y={0} width={L.plotW} height={L.height} />
          </clipPath>

          {/* phases */}
          <g clipPath={`url(#${clipId})`}>
            {phases.map((ph, i) => (
              <AtX key={ph.startDate} ms={dateMs(ph.startDate)} msEnd={dateMs(ph.endDate) + DAY_MS} x0={x0} x1={x1} L={L}>
                {(w) => (
                  <>
                    <motion.rect y={L.top0} height={L.form1 - L.top0} width={w} style={{ fill: T.fg1, opacity: i % 2 ? 0.012 : 0.028 }} />
                    <line x1={0} x2={0} y1={L.top0} y2={L.form1} style={{ stroke: T.line1 }} />
                    <PhaseLabel w={w} label={ph.label} y={L.top0 + 13} />
                  </>
                )}
              </AtX>
            ))}
          </g>

          {/* grid + y axes */}
          <Grid ys={yTicks.map((t) => ({ key: t.key, pos: t.pos }))} x0={L.left} x1={L.left + L.plotW} />
          <AxisY ticks={yTicks.filter((t) => t.pos > L.top0 + 2)} x={L.left - 8} />

          {/* form bands */}
          <FormBands bands={formBands} yForm={yForm} L={L} dom={formDom} defs={defs} />
          <Grid ys={[]} x0={L.left} x1={L.left + L.plotW} zero={yForm(0)} />
          <AxisY ticks={formTicks} x={L.left - 8} />

          <g clipPath={`url(#${clipId})`}>
            {showLoad && <LoadMarks paths={paths} />}
            <Reveal id={defs.id('reveal')} x={L.left} y={0} width={L.plotW} height={L.height}>
              <Series paths={paths} defs={defs} />
            </Reveal>
            {/* selection */}
            {sel && (
              <AtX ms={dateMs(sel.from) - DAY_MS / 2} msEnd={dateMs(sel.to) + DAY_MS / 2} x0={x0} x1={x1} L={L}>
                {(w) => (
                  <>
                    <motion.rect y={L.top0} height={L.form1 - L.top0} width={w} style={{ fill: T.a2 }} />
                    <line x1={0} x2={0} y1={L.top0} y2={L.form1} style={{ stroke: T.a6 }} />
                    <motion.line x1={w} x2={w} y1={L.top0} y2={L.form1} style={{ stroke: T.a6 }} />
                  </>
                )}
              </AtX>
            )}
            <rect ref={brush.rectRef} x={0} width={0} y={L.top0} height={L.form1 - L.top0} style={{ fill: T.a2, stroke: T.a6, opacity: 0 }} pointerEvents="none" />
          </g>

          {/* ramp strip */}
          {showRamp && <RampStrip p={p} L={L} x0={x0} x1={x1} defs={defs} clipId={clipId} />}

          {/* today + flags */}
          <AtX ms={todayMs} x0={x0} x1={x1} L={L}>
            {() => (
              <g pointerEvents="none">
                <line x1={0} x2={0} y1={L.top0 - 2} y2={L.form1} style={{ stroke: T.fg3 }} />
                <text y={L.top1 + 12} textAnchor="middle" style={{ fontFamily: T.sans, fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', fill: T.fg2 }}>
                  TODAY
                </text>
              </g>
            )}
          </AtX>
          <Flags flags={flags} x0={x0} x1={x1} L={L} toX={toX} />

          {/* x axis (ticks glide with the domain) */}
          <g aria-hidden>
            <AnimatePresence initial={false}>
              {xTicks.map((t) => (
                <motion.g key={t.key} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: dur.fast, ease: ease.out }}>
                  <AtX ms={t.key as number} x0={x0} x1={x1} L={L}>
                    {() => (
                      <text y={L.axisY} textAnchor="middle" dominantBaseline="hanging" style={{ fontFamily: T.mono, fontSize: 11, fill: t.strong ? T.fg2 : T.fg3 }}>
                        {t.label}
                      </text>
                    )}
                  </AtX>
                </motion.g>
              ))}
            </AnimatePresence>
          </g>

          {!L.compact && (
            <>
              <EndLabels labels={endLabels} x={L.left + L.plotW + 6} top={L.top0} bottom={L.top1} />
              <EndLabels labels={[formLabel]} x={L.left + L.plotW + 6} top={L.form0} bottom={L.form1} />
            </>
          )}

          <Overlay p={p} sync={sync} indexOf={indexOf} toX={toX} yTop={yTop} yForm={yForm} L={L} />
        </svg>
        <FitnessTooltip p={p} sync={sync} indexOf={indexOf} toX={toX} L={L} />
        <span className="sr-only" aria-live="polite">
          {live}
        </span>
      </div>
    </div>
  );
}

// ───────────── paths ─────────────

function buildPaths(p: Prepared, L: Layout, [a, b, ym, lm]: Dom, yForm: (v: number) => number) {
  const n = p.ms.length;
  const k = L.plotW / (b - a || 1);
  const X = (i: number) => L.left + (p.ms[i] - a) * k;
  const Y = (v: number) => L.top1 - (v / ym) * (L.top1 - L.top0);
  // Only build within the visible window (+1 day margin) for speed.
  let i0 = 0;
  while (i0 < n - 1 && p.ms[i0 + 1] < a) i0++;
  let i1 = n - 1;
  while (i1 > 0 && p.ms[i1 - 1] > b) i1--;
  const t = p.todayIdx;
  const idx = (from: number, to: number) => {
    const out: number[] = [];
    for (let i = Math.max(from, i0); i <= Math.min(to, i1); i++) out.push(i);
    return out;
  };
  const past = idx(0, t);
  const fut = idx(t, n - 1);
  const ln = (arr: Float64Array, y: (v: number) => number) => line<number>().x(X).y((i) => y(arr[i])).curve(curveMonotoneX);
  const ar = (arr: Float64Array) => area<number>().x(X).y0(L.top1).y1((i) => Y(arr[i])).curve(curveMonotoneX);
  const risk = area<number>()
    .x(X)
    .y0(yForm(-30))
    .y1((i) => yForm(Math.min(-30, p.form[i])))
    .curve(curveMonotoneX);
  // load lollipops: bottom 30% of the top panel
  const lh = (L.top1 - L.top0) * 0.3;
  const barW = Math.max(1, Math.min(3, k * DAY_MS * 0.5));
  let loadPast = '';
  let loadFut = '';
  for (let i = i0; i <= i1; i++) {
    const v = p.load[i] || 0;
    const pv = p.planned[i] || 0;
    const x = X(i).toFixed(1);
    if (v > 0) loadPast += `M${x} ${L.top1}V${(L.top1 - (v / lm) * lh).toFixed(1)}`;
    if (pv > 0) loadFut += `M${x} ${L.top1}V${(L.top1 - (pv / lm) * lh).toFixed(1)}`;
  }
  return {
    fitArea: ar(p.fit)(past) ?? '',
    fitAreaF: ar(p.fit)(fut) ?? '',
    fit: ln(p.fit, Y)(past) ?? '',
    fitF: ln(p.fit, Y)(fut) ?? '',
    fat: ln(p.fat, Y)(past) ?? '',
    fatF: ln(p.fat, Y)(fut) ?? '',
    form: ln(p.form, yForm)(past) ?? '',
    formF: ln(p.form, yForm)(fut) ?? '',
    risk: risk(idx(0, n - 1)) ?? '',
    loadPast,
    loadFut,
    barW,
  };
}
type Paths = ReturnType<typeof buildPaths>;

const Series = memo(function Series({ paths, defs }: { paths: MotionValue<Paths>; defs: ReturnType<typeof useChartDefs> }) {
  const d = (k: keyof Paths) => useTransform(paths, (v) => v[k] as string); // eslint-disable-line react-hooks/rules-of-hooks
  const fitArea = d('fitArea');
  const fitAreaF = d('fitAreaF');
  const fit = d('fit');
  const fitF = d('fitF');
  const fat = d('fat');
  const fatF = d('fatF');
  const form = d('form');
  const formF = d('formF');
  const risk = d('risk');
  const common = { fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, vectorEffect: 'non-scaling-stroke' as const };
  return (
    <g pointerEvents="none">
      <FadeIn>
        <motion.path d={fitArea} style={{ fill: defs.fadeAccent }} />
        <motion.path d={fitAreaF} style={{ fill: defs.hatchAccent, opacity: 0.32 }} />
      </FadeIn>
      <motion.path d={risk} style={{ fill: defs.hatchFg, opacity: 0.9 }} />
      <motion.path d={fat} {...common} style={{ stroke: T.fg1, strokeWidth: 1.5 }} />
      <motion.path d={fatF} {...common} style={{ stroke: T.fg1, strokeWidth: 1.5, strokeDasharray: '2 4', opacity: 0.6 }} />
      <motion.path d={fit} {...common} style={{ stroke: T.accent, strokeWidth: 2 }} />
      <motion.path d={fitF} {...common} style={{ stroke: T.accent, strokeWidth: 2, strokeDasharray: '2 4', opacity: 0.6 }} />
      <motion.path d={form} {...common} style={{ stroke: T.fg2, strokeWidth: 1.5, strokeDasharray: '4 3' }} />
      <motion.path d={formF} {...common} style={{ stroke: T.fg2, strokeWidth: 1.5, strokeDasharray: '2 4', opacity: 0.6 }} />
    </g>
  );
});

function LoadMarks({ paths }: { paths: MotionValue<Paths> }) {
  const past = useTransform(paths, (v) => v.loadPast);
  const fut = useTransform(paths, (v) => v.loadFut);
  const w = useTransform(paths, (v) => v.barW);
  return (
    <g pointerEvents="none" aria-hidden>
      <motion.path d={past} style={{ stroke: T.fg4, strokeWidth: w, opacity: 0.42 }} />
      <motion.path d={fut} style={{ stroke: T.fg4, strokeWidth: w, opacity: 0.3, strokeDasharray: '1 1.5' }} />
    </g>
  );
}

/** Positions children at the animated x of `ms` (and passes the animated width to msEnd). */
function AtX({ ms, msEnd, x0, x1, L, children }: { ms: number; msEnd?: number; x0: MotionValue<number>; x1: MotionValue<number>; L: Layout; children: (w: MotionValue<number>) => React.ReactNode }) {
  const x = useTransform([x0, x1] as MotionValue<number>[], ([a, b]: number[]) => L.left + ((ms - a) / (b - a)) * L.plotW);
  const w = useTransform([x0, x1] as MotionValue<number>[], ([a, b]: number[]) => (msEnd == null ? 0 : Math.max(0, ((msEnd - ms) / (b - a)) * L.plotW)));
  return <motion.g style={{ x }}>{children(w)}</motion.g>;
}

function PhaseLabel({ w, label, y }: { w: MotionValue<number>; label: string; y: number }) {
  const op = useTransform(w, (v) => (v > label.length * 6.6 + 12 ? 1 : 0));
  return (
    <motion.text x={6} y={y} style={{ opacity: op, fontFamily: T.sans, fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', fill: T.fg3 }}>
      {label.toUpperCase()}
    </motion.text>
  );
}

function Flags({ flags, x0, x1, L, toX }: { flags: { key: string; ms: number; label: string; emphasis: boolean; kind: 'event' | 'threshold' | 'note' }[]; x0: MotionValue<number>; x1: MotionValue<number>; L: Layout; toX: (ms: number) => number }) {
  const vis = flags.filter((f) => toX(f.ms) >= L.left - 1 && toX(f.ms) <= L.left + L.plotW + 1);
  const laid = layoutFlags(vis.map((f) => ({ key: f.key, x: toX(f.ms), label: f.label, emphasis: f.emphasis, kind: f.kind })));
  return (
    <g aria-hidden pointerEvents="none">
      <AnimatePresence initial={false}>
        {laid.map((f) => {
          const src = vis.find((v) => v.key === f.key)!;
          return (
            <motion.g key={f.key} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: dur.fast }}>
              <AtX ms={src.ms} x0={x0} x1={x1} L={L}>
                {() => <EventFlags items={[{ ...f, x: 0, label: f.label }]} y0={L.top0 - f.row * 13} y1={L.form1} flipRight={L.left + L.plotW - toX(src.ms)} />}
              </AtX>
            </motion.g>
          );
        })}
      </AnimatePresence>
    </g>
  );
}

function FormBands({ bands, yForm, L, dom, defs }: { bands: FormBand[]; yForm: (v: number) => number; L: Layout; dom: [number, number]; defs: ReturnType<typeof useChartDefs> }) {
  return (
    <g aria-hidden pointerEvents="none">
      {bands.map((b) => {
        const lo = Math.max(dom[0], b.min);
        const hi = Math.min(dom[1], b.max);
        if (hi <= lo) return null;
        const y0 = yForm(hi);
        const y1 = yForm(lo);
        const fill = b.zone === 'fresh' ? T.a1 : undefined;
        return (
          <g key={b.zone}>
            {fill && <rect x={L.left} width={L.plotW} y={y0} height={y1 - y0} style={{ fill }} />}
            {b.zone === 'overreaching' && <rect x={L.left} width={L.plotW} y={y0} height={y1 - y0} style={{ fill: defs.hatchFg, opacity: 0.14 }} />}
            {y1 - y0 >= 11 && (
              <text x={L.left + 6} y={(y0 + y1) / 2} dominantBaseline="central" style={{ fontFamily: T.sans, fontSize: 9.5, fontWeight: 600, letterSpacing: '0.06em', fill: T.fg3, opacity: 0.75 }}>
                {b.label.toUpperCase()}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

function RampStrip({ p, L, x0, x1, defs, clipId }: { p: Prepared; L: Layout; x0: MotionValue<number>; x1: MotionValue<number>; defs: ReturnType<typeof useChartDefs>; clipId: string }) {
  const mid = (L.ramp0 + L.ramp1) / 2 + 4;
  const scale = (L.ramp1 - L.ramp0) / 2 / 10;
  const build = (filter: (r: number) => boolean) =>
    useTransform([x0, x1] as MotionValue<number>[], ([a, b]: number[]) => { // eslint-disable-line react-hooks/rules-of-hooks
      const k = L.plotW / (b - a);
      const w = Math.max(2, Math.min(10, 7 * DAY_MS * k * 0.55));
      let d = '';
      for (const wk of p.weeks) {
        if (!filter(wk.ramp)) continue;
        const x = L.left + (wk.ms - a) * k - w / 2;
        const h = Math.max(1, Math.min(13, Math.abs(wk.ramp)) * scale);
        const y = wk.ramp >= 0 ? mid - h : mid;
        d += `M${x.toFixed(1)} ${y.toFixed(1)}h${w.toFixed(1)}v${h.toFixed(1)}h${(-w).toFixed(1)}Z`;
      }
      return d;
    });
  const normal = build((r) => Math.abs(r) <= 5);
  const aggressive = build((r) => r > 5 && r <= 8);
  const risky = build((r) => r > 8);
  return (
    <g aria-hidden>
      <text x={L.left} y={L.ramp0 - 4} style={{ fontFamily: T.sans, fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', fill: T.fg3 }}>
        RAMP / WK
        <tspan dx={8} style={{ fontWeight: 400, letterSpacing: 0 }}>
          ≤5 normal · 5–8 aggressive · &gt;8 risky
        </tspan>
      </text>
      <line x1={L.left} x2={L.left + L.plotW} y1={mid} y2={mid} style={{ stroke: T.line2 }} />
      <g clipPath={`url(#${clipId})`}>
        <motion.path d={normal} style={{ fill: T.fg4 }} />
        <motion.path d={aggressive} style={{ fill: T.fg1 }} />
        <motion.path d={risky} style={{ fill: defs.hatchFgDense, stroke: T.fg1, strokeWidth: 1 }} />
      </g>
    </g>
  );
}

// ───────────── hover layer ─────────────

function Overlay({ p, sync, indexOf, toX, yTop, yForm, L }: { p: Prepared; sync: HoverSync<LocalDate>; indexOf: Map<LocalDate, number>; toX: (ms: number) => number; yTop: (v: number) => number; yForm: (v: number) => number; L: Layout }) {
  const k = useHoverValue(sync);
  const i = k == null ? undefined : indexOf.get(k);
  if (i == null) return null;
  const x = toX(p.ms[i]);
  if (x < L.left - 1 || x > L.left + L.plotW + 1) return null;
  return (
    <g pointerEvents="none">
      <CrosshairRule x={Math.round(x) + 0.5} y0={L.top0} y1={L.form1} />
      <CrosshairDot x={x} y={yTop(p.fat[i])} tone="fg1" />
      <CrosshairDot x={x} y={yTop(p.fit[i])} tone="accent" />
      <CrosshairDot x={x} y={yForm(p.form[i])} tone="fg2" />
    </g>
  );
}

function FitnessTooltip({ p, sync, indexOf, toX, L }: { p: Prepared; sync: HoverSync<LocalDate>; indexOf: Map<LocalDate, number>; toX: (ms: number) => number; L: Layout }) {
  const k = useHoverValue(sync);
  const i = k == null ? undefined : indexOf.get(k);
  const last = useRef(0);
  if (i != null) last.current = i;
  const j = i ?? last.current;
  const x = toX(p.ms[j]);
  const projected = j > p.todayIdx;
  const zone = DEFAULT_FORM_BANDS.find((b) => p.form[j] > b.min && p.form[j] <= b.max);
  const ramp = j >= 7 ? p.fit[j] - p.fit[j - 7] : null;
  const rows: TooltipRow[] = [
    { label: 'Fitness', value: fmtNum(p.fit[j]), strong: true, swatch: { tone: 'accent', kind: 'area' } },
    { label: 'Fatigue', value: fmtNum(p.fat[j]), swatch: { tone: 'fg1', width: 1.5 } },
    { label: 'Form', value: fmtNum(p.form[j]), hint: zone?.label, swatch: { tone: 'fg2', width: 1.5, dash: '4 3' } },
    { label: projected ? 'Planned load' : 'Load', value: fmtNum(projected ? p.planned[j] : p.load[j]), muted: !(projected ? p.planned[j] : p.load[j]) },
  ];
  if (ramp != null) rows.push({ label: 'Ramp / 7d', value: fmtSigned(ramp, 1), muted: Math.abs(ramp) <= 5 });
  const inPlot = x >= L.left && x <= L.left + L.plotW;
  return (
    <ChartTooltip x={x} y={L.top0 + 8} containerWidth={L.width} containerHeight={L.height} visible={i != null && inPlot}>
      <TooltipBody
        title={
          <span className="flex items-center gap-2">
            {fmtDayLong(p.dates[j])}
            {projected && <span className="text-micro text-fg-3">proj.</span>}
            {j === p.todayIdx && <span className="text-micro text-accent-ink">today</span>}
          </span>
        }
        rows={rows}
      />
    </ChartTooltip>
  );
}

function Header({ p, sync, indexOf, range, setRange, showRangeControl, compact, last }: { p: Prepared; sync: HoverSync<LocalDate>; indexOf: Map<LocalDate, number>; range: FitnessRange; setRange: (r: FitnessRange) => void; showRangeControl: boolean; compact: boolean; last: number }) {
  const k = useHoverValue(sync);
  const hi = k == null ? undefined : indexOf.get(k);
  const i = hi ?? p.todayIdx;
  const ramp = i >= 7 ? p.fit[i] - p.fit[i - 7] : 0;
  const zone = DEFAULT_FORM_BANDS.find((b) => p.form[i] > b.min && p.form[i] <= b.max);
  void last;
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-wrap items-end gap-x-6 gap-y-2">
        <Stat label="Fitness" tone="accent" value={fmtNum(p.fit[i])} delta={`${fmtSigned(ramp, 1)} /wk`} caution={ramp > 8} big={!compact} />
        <Stat label="Fatigue" value={fmtNum(p.fat[i])} big={!compact} />
        <Stat label="Form" value={fmtNum(p.form[i])} delta={zone?.label} big={!compact} />
        <div className="pb-1 text-label text-fg-3">
          {hi == null ? 'Today' : fmtDayLong(p.dates[i])}
          {i > p.todayIdx && <span className="ml-1.5 text-micro ">proj.</span>}
        </div>
      </div>
      {showRangeControl && <ChartSegmented ariaLabel="Range" value={range} options={FITNESS_RANGES} onChange={setRange} />}
    </div>
  );
}

function Stat({ label, value, delta, tone, caution, big }: { label: string; value: string; delta?: string; tone?: 'accent'; caution?: boolean; big?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="flex items-center gap-1.5 text-micro text-fg-3">
        <svg width="10" height="6" aria-hidden>
          <line x1="0" x2="10" y1="3" y2="3" style={{ stroke: tone === 'accent' ? T.accent : label === 'Form' ? T.fg2 : T.fg1, strokeWidth: 2, strokeDasharray: label === 'Form' ? '3 2' : undefined }} />
        </svg>
        {label}
      </span>
      <span className="flex items-baseline gap-2">
        <span className={`num ${big ? 'text-stat-md' : 'text-stat-sm'} ${tone === 'accent' ? 'text-accent-ink' : 'text-fg-1'}`}>{value}</span>
        {delta && (
          <span className="inline-flex items-center gap-1 text-mono-sm text-fg-2">
            {caution && <CautionGlyph />}
            {delta}
          </span>
        )}
      </span>
    </div>
  );
}

