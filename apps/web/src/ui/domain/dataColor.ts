/**
 * Data colour vocabularies (DESIGN_V2 §8). The ONLY place that maps domain values to the data
 * colour tokens in app.css, so a sport / zone / status keeps one colour everywhere.
 *
 *   sport   → `--color-sport-*`  (glyph tint, ≤ 14% tint behind a completed card, stacked volume)
 *   zone    → `--color-z1..z7`   (intensity dot, step profiles, time in zones, zone tables)
 *   status  → `--color-good|warn|serious|critical` (always with an icon or a word)
 *   series  → `--color-series-1..3` (Fitness, Fatigue, Form; then any multi-series chart in order)
 *
 * Text never wears these colours: values and labels stay `fg-*`, the coloured mark sits beside them.
 */
import type { ComplianceState, IntensityClass, Sport } from '@cadence/core';
import type { CSSProperties } from 'react';

/** Fixed categorical order (stacks, legends, breakdowns): the order the palette was validated in. */
export const SPORT_STACK_ORDER: readonly Sport[] = ['bike', 'run', 'swim', 'walk', 'strength', 'hike', 'row', 'ski', 'yoga', 'other'];

const SPORT_VAR: Record<Sport, string> = {
  bike: 'var(--color-sport-bike)',
  run: 'var(--color-sport-run)',
  swim: 'var(--color-sport-swim)',
  walk: 'var(--color-sport-walk)',
  strength: 'var(--color-sport-strength)',
  hike: 'var(--color-sport-hike)',
  row: 'var(--color-sport-row)',
  ski: 'var(--color-sport-ski)',
  yoga: 'var(--color-sport-yoga)',
  other: 'var(--color-sport-other)',
};

/** CSS colour (a `var(--color-sport-*)` reference) for a sport; unknown sports are neutral. */
export const sportColor = (sport: Sport | string | null | undefined): string => SPORT_VAR[(sport ?? 'other') as Sport] ?? SPORT_VAR.other;

/** Sort comparator for the fixed sport order. */
export const bySportOrder = (a: Sport | string, b: Sport | string) => {
  const ia = SPORT_STACK_ORDER.indexOf(a as Sport);
  const ib = SPORT_STACK_ORDER.indexOf(b as Sport);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
};

/** Sets `--sport` for the `bg-sport-tint*` utilities (app.css) on a card or chip. */
export const sportVars = (sport: Sport | string | null | undefined): CSSProperties => ({ '--sport': sportColor(sport) }) as CSSProperties;

/** Intensity class → training zone (recovery z1 … race z6). */
export const INTENSITY_ZONE: Record<IntensityClass, 1 | 2 | 3 | 4 | 5 | 6> = {
  recovery: 1,
  endurance: 2,
  tempo: 3,
  threshold: 4,
  high: 5,
  race: 6,
};

/** CSS colour for zone 1..7 (clamped). */
export const zoneColor = (z: number): string => `var(--color-z${Math.min(7, Math.max(1, Math.round(z)))})`;

/** CSS colour for an intensity class (its zone). */
export const intensityColor = (c: IntensityClass): string => zoneColor(INTENSITY_ZONE[c]);

/**
 * Zone for a 0..1 relative intensity (fraction of threshold / max on a step profile). Breakpoints
 * follow the usual %FTP bands so a 0.9 effort reads as threshold and a 1.2 sprint as anaerobic.
 */
export const zoneOfFraction = (v: number): number => (v < 0.2 ? 1 : v < 0.4 ? 2 : v < 0.55 ? 3 : v < 0.7 ? 4 : v < 0.85 ? 5 : v < 0.95 ? 6 : 7);

export type StatusTone = 'good' | 'warn' | 'serious' | 'critical' | 'neutral';

export const STATUS_COLOR: Record<StatusTone, string> = {
  good: 'var(--color-good)',
  warn: 'var(--color-warn)',
  serious: 'var(--color-serious)',
  critical: 'var(--color-critical)',
  neutral: 'var(--color-fg-3)',
};

/** Compliance → status tone: on plan = good, partial / way off = warn, missed = critical, rest neutral. */
export function complianceTone(state: ComplianceState | null | undefined): StatusTone {
  switch (state) {
    case 'on_target':
      return 'good';
    case 'partial_short':
    case 'partial_long':
    case 'off_short':
    case 'off_long':
      return 'warn';
    case 'missed':
      return 'critical';
    default:
      return 'neutral';
  }
}

/** Chart series (DESIGN_V2 §8.4): Fitness, Fatigue, Form — and any multi-series chart, in order. */
export const SERIES = ['var(--color-series-1)', 'var(--color-series-2)', 'var(--color-series-3)'] as const;
