/**
 * WellnessChart — small multiples sharing one x-axis and one crosshair (product.md §6.2
 * /trends/wellness): HRV (daily dots, 7-day mean, 60-day baseline band ±1 SD), resting HR
 * (same treatment), sleep (bars + 8 h reference), weight (dots + 7-day mean). Optional faint
 * daily-load bars under HRV to read load → HRV response. No dual axes: one panel per measure.
 * v2: the first panel's 7-day mean (HRV by default) is the one accent line; everything else is
 * neutral (other means fg-1, daily values small fg-4 dots, the normal band a faint wash),
 * sentence-case panel labels, ≤ 2 gridlines per panel.
 */
import { useCallback, useId, useMemo } from 'react';
import { area, curveMonotoneX, line } from 'd3-shape';
import { scaleLinear } from 'd3-scale';
import { bisectCenter } from 'd3-array';
import type { LocalDate, WellnessDay } from '@cadence/core';
import { ChartDefs, useChartDefs } from './core/ChartDefs';
import { ChartFrame } from './core/ChartFrame';
import { dateTicks, thinTicks } from './core/Axis';
import { EndLabels } from './core/EndLabels';
import { FadeIn, Reveal } from './core/animated';
import { T, TXT } from './core/tokens';
import { useChartSize } from './core/useChartSize';
import { useHoverSync, useHoverValue, type HoverSync } from './core/hover';
import { useChartPointer } from './core/useChartPointer';
import { ChartTooltip, CrosshairDot, CrosshairRule, TooltipBody, type TooltipRow } from './core/Tooltip';
import { dateMs, fmtDayLong, fmtHM, fmtNum } from './format';

export type WellnessMetric = 'hrv' | 'rhr' | 'sleep' | 'weight';

export interface WellnessChartProps {
  days: WellnessDay[];
  metrics?: WellnessMetric[];
  /** Faint daily-load bars under the HRV panel. */
  loads?: { date: LocalDate; load: number }[];
  baselineDays?: number;
  rollingDays?: number;
  panelHeight?: number;
  today?: LocalDate;
  sync?: HoverSync<LocalDate>;
  loading?: boolean;
  className?: string;
}

interface Series {
  key: WellnessMetric;
  label: string;
  unit: string;
  raw: (number | null)[];
  roll: (number | null)[];
  band?: { lo: (number | null)[]; hi: (number | null)[] };
  fmt: (v: number) => string;
  kind: 'dots' | 'bars';
  ref?: number;
}

function rolling(v: (number | null)[], n: number) {
  return v.map((_, i) => {
    let s = 0;
    let c = 0;
    for (let k = Math.max(0, i - n + 1); k <= i; k++) if (v[k] != null) {
      s += v[k]!;
      c++;
    }
    return c >= Math.min(3, n) ? s / c : null;
  });
}
function baseline(v: (number | null)[], n: number) {
  const lo: (number | null)[] = [];
  const hi: (number | null)[] = [];
  v.forEach((_, i) => {
    const w: number[] = [];
    for (let k = Math.max(0, i - n + 1); k <= i; k++) if (v[k] != null) w.push(v[k]!);
    if (w.length < 14) {
      lo.push(null);
      hi.push(null);
      return;
    }
    const m = w.reduce((a, b) => a + b, 0) / w.length;
    const sd = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / w.length);
    lo.push(m - sd);
    hi.push(m + sd);
  });
  return { lo, hi };
}

export function WellnessChart(props: WellnessChartProps) {
  const { days, loading, panelHeight = 84, metrics = ['hrv', 'rhr', 'sleep', 'weight'], className } = props;
  const [ref, size] = useChartSize<HTMLDivElement>();
  const last = days[days.length - 1];
  return (
    <div className={`min-w-0 ${className ?? ''}`}>
      <ChartFrame
        summary={last ? `Wellness over ${days.length} days. Latest HRV ${fmtNum(last.hrvMs)} ms, resting HR ${fmtNum(last.restingHr)} bpm, sleep ${fmtHM(last.sleepSec)} h.` : 'Wellness: no data'}
        loading={loading}
        empty={days.length < 2}
        emptyHint="Wellness data arrives from Garmin each morning, or log a check-in."
        height={metrics.length * (panelHeight + 22) + 24}
        table={{ caption: 'Daily wellness', columns: ['Date', 'HRV ms', 'Resting HR', 'Sleep h', 'Weight kg'], rows: days.slice(-90).map((d) => [d.date, fmtNum(d.hrvMs), fmtNum(d.restingHr), fmtHM(d.sleepSec), fmtNum(d.weightKg, 1)]) }}
      >
        <div ref={ref} className="w-full">
          {size.width > 0 && <WellInner {...props} metrics={metrics} panelHeight={panelHeight} width={size.width} />}
        </div>
      </ChartFrame>
    </div>
  );
}

