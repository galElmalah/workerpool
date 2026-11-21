/**
 * Garmin sync engine (garmin.md §6), driven by cron, `POST /garmin/sync`, the backfill endpoints
 * and the demo seeder. One run:
 *
 *   token upkeep (daily DI refresh) → incremental activity pull (watermark + 14-day re-check window,
 *   edits re-queued, upstream deletes → soft delete) → FIT download + ingest of queued activities →
 *   wellness for the last few days → physiology → suggested thresholds (daily) → auto-push of planned
 *   workouts in the window → ONE bounded backfill step.
 *
 * Everything is bounded for Workers limits: a request budget per invocation (default 40 Garmin
 * calls), a wall-clock deadline, and progress persisted in `sync_state` (work queues, cursors) so
 * the next tick continues. A lease lock in `sync_state` prevents overlapping runs.
 */
import type { GarminStatus, LocalDate, SyncLogEntry, Threshold, ThresholdKind, WellnessDay } from '@cadence/core/domain';
import { addDays, diffDays } from '@cadence/core/time';
import {
  GarminAuthError,
  GarminBlockedError,
  GarminRateLimitError,
  isNotFound,
  pullWellnessRange,
  runBackfillStep,
  runIncrementalSync,
  startBackfill,
  toThresholdSnapshot,
  type ActivitySyncRepository,
  type ActivitySyncState,
  type BackfillCursor,
  type GarminClient,
  type GarminUserSettings,
  type NormalizedActivity,
} from '@cadence/garmin';
import { getActivityByGarminId, softDeleteActivity } from '../db/activities';
import { upsertWellnessDevice } from '../db/furniture';
import { garminCounts, getGarminAuth, knownGarminHashes, listKnownGarminActivities, setGarminSyncResult, type GarminCounts } from '../db/garmin';
import { getSettings } from '../db/settings';
import {
  acquireLock,
  clearQueue,
  deleteState,
  enqueue,
  extendLock,
  failStaleRunning,
  getState,
  insertSyncLog,
  logSync,
  putState,
  queueSize,
  releaseLock,
  takeQueue,
  updateSyncLog,
  type Lease,
} from '../db/sync';
import { insertThreshold, listThresholds } from '../db/thresholds';
import { ApiError } from '../lib/http';
import { ingestActivity } from './ingest';
import type { IngestInput } from './ingest.types';
import { decryptCredentials, errorMessage, getGarminClient, mfaPending, syncNow, syncToday, toApiError } from './garmin';
import { isDemo } from '../env';
import { pushPending } from './push';

// ───────────────────────────── constants & state keys ─────────────────────────────

export const DEFAULT_MAX_REQUESTS = 40;
const DEFAULT_DEADLINE_MS = 25_000;
const LOCK_NAME = 'sync';
const LOCK_TTL_MS = 120_000;

const K = {
  activities: 'garmin:activities',
  wellness: 'garmin:wellness',
  physiology: 'garmin:physiology',
  tokenUpkeep: 'garmin:token_upkeep',
  backoff: 'garmin:backoff',
  backfill: 'garmin:backfill',
} as const;
const Q_INCREMENTAL = 'inc';
const Q_BACKFILL = 'bf';

/** Every sync_state key / queue owned by the Garmin sync (wiped on disconnect). */
export async function clearSyncState(env: Env): Promise<void> {
  await deleteState(env.DB, ...Object.values(K), `lock:${LOCK_NAME}`);
  await clearQueue(env.DB, Q_INCREMENTAL);
  await clearQueue(env.DB, Q_BACKFILL);
}

// ───────────────────────────── budget ─────────────────────────────

/** Request + time budget shared by every phase of one invocation. */
export class Budget {
  private readonly startCount: number;
  private readonly deadline: number;
  constructor(
    private readonly client: GarminClient,
    readonly maxRequests: number,
    deadlineMs: number,
  ) {
    this.startCount = client.requestCount;
    this.deadline = Date.now() + deadlineMs;
  }
  get used(): number {
    return this.client.requestCount - this.startCount;
  }
  get left(): number {
    return Math.max(0, this.maxRequests - this.used);
  }
  /** At least `n` requests left and time remaining. */
  has(n = 1): boolean {
    return this.left >= n && Date.now() < this.deadline;
  }
}

// ───────────────────────────── ingest queue ─────────────────────────────

interface QueuedActivity {
  a: NormalizedActivity;
  attempts: number;
}

