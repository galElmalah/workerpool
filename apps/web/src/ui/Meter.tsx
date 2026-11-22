/**
 * ProgressBar / Meter — thin bar on surface-3 with an accent (or fg) fill, an optional TARGET tick
 * and an optional ghost segment (done + remaining planned, product.md §3.2). The fill animates with
 * scaleX (transform only, smooth spring).
 *
 *   <Meter label="Hours" value={9.7} max={11.5} target={12} ghost={11.5} format={(v) => …} />
 */
import { Meter as BaseMeter } from '@base-ui/react/meter';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { spring } from '@/motion/tokens';

export interface MeterProps {
  value: number;
  max: number;
  /** Target tick position (same scale as value). Hidden when undefined. */
  target?: number;
  /** Ghost extent (e.g. done + remaining planned). */
  ghost?: number;
  label?: ReactNode;
  /** Right side of the label row. */
  valueLabel?: ReactNode;
  tone?: 'accent' | 'fg';
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  'aria-label'?: string;
}

export function Meter({ value, max, target, ghost, label, valueLabel, tone = 'accent', size = 'sm', className, ...aria }: MeterProps) {
  const scaleMax = Math.max(max, target ?? 0, ghost ?? 0, value, 1e-9);
  const pct = (v: number) => Math.max(0, Math.min(1, v / scaleMax));
  const h = size === 'xs' ? 'h-0.5' : size === 'sm' ? 'h-1' : 'h-1.5';
  return (
    <BaseMeter.Root value={value} max={scaleMax} aria-label={aria['aria-label']} className={cn('flex w-full flex-col gap-1.5', className)}>
      {(label || valueLabel) && (
        <div className="flex items-baseline justify-between gap-3">
          {label && <BaseMeter.Label className="text-micro text-fg-3">{label}</BaseMeter.Label>}
          {valueLabel && <span className="text-mono text-fg-1">{valueLabel}</span>}
        </div>
      )}
      <BaseMeter.Track className={cn('relative w-full overflow-visible rounded-full bg-surface-3', h)}>
        {ghost != null && ghost > value && (
          <motion.span
            className="absolute inset-y-0 left-0 w-full origin-left rounded-full border border-dashed border-line-3 bg-hatch-faint"
            initial={false}
            animate={{ scaleX: pct(ghost) }}
            transition={spring.smooth}
            aria-hidden
          />
        )}
        <motion.span
          className={cn('absolute inset-y-0 left-0 w-full origin-left rounded-full', tone === 'accent' ? 'bg-accent' : 'bg-fg-1')}
          initial={false}
          animate={{ scaleX: pct(value) }}
          transition={spring.smooth}
          aria-hidden
        />
        {target != null && (
          <span
            className="absolute -top-1 -bottom-1 w-px bg-fg-1"
            style={{ left: `calc(${pct(target) * 100}% - 0.5px)` }}
            aria-hidden
          />
        )}
      </BaseMeter.Track>
    </BaseMeter.Root>
  );
}

export const ProgressBar = Meter;
