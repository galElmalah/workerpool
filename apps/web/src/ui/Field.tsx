/**
 * Field / Input / Textarea — DESIGN_V2 §2/§4.
 * Label (`label` 12 medium, fg-2) above; control h-9, radius md, px-3, `body`: surface-2 fill + a
 * line-2 hairline in dark, white + line-3 in light (the hairline is what identifies the control;
 * it is the one place besides tables where a border is expected). Hover → line-3; focus = 2px focus
 * ring inside the field; invalid = TriangleAlert + message + dashed fg-2 hairline. Never red, never
 * a coloured edge.
 *
 *   <Field label="Title" hint="Shown on the calendar" error={err}>
 *     <Input value={v} onChange={…} />
 *   </Field>
 */
import { Field as BaseField } from '@base-ui/react/field';
import { Input as BaseInput } from '@base-ui/react/input';
import { TriangleAlert } from 'lucide-react';
import { useLayoutEffect, useRef, type ComponentProps, type ReactNode, type Ref } from 'react';
import { cn } from '@/lib/cn';

export interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Visually hide the label (still announced). */
  hideLabel?: boolean;
  /** Content shown at the right of the label row (e.g. a unit toggle or "Optional"). */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
  name?: string;
  disabled?: boolean;
}

export function Field({ label, hint, error, hideLabel, aside, className, children, name, disabled }: FieldProps) {
  return (
    <BaseField.Root invalid={!!error} name={name} disabled={disabled} className={cn('group/field flex min-w-0 flex-col gap-1.5', className)}>
      {(label || aside) && (
        <div className={cn('flex items-baseline justify-between gap-3', hideLabel && 'sr-only')}>
          {label && <BaseField.Label className="text-label text-fg-2">{label}</BaseField.Label>}
          {aside && <span className="text-body-sm text-fg-3">{aside}</span>}
        </div>
      )}
      {children}
      {error ? (
        <BaseField.Error match className="flex items-center gap-1.5 text-body-sm text-fg-1">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
          {error}
        </BaseField.Error>
      ) : hint ? (
        <BaseField.Description className="text-body-sm text-fg-3">{hint}</BaseField.Description>
      ) : null}
    </BaseField.Root>
  );
}

/** Shared control surface (inputs, select triggers, combobox input groups). */
export const controlStyles = (size: 'sm' | 'md' | 'lg' = 'md') =>
  cn(
    'w-full min-w-0 rounded-md border border-line-2 bg-surface-2 text-body text-fg-1 outline-none light:border-line-3 light:bg-surface-1',
    'transition-[border-color,background-color] duration-(--dur-fast) ease-out placeholder:text-fg-4',
    'hover:border-line-3 light:hover:border-gray-8 focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-focus',
    'data-[invalid]:border-dashed data-[invalid]:border-fg-2 aria-[invalid=true]:border-dashed aria-[invalid=true]:border-fg-2',
    'disabled:opacity-40 data-[disabled]:opacity-40 pointer-coarse:min-h-11 pointer-coarse:text-body-lg',
    size === 'sm' ? 'h-7 px-2.5 text-body-sm' : size === 'lg' ? 'h-11 px-3.5 text-body-lg' : 'h-9 px-3',
  );

export interface InputProps extends Omit<ComponentProps<'input'>, 'size'> {
  size?: 'sm' | 'md' | 'lg';
  /** Leading adornment (icon) rendered inside the field. */
  leading?: ReactNode;
  /** Trailing adornment (unit, kbd, clear button). */
  trailing?: ReactNode;
  ref?: Ref<HTMLInputElement>;
}

export function Input({ size = 'md', leading, trailing, className, ...rest }: InputProps) {
  if (!leading && !trailing) return <BaseInput className={cn(controlStyles(size), className)} {...rest} />;
  return (
    <div className="relative flex w-full items-center">
      {leading && <span className="pointer-events-none absolute left-3 flex text-fg-3 [&_svg]:size-4">{leading}</span>}
      <BaseInput className={cn(controlStyles(size), leading && 'pl-9', trailing && 'pr-10', className)} {...rest} />
      {trailing && <span className="absolute right-2.5 flex items-center text-body-sm text-fg-3">{trailing}</span>}
    </div>
  );
}

export interface TextareaProps extends ComponentProps<'textarea'> {
  /** Grow with content (CSS field-sizing where supported, JS fallback otherwise). */
  autosize?: boolean;
  minRows?: number;
  maxRows?: number;
  ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea({ autosize = true, minRows = 3, maxRows = 16, className, ref, onInput, ...rest }: TextareaProps) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const resize = () => {
    const el = inner.current;
    if (!el || !autosize) return;
    el.style.height = 'auto';
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
    const pad = 16;
    const max = maxRows * lh + pad;
    el.style.height = `${Math.min(el.scrollHeight + 2, max)}px`;
    el.style.overflowY = el.scrollHeight + 2 > max ? 'auto' : 'hidden';
  };
  useLayoutEffect(resize);
  return (
    <BaseField.Control
      render={
        <textarea
          ref={(el) => {
            inner.current = el;
            if (typeof ref === 'function') ref(el);
            else if (ref) ref.current = el;
          }}
          rows={minRows}
          onInput={(e) => {
            resize();
            onInput?.(e);
          }}
          className={cn(controlStyles('md'), 'h-auto resize-none px-3 py-2 leading-5', className)}
          {...rest}
        />
      }
    />
  );
}
