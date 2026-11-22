/**
 * Numeric entry — design.md §7 "NumberField with units".
 *  - <NumberField>: [−] value (mono, right-aligned) unit [+]; steppers appear on hover/focus;
 *    drag the label to scrub (ew-resize). Base UI NumberField.
 *  - <DurationField>: seconds in, smart text parsing ("1:05:00", "65m", "1h5", "90s").
 *  - <PaceField>: m/s in, per-sport pace text ("4:05" /km, "1:45" /100m, "1:52.4" /500m).
 * Both text fields step with ↑/↓ (Shift = ×5) and commit on blur/Enter.
 */
import { NumberField as BaseNumberField } from '@base-ui/react/number-field';
import { Input as BaseInput } from '@base-ui/react/input';
import { Minus, Plus } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { formatDuration, paceParts, parseDuration, parsePace, type DurationStyle } from '@/lib/format';
import { paceBasis, useUnits } from '@/lib/units';
import { Field, controlStyles } from './Field';

interface Common {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  hideLabel?: boolean;
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
  name?: string;
  placeholder?: string;
  id?: string;
}

export interface NumberFieldProps extends Common {
  value: number | null;
  onValueChange: (value: number | null) => void;
  unit?: ReactNode;
  min?: number;
  max?: number;
  step?: number;
  largeStep?: number;
  format?: Intl.NumberFormatOptions;
  /** Drag on the label to change the value (default true when a label is shown). */
  scrub?: boolean;
}

const stepBtn =
  'flex h-full w-7 shrink-0 items-center justify-center text-fg-3 opacity-0 transition-opacity duration-(--dur-fast) ' +
  'hover:text-fg-1 group-hover/nf:opacity-100 group-focus-within/nf:opacity-100 pointer-coarse:opacity-100 [&_svg]:size-3.5';

export function NumberField({
  value,
  onValueChange,
  unit,
  min,
  max,
  step = 1,
  largeStep,
  format,
  scrub = true,
  label,
  hint,
  error,
  hideLabel,
  size = 'md',
  disabled,
  className,
  name,
  placeholder,
  id,
}: NumberFieldProps) {
  return (
    <BaseNumberField.Root
      value={value}
      onValueChange={(v) => onValueChange(v)}
      min={min}
      max={max}
      step={step}
      largeStep={largeStep ?? step * 10}
      format={format}
      locale="en-GB"
      disabled={disabled}
      name={name}
      id={id}
      className={cn('flex min-w-0 flex-col gap-1.5', className)}
    >
      {label && (
        <div className={cn('flex', hideLabel && 'sr-only')}>
          {scrub ? (
            <BaseNumberField.ScrubArea className="cursor-ew-resize select-none text-label text-fg-2" pixelSensitivity={2}>
              <label>{label}</label>
              <BaseNumberField.ScrubAreaCursor className="drop-shadow-none">
                <span className="block h-3 w-4 rounded-xs border border-line-3 bg-surface-3" />
              </BaseNumberField.ScrubAreaCursor>
            </BaseNumberField.ScrubArea>
          ) : (
            <label className="text-label text-fg-2">{label}</label>
          )}
        </div>
      )}
      <BaseNumberField.Group
        className={cn(
          controlStyles(size),
          'group/nf flex items-center gap-0 px-0 focus-within:outline-2 focus-within:outline-offset-[-1px] focus-within:outline-focus',
          error && 'border-dashed border-fg-1',
        )}
      >
        <BaseNumberField.Decrement className={stepBtn} aria-label="Decrease">
          <Minus />
        </BaseNumberField.Decrement>
        <BaseNumberField.Input
          placeholder={placeholder}
          className="h-full min-w-0 flex-1 bg-transparent text-right text-mono text-fg-1 outline-none placeholder:text-fg-4"
        />
        {unit && <span className="pl-1.5 text-body-sm text-fg-3">{unit}</span>}
        <BaseNumberField.Increment className={stepBtn} aria-label="Increase">
          <Plus />
        </BaseNumberField.Increment>
      </BaseNumberField.Group>
      {error ? (
        <span className="text-body-sm text-fg-1">{error}</span>
      ) : hint ? (
        <span className="text-body-sm text-fg-3">{hint}</span>
      ) : null}
    </BaseNumberField.Root>
  );
}

