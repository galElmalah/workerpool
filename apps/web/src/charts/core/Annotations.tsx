/**
 * Annotations (DESIGN_V2 §5 "Charts"): quiet, sentence-case markers. Event flags are a thin
 * dotted fg-4 rule with a small dot and a 12px label; the today rule is a thin neutral line
 * with a small "Today" label; phase bands are very subtle surface washes with a small label.
 * No uppercase, no tracking, no coloured edges.
 */
import { T, TXT } from './tokens';

const label = TXT;

export function TodayRule({ x, y0, y1, label: text = 'Today' }: { x: number; y0: number; y1: number; label?: string | null }) {
  return (
    <g pointerEvents="none" aria-hidden>
      <line x1={x} x2={x} y1={y0} y2={y1} style={{ stroke: T.fg4, opacity: 0.7 }} shapeRendering="crispEdges" />
      {text && (
        <text x={x} y={y0 - 6} textAnchor="middle" style={{ ...label, fill: T.fg3 }}>
          {text}
        </text>
      )}
    </g>
  );
}

export interface FlagItem {
  key: string;
  x: number;
  label: string;
  /** 'A' events and other emphasised markers get an fg-1 label and a filled dot. */
  emphasis?: boolean;
  kind?: 'event' | 'threshold' | 'note';
}

/** Assigns each flag a label row (0/1) so neighbouring labels don't overlap. */
export function layoutFlags(items: FlagItem[], charW = 6.6): (FlagItem & { row: number; w: number })[] {
  const rowsRight = [-Infinity, -Infinity];
  return [...items]
    .sort((a, b) => a.x - b.x)
    .map((f) => {
      const w = f.label.length * charW + 12;
      const row = f.x >= rowsRight[0] + 8 ? 0 : f.x >= rowsRight[1] + 8 ? 1 : 0;
      rowsRight[row] = f.x + w;
      return { ...f, row, w };
    });
}

export function EventFlags({ items, y0, y1, clipLeft = -Infinity, clipRight = Infinity, flipRight }: { items: FlagItem[]; y0: number; y1: number; clipLeft?: number; clipRight?: number; /** labels wider than this many px past x flip to the left */ flipRight?: number }) {
  const laid = layoutFlags(items.filter((f) => f.x >= clipLeft && f.x <= clipRight));
  return (
    <g pointerEvents="none" aria-hidden>
      {laid.map((f) => {
        const ly = y0 - 6 - f.row * 16;
        const flip = flipRight != null ? f.w > flipRight + 24 : f.x + f.w > clipRight + 40;
        return (
          <g key={f.key}>
            <line x1={f.x} x2={f.x} y1={ly + 4} y2={y1} style={{ stroke: T.fg4, strokeDasharray: '1 3', opacity: f.emphasis ? 0.9 : 0.6 }} strokeLinecap="round" />
            {f.kind === 'threshold' ? (
              <path d={`M${f.x} ${ly - 7} l3 3 l-3 3 l-3 -3 Z`} style={{ fill: f.emphasis ? T.fg1 : T.fg3 }} />
            ) : (
              <circle cx={f.x} cy={ly - 4} r={f.emphasis ? 3 : 2.5} style={f.emphasis ? { fill: T.fg1 } : { fill: T.bg, stroke: T.fg3, strokeWidth: 1.25 }} />
            )}
            <text x={flip ? f.x - 7 : f.x + 7} y={ly} textAnchor={flip ? 'end' : 'start'} style={{ ...label, fill: f.emphasis ? T.fg1 : T.fg3, fontWeight: f.emphasis ? 500 : 400 }}>
              {f.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export interface BandItem {
  key: string;
  x0: number;
  x1: number;
  label?: string;
}

/** Phase bands: alternating very faint fg wash (no edge lines) with a small label inside the top-left corner. */
export function PhaseBands({ items, y0, y1, labelY }: { items: BandItem[]; y0: number; y1: number; labelY?: number }) {
  return (
    <g pointerEvents="none" aria-hidden>
      {items.map((b, i) => (
        <g key={b.key}>
          <rect x={b.x0} y={y0} width={Math.max(0, b.x1 - b.x0)} height={Math.max(0, y1 - y0)} style={{ fill: T.fg1, opacity: i % 2 ? 0 : 0.018 }} />
          {b.label && b.x1 - b.x0 > b.label.length * 6.6 + 16 && (
            <text x={b.x0 + 8} y={labelY ?? y0 + 16} style={{ ...label, fill: T.fg3 }}>
              {b.label}
            </text>
          )}
        </g>
      ))}
    </g>
  );
}
