/**
 * Storage-agnostic sync planners (garmin.md §6). The Worker supplies small
 * repository interfaces (D1) and calls these from cron / Queues / Workflows.
 * Every function is idempotent and safe to retry:
 *  - activities are keyed by garminActivityId (upsert);
 *  - pushes tag the Garmin workout with `[cadence:<plannedId>:<fingerprint>]`
 *    so a retry after a crash between "create" and "store ids" adopts the orphan
 *    instead of creating a duplicate.
 */
import type { GarminLink, LocalDate, PlannedWorkout, ThresholdSnapshot, WellnessDay } from '@cadence/core/domain';
import { addDays, diffDays, eachDay } from '@cadence/core/time';
import type { GarminClient } from './client';
import { isNotFound } from './errors';
import { mapActivitySummary, mapWellnessRange, type NormalizedActivity, type WellnessRaw } from './mapping';
import { asArray, isObject, str, toIsoInstant } from './util';
import {
  buildWorkoutDictionary,
  makeWorkoutTag,
  parseWorkoutTag,
  toGarminWorkout,
  workoutFingerprint,
  type WorkoutDictionary,
} from './workout';

const DAY_MS = 86_400_000;

// ───────────────────────────── incremental activity pull ─────────────────────────────

export interface ActivityWatermark {
  startMs: number;
  activityId: string;
}

export interface ActivitySyncState {
  /** Newest activity seen by a *complete* incremental pass. */
  watermark?: ActivityWatermark;
  lastSyncAt?: string;
}

/** What the repository knows about recent activities (for edit/delete detection). */
export interface KnownActivity {
  garminActivityId: string;
  startMs: number;
  editHash: string;
}

export interface PullCursor {
  start: number;
  pageSize: number;
  /** Stop paging once items are older than this (list is newest-first). */
  stopBeforeMs: number;
}

export interface IncrementalPlan {
  cursor: PullCursor;
  /** Start of the rolling re-check window (edits/deletes are detected from here on). */
  recheckFromMs: number;
}

export interface IncrementalPlanOptions {
  now: Date;
  /** Rolling edit/delete re-check window (default 14 days). */
  recheckDays?: number;
  /** Overlap below the watermark for late device uploads (default 2 days). */
  overlapDays?: number;
  pageSize?: number;
}

export function planIncrementalPull(state: ActivitySyncState, opts: IncrementalPlanOptions): IncrementalPlan {
  const now = opts.now.getTime();
  const recheckFromMs = now - (opts.recheckDays ?? 14) * DAY_MS;
  const overlapFrom = state.watermark ? state.watermark.startMs - (opts.overlapDays ?? 2) * DAY_MS : recheckFromMs;
  return {
    cursor: { start: 0, pageSize: opts.pageSize ?? 20, stopBeforeMs: Math.min(recheckFromMs, overlapFrom) },
    recheckFromMs,
  };
}

export interface PullPage {
  items: NormalizedActivity[];
  /** Items that could not be mapped (no id/start). */
  skipped: number;
  nextCursor: PullCursor | null;
  done: boolean;
}

/** One list request. `items` only contains activities at/after `stopBeforeMs`. */
export async function pullActivitiesPage(client: GarminClient, cursor: PullCursor): Promise<PullPage> {
  const raw = await client.listActivities({ start: cursor.start, limit: cursor.pageSize });
  const items: NormalizedActivity[] = [];
  let skipped = 0;
  let reachedOld = false;
  for (const r of raw) {
    let a: NormalizedActivity;
    try {
      a = mapActivitySummary(r);
    } catch {
      skipped++;
      continue;
    }
    if (a.startMs < cursor.stopBeforeMs) {
      reachedOld = true;
      continue;
    }
    items.push(a);
  }
  const done = reachedOld || raw.length < cursor.pageSize;
  return { items, skipped, done, nextCursor: done ? null : { ...cursor, start: cursor.start + raw.length } };
}

export interface ActivityDiff {
  created: NormalizedActivity[];
  updated: NormalizedActivity[];
  unchanged: NormalizedActivity[];
  /** Known ids inside the window that the list no longer returns → confirm with GET (404 = deleted). */
  missingIds: string[];
}

