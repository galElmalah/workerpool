/**
 * Tiny inline charts for the calendar week-summary column and stat tiles (design.md §6.2
 * "Week-summary sparkline"): Sparkline (64×20 line), SparkBars (7 daily bars, done vs
 * remaining planned), MiniArea (trend area). Static on scroll; animate only on data change.
 */
import { useMemo } from 'react';
import { motion } from 'motion/react';
import { area, curveMonotoneX, line } from 'd3-shape';
import { useChartDefs, ChartDefs, SPORT_ORDER, SPORT_RAMP, sportKey, type SportKey } from './core/ChartDefs';
import { MorphPath } from './core/animated';
import { T } from './core/tokens';
import { useChartSize } from './core/useChartSize';
import { fmtNum } from './format';
import { spring } from './motion';

type Tone = 'accent' | 'fg';

export interface SparklineProps {
  values: (number | null)[];
  width?: number;
  height?: number;
  tone?: Tone;
  endDot?: boolean;
  /** Render the last value after the line. */
  showValue?: boolean;
  format?: (v: number) => string;
  /** Draw a faint baseline at this value (e.g. 0 or the period average). */
  baseline?: number;
  ariaLabel?: string;
  className?: string;
}

export function Sparkline({ values, width = 64, height = 20, tone = 'accent', endDot = true, showValue, format = (v) => fmtNum(v), baseline, ariaLabel, className }: SparklineProps) {
  const { d, last, lo, hi } = useMemo(() => {
    const vs = values.filter((v): v is number => v != null);
    const lo = Math.min(...vs, baseline ?? Infinity);
    const hi = Math.max(...vs, baseline ?? -Infinity);
    const pad = 2.5;
    const y = (v: number) => pad + (1 - (v - lo) / (hi - lo || 1)) * (height - pad * 2);
    const x = (i: number) => pad + (i / Math.max(1, values.length - 1)) * (width - pad * 2);
    const d =
      line<number | null>()
        .defined((v) => v != null)
        .x((_, i) => x(i))
        .y((v) => y(v!))
        .curve(curveMonotoneX)(values) ?? '';
    let li = values.length - 1;
    while (li >= 0 && values[li] == null) li--;
    return { d, last: li >= 0 ? { x: x(li), y: y(values[li]!), v: values[li]! } : null, lo, hi, y };
  }, [values, width, height, baseline]);
  const c = tone === 'accent' ? T.accent : T.fg1;
  const by = baseline != null ? 2.5 + (1 - (baseline - lo) / (hi - lo || 1)) * (height - 5) : null;
  return (
    <span className={`inline-flex items-center gap-1.5 ${className ?? ''}`} role="img" aria-label={ariaLabel ?? (last ? `Trend, latest ${format(last.v)}` : 'No data')}>
      <svg width={width} height={height} className="block overflow-visible" aria-hidden>
        {by != null && <line x1={0} x2={width} y1={by} y2={by} style={{ stroke: T.line2, strokeDasharray: '1 2' }} />}
        <MorphPath d={d} transition={spring.smooth} fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: c, strokeWidth: 1.5 }} />
        {endDot && last && <circle cx={last.x} cy={last.y} r={2.25} style={{ fill: c, stroke: T.bg, strokeWidth: 1.5 }} />}
      </svg>
      {showValue && last && <span className={`font-mono text-mono-sm ${tone === 'accent' ? 'text-accent-ink' : 'text-fg-1'}`}>{format(last.v)}</span>}
    </span>
  );
}

export interface SparkBarsProps {
  /** Done values (e.g. daily load Mon..Sun). */
  values: number[];
  /** Planned values (same length); the remainder above done is drawn as an outline. */
  planned?: number[];
  height?: number;
  barWidth?: number;
  gap?: number;
  /** Index to mark as today (gets a 2px fg-1 cap). */
  todayIndex?: number;
  max?: number;
  ariaLabel?: string;
  className?: string;
}

export function SparkBars({ values, planned, height = 20, barWidth = 4, gap = 2, todayIndex, max, ariaLabel, className }: SparkBarsProps) {
  const m = max ?? Math.max(1, ...values, ...(planned ?? []));
  const width = values.length * (barWidth + gap) - gap;
  const h = (v: number) => (v > 0 ? Math.max(1.5, (v / m) * height) : 0);
  return (
    <svg width={width} height={height + 3} className={`block overflow-visible ${className ?? ''}`} role="img" aria-label={ariaLabel ?? `Daily values ${values.map((v) => fmtNum(v)).join(', ')}`}>
      {values.map((v, i) => {
        const x = i * (barWidth + gap);
        const p = planned?.[i] ?? 0;
        return (
          <g key={i}>
            <rect x={x} y={height - 1} width={barWidth} height={1} style={{ fill: T.line2 }} />
            {p > v && <rect x={x + 0.5} y={height - h(p) + 0.5} width={barWidth - 1} height={Math.max(0, h(p) - h(v) - 1)} rx={1} style={{ fill: 'none', stroke: T.line3 }} />}
            <motion.rect x={x} width={barWidth} rx={1} initial={false} animate={{ y: height - h(v), height: h(v) }} transition={spring.gentle} style={{ fill: T.accent }} />
            {todayIndex === i && <rect x={x - 1} y={height + 1.5} width={barWidth + 2} height={1.5} rx={0.75} style={{ fill: T.fg1 }} />}
          </g>
        );
      })}
    </svg>
  );
}

