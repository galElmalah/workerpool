/**
 * WowDeltaBars — diverging week-over-week % change, neutral bars: increase = fg-4, decrease =
 * fainter fg-4, beyond `cautionAbove` (+15 %) = the `warn` status colour + ⚠ (DESIGN_V2 §8.3;
 * the label stays ink, never an outline). Value labels
 * thin out with the bar width (latest + caution weeks first); every value is in the tooltip.
 * Also exports `wowItems()` and `compareWeeks()` helpers for WoW tiles.
 */
import { useCallback, useId, useMemo } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import type { IsoWeek, WeekSummary } from '@cadence/core';
import { ChartDefs, useChartDefs } from './core/ChartDefs';
import { ChartFrame } from './core/ChartFrame';
import { SvgTicker } from './core/animated';
import { T, TXT } from './core/tokens';
import { thinTicks } from './core/Axis';
import { useChartSize } from './core/useChartSize';
import { useHoverSync, useHoverValue, type HoverSync } from './core/hover';
import { useChartPointer } from './core/useChartPointer';
import { ChartTooltip, TooltipBody } from './core/Tooltip';
import { WEEKLY_ACCESSORS, type WeeklyMetric } from './WeeklyBars';
import { fmtMonthDay, fmtPct, deltaDir } from './format';
import { spring, staggerDelay } from './motion';

export interface WowItem {
  key: string;
  label: string;
  /** Fraction (0.08 = +8 %), null when there is no previous value. */
  value: number | null;
  /** Optional readout for the tooltip ("9:40 h vs 8:58 h"). */
  detail?: string;
}

/** WeekSummary[] → WowItems for one metric. */
export function wowItems(weeks: WeekSummary[], metric: WeeklyMetric = 'load'): WowItem[] {
  const acc = WEEKLY_ACCESSORS[metric];
  return weeks.map((w, i) => {
    const prev = weeks[i - 1];
    const u = acc.unit ? ` ${acc.unit}` : '';
    return { key: w.isoWeek, label: fmtMonthDay(w.startDate), value: acc.wow(w), detail: prev ? `${acc.fmt(acc.done(w))}${u} vs ${acc.fmt(acc.done(prev))}${u}` : undefined };
  });
}

export type CompareMode = 'week' | '4v4';
export interface CompareTile {
  id: 'hours' | 'load' | 'fitness' | 'form' | 'key' | 'compliance';
  label: string;
  current: number;
  previous: number;
  /** Fraction change (null when previous is 0). For fitness/form this is an absolute delta. */
  delta: number | null;
  deltaKind: 'pct' | 'abs';
  unit: string;
}

/**
 * Data for the trends overview WoW tiles (product.md §6.1 row 1): this week (so far) vs last
 * week, or the last 4 complete weeks vs the prior 4.
 */
