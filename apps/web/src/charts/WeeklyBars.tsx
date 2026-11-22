/**
 * WeeklyBars — weekly volume (load / hours / distance) stacked by sport with the monochrome
 * sport ramp, planned ghosts, current-week remainder, 4-week rolling average, WoW deltas and
 * targets. product.md §6.1 row 3; design.md §6.2 "Weekly volume".
 */
import { useCallback, useId, useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { curveStep, line } from 'd3-shape';
import type { IsoWeek, WeekSummary } from '@cadence/core';
import { ChartDefs, SPORT_ORDER, SPORT_RAMP, sportKey, useChartDefs, type ChartDefIds, type SportKey } from './core/ChartDefs';
import { ChartFrame } from './core/ChartFrame';
import { AxisY, Grid, linearTicks, thinTicks, type Tick } from './core/Axis';
import { EndLabels } from './core/EndLabels';
import { ChartTooltip, TooltipBody, type TooltipRow } from './core/Tooltip';
import { ChartSegmented } from './core/controls';
import { MorphPath } from './core/animated';
import { T } from './core/tokens';
import { useChartSize } from './core/useChartSize';
import { useHoverSync, useHoverValue, type HoverSync } from './core/hover';
import { useChartPointer } from './core/useChartPointer';
import { deltaDir, fmtHM, fmtInt, fmtMonthDay, fmtNum, fmtPct } from './format';
import { spring, staggerDelay } from './motion';

export type WeeklyMetric = 'load' | 'hours' | 'distance';
export const WEEKLY_METRICS: { value: WeeklyMetric; label: string }[] = [
  { value: 'hours', label: 'Hours' },
  { value: 'load', label: 'Load' },
  { value: 'distance', label: 'Distance' },
];

export interface WeeklyBarsProps {
  weeks: WeekSummary[];
  metric?: WeeklyMetric;
  defaultMetric?: WeeklyMetric;
  onMetricChange?: (m: WeeklyMetric) => void;
  showMetricToggle?: boolean;
  /** 'sport' = grayscale ramp stack (default); 'total' = one solid accent bar per week. */
  stack?: 'sport' | 'total';
  showPlanned?: boolean;
  showRollingAvg?: boolean;
  showWow?: boolean;
  showTargets?: boolean;
  /** WoW above this (fraction) gets the accent caution outline (default 0.15). */
  cautionAbove?: number;
  height?: number;
  loading?: boolean;
  sync?: HoverSync<IsoWeek>;
  onWeekClick?: (isoWeek: IsoWeek) => void;
  className?: string;
}

interface Acc {
  done: (w: WeekSummary) => number;
  planned: (w: WeekSummary) => number;
  projected: (w: WeekSummary) => number;
  target: (w: WeekSummary) => number | undefined;
  sportDone: (s: WeekSummary['bySport'][number]) => number;
  sportPlanned: (s: WeekSummary['bySport'][number]) => number;
  wow: (w: WeekSummary) => number | null;
  fmt: (v: number) => string;
  unit: string;
  name: string;
}

export const WEEKLY_ACCESSORS: Record<WeeklyMetric, Acc> = {
  load: {
    done: (w) => w.doneLoad,
    planned: (w) => w.plannedLoad,
    projected: (w) => w.projectedLoad,
    target: (w) => w.targetLoad,
    sportDone: (s) => s.doneLoad,
    sportPlanned: (s) => s.plannedLoad,
    wow: (w) => w.wowLoad,
    fmt: (v) => fmtInt(v),
    unit: '',
    name: 'Load',
  },
  hours: {
    done: (w) => w.doneSec / 3600,
    planned: (w) => w.plannedSec / 3600,
    projected: (w) => w.projectedSec / 3600,
    target: (w) => w.targetHours,
    sportDone: (s) => s.doneSec / 3600,
    sportPlanned: (s) => s.plannedSec / 3600,
    wow: (w) => w.wowSec,
    fmt: (v) => fmtHM(v * 3600),
    unit: 'h',
    name: 'Hours',
  },
  distance: {
    done: (w) => w.doneDistanceM / 1000,
    planned: (w) => w.plannedDistanceM / 1000,
    projected: (w) => w.doneDistanceM / 1000 + Math.max(0, (w.plannedDistanceM - w.doneDistanceM) / 1000) * (w.isProjected ? 1 : 0),
    target: () => undefined,
    sportDone: (s) => s.doneDistanceM / 1000,
    sportPlanned: (s) => s.plannedDistanceM / 1000,
    wow: (w) => w.wowDistanceM,
    fmt: (v) => fmtInt(v),
    unit: 'km',
    name: 'Distance',
  },
};

export function WeeklyBars(props: WeeklyBarsProps) {
  const { weeks, loading, height = 240, className } = props;
  const [mState, setMState] = useState<WeeklyMetric>(props.defaultMetric ?? 'hours');
  const metric = props.metric ?? mState;
  const setMetric = (m: WeeklyMetric) => {
    setMState(m);
    props.onMetricChange?.(m);
  };
  const [ref, size] = useChartSize<HTMLDivElement>();
  const acc = WEEKLY_ACCESSORS[metric];
  const last = weeks[weeks.length - 1];
  const summary = !weeks.length
    ? 'Weekly volume: no data'
    : `Weekly ${acc.name.toLowerCase()} over ${weeks.length} weeks. This week ${acc.fmt(acc.done(last))}${acc.unit ? ' ' + acc.unit : ''} done of ${acc.fmt(acc.planned(last))} planned.`;
  const table = {
    caption: `Weekly ${acc.name.toLowerCase()} by week`,
    columns: ['Week', 'Done', 'Planned', 'Week over week', ...SPORT_ORDER.map((s) => SPORT_RAMP[s].label)],
    rows: weeks.map((w) => [w.isoWeek, acc.fmt(acc.done(w)), acc.fmt(acc.planned(w)), fmtPct(acc.wow(w)), ...SPORT_ORDER.map((sk) => acc.fmt(w.bySport.filter((s) => sportKey(s.sport) === sk).reduce((a, s) => a + acc.sportDone(s), 0)))]),
  };
  return (
    <div className={`min-w-0 ${className ?? ''}`}>
      <ChartFrame summary={summary} table={table} loading={loading} empty={!weeks.length} height={height + 64} emptyHint="Weekly totals appear once you complete or plan workouts.">
        <div ref={ref} className="w-full">
          {size.width > 0 && <WeeklyInner {...props} width={size.width} metric={metric} setMetric={setMetric} height={height} />}
        </div>
      </ChartFrame>
    </div>
  );
}

function WeeklyInner({
  weeks,
  width,
  metric,
  setMetric,
  height,
  showMetricToggle = true,
  stack = 'sport',
  showPlanned = true,
  showRollingAvg = true,
  showWow = true,
  showTargets = true,
  cautionAbove = 0.15,
  sync: extSync,
  onWeekClick,
}: WeeklyBarsProps & { width: number; metric: WeeklyMetric; setMetric: (m: WeeklyMetric) => void; height: number }) {
  const defs = useChartDefs();
  const id = useId();
  const reduce = useReducedMotion();
  const sync = useHoverSync<IsoWeek>(extSync);
  const acc = WEEKLY_ACCESSORS[metric];
  const [focusSport, setFocusSport] = useState<SportKey | null>(null);
  const compact = width < 480;
  const n = weeks.length;
  const L = { left: 36, right: compact ? 8 : 92, top: showWow ? 40 : 14, bottom: 22 };
  const plotW = Math.max(10, width - L.left - L.right);
  const plotB = L.top + height;
  const band = plotW / n;
  const barW = Math.max(3, Math.min(30, band * 0.62));
  const xc = (i: number) => L.left + band * (i + 0.5);

  const sportsPresent = useMemo(() => {
    const set = new Set<SportKey>();
    weeks.forEach((w) => w.bySport.forEach((s) => (s.doneSec > 0 || s.plannedSec > 0) && set.add(sportKey(s.sport))));
    return SPORT_ORDER.filter((s) => set.has(s));
  }, [weeks]);

  const rolling = useMemo(() => {
    return weeks.map((w, i) => {
      if (w.isProjected) return null;
      const win = weeks.slice(Math.max(0, i - 3), i + 1).filter((x) => !x.isProjected);
      return win.length < 2 ? null : win.reduce((a, x) => a + acc.done(x), 0) / win.length;
    });
  }, [weeks, acc]);

  const yMax = useMemo(() => {
    let m = 0.0001;
    for (const w of weeks) m = Math.max(m, acc.done(w), showPlanned ? acc.planned(w) : 0, acc.projected(w), (showTargets && acc.target(w)) || 0);
    return m * 1.08;
  }, [weeks, acc, showPlanned, showTargets]);
  const y = (v: number) => plotB - (v / yMax) * height;
  const yTicks: Tick[] = linearTicks([0, yMax], [plotB, L.top], 4, (v) => (metric === 'hours' ? `${fmtNum(v)}h` : fmtNum(v)));

  const keys = useMemo(() => weeks.map((w) => w.isoWeek), [weeks]);
  const keyAt = useCallback((x: number) => {
    const i = Math.floor((x - L.left) / band);
    return i >= 0 && i < n ? keys[i] : null;
  }, [L.left, band, n, keys]);
  const describe = useCallback(
    (k: IsoWeek) => {
      const w = weeks[keys.indexOf(k)];
      return `${k}: ${acc.fmt(acc.done(w))} done of ${acc.fmt(acc.planned(w))} planned, ${fmtPct(acc.wow(w))} week over week`;
    },
    [weeks, keys, acc],
  );
  const { handlers, live } = useChartPointer<IsoWeek>({ keys, keyAt, sync, id, onActivate: onWeekClick, describe, bigStep: 4 });

  // x labels: week start dates, thinned
  const xTicks = thinTicks(
    weeks.map((w, i) => ({ key: w.isoWeek, pos: xc(i), label: w.isProjected && i === n - 1 ? 'NOW' : fmtMonthDay(w.startDate), strong: w.isProjected && i === n - 1 })),
    8,
  );
  // WoW labels: as many of the most recent weeks as fit
  const wowEvery = Math.max(1, Math.ceil(46 / band));

  const avgPath = useMemo(() => {
    const g = line<number>()
      .defined((i) => rolling[i] != null)
      .x((i) => xc(i))
      .y((i) => y(rolling[i]!))
      .curve(curveStep);
    return g(weeks.map((_, i) => i)) ?? '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rolling, width, yMax, height]);
  const lastAvgIdx = rolling.reduce<number>((a, v, i) => (v != null ? i : a), -1);

  return (
    <div className="relative">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {stack === 'sport' ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1" role="list" aria-label="Sports">
            {sportsPresent.map((s) => (
              <button
                key={s}
                type="button"
                role="listitem"
                onPointerEnter={() => setFocusSport(s)}
                onPointerLeave={() => setFocusSport(null)}
                onFocus={() => setFocusSport(s)}
                onBlur={() => setFocusSport(null)}
                className="inline-flex items-center gap-1.5 rounded-xs text-micro text-fg-3 hover:text-fg-1"
              >
                <SportSwatch s={s} defs={defs} active={focusSport === s} />
                {SPORT_RAMP[s].label}
              </button>
            ))}
            {showTargets && weeks.some((w) => acc.target(w)) && (
              <span className="inline-flex items-center gap-1.5 text-micro text-fg-3">
                <svg width="14" height="8" aria-hidden>
                  <line x1="0" x2="9" y1="4" y2="4" style={{ stroke: T.fg2 }} />
                  <path d="M9 4l4 -3v6z" style={{ fill: T.fg2 }} />
                </svg>
                Target
              </span>
            )}
            {showPlanned && (
              <span className="inline-flex items-center gap-1.5 text-micro text-fg-3">
                <svg width="12" height="10" aria-hidden>
                  <rect x="0.5" y="0.5" width="11" height="9" rx="1.5" style={{ fill: 'none', stroke: T.fg3, strokeDasharray: '2 2' }} />
                </svg>
                Planned
              </span>
            )}
          </div>
        ) : (
          <span />
        )}
        {showMetricToggle && <ChartSegmented ariaLabel="Metric" value={metric} options={WEEKLY_METRICS} onChange={setMetric} />}
      </div>
      <svg
        width={width}
        height={plotB + L.bottom}
        className="block touch-pan-y select-none overflow-visible rounded-xs focus-visible:outline-offset-4"
        role="group"
        aria-roledescription="chart"
        aria-label={`Weekly ${acc.name.toLowerCase()}. Arrow keys move between weeks, Enter opens the week.`}
        tabIndex={0}
        {...handlers}
        style={{ cursor: onWeekClick ? 'pointer' : 'default' }}
      >
        <ChartDefs ids={defs} />
        <Grid ys={yTicks.map((t) => ({ key: t.key, pos: t.pos }))} x0={L.left} x1={L.left + plotW} zero={plotB} />
        <AxisY ticks={yTicks.filter((t) => t.pos < plotB - 2)} x={L.left - 8} />
        <HoverColumn sync={sync} keys={keys} xc={xc} band={band} top={showWow ? 2 : L.top - 8} bottom={plotB} />
        {showWow && (
          <text x={L.left - 8} y={14} textAnchor="end" dominantBaseline="central" style={{ fontFamily: T.sans, fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', fill: T.fg3 }} aria-hidden>
            WOW
          </text>
        )}
        {weeks.map((w, i) => {
          const x = xc(i) - barW / 2;
          const delay = reduce ? 0 : staggerDelay(i);
          const done = acc.done(w);
          const planned = acc.planned(w);
          const projected = acc.projected(w);
          const target = acc.target(w);
          const segs: { key: string; v0: number; v1: number; s: SportKey }[] = [];
          if (stack === 'sport') {
            let base = 0;
            for (const sk of SPORT_ORDER) {
              const v = w.bySport.filter((s) => sportKey(s.sport) === sk).reduce((a, s) => a + acc.sportDone(s), 0);
              if (v <= 0) continue;
              segs.push({ key: sk, v0: base, v1: base + v, s: sk });
              base += v;
            }
          }
          const remaining = w.isProjected ? Math.max(0, projected - done) : 0;
          return (
            <g key={w.isoWeek}>
              {showPlanned && planned > 0 && (
                <motion.rect
                  x={x - 2.5}
                  width={barW + 5}
                  rx={3}
                  initial={{ y: plotB, height: 0 }}
                  animate={{ y: y(planned) - 0.5, height: Math.max(0, plotB - y(planned)) }}
                  transition={{ ...spring.gentle, delay }}
                  style={{ fill: 'none', stroke: T.line3, strokeDasharray: '3 2' }}
                />
              )}
              {stack === 'total' ? (
                <motion.rect x={x} width={barW} rx={2} initial={{ y: plotB, height: 0 }} animate={{ y: y(done), height: plotB - y(done) }} transition={{ ...spring.gentle, delay }} style={{ fill: T.accent }} />
              ) : (
                segs.map((sg, k) => {
                  const gap = k === 0 ? 0 : 1.5;
                  const y0 = y(sg.v0) - gap;
                  const y1 = y(sg.v1);
                  const r = SPORT_RAMP[sg.s];
                  const dim = focusSport != null && focusSport !== sg.s;
                  const hi = focusSport === sg.s;
                  return (
                    <g key={sg.key} style={{ opacity: dim ? 0.4 : 1, transition: 'opacity var(--dur-fast) var(--ease-out)' }}>
                      <motion.rect
                        x={x}
                        width={barW}
                        rx={1.5}
                        initial={{ y: plotB, height: 0 }}
                        animate={{ y: y1, height: Math.max(0, y0 - y1) }}
                        transition={{ ...spring.gentle, delay }}
                        style={{ fill: hi ? T.accent : r.fill }}
                      />
                      {r.pattern && !hi && (
                        <motion.rect
                          x={x}
                          width={barW}
                          rx={1.5}
                          initial={{ y: plotB, height: 0 }}
                          animate={{ y: y1, height: Math.max(0, y0 - y1) }}
                          transition={{ ...spring.gentle, delay }}
                          style={{ fill: r.pattern === 'hatch' ? defs.hatchFgDense : defs.dotsFg }}
                        />
                      )}
                    </g>
                  );
                })
              )}
              {remaining > 0 && (
                <motion.rect
                  x={x}
                  width={barW}
                  rx={1.5}
                  initial={{ y: y(done), height: 0, opacity: 0 }}
                  animate={{ y: y(projected), height: Math.max(0, y(done) - y(projected) - 1.5), opacity: 1 }}
                  transition={{ ...spring.gentle, delay: delay + 0.12 }}
                  style={{ fill: defs.hatchFg, stroke: T.fg3, strokeDasharray: '3 2' }}
                />
              )}
              {showTargets && target != null && target > 0 && (
                <motion.g initial={false} animate={{ y: y(target) }} transition={spring.smooth} aria-hidden>
                  <line x1={x - 4} x2={x + barW + 4} y1={0} y2={0} style={{ stroke: T.fg2, strokeWidth: 1 }} />
                  <path d={`M${x + barW + 4} 0l4 -3v6z`} style={{ fill: T.fg2 }} />
                </motion.g>
              )}
              {showWow && (n - 1 - i) % wowEvery === 0 && i > 0 && <WowLabel x={xc(i)} y={14} value={acc.wow(w)} caution={(acc.wow(w) ?? 0) > cautionAbove && metric !== 'distance'} />}
            </g>
          );
        })}
        {showRollingAvg && avgPath && (
          <>
            <MorphPath d={avgPath} transition={spring.smooth} fill="none" strokeLinejoin="round" style={{ stroke: T.bg, strokeWidth: 4, opacity: 0.85 }} />
            <MorphPath d={avgPath} transition={spring.smooth} fill="none" strokeLinejoin="round" style={{ stroke: T.fg1, strokeWidth: 1.5 }} />
          </>
        )}
        {showRollingAvg && lastAvgIdx >= 0 && !compact && (
          <EndLabels labels={[{ id: 'avg', y: y(rolling[lastAvgIdx]!), value: acc.fmt(rolling[lastAvgIdx]!), name: '4-wk avg', tone: 'fg1' }]} x={L.left + plotW + 6} top={L.top} bottom={plotB} />
        )}
        <g aria-hidden>
          {xTicks.map((t) => (
            <text key={t.key} x={t.pos} y={plotB + 8} textAnchor="middle" dominantBaseline="hanging" style={{ fontFamily: t.strong ? T.sans : T.mono, fontSize: t.strong ? 10 : 11, fontWeight: t.strong ? 600 : 400, letterSpacing: t.strong ? '0.06em' : undefined, fill: t.strong ? T.accentInk : T.fg3 }}>
              {t.label}
            </text>
          ))}
        </g>
      </svg>
      <WeekTooltip weeks={weeks} keys={keys} sync={sync} acc={acc} xc={xc} width={width} top={L.top} defs={defs} />
      <span className="sr-only" aria-live="polite">
        {live}
      </span>
    </div>
  );
}

function SportSwatch({ s, defs, active }: { s: SportKey; defs: ChartDefIds; active?: boolean }) {
  const r = SPORT_RAMP[s];
  return (
    <svg width="10" height="10" aria-hidden className="shrink-0">
      <rect width="10" height="10" rx="2" style={{ fill: active ? T.accent : r.fill }} />
      {r.pattern && !active && <rect width="10" height="10" rx="2" style={{ fill: r.pattern === 'hatch' ? defs.hatchFgDense : defs.dotsFg }} />}
    </svg>
  );
}

function WowLabel({ x, y, value, caution }: { x: number; y: number; value: number | null; caution: boolean }) {
  if (value == null) return null;
  const dir = deltaDir(value);
  const text = dir === 'flat' ? '±0%' : fmtPct(value);
  const w = text.length * 6.2 + 14;
  const rot = dir === 'up' ? -45 : dir === 'down' ? 45 : 0;
  return (
    <motion.g initial={{ opacity: 0, y: y + 4 }} animate={{ opacity: 1, y }} transition={spring.smooth} aria-hidden>
      {caution && <rect x={x - w / 2 - 3} y={-8} width={w + 6} height={15} rx={4} style={{ fill: 'none', stroke: T.accent, strokeWidth: 1 }} />}
      <g transform={`translate(${x - w / 2 + 4} -0.5) rotate(${rot})`} style={{ stroke: dir === 'up' ? T.fg1 : T.fg3 }} strokeWidth={1.3} fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M-3.5 0h7M1.5 -2.5l2.5 2.5-2.5 2.5" />
      </g>
      <text x={x - w / 2 + 11} y={0} dominantBaseline="central" style={{ fontFamily: T.mono, fontSize: 10.5, fill: dir === 'up' ? T.fg1 : dir === 'down' ? T.fg2 : T.fg3, fontWeight: dir === 'up' ? 600 : 400 }}>
        {text}
      </text>
    </motion.g>
  );
}

function HoverColumn({ sync, keys, xc, band, top, bottom }: { sync: HoverSync<IsoWeek>; keys: IsoWeek[]; xc: (i: number) => number; band: number; top: number; bottom: number }) {
  const k = useHoverValue(sync);
  const i = k == null ? -1 : keys.indexOf(k);
  return (
    <motion.rect
      initial={false}
      animate={{ x: i < 0 ? 0 : xc(i) - band / 2 + 1, opacity: i < 0 ? 0 : 1 }}
      transition={{ x: spring.snappy, opacity: { duration: 0.14 } }}
      y={top}
      width={Math.max(0, band - 2)}
      height={bottom - top}
      rx={4}
      style={{ fill: T.fg1, fillOpacity: 0.045 }}
      pointerEvents="none"
    />
  );
}

function WeekTooltip({ weeks, keys, sync, acc, xc, width, top, defs }: { weeks: WeekSummary[]; keys: IsoWeek[]; sync: HoverSync<IsoWeek>; acc: Acc; xc: (i: number) => number; width: number; top: number; defs: ChartDefIds }) {
  const k = useHoverValue(sync);
  const i = k == null ? -1 : keys.indexOf(k);
  const w = weeks[Math.max(0, i)];
  if (!w) return null;
  const u = acc.unit ? ` ${acc.unit}` : '';
  const rows: TooltipRow[] = SPORT_ORDER.flatMap((sk) => {
    const ss = w.bySport.filter((s) => sportKey(s.sport) === sk);
    const d = ss.reduce((a, s) => a + acc.sportDone(s), 0);
    const p = ss.reduce((a, s) => a + acc.sportPlanned(s), 0);
    if (d <= 0 && p <= 0) return [];
    const r = SPORT_RAMP[sk];
    return [{ label: r.label.charAt(0) + r.label.slice(1).toLowerCase(), value: `${acc.fmt(d)} / ${acc.fmt(p)}${u}`, swatch: { tone: 'fg1' as const, kind: 'bar' as const, fill: r.fill, pattern: r.pattern === 'hatch' ? defs.hatchFgDense : r.pattern === 'dots' ? defs.dotsFg : undefined } }];
  });
  rows.push({ label: 'Total', value: `${acc.fmt(acc.done(w))} / ${acc.fmt(acc.planned(w))}${u}`, strong: true });
  if (w.isProjected) rows.push({ label: 'Landing at', value: `${acc.fmt(acc.projected(w))}${u}`, muted: true });
  const t = acc.target(w);
  if (t) rows.push({ label: 'Target', value: `${acc.fmt(t)}${u}`, muted: true });
  rows.push({ label: 'vs last week', value: fmtPct(acc.wow(w)), muted: deltaDir(acc.wow(w)) !== 'up' });
  return (
    <ChartTooltip x={xc(Math.max(0, i))} y={top} containerWidth={width} visible={i >= 0} offset={20}>
      <TooltipBody
        title={
          <span className="flex items-center gap-2">
            {w.isoWeek.slice(5)} · {fmtMonthDay(w.startDate)}
            {w.isProjected && <span className="text-micro text-accent-ink">so far</span>}
          </span>
        }
        rows={rows}
        footer={<span className="text-fg-3">done / planned</span>}
      />
    </ChartTooltip>
  );
}