const sortKeyOf = (a: NormalizedActivity) => `${String(a.startMs).padStart(15, '0')}:${a.garminActivityId}`;

export async function enqueueActivities(env: Env, queue: string, items: NormalizedActivity[]): Promise<void> {
  if (items.length) await enqueue<QueuedActivity>(env.DB, queue, items.map((a) => ({ sortKey: sortKeyOf(a), value: { a, attempts: 0 } })));
}

export interface IngestHooks {
  /** Download the original FIT for this activity (default: yes, unless manual / multisport parent). */
  withFit?: (a: NormalizedActivity) => boolean;
  /** Extra athlete-entered fields applied on creation (the demo seeder uses this). */
  enrich?: (a: NormalizedActivity) => IngestInput['user'] | undefined;
}

export interface DrainResult {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
  paired: number;
  processed: number;
  remaining: number;
  /** Local dates touched (for callers that want to re-run pairing). */
  dates: LocalDate[];
  errors: string[];
}

const emptyDrain = (): DrainResult => ({ created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0, paired: 0, processed: 0, remaining: 0, dates: [], errors: [] });

/** Download (FIT) + ingest one Garmin activity. A missing original file falls back to the summary. */
export async function ingestGarminActivity(env: Env, client: GarminClient, a: NormalizedActivity, hooks: IngestHooks = {}) {
  const wantFit = hooks.withFit ? hooks.withFit(a) : !a.manual && !a.isMultisportParent;
  let fit: Uint8Array | undefined;
  if (wantFit) {
    try {
      fit = await client.downloadOriginalFit(a.garminActivityId);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (!isNotFound(e) && code !== 'no_fit') throw e;
    }
  }
  const user = hooks.enrich?.(a);
  const input: IngestInput = { source: 'garmin', summary: a };
  if (fit) input.fit = fit;
  if (user) input.user = user;
  return ingestActivity(env, input);
}

/**
 * Process queued activities newest first until the queue, `maxItems`, or the budget runs out.
 * A failing item is retried on later runs; after 3 attempts it is ingested from its summary only.
 */
export async function drainQueue(
  env: Env,
  client: GarminClient,
  queue: string,
  budget: Budget,
  opts: IngestHooks & { maxItems?: number } = {},
): Promise<DrainResult> {
  const out = emptyDrain();
  const max = opts.maxItems ?? Number.POSITIVE_INFINITY;
  while (out.processed < max && budget.has(1)) {
    const batch = await takeQueue<QueuedActivity>(env.DB, queue, Math.min(10, max - out.processed));
    if (!batch.length) break;
    for (const { key, value } of batch) {
      if (out.processed >= max || !budget.has(1)) break;
      out.processed++;
      try {
        const lastTry = value.attempts >= 2;
        const hooks: IngestHooks = lastTry ? { ...opts, withFit: () => false } : opts;
        const res = await ingestGarminActivity(env, client, value.a, hooks);
        out[res.outcome]++;
        if (res.pairedWorkoutId && res.outcome === 'created') out.paired++;
        out.dates.push(value.a.localDate);
        await deleteState(env.DB, key);
      } catch (e) {
        if (isFatal(e)) throw e;
        out.failed++;
        out.errors.push(`${value.a.garminActivityId}: ${errorMessage(e)}`);
        await putState(env.DB, key, { ...value, attempts: value.attempts + 1 });
      }
    }
  }
  out.remaining = await queueSize(env.DB, queue);
  return out;
}

/** Errors that should abort the whole run (auth, blocking, rate limits) rather than one item. */
function isFatal(e: unknown): boolean {
  return e instanceof GarminAuthError || e instanceof GarminBlockedError || e instanceof GarminRateLimitError;
}

// ───────────────────────────── incremental ─────────────────────────────

/**
 * D1 repository for `runIncrementalSync`. Known activities include locally soft-deleted ones (so
 * they are not re-imported); `deleted` counts only rows actually soft-deleted by this run.
 */
function activityRepo(env: Env): ActivitySyncRepository & { deleted: number } {
  const repo: ActivitySyncRepository & { deleted: number } = {
    deleted: 0,
    loadState: async () => (await getState<ActivitySyncState>(env.DB, K.activities)) ?? {},
    saveState: (s) => putState(env.DB, K.activities, s),
    listKnownSince: async (ms) =>
      (await listKnownGarminActivities(env.DB, ms)).map((k) => ({ garminActivityId: k.garminActivityId, startMs: k.startMs, editHash: k.editHash })),
    upsert: (items) => enqueueActivities(env, Q_INCREMENTAL, items),
    markDeleted: async (ids) => {
      for (const id of ids) {
        const row = await getActivityByGarminId(env.DB, id);
        if (row && !row.deleted) {
          await softDeleteActivity(env.DB, row.id);
          repo.deleted++;
        }
      }
    },
  };
  return repo;
}