export function diffActivities(known: KnownActivity[], pulled: NormalizedActivity[], windowFromMs: number): ActivityDiff {
  const byId = new Map(known.map((k) => [k.garminActivityId, k]));
  const seen = new Set<string>();
  const out: ActivityDiff = { created: [], updated: [], unchanged: [], missingIds: [] };
  for (const a of pulled) {
    if (seen.has(a.garminActivityId)) continue;
    seen.add(a.garminActivityId);
    const k = byId.get(a.garminActivityId);
    if (!k) out.created.push(a);
    else if (k.editHash !== a.editHash) out.updated.push(a);
    else out.unchanged.push(a);
  }
  for (const k of known) if (k.startMs >= windowFromMs && !seen.has(k.garminActivityId)) out.missingIds.push(k.garminActivityId);
  return out;
}

/** GET each id; 404 ⇒ deleted. Returns the deleted ids. */
export async function confirmDeletions(client: GarminClient, ids: string[]): Promise<string[]> {
  const deleted: string[] = [];
  for (const id of ids) {
    try {
      await client.getActivity(id);
    } catch (e) {
      if (isNotFound(e)) deleted.push(id);
      else throw e;
    }
  }
  return deleted;
}

function newer(a: ActivityWatermark | undefined, b: NormalizedActivity): ActivityWatermark | undefined {
  if (!a || b.startMs > a.startMs || (b.startMs === a.startMs && b.garminActivityId > a.activityId)) {
    return { startMs: b.startMs, activityId: b.garminActivityId };
  }
  return a;
}

export interface ActivitySyncRepository {
  loadState(): Promise<ActivitySyncState>;
  saveState(state: ActivitySyncState): Promise<void>;
  /** Activities (not deleted) with startMs ≥ sinceMs. */
  listKnownSince(sinceMs: number): Promise<KnownActivity[]>;
  /** Idempotent upsert on garminActivityId. */
  upsert(items: NormalizedActivity[]): Promise<void>;
  /** Soft delete. */
  markDeleted(garminActivityIds: string[]): Promise<void>;
}

export interface IncrementalSyncReport {
  created: NormalizedActivity[];
  updated: NormalizedActivity[];
  deleted: string[];
  pages: number;
  /** False when the request budget ran out before reaching the window start (state not advanced). */
  complete: boolean;
  watermark?: ActivityWatermark;
}

/**
 * One cron tick: page the list newest-first down to min(watermark − overlap,
 * now − recheck window), upsert new/edited activities, confirm deletions, and
 * advance the watermark only after a complete pass. The caller enqueues FIT
 * downloads for `created` + `updated`.
 */
export async function runIncrementalSync(
  client: GarminClient,
  repo: ActivitySyncRepository,
  opts: IncrementalPlanOptions & { maxRequests?: number },
): Promise<IncrementalSyncReport> {
  const state = await repo.loadState();
  const plan = planIncrementalPull(state, opts);
  const budget = Math.max(1, opts.maxRequests ?? 10);
  const pulled: NormalizedActivity[] = [];
  let cursor: PullCursor | null = plan.cursor;
  let pages = 0;
  let complete = false;
  while (cursor && pages < budget) {
    const page = await pullActivitiesPage(client, cursor);
    pages++;
    pulled.push(...page.items);
    cursor = page.nextCursor;
    if (page.done) complete = true;
  }
  const known = await repo.listKnownSince(plan.cursor.stopBeforeMs);
  const diff = diffActivities(known, pulled, plan.recheckFromMs);
  if (diff.created.length || diff.updated.length) await repo.upsert([...diff.created, ...diff.updated]);
  let deleted: string[] = [];
  if (complete && diff.missingIds.length) {
    const remaining = Math.max(0, budget - pages);
    deleted = await confirmDeletions(client, diff.missingIds.slice(0, remaining));
    if (deleted.length) await repo.markDeleted(deleted);
  }
  let watermark = state.watermark;
  if (complete) {
    for (const a of pulled) watermark = newer(watermark, a);
    const next: ActivitySyncState = { lastSyncAt: toIsoInstant(opts.now.getTime()) };
    if (watermark) next.watermark = watermark;
    await repo.saveState(next);
  }
  const report: IncrementalSyncReport = { created: diff.created, updated: diff.updated, deleted, pages, complete };
  if (watermark) report.watermark = watermark;
  return report;
}