function WellInner({ days, metrics = [], loads, baselineDays = 60, rollingDays = 7, panelHeight = 84, width, sync: ext }: WellnessChartProps & { width: number }) {
  const defs = useChartDefs();
  const id = useId();
  const sync = useHoverSync<LocalDate>(ext);
  const compact = width < 480;
  const L = { left: 40, right: compact ? 8 : 96, gap: 32, labelH: 20 };
  const plotW = Math.max(10, width - L.left - L.right);
  const ms = useMemo(() => days.map((d) => dateMs(d.date)), [days]);
  const x0 = ms[0];
  const x1 = ms[ms.length - 1];
  const X = useCallback((t: number) => L.left + ((t - x0) / (x1 - x0 || 1)) * plotW, [L.left, x0, x1, plotW]);

  const series: Series[] = useMemo(() => {
    const out: Series[] = [];
    for (const m of metrics) {
      if (m === 'hrv') {
        const raw = days.map((d) => d.hrvMs ?? null);
        out.push({ key: m, label: 'HRV', unit: 'ms', raw, roll: rolling(raw, rollingDays), band: baseline(raw, baselineDays), fmt: (v) => fmtNum(v), kind: 'dots' });
      } else if (m === 'rhr') {
        const raw = days.map((d) => d.restingHr ?? null);
        out.push({ key: m, label: 'Resting HR', unit: 'bpm', raw, roll: rolling(raw, rollingDays), band: baseline(raw, baselineDays), fmt: (v) => fmtNum(v), kind: 'dots' });
      } else if (m === 'sleep') {
        const raw = days.map((d) => (d.sleepSec != null ? d.sleepSec / 3600 : null));
        out.push({ key: m, label: 'Sleep', unit: 'h', raw, roll: rolling(raw, rollingDays), fmt: (v) => fmtHM(v * 3600), kind: 'bars', ref: 8 });
      } else if (m === 'weight') {
        const raw = days.map((d) => d.weightKg ?? null);
        out.push({ key: m, label: 'Weight', unit: 'kg', raw, roll: rolling(raw, rollingDays), fmt: (v) => fmtNum(v, 1), kind: 'dots' });
      }
    }
    return out.filter((s) => s.raw.some((v) => v != null));
  }, [days, metrics, rollingDays, baselineDays]);

  const heroKey = series[0]?.key;
  const panels = series.map((s, i) => {
    const top = i * (panelHeight + L.gap) + L.labelH;
    const bot = top + panelHeight;
    const vals = [...s.raw, ...(s.band?.lo ?? []), ...(s.band?.hi ?? [])].filter((v): v is number => v != null);
    let lo = s.kind === 'bars' ? 0 : Math.min(...vals);
    let hi = Math.max(...vals, s.ref ?? -Infinity);
    const pad = (hi - lo) * 0.1 || 1;
    if (s.kind !== 'bars') lo -= pad;
    hi += pad;
    const Y = (v: number) => bot - ((v - lo) / (hi - lo)) * panelHeight;
    return { s, top, bot, Y, lo, hi };
  });
  const totalH = panels.length ? panels[panels.length - 1].bot + 24 : 40;
  const keys = useMemo(() => days.map((d) => d.date), [days]);
  const keyAt = useCallback(
    (x: number) => {
      if (x < L.left - 4 || x > L.left + plotW + 4) return null;
      const t = x0 + ((x - L.left) / plotW) * (x1 - x0);
      return keys[Math.max(0, Math.min(keys.length - 1, bisectCenter(ms, t)))];
    },
    [L.left, plotW, x0, x1, keys, ms],
  );
  const { handlers, live } = useChartPointer<LocalDate>({ keys, keyAt, sync, id, initialKey: keys[keys.length - 1], describe: (k) => { const d = days[keys.indexOf(k)]; return `${fmtDayLong(k)}: HRV ${fmtNum(d.hrvMs)} ms, resting HR ${fmtNum(d.restingHr)}, sleep ${fmtHM(d.sleepSec)}`; } });
  const xTicks = thinTicks(dateTicks(X, x0, x1, plotW));
  const loadMap = useMemo(() => new Map((loads ?? []).map((l) => [l.date, l.load])), [loads]);
  const loadMax = Math.max(1, ...(loads ?? []).map((l) => l.load));
  const barW = Math.max(1.5, Math.min(6, (plotW / days.length) * 0.6));

  return (
    <div className="relative">
      <svg width={width} height={totalH} className="block touch-pan-y select-none overflow-visible rounded-xs focus-visible:outline-offset-4" role="group" aria-roledescription="chart" aria-label="Wellness small multiples" tabIndex={0} {...handlers}>
        <ChartDefs ids={defs} />
        {panels.map(({ s, top, bot, Y, lo, hi }, pi) => {
          const ln = line<number | null>().defined((v) => v != null).x((_, i) => X(ms[i])).y((v) => Y(v!)).curve(curveMonotoneX);
          const bandArea = s.band
            ? area<number>()
                .defined((i) => s.band!.lo[i] != null)
                .x((i) => X(ms[i]))
                .y0((i) => Y(s.band!.lo[i]!))
                .y1((i) => Y(s.band!.hi[i]!))
                .curve(curveMonotoneX)(days.map((_, i) => i)) ?? ''
            : '';
          const lastI = s.roll.reduce<number>((a, v, i) => (v != null ? i : a), -1);
          const ticks = scaleLinear().domain([lo, hi]).ticks(2).filter((v) => Y(v) > top + 6 && Y(v) < bot - 4).slice(-2);
          return (
            <g key={s.key}>
              <text x={L.left} y={top - 8} style={{ ...TXT, fill: T.fg2, fontWeight: 500 }}>
                {s.label}
                <tspan dx={6} style={{ fontWeight: 400, fill: T.fg3 }}>
                  {s.unit}
                  {s.band && !compact && pi === 0 ? ` · shaded = ${baselineDays}-day normal` : ''}
                </tspan>
                {compact && lastI >= 0 && (
                  <tspan dx={8} style={{ fontWeight: 500, fill: T.fg1 }}>
                    {s.fmt(s.roll[lastI]!)} <tspan style={{ fill: T.fg3 }}>{rollingDays}-d avg</tspan>
                  </tspan>
                )}
              </text>
              {ticks.map((v) => (
                <g key={v} aria-hidden>
                  <line x1={L.left} x2={L.left + plotW} y1={Y(v)} y2={Y(v)} style={{ stroke: T.line1 }} shapeRendering="crispEdges" />
                  <text x={L.left - 10} y={Y(v)} textAnchor="end" dominantBaseline="central" style={{ ...TXT, fill: T.fg3 }}>
                    {v}
                  </text>
                </g>
              ))}
              {s.key === 'hrv' && loads && (
                <g aria-hidden>
                  {days.map((d, i) => {
                    const l = loadMap.get(d.date) ?? 0;
                    if (!l) return null;
                    const h = (l / loadMax) * panelHeight * 0.32;
                    return <rect key={d.date} x={X(ms[i]) - barW / 2} y={bot - h} width={barW} height={h} rx={Math.min(1, barW / 2)} style={{ fill: T.fg4, opacity: 0.3 }} />;
                  })}
                </g>
              )}
              {bandArea && (
                <FadeIn delay={0.05 * pi}>
                  <path d={bandArea} style={{ fill: T.fg1, opacity: 0.05 }} />
                </FadeIn>
              )}
              {s.ref != null && <line x1={L.left} x2={L.left + plotW} y1={Y(s.ref)} y2={Y(s.ref)} strokeLinecap="round" style={{ stroke: T.fg4, strokeDasharray: '1 3' }} />}
              {s.ref != null && (
                <text x={L.left + plotW - 2} y={Y(s.ref) - 6} textAnchor="end" style={{ ...TXT, fill: T.fg3 }}>
                  {s.ref} h
                </text>
              )}
              <Reveal id={defs.id(`rv${pi}`)} x={L.left} y={top - 4} width={plotW} height={panelHeight + 8} delay={0.05 * pi}>
                {s.kind === 'bars'
                  ? s.raw.map((v, i) => (v == null ? null : <rect key={i} x={X(ms[i]) - barW / 2} y={Y(v)} width={barW} height={bot - Y(v)} rx={Math.min(1.5, barW / 2)} style={{ fill: T.s3 }} />))
                  : s.raw.map((v, i) => {
                      if (v == null) return null;
                      const out = s.band && s.band.lo[i] != null && (v < s.band.lo[i]! || v > s.band.hi[i]!);
                      return <circle key={i} cx={X(ms[i])} cy={Y(v)} r={out ? 2 : 1.5} style={out ? { fill: 'none', stroke: T.fg3, strokeWidth: 1 } : { fill: T.fg4, opacity: 0.8 }} />;
                    })}
                <path d={ln(s.roll) ?? ''} fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: s.key === heroKey ? T.accent : s.key === 'sleep' ? T.fg2 : T.fg1, strokeWidth: s.key === heroKey ? 1.75 : 1.25 }} />
              </Reveal>
              {!compact && lastI >= 0 && <EndLabels labels={[{ id: s.key, y: Y(s.roll[lastI]!), value: s.fmt(s.roll[lastI]!), name: `${rollingDays}-d avg`, tone: s.key === heroKey ? 'accent' : 'fg1' }]} x={L.left + plotW + 8} top={top} bottom={bot} />}
            </g>
          );
        })}
        <g aria-hidden>
          {xTicks.map((t) => (
            <text key={t.key} x={t.pos} y={totalH - 14} textAnchor="middle" dominantBaseline="hanging" style={{ ...TXT, fill: t.strong ? T.fg2 : T.fg3 }}>
              {t.label}
            </text>
          ))}
        </g>
        <WellOverlay sync={sync} keys={keys} ms={ms} X={X} panels={panels} />
      </svg>
      <WellTip sync={sync} keys={keys} ms={ms} X={X} series={series} days={days} width={width} />
      <span className="sr-only" aria-live="polite">
        {live}
      </span>
    </div>
  );
}

