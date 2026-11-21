/**
 * Annotations (design.md §6.1): vertical dashed fg-4 rules with a micro label at the top
 * (events, tests, threshold changes), the solid fg-3 TODAY rule, and phase bands.
 */
import { T } from './tokens';

const micro = { fontFamily: T.sans, fontSize: 10, fontWeight: 600, letterSpacing: '0.06em' } as const;

export function TodayRule({ x, y0, y1, label = 'TODAY' }: { x: number; y0: number; y1: number; label?: string | null }) {
  return (
    <g pointerEvents="none" aria-hidden>
      <line x1={x} x2={x} y1={y0} y2={y1} style={{ stroke: T.fg3 }} shapeRendering="crispEdges" />
      {label && (
        <text x={x} y={y0 - 4} textAnchor="middle" style={{ ...micro, fill: T.fg2 }}>
          {label}
        </text>
      )}
    </g>
  );
}

export interface FlagItem {
  key: string;
  x: number;
  label: string;
  /** 'A' events and other emphasised markers render the flag glyph in accent. */
  emphasis?: boolean;
  kind?: 'event' | 'threshold' | 'note';
}

/** Assigns each flag a label row (0/1) so neighbouring labels don't overlap. */
export function layoutFlags(items: FlagItem[], charW = 6.4): (FlagItem & { row: number; w: number })[] {
  const rowsRight = [-Infinity, -Infinity];
  return [...items]
    .sort((a, b) => a.x - b.x)
    .map((f) => {
      const w = f.label.length * charW + 14;
      const row = f.x >= rowsRight[0] + 6 ? 0 : f.x >= rowsRight[1] + 6 ? 1 : 0;
      rowsRight[row] = f.x + w;
      return { ...f, row, w };
    });
}

export function EventFlags({ items, y0, y1, clipLeft = -Infinity, clipRight = Infinity, flipRight }: { items: FlagItem[]; y0: number; y1: number; clipLeft?: number; clipRight?: number; /** labels wider than this many px past x flip to the left */ flipRight?: number }) {
  const laid = layoutFlags(items.filter((f) => f.x >= clipLeft && f.x <= clipRight));
  return (
    <g pointerEvents="none" aria-hidden>
      {laid.map((f) => {
        const ly = y0 - 4 - f.row * 13;
        const flip = flipRight != null ? f.w > flipRight + 24 : f.x + f.w > clipRight + 40;
        return (
          <g key={f.key}>
            <line x1={f.x} x2={f.x} y1={ly + 3} y2={y1} style={{ stroke: f.emphasis ? T.a6 : T.fg4, strokeDasharray: '2 3' }} shapeRendering="crispEdges" />
            {f.kind === 'threshold' ? (
              <path d={`M${f.x} ${ly - 8} l3.5 3.5 l-3.5 3.5 l-3.5 -3.5 Z`} style={{ fill: f.emphasis ? T.accent : T.fg2 }} />
            ) : (
              <path d={`M${f.x} ${ly + 2} V${ly - 8} h6 l-1.5 2.5 l1.5 2.5 h-6`} style={{ fill: f.emphasis ? T.accent : T.fg3, stroke: f.emphasis ? T.accent : T.fg3, strokeWidth: 1, strokeLinejoin: 'round' }} />
            )}
            <text x={flip ? f.x - 5 : f.x + 9} y={ly} textAnchor={flip ? 'end' : 'start'} style={{ ...micro, fill: f.emphasis ? T.fg1 : T.fg2 }}>
              {f.label.toUpperCase()}
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

/** Phase bands: alternating 3%/0% fg wash with a micro label inside the top-left corner. */
export function PhaseBands({ items, y0, y1, labelY }: { items: BandItem[]; y0: number; y1: number; labelY?: number }) {
  return (
    <g pointerEvents="none" aria-hidden>
      {items.map((b, i) => (
        <g key={b.key}>
          <rect x={b.x0} y={y0} width={Math.max(0, b.x1 - b.x0)} height={Math.max(0, y1 - y0)} style={{ fill: T.fg1, opacity: i % 2 ? 0.015 : 0.035 }} />
          <line x1={b.x0} x2={b.x0} y1={y0} y2={y1} style={{ stroke: T.line1 }} shapeRendering="crispEdges" />
          {b.label && b.x1 - b.x0 > b.label.length * 6.4 + 10 && (
            <text x={b.x0 + 6} y={labelY ?? y0 + 12} style={{ ...micro, fill: T.fg3 }}>
              {b.label.toUpperCase()}
            </text>
          )}
        </g>
      ))}
    </g>
  );
}
