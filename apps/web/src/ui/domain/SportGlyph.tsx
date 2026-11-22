/**
 * SportGlyph — the ONLY way to render a sport (design.md §2.4, rule 16). Monochrome object
 * metaphors on Lucide's 24px grid, stroke 1.75, plus the custom ROW glyph. Indoor sub-sports
 * (indoor, virtual, treadmill, erg) get a small corner dot. Never color-coded.
 *
 *   <SportGlyph sport="bike" subSport="indoor" size={16} />
 *   <SportGlyph sport="run" withLabel />   // glyph + RUN micro label
 */
import type { Sport, SubSport } from '@cadence/core';
import { Activity, Bike, Dumbbell, Flower2, Footprints, Mountain, Route, Snowflake, Waves, type LucideIcon, type LucideProps } from 'lucide-react';
import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn';
import { RowGlyph } from '../glyphs/Row';

const ICONS: Record<Sport, LucideIcon | ((p: LucideProps) => React.JSX.Element)> = {
  bike: Bike,
  run: Footprints,
  swim: Waves,
  row: RowGlyph,
  strength: Dumbbell,
  hike: Mountain,
  walk: Route,
  yoga: Flower2,
  ski: Snowflake,
  other: Activity,
};

/** 3–5 letter labels (micro caps). */
export const SPORT_SHORT: Record<Sport, string> = {
  bike: 'RIDE',
  run: 'RUN',
  swim: 'SWIM',
  row: 'ROW',
  strength: 'STR',
  hike: 'HIKE',
  walk: 'WALK',
  yoga: 'YOGA',
  ski: 'SKI',
  other: 'OTHER',
};

const INDOOR = new Set<SubSport>(['indoor', 'virtual', 'treadmill', 'erg']);
export const isIndoor = (sub?: SubSport | null) => !!sub && INDOOR.has(sub);

export interface SportGlyphProps {
  sport: Sport;
  subSport?: SubSport | null;
  size?: 14 | 16 | 20 | 24 | 32;
  withLabel?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Accessible name; default hidden (decorative next to text). */
  title?: string;
}

export function SportGlyph({ sport, subSport, size = 16, withLabel, className, style, title }: SportGlyphProps) {
  const Icon = ICONS[sport] ?? Activity;
  const indoor = isIndoor(subSport);
  const dot = size <= 16 ? 'size-[5px] -top-px -right-px' : size <= 24 ? 'size-1.5 top-0 right-0' : 'size-2 top-0.5 right-0.5';
  const glyph = (
    <span className={cn('relative inline-flex shrink-0', !withLabel && className)} style={withLabel ? undefined : style} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <Icon size={size} strokeWidth={size >= 24 ? 1.5 : 1.75} aria-hidden />
      {indoor && <span className={cn('absolute rounded-full bg-current ring-2 ring-canvas', dot)} aria-hidden />}
    </span>
  );
  if (!withLabel) return glyph;
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)} style={style}>
      {glyph}
      <span className="text-micro ">{SPORT_SHORT[sport]}</span>
    </span>
  );
}
