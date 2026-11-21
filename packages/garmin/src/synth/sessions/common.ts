import type { IntensityClass, LocalDate, Sport, SubSport, WorkoutStructure } from '@cadence/core/domain';
import type { Rng } from '../prng';
import type { WeekInfo } from '../season';
import { familyOf, type Thr } from '../internal';
import { plannedTotals } from '../structure';
import { clamp } from '../util';

export interface SessionCtx {
  thr: Thr;
  week: WeekInfo;
  date: LocalDate;
  rng: Rng;
  /** Rotating variant counter (differs per week so interval sessions cycle). */
  variant: number;
  vol: number;
}

export interface SessionDraft {
  sport: Sport;
  subSport?: SubSport;
  title: string;
  description?: string;
  preNote?: string;
  structure?: WorkoutStructure;
  plannedDurationSec: number;
  plannedDistanceM?: number;
  isKey: boolean;
  intensity: IntensityClass;
  tags: string[];
  environment: 'indoor' | 'outdoor' | 'any';
}

/** Minutes scaled by weekly volume, rounded to 5 min. */
export function scaleMin(baseMin: number, vol: number, lo = 0.45, hi = 1.2): number {
  return Math.max(15, Math.round((baseMin * clamp(vol, lo, hi)) / 5) * 5);
}

export function fmtHm(min: number): string {
  if (min < 90) return `${min}′`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

type DraftInput = Omit<SessionDraft, 'plannedDurationSec'> & { plannedDurationSec?: number };

/** Fill planned duration/distance from the structure when not given. */
export function draft(d: DraftInput, thr: Thr): SessionDraft {
  let sec = d.plannedDurationSec;
  let dist = d.plannedDistanceM;
  if (d.structure) {
    const tot = plannedTotals(d.structure, familyOf(d.sport, d.subSport), thr);
    if (sec === undefined) sec = Math.round(tot.sec / 60) * 60;
    if (dist === undefined && (d.sport === 'swim' || d.sport === 'run' || d.sport === 'row')) dist = Math.round(tot.distM / 50) * 50;
  }
  const out: SessionDraft = { ...d, plannedDurationSec: Math.max(600, sec ?? 3600) };
  if (dist !== undefined && dist > 0) out.plannedDistanceM = dist;
  else delete out.plannedDistanceM;
  for (const k of Object.keys(out) as (keyof SessionDraft)[]) if (out[k] === undefined) delete out[k];
  return out;
}
