/**
 * Small building blocks shared by onboarding and settings (kept identical in both feature folders
 * because feature folders never import each other): wordmark, passphrase field with strength,
 * threshold metadata + the big editable threshold number.
 */
import type { ThresholdKind } from '@cadence/core/domain';
import { Eye, EyeOff } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useId, useState, type ReactNode, type Ref } from 'react';
import { cn } from '@/lib/cn';
import { formatNumber, paceParts, parsePace, weightParts } from '@/lib/format';
import { KG_PER_LB, paceBasis, type UnitPrefs } from '@/lib/units';
import { spring } from '@/motion/tokens';

// ───────────── wordmark ─────────────
export function Wordmark({ className }: { className?: string }) {
  return <span className={cn('select-none text-[1.0625rem] font-[600] tracking-[-0.03em] text-fg-1', className)}>cadence</span>;
}

// ───────────── passphrase ─────────────
export function passphraseStrength(p: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (!p) return { score: 0, label: 'At least 8 characters' };
  if (p.length < 8) return { score: 1, label: `${8 - p.length} more character${8 - p.length === 1 ? '' : 's'}` };
  let variety = 0;
  if (/[a-z]/.test(p)) variety++;
  if (/[A-Z]/.test(p)) variety++;
  if (/\d/.test(p)) variety++;
  if (/[^a-zA-Z0-9]/.test(p)) variety++;
  const words = p.trim().split(/[\s\-_.]+/).filter(Boolean).length;
  const points = (p.length >= 12 ? 1 : 0) + (p.length >= 16 ? 1 : 0) + (variety >= 3 ? 1 : 0) + (words >= 3 ? 1 : 0);
  if (points >= 2) return { score: 4, label: 'Strong' };
  if (points === 1) return { score: 3, label: 'Good' };
  return { score: 2, label: 'Fair — longer is stronger' };
}

export function PassphraseInput({
  value,
  onChange,
  autoComplete,
  placeholder = '••••••••••',
  invalid,
  autoFocus,
  id,
  inputRef,
  disabled,
  'aria-describedby': describedBy,
}: {
  value: string;
  onChange: (v: string) => void;
  autoComplete: 'new-password' | 'current-password';
  placeholder?: string;
  invalid?: boolean;
  autoFocus?: boolean;
  id?: string;
  inputRef?: Ref<HTMLInputElement>;
  disabled?: boolean;
  'aria-describedby'?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative flex items-center">
      <input
        id={id}
        ref={inputRef}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        spellCheck={false}
        autoCapitalize="off"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={cn(
          'h-11 w-full rounded-md border border-line-3 bg-surface-2 pl-3.5 pr-11 text-body-lg text-fg-1 outline-none placeholder:text-fg-4',
          'transition-[border-color] duration-(--dur-fast) hover:border-gray-8 focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-focus',
          'aria-[invalid=true]:border-dashed aria-[invalid=true]:border-fg-1 disabled:opacity-40',
          !show && value && 'tracking-[0.12em]',
        )}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Hide passphrase' : 'Show passphrase'}
        aria-pressed={show}
        className="absolute right-1.5 flex size-8 items-center justify-center rounded-sm text-fg-3 transition-colors duration-(--dur-fast) hover:bg-surface-3 hover:text-fg-1"
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

export function StrengthMeter({ value, id }: { value: string; id?: string }) {
  const s = passphraseStrength(value);
  return (
    <div className="flex items-center gap-3" id={id} aria-live="polite">
      <div className="flex flex-1 gap-1" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className="relative h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
            <motion.span
              className={cn('absolute inset-0 origin-left rounded-full', s.score >= 4 ? 'bg-accent' : 'bg-fg-2')}
              initial={false}
              animate={{ scaleX: s.score >= i ? 1 : 0 }}
              transition={spring.snappy}
            />
          </span>
        ))}
      </div>
      <span className={cn('w-44 text-right text-body-sm', s.score >= 4 ? 'text-accent-ink' : 'text-fg-3')}>{s.label}</span>
    </div>
  );
}

