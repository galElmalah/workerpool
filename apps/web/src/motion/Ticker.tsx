/**
 * Animated numbers — design.md §5.4d. Neither component re-renders React per frame.
 *  - <Ticker value format /> : values that change in place (StatTile, week totals).
 *  - <Odometer value />      : hero numbers (stat-lg and up); one rolling column per digit.
 */
import { animate, AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { useReducedMotionPref } from './prefs';
import { spring, tween } from './tokens';

const fmt0 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const defaultFormat = (n: number) => fmt0.format(Math.round(n)).replace('-', '−');

export interface TickerProps {
  value: number;
  format?: (n: number) => string;
  className?: string;
  /** Animate from this value on first mount (e.g. 0 for a count-up). Default: no mount animation. */
  from?: number;
}

export function Ticker({ value, format = defaultFormat, className, from }: TickerProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(from ?? value);
  const fmtRef = useRef(format);
  fmtRef.current = format;
  const reduce = useReducedMotionPref();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const start = prev.current;
    prev.current = value;
    if (reduce || start === value || !Number.isFinite(start) || !Number.isFinite(value)) {
      el.textContent = fmtRef.current(value);
      return;
    }
    const c = animate(start, value, {
      ...(Math.abs(value) >= 1000 ? spring.gentle : spring.smooth),
      onUpdate: (v) => {
        el.textContent = fmtRef.current(v);
      },
    });
    return () => c.stop();
  }, [value, reduce]);

  return (
    <span ref={ref} className={className ? `num ${className}` : 'num'} aria-label={format(value)}>
      {format(from ?? value)}
    </span>
  );
}

/** One digit column: 0–9 stacked, clipped to 1em. */
function Digit({ d }: { d: number }) {
  return (
    <span className="relative inline-block h-[1em] w-[1ch] overflow-hidden align-[-0.12em]" aria-hidden>
      <motion.span
        className="absolute inset-x-0 top-0 flex flex-col"
        initial={false}
        animate={{ y: `${-d * 10}%` }}
        transition={spring.smooth}
      >
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className="block h-[1em] text-center leading-[1em]">
            {i}
          </span>
        ))}
      </motion.span>
    </span>
  );
}

export interface OdometerProps {
  value: number;
  /** Formats the final value for assistive tech and non-digit characters (default: grouped integer). */
  format?: (n: number) => string;
  className?: string;
}

/**
 * Rolling digits keyed from the right so adding a digit doesn't shift columns; separators
 * and signs render statically. New leading digits enter with presence.
 */
export function Odometer({ value, format = defaultFormat, className }: OdometerProps) {
  const reduce = useReducedMotionPref();
  const text = format(value);
  if (reduce) {
    return (
      <span className={className ? `num ${className}` : 'num'} aria-live="polite">
        {text}
      </span>
    );
  }
  const chars = [...text];
  let digitIndex = 0;
  const keyed = chars
    .slice()
    .reverse()
    .map((ch) => {
      const isDigit = ch >= '0' && ch <= '9';
      const key = isDigit ? `d${digitIndex++}` : `s${digitIndex}-${ch}`;
      return { ch, isDigit, key };
    })
    .reverse();

  return (
    <span className={className ? `num inline-flex ${className}` : 'num inline-flex'} aria-live="polite" aria-label={text}>
      <AnimatePresence initial={false} mode="popLayout">
        {keyed.map(({ ch, isDigit, key }) => (
          <motion.span
            key={key}
            layout="position"
            initial={{ opacity: 0, y: '0.3em' }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: '-0.3em', transition: tween('fast', 'in') }}
            transition={spring.smooth}
            className="inline-block"
            aria-hidden
          >
            {isDigit ? <Digit d={Number(ch)} /> : ch}
          </motion.span>
        ))}
      </AnimatePresence>
    </span>
  );
}