interface TextValueProps<V> extends Common {
  value: V | null;
  onValueChange: (value: V | null) => void;
  format: (v: V) => string;
  parse: (text: string) => V | null;
  step: (v: V, dir: 1 | -1, big: boolean) => V;
  unit?: ReactNode;
  invalidMessage: string;
}

function TextValueField<V>({
  value,
  onValueChange,
  format,
  parse,
  step,
  unit,
  invalidMessage,
  label,
  hint,
  error,
  hideLabel,
  size = 'md',
  disabled,
  className,
  name,
  placeholder,
  id,
}: TextValueProps<V>) {
  const [text, setText] = useState(value == null ? '' : format(value));
  const [bad, setBad] = useState(false);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(value == null ? '' : format(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    if (!text.trim()) {
      setBad(false);
      if (value != null) onValueChange(null);
      return;
    }
    const v = parse(text);
    if (v == null) {
      setBad(true);
      return;
    }
    setBad(false);
    setText(format(v));
    onValueChange(v);
  };

  return (
    <Field label={label} hint={hint} error={error ?? (bad ? invalidMessage : undefined)} hideLabel={hideLabel} className={className} name={name} disabled={disabled}>
      <div className="relative flex items-center">
        <BaseInput
          id={id}
          value={text}
          placeholder={placeholder}
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={bad || !!error || undefined}
          onFocus={() => setEditing(true)}
          onChange={(e) => setText(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setText(value == null ? '' : format(value));
              setBad(false);
            }
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const cur = parse(text) ?? value;
              if (cur == null) return;
              const next = step(cur, e.key === 'ArrowUp' ? 1 : -1, e.shiftKey);
              setText(format(next));
              setBad(false);
              onValueChange(next);
            }
          }}
          className={cn(controlStyles(size), 'text-right text-mono', unit ? 'pr-14' : '')}
        />
        {unit && <span className="pointer-events-none absolute right-3 text-body-sm text-fg-3">{unit}</span>}
      </div>
    </Field>
  );
}

export interface DurationFieldProps extends Common {
  /** Seconds. */
  value: number | null;
  onValueChange: (seconds: number | null) => void;
  /** Display style: 'hms' (1:05:00, default) or 'clock' (h:mm). */
  display?: Extract<DurationStyle, 'hms' | 'clock'>;
  /** How "4:30" is read: 'h:mm' (default for workout durations) or 'm:ss' (intervals). */
  twoPart?: 'h:mm' | 'm:ss';
  /** Arrow-key step in seconds (default 60; Shift = ×5). */
  stepSec?: number;
}

export function DurationField({ display = 'hms', twoPart = 'h:mm', stepSec = 60, ...rest }: DurationFieldProps) {
  return (
    <TextValueField<number>
      {...rest}
      format={(v) => formatDuration(v, display)}
      parse={(t) => parseDuration(t, { twoPart })}
      step={(v, dir, big) => Math.max(0, v + dir * stepSec * (big ? 5 : 1))}
      placeholder={rest.placeholder ?? (display === 'hms' ? '1:00:00' : '1:00')}
      invalidMessage="Try 1:05:00, 65m or 1h5"
    />
  );
}

export interface PaceFieldProps extends Common {
  /** Speed in m/s (the domain unit). */
  value: number | null;
  onValueChange: (mps: number | null) => void;
  sport?: string;
}

export function PaceField({ sport = 'run', ...rest }: PaceFieldProps) {
  const units = useUnits();
  const basis = paceBasis(sport, units);
  return (
    <TextValueField<number>
      {...rest}
      unit={basis.label}
      format={(v) => paceParts(v, sport, units).value}
      parse={(t) => parsePace(t, sport, units)}
      step={(v, dir, big) => {
        // ↑ = faster pace (1 s less per unit)
        const secs = basis.meters / v - dir * (big ? 5 : 1) * (sport === 'row' ? 0.5 : 1);
        return basis.meters / Math.max(1, secs);
      }}
      placeholder={rest.placeholder ?? (sport === 'row' ? '2:00.0' : sport === 'swim' ? '1:45' : '4:30')}
      invalidMessage={sport === 'row' ? 'Use m:ss.s per 500 m' : 'Use m:ss'}
    />
  );
}