// ───────────────────────────── wellness ─────────────────────────────

interface WellnessState {
  lastDate?: LocalDate;
}

/** Pull device wellness for [from, to] in ≤ 28-day chunks while the budget allows. Returns days upserted. */
export async function pullWellness(env: Env, client: GarminClient, from: LocalDate, to: LocalDate, budget?: Budget): Promise<{ days: number; through?: LocalDate }> {
  let days = 0;
  let through: LocalDate | undefined;
  for (let s = from; s <= to; s = addDays(s, 28)) {
    if (budget && !budget.has(10)) break;
    const e = addDays(s, 27) < to ? addDays(s, 27) : to;
    const res = await pullWellnessRange(client, s, e);
    const device = res.days.map(stripManual).filter((d) => Object.keys(d).length > 1);
    if (device.length) await upsertWellnessDevice(env.DB, device);
    days += device.length;
    through = e;
  }
  return through ? { days, through } : { days };
}

function stripManual(d: WellnessDay): WellnessDay {
  const { feel: _f, soreness: _s, note: _n, ...rest } = d;
  return rest;
}

// ───────────────────────────── physiology → thresholds ─────────────────────────────

const THRESHOLD_MAP: { field: keyof ReturnType<typeof toThresholdSnapshot>; kind: ThresholdKind; sport: Threshold['sport']; tol: number }[] = [
  { field: 'ftp', kind: 'ftp', sport: 'bike', tol: 1 },
  { field: 'runThresholdMps', kind: 'run_threshold', sport: 'run', tol: 0.01 },
  { field: 'lthr', kind: 'lthr', sport: 'all', tol: 0.5 },
  { field: 'hrMax', kind: 'hr_max', sport: 'all', tol: 0.5 },
  { field: 'hrRest', kind: 'hr_rest', sport: 'all', tol: 0.5 },
  { field: 'weightKg', kind: 'weight', sport: 'all', tol: 0.2 },
];

/**
 * Suggested thresholds from Garmin's user settings: inserted as `source: 'garmin'` (effective today)
 * only when the value changed since Garmin last reported it, differs from the current value, and
 * the athlete has not set a manual value dated today or later.
 */
export async function applyGarminThresholds(env: Env, settings: GarminUserSettings, today: LocalDate): Promise<Threshold[]> {
  const snap = toThresholdSnapshot(settings);
  const all = await listThresholds(env.DB); // newest effective date first
  const inserted: Threshold[] = [];
  for (const m of THRESHOLD_MAP) {
    const v = snap[m.field];
    if (v === undefined || !(v > 0)) continue;
    const same = all.filter((t) => t.kind === m.kind && t.sport === m.sport && t.effectiveFrom <= today);
    const latest = same[0];
    const lastGarmin = same.find((t) => t.source === 'garmin');
    const future = all.find((t) => t.kind === m.kind && t.sport === m.sport && t.source === 'manual' && t.effectiveFrom >= today);
    if (latest && Math.abs(latest.value - v) < m.tol) continue;
    if (lastGarmin && Math.abs(lastGarmin.value - v) < m.tol) continue;
    if (future) continue;
    inserted.push(
      await insertThreshold(env.DB, { kind: m.kind, sport: m.sport, value: v, effectiveFrom: today, source: 'garmin', note: 'From Garmin Connect' }),
    );
  }
  return inserted;
}

// ───────────────────────────── backfill ─────────────────────────────

export type BackfillPhase = 'list' | 'activities' | 'wellness' | 'done' | 'cancelled' | 'error';

export interface BackfillState {
  id: string;
  months: number;
  sinceDate: LocalDate;
  untilDate: LocalDate;
  startedAt: string;
  finishedAt?: string;
  phase: BackfillPhase;
  cursor: BackfillCursor | null;
  listed: number;
  total: number | null;
  done: number;
  created: number;
  updated: number;
  failed: number;
  oldestDate?: LocalDate;
  wellnessCursor?: LocalDate;
  wellnessDays: number;
  /** Wellness range is pulled as part of the backfill. */
  wellness: boolean;
  lastError?: string;
  steps: number;
  /** sync_log entry created at start (status running → final status). */
  logId?: string;
}

