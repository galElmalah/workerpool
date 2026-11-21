/**
 * Planning service: building planned workouts from input (derived planned totals, sparkline,
 * intensity, auto title), patches with series scope, and calendar bulk operations
 * (duplicate, repeat weekly, copy week, shift, delete, restore).
 */
import { z } from 'zod';
import {
  IntensityClass,
  PlannedWorkout,
  PlannedWorkoutInput,
  Sport,
  WorkoutStructure,
  type LocalDate,
  type Template,
  type ThresholdSnapshot,
} from '@cadence/core/domain';
import { addDays, diffDays } from '@cadence/core/time';
import {
  autoTitle,
  autoTitleUnstructured,
  classifyPlannedIntensity,
  copyWorkout,
  derivePlannedTotals,
  estimateWorkout,
  reassignIds,
  shiftWorkouts,
  sparklineFromProfile,
  validateStructure,
  type StructureIssue,
} from '@cadence/core/workout';
import { badRequest, notFound } from '../lib/http';
import { newId, nowIso } from '../lib/ids';
import { thresholdResolver, thresholdsOn } from '../db/thresholds';
import {
  deleteWorkouts,
  getWorkout,
  insertWorkouts,
  isOnGarmin,
  listSeries,
  listWorkouts,
  updateWorkouts,
} from '../db/workouts';
import { all, chunk, placeholders } from '../db/sql';
import { markWorkoutDirty, unpushWorkout } from './push';

type Resolver = (date: LocalDate, sport: Sport) => ThresholdSnapshot;

// ───────────────────────────── schemas ─────────────────────────────

/** PATCH body: any input field; `null` clears an optional field. */
export const PlannedWorkoutPatch = PlannedWorkoutInput.partial().extend({
  startTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  subSport: PlannedWorkout.shape.subSport.unwrap().nullable().optional(),
  description: z.string().nullable().optional(),
  preNote: z.string().nullable().optional(),
  plannedDurationSec: z.number().nonnegative().nullable().optional(),
  plannedDistanceM: z.number().nonnegative().nullable().optional(),
  plannedLoad: z.number().nonnegative().nullable().optional(),
  plannedIntensityFactor: z.number().nonnegative().nullable().optional(),
  structure: WorkoutStructure.nullable().optional(),
  templateId: z.string().nullable().optional(),
  seriesId: z.string().nullable().optional(),
  eventId: z.string().nullable().optional(),
  skipReason: PlannedWorkout.shape.skipReason.unwrap().nullable().optional(),
});
export type PlannedWorkoutPatch = z.infer<typeof PlannedWorkoutPatch>;

export const EstimateInput = z.object({
  sport: Sport,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  structure: WorkoutStructure.optional(),
  durationSec: z.number().nonnegative().optional(),
  distanceM: z.number().nonnegative().optional(),
  intensity: IntensityClass.optional(),
});
export type EstimateInput = z.infer<typeof EstimateInput>;

// ───────────────────────────── derivation ─────────────────────────────

const hasSteps = (s: WorkoutStructure | undefined): s is WorkoutStructure => !!s && s.steps.length > 0;

/** Validate a structure; duplicate node ids are repaired, other errors are rejected. */
export function checkStructure(structure: WorkoutStructure, sport: Sport): WorkoutStructure {
  const issues = validateStructure(structure, sport).filter((i) => i.severity === 'error');
  if (!issues.length) return structure;
  if (issues.every((i) => i.code === 'duplicate_id')) return reassignIds(structure);
  throw badRequest(issues.map((i) => i.message).join('; '), 'invalid_structure');
}

function autoTitleFor(w: Pick<PlannedWorkout, 'sport' | 'structure' | 'plannedDurationSec' | 'plannedDistanceM' | 'intensity'>, th: ThresholdSnapshot): string {
  return hasSteps(w.structure)
    ? autoTitle(w.structure, w.sport, th)
    : autoTitleUnstructured({ sport: w.sport, durationSec: w.plannedDurationSec, distanceM: w.plannedDistanceM, intensity: w.intensity });
}

