/**
 * Shared pieces of the workout / template pages: planned-totals row, the readable step list,
 * the sport picker, sub-sport chips, a neutral mini profile and the template card body.
 */
import { INTENSITY_META, SPORT_META, type IntensityClass, type Sport, type SubSport, type Template, type ThresholdSnapshot, type WorkoutStructure } from '@cadence/core';
import { describeStep, estimateWorkout, fmtClock, type AnyNode, type WorkoutEstimate } from '@cadence/core/workout';
import { motion } from 'motion/react';
import { useMemo, type ReactNode } from 'react';
import type { ProfileBlock } from '@/charts';
import { StatRow, StatTile, SportGlyph } from '@/ui';
import { cn } from '@/lib/cn';
import { distanceParts, formatDuration, formatIF } from '@/lib/format';
import { useUnits } from '@/lib/units';
import { spring } from '@/motion/tokens';
import { chartBlocks, roleLabel, SPORT_ORDER, SUB_LABEL, subSportsOf } from './model';

export interface Totals {
  durationSec?: number;
  distanceM?: number;
  load?: number;
  intensityFactor?: number;
}

/** Planned totals as one quiet row on the canvas: duration leads, the rest support it. */
export function TotalsTiles({ totals, sport, size = 'md', loading }: { totals: Totals; sport: Sport; size?: 'md' | 'lg'; loading?: boolean }) {
  const units = useUnits();
  const dist = totals.distanceM ? distanceParts(totals.distanceM, sport, units) : null;
  const tiles: ReactNode[] = [
    <StatTile key="d" label="Duration" value={totals.durationSec ?? null} format={(n) => formatDuration(n, 'clock')} size={size} />,
    SPORT_META[sport].hasDistance ? <StatTile key="m" label="Distance" value={totals.distanceM ? Number(dist!.value.replace(/[^\d.]/g, '')) : null} format={(n) => (sport === 'swim' || sport === 'row' ? Math.round(n).toLocaleString('en-GB') : n.toFixed(1))} unit={dist?.unit} size={size} /> : null,
    <StatTile key="l" label="Load" value={totals.load != null ? Math.round(totals.load) : null} size={size} />,
    <StatTile key="i" label="Intensity factor" value={totals.intensityFactor ?? null} format={(n) => formatIF(n)} size={size} />,
  ].filter(Boolean);
  if (loading)
    return (
      <StatRow columns={4}>
        {[0, 1, 2, 3].map((i) => (
          <StatTile.Skeleton key={i} />
        ))}
      </StatRow>
    );
  return <StatRow columns={tiles.length === 4 ? 4 : 3}>{tiles}</StatRow>;
}

/**
 * Readable steps: one line per step — role, description with % and absolute targets, duration.
 * Repeats are an indented group on one quiet surface step. Hovering a step highlights its blocks
 * in the profile above (and vice versa), so the list itself needs no colour.
 */
export function StepsReadable({
  structure,
  sport,
  thresholds,
  estimate,
  hovered,
  onHover,
}: {
  structure: WorkoutStructure;
  sport: Sport;
  thresholds: ThresholdSnapshot;
  estimate: WorkoutEstimate;
  hovered?: string | null;
  onHover?: (id: string | null) => void;
}) {
  const units = useUnits();
  const secs = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of estimate.profile) if (!m.has(b.stepId)) m.set(b.stepId, b.durationSec);
    return m;
  }, [estimate]);
  const render = (nodes: readonly AnyNode[]): ReactNode =>
    nodes.map((n) =>
      n.kind === 'repeat' ? (
        <li key={n.id} className="my-2 flex flex-col rounded-lg bg-surface-1 py-2">
          <div className="flex h-8 items-center gap-2 px-4">
            <span className="text-body font-medium text-fg-1">{n.count}×</span>
            <span className="text-body-sm text-fg-3">{n.label ?? 'Repeat'}</span>
          </div>
          <ul className="flex flex-col pl-4">{render(n.steps as AnyNode[])}</ul>
        </li>
      ) : (
        <li
          key={n.id}
          onPointerEnter={() => onHover?.(n.id)}
          onPointerLeave={() => onHover?.(null)}
          className={cn('flex min-h-11 items-baseline gap-4 rounded-md px-4 py-2.5 transition-colors duration-(--dur-fast)', hovered === n.id ? 'bg-surface-2' : 'hover:bg-surface-2')}
        >
          <span className="w-24 shrink-0 text-body-sm text-fg-3 max-sm:hidden">{roleLabel(n.role)}</span>
          <span className="min-w-0 flex-1 text-body text-fg-1">
            <span className="block text-body-sm text-fg-3 sm:hidden">{roleLabel(n.role)}</span>
            {describeStep(n, sport, units.system, thresholds)}
            {n.cue && <span className="mt-0.5 block text-body-sm text-fg-3">{n.cue}</span>}
          </span>
          {secs.get(n.id) !== undefined && n.measure.type !== 'time' && <span className="shrink-0 text-body-sm text-fg-3">≈ {fmtClock(secs.get(n.id)!)}</span>}
        </li>
      ),
    );
  if (!structure.steps.length) return <p className="text-body text-fg-3">Unstructured — go by duration and feel.</p>;
  return <ul className="-mx-4 flex flex-col">{render(structure.steps as AnyNode[])}</ul>;
}

