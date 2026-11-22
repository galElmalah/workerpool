/**
 * Workout feature model helpers: thresholds on a date, profile → chart blocks, id reconciliation
 * for the text ⇄ visual sync, per-sport step presets and target catalogues.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { SPORT_META, type LocalDate, type Sport, type Step, type StepRole, type SubSport, type Target, type Threshold, type ThresholdSnapshot, type WorkoutStructure, type StructureNode } from '@cadence/core';
import { resolveThresholds } from '@cadence/core/metrics';
import { makeRepeat, makeStep, type AnyNode, type ProfileBlock as CoreBlock, type WorkoutEstimate } from '@cadence/core/workout';
import type { ProfileBlock, ProfileRepeat } from '@/charts';
import { api, call } from '@/lib/api';
import { qk } from '@/lib/query';
import { useCurrentThresholds } from '@/lib/queries/shared';

// ───────────────────────── thresholds ─────────────────────────

const historyQuery = {
  queryKey: qk.thresholds.history,
  queryFn: () => call(api.thresholds.$get()) as Promise<Threshold[]>,
  staleTime: 5 * 60_000,
};

/** Thresholds effective for `sport` on `date` (falls back to today's when no date / history). */
export function useThresholdsOn(sport: Sport, date?: LocalDate | null): { thresholds: ThresholdSnapshot; today?: LocalDate; ready: boolean } {
  const current = useCurrentThresholds();
  const history = useQuery(historyQuery);
  const today = current.data?.date;
  if (history.data && date) return { thresholds: resolveThresholds(history.data, date, sport), today, ready: true };
  const snap = (current.data?.sports as Record<Sport, ThresholdSnapshot> | undefined)?.[sport];
  return { thresholds: snap ?? {}, today, ready: !!current.data };
}

// ───────────────────────── chart blocks ─────────────────────────

const ROLE_LABEL: Record<StepRole, string> = {
  warmup: 'Warm-up',
  active: 'Interval',
  recovery: 'Recovery',
  rest: 'Rest',
  cooldown: 'Cool-down',
  other: 'Step',
};
export const roleLabel = (r: StepRole) => ROLE_LABEL[r];

/** Chart blocks with keys stable across edits: `<stepId>#<occurrence>`, grouped by step id. */
export function chartBlocks(est: Pick<WorkoutEstimate, 'profile'>, structure: WorkoutStructure): { blocks: ProfileBlock[]; repeats: ProfileRepeat[] } {
  const seen = new Map<string, number>();
  const blocks: ProfileBlock[] = est.profile.map((b: CoreBlock) => {
    const n = seen.get(b.stepId) ?? 0;
    seen.set(b.stepId, n + 1);
    const ramp = b.rampFrom !== undefined && b.rampTo !== undefined;
    return {
      id: `${b.stepId}#${n}`,
      group: b.stepId,
      startSec: b.startSec,
      durationSec: Math.max(1, b.durationSec),
      intensity: ramp ? b.rampFrom! : b.intensity,
      ...(ramp ? { intensityEnd: b.rampTo } : {}),
      role: b.role,
      label: b.label ?? ROLE_LABEL[b.role],
    };
  });
  const repeats: ProfileRepeat[] = [];
  for (const node of structure.steps) {
    if (node.kind !== 'repeat') continue;
    const mine = est.profile.filter((b) => b.repeatIds[0] === node.id);
    if (!mine.length) continue;
    repeats.push({ id: node.id, startSec: mine[0].startSec, endSec: mine[mine.length - 1].startSec + mine[mine.length - 1].durationSec, count: node.count });
  }
  return { blocks, repeats };
}

export function axisLabelFor(sport: Sport): string {
  if (sport === 'bike') return '%FTP';
  if (sport === 'swim') return '%CSS';
  if (sport === 'run' || sport === 'row') return '%THR';
  return '%THR';
}

// ───────────────────────── id reconciliation ─────────────────────────

