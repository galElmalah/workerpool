/**
 * Card — design.md §7: surface-1, line-2, radius lg, p-4 (p-5 at xl), pointer-tracked spotlight.
 * Header row (title-3 + actions), body, optional footer separated by a line-1 divider.
 * Selected = 1px fg-1 inset ring. Hover NEVER lifts or casts a shadow (surface step only).
 *
 *   <Card title="Fitness" actions={<IconButton …/>} spotlight>…</Card>
 */
import type { ComponentProps, ReactNode, Ref } from 'react';
import { cn } from '@/lib/cn';
import { onSpotlightMove } from '@/motion/pointer';

export interface CardProps extends Omit<ComponentProps<'div'>, 'title'> {
  title?: ReactNode;
  /** Micro-caps line above the title. */
  eyebrow?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  /** Pointer-tracked border glow (default true). `accent` = key/today cards only. */
  spotlight?: boolean | 'accent';
  selected?: boolean;
  /** Interactive cards get a hover surface step (use for link cards). */
  interactive?: boolean;
  padding?: 'none' | 'sm' | 'md';
  level?: 1 | 2;
  ref?: Ref<HTMLDivElement>;
}

export function Card({
  title,
  eyebrow,
  actions,
  footer,
  spotlight = true,
  selected,
  interactive,
  padding = 'md',
  level = 1,
  className,
  children,
  onPointerMove,
  ...rest
}: CardProps) {
  const pad = padding === 'none' ? '' : padding === 'sm' ? 'p-3' : 'p-4 xl:p-5';
  return (
    <div
      className={cn(
        'relative min-w-0 rounded-lg border border-line-2',
        level === 1 ? 'bg-surface-1' : 'bg-surface-2 inset-shadow-hairline',
        spotlight && 'spotlight',
        spotlight === 'accent' && 'spotlight-accent',
        selected && 'ring-1 ring-fg-1 ring-inset',
        interactive && 'transition-colors duration-(--dur-fast) hover:bg-surface-2',
        className,
      )}
      onPointerMove={
        spotlight
          ? (e) => {
              onSpotlightMove(e);
              onPointerMove?.(e);
            }
          : onPointerMove
      }
      {...rest}
    >
      {(title || actions || eyebrow) && (
        <div className={cn('flex items-start justify-between gap-3', pad, padding !== 'none' && 'pb-0')}>
          <div className="min-w-0">
            {eyebrow && <div className="mb-1 text-micro uppercase text-fg-3">{eyebrow}</div>}
            {title && <h3 className="truncate text-title-3 text-fg-1">{title}</h3>}
          </div>
          {actions && <div className="-my-1 -mr-1 flex shrink-0 items-center gap-1">{actions}</div>}
        </div>
      )}
      <div className={cn(pad, (title || actions || eyebrow) && padding !== 'none' && 'pt-3')}>{children}</div>
      {footer && <div className={cn('border-t border-line-1', padding === 'none' ? '' : 'px-4 py-3 xl:px-5')}>{footer}</div>}
    </div>
  );
}