export interface MiniAreaProps {
  values: (number | null)[];
  /** Fixed width; omit to fill the container. */
  width?: number;
  height?: number;
  tone?: Tone;
  endDot?: boolean;
  ariaLabel?: string;
  className?: string;
}

export function MiniArea({ values, width, height = 32, tone = 'accent', endDot = true, ariaLabel, className }: MiniAreaProps) {
  const [ref, size] = useChartSize<HTMLDivElement>();
  const w = width ?? size.width;
  return (
    <div ref={ref} className={`min-w-0 ${width ? 'inline-block' : 'w-full'} ${className ?? ''}`} style={{ height, width }} role="img" aria-label={ariaLabel ?? 'Trend'}>
      {w > 0 && <MiniAreaInner values={values} width={w} height={height} tone={tone} endDot={endDot} />}
    </div>
  );
}

function MiniAreaInner({ values, width, height, tone, endDot }: { values: (number | null)[]; width: number; height: number; tone: Tone; endDot: boolean }) {
  const defs = useChartDefs();
  const { d, a, last } = useMemo(() => {
    const vs = values.filter((v): v is number => v != null);
    const lo = Math.min(...vs) * 0.92;
    const hi = Math.max(...vs);
    const y = (v: number) => 3 + (1 - (v - lo) / (hi - lo || 1)) * (height - 6);
    const x = (i: number) => (i / Math.max(1, values.length - 1)) * (width - 4) + 1;
    const ln = line<number | null>().defined((v) => v != null).x((_, i) => x(i)).y((v) => y(v!)).curve(curveMonotoneX);
    const ar = area<number | null>().defined((v) => v != null).x((_, i) => x(i)).y0(height).y1((v) => y(v!)).curve(curveMonotoneX);
    let li = values.length - 1;
    while (li >= 0 && values[li] == null) li--;
    return { d: ln(values) ?? '', a: ar(values) ?? '', last: li >= 0 ? { x: x(li), y: y(values[li]!) } : null };
  }, [values, width, height]);
  return (
    <svg width={width} height={height} className="block overflow-visible" aria-hidden>
      <ChartDefs ids={defs} />
      <MorphPath d={a} transition={spring.smooth} style={{ fill: tone === 'accent' ? defs.fadeAccent : defs.fadeFg }} />
      <MorphPath d={d} transition={spring.smooth} fill="none" strokeLinecap="round" style={{ stroke: tone === 'accent' ? T.accent : T.fg1, strokeWidth: 1.5 }} />
      {endDot && last && <circle cx={last.x} cy={last.y} r={2.5} style={{ fill: tone === 'accent' ? T.accent : T.fg1, stroke: T.bg, strokeWidth: 1.5 }} />}
    </svg>
  );
}

export interface MixSegment {
  /** Sport key (bike, run, …) — mapped to the monochrome sport ramp. */
  sport: string;
  value: number;
}

/** 100 % stacked horizontal bar of done time by sport (week-summary "sport mix", product.md §3.2). */
export function SportMixBar({ segments, height = 6, className }: { segments: MixSegment[]; height?: number; className?: string }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const byKey = new Map<SportKey, number>();
  segments.forEach((s) => byKey.set(sportKey(s.sport), (byKey.get(sportKey(s.sport)) ?? 0) + s.value));
  const segs = SPORT_ORDER.filter((k) => (byKey.get(k) ?? 0) > 0).map((k) => ({ k, f: (byKey.get(k) ?? 0) / total }));
  return (
    <span className={`flex w-full gap-[1.5px] overflow-hidden rounded-xs ${className ?? ''}`} style={{ height }} role="img" aria-label={`Sport mix: ${segs.map((s) => `${SPORT_RAMP[s.k].label} ${Math.round(s.f * 100)}%`).join(', ')}`}>
      {segs.map((s) => {
        const r = SPORT_RAMP[s.k];
        const pattern = r.pattern === 'hatch' ? `repeating-linear-gradient(-45deg, ${T.fg2} 0 1px, transparent 1px 3.5px)` : r.pattern === 'dots' ? `radial-gradient(${T.fg2} 0.8px, transparent 1px)` : undefined;
        return <span key={s.k} title={`${r.label} ${Math.round(s.f * 100)}%`} style={{ flexGrow: s.f, background: r.fill, backgroundImage: pattern, backgroundSize: r.pattern === 'dots' ? '4px 4px' : undefined }} />;
      })}
    </span>
  );
}

/** Tiny 3-segment easy / moderate / hard bar (fill density). */
export function SplitBar({ easy, moderate, hard, height = 6, className }: { easy: number; moderate: number; hard: number; height?: number; className?: string }) {
  const t = easy + moderate + hard || 1;
  const parts = [
    { f: easy / t, z: 2 },
    { f: moderate / t, z: 4 },
    { f: hard / t, z: 7 },
  ];
  return (
    <span className={`flex w-full gap-px overflow-hidden rounded-xs ${className ?? ''}`} style={{ height }} role="img" aria-label={`Easy ${Math.round((easy / t) * 100)}%, moderate ${Math.round((moderate / t) * 100)}%, hard ${Math.round((hard / t) * 100)}%`}>
      {parts.map((p, i) => (p.f > 0 ? <span key={i} style={{ flexGrow: p.f, background: T.zone(p.z) }} /> : null))}
    </span>
  );
}