/** Whether a stored workout's intensity / title look generated (so edits may regenerate them). */
function autoFlags(w: PlannedWorkout, th: ThresholdSnapshot): { intensity: boolean; title: boolean } {
  const intensity = hasSteps(w.structure) ? classifyPlannedIntensity(w.structure, w.sport, th).intensity === w.intensity : false;
  const title = !w.title.trim() || w.title === autoTitleFor(w, th);
  return { intensity, title };
}

interface DeriveFlags {
  /** Re-classify intensity from the structure. */
  intensity: boolean;
  /** Regenerate the title. */
  title: boolean;
  /** Recompute unstructured totals (duration/distance/intensity changed or structure removed). */
  unstructured: boolean;
}

/** Recompute derived fields in place (structure → totals, sparkline, intensity, title). */
export function deriveWorkout<T extends PlannedWorkout | Template>(w: T, th: ThresholdSnapshot, flags: DeriveFlags): T {
  const out = { ...w } as T & { sparkline?: number[] };
  if (hasSteps(out.structure)) {
    const e = estimateWorkout(out.structure, out.sport, th);
    const totals = derivePlannedTotals({ sport: out.sport, intensity: out.intensity, structure: out.structure }, th);
    if (totals.plannedDurationSec !== undefined) out.plannedDurationSec = totals.plannedDurationSec;
    else delete out.plannedDurationSec;
    if (totals.plannedDistanceM !== undefined) out.plannedDistanceM = totals.plannedDistanceM;
    else delete out.plannedDistanceM;
    out.plannedLoad = totals.plannedLoad;
    out.plannedIntensityFactor = totals.plannedIntensityFactor;
    out.sparkline = sparklineFromProfile(e.profile, e.durationSec);
    if (flags.intensity) out.intensity = classifyPlannedIntensity(out.structure, out.sport, th).intensity;
  } else {
    delete out.structure;
    delete out.sparkline;
    if (flags.unstructured) {
      const totals = derivePlannedTotals(
        { sport: out.sport, intensity: out.intensity, plannedDurationSec: out.plannedDurationSec, plannedDistanceM: out.plannedDistanceM },
        th,
      );
      if (totals.plannedDurationSec !== undefined) out.plannedDurationSec = totals.plannedDurationSec;
      out.plannedLoad = totals.plannedLoad;
      out.plannedIntensityFactor = totals.plannedIntensityFactor;
    }
  }
  if (flags.title || !out.title.trim()) out.title = autoTitleFor(out as PlannedWorkout, th);
  return out;
}

/** Pure: a full PlannedWorkout from create input. */
export function buildWorkout(input: PlannedWorkoutInput, th: ThresholdSnapshot, opts: { id?: string; now?: string } = {}): PlannedWorkout {
  const now = opts.now ?? nowIso();
  const structure = hasSteps(input.structure) ? checkStructure(input.structure, input.sport) : undefined;
  const base: PlannedWorkout = {
    ...input,
    id: opts.id ?? newId('wk'),
    title: (input.title ?? '').trim(),
    structure,
    isKey: input.isKey ?? false,
    intensity: input.intensity ?? 'endurance',
    tags: input.tags ?? [],
    environment: input.environment ?? 'any',
    status: input.status ?? 'planned',
    garmin: { syncState: 'none' },
    createdAt: now,
    updatedAt: now,
  };
  if (!structure) delete base.structure;
  if (base.status !== 'skipped') delete base.skipReason;
  const userLoad = !structure && input.plannedLoad !== undefined;
  const derived = deriveWorkout(base, th, {
    intensity: !!structure && input.intensity === undefined,
    title: !base.title,
    unstructured: !userLoad,
  });
  if (userLoad) {
    derived.plannedLoad = input.plannedLoad;
    if (input.plannedIntensityFactor !== undefined) derived.plannedIntensityFactor = input.plannedIntensityFactor;
  }
  return stripUndefined(derived);
}