/** Re-use ids from `prev` for nodes at the same position and kind (text edits keep layout keys). */
export function reconcileIds(prev: WorkoutStructure, next: WorkoutStructure): WorkoutStructure {
  const used = new Set<string>();
  const rec = (a: readonly AnyNode[] | undefined, b: readonly AnyNode[]): AnyNode[] =>
    b.map((n, i) => {
      const p = a?.[i];
      const id = p && p.kind === n.kind && !used.has(p.id) ? p.id : n.id;
      used.add(id);
      if (n.kind === 'repeat') return { ...n, id, steps: rec(p?.kind === 'repeat' ? (p.steps as AnyNode[]) : undefined, n.steps as AnyNode[]) } as AnyNode;
      return { ...n, id } as AnyNode;
    });
  return { ...next, steps: rec(prev.steps as AnyNode[], next.steps as AnyNode[]) as StructureNode[] };
}

// ───────────────────────── sports ─────────────────────────

export const SPORT_ORDER: Sport[] = ['bike', 'run', 'swim', 'row', 'strength', 'hike', 'walk', 'yoga', 'ski', 'other'];

export const SUB_LABEL: Record<SubSport, string> = {
  road: 'Road',
  indoor: 'Indoor',
  mtb: 'MTB',
  gravel: 'Gravel',
  virtual: 'Virtual',
  road_run: 'Road',
  trail: 'Trail',
  treadmill: 'Treadmill',
  track: 'Track',
  pool: 'Pool',
  open_water: 'Open water',
  erg: 'Erg',
  on_water: 'On water',
  gym: 'Gym',
  bodyweight: 'Bodyweight',
  mobility: 'Mobility',
  hiit: 'HIIT',
  generic: 'General',
};

export const subSportsOf = (s: Sport) => SPORT_META[s].subSports.filter((x) => x !== 'generic');

/** Sports whose builder is the step graph (others default to a simple duration + intensity form). */
export const STRUCTURED_SPORTS = new Set<Sport>(['bike', 'run', 'swim', 'row', 'strength']);

export type TargetKind = Target['type'];

/** Target types offered per sport, in menu order. */
export function targetKinds(sport: Sport): TargetKind[] {
  switch (sport) {
    case 'bike':
      return ['power_pct', 'power_w', 'hr_zone', 'hr_pct_lthr', 'rpe', 'ramp', 'open'];
    case 'run':
      return ['pace_pct', 'pace', 'hr_zone', 'hr_pct_lthr', 'rpe', 'ramp', 'open'];
    case 'swim':
      return ['pace_pct', 'pace', 'rpe', 'open'];
    case 'row':
      return ['pace_pct', 'pace', 'power_w', 'hr_zone', 'rpe', 'open'];
    default:
      return ['rpe', 'hr_zone', 'hr_pct_lthr', 'open'];
  }
}

export const TARGET_KIND_LABEL: Record<TargetKind, string> = {
  power_pct: '% FTP',
  power_w: 'Watts',
  hr_zone: 'HR zone',
  hr_pct_lthr: '% LTHR',
  hr_bpm: 'bpm',
  pace: 'Pace',
  pace_pct: '% thr',
  rpe: 'RPE',
  cadence: 'Cadence',
  ramp: 'Ramp',
  open: 'Open',
};

export function pctKind(sport: Sport): 'power_pct' | 'pace_pct' | 'rpe' {
  if (sport === 'bike') return 'power_pct';
  if (sport === 'run' || sport === 'swim' || sport === 'row') return 'pace_pct';
  return 'rpe';
}

/** A sensible default target of `kind` for a step, given thresholds (used when switching type). */
export function defaultTarget(kind: TargetKind, sport: Sport, th: ThresholdSnapshot, around = 0.9): Target {
  const pct = Math.round(around * 100);
  switch (kind) {
    case 'power_pct':
      return { type: 'power_pct', low: pct - 3, high: pct + 2 };
    case 'pace_pct':
      return { type: 'pace_pct', low: pct - 2, high: pct + 2 };
    case 'power_w': {
      const thr = (sport === 'row' ? th.rowThresholdW : th.ftp) ?? 250;
      return { type: 'power_w', low: Math.round((thr * around) / 5) * 5 - 5, high: Math.round((thr * around) / 5) * 5 + 5 };
    }
    case 'pace': {
      const thr = (sport === 'swim' ? th.swimCssMps : sport === 'run' ? th.runThresholdMps : undefined) ?? (sport === 'swim' ? 1.3 : sport === 'row' ? 4.4 : 3.8);
      return { type: 'pace', lowMps: +(thr * around * 0.98).toFixed(3), highMps: +(thr * around * 1.02).toFixed(3) };
    }
    case 'hr_zone':
      return { type: 'hr_zone', zone: around >= 1 ? 4 : around >= 0.85 ? 3 : 2 };
    case 'hr_pct_lthr':
      return { type: 'hr_pct_lthr', low: Math.min(100, pct - 3), high: Math.min(105, pct + 2) };
    case 'hr_bpm':
      return { type: 'hr_bpm', low: 140, high: 150 };
    case 'rpe': {
      const r = Math.max(1, Math.min(10, Math.round(around * 8)));
      return { type: 'rpe', low: r, high: Math.min(10, r + 1) };
    }
    case 'ramp':
      return { type: 'ramp', basis: sport === 'bike' ? 'power_pct' : sport === 'run' || sport === 'swim' || sport === 'row' ? 'pace_pct' : 'hr_pct_lthr', from: 50, to: 75 };
    case 'cadence':
      return { type: 'cadence', low: 85, high: 95 };
    case 'open':
      return { type: 'open' };
  }
}