export function compareWeeks(weeks: WeekSummary[], mode: CompareMode = 'week'): CompareTile[] {
  const n = weeks.length;
  if (!n) return [];
  const cur = mode === 'week' ? weeks.slice(-1) : weeks.slice(Math.max(0, n - 5), n - 1);
  const prev = mode === 'week' ? weeks.slice(-2, -1) : weeks.slice(Math.max(0, n - 9), Math.max(0, n - 5));
  const sum = (ws: WeekSummary[], f: (w: WeekSummary) => number) => ws.reduce((a, w) => a + f(w), 0);
  const pct = (a: number, b: number) => (b ? a / b - 1 : null);
  const lastOf = (ws: WeekSummary[]) => ws[ws.length - 1];
  const h = [sum(cur, (w) => w.doneSec / 3600), sum(prev, (w) => w.doneSec / 3600)];
  const l = [sum(cur, (w) => w.doneLoad), sum(prev, (w) => w.doneLoad)];
  const k = [sum(cur, (w) => w.keyDone), sum(prev, (w) => w.keyDone)];
  const kp = [sum(cur, (w) => w.keyPlanned), sum(prev, (w) => w.keyPlanned)];
  const cmp = (ws: WeekSummary[]) => {
    const v = ws.map((w) => w.compliancePct).filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
  };
  const fc = lastOf(cur)?.fitness ?? 0;
  const fp = lastOf(prev)?.fitness ?? 0;
  return [
    { id: 'hours', label: 'Hours', current: h[0], previous: h[1], delta: pct(h[0], h[1]), deltaKind: 'pct', unit: 'h' },
    { id: 'load', label: 'Load', current: l[0], previous: l[1], delta: pct(l[0], l[1]), deltaKind: 'pct', unit: '' },
    { id: 'fitness', label: 'Fitness', current: fc, previous: fp, delta: fc - fp, deltaKind: 'abs', unit: '' },
    { id: 'form', label: 'Form', current: lastOf(cur)?.form ?? 0, previous: lastOf(prev)?.form ?? 0, delta: (lastOf(cur)?.form ?? 0) - (lastOf(prev)?.form ?? 0), deltaKind: 'abs', unit: '' },
    { id: 'key', label: 'Key sessions', current: k[0], previous: k[1], delta: kp[0] ? k[0] / kp[0] - (kp[1] ? k[1] / kp[1] : 0) : null, deltaKind: 'pct', unit: `/ ${kp[0]}` },
    { id: 'compliance', label: 'Compliance', current: cmp(cur), previous: cmp(prev), delta: cmp(prev) ? cmp(cur) / cmp(prev) - 1 : null, deltaKind: 'pct', unit: '%' },
  ];
}

export interface WowDeltaBarsProps {
  items: WowItem[];
  cautionAbove?: number;
  height?: number;
  loading?: boolean;
  sync?: HoverSync<string>;
  onItemClick?: (key: string) => void;
  /** Clamp the symmetric domain (default ±60 %); clipped bars get a chevron tip. */
  maxAbs?: number;
  className?: string;
}

export function WowDeltaBars(props: WowDeltaBarsProps) {
  const { items, loading, height = 150, className } = props;
  const [ref, size] = useChartSize<HTMLDivElement>();
  const last = [...items].reverse().find((i) => i.value != null);
  const summary = last ? `Week over week change. Latest ${last.label}: ${fmtPct(last.value)}.` : 'Week over week change: no data';
  return (
    <div className={`min-w-0 ${className ?? ''}`}>
      <ChartFrame
        summary={summary}
        loading={loading}
        empty={!items.some((i) => i.value != null)}
        height={height + 28}
        table={{ caption: 'Week over week change', columns: ['Week', 'Change'], rows: items.map((i) => [i.label, fmtPct(i.value)]) }}
      >
        <div ref={ref} className="w-full">
          {size.width > 0 && <WowInner {...props} width={size.width} height={height} />}
        </div>
      </ChartFrame>
    </div>
  );
}

