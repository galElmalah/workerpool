/**
 * EffortCurve / PowerCurve / PaceCurve — mean-maximal curves on a log-time axis (1 s → 5 h).
 * Primary period = accent 2px, secondary = fg-1 1.5px, comparison = fg-3 1px dashed.
 * design.md §6.2 "Power / pace curve"; product.md §5.1 item 9 and §6.2 /trends/peaks.
 */
import { useCallback, useId, useMemo } from 'react';
import { motion } from 'motion/react';
import { scaleLinear, scaleLog } from 'd3-scale';
import { curveMonotoneX, line } from 'd3-shape';
import type { PeakPoint } from '@cadence/core';
import { ChartDefs, useChartDefs } from './core/ChartDefs';
import { ChartFrame } from './core/ChartFrame';
import { AxisY, Grid, linearTicks, type Tick } from './core/Axis';
import { MorphPath, Reveal } from './core/animated';
import { T, toneStroke, type Tone } from './core/tokens';
import { useChartSize } from './core/useChartSize';
import { useHoverSync, useHoverValue, type HoverSync } from './core/hover';
import { useChartPointer } from './core/useChartPointer';
import { ChartTooltip, CrosshairDot, CrosshairRule, TooltipBody, type TooltipRow } from './core/Tooltip';
import { fmtDurShort, fmtInt, fmtNum, fmtPace } from './format';
import { spring } from './motion';

export interface CurveSeries {
  id: string;
  label: string;
  points: PeakPoint[];
  /** primary = accent 2px (this period) · secondary = fg-1 1.5px · comparison = fg-3 1px dashed */
  variant?: 'primary' | 'secondary' | 'comparison';
}

export interface EffortCurveProps {
  series: CurveSeries[];
  /** Value formatter for readouts (default integer). */
  format?: (v: number) => string;
  unit?: string;
  /** Second readout per value (e.g. W/kg). */
  secondary?: (v: number) => string;
  secondaryUnit?: string;
  /** Durations (s) to mark on the primary series with PB dots + labels. */
  markers?: number[];
  /** Critical-power model overlay (P = CP + W′/t). */
  model?: { cp: number; wPrime: number } | null;
  /** Start the y-axis at 0 (default for power) or fit to data (pace). */
  zeroBased?: boolean;
  height?: number;
  loading?: boolean;
  sync?: HoverSync<number>;
  /** Custom y tick values for a domain (e.g. round paces). */
  yTickValues?: (domain: [number, number]) => number[];
  /** Duration shown in the readout when nothing is hovered (default 1200 s). */
  focusSec?: number;
  className?: string;
}

const LOG_TICKS = [1, 5, 15, 60, 300, 1200, 3600, 7200, 18000];
const VARIANT: Record<NonNullable<CurveSeries['variant']>, { tone: Tone; width: number; dash?: string }> = {
  primary: { tone: 'accent', width: 2 },
  secondary: { tone: 'fg1', width: 1.5 },
  comparison: { tone: 'fg3', width: 1, dash: '3 3' },
};

export function EffortCurve(props: EffortCurveProps) {
  const { series, loading, height = 260, className, format = fmtInt, unit = '' } = props;
  const [ref, size] = useChartSize<HTMLDivElement>();
  const primary = series.find((s) => (s.variant ?? 'primary') === 'primary') ?? series[0];
  const p20 = primary?.points.find((p) => p.durationSec === 1200);
  const empty = !series.some((s) => s.points.length > 1);
  return (
    <div className={`min-w-0 ${className ?? ''}`}>
      <ChartFrame
        summary={empty ? 'Effort curve: no data' : `${primary.label} best efforts${p20 ? `, 20 minutes ${format(p20.value)} ${unit}` : ''}.`}
        loading={loading}
        empty={empty}
        height={height + 70}
        table={{
          caption: 'Best efforts by duration',
          columns: ['Duration', ...series.map((s) => s.label)],
          rows: [...new Set(series.flatMap((s) => s.points.map((p) => p.durationSec)))].sort((a, b) => a - b).map((d) => [fmtDurShort(d), ...series.map((s) => { const p = s.points.find((x) => x.durationSec === d); return p ? `${format(p.value)} ${unit}` : '—'; })]),
        }}
      >
        <div ref={ref} className="w-full">
          {size.width > 0 && <CurveInner {...props} width={size.width} height={height} />}
        </div>
      </ChartFrame>
    </div>
  );
}

