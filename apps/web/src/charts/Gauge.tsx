/**
 * Radial and comparison readouts: FormDial (form zones + ticker), Gauge (0–100 readiness),
 * ProgressRing (done / planned), CompareBars (this vs last, last 4 vs prior 4).
 */
import { useEffect, useId } from 'react';
import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react';
import type { FormZone } from '@cadence/core';
import { ChartDefs, useChartDefs } from './core/ChartDefs';
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

/** Form gauge: zone segments on a 240° arc, a springing marker and a ticker readout. */
export function FormDial({ value, zone, min = -45, max = 35, bands = DEFAULT_FORM_BANDS, size = 200, label = 'Form', caption, className }: FormDialProps) {
  const defs = useChartDefs();
  const reduce = useReducedMotion();
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 14;
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
        <ChartDefs ids={defs} />
        {bands.map((b) => {
          const lo = Math.max(min, b.min);
          const hi = Math.min(max, b.max);
          if (hi <= lo) return null;
          const a0 = ang(lo) + 1.2;
          const a1 = ang(hi) - 1.2;
          const on = b.zone === active;
          return (
            <g key={b.zone}>
              <path d={arc(cx, cy, r, a0, a1)} fill="none" strokeLinecap="butt" style={{ stroke: on ? (b.zone === 'fresh' || b.zone === 'productive' ? T.accent : T.fg2) : T.s3, strokeWidth: 10, transition: 'stroke var(--dur-base) var(--ease-out)' }} />
              {b.zone === 'overreaching' && <path d={arc(cx, cy, r, a0, a1)} fill="none" style={{ stroke: defs.hatchFg, strokeWidth: 10, opacity: on ? 0.9 : 0.5 }} />}
            </g>
          );
        })}
        {[min, 0, max].map((v) => (
          <text key={v} x={cx + (r + (v === 0 ? 14 : 0)) * Math.cos(rad(ang(v)))} y={cy + (r + (v === 0 ? 14 : 0)) * Math.sin(rad(ang(v))) + (v === 0 ? 0 : 18)} textAnchor="middle" dominantBaseline="central" style={{ fontFamily: T.mono, fontSize: 10, fill: T.fg3 }}>
            {fmtNum(v)}
          </text>
        ))}
        <motion.g style={{ rotate: mv, originX: '50%', originY: '50%' }}>
          <rect width={size} height={size} fill="none" />
          <line x1={cx} x2={cx} y1={cy - r - 9} y2={cy - r + 9} style={{ stroke: T.fg1, strokeWidth: 3 }} strokeLinecap="round" />
          <circle cx={cx} cy={cy - r} r={3} style={{ fill: T.bg }} />
        </motion.g>
      </svg>
      <div className="absolute inset-x-0 flex flex-col items-center" style={{ top: size * 0.3 }}>
        <span className="text-micro text-fg-3">{label}</span>
        <Ticker value={value} format={(v) => fmtNum(v)} className={size >= 180 ? 'text-stat-lg text-fg-1' : 'text-stat-md text-fg-1'} ariaLive />
        <span className={`mt-1 text-micro ${active === 'fresh' || active === 'productive' ? 'text-accent-ink' : 'text-fg-2'}`}>{zoneLabel}</span>
        {caption && <span className="mt-0.5 text-mono-sm text-fg-3">{caption}</span>}
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

/** Generic arc gauge (e.g. readiness 0–100): accent value arc that springs in. */
export function Gauge({ value, min = 0, max = 100, label, format = (v) => fmtNum(v), unit, size = 160, caption, className }: GaugeProps) {
  const reduce = useReducedMotion();
  const cx = size / 2;
  const r = size / 2 - 10;
  const f = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const d = arc(cx, cx, r, START, START + SWEEP);
  return (
    <div className={`relative inline-block ${className ?? ''}`} style={{ width: size, height: size * 0.86 }} role="meter" aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-label={`${label} ${format(value)}`}>
      <svg width={size} height={size * 0.86} className="block" aria-hidden>
        <path d={d} fill="none" strokeLinecap="round" style={{ stroke: T.s3, strokeWidth: 8 }} />
        <motion.path d={d} fill="none" strokeLinecap="round" style={{ stroke: T.accent, strokeWidth: 8 }} initial={{ pathLength: reduce ? f : 0 }} animate={{ pathLength: f }} transition={reduce ? { duration: 0 } : spring.gentle} />
        {Array.from({ length: 11 }, (_, i) => {
          const a = START + (i / 10) * SWEEP;
          return <line key={i} x1={cx + (r - 9) * Math.cos(rad(a))} y1={cx + (r - 9) * Math.sin(rad(a))} x2={cx + (r - (i % 5 ? 12 : 15)) * Math.cos(rad(a))} y2={cx + (r - (i % 5 ? 12 : 15)) * Math.sin(rad(a))} style={{ stroke: T.line3 }} />;
        })}
      </svg>
      <div className="absolute inset-x-0 flex flex-col items-center" style={{ top: size * 0.3 }}>
        <span className="text-micro text-fg-3">{label}</span>
        <span className="flex items-baseline gap-1">
          <Ticker value={value} format={format} className="text-stat-md text-fg-1" ariaLive />
          {unit && <span className="text-label text-fg-3">{unit}</span>}
        </span>
        {caption && <span className="text-mono-sm text-fg-3">{caption}</span>}
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

/** Done / planned ring. Overshoot beyond 100 % continues as a thinner fg-1 inner arc. */
export function ProgressRing({ done, planned, size = 44, stroke = 4, label, ariaLabel, className }: ProgressRingProps) {
  const reduce = useReducedMotion();
  const f = planned > 0 ? done / planned : done > 0 ? 1 : 0;
  const r = (size - stroke) / 2;
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
        {f > 1 && r2 > 2 && <motion.path d={ring2} fill="none" strokeLinecap="round" style={{ stroke: T.fg1, strokeWidth: 1.5 }} initial={{ pathLength: 0 }} animate={{ pathLength: Math.min(1, f - 1) }} transition={{ ...t, delay: reduce ? 0 : 0.3 }} />}
      </svg>
      {label !== null && size >= 36 && <span className={`relative ${size >= 56 ? 'text-mono' : 'text-mono-sm'} text-fg-1`}>{label ?? `${Math.round(f * 100)}`}</span>}
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

/** Paired horizontal bars: current (solid) vs previous (outline), with a delta badge. */
export function CompareBars({ items, currentLabel = 'This week', previousLabel = 'Last week', className }: CompareBarsProps) {
  const reduce = useReducedMotion();
  const id = useId();
  return (
    <div className={`min-w-0 ${className ?? ''}`} role="table" aria-label={`${currentLabel} versus ${previousLabel}`}>
      <div className="mb-2 flex items-center gap-4 text-micro text-fg-3" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-xs bg-fg-1" />
          {currentLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-xs border border-fg-3" />
          {previousLabel}
        </span>
      </div>
      <div className="flex flex-col gap-3">
        {items.map((it, i) => {
          const fmt = it.format ?? ((v: number) => fmtNum(v));
          const m = Math.max(it.current, it.previous) || 1;
          const delta = it.previous ? it.current / it.previous - 1 : null;
          return (
            <div key={it.label} role="row" className="grid grid-cols-[minmax(4.5rem,auto)_minmax(0,1fr)_auto] items-center gap-x-3">
              <span role="rowheader" className="text-label text-fg-2">
                {it.label}
              </span>
              <div className="flex flex-col gap-1" aria-hidden>
                <div className="h-2.5 rounded-xs">
                  <motion.div
                    className={`h-full origin-left rounded-xs ${it.accent ? 'bg-accent' : 'bg-fg-1'}`}
                    style={{ width: `${(it.current / m) * 100}%` }}
                    initial={reduce ? false : { scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ ...spring.smooth, delay: reduce ? 0 : i * 0.04 }}
                  />
                </div>
                <div className="h-2.5">
                  <motion.div
                    className="h-full origin-left rounded-xs border border-fg-3"
                    style={{ width: `${(it.previous / m) * 100}%` }}
                    initial={reduce ? false : { scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ ...spring.smooth, delay: reduce ? 0 : i * 0.04 + 0.05 }}
                  />
                </div>
              </div>
              <div role="cell" className="flex min-w-28 flex-col items-end">
                <span className="text-mono text-fg-1">
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

