/**
 * Segmented control — design.md §7 / §5.4f. 2–5 options, a `layoutId` thumb that glides between
 * items (snappy), arrow-key navigation (Base UI ToggleGroup). Single selection; it can't be emptied.
 *
 *   <Segmented aria-label="Range" value={range} onValueChange={setRange}
 *     options={[{ value: '6w', label: '6W' }, { value: '3m', label: '3M' }]} />
 */
import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { LayoutGroup, motion } from 'motion/react';
import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { spring } from '@/motion/tokens';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  /** Accessible label when `label` is an icon only. */
  'aria-label'?: string;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  size?: 'sm' | 'md';
  /** Stretch options to fill the container width. */
  block?: boolean;
  className?: string;
  'aria-label': string;
}

export function Segmented<T extends string>({ value, onValueChange, options, size = 'md', block, className, ...aria }: SegmentedProps<T>) {
  const id = useId();
  return (
    <LayoutGroup id={id}>
      <ToggleGroup
        value={[value]}
        onValueChange={(v) => {
          const next = v[0] as T | undefined;
          if (next != null && next !== value) onValueChange(next);
        }}
        aria-label={aria['aria-label']}
        className={cn(
          'relative inline-flex items-center gap-0.5 rounded-md border border-line-1 bg-surface-2 p-0.5',
          block ? 'flex w-full' : 'w-fit',
          className,
        )}
      >
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Toggle
              key={o.value}
              value={o.value}
              disabled={o.disabled}
              aria-label={o['aria-label']}
              className={cn(
                'relative z-0 inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] text-label',
                'text-fg-2 transition-colors duration-(--dur-fast) hover:text-fg-1 data-[pressed]:text-fg-1',
                'focus-visible:outline-offset-0 disabled:opacity-40 [&_svg]:size-3.5',
                size === 'sm' ? 'h-6 px-2.5' : 'h-7 px-3',
                block && 'flex-1',
              )}
            >
              {on && (
                <motion.span
                  layoutId="seg-thumb"
                  transition={spring.snappy}
                  className="absolute inset-0 -z-10 rounded-[8px] border border-line-1 bg-surface-active inset-shadow-hairline light:border-line-2 light:bg-surface-1"
                  aria-hidden
                />
              )}
              {o.icon}
              {o.label}
            </Toggle>
          );
        })}
      </ToggleGroup>
    </LayoutGroup>
  );
}