export interface BackfillProgress {
  running: boolean;
  phase: BackfillPhase;
  done: number;
  total: number | null;
  listed: number;
  created: number;
  updated: number;
  failed: number;
  wellnessDays: number;
  oldestDate?: LocalDate;
  sinceDate: LocalDate;
  startedAt: string;
  finishedAt?: string;
  steps: number;
  lastError?: string;
}

export async function getBackfill(env: Env): Promise<BackfillState | undefined> {
  return getState<BackfillState>(env.DB, K.backfill);
}

export function backfillProgress(s: BackfillState): BackfillProgress {
  const p: BackfillProgress = {
    running: s.phase === 'list' || s.phase === 'activities' || s.phase === 'wellness',
    phase: s.phase,
    done: s.done,
    total: s.total,
    listed: s.listed,
    created: s.created,
    updated: s.updated,
    failed: s.failed,
    wellnessDays: s.wellnessDays,
    sinceDate: s.sinceDate,
    startedAt: s.startedAt,
    steps: s.steps,
  };
  if (s.oldestDate) p.oldestDate = s.oldestDate;
  if (s.finishedAt) p.finishedAt = s.finishedAt;
  if (s.lastError) p.lastError = s.lastError;
  return p;
}

function monthsBefore(d: LocalDate, months: number): LocalDate {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  const whole = Math.floor(months);
  const dt = new Date(Date.UTC(y, m - 1 - whole, day));
  const frac = months - whole;
  return addDays(dt.toISOString().slice(0, 10), -Math.round(frac * 30.44));
}

/** Create a fresh backfill job (replaces any previous one). Does not run a step. */
export async function createBackfill(env: Env, opts: { months: number; wellness?: boolean; today?: LocalDate }): Promise<BackfillState> {
  const today = opts.today ?? (await syncToday(env));
  const sinceDate = monthsBefore(today, opts.months);
  const prev = await getBackfill(env);
  if (prev?.logId && (prev.phase === 'list' || prev.phase === 'activities' || prev.phase === 'wellness')) {
    await updateSyncLog(env.DB, prev.logId, { status: 'ok', summary: `Backfill restarted after ${prev.done} activities` });
  }
  await clearQueue(env.DB, Q_BACKFILL);
  const state: BackfillState = {
    id: crypto.randomUUID(),
    months: opts.months,
    sinceDate,
    untilDate: today,
    startedAt: new Date().toISOString(),
    phase: 'list',
    cursor: startBackfill(sinceDate),
    listed: 0,
    total: null,
    done: 0,
    created: 0,
    updated: 0,
    failed: 0,
    wellnessDays: 0,
    wellness: opts.wellness ?? true,
    steps: 0,
  };
  const entry = await insertSyncLog(env.DB, { kind: 'backfill', status: 'running', summary: `Backfill running: ${formatMonths(opts.months)} of history (since ${sinceDate})` });
  state.logId = entry.id;
  await putState(env.DB, K.backfill, state);
  return state;
}

export async function cancelBackfill(env: Env): Promise<BackfillState | undefined> {
  const s = await getBackfill(env);
  await clearQueue(env.DB, Q_BACKFILL);
  if (!s) return undefined;
  if (s.phase === 'done' || s.phase === 'cancelled') return s;
  const next: BackfillState = { ...s, phase: 'cancelled', finishedAt: new Date().toISOString() };
  await putState(env.DB, K.backfill, next);
  await finishBackfillLog(env, next, { status: 'ok', summary: `Backfill cancelled after ${s.done} activities` });
  return next;
}

async function finishBackfillLog(env: Env, s: BackfillState, entry: { status: SyncLogEntry['status']; summary: string }): Promise<void> {
  const durationMs = Date.parse(s.finishedAt ?? new Date().toISOString()) - Date.parse(s.startedAt);
  if (s.logId) await updateSyncLog(env.DB, s.logId, { ...entry, durationMs });
  else await logSync(env.DB, { kind: 'backfill', ...entry, durationMs });
}

const formatMonths = (m: number) => (m === 1 ? '1 month' : `${m} months`);

export interface BackfillStepOptions extends IngestHooks {
  /** Activities ingested at most in this step (default 20). */
  maxActivities?: number;
  /** List page size (default 100). */
  pageSize?: number;
}

