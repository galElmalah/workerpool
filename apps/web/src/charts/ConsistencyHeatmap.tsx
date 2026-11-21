/**
 * ConsistencyHeatmap — GitHub-style year grid of daily load (design.md §6.2): 7 rows × N weeks,
 * accent at 5 quantile alphas, planned-missed = dashed outline, key sessions = dot, today = ring.
 * Streak callouts per product.md §6.1 row 5.
 */
import { useCallback, useId, useMemo } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import type { LocalDate } from '@cadence/core';
import { ChartFrame } from './core/ChartFrame';
import { T } from './core/tokens';
import { useChartSize } from './core/useChartSize';
import { useHoverSync, useHoverValue, type HoverSync } from './core/hover';
import { useChartPointer } from './core/useChartPointer';
import { ChartTooltip, TooltipBody } from './core/Tooltip';
import { DAY_MS, dateMs, fmtDayLong, fmtMonth, fmtNum, msDate } from './format';

export interface HeatDay {
  date: LocalDate;
  load: number;
  sessions?: number;
  key?: boolean;
  /** Planned but not done. */
  missed?: boolean;
}

export interface ConsistencyHeatmapProps {
  days: HeatDay[];
  today: LocalDate;
  /** Weeks shown (default 52; shrinks to fit narrow containers, min 12). */
  weeks?: number;
  onDayClick?: (date: LocalDate) => void;
  sync?: HoverSync<LocalDate>;
  showStreaks?: boolean;
  loading?: boolean;
  className?: string;
}

const ALPHAS = [T.a3, T.a4, T.a5, T.a6, T.accent];

/** Streaks: consecutive weeks with ≥ minSessions, and days since last full rest day. */
export function computeStreaks(days: HeatDay[], today: LocalDate, minSessions = 3) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const tMs = dateMs(today);
  const dow = (new Date(tMs).getUTCDay() + 6) % 7;
  let weeks = 0;
  for (let w = 0; w < 104; w++) {
    const mon = tMs - (dow + w * 7) * DAY_MS;
    let s = 0;
    for (let k = 0; k < 7; k++) s += byDate.get(msDate(mon + k * DAY_MS))?.sessions ?? ((byDate.get(msDate(mon + k * DAY_MS))?.load ?? 0) > 0 ? 1 : 0);
    if (w === 0 && s < minSessions) continue; // current week still in progress
    if (s >= minSessions) weeks++;
    else break;
  }
  let sinceRest = 0;
  for (let i = 0; i < 400; i++) {
    const d = byDate.get(msDate(tMs - i * DAY_MS));
    if (!d || d.load <= 0) break;
    sinceRest++;
  }
  let active = 0;
  for (let i = 0; i < 400; i++) {
    const d = byDate.get(msDate(tMs - i * DAY_MS));
    if (d && d.load > 0) active++;
    else if (i > 0) break;
  }
  return { weeksStreak: weeks, daysSinceRest: sinceRest, activeDays: active };
}

export function ConsistencyHeatmap(props: ConsistencyHeatmapProps) {
  const { days, today, loading, showStreaks = true, className } = props;
  const [ref, size] = useChartSize<HTMLDivElement>();
  const st = useMemo(() => computeStreaks(days, today), [days, today]);
  const trained = days.filter((d) => d.load > 0).length;
  return (
    <div className={`min-w-0 ${className ?? ''}`}>
      <ChartFrame summary={`Consistency: ${trained} training days in the period; ${st.weeksStreak} weeks in a row with 3 or more sessions; ${st.daysSinceRest} days since the last full rest.`} loading={loading} empty={!days.length} height={150}>
        <div ref={ref} className="w-full">
          {showStreaks && (
            <div className="mb-3 flex flex-wrap gap-x-8 gap-y-2">
              <Streak value={st.weeksStreak} unit="weeks" label="in a row with ≥ 3 sessions" accent />
              <Streak value={st.daysSinceRest} unit="days" label="since last full rest" />
              <Streak value={trained} unit="days" label="trained this period" />
            </div>
          )}
          {size.width > 0 && <HeatInner {...props} width={size.width} />}
        </div>
      </ChartFrame>
    </div>
  );
}

