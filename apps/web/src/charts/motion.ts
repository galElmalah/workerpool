/**
 * Motion for the chart kit. Springs/durations/eases come from the single source of timing,
 * `src/motion/tokens.ts` (design.md §5.3); this file only adds chart-specific helpers.
 */
import type { Transition } from 'motion/react';
import { stagger } from '../motion/tokens';

export { spring, dur, ease, stagger, tween } from '../motion/tokens';

/** Bar stagger per design.md §5.4e: 12 ms per item, capped at 240 ms. */
export const staggerDelay = (i: number, step = 0.012, max: number = stagger.max) => Math.min(i * step, max);

/** Reduced-motion replacement for draw-ins (design.md §5.3: 120 ms opacity fade). */
export const reducedFade: Transition = { duration: 0.12, ease: 'linear' };