/**
 * One bounded step of the active backfill: list pages (newest → oldest, de-duplicated against what
 * is stored) into the backfill queue, then FIT download + ingest of queued activities, then the
 * wellness range in 28-day chunks. Returns the updated state (undefined when none is active).
 */
export async function backfillStep(env: Env, client: GarminClient, budget: Budget, opts: BackfillStepOptions = {}): Promise<BackfillState | undefined> {
  let s = await getBackfill(env);
  if (!s || !(s.phase === 'list' || s.phase === 'activities' || s.phase === 'wellness')) return s;
  s = { ...s, steps: s.steps + 1 };
  const maxActivities = opts.maxActivities ?? 20;
  let ingested = 0;
  try {
    while (budget.has(1)) {
      if (s.phase === 'list') {
        const res = await runBackfillStep(client, s.cursor, { pageSize: opts.pageSize ?? 100, maxRequests: 1, sinceDate: s.sinceDate });
        const known = await knownGarminHashes(env.DB, res.items.map((a) => a.garminActivityId));
        const fresh = res.items.filter((a) => known.get(a.garminActivityId) !== a.editHash);
        await enqueueActivities(env, Q_BACKFILL, fresh);
        s.listed += fresh.length;
        s.cursor = res.nextCursor;
        for (const a of res.items) if (!s.oldestDate || a.localDate < s.oldestDate) s.oldestDate = a.localDate;
        if (res.done) {
          s.phase = 'activities';
          s.total = s.done + (await queueSize(env.DB, Q_BACKFILL));
        }
        await putState(env.DB, K.backfill, s);
        continue;
      }
      if (s.phase === 'activities') {
        if (ingested >= maxActivities) break;
        const r = await drainQueue(env, client, Q_BACKFILL, budget, { ...opts, maxItems: maxActivities - ingested });
        ingested += r.processed;
        s.done += r.processed - r.failed;
        s.created += r.created;
        s.updated += r.updated;
        s.failed += r.failed;
        if (r.errors.length) s.lastError = r.errors.at(-1);
        if (r.remaining === 0) {
          s.total = s.done;
          if (s.wellness) {
            s.phase = 'wellness';
            s.wellnessCursor = s.untilDate;
          } else s.phase = 'done';
        }
        await putState(env.DB, K.backfill, s);
        if (r.processed === 0 && r.remaining > 0) break; // budget exhausted mid-batch
        continue;
      }
      if (s.phase === 'wellness') {
        const end = s.wellnessCursor ?? s.untilDate;
        if (end < s.sinceDate) {
          s.phase = 'done';
          continue;
        }
        if (!budget.has(10)) break;
        const start = addDays(end, -27) > s.sinceDate ? addDays(end, -27) : s.sinceDate;
        const w = await pullWellness(env, client, start, end);
        s.wellnessDays += w.days;
        s.wellnessCursor = addDays(start, -1);
        if (s.wellnessCursor < s.sinceDate) s.phase = 'done';
        await putState(env.DB, K.backfill, s);
        continue;
      }
      break; // done
    }
  } catch (e) {
    s.lastError = errorMessage(e);
    await putState(env.DB, K.backfill, s);
    throw e;
  }
  if (s.phase === 'done' && !s.finishedAt) {
    s.finishedAt = new Date().toISOString();
    await finishBackfillLog(env, s, {
      status: s.failed ? 'error' : 'ok',
      summary: `Backfill complete: ${s.done} activities${s.wellness ? `, ${s.wellnessDays} days of wellness` : ''}${s.failed ? `, ${s.failed} failed` : ''}`,
    });
  }
  await putState(env.DB, K.backfill, s);
  return s;
}

// ───────────────────────────── backoff ─────────────────────────────

interface Backoff {
  until: number;
  reason: string;
}

async function activeBackoff(env: Env): Promise<Backoff | undefined> {
  const b = await getState<Backoff>(env.DB, K.backoff);
  return b && b.until > Date.now() ? b : undefined;
}

