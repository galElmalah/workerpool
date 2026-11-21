/**
 * Pointer + keyboard + touch handling for snapped crosshairs. Writes into a HoverSync (never
 * React state per frame); keyboard moves are also announced through a polite live region.
 */
import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { HoverSync } from './hover';

interface Options<K> {
  keys: readonly K[];
  /** Map a pointer position (relative to the interactive element) to the nearest key. */
  keyAt: (x: number, y: number) => K | null;
  sync: HoverSync<K>;
  /** Unique id of this chart (so synced charts can tell who is driving). */
  id: string;
  onActivate?: (k: K) => void;
  /** Text announced for keyboard focus moves. */
  describe?: (k: K) => string;
  /** Key focused first when keyboard navigation starts. */
  initialKey?: K | null;
  /** Shift+Arrow step size. */
  bigStep?: number;
}

export function useChartPointer<K>({ keys, keyAt, sync, id, onActivate, describe, initialKey, bigStep = 7 }: Options<K>) {
  const [live, setLive] = useState('');
  const touchActive = useRef(false);
  const downAt = useRef<{ x: number; y: number } | null>(null);

  const rel = (e: PointerEvent<Element>) => {
    const r = (e.currentTarget as Element).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerMove = useCallback(
    (e: PointerEvent<Element>) => {
      const p = rel(e);
      sync.set(keyAt(p.x, p.y), id);
    },
    [keyAt, sync, id],
  );
  const onPointerDown = useCallback(
    (e: PointerEvent<Element>) => {
      const p = rel(e);
      downAt.current = p;
      if (e.pointerType === 'touch') {
        touchActive.current = true;
        sync.set(keyAt(p.x, p.y), id);
      }
    },
    [keyAt, sync, id],
  );
  const onPointerUp = useCallback(
    (e: PointerEvent<Element>) => {
      const p = rel(e);
      const d = downAt.current;
      downAt.current = null;
      if (d && Math.hypot(p.x - d.x, p.y - d.y) < 6 && onActivate && e.pointerType !== 'touch') {
        const k = keyAt(p.x, p.y);
        if (k != null) onActivate(k);
      }
    },
    [keyAt, onActivate],
  );
  const onPointerLeave = useCallback(
    (e: PointerEvent<Element>) => {
      if (e.pointerType === 'touch' && touchActive.current) return; // keep tap-inspected value
      sync.set(null, id);
    },
    [sync, id],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<Element>) => {
      if (!keys.length) return;
      const cur = sync.get();
      let i = cur == null ? -1 : keys.indexOf(cur);
      const step = e.shiftKey ? bigStep : 1;
      let handled = true;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowUp':
          i = i < 0 ? (initialKey != null ? keys.indexOf(initialKey) : keys.length - 1) : Math.min(keys.length - 1, i + step);
          break;
        case 'ArrowLeft':
        case 'ArrowDown':
          i = i < 0 ? (initialKey != null ? keys.indexOf(initialKey) : keys.length - 1) : Math.max(0, i - step);
          break;
        case 'Home':
          i = 0;
          break;
        case 'End':
          i = keys.length - 1;
          break;
        case 'Escape':
          sync.set(null, id);
          return;
        case 'Enter':
        case ' ':
          if (cur != null && onActivate) onActivate(cur);
          else handled = false;
          break;
        default:
          handled = false;
      }
      if (!handled) return;
      e.preventDefault();
      if (e.key === 'Enter' || e.key === ' ') return;
      const k = keys[Math.max(0, i)];
      sync.set(k, id);
      if (describe) setLive(describe(k));
    },
    [keys, sync, id, onActivate, describe, initialKey, bigStep],
  );

  const onBlur = useCallback(() => {
    if (sync.source() === id) sync.set(null, id);
  }, [sync, id]);

  return {
    handlers: { onPointerMove, onPointerDown, onPointerUp, onPointerLeave, onKeyDown, onBlur },
    live,
  };
}