function WellOverlay({ sync, keys, ms, X, panels }: { sync: HoverSync<LocalDate>; keys: LocalDate[]; ms: number[]; X: (t: number) => number; panels: { s: Series; top: number; bot: number; Y: (v: number) => number }[] }) {
  const k = useHoverValue(sync);
  const i = k == null ? -1 : keys.indexOf(k);
  if (i < 0 || !panels.length) return null;
  const x = X(ms[i]);
  return (
    <g pointerEvents="none">
      <CrosshairRule x={Math.round(x) + 0.5} y0={panels[0].top} y1={panels[panels.length - 1].bot} />
      {panels.map(({ s, Y }) => {
        const v = s.roll[i] ?? s.raw[i];
        return v == null ? null : <CrosshairDot key={s.key} x={x} y={Y(v)} tone={s.key === panels[0].s.key ? 'accent' : 'fg2'} />;
      })}
    </g>
  );
}

function WellTip({ sync, keys, ms, X, series, days, width }: { sync: HoverSync<LocalDate>; keys: LocalDate[]; ms: number[]; X: (t: number) => number; series: Series[]; days: WellnessDay[]; width: number }) {
  const k = useHoverValue(sync);
  const i = k == null ? -1 : keys.indexOf(k);
  const j = Math.max(0, i);
  const rows: TooltipRow[] = series.map((s) => ({
    label: s.label,
    value: s.raw[j] == null ? '—' : `${s.fmt(s.raw[j]!)} ${s.unit}`,
    hint: s.roll[j] != null ? `avg ${s.fmt(s.roll[j]!)}` : undefined,
  }));
  const d = days[j];
  if (d?.readiness != null) rows.push({ label: 'Readiness', value: fmtNum(d.readiness), muted: true });
  return (
    <ChartTooltip x={X(ms[j] ?? 0)} y={8} containerWidth={width} visible={i >= 0}>
      <TooltipBody title={k ? fmtDayLong(k) : ''} rows={rows} />
    </ChartTooltip>
  );
}

