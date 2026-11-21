/**
 * Glass tooltip (design.md §6.1): glass, radius md, line-3, padding 8/10, title in `label`,
 * rows of mono values. It sits on the side of the crosshair opposite the pointer's half,
 * never covers the crosshair, and follows with the `snappy` spring.
 */
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react';
import { dur, ease, spring } from '../motion';
import { T, toneStroke, type Tone } from './tokens';

export interface TooltipRow {
  label: string;
  value: string;
  /** Series swatch: line sample in the series' style. */
  swatch?: { tone: Tone; dash?: string; width?: number; kind?: 'line' | 'area' | 'bar' | 'dot'; fill?: string; pattern?: string };
  /** Emphasise (fg-1, 600) */
  strong?: boolean;
  /** Secondary (fg-3) */
  muted?: boolean;
  hint?: string;
}

export function Swatch({ s }: { s: NonNullable<TooltipRow['swatch']> }) {
  const c = toneStroke[s.tone];
  return (
    <svg width="14" height="10" aria-hidden className="shrink-0 overflow-visible">
      {s.kind === 'bar' ? (
        <>
          <rect x="2" y="1" width="10" height="8" rx="1.5" style={{ fill: s.fill ?? c }} />
          {s.pattern && <rect x="2" y="1" width="10" height="8" rx="1.5" style={{ fill: s.pattern }} />}
        </>
      ) : s.kind === 'dot' ? (
        <circle cx="7" cy="5" r="3" style={{ fill: c }} />
      ) : (
        <>
          {s.kind === 'area' && <rect x="0" y="5" width="14" height="5" style={{ fill: c, opacity: 0.25 }} />}
          <line x1="0" x2="14" y1="5" y2="5" strokeLinecap="round" style={{ stroke: c, strokeWidth: s.width ?? 2, strokeDasharray: s.dash }} />
        </>
      )}
    </svg>
  );
}

export function TooltipBody({ title, rows, footer }: { title?: ReactNode; rows: TooltipRow[]; footer?: ReactNode }) {
  return (
    <>
      {title && <div className="mb-1 whitespace-nowrap text-label text-fg-1">{title}</div>}
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-0.5">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <span className="flex w-3.5 items-center">{r.swatch && <Swatch s={r.swatch} />}</span>
            <span className={`whitespace-nowrap text-body-sm ${r.muted ? 'text-fg-3' : 'text-fg-2'}`}>{r.label}</span>
            <span className={`whitespace-nowrap text-right font-mono text-mono ${r.strong ? 'font-semibold text-fg-1' : r.muted ? 'text-fg-3' : 'text-fg-1'}`}>
              {r.value}
              {r.hint && <span className="ml-1.5 text-fg-3">{r.hint}</span>}
            </span>
          </div>
        ))}
      </div>
      {footer && <div className="mt-1.5 border-t border-line-1 pt-1.5 text-body-sm text-fg-2">{footer}</div>}
    </>
  );
}

interface ChartTooltipProps {
  /** Crosshair / anchor x in container px. */
  x: number;
  /** Preferred top in container px (clamped inside the container). */
  y: number;
  containerWidth: number;
  containerHeight?: number;
  visible: boolean;
  children: ReactNode;
  /** Gap between anchor and tooltip edge. */
  offset?: number;
  /** Force a side; default = opposite the pointer's half. */
  side?: 'left' | 'right';
}

export function ChartTooltip({ x, y, containerWidth, containerHeight, visible, children, offset = 14, side }: ChartTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const wasVisible = useRef(false);
  const reduce = useReducedMotion();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !visible) {
      wasVisible.current = false;
      return;
    }
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const s = side ?? (x > containerWidth / 2 ? 'left' : 'right');
    let tx = s === 'left' ? x - offset - w : x + offset;
    if (tx < 0) tx = x + offset;
    if (tx + w > containerWidth) tx = Math.max(0, x - offset - w);
    const maxY = (containerHeight ?? Infinity) - h - 2;
    const ty = Math.max(0, Math.min(y, maxY));
    if (!wasVisible.current || reduce) {
      mx.jump(tx);
      my.jump(ty);
    } else {
      animate(mx, tx, spring.snappy);
      animate(my, ty, spring.snappy);
    }
    wasVisible.current = true;
  });
  return (
    <motion.div
      ref={ref}
      role="presentation"
      aria-hidden
      className="glass pointer-events-none absolute left-0 top-0 z-(--z-popover) min-w-32 rounded-md border border-line-3 px-2.5 py-2 inset-shadow-hairline"
      style={{ x: mx, y: my }}
      initial={false}
      animate={{ opacity: visible ? 1 : 0, scale: visible ? 1 : 0.98 }}
      transition={{ duration: visible ? dur.fast : dur.fast * 0.7, ease: visible ? ease.out : ease.in }}
    >
      {children}
    </motion.div>
  );
}

/** Vertical crosshair rule (1px fg-3) as an SVG line. */
export function CrosshairRule({ x, y0, y1 }: { x: number; y0: number; y1: number }) {
  return <line x1={x} x2={x} y1={y0} y2={y1} style={{ stroke: T.fg3 }} shapeRendering="crispEdges" pointerEvents="none" />;
}

/** 6px datum dot with a 2px canvas-coloured ring. */
export function CrosshairDot({ x, y, tone = 'fg1', ring = T.canvas }: { x: number; y: number; tone?: Tone; ring?: string }) {
  return <circle cx={x} cy={y} r={4} pointerEvents="none" style={{ fill: toneStroke[tone], stroke: ring, strokeWidth: 2 }} />;
}
