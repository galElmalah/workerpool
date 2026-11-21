/**
 * Motion tokens — design.md §5.3. THE single source of timing in the SPA.
 * CSS twins: --ease-spring-{snappy,smooth,gentle,bouncy} + --dur-spring-* (same curves),
 * --dur-fast/base/slow and --ease-out/in/in-out in src/styles/app.css.
 */
import type { Transition } from 'motion/react';

export const spring = {
  /** Controls: press/release, toggles, switch thumbs, indicators < 200px of travel. Settles 400ms. */
  snappy: { type: 'spring', visualDuration: 0.18, bounce: 0 },
  /** DEFAULT. Layout reflow, in-page layoutId morphs, nav pill, rail expand. Settles 500ms. */
  smooth: { type: 'spring', visualDuration: 0.32, bounce: 0.08 },
  /** Large surfaces: calendar zoom, chart draw-in/domain, tickers above 3 digits. Settles 900ms. */
  gentle: { type: 'spring', visualDuration: 0.5, bounce: 0 },
  /** ONLY drag-drop settle, key-workout star, "workout completed" check. Settles 700ms. */
  bouncy: { type: 'spring', visualDuration: 0.4, bounce: 0.28 },
} as const satisfies Record<string, Transition>;

export type SpringName = keyof typeof spring;

/** Seconds. fast = color/opacity/hover; base = entering content, crossfades; slow = page-level fades. */
export const dur = { fast: 0.14, base: 0.24, slow: 0.42 } as const;

export const ease = {
  out: [0.22, 1, 0.36, 1],
  in: [0.55, 0, 1, 0.45],
  inOut: [0.65, 0, 0.35, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

/** Entering collections only. delay(i) = min(i * step, max). */
export const stagger = { step: 0.035, max: 0.24 } as const;
export const staggerDelay = (i: number, step: number = stagger.step, max: number = stagger.max) => Math.min(i * step, max);

type Bezier = [number, number, number, number];
/** Tween helper: `tween('base')`, `tween('fast', 'in')`. Exits use ease.in at ≤ 0.7× the enter. */
export const tween = (d: keyof typeof dur, e: keyof typeof ease = 'out'): Transition => ({
  duration: dur[d],
  ease: ease[e] as unknown as Bezier,
});

/** CSS strings for inline styles / WAAPI (e.g. dnd-kit dropAnimation). */
export const css = {
  spring: {
    snappy: 'var(--dur-spring-snappy) var(--ease-spring-snappy)',
    smooth: 'var(--dur-spring-smooth) var(--ease-spring-smooth)',
    gentle: 'var(--dur-spring-gentle) var(--ease-spring-gentle)',
    bouncy: 'var(--dur-spring-bouncy) var(--ease-spring-bouncy)',
  },
  /** Literal linear() curves (for APIs that cannot read CSS variables, e.g. WAAPI keyframe easing). */
  linear: {
    bouncy:
      'linear(0, 0.0707, 0.2291, 0.4151, 0.5925, 0.7422, 0.8576, 0.9392, 0.9919, 1.0218, 1.0354, 1.0384, 1.035, 1.0287, 1.0215, 1.0148, 1.0092, 1.005, 1.002, 1.0001, 0.9991, 1, 1)',
    smooth:
      'linear(0, 0.0958, 0.2832, 0.4752, 0.6371, 0.7605, 0.8484, 0.9078, 0.9463, 0.9702, 0.9845, 0.9926, 0.997, 0.9992, 1.0002, 1, 1)',
  },
  ms: { snappy: 400, smooth: 500, gentle: 900, bouncy: 700, fast: 140, base: 240, slow: 420 },
} as const;

/** Press feedback shared by every pressable (design.md §5.4h). */
export const press = { whileTap: { scale: 0.97 }, transition: spring.snappy } as const;
