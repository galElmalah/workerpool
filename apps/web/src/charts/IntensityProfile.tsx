/**
 * IntensityProfile — structured-workout block profile (design.md §6.2 "Intensity profile").
 * Width ∝ duration, height ∝ intensity (fraction of threshold, 0–1.5), fill = zone ladder,
 * ramps as trapezoids, repeat brackets, FTP line. Full variant animates add / remove /
 * reorder by morphing each block's path (same command structure, so Motion interpolates it);
 * the compact variant is static and cheap for cards.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ChartDefs, useChartDefs } from './core/ChartDefs';
import { ChartFrame } from './core/ChartFrame';
import { T } from './core/tokens';
import { useChartSize } from './core/useChartSize';
import { fmtDurShort, fmtHMS } from './format';
import { spring } from './motion';

export interface ProfileBlock {
  id: string;
  startSec: number;
  durationSec: number;
  /** Fraction of threshold (1 = 100 %). */
  intensity: number;
  /** For ramps: intensity at the end of the block. */
  intensityEnd?: number;
  /** Zone 1–7 (derived from intensity when omitted). */
  level?: number;
  role: 'warmup' | 'active' | 'recovery' | 'rest' | 'cooldown' | 'other';
  label?: string;
  /** Optional group key (e.g. the step id shared by every repeat iteration): hover / selection
   *  highlight every block of the group, and `selectedId` / `hoveredId` may name the group. */
  group?: string;
}
export interface ProfileRepeat {
  id: string;
  startSec: number;
  endSec: number;
  count: number;
}

export function levelFor(intensity: number): number {
  const b = [0.55, 0.75, 0.9, 1.05, 1.2, 1.5];
  let z = 1;
  for (const x of b) if (intensity >= x) z++;
  return Math.min(7, z);
}

export interface IntensityProfileProps {
  blocks: ProfileBlock[];
  repeats?: ProfileRepeat[];
  /** 'full' (interactive, animated) or 'compact' (static, for cards). */
  variant?: 'full' | 'compact';
  /** 24 (week card), 48 (day/detail), 160 (builder). */
  height?: number;
  maxIntensity?: number;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  hoveredId?: string | null;
  onHover?: (id: string | null) => void;
  showAxis?: boolean;
  /** Y-axis caption (default "%FTP"). */
  axisLabel?: string;
  loading?: boolean;
  className?: string;
}

/** Path for one block: rect (or trapezoid for ramps) with 2px rounded top corners. Same commands for both. */
function blockPath(x: number, w: number, yA: number, yB: number, base: number, r = 2) {
  const rr = Math.min(r, w / 2, (base - Math.min(yA, yB)) / 2);
  return `M${x} ${base}L${x} ${yA + rr}Q${x} ${yA} ${x + rr} ${yA}L${x + w - rr} ${yB}Q${x + w} ${yB} ${x + w} ${yB + rr}L${x + w} ${base}Z`;
}

export function IntensityProfile(props: IntensityProfileProps) {
  const { blocks, variant = 'full', height = variant === 'compact' ? 24 : 160, loading, className } = props;
  const [ref, size] = useChartSize<HTMLDivElement>();
  const total = blocks.reduce((a, b) => Math.max(a, b.startSec + b.durationSec), 0);
  const summary = `Workout profile, ${fmtHMS(total)}, ${blocks.filter((b) => b.role === 'active').length} work blocks, peak ${Math.round(Math.max(0, ...blocks.map((b) => Math.max(b.intensity, b.intensityEnd ?? 0))) * 100)}% of threshold.`;
  if (variant === 'compact') {
    return (
      <div ref={ref} className={`w-full min-w-0 ${className ?? ''}`} style={{ height }} role="img" aria-label={summary}>
        {size.width > 0 && <CompactProfile {...props} width={size.width} height={height} />}
      </div>
    );
  }
  const axisH = props.showAxis === false ? 0 : 20;
  return (
    <div className={`min-w-0 ${className ?? ''}`}>
      <ChartFrame
        summary={summary}
        loading={loading}
        empty={!blocks.length}
        emptyTitle="No steps"
        emptyHint="Add a step to see the profile."
        height={height + axisH + 18}
        table={{ caption: 'Workout steps', columns: ['Step', 'Start', 'Duration', 'Intensity'], rows: blocks.map((b, i) => [`${i + 1} ${b.label ?? b.role}`, fmtHMS(b.startSec), fmtHMS(b.durationSec), `${Math.round(b.intensity * 100)}%${b.intensityEnd != null ? `–${Math.round(b.intensityEnd * 100)}%` : ''}`]) }}
      >
        <div ref={ref} className="w-full">
          {size.width > 0 && <FullProfile {...props} width={size.width} height={height} />}
        </div>
      </ChartFrame>
    </div>
  );
}

