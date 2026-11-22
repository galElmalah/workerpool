/**
 * Slider — design.md §7: track 4px surface-3; range fill accent; 16px fg-1 thumb with a 2px canvas
 * ring that scales 1.15 while dragging (snappy); optional detent ticks.
 * <RpeSlider>: 1–10 with ticks, zone-ladder fill, a value bubble (`stat-sm`) while dragging and
 * the EASY / MODERATE / HARD / MAX labels underneath. PageUp/PageDown step 2.
 */
import { Slider as BaseSlider } from '@base-ui/react/slider';
import { AnimatePresence, motion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { spring, tween } from '@/motion/tokens';

export interface SliderProps {
  value: number;
  onValueChange: (value: number) => void;
  onValueCommitted?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  largeStep?: number;
  /** Draw a tick per step. */
  ticks?: boolean;
  label?: ReactNode;
  /** Right side of the label row (formatted value). */
  valueLabel?: ReactNode;
  /** Fill color class for the range (default accent). */
  fillClassName?: string;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  /** Rendered above the thumb while dragging. */
  bubble?: (v: number) => ReactNode;
}

export function Slider({
  value,
  onValueChange,
  onValueCommitted,
  min = 0,
  max = 100,
  step = 1,
  largeStep,
  ticks,
  label,
  valueLabel,
  fillClassName = 'bg-accent',
  disabled,
  className,
  bubble,
  ...aria
}: SliderProps) {
  const [dragging, setDragging] = useState(false);
  const n = Math.round((max - min) / step);
  return (
    <BaseSlider.Root
      value={value}
      onValueChange={(v) => onValueChange(Array.isArray(v) ? (v[0] as number) : (v as number))}
      onValueCommitted={(v) => {
        setDragging(false);
        onValueCommitted?.(Array.isArray(v) ? (v[0] as number) : (v as number));
      }}
      min={min}
      max={max}
      step={step}
      largeStep={largeStep ?? step * 2}
      disabled={disabled}
      className={cn('flex w-full flex-col gap-2 data-[disabled]:opacity-40', className)}
    >
      {(label || valueLabel) && (
        <div className="flex items-baseline justify-between">
          {label && <BaseSlider.Label className="text-label text-fg-2">{label}</BaseSlider.Label>}
          {valueLabel && <span className="text-mono text-fg-1">{valueLabel}</span>}
        </div>
      )}
      <BaseSlider.Control className="relative flex h-6 w-full touch-none items-center select-none" onPointerDown={() => setDragging(true)}>
        <BaseSlider.Track className="relative h-1 w-full rounded-full bg-surface-3">
          {ticks && (
            <div className="pointer-events-none absolute inset-0" aria-hidden>
              {Array.from({ length: n + 1 }, (_, i) => (
                <span key={i} className="absolute top-1/2 h-2 w-px -translate-x-1/2 -translate-y-1/2 bg-line-3" style={{ left: `${(i / n) * 100}%` }} />
              ))}
            </div>
          )}
          <BaseSlider.Indicator className={cn('rounded-full transition-colors duration-(--dur-fast)', fillClassName)} />
          <BaseSlider.Thumb
            aria-label={aria['aria-label']}
            className={cn(
              'group/thumb size-4 rounded-full bg-fg-1 ring-2 ring-canvas outline-none',
              'transition-transform duration-(--dur-spring-snappy) ease-spring-snappy data-[dragging]:scale-115',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
            )}
          >
            {bubble && (
              <AnimatePresence>
                {dragging && (
                  <motion.span
                    initial={{ opacity: 0, y: 4, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, transition: tween('fast', 'in') }}
                    transition={spring.snappy}
                    className="glass pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 rounded-sm border border-line-3 px-2 py-0.5 text-stat-sm text-fg-1"
                  >
                    {bubble(value)}
                  </motion.span>
                )}
              </AnimatePresence>
            )}
          </BaseSlider.Thumb>
        </BaseSlider.Track>
      </BaseSlider.Control>
    </BaseSlider.Root>
  );
}

const RPE_WORDS: Record<number, string> = {
  1: 'Very easy',
  2: 'Easy',
  3: 'Easy',
  4: 'Steady',
  5: 'Moderate',
  6: 'Moderate',
  7: 'Hard',
  8: 'Very hard',
  9: 'Very hard',
  10: 'Max',
};
const rpeFill = (v: number) => (v <= 2 ? 'bg-z2' : v <= 4 ? 'bg-z3' : v <= 6 ? 'bg-z4' : v <= 8 ? 'bg-z5' : 'bg-z7');

export interface RpeSliderProps {
  value: number | null;
  onValueChange: (value: number) => void;
  onValueCommitted?: (value: number) => void;
  label?: ReactNode;
  className?: string;
  disabled?: boolean;
}

/** RPE 1–10. Copy per product.md §8.9: 1 "Very easy", 4 "Steady", 7 "Hard", 10 "Max". */
export function RpeSlider({ value, onValueChange, onValueCommitted, label = 'RPE', className, disabled }: RpeSliderProps) {
  const v = value ?? 5;
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Slider
        value={v}
        onValueChange={onValueChange}
        onValueCommitted={onValueCommitted}
        min={1}
        max={10}
        step={1}
        largeStep={2}
        ticks
        label={label}
        valueLabel={
          value == null ? (
            <span className="text-fg-3">—</span>
          ) : (
            <span>
              {value} <span className="font-sans text-body-sm text-fg-3">{RPE_WORDS[value]}</span>
            </span>
          )
        }
        fillClassName={rpeFill(v)}
        disabled={disabled}
        aria-label="Rate of perceived exertion"
        bubble={(x) => x}
      />
      <div className="grid grid-cols-4 text-micro text-fg-3" aria-hidden>
        <span>Easy</span>
        <span className="text-center">Moderate</span>
        <span className="text-center">Hard</span>
        <span className="text-right">Max</span>
      </div>
    </div>
  );
}
