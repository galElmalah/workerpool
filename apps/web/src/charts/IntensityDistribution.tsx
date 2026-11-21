/**
 * IntensityDistribution — per-week 100 % stacked easy / moderate / hard (fill density) with a
 * target reference and a classification label; ZoneBars — horizontal time-in-zone rows.
 * product.md §6.1 row 4, §5.1 item 8; design.md §6.2 "Time in zone".
 */
import { useCallback, useId, useMemo } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import type { WeekSummary, ZoneTime } from '@cadence/core';
import { ChartDefs, useChartDefs } from './core/ChartDefs';
import { ChartFrame } from './core/ChartFrame';
import { T } from './core/tokens';
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
  { k: 'moderate' as const, label: 'Moderate', zone: 4 },
  { k: 'hard' as const, label: 'Hard', zone: 7 },
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
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <span className="text-title-3 text-fg-1">{cls}</span>
              <span className="font-mono text-mono text-fg-2">
                {pct(total.easy)} / {pct(total.moderate)} / {pct(total.hard)} %
              </span>
            </div>
            <div className="flex items-center gap-3">
              {BUCKETS.map((b) => (
                <span key={b.k} className="inline-flex items-center gap-1.5 text-micro uppercase text-fg-3">
                  <span className="size-2.5 rounded-xs" style={{ background: T.zone(b.zone) }} />
                  {b.label}
                </span>
              ))}
            </div>
          </div>
          {size.width > 0 && <IDInner {...props} width={size.width} height={height} />}
        </div>
      </ChartFrame>
    </div>
  );
}