function CurveInner({ series, width, height, format = fmtInt, unit = '', secondary, secondaryUnit = '', markers = [5, 60, 300, 1200, 3600], model, zeroBased = true, sync: ext, focusSec = 1200, yTickValues }: EffortCurveProps & { width: number; height: number }) {
  const defs = useChartDefs();
  const id = useId();
  const sync = useHoverSync<number>(ext);
  const compact = width < 480;
  const L = { left: 44, right: 16, top: 26, bottom: 22 };
  const plotW = Math.max(10, width - L.left - L.right);
  const plotB = L.top + height;
  const maxDur = Math.max(60, ...series.flatMap((s) => s.points.map((p) => p.durationSec)));
  const minDur = Math.max(1, Math.min(...series.flatMap((s) => s.points.map((p) => p.durationSec))));
  const x = useMemo(() => scaleLog().domain([minDur, maxDur]).range([L.left, L.left + plotW]).clamp(true), [minDur, maxDur, plotW, L.left]);
  const [lo, hi] = useMemo(() => {
    const vs = series.flatMap((s) => s.points.map((p) => p.value));
    const mx = Math.max(...vs);
    const mn = Math.min(...vs);
    return zeroBased ? [0, mx * 1.08] : [mn - (mx - mn) * 0.08, mx + (mx - mn) * 0.08];
  }, [series, zeroBased]);
  const y = useMemo(() => scaleLinear().domain([lo, hi]).range([plotB, L.top]).nice(4), [lo, hi, plotB, L.top]);
  const yTicks: Tick[] = yTickValues
    ? yTickValues(y.domain() as [number, number])
        .map((v) => ({ key: v, pos: y(v), label: format(v) }))
        .sort((p1, p2) => p2.pos - p1.pos)
        .reduce<Tick[]>((kept, t) => (kept.length && Math.abs(kept[kept.length - 1].pos - t.pos) < 18 ? kept : [...kept, t]), [])
    : linearTicks(y.domain() as [number, number], [plotB, L.top], 4, (v) => format(v));
  const keys = useMemo(() => [...new Set(series.flatMap((s) => s.points.map((p) => p.durationSec)))].sort((a, b) => a - b), [series]);
  const keyAt = useCallback(
    (px: number) => {
      if (px < L.left - 6 || px > L.left + plotW + 6) return null;
      const d = x.invert(px);
      let best = keys[0];
      for (const k of keys) if (Math.abs(Math.log(k) - Math.log(d)) < Math.abs(Math.log(best) - Math.log(d))) best = k;
      return best ?? null;
    },
    [x, keys, L.left, plotW],
  );
  const { handlers, live } = useChartPointer<number>({ keys, keyAt, sync, id, initialKey: focusSec, describe: (k) => `${fmtDurShort(k)}: ${series.map((s) => `${s.label} ${format(valueAt(s.points, k) ?? NaN)} ${unit}`).join(', ')}`, bigStep: 3 });

  const gen = line<PeakPoint>()
    .x((p) => x(p.durationSec))
    .y((p) => y(p.value))
    .curve(curveMonotoneX);
  const primary = series.find((s) => (s.variant ?? 'primary') === 'primary');
  const modelPath = useMemo(() => {
    if (!model) return '';
    const pts: PeakPoint[] = [];
    for (let t = 120; t <= maxDur; t *= 1.15) pts.push({ durationSec: t, value: model.cp + model.wPrime / t });
    return gen(pts) ?? '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, maxDur, x, y]);
  const tickVals = LOG_TICKS.filter((t) => t <= maxDur * 1.01 && t >= minDur * 0.99).filter((_, i) => !compact || i % 2 === 0);

  return (
    <div className="relative">
      <Readout series={series} sync={sync} focusSec={focusSec} format={format} unit={unit} secondary={secondary} secondaryUnit={secondaryUnit} />
      <svg
        width={width}
        height={plotB + L.bottom}
        className="block touch-pan-y select-none overflow-visible rounded-xs focus-visible:outline-offset-4"
        role="group"
        aria-roledescription="chart"
        aria-label="Best efforts by duration. Arrow keys move along durations."
        tabIndex={0}
        {...handlers}
      >
        <ChartDefs ids={defs} />
        <Grid ys={yTicks.map((t) => ({ key: t.key, pos: t.pos }))} x0={L.left} x1={L.left + plotW} />
        <AxisY ticks={yTicks.filter((t) => t.pos < plotB - 2)} x={L.left - 8} />
        {tickVals.map((t) => (
          <g key={t} aria-hidden>
            <line x1={x(t)} x2={x(t)} y1={plotB} y2={plotB + 4} style={{ stroke: T.line3 }} />
            <text x={x(t)} y={plotB + 8} textAnchor="middle" dominantBaseline="hanging" style={{ fontFamily: T.mono, fontSize: 11, fill: T.fg3 }}>
              {fmtDurShort(t)}
            </text>
          </g>
        ))}
        {model && (
          <g aria-hidden>
            <path d={modelPath} fill="none" style={{ stroke: T.fg4, strokeWidth: 1, strokeDasharray: '1 3' }} strokeLinecap="round" />
            <line x1={L.left} x2={L.left + plotW} y1={y(model.cp)} y2={y(model.cp)} style={{ stroke: T.line2, strokeDasharray: '2 4' }} />
            <text x={L.left + 6} y={y(model.cp) - 5} textAnchor="start" style={{ fontFamily: T.sans, fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', fill: T.fg3 }}>
              CP {fmtInt(model.cp)} {unit} · W′ {fmtNum(model.wPrime / 1000, 1)} KJ
            </text>
          </g>
        )}
        <Reveal id={defs.id('rv')} x={L.left} y={0} width={plotW} height={plotB + 10}>
          {[...series]
            .sort((a, b) => order(a) - order(b))
            .map((s) => {
              const v = VARIANT[s.variant ?? 'primary'];
              return (
                <g key={s.id}>
                  {(s.variant ?? 'primary') === 'primary' && (
                    <MorphPath d={(area0(s.points, x, y, plotB) as string) ?? ''} style={{ fill: defs.fadeAccent, opacity: 0.6 }} />
                  )}
                  <MorphPath d={gen(s.points) ?? ''} fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: toneStroke[v.tone], strokeWidth: v.width, strokeDasharray: v.dash }} />
                </g>
              );
            })}
        </Reveal>
        {primary &&
          markers.map((m, k) => {
            const pv = valueAt(primary.points, m);
            if (pv == null || m > maxDur) return null;
            return (
              <motion.g key={m} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ ...spring.smooth, delay: 0.4 + k * 0.05 }} aria-hidden>
                <circle cx={x(m)} cy={y(pv)} r={3.5} style={{ fill: T.accent, stroke: T.bg, strokeWidth: 2 }} />
                {!compact && (
                  <text x={k % 2 ? x(m) - 6 : x(m) + 6} y={k % 2 ? y(pv) + 16 : y(pv) - 8} textAnchor={k % 2 ? 'end' : 'start'} style={{ fontFamily: T.mono, fontSize: 10.5, fill: T.fg2 }}>
                    {format(pv)}
                    <tspan dx={3} style={{ fontFamily: T.sans, fontSize: 9.5, fontWeight: 600, letterSpacing: '0.06em', fill: T.fg3 }}>
                      {fmtDurShort(m).toUpperCase()}
                    </tspan>
                  </text>
                )}
              </motion.g>
            );
          })}
        <Overlay series={series} sync={sync} x={x} y={y} top={L.top} bottom={plotB} />
      </svg>
      <Tip series={series} sync={sync} x={x} width={width} top={L.top + 20} format={format} unit={unit} secondary={secondary} secondaryUnit={secondaryUnit} />
      <span className="sr-only" aria-live="polite">
        {live}
      </span>
    </div>
  );
}

