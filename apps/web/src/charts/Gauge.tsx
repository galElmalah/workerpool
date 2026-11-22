/**
 * Readouts: StatBar (number + thin bar — the v2 default), FormDial (form zones + ticker),
 * Gauge (0–100 readiness), ProgressRing (done / planned), CompareBars (this vs last).
 * v2 (DESIGN_V2, research rule 12): dials and rings are discouraged — when they are used they
 * are as plain as possible: a thin neutral track, a small accent arc, no ticks or scale labels.
 * Prefer `StatBar` for new UI.
 */
import { useEffect, useId, type ReactNode } from 'react';
import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react';
import type { FormZone } from '@cadence/core';
import { Ticker } from './core/animated';
import { DeltaBadge } from './core/controls';
import { T } from './core/tokens';
import { fmtNum } from './format';
import { spring } from './motion';
import { DEFAULT_FORM_BANDS, type FormBand } from './FitnessChart';

const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;
function arc(cx: number, cy: number, r: number, a0: number, a1: number) {
  const p0 = [cx + r * Math.cos(rad(a0)), cy + r * Math.sin(rad(a0))];
  const p1 = [cx + r * Math.cos(rad(a1)), cy + r * Math.sin(rad(a1))];
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return `M${p0[0].toFixed(2)} ${p0[1].toFixed(2)}A${r} ${r} 0 ${large} ${a1 > a0 ? 1 : 0} ${p1[0].toFixed(2)} ${p1[1].toFixed(2)}`;
}

const SWEEP = 240;
const START = -120;

export interface FormDialProps {
  value: number;
  zone?: FormZone | null;
  min?: number;
  max?: number;
  bands?: FormBand[];
  size?: number;
  label?: string;
  /** e.g. "+3 vs last week" */
  caption?: string;
  className?: string;
}

/** Form dial: a thin neutral 240° track split at the zone edges, the current zone as a small arc, a springing dot and a ticker readout. */
export function FormDial({ value, zone, min = -45, max = 35, bands = DEFAULT_FORM_BANDS, size = 200, label = 'Form', caption, className }: FormDialProps) {
  const reduce = useReducedMotion();
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 8;
  const ang = (v: number) => START + ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * SWEEP;
  const mv = useMotionValue(reduce ? ang(value) : START);
  useEffect(() => {
    if (reduce) {
      mv.jump(ang(value));
      return;
    }
    const c = animate(mv, ang(value), spring.gentle);
    return () => c.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reduce]);
  const active = zone ?? bands.find((b) => value > b.min && value <= b.max)?.zone ?? null;
  const zoneLabel = bands.find((b) => b.zone === active)?.label ?? '';
  return (
    <div className={`relative inline-block ${className ?? ''}`} style={{ width: size, height: size * 0.86 }} role="meter" aria-valuemin={min} aria-valuemax={max} aria-valuenow={Math.round(value)} aria-label={`${label} ${fmtNum(value)}, ${zoneLabel}`}>
      <svg width={size} height={size * 0.86} className="block overflow-visible" aria-hidden>
        {bands.map((b) => {
          const lo = Math.max(min, b.min);
          const hi = Math.min(max, b.max);
          if (hi <= lo) return null;
          const a0 = ang(lo) + 1.5;
          const a1 = ang(hi) - 1.5;
          const on = b.zone === active;
          return <path key={b.zone} d={arc(cx, cy, r, a0, a1)} fill="none" strokeLinecap="round" style={{ stroke: on ? T.accent : T.s3, strokeWidth: 3, transition: 'stroke var(--dur-base) var(--ease-out)' }} />;
        })}
        <motion.g style={{ rotate: mv, originX: '50%', originY: '50%' }}>
          <rect width={size} height={size} fill="none" />
          <circle cx={cx} cy={cy - r} r={5} style={{ fill: T.fg1, stroke: T.bg, strokeWidth: 2.5 }} />
        </motion.g>
      </svg>
      <div className="absolute inset-x-0 flex flex-col items-center" style={{ top: size * 0.3 }}>
        <span className="text-label text-fg-3">{label}</span>
        <Ticker value={value} format={(v) => fmtNum(v)} className={size >= 180 ? 'text-stat-lg text-fg-1' : 'text-stat-md text-fg-1'} ariaLive />
        <span className="mt-1 text-label text-fg-2">{zoneLabel}</span>
        {caption && <span className="num mt-0.5 text-label text-fg-3">{caption}</span>}
      </div>
    </div>
  );
}

export interface GaugeProps {
  value: number;
  min?: number;
  max?: number;
  label: string;
  format?: (v: number) => string;
  unit?: string;
  size?: number;
  caption?: string;
  className?: string;
}

