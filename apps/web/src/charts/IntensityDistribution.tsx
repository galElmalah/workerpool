/**
 * IntensityDistribution — per-week 100 % stacked easy / moderate / hard in zone colours (easy z2,
 * moderate z3, hard z5 — the zones of endurance, tempo and high; 2px surface gaps), with
 * a quiet target reference, a classification label and direct labels at the right end (no
 * legend); ZoneBars — horizontal time-in-zone rows. product.md §6.1 row 4, §5.1 item 8.
 */
import { useCallback, useId, useMemo } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import type { WeekSummary, ZoneTime } from '@cadence/core';
import { ChartDefs, useChartDefs } from './core/ChartDefs';
import { ChartFrame } from './core/ChartFrame';
import { T, TXT } from './core/tokens';
import { avoidCollisions } from './core/EndLabels';
import { thinTicks } from './core/Axis';
import { useChartSize } from './core/useChartSize';
import { useHoverSync, useHoverValue, type HoverSync } from './core/hover';
import { useChartPointer } from './core/useChartPointer';
import { ChartTooltip, TooltipBody } from './core/Tooltip';
import { fmtHMS, fmtHM, fmtMonthDay } from './format';
import { spring, staggerDelay } from './motion';

export interface IntensitySplit {
  key: string;
  label: string;
  /** Seconds (or any unit — only the proportions matter). */
  easy: number;
  moderate: number;
  hard: number;
}

export type IntensityClassLabel = 'Polarized' | 'Pyramidal' | 'Threshold' | 'HIIT' | 'Base' | 'Mixed';

/** Classify an easy/moderate/hard split (shares). */
export function classifyIntensity(s: { easy: number; moderate: number; hard: number }): IntensityClassLabel {
  const t = s.easy + s.moderate + s.hard || 1;
  const e = s.easy / t;
  const m = s.moderate / t;
  const h = s.hard / t;
  if (h >= 0.3) return 'HIIT';
  if (m >= 0.25 && m > h) return 'Threshold';
  if (e >= 0.9) return 'Base';
  if (e >= 0.7 && h > m) return 'Polarized';
  if (e >= 0.6 && m >= h) return 'Pyramidal';
  return 'Mixed';
}

export const weeksToSplits = (weeks: WeekSummary[]): IntensitySplit[] => weeks.map((w) => ({ key: w.isoWeek, label: fmtMonthDay(w.startDate), ...w.intensitySec }));

const BUCKETS = [
  { k: 'easy' as const, label: 'Easy', zone: 2 },
  { k: 'moderate' as const, label: 'Moderate', zone: 3 },
  { k: 'hard' as const, label: 'Hard', zone: 5 },
];

export interface IntensityDistributionProps {
  items: IntensitySplit[];
  /** Target shares (default 80 / 5 / 15). */
  target?: { easy: number; moderate: number; hard: number } | null;
  height?: number;
  loading?: boolean;
  sync?: HoverSync<string>;
  onItemClick?: (key: string) => void;
  className?: string;
}

