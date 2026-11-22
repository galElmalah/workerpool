/**
 * Card — DESIGN_V2 §4/§5: a `surface-1` fill, NO border, radius lg, padding 24 (20 on mobile).
 * Header row (`title-3` + actions, optional fg-3 eyebrow), body, optional footer (16px gap, no rule).
 *
 *  - Static cards are flat: no spotlight, no hover. Use a card only when the group is acted on as a
 *    unit or must hold together; otherwise group with whitespace (a <Section> on the canvas).
 *  - `interactive` (link / clickable cards): hover = one surface step + a neutral pointer spotlight.
 *  - `selected`: surface-3 fill (a surface step — never a ring, rail or accent).
 *  - `level={2}`: the rare nested grouping INSIDE a card — a quiet `surface-2` well (radius md,
 *    padding 16, no header chrome). Never put a level-1 card inside a card.
 *
 *   <Card title="Fitness" actions={<IconButton …/>}>…</Card>
 *   <Card interactive onClick={open}>…</Card>
 */
import type { ComponentProps, ReactNode, Ref } from 'react';
import { cn } from '@/lib/cn';
import { onSpotlightMove } from '@/motion/pointer';

export interface CardProps extends Omit<ComponentProps<'div'>, 'title'> {
  title?: ReactNode;
  /** Short fg-3 line above the title (sentence case). */
  eyebrow?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  /** Neutral pointer-tracked edge glow. Default: on for `interactive` cards only. `'accent'` is
   *  accepted for compatibility and renders the same neutral glow (no accent glows in v2). */
  spotlight?: boolean | 'accent';
  selected?: boolean;
  /** Interactive cards get a hover surface step (use for link cards). */
  interactive?: boolean;
  /** 'md' = 24 (20 mobile, default) · 'sm' = 16 · 'none'. */
  padding?: 'none' | 'sm' | 'md';
  level?: 1 | 2;
  ref?: Ref<HTMLDivElement>;
}

export function Card({
  title,
  eyebrow,
  actions,
  footer,
  spotlight,
  selected,
  interactive,
  padding = 'md',
  level = 1,
  className,
  children,
  onPointerMove,
  ...rest
}: CardProps) {
  const hasHead = !!(title || actions || eyebrow);
  const nested = level === 2;
  const spot = (spotlight ?? !!interactive) !== false && !nested;
  // Explicit sides so responsive paddings never override each other.
  const pad = nested ? 'sm' : padding;
  const px = pad === 'sm' ? 'px-4' : 'px-5 md:px-6';
  const pt = pad === 'sm' ? 'pt-4' : 'pt-5 md:pt-6';
  const pb = pad === 'sm' ? 'pb-4' : 'pb-5 md:pb-6';
  return (
    <div
      className={cn(
        'relative min-w-0',
        nested ? 'rounded-md bg-surface-2' : 'rounded-lg bg-surface-1',
        spot && 'spotlight',
        selected && (nested ? 'bg-surface-3' : '!bg-surface-3'),
        interactive && !selected && (nested ? 'transition-colors duration-(--dur-fast) hover:bg-surface-3' : 'transition-colors duration-(--dur-fast) hover:bg-surface-2'),
        className,
      )}
      onPointerMove={
        spot
          ? (e) => {
              onSpotlightMove(e);
              onPointerMove?.(e);
            }
          : onPointerMove
      }
      {...rest}
    >
      {hasHead && (
        <div className={cn('flex items-start justify-between gap-3', padding === 'none' ? 'px-5 pt-5 pb-4 md:px-6' : [px, pt])}>
          <div className="min-w-0">
            {eyebrow && <div className="mb-1 text-body-sm text-fg-3">{eyebrow}</div>}
            {title && <h3 className="truncate text-title-3 text-fg-1">{title}</h3>}
          </div>
          {actions && <div className="-my-1 -mr-1 flex shrink-0 items-center gap-1">{actions}</div>}
        </div>
      )}
      <div className={cn(padding !== 'none' && [px, pb, hasHead ? 'pt-4' : pt])}>{children}</div>
      {footer && (
        <div className={cn(padding === 'none' ? 'border-t border-line-1 px-5 py-3 md:px-6' : [px, pb, '-mt-1'])}>{footer}</div>
      )}
    </div>
  );
}
