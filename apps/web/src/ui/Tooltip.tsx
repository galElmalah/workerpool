/**
 * Tooltip — glass, radius sm, px-2 py-1, body-sm, optional kbd, no arrow. 400ms open delay, 0
 * when moving between triggers (shared <TooltipProvider> mounted at the root in main.tsx).
 * Supplementary only: never put essential information in a tooltip (touch users never see it).
 */
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import type { ReactElement, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Kbd } from './Kbd';

export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <BaseTooltip.Provider delay={400} closeDelay={0}>
    {children}
  </BaseTooltip.Provider>
);

export interface TooltipProps {
  content: ReactNode;
  /** Shortcut spec shown at the right ('g c', 'mod+k'). */
  kbd?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  /** The trigger element (must accept a ref and props: a DOM element or a forwardRef component). */
  children: ReactElement;
  disabled?: boolean;
  className?: string;
  sideOffset?: number;
}

export function Tooltip({ content, kbd, side = 'top', align = 'center', children, disabled, className, sideOffset = 8 }: TooltipProps) {
  if (disabled || content == null) return children;
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} align={align} sideOffset={sideOffset} collisionPadding={8} className="z-(--z-popover)">
          <BaseTooltip.Popup
            className={cn(
              'ui-tooltip flex max-w-[min(20rem,var(--available-width))] items-center gap-2 rounded-sm px-2 py-1 text-body-sm text-fg-1',
              className,
            )}
          >
            <span>{content}</span>
            {kbd && <Kbd keys={kbd} />}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