// ───────────── thresholds ─────────────
export type ValueKind = 'W' | 'bpm' | 'pace' | 'kg';
export interface ThresholdMeta {
  kind: ThresholdKind;
  label: string;
  /** Which sport the onboarding/zones editor writes for this kind. */
  sport: 'bike' | 'run' | 'swim' | 'row' | 'all';
  value: ValueKind;
  paceSport?: 'run' | 'swim';
  explain: string;
  fallback: string;
}

export const THRESHOLD_META: Record<ThresholdKind, ThresholdMeta> = {
  ftp: { kind: 'ftp', label: 'FTP', sport: 'bike', value: 'W', explain: 'The power you can hold for about an hour. Sets ride zones and ride load.', fallback: '175 W until you set it' },
  run_threshold: {
    kind: 'run_threshold',
    label: 'Run threshold pace',
    sport: 'run',
    value: 'pace',
    paceSport: 'run',
    explain: 'Your best pace for roughly an hour, about 10K–half-marathon effort.',
    fallback: 'Run load falls back to heart rate',
  },
  swim_css: {
    kind: 'swim_css',
    label: 'Swim CSS',
    sport: 'swim',
    value: 'pace',
    paceSport: 'swim',
    explain: 'Critical swim speed, from a 400 m and a 200 m time trial.',
    fallback: 'Swim load falls back to heart rate',
  },
  row_threshold: { kind: 'row_threshold', label: 'Row threshold', sport: 'row', value: 'W', explain: 'Erg power you can sustain for about an hour.', fallback: 'Row load falls back to heart rate' },
  lthr: { kind: 'lthr', label: 'Threshold HR', sport: 'all', value: 'bpm', explain: 'Heart rate at lactate threshold. Sets heart-rate zones for every sport.', fallback: '90% of max HR' },
  hr_max: { kind: 'hr_max', label: 'Max HR', sport: 'all', value: 'bpm', explain: 'The highest heart rate you have seen in an all-out effort.', fallback: 'Estimated from your age' },
  hr_rest: { kind: 'hr_rest', label: 'Resting HR', sport: 'all', value: 'bpm', explain: 'Morning heart rate before getting up. Used for readiness trends.', fallback: '60 bpm' },
  weight: { kind: 'weight', label: 'Weight', sport: 'all', value: 'kg', explain: 'Used for W/kg and as a fallback for FTP.', fallback: 'Not set' },
};

