/**
 * DeltaBadge — arrow, sign and weight carry the direction; colour only when the caller knows what
 * the direction means (DESIGN_V2 §8.3). The number always stays in text colour.
 *  up (≥ +1%):  ↗ +12%  weight 500, fg-1
 *  down:        ↘ −8%   weight 400, fg-2
 *  flat:        → ±0%   weight 400, fg-3
 *  good:        the arrow turns `good` (the caller says this direction is good)
 *  bad:         the arrow turns `warn` (the caller says this direction is bad)
 *  warning:     ⚠ +18%  500, fg-1, value dotted-underlined, the ⚠ in `warn`
 * The arrow is one glyph rotated between directions, so a changing delta morphs (smooth spring).
 */
import { ArrowRight, TriangleAlert } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '@/lib/cn';
import { deltaDirection, formatPercent, formatSigned, type DeltaDirection } from '@/lib/format';
import { spring } from '@/motion/tokens';

export interface DeltaBadgeProps {
  /** Fraction (0.12 = +12%) when `kind` is 'percent' (default); absolute number when 'number'. */
  value: number | null | undefined;
  kind?: 'percent' | 'number';
  decimals?: number;
  /** |value| below this is flat (default 0.01 for percent, 0.5 for number). */
  flatBelow?: number;
  /** The shown direction is good (e.g. fitness up): arrow in the `good` status colour. */
  good?: boolean;
  /** The shown direction is bad (e.g. pace slower): arrow in the `warn` status colour. */
  bad?: boolean;
  warning?: boolean;
  /** Trailing context ("vs last wk"). */
  suffix?: string;
  size?: 'sm' | 'md';
  className?: string;
}

const ROT: Record<DeltaDirection, number> = { up: -45, down: 45, flat: 0 };

export function DeltaBadge({ value, kind = 'percent', decimals = 0, flatBelow, good, bad, warning, suffix, size = 'md', className }: DeltaBadgeProps) {
  if (value == null || !Number.isFinite(value)) return <span className={cn('text-label text-fg-4', className)}>—</span>;
  const dir = deltaDirection(value, flatBelow ?? (kind === 'percent' ? 0.01 : 0.5));
  const text =
    kind === 'percent'
      ? dir === 'flat'
        ? '±0%'
        : formatPercent(value, { signed: true, decimals })
      : dir === 'flat'
        ? '±0'
        : formatSigned(value, decimals);
  const tone = warning || dir === 'up' ? 'text-fg-1 font-medium' : dir === 'down' ? 'text-fg-2 font-normal' : 'text-fg-3 font-normal';
  const icon = size === 'sm' ? 'size-3' : 'size-3.5';
  return (
    <span className={cn('inline-flex items-center gap-0.5 whitespace-nowrap', size === 'sm' ? 'text-label' : 'text-body-sm', tone, className)}>
      {warning ? (
        <TriangleAlert className={cn(icon, 'shrink-0 text-warn')} aria-hidden />
      ) : (
        <motion.span initial={false} animate={{ rotate: ROT[dir] }} transition={spring.smooth} className={cn('inline-flex shrink-0', dir !== 'flat' && good && 'text-good', dir !== 'flat' && !good && bad && 'text-warn')} aria-hidden>
          <ArrowRight className={icon} strokeWidth={2} />
        </motion.span>
      )}
      <span className={cn('num', warning && 'underline decoration-fg-3 decoration-dotted underline-offset-3')}>{text}</span>
      {suffix && <span className="ml-1 font-normal text-fg-3">{suffix}</span>}
      <span className="sr-only">{dir === 'up' ? 'increase' : dir === 'down' ? 'decrease' : 'no change'}</span>
    </span>
  );
}
