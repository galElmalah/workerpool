/**
 * Combobox — searchable single select (workout library search, exercise picker). Base UI Combobox
 * with the default substring filter, or pass `items` already filtered + `onInputChange` for async.
 *
 *   <Combobox label="Template" items={templates} value={tpl} onValueChange={setTpl}
 *     itemToLabel={(t) => t.title} itemToKey={(t) => t.id} renderItem={(t) => <>…</>} />
 */
import { Combobox as BaseCombobox } from '@base-ui/react/combobox';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Field, controlStyles } from './Field';
import { popupItem } from './Select';

export interface ComboboxProps<T> {
  items: readonly T[];
  value: T | null;
  onValueChange: (value: T | null) => void;
  itemToLabel: (item: T) => string;
  itemToKey: (item: T) => string;
  renderItem?: (item: T) => ReactNode;
  /** Controlled query for async sources (disable the built-in filter by pre-filtering `items`). */
  onInputChange?: (query: string) => void;
  /** Set false when `items` are already filtered (async search). */
  filter?: boolean;
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  hideLabel?: boolean;
  placeholder?: string;
  empty?: ReactNode;
  className?: string;
  disabled?: boolean;
}

export function Combobox<T>({
  items,
  value,
  onValueChange,
  itemToLabel,
  itemToKey,
  renderItem,
  onInputChange,
  filter = true,
  label,
  hint,
  error,
  hideLabel,
  placeholder = 'Search…',
  empty = 'No matches',
  className,
  disabled,
}: ComboboxProps<T>) {
  return (
    <Field label={label} hint={hint} error={error} hideLabel={hideLabel} className={className} disabled={disabled}>
      <BaseCombobox.Root<T>
        items={items as T[]}
        value={value}
        onValueChange={(v) => onValueChange((v as T | null) ?? null)}
        itemToStringLabel={itemToLabel}
        isItemEqualToValue={(a, b) => itemToKey(a) === itemToKey(b)}
        onInputValueChange={onInputChange ? (q) => onInputChange(q) : undefined}
        filter={filter ? undefined : null}
        disabled={disabled}
      >
        <BaseCombobox.InputGroup className={cn(controlStyles('md'), 'relative flex items-center px-0 focus-within:outline-2 focus-within:outline-offset-[-1px] focus-within:outline-focus')}>
          <BaseCombobox.Input placeholder={placeholder} className="h-full min-w-0 flex-1 bg-transparent pl-3 text-body text-fg-1 outline-none placeholder:text-fg-4" />
          <BaseCombobox.Clear className="flex size-7 items-center justify-center text-fg-3 hover:text-fg-1" aria-label="Clear">
            <X className="size-3.5" />
          </BaseCombobox.Clear>
          <BaseCombobox.Trigger className="flex size-7 items-center justify-center pr-1 text-fg-3" aria-label="Show options">
            <ChevronsUpDown className="size-3.5" />
          </BaseCombobox.Trigger>
        </BaseCombobox.InputGroup>
        <BaseCombobox.Portal>
          <BaseCombobox.Positioner sideOffset={6} className="z-(--z-popover) outline-none">
            <BaseCombobox.Popup className="ui-popup w-[var(--anchor-width)] max-w-[var(--available-width)] rounded-lg p-1">
              <BaseCombobox.Empty className="px-2 py-3 text-body-sm text-fg-3 empty:p-0">{empty}</BaseCombobox.Empty>
              <BaseCombobox.List className="max-h-[min(20rem,var(--available-height))] overflow-y-auto overscroll-contain outline-0">
                {(item: T) => (
                  <BaseCombobox.Item key={itemToKey(item)} value={item} className={popupItem}>
                    <span className="min-w-0 flex-1 truncate">{renderItem ? renderItem(item) : itemToLabel(item)}</span>
                    <BaseCombobox.ItemIndicator className="flex text-fg-1">
                      <Check className="size-3.5" />
                    </BaseCombobox.ItemIndicator>
                  </BaseCombobox.Item>
                )}
              </BaseCombobox.List>
            </BaseCombobox.Popup>
          </BaseCombobox.Positioner>
        </BaseCombobox.Portal>
      </BaseCombobox.Root>
    </Field>
  );
}