/** Value ↔ text for a threshold kind in the athlete's units. */
export function thresholdText(meta: ThresholdMeta, v: number | null | undefined, units: UnitPrefs): string {
  if (v == null || !(v > 0)) return '';
  if (meta.value === 'pace') return paceParts(v, meta.paceSport, units).value;
  if (meta.value === 'kg') return weightParts(v, units).value;
  return formatNumber(v, 0);
}
export function thresholdUnit(meta: ThresholdMeta, units: UnitPrefs): string {
  if (meta.value === 'pace') return paceBasis(meta.paceSport ?? 'run', units).label;
  if (meta.value === 'kg') return units.system === 'imperial' ? 'lb' : 'kg';
  return meta.value;
}
export function parseThreshold(meta: ThresholdMeta, text: string, units: UnitPrefs): number | null {
  const t = text.trim();
  if (!t) return null;
  if (meta.value === 'pace') return parsePace(t, meta.paceSport, units);
  const n = Number(t.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (meta.value === 'kg') return units.system === 'imperial' ? n * KG_PER_LB : n;
  return Math.round(n);
}

/**
 * A big, directly editable threshold number (stat-md type, tabular). Commits on blur/Enter;
 * ↑/↓ step by one unit (pace: one second faster/slower).
 */
export function BigThresholdInput({
  meta,
  value,
  onCommit,
  units,
  size = 'md',
  label,
  aside,
}: {
  meta: ThresholdMeta;
  value: number | null;
  onCommit: (v: number | null) => void;
  units: UnitPrefs;
  size?: 'md' | 'lg';
  label?: ReactNode;
  aside?: ReactNode;
}) {
  const id = useId();
  const [text, setText] = useState(thresholdText(meta, value, units));
  const [editing, setEditing] = useState(false);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    if (!editing) setText(thresholdText(meta, value, units));
  }, [value, editing, meta, units]);

  const commit = () => {
    setEditing(false);
    const v = parseThreshold(meta, text, units);
    if (!text.trim()) {
      setBad(false);
      onCommit(null);
      return;
    }
    if (v == null) return setBad(true);
    setBad(false);
    setText(thresholdText(meta, v, units));
    onCommit(v);
  };
  const stepBy = (dir: 1 | -1, big: boolean) => {
    const cur = parseThreshold(meta, text, units) ?? value;
    if (cur == null) return;
    let next: number;
    if (meta.value === 'pace') {
      const basis = paceBasis(meta.paceSport ?? 'run', units);
      const secs = basis.meters / cur - dir * (big ? 5 : 1);
      next = basis.meters / Math.max(1, secs);
    } else if (meta.value === 'kg') next = cur + dir * (big ? 1 : 0.1) * (units.system === 'imperial' ? KG_PER_LB * 10 : 1);
    else next = cur + dir * (big ? 5 : 1);
    setText(thresholdText(meta, next, units));
    onCommit(next);
  };

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {(label || aside) && (
        <div className="flex items-baseline justify-between gap-2">
          {label && (
            <label htmlFor={id} className="text-micro uppercase text-fg-3">
              {label}
            </label>
          )}
          {aside}
        </div>
      )}
      <div
        className={cn(
          'group/big flex items-baseline gap-1.5 rounded-md border border-transparent px-2 -mx-2 transition-colors duration-(--dur-fast)',
          'hover:border-line-2 hover:bg-surface-2 focus-within:border-line-3 focus-within:bg-surface-2',
          bad && 'border-dashed !border-fg-1',
        )}
      >
        <span className="inline-grid">
          <span aria-hidden className={cn('invisible col-start-1 row-start-1 whitespace-pre py-1 pr-0.5 tabular-nums', size === 'lg' ? 'text-stat-lg' : 'text-stat-md')}>
            {text || (meta.value === 'pace' ? (meta.paceSport === 'swim' ? '1:45' : '4:30') : '—')}
          </span>
          <input
            id={id}
            value={text}
            inputMode={meta.value === 'pace' ? 'text' : 'decimal'}
            autoComplete="off"
            spellCheck={false}
            placeholder={meta.value === 'pace' ? (meta.paceSport === 'swim' ? '1:45' : '4:30') : '—'}
            aria-invalid={bad || undefined}
            aria-label={typeof label === 'string' ? label : meta.label}
            onFocus={(e) => {
              setEditing(true);
              e.currentTarget.select();
            }}
            onChange={(e) => setText(e.currentTarget.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                setText(thresholdText(meta, value, units));
                setBad(false);
                e.currentTarget.blur();
              }
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                stepBy(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey);
              }
            }}
            size={1}
            className={cn('col-start-1 row-start-1 w-0 min-w-full bg-transparent py-1 tabular-nums text-fg-1 outline-none placeholder:text-fg-4', size === 'lg' ? 'text-stat-lg' : 'text-stat-md')}
          />
        </span>
        <span className={cn('shrink-0 text-fg-3', size === 'lg' ? 'text-title-3' : 'text-body')}>{thresholdUnit(meta, units)}</span>
      </div>
      {bad && <span className="text-body-sm text-fg-1">{meta.value === 'pace' ? 'Use m:ss, e.g. 4:30' : 'Enter a number'}</span>}
    </div>
  );
}

/** Source chip for a threshold value: manual / garmin / estimated / default. */
export function SourceChip({ source }: { source: 'manual' | 'garmin' | 'estimated' | 'default' }) {
  const label = source === 'manual' ? 'Manual' : source === 'garmin' ? 'Garmin' : source === 'estimated' ? 'Estimated' : 'Default';
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-xs border px-1.5 text-micro uppercase',
        source === 'garmin' && 'border-line-3 bg-surface-3 text-fg-1',
        source === 'manual' && 'border-line-2 text-fg-2',
        source === 'estimated' && 'border-dashed border-line-3 text-fg-2',
        source === 'default' && 'border-dashed border-line-2 text-fg-3',
      )}
    >
      {label}
    </span>
  );
}