function WowInner({ items, width, height, cautionAbove = 0.15, maxAbs = 0.6, sync: ext, onItemClick }: WowDeltaBarsProps & { width: number; height: number }) {
  const defs = useChartDefs();
  const id = useId();
  const reduce = useReducedMotion();
  const sync = useHoverSync<string>(ext);
  const n = items.length;
  const L = { left: 44, right: 12, top: 34, bottom: 28 };
  const plotW = Math.max(10, width - L.left - L.right);
  const band = plotW / n;
  const barW = Math.max(2, Math.min(16, band * 0.5));
  const dom = useMemo(() => Math.min(maxAbs, Math.max(0.2, ...items.map((i) => Math.abs(i.value ?? 0))) * 1.1), [items, maxAbs]);
  const zeroY = L.top + height / 2;
  const y = (v: number) => zeroY - (Math.max(-dom, Math.min(dom, v)) / dom) * (height / 2 - 16);
  const xc = (i: number) => L.left + band * (i + 0.5);
  const keys = useMemo(() => items.map((i) => i.key), [items]);
  const keyAt = useCallback((x: number) => {
    const i = Math.floor((x - L.left) / band);
    return i >= 0 && i < n ? keys[i] : null;
  }, [L.left, band, n, keys]);
  const { handlers, live } = useChartPointer<string>({ keys, keyAt, sync, id, onActivate: onItemClick, describe: (k) => `${items[keys.indexOf(k)].label}: ${fmtPct(items[keys.indexOf(k)].value)}`, bigStep: 4 });
  const half = Math.round((dom / 2) * 20) / 20;
  const ticks = [-half, 0, half];
  const fmtV = (x: number) => (Math.abs(x) < 0.005 ? '±0%' : fmtPct(x));

  // Value labels: every bar when there is room; otherwise the latest bar and the caution bars,
  // biggest first, skipping any label that would overlap one already placed on the same side.
  const valueLabels = useMemo(() => {
    const cand = items.map((it, i) => ({ i, v: it.value })).filter((c): c is { i: number; v: number } => c.v != null);
    const textW = (v: number) => fmtV(v).length * 6.8 + (v > cautionAbove ? 14 : 0);
    const roomy = band >= 46;
    const lastI = cand.length ? cand[cand.length - 1].i : -1;
    const order = roomy ? cand : [...cand.filter((c) => c.i === lastI), ...cand.filter((c) => c.i !== lastI && c.v > cautionAbove).sort((p, q) => Math.abs(q.v) - Math.abs(p.v))];
    const placed: { i: number; x: number; w: number; up: boolean }[] = [];
    for (const c of order) {
      const x = xc(c.i);
      const w = textW(c.v);
      const up = c.v >= 0;
      if (x - w / 2 < L.left - 4 || x + w / 2 > width) continue;
      if (placed.some((p) => p.up === up && Math.abs(p.x - x) < (p.w + w) / 2 + 8)) continue;
      placed.push({ i: c.i, x, w, up });
    }
    return new Set(placed.map((p) => p.i));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, band, width, cautionAbove]);
  const xTicks = thinTicks(
    items.map((it, i) => ({ key: it.key, pos: -xc(i), label: it.label })).reverse(),
  ).map((t) => ({ ...t, pos: -t.pos }));

  return (
    <div className="relative">
      <svg
        width={width}
        height={L.top + height + L.bottom}
        className="block touch-pan-y select-none overflow-visible rounded-xs focus-visible:outline-offset-4"
        role="group"
        aria-roledescription="chart"
        aria-label="Week over week change"
        tabIndex={0}
        {...handlers}
      >
        <ChartDefs ids={defs} />
        {ticks.map((t) => (
          <g key={t} aria-hidden>
            <line x1={L.left} x2={L.left + plotW} y1={y(t)} y2={y(t)} style={{ stroke: t === 0 ? T.line2 : T.line1 }} shapeRendering="crispEdges" />
            <text x={L.left - 10} y={y(t)} textAnchor="end" dominantBaseline="central" style={{ ...TXT, fill: T.fg3 }}>
              {t === 0 ? '0' : fmtPct(t)}
            </text>
          </g>
        ))}
        {cautionAbove < dom && (
          <g aria-hidden>
            <line x1={L.left} x2={L.left + plotW} y1={y(cautionAbove)} y2={y(cautionAbove)} style={{ stroke: T.fg4, strokeDasharray: '1 3', opacity: 0.8 }} strokeLinecap="round" />
            <line x1={L.left} x2={L.left + 14} y1={8} y2={8} strokeLinecap="round" style={{ stroke: T.fg4, strokeDasharray: '1 3' }} />
            <text x={L.left + 20} y={8} dominantBaseline="central" style={{ ...TXT, fill: T.fg3 }}>
              Caution above {fmtPct(cautionAbove)}
            </text>
          </g>
        )}
        <Hover sync={sync} keys={keys} xc={xc} band={band} top={L.top} bottom={L.top + height} />
        {items.map((it, i) => {
          if (it.value == null) return null;
          const v = it.value;
          const dir = deltaDir(v);
          const caution = v > cautionAbove;
          const clipped = Math.abs(v) > dom;
          const yv = y(v);
          const top = Math.min(yv, zeroY);
          const h = Math.max(dir === 'flat' ? 1 : 1.5, Math.abs(yv - zeroY));
          const x = xc(i) - barW / 2;
          const delay = reduce ? 0 : staggerDelay(i);
          const fill = caution ? T.warn : T.fg4;
          return (
            <g key={it.key}>
              <motion.rect
                x={x}
                width={barW}
                rx={Math.min(2.5, barW / 2)}
                initial={{ y: zeroY, height: 0 }}
                animate={{ y: top, height: h }}
                transition={{ ...spring.gentle, delay }}
                style={{ fill, opacity: v < 0 ? 0.6 : 1 }}
              />
              {clipped && <path d={`M${xc(i) - 3} ${yv + (v > 0 ? 5 : -5)} l3 ${v > 0 ? -4 : 4} l3 ${v > 0 ? 4 : -4}`} style={{ fill: 'none', stroke: T.bg, strokeWidth: 1.5 }} />}
              {valueLabels.has(i) && (
                <motion.text
                  x={xc(i)}
                  initial={{ opacity: 0, y: zeroY }}
                  animate={{ opacity: 1, y: v >= 0 ? top - 6 : top + h + 6 }}
                  transition={{ ...spring.smooth, delay }}
                  textAnchor="middle"
                  dominantBaseline={v >= 0 ? 'auto' : 'hanging'}
                  style={{ ...TXT, fill: caution ? T.fg1 : dir === 'down' ? T.fg3 : T.fg2, fontWeight: caution ? 500 : 400 }}
                >
                  {caution && <tspan style={{ fill: T.warn }}>⚠ </tspan>}
                  <SvgTicker value={v} format={fmtV} />
                </motion.text>
              )}
            </g>
          );
        })}
        <g aria-hidden>
          {xTicks.map((t) => (
            <text key={t.key} x={t.pos} y={L.top + height + 10} textAnchor="middle" dominantBaseline="hanging" style={{ ...TXT, fill: T.fg3 }}>
              {t.label}
            </text>
          ))}
        </g>
      </svg>
      <Tip items={items} keys={keys} sync={sync} xc={xc} width={width} top={L.top} />
      <span className="sr-only" aria-live="polite">
        {live}
      </span>
    </div>
  );
}

