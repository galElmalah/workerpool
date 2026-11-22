/**
 * Compact, keyboard-first inline editors for the step list: text that parses on commit, ↑/↓
 * nudges live (Shift ×5 — the profile animates while you hold the key), Enter commits, Esc reverts.
 */
import type { Sport, Step, StepMeasure, Target, ThresholdSnapshot } from '@cadence/core';
import { fmtClock, targetShort } from '@cadence/core/workout';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { formatPace, paceParts, parseDuration, parsePace, EN_DASH } from '@/lib/format';
import type { UnitPrefs } from '@/lib/units';

export interface MiniFieldProps<V> {
  value: V;
  format: (v: V) => string;
  parse: (s: string) => V | null;
  onCommit: (v: V) => void;
  nudge?: (v: V, dir: 1 | -1, big: boolean) => V;
  className?: string;
  width?: string;
  label: string;
  suffix?: ReactNode;
  placeholder?: string;
  align?: 'left' | 'right';
}

/** Inline mono input; shows formatted value, parses on blur / Enter. */
export function MiniField<V>({ value, format, parse, onCommit, nudge, className, width = 'w-16', label, suffix, placeholder, align = 'right' }: MiniFieldProps<V>) {
  const [text, setText] = useState(() => format(value));
  const [bad, setBad] = useState(false);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setText(format(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const commit = () => {
    editing.current = false;
    const v = parse(text);
    if (v == null) {
      setBad(true);
      return;
    }
    setBad(false);
    setText(format(v));
    if (format(v) !== format(value)) onCommit(v);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      (e.currentTarget as HTMLInputElement).select();
    } else if (e.key === 'Escape') {
      setText(format(value));
      setBad(false);
      e.currentTarget.blur();
    } else if (nudge && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const cur = parse(text) ?? value;
      const next = nudge(cur, e.key === 'ArrowUp' ? 1 : -1, e.shiftKey);
      setText(format(next));
      setBad(false);
      onCommit(next);
    }
  };
  return (
    <span className={cn('relative inline-flex items-center', className)}>
      <input
        aria-label={label}
        value={text}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={bad || undefined}
        onFocus={(e) => {
          editing.current = true;
          e.currentTarget.select();
        }}
        onChange={(e) => setText(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={onKey}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'h-7 rounded-sm border border-transparent bg-transparent px-1.5 font-mono text-mono text-fg-1 outline-none transition-colors duration-(--dur-fast)',
          'hover:border-line-2 hover:bg-surface-2 focus:border-line-3 focus:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-focus',
          'aria-[invalid=true]:border-dashed aria-[invalid=true]:border-fg-1',
          align === 'right' ? 'text-right' : 'text-left',
          width,
        )}
      />
      {suffix && <span className="pointer-events-none ml-0.5 text-body-sm text-fg-3">{suffix}</span>}
    </span>
  );
}

// ───────────────────────── measure ─────────────────────────

export function formatMeters(m: number, sport: Sport, units: UnitPrefs): string {
  if (sport === 'swim') return units.swim === 'yd' ? `${Math.round(m / 0.9144)} yd` : `${Math.round(m)} m`;
  if (sport === 'row' || m < 1000) return `${Math.round(m)} m`;
  if (units.system === 'imperial') return `${+(m / 1609.344).toFixed(2)} mi`;
  return `${+(m / 1000).toFixed(2)} km`;
}

export function parseMeters(s: string, sport: Sport): number | null {
  const m = s.trim().toLowerCase().replace(',', '.').match(/^(\d+(?:\.\d+)?)\s*(m|km|k|mi|y|yd)?$/);
  if (!m) return null;
  const n = +m[1];
  if (!(n > 0)) return null;
  const u = m[2];
  if (u === 'km' || u === 'k') return Math.round(n * 1000);
  if (u === 'mi') return Math.round(n * 1609.344);
  if (u === 'y' || u === 'yd') return Math.round(n * 0.9144 * 100) / 100;
  if (u === 'm') return n;
  // bare number: swim/row metres; run/others km when small
  if (sport === 'swim' || sport === 'row') return n;
  return n < 100 ? Math.round(n * 1000) : n;
}

const nudgeSec = (v: number, dir: 1 | -1, big: boolean) => {
  const step = big ? 60 : v < 120 ? 5 : 15;
  return Math.max(5, Math.round((v + dir * step) / step) * step);
};
const nudgeM = (sport: Sport) => (v: number, dir: 1 | -1, big: boolean) => {
  const step = sport === 'swim' ? (big ? 100 : 25) : sport === 'row' ? (big ? 500 : 100) : big ? 1000 : v < 2000 ? 100 : 500;
  return Math.max(step, Math.round((v + dir * step) / step) * step);
};

export function MeasureField({ step, sport, units, onChange }: { step: Step; sport: Sport; units: UnitPrefs; onChange: (m: StepMeasure) => void }) {
  const m = step.measure;
  if (m.type === 'time')
    return (
      <MiniField
        label="Duration"
        value={m.sec}
        format={(v) => fmtClock(v)}
        parse={(s) => {
          const v = parseDuration(s, { twoPart: 'm:ss' });
          return v && v > 0 ? v : null;
        }}
        nudge={nudgeSec}
        onCommit={(sec) => onChange({ type: 'time', sec })}
      />
    );
  if (m.type === 'distance')
    return <MiniField label="Distance" value={m.m} width="w-20" format={(v) => formatMeters(v, sport, units)} parse={(s) => parseMeters(s, sport)} nudge={nudgeM(sport)} onCommit={(v) => onChange({ type: 'distance', m: v })} />;
  if (m.type === 'reps') return <MiniField label="Reps" value={m.n} width="w-12" format={(v) => String(v)} parse={(s) => (+s > 0 ? Math.round(+s) : null)} nudge={(v, d) => Math.max(1, v + d)} onCommit={(n) => onChange({ type: 'reps', n })} suffix="reps" />;
  return <span className="inline-flex h-7 w-16 items-center justify-end px-1.5 font-mono text-mono text-fg-2">lap</span>;
}

// ───────────────────────── targets ─────────────────────────

const r0 = (x: number) => Math.round(x);

/** Absolute equivalent of a relative target ("262–276 W", "4:05–4:12 /km", "152–160 bpm"). */
export function targetAbsolute(t: Target | undefined, sport: Sport, th: ThresholdSnapshot, units: UnitPrefs): string | null {
  if (!t) return null;
  const powerThr = sport === 'row' ? th.rowThresholdW : th.ftp;
  const speedThr = sport === 'swim' ? th.swimCssMps : sport === 'run' ? th.runThresholdMps : undefined;
  const rng = (a: string, b: string) => (a === b ? a : `${a}${EN_DASH}${b}`);
  switch (t.type) {
    case 'power_pct':
      return powerThr ? `${rng(String(r0((t.low / 100) * powerThr)), String(r0((t.high / 100) * powerThr)))} W` : null;
    case 'power_w':
      return powerThr ? `${rng(String(r0((100 * t.low) / powerThr)), String(r0((100 * t.high) / powerThr)))}%` : null;
    case 'pace_pct':
      return speedThr ? paceRange((t.high / 100) * speedThr, (t.low / 100) * speedThr, sport, units) : null;
    case 'pace':
      return speedThr ? `${rng(String(r0((100 * t.lowMps) / speedThr)), String(r0((100 * t.highMps) / speedThr)))}%` : null;
    case 'hr_pct_lthr':
      return th.lthr ? `${rng(String(r0((t.low / 100) * th.lthr)), String(r0((t.high / 100) * th.lthr)))} bpm` : null;
    case 'hr_zone': {
      if (!th.lthr) return null;
      const Z: Record<number, [number, number]> = { 1: [0, 81], 2: [81, 89], 3: [90, 93], 4: [94, 99], 5: [100, 106] };
      const [a, b] = Z[t.zone] ?? [0, 0];
      return `${rng(String(r0((a / 100) * th.lthr)), String(r0((b / 100) * th.lthr)))} bpm`;
    }
    case 'ramp':
      if (t.basis === 'power_pct' && powerThr) return `${r0((t.from / 100) * powerThr)}→${r0((t.to / 100) * powerThr)} W`;
      if (t.basis === 'pace_pct' && speedThr) return `${formatPace((t.from / 100) * speedThr, sport, units)}→${formatPace((t.to / 100) * speedThr, sport, units)}`;
      return null;
    default:
      return null;
  }
}

/** "4:05–4:12 /km" (fast first, unit once). */
export function paceRange(fastMps: number, slowMps: number, sport: Sport, units: UnitPrefs): string {
  const a = paceParts(fastMps, sport, units);
  const b = paceParts(slowMps, sport, units);
  return a.value === b.value ? `${a.value} ${a.unit}` : `${a.value}${EN_DASH}${b.value} ${b.unit}`;
}

export function targetLabel(t: Target | undefined, sport: Sport, units: UnitPrefs): string {
  if (!t) return 'open';
  if (t.type === 'pace') return paceRange(t.highMps, t.lowMps, sport, units);
  return targetShort(t, sport, units.system);
}

/** Shift a target by `d` percentage points (pace by ~1 %): powers the ↑/↓ nudge on the chip. */
export function nudgeTarget(t: Target, d: number): Target {
  switch (t.type) {
    case 'power_pct':
    case 'pace_pct':
    case 'hr_pct_lthr':
      return { ...t, low: Math.max(1, t.low + d), high: Math.max(1, t.high + d) };
    case 'power_w':
      return { ...t, low: Math.max(5, t.low + d * 5), high: Math.max(5, t.high + d * 5) };
    case 'hr_bpm':
      return { ...t, low: t.low + d, high: t.high + d };
    case 'rpe': {
      const s = Math.sign(d);
      return { ...t, low: Math.min(10, Math.max(1, t.low + s)), high: Math.min(10, Math.max(1, t.high + s)) };
    }
    case 'hr_zone':
      return { ...t, zone: Math.min(5, Math.max(1, t.zone + Math.sign(d))) };
    case 'pace':
      return { ...t, lowMps: +(t.lowMps * (1 + d / 100)).toFixed(4), highMps: +(t.highMps * (1 + d / 100)).toFixed(4) };
    case 'ramp':
      return { ...t, to: Math.max(1, t.to + d) };
    default:
      return t;
  }
}

/** "88-94" / "95" → [low, high]. */
export function parseRange(s: string): [number, number] | null {
  const m = s.trim().replace(/[–—]/g, '-').match(/^(\d+(?:\.\d+)?)\s*(?:-\s*(\d+(?:\.\d+)?))?\s*%?$/);
  if (!m) return null;
  const a = +m[1];
  const b = m[2] !== undefined ? +m[2] : a;
  return [Math.min(a, b), Math.max(a, b)];
}
export const fmtRange = ([a, b]: [number, number]) => (a === b ? String(a) : `${a}${EN_DASH}${b}`);

export function parsePaceRange(s: string, sport: Sport, units: UnitPrefs): [number, number] | null {
  const parts = s.replace(/[–—]/g, '-').split(/\s*-\s*(?=\d+:)/);
  const a = parsePace(parts[0] ?? '', sport, units);
  const b = parts[1] ? parsePace(parts[1], sport, units) : a;
  if (!a || !b) return null;
  return [Math.min(a, b), Math.max(a, b)];
}