// ───────────────────────────── backfill ─────────────────────────────

export interface BackfillCursor {
  /** Offset into the newest-first list. */
  start: number;
  /** Oldest start time wanted (epoch ms); undefined = all history. */
  untilMs?: number;
  /** Ids of the previous page — de-dupes the overlap / offset shifts from new uploads. */
  lastPageIds: string[];
  /** Activities emitted so far (progress). */
  emitted: number;
  oldestLocalDate?: LocalDate;
}

export interface BackfillStepOptions {
  pageSize?: number;
  /** Max list requests in this invocation (Workers subrequest budget). */
  maxRequests?: number;
  /** Oldest local date to import (inclusive); only used when starting. */
  sinceDate?: LocalDate;
}

export interface BackfillStepResult {
  items: NormalizedActivity[];
  nextCursor: BackfillCursor;
  done: boolean;
}

const BACKFILL_OVERLAP = 2;

export function startBackfill(sinceDate?: LocalDate): BackfillCursor {
  const c: BackfillCursor = { start: 0, lastPageIds: [], emitted: 0 };
  if (sinceDate) c.untilMs = Date.parse(`${addDays(sinceDate, -1)}T00:00:00Z`); // one-day slack for time zones
  return c;
}

/**
 * Resumable backfill step: up to `maxRequests` list pages, newest → oldest.
 * Persist `nextCursor` (small JSON) and call again (Queue/Workflow step) until
 * `done`. Pages overlap by up to 2 items (≤ pageSize/3) so deletions during the
 * backfill cannot make us skip an activity; the overlap and offset shifts caused
 * by new uploads are de-duplicated with `lastPageIds`.
 */
export async function runBackfillStep(
  client: GarminClient,
  cursor: BackfillCursor | null,
  opts: BackfillStepOptions = {},
): Promise<BackfillStepResult> {
  const pageSize = opts.pageSize ?? 100;
  const overlap = Math.min(BACKFILL_OVERLAP, Math.floor(pageSize / 3));
  let c: BackfillCursor = cursor ? { ...cursor, lastPageIds: [...cursor.lastPageIds] } : startBackfill(opts.sinceDate);
  const items: NormalizedActivity[] = [];
  const maxRequests = Math.max(1, opts.maxRequests ?? 1);
  for (let req = 0; req < maxRequests; req++) {
    const raw = await client.listActivities({ start: c.start, limit: pageSize });
    const prev = new Set(c.lastPageIds);
    const ids: string[] = [];
    let reachedEnd = raw.length < pageSize;
    for (const r of raw) {
      let a: NormalizedActivity;
      try {
        a = mapActivitySummary(r);
      } catch {
        continue;
      }
      ids.push(a.garminActivityId);
      if (c.untilMs !== undefined && a.startMs < c.untilMs) {
        reachedEnd = true;
        continue;
      }
      if (prev.has(a.garminActivityId)) continue;
      items.push(a);
      if (!c.oldestLocalDate || a.localDate < c.oldestLocalDate) c.oldestLocalDate = a.localDate;
    }
    c = {
      ...c,
      start: reachedEnd ? c.start + raw.length : c.start + Math.max(1, raw.length - overlap),
      lastPageIds: ids,
    };
    if (reachedEnd) return { items, nextCursor: { ...c, emitted: c.emitted + items.length }, done: true };
  }
  return { items, nextCursor: { ...c, emitted: c.emitted + items.length }, done: false };
}

// ───────────────────────────── wellness ─────────────────────────────

export interface WellnessPullResult {
  days: WellnessDay[];
  /** Which sources answered (debugging partial Personal API coverage). */
  sources: (keyof WellnessRaw)[];
}

