/**
 * Shared pieces of the workout / template pages: planned-totals tiles, the readable step list,
 * the big sport picker and the "start from a template" strip.
 */
import { INTENSITY_META, SPORT_META, type IntensityClass, type Sport, type SubSport, type Template, type ThresholdSnapshot, type WorkoutStructure } from '@cadence/core';
import { describeStep, estimateWorkout, fmtClock, type AnyNode, type WorkoutEstimate } from '@cadence/core/workout';
import { motion } from 'motion/react';
import { useMemo, type ReactNode } from 'react';
import { IntensityProfile, levelFor } from '@/charts';
import { StatTile, SportGlyph, IntensityPips } from '@/ui';
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

export function TotalsTiles({ totals, sport, size = 'md', loading }: { totals: Totals; sport: Sport; size?: 'md' | 'lg'; loading?: boolean }) {
  const units = useUnits();
  const dist = totals.distanceM ? distanceParts(totals.distanceM, sport, units) : null;
  const tiles: ReactNode[] = [
    <StatTile key="d" label="Duration" value={totals.durationSec ?? null} format={(n) => formatDuration(n, 'clock')} size={size} />,
    SPORT_META[sport].hasDistance ? <StatTile key="m" label="Distance" value={totals.distanceM ? Number(dist!.value.replace(/[^\d.]/g, '')) : null} format={(n) => (sport === 'swim' || sport === 'row' ? Math.round(n).toLocaleString('en-GB') : n.toFixed(1))} unit={dist?.unit} size={size} /> : null,
    <StatTile key="l" label="Load" value={totals.load != null ? Math.round(totals.load) : null} size={size} signal />,
    <StatTile key="i" label="Intensity factor" value={totals.intensityFactor ?? null} format={(n) => formatIF(n)} size={size} />,
  ].filter(Boolean);
  if (loading)
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <StatTile.Skeleton key={i} />
        ))}
      </div>
    );
  return <div className={cn('grid grid-cols-2 gap-3', tiles.length === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3')}>{tiles}</div>;
}

/** Readable steps: describeStep with % and absolute targets; repeats as indented groups. */
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
  const meta = useMemo(() => {
    const m = new Map<string, { level: number; sec: number }>();
    for (const b of estimate.profile) if (!m.has(b.stepId)) m.set(b.stepId, { level: levelFor(b.rampTo ?? b.intensity), sec: b.durationSec });
    return m;
  }, [estimate]);
  const ZONE_BG = ['bg-z1', 'bg-z2', 'bg-z3', 'bg-z4', 'bg-z5', 'bg-z6', 'bg-z7'];
  const render = (nodes: readonly AnyNode[], depth: number): ReactNode =>
    nodes.map((n) =>
      n.kind === 'repeat' ? (
        <li key={n.id} className="flex flex-col gap-0.5">
          <div className="flex h-8 items-center gap-2 px-3">
            <span className="font-mono text-mono text-fg-1">{n.count}×</span>
            <span className="text-micro uppercase text-fg-3">{n.label ?? 'Repeat'}</span>
          </div>
          <ul className="ml-4 flex flex-col gap-0.5 border-l border-line-2 pl-2">{render(n.steps as AnyNode[], depth + 1)}</ul>
        </li>
      ) : (
        <li
          key={n.id}
          onPointerEnter={() => onHover?.(n.id)}
          onPointerLeave={() => onHover?.(null)}
          className={cn('flex min-h-10 items-center gap-3 rounded-md px-3 py-1.5 transition-colors duration-(--dur-fast)', hovered === n.id ? 'bg-surface-2' : 'hover:bg-surface-1')}
        >
          <span aria-hidden className={cn('h-5 w-1 shrink-0 rounded-full', ZONE_BG[(meta.get(n.id)?.level ?? 1) - 1])} />
          <span className="w-20 shrink-0 text-micro uppercase text-fg-3 max-sm:hidden">{roleLabel(n.role)}</span>
          <span className="min-w-0 flex-1 text-body text-fg-1">
            <span className="block text-micro uppercase text-fg-3 sm:hidden">{roleLabel(n.role)}</span>
            {describeStep(n, sport, units.system, thresholds)}
            {n.cue && <span className="block text-body-sm text-fg-3">{n.cue}</span>}
          </span>
          {meta.get(n.id) && n.measure.type !== 'time' && <span className="shrink-0 font-mono text-mono-sm text-fg-3">≈{fmtClock(meta.get(n.id)!.sec)}</span>}
        </li>
      ),
    );
  if (!structure.steps.length) return <p className="text-body text-fg-3">Unstructured — just go by duration and feel.</p>;
  return <ul className="flex flex-col gap-0.5">{render(structure.steps as AnyNode[], 0)}</ul>;
}

