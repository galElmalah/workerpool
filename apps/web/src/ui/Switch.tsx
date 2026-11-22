/**
 * Switch + Checkbox — design.md §7 / §5.4h.
 * Switch: borderless track 32×20 (gray → accent: "on" is a current selection), 16px thumb that moves
 * with `layout` + snappy. Checkbox: 16px, monochrome — an fg-4 hairline (≥ 3:1, it identifies the
 * control) → fg-1 fill with a canvas check drawn with a snappy pathLength.
 */
import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { Switch as BaseSwitch } from '@base-ui/react/switch';
import { motion } from 'motion/react';
import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { spring } from '@/motion/tokens';

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  name?: string;
}

export function Switch({ checked, onCheckedChange, label, description, disabled, className, name, ...aria }: SwitchProps) {
  const id = useId();
  const control = (
    <BaseSwitch.Root
      id={id}
      name={name}
      checked={checked}
      onCheckedChange={(c) => onCheckedChange(c)}
      disabled={disabled}
      aria-label={aria['aria-label']}
      className={cn(
        'relative inline-flex h-5 w-8 shrink-0 items-center rounded-full bg-gray-7 p-0.5 light:bg-gray-7',
        'transition-[background-color] duration-(--dur-fast) ease-out',
        'data-[checked]:justify-end data-[checked]:bg-accent',
        'data-[disabled]:opacity-40 focus-visible:outline-offset-2',
      )}
    >
      <BaseSwitch.Thumb
        render={<motion.span layout transition={spring.snappy} />}
        className="block size-4 rounded-full bg-fg-1 light:bg-white"
      />
    </BaseSwitch.Root>
  );
  if (!label) return control;
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <label htmlFor={id} className="flex min-w-0 flex-col gap-0.5">
        <span className="text-body text-fg-1">{label}</span>
        {description && <span className="text-body-sm text-fg-3">{description}</span>}
      </label>
      <div className="pt-0.5">{control}</div>
    </div>
  );
}

export interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: ReactNode;
  indeterminate?: boolean;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  name?: string;
}

export function Checkbox({ checked, onCheckedChange, label, indeterminate, disabled, className, name, ...aria }: CheckboxProps) {
  const box = (
    <BaseCheckbox.Root
      name={name}
      checked={checked}
      indeterminate={indeterminate}
      onCheckedChange={(c) => onCheckedChange(c)}
      disabled={disabled}
      aria-label={label ? undefined : aria['aria-label']}
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-xs border border-fg-4 bg-transparent text-canvas',
        'transition-[background-color,border-color] duration-(--dur-fast)',
        'data-[checked]:border-fg-1 data-[checked]:bg-fg-1 data-[indeterminate]:border-fg-1 data-[indeterminate]:bg-fg-1',
        'hover:border-fg-4 data-[disabled]:opacity-40 focus-visible:outline-offset-2',
      )}
    >
      <BaseCheckbox.Indicator keepMounted className="flex">
        <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {indeterminate ? (
            <motion.path d="M3 6h6" initial={false} animate={{ pathLength: 1 }} />
          ) : (
            <motion.path d="M2.5 6.2 5 8.5l4.5-5" initial={false} animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }} transition={spring.snappy} />
          )}
        </svg>
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );
  if (!label) return box;
  return (
    <label className={cn('inline-flex select-none items-center gap-2 text-body text-fg-1', disabled && 'opacity-40', className)}>
      {box}
      {label}
    </label>
  );
}