function chunks(start: LocalDate, end: LocalDate, maxDays: number): [LocalDate, LocalDate][] {
  const out: [LocalDate, LocalDate][] = [];
  for (let s = start; s <= end; s = addDays(s, maxDays)) {
    const e = addDays(s, maxDays - 1);
    out.push([s, e < end ? e : end]);
  }
  return out;
}

/**
 * Wellness for [startDate, endDate] via range endpoints (≤ 28-day chunks).
 * Always re-pull yesterday and today — values fill in late (garmin.md §6.1).
 * Sources unavailable on the current API tier are skipped silently.
 */
export async function pullWellnessRange(client: GarminClient, startDate: LocalDate, endDate: LocalDate): Promise<WellnessPullResult> {
  if (diffDays(startDate, endDate) < 0) return { days: [], sources: [] };
  const raw: Record<keyof WellnessRaw, unknown[]> = {
    sleep: [],
    hrv: [],
    dailySummaries: [],
    bodyBattery: [],
    stress: [],
    weight: [],
    vo2max: [],
    readiness: [],
    restingHr: [],
  };
  const caps = await client.capabilities();
  for (const [s, e] of chunks(startDate, endDate, 28)) {
    const add = (k: keyof WellnessRaw, v: unknown) => {
      if (v !== undefined && v !== null) raw[k].push(v);
    };
    add('hrv', await client.getHrvRange(s, e));
    add('sleep', await client.getSleepRange(s, e));
    add('dailySummaries', await client.getDailySummaries(s, e));
    add('bodyBattery', await client.getBodyBattery(s, e));
    add('stress', await client.getStress(s, e));
    add('weight', await client.getWeight(s, e));
    add('vo2max', await client.getVo2Max(s, e));
    if (caps.di) {
      add('readiness', await client.getTrainingReadiness(s, e));
      add('restingHr', await client.getRestingHr(s, e));
    }
  }
  const wr: WellnessRaw = {};
  const sources: (keyof WellnessRaw)[] = [];
  for (const [k, v] of Object.entries(raw) as [keyof WellnessRaw, unknown[]][]) {
    if (v.length) {
      wr[k] = v;
      sources.push(k);
    }
  }
  const wanted = new Set(eachDay(startDate, endDate));
  const days = mapWellnessRange(wr).filter((d) => wanted.has(d.date) && Object.keys(d).length > 1);
  return { days, sources };
}

// ───────────────────────────── workout push ─────────────────────────────

export interface PushOptions {
  now?: Date;
  /** Reuse a dictionary (else fetched once per client via getWorkoutTypes, with fallbacks). */
  dictionary?: WorkoutDictionary;
  /** Scan `/workout-service/workouts` for tagged orphans (default true; +1 request). */
  reconcileByTag?: boolean;
}

/** True when the plan should be (re)pushed: in the auto-push window and changed since the last push. */
export function needsPush(p: PlannedWorkout, today: LocalDate, autoPushDays: number): boolean {
  if (p.date < today || diffDays(today, p.date) > autoPushDays) return false;
  if (p.status === 'skipped') return !!p.garmin.workoutId || !!p.garmin.scheduleId;
  if (p.garmin.syncState !== 'synced' || !p.garmin.lastPushedAt) return true;
  return p.updatedAt > p.garmin.lastPushedAt;
}

const dictCache = new WeakMap<GarminClient, WorkoutDictionary>();

async function dictionaryFor(client: GarminClient): Promise<WorkoutDictionary> {
  const hit = dictCache.get(client);
  if (hit) return hit;
  const d = buildWorkoutDictionary(await client.getWorkoutTypes());
  dictCache.set(client, d);
  return d;
}

function scheduleIdOf(o: unknown): string | undefined {
  return str(o, 'workoutScheduleId', 'scheduleId', 'id');
}

function scheduleDateOf(o: unknown): string | undefined {
  const d = str(o, 'calendarDate', 'date');
  return d?.slice(0, 10);
}

function scheduleWorkoutIdOf(o: unknown): string | undefined {
  if (!isObject(o)) return undefined;
  return str(o, 'workoutId') ?? str(o.workout, 'workoutId');
}