const order = (s: CurveSeries) => ({ comparison: 0, secondary: 1, primary: 2 })[s.variant ?? 'primary'];

function area0(points: PeakPoint[], x: (v: number) => number, y: (v: number) => number, base: number) {
  if (!points.length) return '';
  const l = line<PeakPoint>()
    .x((p) => x(p.durationSec))
    .y((p) => y(p.value))
    .curve(curveMonotoneX)(points);
  return `${l}L${x(points[points.length - 1].durationSec)},${base}L${x(points[0].durationSec)},${base}Z`;
}

/** Value at duration (exact match, or log-interpolated between neighbours). */
export function valueAt(points: PeakPoint[], sec: number): number | null {
  if (!points.length) return null;
  const ex = points.find((p) => p.durationSec === sec);
  if (ex) return ex.value;
  const i = points.findIndex((p) => p.durationSec > sec);
  if (i <= 0) return null;
  const a = points[i - 1];
  const b = points[i];
  const f = (Math.log(sec) - Math.log(a.durationSec)) / (Math.log(b.durationSec) - Math.log(a.durationSec));
  return a.value + (b.value - a.value) * f;
}

function Overlay({ series, sync, x, y, top, bottom }: { series: CurveSeries[]; sync: HoverSync<number>; x: (v: number) => number; y: (v: number) => number; top: number; bottom: number }) {
  const k = useHoverValue(sync);
  if (k == null) return null;
  return (
    <g pointerEvents="none">
      <CrosshairRule x={Math.round(x(k)) + 0.5} y0={top} y1={bottom} />
      {series.map((s) => {
        const v = valueAt(s.points, k);
        return v == null ? null : <CrosshairDot key={s.id} x={x(k)} y={y(v)} tone={VARIANT[s.variant ?? 'primary'].tone} />;
      })}
    </g>
  );
}