async function noteFailure(env: Env, e: unknown): Promise<void> {
  if (e instanceof GarminBlockedError) {
    await putState(env.DB, K.backoff, { until: Date.now() + 6 * 3_600_000, reason: 'blocked' } satisfies Backoff);
  } else if (e instanceof GarminRateLimitError) {
    const wait = Math.min(6 * 3_600_000, Math.max(15 * 60_000, e.retryAfterMs ?? 3_600_000));
    await putState(env.DB, K.backoff, { until: Date.now() + wait, reason: 'rate_limited' } satisfies Backoff);
  }
  const authBroken = e instanceof GarminAuthError && e.code !== 'no_credentials';
  await setGarminSyncResult(env.DB, { lastError: toApiError(e).message, ...(authBroken ? { state: 'error' as const } : {}) });
}

// ───────────────────────────── lock helper ─────────────────────────────

/** Run `fn` holding the sync lease; throws 409 `sync_in_progress` when another run holds it. */
export async function withSyncLock<T>(env: Env, fn: (lease: Lease) => Promise<T>): Promise<T> {
  const lease = await acquireLock(env.DB, LOCK_NAME, LOCK_TTL_MS);
  if (!lease) throw new ApiError(409, 'sync_in_progress', 'A Garmin sync is already running; try again in a moment.');
  try {
    return await fn(lease);
  } finally {
    await releaseLock(env.DB, lease);
  }
}

export async function requireClient(env: Env): Promise<GarminClient> {
  const client = await getGarminClient(env);
  if (!client) throw new ApiError(409, 'garmin_not_connected', 'Connect Garmin first (Settings → Garmin).');
  return client;
}

// ───────────────────────────── runSync ─────────────────────────────

export interface SyncOptions {
  reason: 'cron' | 'manual' | 'connect' | 'demo';
  /** Garmin request budget for this invocation (default 40). */
  maxRequests?: number;
  deadlineMs?: number;
  /** Days of wellness to (re)pull when no watermark exists (default 3; 14 on connect). */
  wellnessDays?: number;
  skipBackfill?: boolean;
  skipPush?: boolean;
  /** Ignore an active rate-limit/blocked backoff (default false). */
  ignoreBackoff?: boolean;
  hooks?: IngestHooks;
}

export interface SyncReport {
  status: 'ok' | 'error' | 'skipped';
  reason: SyncOptions['reason'];
  skippedBecause?: 'not_connected' | 'locked' | 'backoff';
  activities: { created: number; updated: number; unchanged: number; deleted: number; failed: number; queued: number; complete: boolean };
  wellnessDays: number;
  thresholds: number;
  push: { pushed: number; removed: number; failed: number; remaining: number };
  backfill?: BackfillProgress;
  requests: number;
  durationMs: number;
  summary: string;
  error?: { code: string; message: string };
}