export function IntensityDistribution(props: IntensityDistributionProps) {
  const { items, loading, height = 160, className } = props;
  const [ref, size] = useChartSize<HTMLDivElement>();
  const total = useMemo(() => items.reduce((a, i) => ({ easy: a.easy + i.easy, moderate: a.moderate + i.moderate, hard: a.hard + i.hard }), { easy: 0, moderate: 0, hard: 0 }), [items]);
  const t = total.easy + total.moderate + total.hard;
  const pct = (v: number) => Math.round((v / (t || 1)) * 100);
  const cls = classifyIntensity(total);
  return (
    <div className={`min-w-0 ${className ?? ''}`}>
      <ChartFrame
        summary={`Intensity distribution: ${cls}, ${pct(total.easy)}% easy, ${pct(total.moderate)}% moderate, ${pct(total.hard)}% hard over ${items.length} weeks.`}
        loading={loading}
        empty={!t}
        height={height + 56}
        table={{ caption: 'Intensity split per week', columns: ['Week', 'Easy %', 'Moderate %', 'Hard %', 'Type'], rows: items.map((i) => { const s = i.easy + i.moderate + i.hard || 1; return [i.label, Math.round((i.easy / s) * 100), Math.round((i.moderate / s) * 100), Math.round((i.hard / s) * 100), classifyIntensity(i)]; }) }}
      >
        <div ref={ref} className="w-full">
          <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-title-3 text-fg-1">{cls}</span>
            <span className="num text-body-sm text-fg-2">
              {pct(total.easy)} / {pct(total.moderate)} / {pct(total.hard)} %
            </span>
            {props.target !== null && (
              <span className="num text-body-sm text-fg-3">
                target {Math.round((props.target ?? DEFAULT_TARGET).easy * 100)} / {Math.round((props.target ?? DEFAULT_TARGET).moderate * 100)} / {Math.round((props.target ?? DEFAULT_TARGET).hard * 100)}
              </span>
            )}
          </div>
          {size.width > 0 && <IDInner {...props} width={size.width} height={height} />}
        </div>
      </ChartFrame>
    </div>
  );
}

const DEFAULT_TARGET = { easy: 0.8, moderate: 0.05, hard: 0.15 };

function IDInner({ items, width, height, target = DEFAULT_TARGET, sync: ext, onItemClick }: IntensityDistributionProps & { width: number; height: number }) {
  const defs = useChartDefs();
  const id = useId();
  const reduce = useReducedMotion();
  const sync = useHoverSync<string>(ext);
  const n = items.length;
  const compact = width < 420;
  const L = { left: 40, right: compact ? 8 : 76, top: 4, bottom: 28 };
  const plotW = Math.max(10, width - L.left - L.right);
  const band = plotW / n;
  const barW = Math.max(3, Math.min(24, band * 0.56));
  const y = (f: number) => L.top + (1 - f) * height;
  const xc = (i: number) => L.left + band * (i + 0.5);
  const keys = useMemo(() => items.map((i) => i.key), [items]);
  const keyAt = useCallback((x: number) => {
    const i = Math.floor((x - L.left) / band);
    return i >= 0 && i < n ? keys[i] : null;
  }, [L.left, band, n, keys]);
  const { handlers } = useChartPointer<string>({ keys, keyAt, sync, id, onActivate: onItemClick, bigStep: 4 });
  const xTicks = thinTicks(items.map((it, i) => ({ key: it.key, pos: -xc(i), label: it.label })).reverse()).map((t) => ({ ...t, pos: -t.pos }));
  // Direct labels for the three buckets at the right end of the last bar.
  const lastIt = [...items].reverse().find((it) => it.easy + it.moderate + it.hard > 0);
  const direct = (() => {
    if (!lastIt || compact) return [];
    const sum = lastIt.easy + lastIt.moderate + lastIt.hard;
    let acc = 0;
    const raw = BUCKETS.map((b) => {
      const f = lastIt[b.k] / sum;
      const mid = y(acc + f / 2);
      acc += f;
      return { id: b.k, y: mid, label: b.label, zone: b.zone };
    });
    return avoidCollisions(raw, 16, L.top + 6, L.top + height - 6);
  })();
  return (
    <div className="relative">
      <svg width={width} height={L.top + height + L.bottom} className="block touch-pan-y select-none overflow-visible rounded-xs focus-visible:outline-offset-4" role="group" aria-roledescription="chart" aria-label="Intensity distribution per week" tabIndex={0} {...handlers}>
        <ChartDefs ids={defs} />
        {[0, 0.5, 1].map((f) => (
          <g key={f} aria-hidden>
            <text x={L.left - 10} y={y(f)} textAnchor="end" dominantBaseline="central" style={{ ...TXT, fill: T.fg3 }}>
              {Math.round(f * 100)}%
            </text>
          </g>
        ))}
        {items.map((it, i) => {
          const s = it.easy + it.moderate + it.hard;
          if (!s) return null;
          let base = 0;
          const delay = reduce ? 0 : staggerDelay(i);
          return (
            <g key={it.key}>
              {BUCKETS.map((b, k) => {
                const f = it[b.k] / s;
                const y1 = y(base + f);
                const y0 = y(base) - (k ? 2 : 0);
                base += f;
                return (
                  <g key={b.k}>
                    <motion.rect x={xc(i) - barW / 2} width={barW} rx={k === 2 ? Math.min(3, barW / 2) : 1} initial={{ y: y(0), height: 0 }} animate={{ y: y1, height: Math.max(0, y0 - y1) }} transition={{ ...spring.gentle, delay: delay + k * 0.04 }} style={{ fill: T.zone(b.zone) }} />
                  </g>
                );
              })}
            </g>
          );
        })}
        {target && (
          <g aria-hidden pointerEvents="none">
            {[target.easy, target.easy + target.moderate].map((f, k) => (
              <line key={k} x1={L.left} x2={L.left + plotW} y1={y(f)} y2={y(f)} strokeLinecap="round" style={{ stroke: T.fg1, strokeDasharray: '1 3', opacity: 0.55 }} />
            ))}
          </g>
        )}
        <g aria-hidden>
          {xTicks.map((t) => (
            <text key={t.key} x={t.pos} y={L.top + height + 10} textAnchor="middle" dominantBaseline="hanging" style={{ ...TXT, fill: T.fg3 }}>
              {t.label}
            </text>
          ))}
          {direct.map((d) => (
            <g key={d.id} transform={`translate(${L.left + plotW + 10} ${d.ly})`}>
              <rect x={0} y={-4} width={8} height={8} rx={2} style={{ fill: T.zone(d.zone) }} />
              <text x={14} y={0} dominantBaseline="central" style={{ ...TXT, fill: T.fg3 }}>
                {d.label}
              </text>
            </g>
          ))}
        </g>
        <HoverCol sync={sync} keys={keys} xc={xc} band={band} top={L.top} bottom={L.top + height} />
      </svg>
      <Tip items={items} keys={keys} sync={sync} xc={xc} width={width} />
    </div>
  );
}