function Hover({ sync, keys, xc, band, top, bottom }: { sync: HoverSync<string>; keys: string[]; xc: (i: number) => number; band: number; top: number; bottom: number }) {
  const k = useHoverValue(sync);
  const i = k == null ? -1 : keys.indexOf(k);
  if (i < 0) return null;
  return <rect x={xc(i) - band / 2 + 1} y={top} width={Math.max(0, band - 2)} height={bottom - top} rx={4} style={{ fill: T.fg1, fillOpacity: 0.045 }} pointerEvents="none" />;
}

function Tip({ items, keys, sync, xc, width, top }: { items: WowItem[]; keys: string[]; sync: HoverSync<string>; xc: (i: number) => number; width: number; top: number }) {
  const k = useHoverValue(sync);
  const i = k == null ? -1 : keys.indexOf(k);
  const it = items[Math.max(0, i)];
  if (!it) return null;
  return (
    <ChartTooltip x={xc(Math.max(0, i))} y={top} containerWidth={width} visible={i >= 0} offset={16}>
      <TooltipBody title={it.label} rows={[{ label: 'Change', value: fmtPct(it.value), strong: true }, ...(it.detail ? [{ label: 'Done', value: it.detail, muted: true }] : [])]} />
    </ChartTooltip>
  );
}

export type { IsoWeek };