/** Sport picker: a calm grid of glyph tiles (the chosen glyph morphs into the page header). */
export function SportGrid({ value, onPick }: { value?: Sport; onPick: (s: Sport) => void }) {
  return (
    <div className="grid grid-cols-5 gap-3 max-sm:grid-cols-3" role="radiogroup" aria-label="Sport">
      {SPORT_ORDER.map((s) => (
        <motion.button
          key={s}
          type="button"
          role="radio"
          aria-checked={value === s}
          whileTap={{ scale: 0.97 }}
          transition={spring.snappy}
          onClick={() => onPick(s)}
          className={cn(
            'flex h-28 flex-col items-center justify-center gap-3 rounded-lg transition-colors duration-(--dur-fast) max-sm:h-24',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
            value === s ? 'bg-surface-3 text-fg-1' : 'bg-surface-1 text-fg-2 hover:bg-surface-2 hover:text-fg-1',
          )}
        >
          <motion.span layoutId={`sport-glyph-${s}`} transition={spring.smooth} className="flex">
            <SportGlyph sport={s} size={24} />
          </motion.span>
          <span className="text-body-sm">{SPORT_META[s].label}</span>
        </motion.button>
      ))}
    </div>
  );
}

export function SubSportChips({ sport, value, onChange }: { sport: Sport; value?: SubSport; onChange: (s: SubSport | undefined) => void }) {
  const subs = subSportsOf(sport);
  if (!subs.length) return null;
  return (
    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Type">
      {subs.map((s) => (
        <motion.button
          key={s}
          type="button"
          role="radio"
          aria-checked={value === s}
          whileTap={{ scale: 0.96 }}
          transition={spring.snappy}
          onClick={() => onChange(value === s ? undefined : s)}
          className={cn('h-7 rounded-md px-2.5 text-body-sm transition-colors duration-(--dur-fast)', value === s ? 'bg-surface-active text-fg-1' : 'text-fg-3 hover:bg-surface-2 hover:text-fg-1')}
        >
          {SUB_LABEL[s]}
        </motion.button>
      ))}
    </div>
  );
}

/**
 * A small neutral step profile (width ∝ duration, height ∝ intensity) for lists and cards, where
 * the zone colours would be noise. The coloured profile lives on the workout / template page.
 */
export function NeutralProfile({ blocks, height = 24, className }: { blocks: readonly ProfileBlock[]; height?: number; className?: string }) {
  const total = blocks.reduce((a, b) => Math.max(a, b.startSec + b.durationSec), 0) || 1;
  const W = 1000;
  const k = W / total;
  const y = (v: number) => height - Math.max(0.14, Math.min(1, v / 1.35)) * height;
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className={cn('block w-full text-fg-4', className)} style={{ height }} aria-hidden>
      {blocks.map((b) => {
        const x = b.startSec * k;
        const w = Math.max(1, b.durationSec * k - (b.durationSec * k > 8 ? 4 : 0));
        const a = y(b.intensity);
        const e = y(b.intensityEnd ?? b.intensity);
        return <path key={b.id} d={`M${x} ${height}L${x} ${a}L${x + w} ${e}L${x + w} ${height}Z`} fill="currentColor" />;
      })}
    </svg>
  );
}

/** Template card body: glyph + title, a neutral profile, then duration · intensity. */
export function TemplateMini({ t, thresholds }: { t: Pick<Template, 'sport' | 'structure' | 'plannedDurationSec' | 'plannedLoad' | 'intensity' | 'title' | 'subSport'>; thresholds: ThresholdSnapshot }) {
  const blocks = useMemo(() => (t.structure?.steps.length ? chartBlocks(estimateWorkout(t.structure, t.sport, thresholds), t.structure).blocks : []), [t.structure, t.sport, thresholds]);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <SportGlyph sport={t.sport} subSport={t.subSport} size={16} className="text-fg-3" />
        <span className="min-w-0 flex-1 truncate text-body font-medium text-fg-1">{t.title}</span>
      </div>
      <div className="h-6">{blocks.length ? <NeutralProfile blocks={blocks} /> : <div className="mt-4 h-2 rounded-xs bg-surface-3" />}</div>
      <div className="flex items-center gap-1.5 text-body-sm text-fg-3">
        {t.plannedDurationSec ? <span className="text-fg-2">{formatDuration(t.plannedDurationSec, 'clock')}</span> : null}
        {t.plannedDurationSec ? <span className="text-fg-4">·</span> : null}
        <span>{INTENSITY_META[t.intensity as IntensityClass]?.label}</span>
      </div>
    </div>
  );
}