function HoverCol({ sync, keys, xc, band, top, bottom }: { sync: HoverSync<string>; keys: string[]; xc: (i: number) => number; band: number; top: number; bottom: number }) {
  const k = useHoverValue(sync);
  const i = k == null ? -1 : keys.indexOf(k);
  if (i < 0) return null;
  return <rect x={xc(i) - band / 2 + 1} y={top - 2} width={Math.max(0, band - 2)} height={bottom - top + 4} rx={4} style={{ fill: T.fg1, fillOpacity: 0.05 }} pointerEvents="none" />;
}

function Tip({ items, keys, sync, xc, width }: { items: IntensitySplit[]; keys: string[]; sync: HoverSync<string>; xc: (i: number) => number; width: number }) {
  const k = useHoverValue(sync);
  const i = k == null ? -1 : keys.indexOf(k);
  const it = items[Math.max(0, i)];
  if (!it) return null;
  const s = it.easy + it.moderate + it.hard || 1;
  return (
    <ChartTooltip x={xc(Math.max(0, i))} y={0} containerWidth={width} visible={i >= 0} offset={18}>
      <TooltipBody
        title={`${it.label} · ${classifyIntensity(it)}`}
        rows={BUCKETS.map((b) => ({ label: b.label, value: `${Math.round((it[b.k] / s) * 100)}%`, hint: fmtHM(it[b.k]), swatch: { tone: 'accent' as const, kind: 'bar' as const, fill: T.zone(b.zone) } }))}
      />
    </ChartTooltip>
  );
}

// ───────────────────────────── ZoneBars ─────────────────────────────

/**
 * Map zone i (1-based) of an N-zone model onto the z1..z7 colours (DESIGN_V2 §8.2). Zone colours
 * are familiar, not a lightness ramp, so Z1..Z7 keep their own colour in any model up to 7 zones;
 * a 3-zone model reads as easy z2 · moderate z3 · hard z5.
 */