/** Generic arc gauge (e.g. readiness 0–100): thin neutral track, a thin accent value arc that springs in, no ticks. */
export function Gauge({ value, min = 0, max = 100, label, format = (v) => fmtNum(v), unit, size = 160, caption, className }: GaugeProps) {
  const reduce = useReducedMotion();
  const cx = size / 2;
  const r = size / 2 - 6;
  const f = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const d = arc(cx, cx, r, START, START + SWEEP);
  return (
    <div className={`relative inline-block ${className ?? ''}`} style={{ width: size, height: size * 0.86 }} role="meter" aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-label={`${label} ${format(value)}`}>
      <svg width={size} height={size * 0.86} className="block" aria-hidden>
        <path d={d} fill="none" strokeLinecap="round" style={{ stroke: T.s3, strokeWidth: 3 }} />
        <motion.path d={d} fill="none" strokeLinecap="round" style={{ stroke: T.accent, strokeWidth: 3 }} initial={{ pathLength: reduce ? f : 0 }} animate={{ pathLength: f }} transition={reduce ? { duration: 0 } : spring.gentle} />
      </svg>
      <div className="absolute inset-x-0 flex flex-col items-center" style={{ top: size * 0.3 }}>
        <span className="text-label text-fg-3">{label}</span>
        <span className="flex items-baseline gap-1">
          <Ticker value={value} format={format} className="text-stat-md text-fg-1" ariaLive />
          {unit && <span className="text-label text-fg-3">{unit}</span>}
        </span>
        {caption && <span className="num text-label text-fg-3">{caption}</span>}
      </div>
    </div>
  );
}

export interface ProgressRingProps {
  done: number;
  planned: number;
  size?: number;
  stroke?: number;
  /** Centre text; default the percentage. Pass null to hide. */
  label?: string | null;
  ariaLabel?: string;
  className?: string;
}

/** Done / planned ring: thin neutral track, accent arc. Overshoot beyond 100 % continues as a hairline fg-3 inner arc. */
export function ProgressRing({ done, planned, size = 44, stroke = 3, label, ariaLabel, className }: ProgressRingProps) {
  const reduce = useReducedMotion();
  const f = planned > 0 ? done / planned : done > 0 ? 1 : 0;
  const r = (size - Math.max(stroke, 2)) / 2;
  const c = size / 2;
  const ring = `M${c} ${c - r}A${r} ${r} 0 1 1 ${c - 0.01} ${c - r}`;
  const r2 = r - stroke - 1.5;
  const ring2 = `M${c} ${c - r2}A${r2} ${r2} 0 1 1 ${c - 0.01} ${c - r2}`;
  const t = reduce ? { duration: 0 } : spring.gentle;
  return (
    <span className={`relative inline-grid place-items-center ${className ?? ''}`} style={{ width: size, height: size }} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(f * 100)} aria-label={ariaLabel ?? `${Math.round(f * 100)}% of plan done`}>
      <svg width={size} height={size} className="absolute inset-0" aria-hidden>
        <path d={ring} fill="none" style={{ stroke: T.s3, strokeWidth: stroke }} />
        <motion.path d={ring} fill="none" strokeLinecap="round" style={{ stroke: T.accent, strokeWidth: stroke }} initial={{ pathLength: reduce ? Math.min(1, f) : 0 }} animate={{ pathLength: Math.min(1, f) }} transition={t} />
        {f > 1 && r2 > 2 && <motion.path d={ring2} fill="none" strokeLinecap="round" style={{ stroke: T.fg3, strokeWidth: 1 }} initial={{ pathLength: 0 }} animate={{ pathLength: Math.min(1, f - 1) }} transition={{ ...t, delay: reduce ? 0 : 0.3 }} />}
      </svg>
      {label !== null && size >= 36 && <span className={`num relative ${size >= 56 ? 'text-body-sm' : 'text-label'} text-fg-1`}>{label ?? `${Math.round(f * 100)}`}</span>}
    </span>
  );
}

export interface CompareItem {
  label: string;
  current: number;
  previous: number;
  format?: (v: number) => string;
  unit?: string;
  /** Use the accent for the current bar (load / completed work). */
  accent?: boolean;
}

export interface CompareBarsProps {
  items: CompareItem[];
  currentLabel?: string;
  previousLabel?: string;
  className?: string;
}

