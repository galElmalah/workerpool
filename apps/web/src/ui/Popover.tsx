/**
 * Popover — SMALL PICKERS ONLY (date, sport, intensity, time; ≤ 320px wide). Glass, line-2,
 * radius lg, p-2; origin-aware scale .96 → 1 (smooth spring CSS); Esc / outside click closes.
 * Anything bigger is a page.
 *
 *   <Popover trigger={<Button>Intensity</Button>}>{(close) => <IntensityPicker … onChange={close} />}</Popover>
 */
import { Popover as BasePopover } from '@base-ui/react/popover';
import { useState, type ReactElement, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface PopoverProps {
  trigger: ReactElement;
  children: ReactNode | ((close: () => void) => ReactNode);
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  /** Accessible title (visually hidden unless `showTitle`). */
  title?: string;
  showTitle?: boolean;
  openOnHover?: boolean;
}

export function Popover({ trigger, children, side = 'bottom', align = 'start', open, onOpenChange, className, title, showTitle, openOnHover }: PopoverProps) {
  const [inner, setInner] = useState(false);
  const isOpen = open ?? inner;
  const set = (v: boolean) => {
    setInner(v);
    onOpenChange?.(v);
  };
  return (
    <BasePopover.Root open={isOpen} onOpenChange={(v) => set(v)}>
      <BasePopover.Trigger render={trigger} openOnHover={openOnHover} />
      <BasePopover.Portal>
        <BasePopover.Positioner side={side} align={align} sideOffset={8} collisionPadding={12} className="z-(--z-popover)">
          <BasePopover.Popup className={cn('ui-popup max-h-(--available-height) max-w-[min(20rem,var(--available-width))] overflow-y-auto overscroll-contain rounded-lg p-2', className)}>
            {title && <BasePopover.Title className={showTitle ? 'px-1 pb-2 text-label font-normal text-fg-3' : 'sr-only'}>{title}</BasePopover.Title>}
            {typeof children === 'function' ? children(() => set(false)) : children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}