function stripUndefined<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

/** Create and store a planned workout (thresholds effective on its date). */
export async function createWorkout(env: Env, input: PlannedWorkoutInput): Promise<PlannedWorkout> {
  const th = await thresholdsOn(env.DB, input.date, input.sport);
  const w = buildWorkout(input, th);
  await insertWorkouts(env.DB, [w]);
  return w;
}

// ───────────────────────────── patch ─────────────────────────────

const GARMIN_FIELDS = ['date', 'startTime', 'title', 'description', 'structure', 'sport', 'subSport', 'status'] as const;

function garminRelevantChange(a: PlannedWorkout, b: PlannedWorkout): boolean {
  return GARMIN_FIELDS.some((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

/** Apply a patch to one workout (dates handled by the caller), then re-derive. */
export function applyPatch(w: PlannedWorkout, patch: PlannedWorkoutPatch, date: LocalDate, resolve: Resolver, now: string): PlannedWorkout {
  const oldTh = resolve(w.date, w.sport);
  const flags = autoFlags(w, oldTh);
  const next: Record<string, unknown> = { ...w };
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'date' || v === undefined) continue;
    if (v === null) delete next[k];
    else next[k] = v;
  }
  next.date = date;
  next.updatedAt = now;
  const out = next as PlannedWorkout;
  if (out.structure && hasSteps(out.structure)) out.structure = checkStructure(out.structure, out.sport);
  if (out.status !== 'skipped') delete out.skipReason;

  const structureChanged = patch.structure !== undefined || patch.sport !== undefined;
  const unstructuredChanged =
    patch.plannedDurationSec !== undefined ||
    patch.plannedDistanceM !== undefined ||
    patch.intensity !== undefined ||
    patch.sport !== undefined ||
    patch.structure === null;
  const userLoad = !hasSteps(out.structure) && patch.plannedLoad !== undefined && patch.plannedLoad !== null;
  const titleBlank = patch.title !== undefined && !patch.title.trim();
  const derived = deriveWorkout(out, resolve(out.date, out.sport), {
    intensity: patch.intensity === undefined && structureChanged && flags.intensity,
    title: titleBlank || (patch.title === undefined && flags.title && (structureChanged || unstructuredChanged)),
    unstructured: unstructuredChanged && !userLoad,
  });
  if (userLoad) derived.plannedLoad = patch.plannedLoad!;
  return stripUndefined(derived);
}

/**
 * PATCH a workout. scope 'following' applies the patch to this and every later member of its
 * series (a date change moves them all by the same number of days).
 */
export async function patchWorkout(
  env: Env,
  id: string,
  patch: PlannedWorkoutPatch,
  scope: 'this' | 'following' = 'this',
): Promise<{ workout: PlannedWorkout; updated: PlannedWorkout[] }> {
  const existing = await getWorkout(env.DB, id);
  if (!existing) throw notFound('Workout');
  const targets = scope === 'following' && existing.seriesId ? await listSeries(env.DB, existing.seriesId, existing.date) : [existing];
  if (!targets.some((t) => t.id === id)) targets.unshift(existing);
  const delta = patch.date ? diffDays(existing.date, patch.date) : 0;
  const resolve = await thresholdResolver(env.DB);
  const now = nowIso();
  const updated = targets.map((t) => applyPatch(t, patch, t.id === id ? (patch.date ?? t.date) : addDays(t.date, delta), resolve, now));
  await updateWorkouts(env.DB, updated);
  const dirty = updated.filter((u, i) => isOnGarmin(targets[i]) && garminRelevantChange(targets[i], u));
  await Promise.all(dirty.map((u) => markWorkoutDirty(env, u.id)));
  const workout = (await getWorkout(env.DB, id)) ?? updated.find((u) => u.id === id)!;
  return { workout, updated };
}

// ───────────────────────────── delete / restore ─────────────────────────────

/** Delete workouts; returns the deleted objects (for undo). Clears activity pairings and Garmin copies. */
export async function deleteWorkoutsById(env: Env, ids: string[]): Promise<PlannedWorkout[]> {
  const victims = await listWorkouts(env.DB, { ids });
  if (!victims.length) return [];
  await Promise.allSettled(victims.filter(isOnGarmin).map((w) => unpushWorkout(env, w.id)));
  const victimIds = victims.map((w) => w.id);
  for (const part of chunk(victimIds, 90)) {
    await env.DB.prepare(
      `UPDATE activities SET paired_workout_id = NULL, pair_manual = 0 WHERE paired_workout_id IN (${placeholders(part.length)})`,
    )
      .bind(...part)
      .run();
  }
  await deleteWorkouts(env.DB, victimIds);
  return victims;
}

/**
 * Undo support: re-insert workouts verbatim. Workouts that still exist are overwritten with the
 * given content (their Garmin link is kept and marked dirty when the content moved); deleted
 * ones are re-inserted (re-queued for Garmin when they had been pushed). Activity pairings are
 * re-linked when the activity is still unpaired.
 */
export async function restoreWorkouts(env: Env, workouts: PlannedWorkout[]): Promise<PlannedWorkout[]> {
  if (!workouts.length) return [];
  const existing = new Map((await listWorkouts(env.DB, { ids: workouts.map((w) => w.id) })).map((w) => [w.id, w]));
  const activityIds = workouts.map((w) => w.pairedActivityId).filter((x): x is string => !!x);
  const activityPair = new Map<string, string | null>();
  for (const part of chunk(activityIds, 90)) {
    const rows = await all<{ id: string; paired_workout_id: string | null }>(
      env.DB,
      `SELECT id, paired_workout_id FROM activities WHERE deleted_at IS NULL AND id IN (${placeholders(part.length)})`,
      ...part,
    );
    for (const r of rows) activityPair.set(r.id, r.paired_workout_id);
  }
  const fresh: PlannedWorkout[] = [];
  const replaced: PlannedWorkout[] = [];
  const dirty: string[] = [];
  const relink: PlannedWorkout[] = [];
  for (const raw of workouts) {
    const w: PlannedWorkout = { ...raw };
    delete w.compliance;
    if (w.pairedActivityId) {
      const owner = activityPair.get(w.pairedActivityId);
      if (owner === undefined || (owner !== null && owner !== w.id)) delete w.pairedActivityId;
      else if (owner === null) relink.push(w);
    }
    const cur = existing.get(w.id);
    if (cur) {
      replaced.push({ ...w, garmin: cur.garmin });
      if (isOnGarmin(cur) && garminRelevantChange(cur, w)) dirty.push(w.id);
    } else {
      if (isOnGarmin(w)) w.garmin = { syncState: 'pending' };
      fresh.push(w);
    }
  }
  await insertWorkouts(env.DB, fresh);
  await updateWorkouts(env.DB, replaced);
  // updateWorkouts does not touch pairing-only columns beyond paired_activity_id; re-link the activity side.
  if (relink.length) {
    await env.DB.batch(
      relink.map((w) =>
        env.DB.prepare('UPDATE activities SET paired_workout_id = ? WHERE id = ? AND paired_workout_id IS NULL').bind(w.id, w.pairedActivityId!),
      ),
    );
  }
  await Promise.all(dirty.map((id) => markWorkoutDirty(env, id)));
  return listWorkouts(env.DB, { ids: workouts.map((w) => w.id) });
}

// ───────────────────────────── copies ─────────────────────────────

function rederiveCopy(w: PlannedWorkout, resolve: Resolver): PlannedWorkout {
  if (!hasSteps(w.structure)) return w;
  return deriveWorkout(w, resolve(w.date, w.sport), { intensity: false, title: false, unstructured: false });
}

const copyOpts = (now: string) => ({ now, newId: () => newId('wk') });

export async function duplicateWorkout(env: Env, id: string, date: LocalDate): Promise<PlannedWorkout> {
  const w = await getWorkout(env.DB, id);
  if (!w) throw notFound('Workout');
  const resolve = await thresholdResolver(env.DB);
  const copy = rederiveCopy(copyWorkout(w, date, 1, copyOpts(nowIso())), resolve);
  await insertWorkouts(env.DB, [copy]);
  return copy;
}

/**
 * Repeat weekly: `weeks` occurrences in total (the original counts as the first), optionally on
 * several weekdays (1 = Mon … 7 = Sun) and with a weekly progression in %. Returns the series.
 */
export async function repeatWorkout(
  env: Env,
  id: string,
  opts: { weeks: number; weekdays?: number[]; progressionPct?: number },
): Promise<PlannedWorkout[]> {
  const w = await getWorkout(env.DB, id);
  if (!w) throw notFound('Workout');
  const seriesId = w.seriesId ?? newId('ser');
  const now = nowIso();
  const resolve = await thresholdResolver(env.DB);
  const step = 1 + (opts.progressionPct ?? 0) / 100;
  const dow = ((new Date(`${w.date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
  const weekdays = [...new Set(opts.weekdays?.length ? opts.weekdays : [dow])].sort();
  const monday = addDays(w.date, 1 - dow);
  const copies: PlannedWorkout[] = [];
  for (let k = 0; k < opts.weeks; k++) {
    for (const d of weekdays) {
      const date = addDays(monday, 7 * k + (d - 1));
      if (date <= w.date) continue;
      const c = copyWorkout(w, date, Math.pow(step, k), copyOpts(now));
      copies.push(rederiveCopy({ ...c, seriesId }, resolve));
    }
  }
  const original = { ...w, seriesId, updatedAt: now };
  await updateWorkouts(env.DB, [original]);
  await insertWorkouts(env.DB, copies);
  return [original, ...copies];
}

/** Copy the 7 days starting `fromMonday` onto the week starting `toMonday`, scaled by progressionPct. */
export async function copyWeekPlan(
  env: Env,
  fromMonday: LocalDate,
  toMonday: LocalDate,
  opts: { progressionPct?: number; includeNotes?: boolean; includeKey?: boolean },
): Promise<PlannedWorkout[]> {
  const source = await listWorkouts(env.DB, { from: fromMonday, to: addDays(fromMonday, 6) });
  const resolve = await thresholdResolver(env.DB);
  const offset = diffDays(fromMonday, toMonday);
  const factor = 1 + (opts.progressionPct ?? 0) / 100;
  const now = nowIso();
  const copies = source.map((w) =>
    rederiveCopy(
      copyWorkout(w, addDays(w.date, offset), factor, { ...copyOpts(now), includeNotes: opts.includeNotes, includeKey: opts.includeKey }),
      resolve,
    ),
  );
  await insertWorkouts(env.DB, copies);
  return copies;
}

/**
 * Shift every unpaired planned workout dated ≥ fromDate by `days`. Returns the moved workouts
 * and their previous versions (POST /calendar/restore with `previous` undoes it).
 */
export async function shiftPlan(
  env: Env,
  fromDate: LocalDate,
  days: number,
  opts: { includeEvents?: boolean } = {},
): Promise<{ moved: PlannedWorkout[]; previous: PlannedWorkout[]; eventsMoved: number }> {
  if (!days) return { moved: [], previous: [], eventsMoved: 0 };
  const source = await listWorkouts(env.DB, { from: fromDate });
  const shifted = shiftWorkouts(source, fromDate, days, { now: nowIso() });
  const moved: PlannedWorkout[] = [];
  const previous: PlannedWorkout[] = [];
  shifted.forEach((s, i) => {
    if (s.date !== source[i].date) {
      moved.push({ ...s, garmin: source[i].garmin });
      previous.push(source[i]);
    }
  });
  await updateWorkouts(env.DB, moved);
  await Promise.all(previous.filter(isOnGarmin).map((w) => markWorkoutDirty(env, w.id)));
  let eventsMoved = 0;
  if (opts.includeEvents) {
    const res = await env.DB.prepare(`UPDATE events SET date = date(date, ?) WHERE date >= ?`)
      .bind(`${days >= 0 ? '+' : ''}${days} days`, fromDate)
      .run();
    eventsMoved = res.meta.changes ?? 0;
  }
  const refreshed = await listWorkouts(env.DB, { ids: moved.map((m) => m.id) });
  return { moved: refreshed, previous, eventsMoved };
}

// ───────────────────────────── re-derivation after threshold changes ─────────────────────────────

/** Re-derive planned totals of structured workouts dated ≥ from (optionally one sport). */
export async function rederiveWorkouts(env: Env, opts: { from: LocalDate; sport?: Sport }): Promise<number> {
  const resolve = await thresholdResolver(env.DB);
  const list = (await listWorkouts(env.DB, { from: opts.from })).filter((w) => hasSteps(w.structure) && (!opts.sport || w.sport === opts.sport));
  const changed: PlannedWorkout[] = [];
  for (const w of list) {
    const flags = autoFlags(w, resolve(w.date, w.sport));
    const d = deriveWorkout(w, resolve(w.date, w.sport), { intensity: flags.intensity, title: flags.title, unstructured: false });
    if (d.plannedLoad !== w.plannedLoad || d.plannedDurationSec !== w.plannedDurationSec || d.plannedDistanceM !== w.plannedDistanceM)
      changed.push(d);
  }
  await updateWorkouts(env.DB, changed);
  return changed.length;
}

// ───────────────────────────── estimate (builder preview) ─────────────────────────────

export async function estimatePlanned(env: Env, input: EstimateInput, today: LocalDate) {
  const date = input.date ?? today;
  const thresholds = await thresholdsOn(env.DB, date, input.sport);
  if (hasSteps(input.structure)) {
    const structure = input.structure;
    const issues: StructureIssue[] = validateStructure(structure, input.sport);
    const e = estimateWorkout(structure, input.sport, thresholds);
    const totals = derivePlannedTotals({ sport: input.sport, intensity: input.intensity ?? 'endurance', structure }, thresholds);
    const cls = classifyPlannedIntensity(structure, input.sport, thresholds);
    return {
      date,
      thresholds,
      ...totals,
      movingSec: Math.round(e.movingSec),
      timeByZoneLevel: e.timeByZoneLevel,
      profile: e.profile,
      sparkline: sparklineFromProfile(e.profile, e.durationSec),
      estimated: e.estimated,
      usedDefaults: e.usedDefaults,
      title: autoTitle(structure, input.sport, thresholds),
      intensity: cls.intensity,
      intensityReason: cls.reason,
      issues,
    };
  }
  const intensity = input.intensity ?? 'endurance';
  const totals = derivePlannedTotals(
    { sport: input.sport, intensity, plannedDurationSec: input.durationSec, plannedDistanceM: input.distanceM },
    thresholds,
  );
  return {
    date,
    thresholds,
    ...totals,
    movingSec: totals.plannedDurationSec ?? 0,
    timeByZoneLevel: [0, 0, 0, 0, 0] as [number, number, number, number, number],
    profile: [],
    sparkline: [] as number[],
    estimated: true,
    usedDefaults: false,
    title: autoTitleUnstructured({ sport: input.sport, durationSec: input.durationSec, distanceM: input.distanceM, intensity }),
    intensity,
    intensityReason: 'From the chosen intensity',
    issues: [] as StructureIssue[],
  };
}