/** Big glyph grid for picking a sport. */
export function SportGrid({ value, onPick }: { value?: Sport; onPick: (s: Sport) => void }) {
  return (
    <div className="grid grid-cols-5 gap-2 max-sm:grid-cols-3" role="radiogroup" aria-label="Sport">
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
            'spotlight flex aspect-[5/4] flex-col items-center justify-center gap-2 rounded-xl border bg-surface-1 transition-colors duration-(--dur-fast)',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
            value === s ? 'border-fg-1 text-fg-1' : 'border-line-1 text-fg-2 hover:border-line-3 hover:bg-surface-2 hover:text-fg-1',
          )}
        >
          <motion.span layoutId={`sport-glyph-${s}`} transition={spring.smooth} className="flex">
            <SportGlyph sport={s} size={32} />
          </motion.span>
          <span className="text-label">{SPORT_META[s].label}</span>
        </motion.button>
      ))}
    </div>
  );
}

export function SubSportChips({ sport, value, onChange }: { sport: Sport; value?: SubSport; onChange: (s: SubSport | undefined) => void }) {
  const subs = subSportsOf(sport);
  if (!subs.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Type">
      {subs.map((s) => (
        <motion.button
          key={s}
          type="button"
          role="radio"
          aria-checked={value === s}
          whileTap={{ scale: 0.96 }}
          transition={spring.snappy}
          onClick={() => onChange(value === s ? undefined : s)}
          className={cn('h-7 rounded-sm border px-2.5 text-label transition-colors duration-(--dur-fast)', value === s ? 'border-line-3 bg-surface-active text-fg-1' : 'border-line-1 text-fg-2 hover:border-line-3 hover:text-fg-1')}
        >
          {SUB_LABEL[s]}
        </motion.button>
      ))}
    </div>
  );
}

/** Template card body: compact profile + duration · load + intensity. */
export function TemplateMini({ t, thresholds }: { t: Pick<Template, 'sport' | 'structure' | 'plannedDurationSec' | 'plannedLoad' | 'intensity' | 'title' | 'subSport'>; thresholds: ThresholdSnapshot }) {
  const blocks = useMemo(() => (t.structure?.steps.length ? chartBlocks(estimateWorkout(t.structure, t.sport, thresholds), t.structure).blocks : []), [t.structure, t.sport, thresholds]);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <SportGlyph sport={t.sport} subSport={t.subSport} size={16} className="text-fg-2" />
        <span className="min-w-0 flex-1 truncate text-body font-[560] text-fg-1">{t.title}</span>
        <IntensityPips intensity={t.intensity as IntensityClass} />
      </div>
      <div className="h-8">{blocks.length ? <IntensityProfile variant="compact" blocks={blocks} height={32} /> : <div className="h-8 rounded-xs bg-hatch-faint" />}</div>
      <div className="flex items-center gap-3 font-mono text-mono-sm text-fg-3">
        {t.plannedDurationSec ? <span>{formatDuration(t.plannedDurationSec, 'clock')}</span> : null}
        {t.plannedLoad ? <span>{Math.round(t.plannedLoad)} load</span> : null}
        <span className="ml-auto">{INTENSITY_META[t.intensity as IntensityClass]?.label}</span>
      </div>
    </div>
  );
}