function Streak({ value, unit, label, accent }: { value: number; unit: string; label: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`num text-stat-sm ${accent ? 'text-accent-ink' : 'text-fg-1'}`}>{value}</span>
      <span className="text-label text-fg-2">{unit}</span>
      <span className="text-body-sm text-fg-3">{label}</span>
    </div>
  );
}

function HeatInner({ days, today, weeks: weeksWanted = 52, onDayClick, sync: ext, width }: ConsistencyHeatmapProps & { width: number }) {
  const id = useId();
  const reduce = useReducedMotion();
  const sync = useHoverSync<LocalDate>(ext);
  const labelW = 28;
  const gap = 3;
  const fit = Math.floor((width - labelW + gap) / (12 + gap));
  const weeks = Math.max(12, Math.min(weeksWanted, fit));
  const cell = Math.max(8, Math.min(14, Math.floor((width - labelW) / weeks) - gap));
  const step = cell + gap;
  const tMs = dateMs(today);
  const dow = (new Date(tMs).getUTCDay() + 6) % 7;
  const startMon = tMs - (dow + (weeks - 1) * 7) * DAY_MS;
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const thresholds = useMemo(() => {
    const v = days.map((d) => d.load).filter((x) => x > 0).sort((a, b) => a - b);
    return [0.2, 0.4, 0.6, 0.8].map((q) => v[Math.floor(q * (v.length - 1))] ?? 0);
  }, [days]);
  const bucket = (load: number) => thresholds.filter((t) => load > t).length;
  const top = 16;
  const cells: { date: LocalDate; w: number; d: number }[] = [];
  for (let w = 0; w < weeks; w++) for (let d = 0; d < 7; d++) {
    const ms = startMon + (w * 7 + d) * DAY_MS;
    if (ms > tMs) continue;
    cells.push({ date: msDate(ms), w, d });
  }
  const keys = useMemo(() => cells.map((c) => c.date), [cells.length, startMon]); // eslint-disable-line react-hooks/exhaustive-deps
  const months: { x: number; label: string }[] = [];
  let lastM = -1;
  for (let w = 0; w < weeks; w++) {
    const m = new Date(startMon + w * 7 * DAY_MS).getUTCMonth();
    if (m !== lastM) {
      if (w > 0 || weeks < 20) months.push({ x: labelW + w * step, label: fmtMonth(startMon + w * 7 * DAY_MS) });
      lastM = m;
    }
  }
  const keyAt = useCallback(
    (x: number, y: number) => {
      const w = Math.floor((x - labelW) / step);
      const d = Math.floor((y - top) / step);
      if (w < 0 || w >= weeks || d < 0 || d > 6) return null;
      const ms = startMon + (w * 7 + d) * DAY_MS;
      return ms > tMs ? null : msDate(ms);
    },
    [step, weeks, startMon, tMs],
  );
  const { handlers, live } = useChartPointer<LocalDate>({ keys, keyAt, sync, id, onActivate: onDayClick, initialKey: today, describe: (k) => `${fmtDayLong(k)}: load ${fmtNum(byDate.get(k)?.load ?? 0)}` });
  const H = top + 7 * step;
  return (
    <div className="relative">
      <svg width={labelW + weeks * step} height={H + 18} className="block select-none rounded-xs focus-visible:outline-offset-4" role="group" aria-roledescription="calendar heatmap" aria-label="Daily training load heatmap" tabIndex={0} {...handlers} style={{ cursor: onDayClick ? 'pointer' : 'default' }}>
        {months.map((m) => (
          <text key={m.x} x={m.x} y={10} style={{ fontFamily: T.mono, fontSize: 11, fill: T.fg3 }} aria-hidden>
            {m.label}
          </text>
        ))}
        {['Mon', 'Wed', 'Fri'].map((l, i) => (
          <text key={l} x={0} y={top + (i * 2) * step + cell / 2} dominantBaseline="central" style={{ fontFamily: T.mono, fontSize: 10, fill: T.fg3 }} aria-hidden>
            {l}
          </text>
        ))}
        {cells.map((c) => {
          const day = byDate.get(c.date);
          const load = day?.load ?? 0;
          const x = labelW + c.w * step;
          const y = top + c.d * step;
          const isToday = c.date === today;
          return (
            <motion.g key={c.date} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.24, delay: reduce ? 0 : Math.min(c.w * 0.008, 0.24) }}>
              <rect x={x} y={y} width={cell} height={cell} rx={Math.min(3, cell / 4)} style={{ fill: load > 0 ? ALPHAS[bucket(load)] : T.s2 }} />
              {day?.missed && load <= 0 && <rect x={x + 0.5} y={y + 0.5} width={cell - 1} height={cell - 1} rx={Math.min(3, cell / 4)} style={{ fill: 'none', stroke: T.line3, strokeDasharray: '2 1.5' }} />}
              {day?.key && <circle cx={x + cell / 2} cy={y + cell / 2} r={Math.max(1, cell / 9)} style={{ fill: load > 0 && bucket(load) >= 3 ? T.onAccent : T.fg1 }} />}
              {isToday && <rect x={x - 1.5} y={y - 1.5} width={cell + 3} height={cell + 3} rx={4} style={{ fill: 'none', stroke: T.fg1, strokeWidth: 1 }} />}
            </motion.g>
          );
        })}
        <HeatHover sync={sync} startMon={startMon} labelW={labelW} top={top} step={step} cell={cell} />
        {/* legend */}
        <g transform={`translate(${labelW + weeks * step - 5 * (cell + 2) - 64} ${H + 6})`} aria-hidden>
          <text x={0} y={cell / 2} dominantBaseline="central" style={{ fontFamily: T.mono, fontSize: 10, fill: T.fg3 }}>
            less
          </text>
          {[T.s2, ...ALPHAS].map((c, i) => (
            <rect key={i} x={30 + i * (cell * 0.8 + 2)} y={1} width={cell * 0.8} height={cell * 0.8} rx={2} style={{ fill: c }} />
          ))}
          <text x={30 + 6 * (cell * 0.8 + 2) + 2} y={cell / 2} dominantBaseline="central" style={{ fontFamily: T.mono, fontSize: 10, fill: T.fg3 }}>
            more
          </text>
        </g>
      </svg>
      <HeatTip sync={sync} byDate={byDate} startMon={startMon} labelW={labelW} top={top} step={step} width={labelW + weeks * step} />
      <span className="sr-only" aria-live="polite">
        {live}
      </span>
    </div>
  );
}

