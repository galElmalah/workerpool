/**
 * IntensityDot + IntensityPips + IntensityPicker — DESIGN_V2 §5, product.md §3.4.
 * Dot: the calendar's one tint — a 6px dot toned from the z-ramp; easy sessions show none.
 * Pips: 5 small vertical bars (heights scaled), the first `level` filled — neutral fg by default,
 * the zone ramp with `tone="zone"`. Race renders a flag glyph instead.
 * Picker: Base UI RadioGroup; arrow keys change it; filled bars pop scaleY .6 → 1 staggered 20ms
 * (snappy); the label ticks under it.
 */
import { INTENSITY_CLASSES, INTENSITY_META, type IntensityClass } from '@cadence/core';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { Flag } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '@/lib/cn';
import { useReducedMotionPref } from '@/motion/prefs';
import { spring, tween } from '@/motion/tokens';

const FILL = ['bg-z1', 'bg-z2', 'bg-z3', 'bg-z5', 'bg-z7'];
const DOT: Record<IntensityClass, string | null> = {
  recovery: null,
  endurance: null,
  tempo: 'bg-z3',
  threshold: 'bg-z5',
  high: 'bg-z7',
  race: 'bg-z7',
};

export interface IntensityDotProps {
  intensity: IntensityClass | null | undefined;
  /** Also draw recovery / endurance (z1 / z2). Default false: easy sessions carry no tint. */
  showEasy?: boolean;
  className?: string;
}

/** 6px intensity dot (DESIGN_V2 §5 chip/card). Labelled for screen readers and on hover. */
export function IntensityDot({ intensity, showEasy, className }: IntensityDotProps) {
  if (!intensity) return null;
  const tone = DOT[intensity] ?? (showEasy ? (intensity === 'recovery' ? 'bg-z1' : 'bg-z2') : null);
  if (!tone) return null;
  const label = `${INTENSITY_META[intensity].label} intensity`;
  return <span className={cn('size-1.5 shrink-0 rounded-full', tone, className)} role="img" aria-label={label} title={INTENSITY_META[intensity].label} />;
}

export interface IntensityPipsProps {
  intensity: IntensityClass | null | undefined;
  size?: 'sm' | 'md';
  className?: string;
  /** Monochrome fg-1 fill (for use on accent surfaces). */
  mono?: boolean;
  /** 'neutral' (default, fg-3 fill) or 'zone' (the z-ramp, for detail pages). */
  tone?: 'neutral' | 'zone';
}

export function IntensityPips({ intensity, size = 'sm', className, mono, tone = 'neutral' }: IntensityPipsProps) {
  if (!intensity) return null;
  const meta = INTENSITY_META[intensity];
  if (intensity === 'race')
    return (
      <span className={cn('inline-flex items-center text-fg-2', className)} title="Race" aria-label="Race">
        <Flag className={size === 'sm' ? 'size-3' : 'size-3.5'} strokeWidth={2} aria-hidden />
      </span>
    );
  const hs = size === 'sm' ? [4, 6, 8, 10, 12] : [6, 9, 12, 15, 18];
  return (
    <span className={cn('inline-flex items-end gap-px', size === 'md' && 'gap-0.5', className)} role="img" aria-label={`Intensity ${meta.level} of 5, ${meta.label}`} title={meta.label}>
      {hs.map((h, i) => (
        <span
          key={i}
          className={cn('rounded-[1px]', size === 'sm' ? 'w-[3px]' : 'w-1', i < meta.level ? (mono ? 'bg-fg-1' : tone === 'zone' ? FILL[i] : 'bg-fg-3') : 'bg-surface-3')}
          style={{ height: h }}
        />
      ))}
    </span>
  );
}

const PICKER_LABEL: Record<IntensityClass, string> = {
  recovery: 'Easy',
  endurance: 'Steady',
  tempo: 'Moderate',
  threshold: 'Hard',
  high: 'Max',
  race: 'Race',
};

export interface IntensityPickerProps {
  value: IntensityClass;
  onValueChange: (v: IntensityClass) => void;
  /** Include the Race option (flag). Default true. */
  allowRace?: boolean;
  className?: string;
  'aria-label'?: string;
}

/** Segmented intensity selector: one column of bars per class. */
export function IntensityPicker({ value, onValueChange, allowRace = true, className, ...aria }: IntensityPickerProps) {
  const reduce = useReducedMotionPref();
  const options = INTENSITY_CLASSES.filter((c) => allowRace || c !== 'race');
  const level = INTENSITY_META[value].level;
  const hs = [6, 9, 12, 15, 18];
  return (
    <div className={cn('inline-flex flex-col gap-1.5', className)}>
      <RadioGroup
        value={value}
        onValueChange={(v) => onValueChange(v as IntensityClass)}
        aria-label={aria['aria-label'] ?? 'Intensity'}
        className="inline-flex items-end gap-1 rounded-md border border-line-1 bg-surface-2 p-1"
      >
        {options.map((c, idx) => {
          const on = c === value;
          const filled = c === 'race' ? value === 'race' : value !== 'race' && idx < level;
          return (
            <Radio.Root
              key={c}
              value={c}
              aria-label={INTENSITY_META[c].label}
              className={cn(
                'group relative flex h-8 w-7 items-end justify-center rounded-sm pb-1.5 outline-none transition-colors duration-(--dur-fast)',
                'hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus',
                on && 'bg-surface-active light:bg-surface-1',
              )}
            >
              {c === 'race' ? (
                <motion.span animate={on && !reduce ? { scale: [0.8, 1.1, 1] } : { scale: 1 }} transition={spring.snappy} className={cn('mb-px flex', filled ? 'text-fg-1' : 'text-fg-4')}>
                  <Flag className="size-3.5" strokeWidth={2} />
                </motion.span>
              ) : (
                <motion.span
                  key={`${c}-${filled}-${value}`}
                  initial={filled && !reduce ? { scaleY: 0.6 } : false}
                  animate={{ scaleY: 1 }}
                  transition={{ ...spring.snappy, delay: filled ? idx * 0.02 : 0 }}
                  style={{ height: hs[idx], originY: 1 }}
                  className={cn('w-1 rounded-[1px] transition-colors duration-(--dur-fast)', filled ? FILL[idx] : 'bg-gray-7')}
                />
              )}
            </Radio.Root>
          );
        })}
      </RadioGroup>
      <div className="relative h-4 overflow-hidden text-micro text-fg-2" aria-hidden>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={value}
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -10, opacity: 0, transition: tween('fast', 'in') }}
            transition={spring.snappy}
            className="absolute left-1"
          >
            {PICKER_LABEL[value]} · {INTENSITY_META[value].label}
          </motion.span>
        </AnimatePresence>
      </div>
    </div>
  );
}