/**
 * Create-or-replace + schedule (garmin.md §5.4): Garmin workouts are treated as
 * immutable. Unchanged content (same fingerprint) keeps the workout; a changed
 * plan creates a new workout, schedules it, then unschedules + deletes the old
 * one. A moved date reschedules. Skipped plans are removed from Garmin.
 *
 * Retry-safe: throws on Garmin errors (the caller marks syncState 'error');
 * re-running after a partial failure adopts the already-created workout via its
 * tag and the existing schedule entry instead of duplicating them.
 */
export async function pushPlannedWorkout(
  client: GarminClient,
  planned: PlannedWorkout,
  thresholds: ThresholdSnapshot,
  existingLink: GarminLink | undefined,
  opts: PushOptions = {},
): Promise<GarminLink> {
  const now = opts.now ?? new Date();
  const existing: GarminLink = existingLink ?? { syncState: 'none' };
  if (planned.status === 'skipped') return removePlannedWorkout(client, existing, now);

  const dictionary = opts.dictionary ?? (await dictionaryFor(client));
  const base = toGarminWorkout(planned, thresholds, { dictionary });
  const fp = workoutFingerprint(base);
  const tag = makeWorkoutTag(planned.id, fp);
  const payload = toGarminWorkout(planned, thresholds, { dictionary, tag });
  const myTag = parseWorkoutTag(tag)!;

  let workoutId: string | undefined;
  const stale = new Set<string>();
  if (existing.workoutId) {
    const w = await client.getWorkout(existing.workoutId);
    if (w && parseWorkoutTag(w.description)?.fingerprint === myTag.fingerprint) workoutId = existing.workoutId;
    else if (w) stale.add(existing.workoutId);
  }
  if (!workoutId && (opts.reconcileByTag ?? true)) {
    for (const item of await client.listWorkouts({ limit: 50 })) {
      const t = parseWorkoutTag(str(item, 'description')) ?? parseWorkoutTag(str(item, 'workoutName'));
      const id = str(item, 'workoutId');
      if (!t || !id || t.plannedId !== myTag.plannedId) continue;
      if (t.fingerprint === myTag.fingerprint && !workoutId) workoutId = id;
      else stale.add(id);
    }
  }
  if (!workoutId) workoutId = String((await client.createWorkout(payload)).workoutId);
  stale.delete(workoutId);

  // schedule
  let scheduleId: string | undefined;
  if (existing.scheduleId && existing.workoutId === workoutId) {
    const s = await client.getSchedule(existing.scheduleId);
    const sw = scheduleWorkoutIdOf(s);
    if (s && scheduleDateOf(s) === planned.date && (!sw || sw === workoutId)) scheduleId = existing.scheduleId;
  }
  if (!scheduleId) {
    // Adopt an entry created by a crashed earlier attempt (same workout, same day).
    try {
      const period = await client.getScheduledWorkouts(planned.date, planned.date);
      const list = Array.isArray(period) ? period : asArray(isObject(period) ? (period.workoutScheduleList ?? period.items) : undefined);
      for (const e of list) {
        if (scheduleWorkoutIdOf(e) === workoutId && scheduleDateOf(e) === planned.date) {
          scheduleId = scheduleIdOf(e);
          if (scheduleId) break;
        }
      }
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
  }
  if (!scheduleId) scheduleId = await client.scheduleWorkout(workoutId, planned.date);
  if (existing.scheduleId && existing.scheduleId !== scheduleId) await client.unschedule(existing.scheduleId);
  for (const id of stale) await client.deleteWorkout(id);

  return { workoutId, scheduleId, syncState: 'synced', lastPushedAt: toIsoInstant(now.getTime()) };
}

/** Unschedule + delete (idempotent). */
export async function removePlannedWorkout(client: GarminClient, link: GarminLink, now: Date = new Date()): Promise<GarminLink> {
  if (link.scheduleId) await client.unschedule(link.scheduleId);
  if (link.workoutId) await client.deleteWorkout(link.workoutId);
  return { syncState: 'none', lastPushedAt: toIsoInstant(now.getTime()) };
}