function pos(date: LocalDate, startMon: number, step: number) {
  const i = Math.round((dateMs(date) - startMon) / DAY_MS);
  return { w: Math.floor(i / 7), d: i % 7, x: Math.floor(i / 7) * step, y: (i % 7) * step };
}

function HeatHover({ sync, startMon, labelW, top, step, cell }: { sync: HoverSync<LocalDate>; startMon: number; labelW: number; top: number; step: number; cell: number }) {
  const k = useHoverValue(sync);
  if (!k) return null;
  const p = pos(k, startMon, step);
  if (p.w < 0) return null;
  return <rect x={labelW + p.x - 2} y={top + p.y - 2} width={cell + 4} height={cell + 4} rx={4} style={{ fill: 'none', stroke: T.fg2, strokeWidth: 1.5 }} pointerEvents="none" />;
}

function HeatTip({ sync, byDate, startMon, labelW, top, step, width }: { sync: HoverSync<LocalDate>; byDate: Map<LocalDate, HeatDay>; startMon: number; labelW: number; top: number; step: number; width: number }) {
  const k = useHoverValue(sync);
  const d = k ? byDate.get(k) : undefined;
  const p = k ? pos(k, startMon, step) : { x: 0, y: 0 };
  return (
    <ChartTooltip x={labelW + p.x + step / 2} y={Math.max(0, top + p.y - 60)} containerWidth={width} visible={!!k}>
      <TooltipBody
        title={k ? fmtDayLong(k) : ''}
        rows={[
          { label: 'Load', value: fmtNum(d?.load ?? 0), strong: true },
          { label: 'Sessions', value: String(d?.sessions ?? 0), muted: true },
          ...(d?.key ? [{ label: 'Key session', value: '★', muted: false }] : []),
          ...(d?.missed && !(d.load > 0) ? [{ label: 'Planned', value: 'missed', muted: true }] : []),
        ]}
      />
    </ChartTooltip>
  );
}