// ───────────────────────── presets ─────────────────────────

export type Preset = 'warmup' | 'interval' | 'recovery' | 'cooldown' | 'repeat';

const t = (sport: Sport, lo: number, hi: number): Target => {
  const k = pctKind(sport);
  if (k === 'rpe') return { type: 'rpe', low: Math.max(1, Math.round(lo / 12)), high: Math.max(1, Math.round(hi / 12)) };
  return { type: k, low: lo, high: hi };
};

/** A fresh step / repeat for an "add" button. */
export function presetNode(p: Preset, sport: Sport): AnyNode {
  const swim = sport === 'swim';
  const row = sport === 'row';
  switch (p) {
    case 'warmup':
      return swim
        ? makeStep({ role: 'warmup', measure: { type: 'distance', m: 400 }, target: t(sport, 80, 85), swim: { stroke: 'free' } })
        : makeStep({
            role: 'warmup',
            measure: { type: 'time', sec: 600 },
            target: sport === 'bike' || sport === 'run' || row ? { type: 'ramp', basis: pctKind(sport) as 'power_pct' | 'pace_pct', from: sport === 'bike' ? 50 : 75, to: sport === 'bike' ? 75 : 88 } : t(sport, 30, 40),
          });
    case 'interval':
      return swim
        ? makeStep({ role: 'active', measure: { type: 'distance', m: 100 }, target: t(sport, 100, 103), swim: { stroke: 'free', sendOffSec: 110 } })
        : row
          ? makeStep({ role: 'active', measure: { type: 'distance', m: 500 }, target: t(sport, 102, 105), row: { strokeRateLow: 26, strokeRateHigh: 28 } })
          : makeStep({ role: 'active', measure: { type: 'time', sec: 240 }, target: sport === 'bike' ? t(sport, 105, 110) : t(sport, 100, 104) });
    case 'recovery':
      return swim
        ? makeStep({ role: 'rest', measure: { type: 'time', sec: 30 } })
        : makeStep({ role: 'recovery', measure: { type: 'time', sec: row ? 120 : 180 }, target: sport === 'bike' ? t(sport, 50, 55) : t(sport, 70, 78) });
    case 'cooldown':
      return swim
        ? makeStep({ role: 'cooldown', measure: { type: 'distance', m: 200 }, target: t(sport, 75, 80), swim: { stroke: 'choice' } })
        : makeStep({ role: 'cooldown', measure: { type: 'time', sec: 600 }, target: sport === 'bike' ? t(sport, 45, 55) : t(sport, 70, 78) });
    case 'repeat':
      return makeRepeat(swim ? 8 : 5, [presetNode('interval', sport) as Step, ...(swim ? [] : [presetNode('recovery', sport) as Step])]);
  }
}

export function strengthStep(exercise = 'Back squat'): Step {
  return makeStep({ role: 'active', measure: { type: 'reps', n: 8 }, strength: { exercise, sets: 3, reps: 8, restSec: 90 } });
}

/** Debounced save of an edited value; never fires for `skip` (the value loaded from the server). */
export function useDebouncedSave<T>(value: T, skip: T, save: (v: T) => unknown, delay = 700): void {
  const fn = useRef(save);
  fn.current = save;
  useEffect(() => {
    if (value === skip) return;
    const t = setTimeout(() => void fn.current(value), delay);
    return () => clearTimeout(t);
  }, [value, skip, delay]);
}
