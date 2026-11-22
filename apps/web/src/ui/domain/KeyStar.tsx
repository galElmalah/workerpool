/**
 * KeyStar — key-workout toggle (design.md §5.4k). Base UI Toggle. Turning ON scales the star
 * 1 → 1.25 → 1 (bouncy), fills outline → accent, and bursts 6 accent particles (3px, radiating
 * 10px at 60° steps, 360ms ease-out). No burst on turn-off, under reduced motion, or for repeat
 * toggles within 1s. `readOnly` renders the static marker used on cards (10–12px).
 */
import { Toggle } from '@base-ui/react/toggle';
import { Star } from 'lucide-react';
import { motion, useAnimationControls } from 'motion/react';
import { useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { useReducedMotionPref } from '@/motion/prefs';
import { ease, spring } from '@/motion/tokens';

function StarBurst({ fire }: { fire: number }) {
  if (!fire) return null;
  return (
    <span key={fire} aria-hidden className="pointer-events-none absolute inset-0">
      {Array.from({ length: 6 }, (_, i) => {
        const a = (i * Math.PI) / 3 - Math.PI / 2;
        return (
          <motion.span
            key={i}
            className="absolute top-1/2 left-1/2 -mt-[1.5px] -ml-[1.5px] size-[3px] rounded-full bg-accent"
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{ x: Math.cos(a) * 11, y: Math.sin(a) * 11, opacity: 0, scale: 0.6 }}
            transition={{ duration: 0.36, ease: ease.out as unknown as [number, number, number, number] }}
          />
        );
      })}
    </span>
  );
}

export interface KeyStarProps {
  pressed: boolean;
  onPressedChange?: (pressed: boolean) => void;
  /** 'xs' (10px) is for one-line calendar chips. */
  size?: 'xs' | 'sm' | 'md';
  readOnly?: boolean;
  className?: string;
}

export function KeyStar({ pressed, onPressedChange, size = 'md', readOnly, className }: KeyStarProps) {
  const reduce = useReducedMotionPref();
  const [fire, setFire] = useState(0);
  const last = useRef(0);
  const controls = useAnimationControls();
  const px = size === 'xs' ? 'size-2.5' : size === 'sm' ? 'size-3' : 'size-4';

  if (readOnly) {
    return pressed ? <Star className={cn(px, 'shrink-0 fill-accent text-accent', className)} strokeWidth={1.5} aria-label="Key workout" /> : null;
  }

  return (
    <Toggle
      pressed={pressed}
      onPressedChange={(p) => {
        onPressedChange?.(p);
        const now = Date.now();
        if (p && !reduce && now - last.current > 1000) {
          setFire((f) => f + 1);
          void controls.start({ scale: [1, 1.25, 1], transition: spring.bouncy });
        }
        last.current = now;
      }}
      aria-label={pressed ? 'Key workout (on)' : 'Mark as key workout'}
      className={cn(
        'relative inline-flex size-8 items-center justify-center rounded-md text-fg-3 outline-none transition-colors duration-(--dur-fast)',
        'hover:bg-surface-2 hover:text-fg-1 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus data-[pressed]:text-accent',
        className,
      )}
    >
      <motion.span animate={controls} className="inline-flex">
        <Star className={cn(px, 'transition-[fill] duration-(--dur-fast)', pressed ? 'fill-accent' : 'fill-transparent')} strokeWidth={1.75} />
      </motion.span>
      <StarBurst fire={fire} />
    </Toggle>
  );
}
