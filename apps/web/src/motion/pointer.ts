/**
 * Pointer effects — design.md §5.4l (spotlight) and §5.4h (magnetic). They write CSS variables or
 * MotionValues and NEVER call setState per frame.
 */
import { useSpring, type MotionValue } from 'motion/react';
import { useCallback, type PointerEvent as ReactPointerEvent } from 'react';
import { isReducedMotion } from './prefs';
import { spring } from './tokens';

/** Attach to `onPointerMove` of any `.spotlight` element. */
export const onSpotlightMove = (e: ReactPointerEvent<HTMLElement>) => {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${e.clientX - r.left}px`);
  el.style.setProperty('--my', `${e.clientY - r.top}px`);
};

/** Props bundle: `<div {...useSpotlight()} className="spotlight …">`. */
export function useSpotlight() {
  return { onPointerMove: onSpotlightMove };
}

/**
 * Magnetic pull (max 3px, offset × 0.15) — allowed ONLY on the rail's New workout button and the
 * ⌘K trigger. Returns MotionValues for `style={{ x, y }}` and the pointer handlers.
 */
export function useMagnetic(strength = 0.15, max = 3): {
  x: MotionValue<number>;
  y: MotionValue<number>;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave: () => void;
} {
  const x = useSpring(0, spring.snappy);
  const y = useSpring(0, spring.snappy);
  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'mouse' || isReducedMotion()) return;
      const r = e.currentTarget.getBoundingClientRect();
      const clamp = (v: number) => Math.max(-max, Math.min(max, v));
      x.set(clamp((e.clientX - (r.left + r.width / 2)) * strength));
      y.set(clamp((e.clientY - (r.top + r.height / 2)) * strength));
    },
    [x, y, strength, max],
  );
  const onPointerLeave = useCallback(() => {
    x.set(0);
    y.set(0);
  }, [x, y]);
  return { x, y, onPointerMove, onPointerLeave };
}