function rowsFor(series: CurveSeries[], k: number, format: (v: number) => string, unit: string, secondary?: (v: number) => string, secondaryUnit?: string): TooltipRow[] {
  return series.map((s) => {
    const v = valueAt(s.points, k);
    const vv = VARIANT[s.variant ?? 'primary'];
    return { label: s.label, value: v == null ? '—' : `${format(v)}${unit ? ` ${unit}` : ''}`, hint: v != null && secondary ? `${secondary(v)}${secondaryUnit ? ` ${secondaryUnit}` : ''}` : undefined, strong: (s.variant ?? 'primary') === 'primary', swatch: { tone: vv.tone, width: vv.width, dash: vv.dash } };
  });
}

function Tip({ series, sync, x, width, top, format, unit, secondary, secondaryUnit }: { series: CurveSeries[]; sync: HoverSync<number>; x: (v: number) => number; width: number; top: number; format: (v: number) => string; unit: string; secondary?: (v: number) => string; secondaryUnit?: string }) {
  const k = useHoverValue(sync);
  const kk = k ?? 60;
  return (
    <ChartTooltip x={x(kk)} y={top} containerWidth={width} visible={k != null}>
      <TooltipBody title={`Best ${fmtDurShort(kk)}`} rows={rowsFor(series, kk, format, unit, secondary, secondaryUnit)} />
    </ChartTooltip>
  );
}

/** Legend that doubles as a readout for the hovered (or focus) duration. */
function Readout({ series, sync, focusSec, format, unit, secondary, secondaryUnit }: { series: CurveSeries[]; sync: HoverSync<number>; focusSec: number; format: (v: number) => string; unit: string; secondary?: (v: number) => string; secondaryUnit: string }) {
  const k = useHoverValue(sync) ?? focusSec;
  return (
    <div className="mb-2 flex flex-wrap items-end gap-x-6 gap-y-2" aria-hidden>
      <div className="flex flex-col">
        <span className="text-micro uppercase text-fg-3">Duration</span>
        <span className="font-mono text-mono text-fg-1">{fmtDurShort(k)}</span>
      </div>
      {series.map((s) => {
        const v = valueAt(s.points, k);
        const vv = VARIANT[s.variant ?? 'primary'];
        return (
          <div key={s.id} className="flex flex-col">
            <span className="flex items-center gap-1.5 text-micro uppercase text-fg-3">
              <svg width="14" height="6">
                <line x1="0" x2="14" y1="3" y2="3" style={{ stroke: toneStroke[vv.tone], strokeWidth: vv.width + 0.5, strokeDasharray: vv.dash }} />
              </svg>
              {s.label}
            </span>
            <span className="flex items-baseline gap-1.5">
              <span className={`num text-stat-sm ${vv.tone === 'accent' ? 'text-accent-ink' : vv.tone === 'fg1' ? 'text-fg-1' : 'text-fg-2'}`}>{v == null ? '—' : format(v)}</span>
              <span className="text-label text-fg-3">{unit}</span>
              {secondary && v != null && (
                <span className="font-mono text-mono-sm text-fg-3">
                  {secondary(v)} {secondaryUnit}
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Power curve: W with W/kg readouts. */
export function PowerCurve({ weightKg, ...rest }: Omit<EffortCurveProps, 'format' | 'unit' | 'secondary'> & { weightKg?: number }) {
  return <EffortCurve {...rest} format={fmtInt} unit="W" secondary={weightKg ? (v) => (v / weightKg).toFixed(2) : undefined} secondaryUnit="W/kg" />;
}

/** Pace curve: points carry speed in m/s (higher = faster), readouts as pace per `per` metres. */
export function PaceCurve({ per = 1000, ...rest }: Omit<EffortCurveProps, 'format' | 'unit' | 'zeroBased'> & { per?: number }) {
  const ticks = ([lo, hi]: [number, number]) => {
    // round paces (in seconds per `per` metres) → speeds
    const sHi = per / Math.max(0.1, lo);
    const sLo = per / hi;
    const step = [5, 10, 15, 30, 60, 120].find((s) => (sHi - sLo) / s <= 7) ?? 120;
    const out: number[] = [];
    for (let s = Math.ceil(sLo / step) * step; s <= sHi; s += step) out.push(per / s);
    return out;
  };
  return <EffortCurve {...rest} zeroBased={false} yTickValues={ticks} format={(v) => fmtPace(v, per)} unit={per === 1000 ? '/km' : per === 100 ? '/100m' : '/500m'} />;
}
