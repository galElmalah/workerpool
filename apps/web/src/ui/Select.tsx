/**
 * Select — trigger styled like an input + ChevronsUpDown; glass popup (radius lg), items h-8,
 * highlighted item on surface-3, check on the selected one. Base UI Select (typeahead, keyboard).
 *
 *   <Select label="Sport" value={sport} onValueChange={setSport}
 *     options={SPORTS.map((s) => ({ value: s, label: SPORT_META[s].label, icon: <SportGlyph sport={s} /> }))} />
 */
import { Select as BaseSelect } from '@base-ui/react/select';
import { Check, ChevronsUpDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Field, controlStyles } from './Field';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}

export interface SelectProps<T extends string> {
  value: T | null;
  onValueChange: (value: T) => void;
  options: readonly SelectOption<T>[];
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  hideLabel?: boolean;
  placeholder?: string;
  size?: 'sm' | 'md';
  className?: string;
  disabled?: boolean;
  name?: string;
}

export const popupItem =
  'relative flex h-8 cursor-default select-none items-center gap-2 rounded-sm px-2 text-body text-fg-1 outline-none ' +
  'transition-colors duration-(--dur-fast) data-[highlighted]:bg-surface-3 data-[disabled]:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0';

export function Select<T extends string>({
  value,
  onValueChange,
  options,
  label,
  hint,
  error,
  hideLabel,
  placeholder = 'Select…',
  size = 'md',
  className,
  disabled,
  name,
}: SelectProps<T>) {
  const selected = options.find((o) => o.value === value);
  return (
    <Field label={label} hint={hint} error={error} hideLabel={hideLabel} className={className} name={name} disabled={disabled}>
      <BaseSelect.Root
        value={value}
        onValueChange={(v) => v != null && onValueChange(v as T)}
        items={options.map((o) => ({ value: o.value, label: o.label }))}
        disabled={disabled}
      >
        <BaseSelect.Trigger className={cn(controlStyles(size), 'flex items-center gap-2 text-left data-[popup-open]:border-gray-8')}>
          {selected?.icon && <span className="flex text-fg-2 [&_svg]:size-4">{selected.icon}</span>}
          <BaseSelect.Value className={cn('min-w-0 flex-1 truncate', !selected && 'text-fg-4')} placeholder={placeholder} />
          <BaseSelect.Icon className="flex text-fg-3">
            <ChevronsUpDown className="size-3.5" />
          </BaseSelect.Icon>
        </BaseSelect.Trigger>
        <BaseSelect.Portal>
          <BaseSelect.Positioner sideOffset={6} alignItemWithTrigger={false} className="z-(--z-popover) outline-none">
            <BaseSelect.Popup className="ui-popup max-h-[min(22rem,var(--available-height))] min-w-[var(--anchor-width)] overflow-y-auto rounded-lg p-1">
              <BaseSelect.List>
                {options.map((o) => (
                  <BaseSelect.Item key={o.value} value={o.value} disabled={o.disabled} className={popupItem}>
                    {o.icon && <span className="flex text-fg-2">{o.icon}</span>}
                    <BaseSelect.ItemText className="flex-1 truncate">{o.label}</BaseSelect.ItemText>
                    {o.hint && <span className="text-body-sm text-fg-3">{o.hint}</span>}
                    <BaseSelect.ItemIndicator className="flex text-fg-1">
                      <Check className="size-3.5" />
                    </BaseSelect.ItemIndicator>
                  </BaseSelect.Item>
                ))}
              </BaseSelect.List>
            </BaseSelect.Popup>
          </BaseSelect.Positioner>
        </BaseSelect.Portal>
      </BaseSelect.Root>
    </Field>
  );
}