export function zoneFill(i: number, count: number): number {
  if (count === 3) return [2, 3, 5][i - 1] ?? 5;
  if (count <= 7) return Math.max(1, Math.min(7, i));
  return Math.round(1 + ((i - 1) * 6) / Math.max(1, count - 1));
}

export interface ZoneBarsProps {
  zones: ZoneTime[];
  /** Planned share per zone (0..1), drawn as a 1px fg-1 tick on each track. */
  targetPct?: (number | null)[];
  /** Formats a zone's [low, high] range (native units). */
  formatRange?: (low: number | null, high: number | null) => string;
  unit?: string;
  loading?: boolean;
  compact?: boolean;
  className?: string;
}

export function ZoneBars({ zones, targetPct, formatRange, unit = '', loading, compact, className }: ZoneBarsProps) {
  const reduce = useReducedMotion();
  const total = zones.reduce((a, z) => a + z.seconds, 0);
  const max = Math.max(1, ...zones.map((z) => z.seconds / (total || 1)), ...(targetPct ?? []).map((v) => v ?? 0));
  const range = formatRange ?? ((lo: number | null, hi: number | null) => (hi == null ? `${lo ?? 0}+` : `${lo ?? 0}–${hi}`) + (unit ? ` ${unit}` : ''));
  const rowH = compact ? 'h-6' : 'h-9';
  return (
    <div className={`min-w-0 ${className ?? ''}`}>
      <ChartFrame
        summary={`Time in zone: ${zones.map((z) => `Z${z.zone} ${Math.round((z.seconds / (total || 1)) * 100)}%`).join(', ')}`}
        loading={loading}
        empty={!total}
        height={zones.length * (compact ? 24 : 32) || 160}
        table={{ caption: 'Time in zone', columns: ['Zone', 'Name', 'Time', 'Share'], rows: zones.map((z) => [`Z${z.zone}`, z.name, fmtHMS(z.seconds), `${Math.round((z.seconds / (total || 1)) * 100)}%`]) }}
      >
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4" role="list">
          {zones.map((z, i) => {
            const f = z.seconds / (total || 1);
            const fill = zoneFill(z.zone, zones.length);
            const tgt = targetPct?.[i];
            return (
              <div key={z.zone} role="listitem" className={`contents`}>
                <div className={`flex ${rowH} items-center gap-3`}>
                  <span className="w-6 text-label text-fg-3">Z{z.zone}</span>
                  {!compact && <span className="hidden w-24 truncate text-body-sm text-fg-2 sm:inline">{z.name}</span>}
                  {!compact && <span className="num hidden w-24 text-label text-fg-3 md:inline">{range(z.low, z.high)}</span>}
                </div>
                <div className={`relative ${compact ? 'h-1.5' : 'h-2'} rounded-full bg-surface-2`} title={range(z.low, z.high)}>
                  <motion.div
                    className="absolute inset-y-0 left-0 origin-left rounded-full"
                    style={{ width: `${(f / max) * 100}%`, background: T.zone(fill) }}
                    initial={reduce ? { opacity: 0 } : { scaleX: 0 }}
                    animate={reduce ? { opacity: 1 } : { scaleX: 1 }}
                    transition={reduce ? { duration: 0.12 } : { ...spring.smooth, delay: Math.min(i * 0.02, 0.24) }}
                  />
                  {tgt != null && <span className="absolute -inset-y-1 w-px rounded-full bg-fg-3" style={{ left: `${(tgt / max) * 100}%` }} aria-hidden />}
                </div>
                <div className={`num flex ${rowH} items-center justify-end gap-3 text-body-sm`}>
                  <span className="text-fg-1">{fmtHMS(z.seconds)}</span>
                  <span className="w-9 text-right text-fg-3">{Math.round(f * 100)}%</span>
                </div>
              </div>
            );
          })}
        </div>
      </ChartFrame>
    </div>
  );
}
