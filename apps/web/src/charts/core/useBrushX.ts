/**
 * Horizontal drag-to-select for SVG charts. While dragging it writes the selection rect's
 * attributes directly (no React render per move); on release it calls `onCommit(x0, x1)` in
 * plot px. Double-click or Escape clears (the chart owns the committed selection state).
 */
import { useCallback, useRef, type DOMAttributes, type PointerEvent } from 'react';

interface Options {
  enabled?: boolean;
  left: number;
  right: number;
  minPx?: number;
  onCommit: (x0: number, x1: number) => void;
  onClear?: () => void;
}

export function useBrushX({ enabled = true, left, right, minPx = 6, onCommit, onClear }: Options) {
  const rectRef = useRef<SVGRectElement>(null);
  const start = useRef<number | null>(null);
  const dragging = useRef(false);

  const relX = (e: PointerEvent<Element>) => e.clientX - (e.currentTarget as Element).getBoundingClientRect().left;
  const clamp = (x: number) => Math.max(left, Math.min(right, x));

  const onPointerDown = useCallback(
    (e: PointerEvent<Element>) => {
      if (!enabled || e.button !== 0 || e.pointerType === 'touch') return;
      start.current = clamp(relX(e));
      dragging.current = false;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, left, right],
  );
  const onPointerMove = useCallback(
    (e: PointerEvent<Element>) => {
      if (start.current == null) return;
      const x = clamp(relX(e));
      if (!dragging.current && Math.abs(x - start.current) < minPx) return;
      if (!dragging.current) {
        dragging.current = true;
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      }
      const r = rectRef.current;
      if (r) {
        r.setAttribute('x', String(Math.min(x, start.current)));
        r.setAttribute('width', String(Math.abs(x - start.current)));
        r.style.opacity = '1';
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [left, right, minPx],
  );
  const onPointerUp = useCallback(
    (e: PointerEvent<Element>) => {
      const s = start.current;
      start.current = null;
      const r = rectRef.current;
      if (r) r.style.opacity = '0';
      if (s == null || !dragging.current) return;
      dragging.current = false;
      const x = clamp(relX(e));
      onCommit(Math.min(s, x), Math.max(s, x));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onCommit, left, right],
  );
  const onDoubleClick = useCallback(() => onClear?.(), [onClear]);

  return { rectRef, isDragging: () => dragging.current, handlers: { onPointerDown, onPointerMove, onPointerUp, onDoubleClick } };
}

type HandlerName = 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerLeave' | 'onKeyDown' | 'onBlur' | 'onFocus' | 'onDoubleClick' | 'onClick';
export type ChartHandlers = Partial<Pick<DOMAttributes<Element>, HandlerName>>;
/** Merge handler maps so several hooks can share one element (all run, in order). */
export function mergeHandlers(...maps: ChartHandlers[]): ChartHandlers {
  const out: Record<string, (e: never) => void> = {};
  for (const m of maps) {
    for (const [k, fn] of Object.entries(m) as [string, ((e: never) => void) | undefined][]) {
      if (!fn) continue;
      const prev = out[k];
      out[k] = prev ? (e: never) => (prev(e), fn(e)) : fn;
    }
  }
  return out as ChartHandlers;
}
