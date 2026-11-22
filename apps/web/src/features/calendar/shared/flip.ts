/**
 * Lightweight FLIP for calendar card lists (design.md §5.3 rule 4): no Motion projection nodes on
 * the hundreds of cards a year of rows mounts — positions are read ONLY in days a drag or edit
 * touched, and the dropped card flies from the overlay's last rect into its slot with `bouncy`.
 * Transform-only, positions relative to the list so scrolling never reads as movement.
 */
import { animate } from 'motion/react';
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { isReducedMotion } from '@/motion/prefs';
import { spring } from '@/motion/tokens';

const pendingDrop = new Map<string, { left: number; top: number }>();
export const recordDrop = (id: string, rect: { left: number; top: number }) => void pendingDrop.set(id, rect);

export function useFlip(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  const prev = useRef(new Map<string, { x: number; y: number }>());
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const kids = [...el.querySelectorAll<HTMLElement>(':scope > [data-flip]')];
    const drop = kids.some((k) => pendingDrop.has(k.dataset.flip!));
    if (!enabled && !drop) {
      if (prev.current.size) prev.current = new Map();
      return;
    }
    const base = el.getBoundingClientRect();
    const reduce = isReducedMotion();
    const next = new Map<string, { x: number; y: number }>();
    for (const k of kids) {
      const id = k.dataset.flip!;
      const r = k.getBoundingClientRect();
      next.set(id, { x: r.left - base.left, y: r.top - base.top });
      const d = pendingDrop.get(id);
      if (d) {
        pendingDrop.delete(id);
        if (reduce) continue;
        k.style.zIndex = '40';
        void animate(k, { x: [d.left - r.left, 0], y: [d.top - r.top, 0], scale: [1.04, 1], rotate: [-1.5, 0] }, spring.bouncy).finished.then(() => (k.style.zIndex = ''));
        continue;
      }
      const p = prev.current.get(id);
      if (!p || reduce) continue;
      const dx = p.x - (r.left - base.left);
      const dy = p.y - (r.top - base.top);
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) void animate(k, { x: [dx, 0], y: [dy, 0] }, spring.smooth);
    }
    prev.current = next;
  });
}