function CompactProfile({ blocks, width, height, maxIntensity = 1.4 }: IntensityProfileProps & { width: number; height: number }) {
  const total = blocks.reduce((a, b) => Math.max(a, b.startSec + b.durationSec), 0) || 1;
  const k = width / total;
  const y = (v: number) => height - Math.max(0.12, Math.min(1, v / maxIntensity)) * height;
  return (
    <svg width={width} height={height} className="block" aria-hidden>
      {blocks.map((b) => {
        const x = b.startSec * k;
        const w = Math.max(0.5, b.durationSec * k - (b.durationSec * k > 2 ? 1 : 0));
        return <path key={b.id} d={blockPath(x, w, y(b.intensity), y(b.intensityEnd ?? b.intensity), height, 1)} style={{ fill: T.zone(b.level ?? levelFor(Math.max(b.intensity, b.intensityEnd ?? 0))) }} />;
      })}
    </svg>
  );
}

function FullProfile({ blocks, repeats = [], width, height, maxIntensity = 1.5, selectedId, onSelect, hoveredId: ctlHover, onHover, showAxis = true, axisLabel = '%FTP' }: IntensityProfileProps & { width: number; height: number }) {
  const defs = useChartDefs();
  const reduce = useReducedMotion();
  const uid = useId();
  const [hoverS, setHoverS] = useState<string | null>(null);
  // Stagger only the first draw; later updates (hover dim, edits) must respond immediately.
  const firstDraw = useRef(true);
  useEffect(() => {
    const t = setTimeout(() => (firstDraw.current = false), 400);
    return () => clearTimeout(t);
  }, []);
  const hovered = ctlHover !== undefined ? ctlHover : hoverS;
  const setHover = (id: string | null) => {
    setHoverS(id);
    onHover?.(id);
  };
  const L = { left: 34, right: 8, top: 14 };
  const plotW = Math.max(10, width - L.left - L.right);
  const base = L.top + height;
  const total = useMemo(() => blocks.reduce((a, b) => Math.max(a, b.startSec + b.durationSec), 0) || 1, [blocks]);
  const k = plotW / total;
  const y = (v: number) => base - (Math.min(maxIntensity, v) / maxIntensity) * height;
  const bracketsH = repeats.length ? 18 : 0;
  const axisY = base + bracketsH + 6;
  const ticks = [0.5, 0.75, 1, 1.2].filter((t) => t < maxIntensity);
  const timeStep = [60, 300, 600, 900, 1200, 1800, 3600].find((s) => (plotW / total) * s >= 64) ?? 3600;
  const focusId = hovered ?? null;
  const keyOf = (b: ProfileBlock) => b.group ?? b.id;
  const focusKey = focusId == null ? null : (blocks.find((b) => b.id === focusId) ? keyOf(blocks.find((b) => b.id === focusId)!) : focusId);
  const selKey = selectedId == null ? null : (blocks.find((b) => b.id === selectedId) ? keyOf(blocks.find((b) => b.id === selectedId)!) : selectedId);
  return (
    <div className="relative">
      <svg width={width} height={axisY + (showAxis ? 16 : 0)} className="block select-none overflow-visible" role="list" aria-label="Workout steps">
        <ChartDefs ids={defs} />
        {ticks.map((t) => (
          <g key={t} aria-hidden>
            <line x1={L.left} x2={L.left + plotW} y1={y(t)} y2={y(t)} style={{ stroke: t === 1 ? T.fg4 : T.line1, strokeDasharray: t === 1 ? '3 3' : undefined }} shapeRendering="crispEdges" />
            <text x={L.left - 8} y={y(t)} textAnchor="end" dominantBaseline="central" style={{ fontFamily: T.mono, fontSize: 11, fill: t === 1 ? T.fg2 : T.fg3 }}>
              {Math.round(t * 100)}
            </text>
          </g>
        ))}
        <AnimatePresence initial={false}>
          {blocks.map((b, i) => {
            const x = L.left + b.startSec * k;
            const w = Math.max(1, b.durationSec * k - 1);
            const lvl = b.level ?? levelFor(Math.max(b.intensity, b.intensityEnd ?? 0));
            const d = blockPath(x, w, y(b.intensity), y(b.intensityEnd ?? b.intensity), base);
            const dim = focusKey != null && focusKey !== keyOf(b);
            const sel = selKey != null && selKey === keyOf(b);
            return (
              <motion.g
                key={b.id}
                role="listitem"
                aria-label={`${b.label ?? b.role}, ${fmtHMS(b.durationSec)} at ${Math.round(b.intensity * 100)}%${b.intensityEnd != null ? ` to ${Math.round(b.intensityEnd * 100)}%` : ''}`}
                tabIndex={onSelect ? 0 : -1}
                initial={reduce ? { opacity: 0 } : { opacity: 0, scaleY: 0 }}
                animate={{ opacity: dim ? 0.4 : 1, scaleY: 1 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, scaleY: 0, transition: { duration: 0.16, ease: [0.55, 0, 1, 0.45] } }}
                transition={{ ...spring.smooth, delay: reduce || !firstDraw.current ? 0 : Math.min(i * 0.02, 0.24) }}
                style={{ originY: 1, transformBox: 'fill-box', cursor: onSelect ? 'pointer' : 'default' }}
                onPointerEnter={() => setHover(b.id)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(b.id)}
                onBlur={() => setHover(null)}
                onClick={() => onSelect?.(b.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect?.(b.id);
                  }
                }}
                className="outline-none"
              >
                <motion.path initial={false} animate={{ d }} transition={spring.smooth} style={{ fill: T.zone(lvl) }} />
                {lvl === 7 && <motion.path initial={false} animate={{ d }} transition={spring.smooth} style={{ fill: defs.hatchOnAccent }} />}
                {sel && <motion.path initial={false} animate={{ d }} transition={spring.smooth} style={{ fill: 'none', stroke: T.fg1, strokeWidth: 1.5 }} />}
              </motion.g>
            );
          })}
        </AnimatePresence>
        {repeats.map((r) => {
          const x0 = L.left + r.startSec * k + 1;
          const x1 = L.left + r.endSec * k - 2;
          const yb = base + 8;
          return (
            <motion.g key={r.id} initial={false} animate={{ opacity: 1 }} aria-hidden>
              <motion.path initial={false} animate={{ d: `M${x0} ${yb - 4}V${yb}H${x1}V${yb - 4}` }} transition={spring.smooth} fill="none" style={{ stroke: T.fg3 }} />
              <motion.text initial={false} animate={{ x: (x0 + x1) / 2 }} transition={spring.smooth} y={yb + 4} textAnchor="middle" dominantBaseline="hanging" style={{ fontFamily: T.sans, fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', fill: T.fg2 }}>
                {r.count}×
              </motion.text>
            </motion.g>
          );
        })}
        {showAxis && (
          <g aria-hidden>
            {Array.from({ length: Math.floor(total / timeStep) + 1 }, (_, i) => i * timeStep).map((s) => (
              <text key={s} x={L.left + s * k} y={axisY} textAnchor={s === 0 ? 'start' : 'middle'} dominantBaseline="hanging" style={{ fontFamily: T.mono, fontSize: 11, fill: T.fg3 }}>
                {s === 0 ? '0' : fmtDurShort(s)}
              </text>
            ))}
          </g>
        )}
        <text x={0} y={L.top - 8} textAnchor="start" style={{ fontFamily: T.sans, fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', fill: T.fg3 }} aria-hidden>
          {axisLabel}
        </text>
      </svg>
      <ProfileTip blocks={blocks} id={focusId} k={k} left={L.left} width={width} y={y} uid={uid} />
    </div>
  );
}

function ProfileTip({ blocks, id, k, left, width, y }: { blocks: ProfileBlock[]; id: string | null; k: number; left: number; width: number; y: (v: number) => number; uid: string }) {
  const b = blocks.find((x) => x.id === id) ?? blocks.find((x) => x.group === id);
  if (!b) return null;
  const cx = left + (b.startSec + b.durationSec / 2) * k;
  const top = Math.max(0, y(Math.max(b.intensity, b.intensityEnd ?? 0)) - 34);
  return (
    <div className="glass pointer-events-none absolute z-(--z-popover) whitespace-nowrap rounded-sm border border-line-3 px-2 py-1 text-body-sm inset-shadow-hairline" style={{ left: Math.max(0, Math.min(width - 160, cx - 60)), top }}>
      <span className="text-fg-1">{b.label ?? b.role}</span>
      <span className="ml-2 font-mono text-mono-sm text-fg-2">
        {fmtHMS(b.durationSec)} · {Math.round(b.intensity * 100)}
        {b.intensityEnd != null ? `→${Math.round(b.intensityEnd * 100)}` : ''}%
      </span>
    </div>
  );
}