function emptyReport(reason: SyncOptions['reason']): SyncReport {
  return {
    status: 'ok',
    reason,
    activities: { created: 0, updated: 0, unchanged: 0, deleted: 0, failed: 0, queued: 0, complete: true },
    wellnessDays: 0,
    thresholds: 0,
    push: { pushed: 0, removed: 0, failed: 0, remaining: 0 },
    requests: 0,
    durationMs: 0,
    summary: '',
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function summarize(r: SyncReport): string {
  const a = r.activities;
  const parts: string[] = [];
  if (a.created) parts.push(`${plural(a.created, 'new activity', 'new activities')}`);
  if (a.updated) parts.push(`${a.updated} updated`);
  if (a.deleted) parts.push(`${a.deleted} deleted`);
  if (!parts.length) parts.push('no new activities');
  if (r.wellnessDays) parts.push(`wellness ${plural(r.wellnessDays, 'day')}`);
  if (r.thresholds) parts.push(`${plural(r.thresholds, 'threshold')} from Garmin`);
  if (r.push.pushed) parts.push(`pushed ${plural(r.push.pushed, 'workout')}`);
  if (r.push.removed) parts.push(`removed ${plural(r.push.removed, 'skipped workout')}`);
  if (r.push.failed) parts.push(`${r.push.failed} push failed`);
  if (a.queued) parts.push(`${a.queued} queued for next run`);
  if (r.backfill?.running) parts.push(`backfill ${r.backfill.done}/${r.backfill.total ?? '?'}`);
  const s = parts.join(', ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * One sync run (see module doc). Never throws for Garmin problems: they are logged, recorded on
 * `garmin_auth.last_error` and returned in `report.error`. Returns `status: 'skipped'` when not
 * connected, locked by another run, or backing off after a block / rate limit.
 */
export async function runSync(env: Env, opts: SyncOptions): Promise<SyncReport> {
  const started = Date.now();
  const report = emptyReport(opts.reason);
  const auth = await getGarminAuth(env.DB);
  if (!auth || auth.state === 'needs_mfa') return { ...report, status: 'skipped', skippedBecause: 'not_connected', summary: 'Garmin is not connected' };
  if (!opts.ignoreBackoff) {
    const b = await activeBackoff(env);
    if (b) {
      return {
        ...report,
        status: 'skipped',
        skippedBecause: 'backoff',
        summary: `Paused until ${new Date(b.until).toISOString()} (${b.reason.replace('_', ' ')})`,
      };
    }
  }
  const lease = await acquireLock(env.DB, LOCK_NAME, LOCK_TTL_MS);
  if (!lease) return { ...report, status: 'skipped', skippedBecause: 'locked', summary: 'Another sync is running' };
  await failStaleRunning(env.DB, 'pull_activities'); // we hold the lock: any running entry is a dead run
  const log = await insertSyncLog(env.DB, { kind: 'pull_activities', status: 'running', summary: 'Syncing with Garmin…' });
  let client: GarminClient | null = null;
  let budget: Budget | undefined;
  try {
    client = await getGarminClient(env);
    if (!client) throw new ApiError(409, 'garmin_not_connected', 'Garmin is not connected');
    budget = new Budget(client, opts.maxRequests ?? DEFAULT_MAX_REQUESTS, opts.deadlineMs ?? DEFAULT_DEADLINE_MS);
    const now = await syncNow(env);
    const today = await syncToday(env);
    const caps = await client.capabilities();

    // 1. token upkeep: refresh the DI token once a day so the refresh token keeps rolling
    if (caps.di && (await getState<LocalDate>(env.DB, K.tokenUpkeep)) !== today && budget.has(1)) {
      await client.refreshDiNow();
      await putState(env.DB, K.tokenUpkeep, today);
    }

    // 2. incremental list (+ deletions) → queue
    const repo = activityRepo(env);
    const inc = await runIncrementalSync(client, repo, { now, maxRequests: Math.max(1, Math.min(5, budget.left - 1)) });
    report.activities.deleted = repo.deleted;
    report.activities.complete = inc.complete;
    await extendLock(env.DB, lease, LOCK_TTL_MS);

    // 3. FIT + ingest of queued activities (newest first)
    const drained = await drainQueue(env, client, Q_INCREMENTAL, budget, opts.hooks ?? {});
    report.activities.created = drained.created;
    report.activities.updated = drained.updated;
    report.activities.unchanged = drained.unchanged;
    report.activities.failed = drained.failed;
    report.activities.queued = drained.remaining;
    await extendLock(env.DB, lease, LOCK_TTL_MS);

    // 4. wellness: re-pull from the day before the watermark (yesterday at least) through today
    if (budget.has(10)) {
      const ws = (await getState<WellnessState>(env.DB, K.wellness)) ?? {};
      const initial = opts.wellnessDays ?? (opts.reason === 'connect' ? 14 : 3);
      let from = ws.lastDate ? addDays(ws.lastDate, -1) : addDays(today, -(initial - 1));
      if (from > addDays(today, -1)) from = addDays(today, -1);
      if (diffDays(from, today) > 27) from = addDays(today, -27);
      const w = await pullWellness(env, client, from, today, budget);
      report.wellnessDays = w.days;
      if (w.through) await putState(env.DB, K.wellness, { lastDate: w.through } satisfies WellnessState);
    }

    // 5. physiology → suggested thresholds, once a day
    if ((await getState<LocalDate>(env.DB, K.physiology)) !== today && budget.has(4)) {
      const settings = await client.getUserSettings();
      report.thresholds = (await applyGarminThresholds(env, settings, today)).length;
      await putState(env.DB, K.physiology, today);
    }

    // 6. auto-push planned workouts in the window
    if (!opts.skipPush && caps.write) {
      const b = budget;
      const res = await pushPending(env, client, { budget: () => b.has(8), now, today });
      report.push = { pushed: res.pushed, removed: res.removed, failed: res.failed, remaining: res.remaining };
    }

    // 7. one bounded backfill step
    if (!opts.skipBackfill && budget.has(2)) {
      const s = await backfillStep(env, client, budget, opts.hooks ?? {});
      if (s) report.backfill = backfillProgress(s);
    }

    report.requests = budget.used;
    report.durationMs = Date.now() - started;
    report.summary = summarize(report);
    await updateLog(env, log, { status: 'ok', summary: report.summary, durationMs: report.durationMs, detail: detailOf(report, drained.errors) });
    await setGarminSyncResult(env.DB, { lastSyncAt: new Date().toISOString(), lastError: null, state: 'connected' });
    return report;
  } catch (e) {
    const err = toApiError(e);
    report.status = 'error';
    report.error = { code: err.code, message: err.message };
    report.requests = budget?.used ?? 0;
    report.durationMs = Date.now() - started;
    report.summary = `Sync failed: ${err.message}`;
    await updateLog(env, log, { status: 'error', summary: report.summary, detail: errorMessage(e), durationMs: report.durationMs });
    await noteFailure(env, e);
    return report;
  } finally {
    await releaseLock(env.DB, lease);
  }
}

function detailOf(r: SyncReport, errors: string[]): string {
  const lines = [`reason=${r.reason} requests=${r.requests} complete=${r.activities.complete} unchanged=${r.activities.unchanged}`];
  if (errors.length) lines.push(...errors.slice(0, 10));
  return lines.join('\n');
}

async function updateLog(env: Env, log: SyncLogEntry, patch: Partial<Omit<SyncLogEntry, 'id' | 'at'>>): Promise<void> {
  await updateSyncLog(env.DB, log.id, patch);
}

/** `POST /garmin/backfill/step` and cron share this: one step under the lock. */
export async function runBackfillStepNow(
  env: Env,
  opts: BackfillStepOptions & { maxRequests?: number; deadlineMs?: number } = {},
): Promise<BackfillProgress | undefined> {
  return withSyncLock(env, async () => {
    const client = await requireClient(env);
    const budget = new Budget(client, opts.maxRequests ?? DEFAULT_MAX_REQUESTS, opts.deadlineMs ?? DEFAULT_DEADLINE_MS);
    try {
      const s = await backfillStep(env, client, budget, opts);
      return s ? backfillProgress(s) : undefined;
    } catch (e) {
      await noteFailure(env, e);
      await logSync(env.DB, { kind: 'backfill', status: 'error', summary: `Backfill step failed: ${toApiError(e).message}`, detail: errorMessage(e) });
      throw toApiError(e);
    }
  });
}

// ───────────────────────────── status ─────────────────────────────

export interface GarminStatusResponse extends GarminStatus {
  capabilities: { read: boolean; write: boolean };
  credentials: { personalApiKey: boolean; connectToken: boolean; keyExpiresOn?: LocalDate };
  counts: GarminCounts;
  backfillProgress?: BackfillProgress;
  demo: boolean;
}

/** `GET /garmin/status`: the domain GarminStatus plus capabilities, credential kinds, counts and backfill. */
export async function garminStatus(env: Env): Promise<GarminStatusResponse> {
  const [row, counts, bf, pending] = await Promise.all([getGarminAuth(env.DB), garminCounts(env.DB), getBackfill(env), mfaPending(env)]);
  const out: GarminStatusResponse = {
    connected: false,
    state: pending ? 'needs_mfa' : 'disconnected',
    capabilities: { read: false, write: false },
    credentials: { personalApiKey: false, connectToken: false },
    counts,
    demo: isDemo(env),
  };
  if (bf) {
    const p = backfillProgress(bf);
    out.backfill = { running: p.running, done: p.done, total: p.total, ...(p.oldestDate ? { oldestDate: p.oldestDate } : {}) };
    out.backfillProgress = p;
  }
  if (!row) return out;
  out.connected = row.state !== 'needs_mfa';
  out.state = row.state === 'error' ? 'error' : pending ? 'needs_mfa' : 'connected';
  if (row.displayName) out.displayName = row.displayName;
  if (row.lastSyncAt) out.lastSyncAt = row.lastSyncAt;
  if (row.lastError) out.lastError = row.lastError;
  try {
    const c = await decryptCredentials(env, row.credentialsEnc);
    const personal = !!c.personal?.apiKey;
    const di = !!c.di?.di_token && !!c.di.di_refresh_token;
    out.capabilities = { read: personal || di, write: di };
    out.credentials = { personalApiKey: personal, connectToken: di, ...(c.personal?.keyExpiresOn ? { keyExpiresOn: c.personal.keyExpiresOn } : {}) };
  } catch {
    out.state = 'error';
    out.lastError = 'Stored Garmin credentials cannot be decrypted (was ENCRYPTION_KEY changed?). Connect again.';
  }
  return out;
}