/** Paired thin horizontal bars: current (fg-2, or accent) vs previous (surface step), with a delta. */
export function CompareBars({ items, currentLabel = 'This week', previousLabel = 'Last week', className }: CompareBarsProps) {
  const reduce = useReducedMotion();
  const id = useId();
  return (
    <div className={`min-w-0 ${className ?? ''}`} role="table" aria-label={`${currentLabel} versus ${previousLabel}`}>
      <div className="mb-3 flex items-center gap-5 text-label text-fg-3" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-3 rounded-full bg-fg-2" />
          {currentLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-3 rounded-full bg-surface-active" />
          {previousLabel}
        </span>
      </div>
      <div className="flex flex-col gap-4">
        {items.map((it, i) => {
          const fmt = it.format ?? ((v: number) => fmtNum(v));
          const m = Math.max(it.current, it.previous) || 1;
          const delta = it.previous ? it.current / it.previous - 1 : null;
          return (
            <div key={it.label} role="row" className="grid grid-cols-[minmax(4.5rem,auto)_minmax(0,1fr)_auto] items-center gap-x-3">
              <span role="rowheader" className="text-body-sm text-fg-2">
                {it.label}
              </span>
              <div className="flex flex-col gap-1" aria-hidden>
                <div className="h-1.5 rounded-full">
                  <motion.div
                    className={`h-full origin-left rounded-full ${it.accent ? 'bg-accent' : 'bg-fg-2'}`}
                    style={{ width: `${(it.current / m) * 100}%` }}
                    initial={reduce ? false : { scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ ...spring.smooth, delay: reduce ? 0 : i * 0.04 }}
                  />
                </div>
                <div className="h-1.5">
                  <motion.div
                    className="h-full origin-left rounded-full bg-surface-active"
                    style={{ width: `${(it.previous / m) * 100}%` }}
                    initial={reduce ? false : { scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ ...spring.smooth, delay: reduce ? 0 : i * 0.04 + 0.05 }}
                  />
                </div>
              </div>
              <div role="cell" className="flex min-w-28 flex-col items-end">
                <span className="num text-body-sm text-fg-1">
                  {fmt(it.current)}
                  {it.unit && <span className="text-fg-3"> {it.unit}</span>}
                  <span className="text-fg-3"> / {fmt(it.previous)}</span>
                </span>
                <DeltaBadge value={delta} good={!!it.accent} key={`${id}-${delta}`} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


export interface StatBarProps {
  label: string;
  value: number;
  /** Bar scale: the value fills (value − min) / (max − min) of the track. */
  max: number;
  min?: number;
  format?: (v: number) => string;
  unit?: string;
  /** One line of context under the bar (e.g. "of 9:45" or a zone name). */
  caption?: ReactNode;
  /** Optional reference on the bar (e.g. the plan or a target), drawn as a short fg-3 tick. */
  marker?: number;
  /** 'fg' (default, neutral), 'accent' for the page's one hero quantity, or a status fill. */
  tone?: 'fg' | 'accent' | 'good' | 'warn' | 'critical';
  /** Any data colour for the fill (e.g. `sportColor('run')`); overrides `tone`. */
  color?: string;
  /** Split the fill into coloured parts (e.g. hours by sport, in the fixed sport order) with 2px gaps. */
  segments?: { key: string; value: number; color: string }[];
  /** Value size: 'md' = stat-md (hero), 'sm' = stat-sm (default). */
  size?: 'sm' | 'md';
  ariaLabel?: string;
  className?: string;
}

/**
 * StatBar — the plain v2 alternative to a gauge or ring (research rule 12: position and
 * length beat angles): label, value, a 4px bar and at most one line of context.
 */
const STATBAR_FILL = { fg: 'bg-fg-2', accent: 'bg-accent', good: 'bg-good', warn: 'bg-warn', critical: 'bg-critical' } as const;

export function StatBar({ label, value, max, min = 0, format = (v) => fmtNum(v), unit, caption, marker, tone = 'fg', color, segments, size = 'sm', ariaLabel, className }: StatBarProps) {
  const segs = segments?.filter((x) => x.value > 0) ?? [];
  const reduce = useReducedMotion();
  const span = max - min || 1;
  const f = Math.max(0, Math.min(1, (value - min) / span));
  const m = marker == null ? null : Math.max(0, Math.min(1, (marker - min) / span));
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className ?? ''}`} role="meter" aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-label={ariaLabel ?? `${label} ${format(value)}${unit ? ` ${unit}` : ''}`}>
      <span className="text-label text-fg-3">{label}</span>
      <span className="flex items-baseline gap-1">
        <Ticker value={value} format={format} className={`${size === 'md' ? 'text-stat-md' : 'text-stat-sm'} text-fg-1`} />
        {unit && <span className="text-body-sm text-fg-3">{unit}</span>}
      </span>
      <span className="relative mt-1 block h-1 w-full rounded-full bg-surface-3" aria-hidden>
        <motion.span
          className={`absolute inset-y-0 left-0 flex origin-left gap-[2px] overflow-hidden rounded-full ${color || segs.length ? '' : STATBAR_FILL[tone]}`}
          style={{ width: `${f * 100}%`, ...(color && !segs.length ? { backgroundColor: color } : null) }}
          initial={reduce ? false : { scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={reduce ? { duration: 0 } : spring.smooth}
        >
          {segs.map((x) => (
            <span key={x.key} className="h-full min-w-[2px]" style={{ flexGrow: x.value, flexBasis: 0, backgroundColor: x.color }} />
          ))}
        </motion.span>
        {m != null && <span className="absolute -inset-y-0.5 block w-px rounded-full bg-fg-3" style={{ left: `${m * 100}%` }} />}
      </span>
      {caption && <span className="num text-label text-fg-3">{caption}</span>}
    </div>
  );
}
