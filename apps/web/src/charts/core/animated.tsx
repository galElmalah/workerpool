/**
 * Animated primitives: number ticker, morphing path, draw-in reveal (design.md §5.4d–e).
 * Every one honours reduced motion (jump / 120 ms fade).
 */
import { useEffect, useRef, type ReactNode, type SVGProps } from 'react';
import { animate, motion, useMotionValue, useReducedMotion, useTransform, type MotionValue } from 'motion/react';
import { interpolatePath } from 'd3-interpolate-path';
import { fmtInt } from '../format';
import { reducedFade, spring } from '../motion';

/** Rolls a number to its new value without re-rendering React per frame. */
export function Ticker({ value, format = fmtInt, className, ariaLive }: { value: number; format?: (n: number) => string; className?: string; ariaLive?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(value);
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    const from = prev.current;
    prev.current = value;
    if (!el) return;
    if (reduce || from === value || !Number.isFinite(from) || !Number.isFinite(value)) {
      el.textContent = format(value);
      return;
    }
    const c = animate(from, value, { ...(Math.abs(value) >= 1000 ? spring.gentle : spring.smooth), onUpdate: (v) => (el.textContent = format(v)) });
    return () => c.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <span ref={ref} className={`num ${className ?? ''}`} aria-live={ariaLive ? 'polite' : undefined} aria-label={ariaLive ? format(value) : undefined}>
      {format(value)}
    </span>
  );
}

/** Same as Ticker but writes into an SVG <text>/<tspan>. */
export function SvgTicker({ value, format = fmtInt, ...rest }: { value: number; format?: (n: number) => string } & Omit<SVGProps<SVGTSpanElement>, 'format' | 'ref'>) {
  const ref = useRef<SVGTSpanElement>(null);
  const prev = useRef(value);
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    const from = prev.current;
    prev.current = value;
    if (!el) return;
    if (reduce || from === value) {
      el.textContent = format(value);
      return;
    }
    const c = animate(from, value, { ...spring.smooth, onUpdate: (v) => (el.textContent = format(v)) });
    return () => c.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <tspan ref={ref} {...rest}>
      {format(value)}
    </tspan>
  );
}

type PathStyle = Omit<SVGProps<SVGPathElement>, 'd' | 'ref' | 'style'> & { style?: React.CSSProperties };

/**
 * A path whose `d` morphs to new data with d3-interpolate-path through a MotionValue.
 * Interruptible: a new `d` mid-morph starts from what is on screen.
 */
export function MorphPath({ d, transition = spring.gentle, ...rest }: { d: string; transition?: object } & PathStyle) {
  const interp = useRef<(t: number) => string>(() => d);
  const progress = useMotionValue(1);
  const dMV = useTransform(progress, (t) => interp.current(t));
  const reduce = useReducedMotion();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      interp.current = () => d;
      progress.jump(1);
      dMV.set(d);
      return;
    }
    const from = dMV.get();
    if (from === d) return;
    if (reduce || !from) {
      interp.current = () => d;
      progress.jump(0);
      progress.jump(1);
      return;
    }
    interp.current = interpolatePath(from, d);
    progress.jump(0);
    const c = animate(progress, 1, transition);
    return () => c.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d]);
  return <motion.path d={dMV} {...(rest as object)} />;
}

/**
 * Left-to-right draw-in via an animated clipPath rect (works with dashed strokes, unlike
 * pathLength). Reduced motion → 120 ms fade.
 */
export function Reveal({ id, x = 0, y = 0, width, height, children, delay = 0, play = true }: { id: string; x?: number; y?: number; width: number; height: number; children: ReactNode; delay?: number; play?: boolean }) {
  const reduce = useReducedMotion();
  if (reduce) {
    return (
      <motion.g initial={{ opacity: 0 }} animate={{ opacity: play ? 1 : 0 }} transition={reducedFade}>
        {children}
      </motion.g>
    );
  }
  return (
    <>
      <clipPath id={id}>
        <motion.rect x={x - 4} y={y - 8} height={height + 16} initial={{ width: 0 }} animate={{ width: play ? width + 8 : 0 }} transition={{ ...spring.gentle, delay }} />
      </clipPath>
      <g clipPath={`url(#${id})`}>{children}</g>
    </>
  );
}

/** Area fade-in 80 ms after its line (design.md §5.4e). */
export function FadeIn({ children, delay = 0.08, play = true }: { children: ReactNode; delay?: number; play?: boolean }) {
  return (
    <motion.g initial={{ opacity: 0 }} animate={{ opacity: play ? 1 : 0 }} transition={{ duration: 0.24, delay, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </motion.g>
  );
}

/** Animate a numeric MotionValue to `to` with a spring (or jump under reduced motion). */
export function springTo(mv: MotionValue<number>, to: number, reduce: boolean | null, transition: object = spring.gentle) {
  if (reduce) {
    mv.jump(to);
    return { stop() {} };
  }
  return animate(mv, to, transition);
}
