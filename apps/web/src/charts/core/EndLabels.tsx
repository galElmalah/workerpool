/**
 * End-of-line direct labels (DESIGN_V2 §5 "Charts"): `● value name` (or just `● name` when
 * `value` is empty) at the last point of each series, nudged vertically to stay ≥ 16px
 * apart, replacing legends. Sentence case, 12px sans; the value is fg-1, the name fg-3.
 */
import { motion } from 'motion/react';
import { spring } from '../motion';
import { T, TXT, toneStroke, type Tone } from './tokens';

export interface EndLabel {
  id: string;
  /** Data y in px (the line's last point). */
  y: number;
  value: string;
  name: string;
  tone: Tone;
  /** Optional trailing text in fg-3, e.g. "projected". */
  suffix?: string;
  dashed?: boolean;
}

/** Resolve overlaps: sort by y, push down to `gap`, then shift the block back inside [top,bottom]. */
export function avoidCollisions<L extends { y: number }>(labels: L[], gap = 14, top = -Infinity, bottom = Infinity): (L & { ly: number })[] {
  const sorted = labels.map((l) => ({ ...l, ly: l.y })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].ly - sorted[i - 1].ly < gap) sorted[i].ly = sorted[i - 1].ly + gap;
  }
  const overflow = sorted.length ? sorted[sorted.length - 1].ly - bottom : 0;
  if (overflow > 0) {
    sorted[sorted.length - 1].ly -= overflow;
    for (let i = sorted.length - 2; i >= 0; i--) {
      if (sorted[i + 1].ly - sorted[i].ly < gap) sorted[i].ly = sorted[i + 1].ly - gap;
    }
  }
  if (sorted.length && sorted[0].ly < top) {
    const d = top - sorted[0].ly;
    sorted.forEach((s) => (s.ly += d));
  }
  return sorted;
}

export function EndLabels({ labels, x, top = 0, bottom = Infinity, gap = 16 }: { labels: EndLabel[]; x: number; top?: number; bottom?: number; gap?: number }) {
  const placed = avoidCollisions(labels, gap, top + 6, bottom - 6);
  return (
    <g className="select-none" aria-hidden>
      {placed.map((l) => (
        <motion.g key={l.id} initial={false} animate={{ y: l.ly }} transition={spring.gentle}>
          {Math.abs(l.ly - l.y) > 3 && (
            <motion.line
              initial={false}
              animate={{ y1: l.y - l.ly }}
              x1={x - 6}
              x2={x - 1}
              y2={0}
              transition={spring.gentle}
              style={{ stroke: T.line3 }}
            />
          )}
          <circle cx={x + 3} cy={0} r={2.5} style={{ fill: l.dashed ? T.bg : toneStroke[l.tone], stroke: toneStroke[l.tone], strokeWidth: l.dashed ? 1.25 : 0 }} />
          <text x={x + 10} y={0} dominantBaseline="central" style={{ ...TXT, fill: T.fg1, fontWeight: 500 }}>
            {l.value}
            <tspan dx={l.value ? 5 : 0} style={{ fontWeight: 400, fill: l.value ? T.fg3 : l.tone === 'accent' ? T.fg2 : T.fg3 }}>
              {l.name}
            </tspan>
            {l.suffix && (
              <tspan dx={4} style={{ fontWeight: 400, fill: T.fg3 }}>
                {l.suffix}
              </tspan>
            )}
          </text>
        </motion.g>
      ))}
    </g>
  );
}

/** Compact variant for < 480px: a row of labels above the plot (HTML). */
export function EndLabelRow({ labels }: { labels: Omit<EndLabel, 'y'>[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-hidden>
      {labels.map((l) => (
        <span key={l.id} className="inline-flex items-center gap-1.5">
          <svg width="8" height="8">
            <circle cx="4" cy="4" r="2.5" style={{ fill: l.dashed ? 'none' : toneStroke[l.tone], stroke: toneStroke[l.tone], strokeWidth: l.dashed ? 1.25 : 0 }} />
          </svg>
          {l.value && <span className="num text-label font-medium text-fg-1">{l.value}</span>}
          <span className="text-label text-fg-3">{l.name}</span>
        </span>
      ))}
    </div>
  );
}
