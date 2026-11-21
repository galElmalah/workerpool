/**
 * Motion tokens for the chart kit.
 *
 * Exact values from design.md §5.3. `src/motion/tokens.ts` (owned by the design-system
 * engineer) is the canonical home; this file mirrors it so the chart kit had no hard
 * dependency while both were being built. Unify by re-exporting from there once it lands.
 */
import type { Transition } from 'motion/react';

export const spring = {
  snappy: { type: 'spring', visualDuration: 0.18, bounce: 0 },
  smooth: { type: 'spring', visualDuration: 0.32, bounce: 0.08 },
  gentle: { type: 'spring', visualDuration: 0.5, bounce: 0 },
  bouncy: { type: 'spring', visualDuration: 0.4, bounce: 0.28 },
} as const satisfies Record<string, Transition>;

export const dur = { fast: 0.14, base: 0.24, slow: 0.42 } as const;
export const ease = {
  out: [0.22, 1, 0.36, 1] as [number, number, number, number],
  in: [0.55, 0, 1, 0.45] as [number, number, number, number],
  inOut: [0.65, 0, 0.35, 1] as [number, number, number, number],
} as const;
export const stagger = { step: 0.035, max: 0.24 } as const;

/** delay(i) = min(i * step, max). Charts use a 12 ms step for bars (design.md §5.4e). */
export const staggerDelay = (i: number, step = 0.012, max: number = stagger.max) => Math.min(i * step, max);

export const tween = (d: keyof typeof dur, e: keyof typeof ease = 'out'): Transition => ({
  duration: dur[d],
  ease: ease[e],
});

/** Reduced-motion replacement for draw-ins (design.md §5.3: 120 ms opacity fade). */
export const reducedFade: Transition = { duration: 0.12, ease: 'linear' };
