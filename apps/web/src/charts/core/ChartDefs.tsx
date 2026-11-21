/**
 * Shared SVG paint servers (design.md §2.4). Every chart renders its own <ChartDefs> with a
 * per-instance prefix (ids must be unique per document and must survive one chart being
 * display:none), and references them through the object returned by `useChartDefs()`.
 */
import { useId, useMemo } from 'react';
import { T } from './tokens';

export interface ChartDefIds {
  prefix: string;
  /** `url(#…)` references */
  hatchAccent: string;
  hatchFg: string;
  hatchFgDense: string;
  hatchOnAccent: string;
  dotsFg: string;
  dashesFg: string;
  fadeAccent: string;
  fadeFg: string;
  /** raw id generator for chart-local clipPaths etc. */
  id: (name: string) => string;
}

export function useChartDefs(): ChartDefIds {
  const raw = useId();
  return useMemo(() => {
    const prefix = `c${raw.replace(/[^a-zA-Z0-9]/g, '')}`;
    const id = (n: string) => `${prefix}-${n}`;
    const url = (n: string) => `url(#${id(n)})`;
    return {
      prefix,
      id,
      hatchAccent: url('hatch-accent'),
      hatchFg: url('hatch-fg'),
      hatchFgDense: url('hatch-fg-dense'),
      hatchOnAccent: url('hatch-on-accent'),
      dotsFg: url('dots-fg'),
      dashesFg: url('dashes-fg'),
      fadeAccent: url('fade-accent'),
      fadeFg: url('fade-fg'),
    };
  }, [raw]);
}

export function ChartDefs({ ids }: { ids: ChartDefIds }) {
  const { id } = ids;
  return (
    <defs>
      <pattern id={id('hatch-accent')} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="1.5" height="5" style={{ fill: T.accent }} />
      </pattern>
      <pattern id={id('hatch-fg')} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="1" height="5" style={{ fill: T.fg3 }} />
      </pattern>
      <pattern id={id('hatch-fg-dense')} width="3.5" height="3.5" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
        <rect width="1" height="3.5" style={{ fill: T.fg2 }} />
      </pattern>
      <pattern id={id('hatch-on-accent')} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="1" height="4" style={{ fill: T.onAccent, opacity: 0.2 }} />
      </pattern>
      <pattern id={id('dots-fg')} width="4" height="4" patternUnits="userSpaceOnUse">
        <circle cx="2" cy="2" r="0.9" style={{ fill: T.fg2 }} />
      </pattern>
      <pattern id={id('dashes-fg')} width="6" height="4" patternUnits="userSpaceOnUse">
        <rect x="0" y="1.5" width="3" height="1" style={{ fill: T.fg2 }} />
      </pattern>
      <linearGradient id={id('fade-accent')} x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" style={{ stopColor: T.accent, stopOpacity: 0.28 }} />
        <stop offset="1" style={{ stopColor: T.accent, stopOpacity: 0 }} />
      </linearGradient>
      <linearGradient id={id('fade-fg')} x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" style={{ stopColor: T.fg1, stopOpacity: 0.14 }} />
        <stop offset="1" style={{ stopColor: T.fg1, stopOpacity: 0 }} />
      </linearGradient>
    </defs>
  );
}

/**
 * Monochrome sport ramp (product.md §3.6.4 adapted to tokens): fill + optional pattern.
 * In light theme the gray ramp inverts, so bike becomes the darkest — still ordered.
 */
export type SportKey = 'bike' | 'run' | 'swim' | 'row' | 'strength' | 'other';
export const SPORT_RAMP: Record<SportKey, { fill: string; pattern?: 'hatch' | 'dots'; label: string }> = {
  bike: { fill: T.gray(12), label: 'RIDE' },
  run: { fill: T.gray(11), label: 'RUN' },
  swim: { fill: T.gray(9), label: 'SWIM' },
  row: { fill: T.gray(8), label: 'ROW' },
  strength: { fill: T.gray(7), pattern: 'hatch', label: 'STR' },
  other: { fill: T.gray(6), pattern: 'dots', label: 'OTHER' },
};
export const SPORT_ORDER: SportKey[] = ['bike', 'run', 'swim', 'row', 'strength', 'other'];
/** Map any domain Sport to a ramp slot (hike/walk/yoga/ski/other share "other"). */
export function sportKey(s: string): SportKey {
  return s === 'bike' || s === 'run' || s === 'swim' || s === 'row' || s === 'strength' ? s : 'other';
}