function IDInner({ items, width, height, target = { easy: 0.8, moderate: 0.05, hard: 0.15 }, sync: ext, onItemClick }: IntensityDistributionProps & { width: number; height: number }) {
  const defs = useChartDefs();
  const id = useId();
  const reduce = useReducedMotion();
  const sync = useHoverSync<string>(ext);
  const n = items.length;
  const L = { left: 36, right: target ? 64 : 8, top: 4, bottom: 22 };
  const plotW = Math.max(10, width - L.left - L.right);
  const band = plotW / n;
  const barW = Math.max(4, Math.min(28, band * 0.66));
  const y = (f: number) => L.top + (1 - f) * height;
  const xc = (i: number) => L.left + band * (i + 0.5);
  const keys = useMemo(() => items.map((i) => i.key), [items]);
  const keyAt = useCallback((x: number) => {
    const i = Math.floor((x - L.left) / band);
    return i >= 0 && i < n ? keys[i] : null;
  }, [L.left, band, n, keys]);
  const { handlers } = useChartPointer<string>({ keys, keyAt, sync, id, onActivate: onItemClick, bigStep: 4 });
  const showEvery = Math.max(1, Math.ceil(44 / band));
  return (
    <div className="relative">
      <svg width={width} height={L.top + height + L.bottom} className="block touch-pan-y select-none overflow-visible outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus" role="group" aria-roledescription="chart" aria-label="Intensity distribution per week" tabIndex={0} {...handlers}>
        <ChartDefs ids={defs} />
        {[0, 0.5, 1].map((f) => (
          <g key={f} aria-hidden>
            <text x={L.left - 8} y={y(f)} textAnchor="end" dominantBaseline="central" style={{ fontFamily: T.mono, fontSize: 11, fill: T.fg3 }}>
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
                const y0 = y(base) - (k ? 1.5 : 0);
                base += f;
                return (
                  <g key={b.k}>
                    <motion.rect x={xc(i) - barW / 2} width={barW} rx={1.5} initial={{ y: y(0), height: 0 }} animate={{ y: y1, height: Math.max(0, y0 - y1) }} transition={{ ...spring.smooth, delay: delay + k * 0.04 }} style={{ fill: T.zone(b.zone) }} />
                    {b.k === 'hard' && <motion.rect x={xc(i) - barW / 2} width={barW} rx={1.5} initial={{ y: y(0), height: 0 }} animate={{ y: y1, height: Math.max(0, y0 - y1) }} transition={{ ...spring.smooth, delay: delay + k * 0.04 }} style={{ fill: defs.hatchOnAccent }} />}
                  </g>
                );
              })}
              {i % showEvery === (n - 1) % showEvery && (
                <text x={xc(i)} y={L.top + height + 8} textAnchor="middle" dominantBaseline="hanging" style={{ fontFamily: T.mono, fontSize: 11, fill: T.fg3 }} aria-hidden>
                  {it.label}
                </text>
              )}
            </g>
          );
        })}
        {target && (
          <g aria-hidden pointerEvents="none">
            {[target.easy, target.easy + target.moderate].map((f, k) => (
              <line key={k} x1={L.left - 2} x2={L.left + plotW + 4} y1={y(f)} y2={y(f)} style={{ stroke: T.fg1, strokeDasharray: '3 3', opacity: 0.7 }} />
            ))}
            <text x={L.left + plotW + 8} y={y(target.easy) + 1} dominantBaseline="central" style={{ fontFamily: T.sans, fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', fill: T.fg2 }}>
              TARGET
            </text>
            <text x={L.left + plotW + 8} y={y(target.easy) + 14} dominantBaseline="central" style={{ fontFamily: T.mono, fontSize: 10.5, fill: T.fg3 }}>
              {Math.round(target.easy * 100)}/{Math.round(target.moderate * 100)}/{Math.round(target.hard * 100)}
            </text>
          </g>
        )}
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
  return <rect x={xc(i) - band / 2 + 1} y={top - 2} width={Math.max(0, band - 2)} height={bottom - top + 4} rx={4} style={{ fill: 'none', stroke: T.fg3 }} pointerEvents="none" />;
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

/** Map zone i (1-based) of an N-zone model onto the z1..z7 fill ladder. */
export function zoneFill(i: number, count: number): number {
  if (count === 7) return i;
  if (count === 5) return [1, 2, 3, 5, 7][i - 1] ?? 7;
  if (count === 3) return [2, 4, 7][i - 1] ?? 7;
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
  const defs = useChartDefs();
  const range = formatRange ?? ((lo: number | null, hi: number | null) => (hi == null ? `${lo ?? 0}+` : `${lo ?? 0}–${hi}`) + (unit ? ` ${unit}` : ''));
  const rowH = compact ? 'h-6' : 'h-8';
  return (
    <div className={`min-w-0 ${className ?? ''}`}>
      <ChartFrame
        summary={`Time in zone: ${zones.map((z) => `Z${z.zone} ${Math.round((z.seconds / (total || 1)) * 100)}%`).join(', ')}`}
        loading={loading}
        empty={!total}
        height={zones.length * (compact ? 24 : 32) || 160}
        table={{ caption: 'Time in zone', columns: ['Zone', 'Name', 'Time', 'Share'], rows: zones.map((z) => [`Z${z.zone}`, z.name, fmtHMS(z.seconds), `${Math.round((z.seconds / (total || 1)) * 100)}%`]) }}
      >
        <svg width="0" height="0" className="absolute" aria-hidden>
          <ChartDefs ids={defs} />
        </svg>
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3" role="list">
          {zones.map((z, i) => {
            const f = z.seconds / (total || 1);
            const fill = zoneFill(z.zone, zones.length);
            const tgt = targetPct?.[i];
            return (
              <div key={z.zone} role="listitem" className={`contents`}>
                <div className={`flex ${rowH} items-center gap-2`}>
                  <span className="w-6 text-micro text-fg-2">Z{z.zone}</span>
                  {!compact && <span className="hidden w-24 truncate text-body-sm text-fg-2 sm:inline">{z.name}</span>}
                  {!compact && <span className="hidden w-20 font-mono text-mono-sm text-fg-3 md:inline">{range(z.low, z.high)}</span>}
                </div>
                <div className={`relative ${compact ? 'h-2' : 'h-3'} rounded-xs bg-surface-2`} title={range(z.low, z.high)}>
                  <motion.div
                    className="absolute inset-y-0 left-0 origin-left rounded-xs"
                    style={{ width: `${(f / max) * 100}%`, background: T.zone(fill) }}
                    initial={reduce ? { opacity: 0 } : { scaleX: 0 }}
                    animate={reduce ? { opacity: 1 } : { scaleX: 1 }}
                    transition={reduce ? { duration: 0.12 } : { ...spring.smooth, delay: Math.min(i * 0.02, 0.24) }}
                  />
                  {fill === 7 && (
                    <svg className="absolute inset-y-0 left-0 h-full" style={{ width: `${(f / max) * 100}%` }} aria-hidden>
                      <rect width="100%" height="100%" style={{ fill: defs.hatchOnAccent }} />
                    </svg>
                  )}
                  {tgt != null && <span className="absolute -inset-y-1 w-px bg-fg-1" style={{ left: `${(tgt / max) * 100}%` }} aria-hidden />}
                </div>
                <div className={`flex ${rowH} items-center justify-end gap-2 font-mono text-mono`}>
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
