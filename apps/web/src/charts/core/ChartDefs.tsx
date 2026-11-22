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
  /** ≤ 12% fade under the series-1 line (Fitness, power). */
  fadeSeries1: string;
  /** ≤ 12% fade under a series-3 line (pace). */
  fadeSeries3: string;
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
      fadeSeries1: url('fade-series-1'),
      fadeSeries3: url('fade-series-3'),
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
        <rect width="1" height="5" style={{ fill: T.fg4 }} />
      </pattern>
      <pattern id={id('hatch-fg-dense')} width="3.5" height="3.5" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
        <rect width="1" height="3.5" style={{ fill: T.fg4 }} />
      </pattern>
      <pattern id={id('hatch-on-accent')} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="1" height="4" style={{ fill: T.onAccent, opacity: 0.2 }} />
      </pattern>
      <pattern id={id('dots-fg')} width="4" height="4" patternUnits="userSpaceOnUse">
        <circle cx="2" cy="2" r="0.75" style={{ fill: T.fg4 }} />
      </pattern>
      <pattern id={id('dashes-fg')} width="6" height="4" patternUnits="userSpaceOnUse">
        <rect x="0" y="1.5" width="3" height="1" style={{ fill: T.fg2 }} />
      </pattern>
      <linearGradient id={id('fade-accent')} x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" style={{ stopColor: T.accent, stopOpacity: 0.12 }} />
        <stop offset="1" style={{ stopColor: T.accent, stopOpacity: 0 }} />
      </linearGradient>
      <linearGradient id={id('fade-series-1')} x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" style={{ stopColor: T.series1, stopOpacity: 0.12 }} />
        <stop offset="1" style={{ stopColor: T.series1, stopOpacity: 0 }} />
      </linearGradient>
      <linearGradient id={id('fade-series-3')} x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" style={{ stopColor: T.series3, stopOpacity: 0.12 }} />
        <stop offset="1" style={{ stopColor: T.series3, stopOpacity: 0 }} />
      </linearGradient>
      <linearGradient id={id('fade-fg')} x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" style={{ stopColor: T.fg1, stopOpacity: 0.06 }} />
        <stop offset="1" style={{ stopColor: T.fg1, stopOpacity: 0 }} />
      </linearGradient>
    </defs>
  );
}

/**
 * Sport colours for stacks and mixes (DESIGN_V2 §8.1): each sport keeps its identity colour
 * (`--color-sport-*`) and stacks in the fixed palette order bike → run → swim → walk → strength →
 * hike → row → ski → other (yoga and anything else share the neutral "Other"). Adjacent segments
 * are separated by a 2px surface gap where they are drawn. Labels are sentence case.
 * (`pattern` is no longer used — colour plus the legend carries identity.)
 */
export type SportKey = 'bike' | 'run' | 'swim' | 'walk' | 'strength' | 'hike' | 'row' | 'ski' | 'other';
export const SPORT_RAMP: Record<SportKey, { fill: string; pattern?: 'hatch' | 'dots'; label: string }> = {
  bike: { fill: T.sport('bike'), label: 'Ride' },
  run: { fill: T.sport('run'), label: 'Run' },
  swim: { fill: T.sport('swim'), label: 'Swim' },
  walk: { fill: T.sport('walk'), label: 'Walk' },
  strength: { fill: T.sport('strength'), label: 'Strength' },
  hike: { fill: T.sport('hike'), label: 'Hike' },
  row: { fill: T.sport('row'), label: 'Row' },
  ski: { fill: T.sport('ski'), label: 'Ski' },
  other: { fill: T.sport('other'), label: 'Other' },
};
export const SPORT_ORDER: SportKey[] = ['bike', 'run', 'swim', 'walk', 'strength', 'hike', 'row', 'ski', 'other'];
const KEYS = new Set<string>(SPORT_ORDER);
/** Map any domain Sport to a stack slot (yoga and unknown sports share "other"). */
export function sportKey(s: string): SportKey {
  return KEYS.has(s) ? (s as SportKey) : 'other';
}
