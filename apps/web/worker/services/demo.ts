/**
 * Demo mode seeding (`DEMO_MODE=1` only). Loads the deterministic synthetic athlete's plan, notes,
 * events and thresholds directly, connects Garmin to the in-process fake, then runs the REAL
 * pipeline: backfill through the mock client (list → FIT download → ingestActivity → auto-pairing),
 * wellness for the whole range, the incremental sync (watermark, physiology) and auto-push of the
 * upcoming planned workouts.
 *
 * A year is ~450 activities with FIT encode + parse + metrics, far more CPU than one request may
 * use, so seeding is a resumable job: `startDemoSeed` (plan + connect + backfill cursor), then
 * `demoSeedStep` repeatedly (bounded batches of activities), until `phase === 'done'`.
 */
import type { DayMarker, Event, LocalDate, Phase, PlannedWorkout, PlannedWorkoutInput, Sport, Template, Threshold } from '@cadence/core/domain';
import { addDays, diffDays, todayIn } from '@cadence/core/time';
import { STARTER_TEMPLATES } from '@cadence/core/workout';
import type { NormalizedActivity } from '@cadence/garmin';
import { getActivityByGarminId } from '../db/activities';
import { insertEvents, insertMarkers, insertPhases, putDayNote, putWeekNote } from '../db/furniture';
import { getSettings, updateSettings } from '../db/settings';
import { all } from '../db/sql';
import { getState, logSync, putState } from '../db/sync';
import { insertTemplates } from '../db/templates';
import { insertThreshold, thresholdResolver } from '../db/thresholds';
import { insertWorkouts } from '../db/workouts';
import { ApiError } from '../lib/http';
import { nowIso } from '../lib/ids';
import {
  DEMO_DEFAULT_SEED,
  DEMO_LOOKAHEAD_DAYS,
  connectGarmin,
  getDemoMock,
  getDemoNow,
  resetDemoMock,
  setDemoConfig,
  setDemoNow,
  syncToday,
  type DemoAthlete,
} from './garmin';
import { buildWorkout, deriveWorkout } from './planning';
import { Budget, backfillStep, createBackfill, getBackfill, requireClient, runSync, withSyncLock, type IngestHooks } from './sync';

const DAY_MS = 86_400_000;
const JOB_KEY = 'demo:job';

export interface DemoSeedInput {
  months?: number;
  today?: LocalDate;
  seed?: number;
  /** Ingest activities older than 8 weeks from their summary only (no FIT/streams) — much faster. */
  fast?: boolean;
  /** Demo clock instant (ISO); default: the real time of day on `today`. */
  now?: string;
}

export type DemoPhase = 'activities' | 'finalize' | 'done' | 'error';

interface DemoJob {
  jobId: string;
  seed: number;
  months: number;
  fast: boolean;
  seedToday: LocalDate;
  athleteToday: LocalDate;
  phase: DemoPhase;
  total: number;
  done: number;
  planned: number;
  skipped: number;
  steps: number;
  /** Wall-clock spent inside step calls (ms). */
  stepMs: number;
  startedAt: string;
  finishedAt?: string;
  lastError?: string;
}

export interface DemoProgress {
  jobId: string;
  phase: DemoPhase;
  finished: boolean;
  total: number;
  done: number;
  seed: number;
  months: number;
  today: LocalDate;
  fast: boolean;
  planned: number;
  skipped: number;
  steps: number;
  stepMs: number;
  /** Activities ingested per second of step time. */
  throughput?: number;
  backfill?: { phase: string; listed: number; done: number; total: number | null; wellnessDays: number };
  startedAt: string;
  finishedAt?: string;
  lastError?: string;
}

function progressOf(job: DemoJob, bf?: Awaited<ReturnType<typeof getBackfill>>): DemoProgress {
  const p: DemoProgress = {
    jobId: job.jobId,
    phase: job.phase,
    finished: job.phase === 'done',
    total: job.total,
    done: job.done,
    seed: job.seed,
    months: job.months,
    today: job.seedToday,
    fast: job.fast,
    planned: job.planned,
    skipped: job.skipped,
    steps: job.steps,
    stepMs: job.stepMs,
    startedAt: job.startedAt,
  };
  if (job.stepMs > 0 && job.done > 0) p.throughput = Math.round((job.done / (job.stepMs / 1000)) * 10) / 10;
  if (bf) p.backfill = { phase: bf.phase, listed: bf.listed, done: bf.done, total: bf.total, wellnessDays: bf.wellnessDays };
  if (job.finishedAt) p.finishedAt = job.finishedAt;
  if (job.lastError) p.lastError = job.lastError;
  return p;
}

// ───────────────────────────── reset ─────────────────────────────

/** Wipe every table except `auth` and `devices` (sign-ins survive) and D1/SQLite internals; drop the in-memory mock. */
export async function resetDemoData(env: Env): Promise<string[]> {
  const tables = await all<{ name: string }>(
    env.DB,
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('auth', 'devices', 'd1_migrations')
     AND substr(name, 1, 7) != 'sqlite_' AND substr(name, 1, 4) != '_cf_'`,
  );
  // children first (activity_streams/files reference activities)
  const names = tables.map((t) => t.name).sort((a, b) => Number(b.startsWith('activity_')) - Number(a.startsWith('activity_')));
  if (names.length) await env.DB.batch(names.map((n) => env.DB.prepare(`DELETE FROM "${n.replaceAll('"', '""')}"`)));
  resetDemoMock();
  return names;
}

// ───────────────────────────── plan / furniture ─────────────────────────────

const THRESHOLD_SPORT: Record<string, Threshold['sport']> = {
  ftp: 'bike',
  run_threshold: 'run',
  swim_css: 'swim',
  row_threshold: 'row',
  lthr: 'all',
  weight: 'all',
};

/** Deterministic workout id for a synth plan key (`2026-11-17#1` → `wk_d20261117_1`). */
export const workoutIdForKey = (key: string) => `wk_d${key.replace(/[^0-9A-Za-z]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d{4})_(\d{2})_(\d{2})/, '$1$2$3')}`;

async function seedPlan(env: Env, athlete: DemoAthlete, seedToday: LocalDate): Promise<{ planned: number; skipped: number }> {
  const db = env.DB;
  const p = athlete.profile;
  await updateSettings(db, {
    name: p.fullName,
    sex: p.sex,
    birthYear: p.birthYear,
    timezone: p.timezone,
    units: 'metric',
    onboarded: true,
    garminAutoPushDays: 7,
  });

  // threshold history (the athlete's own entries) + HR anchors from the profile
  const first = athlete.thresholdHistory[0]?.effectiveFrom ?? addDays(seedToday, -365);
  for (const h of athlete.thresholdHistory) {
    if (h.effectiveFrom > seedToday) continue;
    await insertThreshold(db, { kind: h.kind, sport: THRESHOLD_SPORT[h.kind] ?? 'all', value: h.value, effectiveFrom: h.effectiveFrom, source: 'manual' });
  }
  await insertThreshold(db, { kind: 'hr_max', sport: 'all', value: p.hrMax, effectiveFrom: first, source: 'manual' });
  await insertThreshold(db, { kind: 'hr_rest', sport: 'all', value: p.hrRest, effectiveFrom: first, source: 'manual' });

  const resolve = await thresholdResolver(db);
  const now = nowIso();

  // starter templates (same ids as the library's own seeding)
  const templates: Template[] = STARTER_TEMPLATES.map((s) =>
    deriveWorkout(
      {
        id: `tpl_${s.key}`,
        sport: s.sport,
        ...(s.subSport ? { subSport: s.subSport } : {}),
        title: s.title,
        description: s.description,
        structure: s.structure,
        intensity: s.intensity,
        tags: s.isKey && !s.tags.includes('key') ? [...s.tags, 'key'] : [...s.tags],
        folder: s.folder,
        usageCount: 0,
        createdAt: now,
        updatedAt: now,
      } satisfies Template,
      resolve(seedToday, s.sport),
      { title: false, intensity: false, unstructured: true },
    ),
  );
  await insertTemplates(db, templates);

  // the whole plan; skips are applied for past sessions only (the future is still "planned")
  let skipped = 0;
  const workouts: PlannedWorkout[] = athlete.plan.map((s) => {
    const input: PlannedWorkoutInput = {
      date: s.date,
      sport: s.sport,
      title: s.title,
      plannedDurationSec: s.plannedDurationSec,
      isKey: s.isKey,
      intensity: s.intensity,
      tags: s.tags,
      environment: s.environment,
      status: 'planned',
    };
    if (s.startTime) input.startTime = s.startTime;
    if (s.subSport) input.subSport = s.subSport;
    if (s.description) input.description = s.description;
    if (s.preNote) input.preNote = s.preNote;
    if (s.structure) input.structure = s.structure;
    if (s.plannedDistanceM !== undefined) input.plannedDistanceM = s.plannedDistanceM;
    if (s.skipped && s.date < seedToday) {
      input.status = 'skipped';
      input.skipReason = s.skipped.reason;
      skipped++;
    }
    return buildWorkout(input, resolve(s.date, s.sport as Sport), { id: workoutIdForKey(s.key), now });
  });
  await insertWorkouts(db, workouts);

  await insertEvents(db, eventsOf(athlete, new Map()));
  await insertPhases(db, athlete.phases.map((ph, i) => ({ ...ph, id: `ph_demo_${i}` }) satisfies Phase));
  await insertMarkers(db, athlete.markers.map((m, i) => ({ ...m, id: `mk_demo_${i}` }) satisfies DayMarker));
  for (const n of athlete.dayNotes) if (n.date <= seedToday) await putDayNote(db, n.date, n.body);
  for (const w of athlete.weekNotes) await putWeekNote(db, w);
  return { planned: workouts.length, skipped };
}

/** Events with `resultActivityId` mapped from Garmin ids to our activity ids (when ingested). */
function eventsOf(athlete: DemoAthlete, garminToActivity: Map<string, string>): Event[] {
  return athlete.events.map((e, i) => {
    const { resultActivityId, ...rest } = e;
    const ev: Event = { ...rest, id: `evt_demo_${i}` };
    const mapped = resultActivityId ? garminToActivity.get(resultActivityId) : undefined;
    if (mapped) ev.resultActivityId = mapped;
    return ev;
  });
}

// ───────────────────────────── job ─────────────────────────────

async function getJob(env: Env): Promise<DemoJob | undefined> {
  return getState<DemoJob>(env.DB, JOB_KEY);
}

async function saveJob(env: Env, job: DemoJob): Promise<void> {
  await putState(env.DB, JOB_KEY, job);
}

/**
 * Start (or return the already-started identical) seed job: wipes the data, loads plan/furniture,
 * connects Garmin to the mock and creates the backfill cursor. Activities are ingested by steps.
 */
export async function startDemoSeed(env: Env, input: DemoSeedInput): Promise<DemoProgress> {
  const seed = input.seed ?? DEMO_DEFAULT_SEED;
  const months = input.months ?? 12;
  const fast = input.fast ?? false;
  const settings = await getSettings(env.DB);
  let seedToday = input.today ?? todayIn(settings.timezone);

  const existing = await getJob(env);
  if (existing && existing.phase !== 'error' && existing.seed === seed && existing.months === months && existing.fast === fast && (!input.today || existing.seedToday === input.today)) {
    return progressOf(existing, await getBackfill(env));
  }

  await resetDemoData(env);
  let athleteToday = addDays(seedToday, DEMO_LOOKAHEAD_DAYS);
  await setDemoConfig(env, { seed, athleteToday, months });
  let { athlete } = await getDemoMock(env);
  if (!input.today) {
    // "today" belongs to the athlete's timezone; regenerate if that moves the date.
    const local = todayIn(athlete.profile.timezone);
    if (local !== seedToday) {
      seedToday = local;
      athleteToday = addDays(seedToday, DEMO_LOOKAHEAD_DAYS);
      await setDemoConfig(env, { seed, athleteToday, months });
      ({ athlete } = await getDemoMock(env));
    }
  }
  const realToday = todayIn(athlete.profile.timezone);
  const nowMs = input.now ? Date.parse(input.now) : Date.now() + diffDays(realToday, seedToday) * DAY_MS;
  if (!Number.isFinite(nowMs)) throw new ApiError(400, 'bad_request', 'now must be an ISO instant');
  await setDemoNow(env, nowMs);

  const job: DemoJob = {
    jobId: crypto.randomUUID(),
    seed,
    months,
    fast,
    seedToday,
    athleteToday,
    phase: 'activities',
    total: 0,
    done: 0,
    planned: 0,
    skipped: 0,
    steps: 0,
    stepMs: 0,
    startedAt: new Date().toISOString(),
  };
  try {
    const plan = await seedPlan(env, athlete, seedToday);
    job.planned = plan.planned;
    job.skipped = plan.skipped;
    await connectGarmin(env, { demo: true });
    const bf = await createBackfill(env, { months: months + 1, wellness: true, today: seedToday });
    const { mock } = await getDemoMock(env);
    job.total = mock.visibleActivities().filter((a) => a.localDate >= bf.sinceDate).length;
  } catch (e) {
    job.phase = 'error';
    job.lastError = e instanceof Error ? e.message : String(e);
    await saveJob(env, job);
    throw e;
  }
  await saveJob(env, job);
  return progressOf(job, await getBackfill(env));
}

function demoHooks(athlete: DemoAthlete, job: DemoJob): IngestHooks {
  const byId = new Map(athlete.activities.map((a) => [String(a.garminActivityId), a]));
  const fullFrom = addDays(job.seedToday, -56);
  const hooks: IngestHooks = {
    enrich: (a: NormalizedActivity) => {
      const s = byId.get(a.garminActivityId);
      if (!s) return undefined;
      const user: { rpe?: number; feel?: number; postNote?: string } = {};
      if (s.rpe !== undefined) user.rpe = s.rpe;
      if (s.feel !== undefined) user.feel = s.feel;
      if (s.postNote) user.postNote = s.postNote;
      return Object.keys(user).length ? user : undefined;
    },
  };
  if (job.fast) hooks.withFit = (a) => !a.manual && a.localDate >= fullFrom;
  return hooks;
}

/** One bounded batch of the seed job. Call until `finished`. */
export async function demoSeedStep(env: Env, opts: { maxActivities?: number } = {}): Promise<DemoProgress> {
  const job = await getJob(env);
  if (!job) throw new ApiError(404, 'not_found', 'No demo seed job; POST /demo/seed first');
  if (job.phase === 'done' || job.phase === 'error') return progressOf(job, await getBackfill(env));
  const started = Date.now();
  try {
    if (job.phase === 'activities') {
      const { athlete } = await getDemoMock(env);
      const s = await withSyncLock(env, async () => {
        const client = await requireClient(env);
        // In-process mock: requests are not real subrequests; the activity count bounds the step.
        const budget = new Budget(client, 2000, 25_000);
        return backfillStep(env, client, budget, { ...demoHooks(athlete, job), maxActivities: opts.maxActivities ?? 20 });
      });
      if (s) {
        job.done = s.done;
        if (s.total !== null) job.total = s.total;
        if (s.phase === 'done') job.phase = 'finalize';
        if (s.lastError) job.lastError = s.lastError;
      } else job.phase = 'finalize';
    } else if (job.phase === 'finalize') {
      await finalize(env, job);
    }
  } catch (e) {
    job.lastError = e instanceof Error ? e.message : String(e);
    job.stepMs += Date.now() - started;
    job.steps++;
    await saveJob(env, job);
    throw e;
  }
  job.stepMs += Date.now() - started;
  job.steps++;
  await saveJob(env, job);
  return progressOf(job, await getBackfill(env));
}

async function finalize(env: Env, job: DemoJob): Promise<void> {
  const { athlete } = await getDemoMock(env);
  // event results → our activity ids
  const ids = new Map<string, string>();
  for (const e of athlete.events) {
    if (!e.resultActivityId) continue;
    const row = await getActivityByGarminId(env.DB, e.resultActivityId);
    if (row && !row.deleted) ids.set(e.resultActivityId, row.id);
  }
  await insertEvents(env.DB, eventsOf(athlete, ids));
  // the regular incremental sync: watermark, latest wellness, physiology, auto-push of upcoming plans
  const report = await runSync(env, { reason: 'demo', skipBackfill: true, ignoreBackoff: true, maxRequests: 1000, wellnessDays: 3 });
  if (report.status === 'error') throw new ApiError(500, report.error?.code ?? 'internal', report.summary);
  job.phase = 'done';
  job.finishedAt = new Date().toISOString();
  const secs = Math.round((Date.parse(job.finishedAt) - Date.parse(job.startedAt)) / 100) / 10;
  await logSync(env.DB, {
    kind: 'backfill',
    status: 'ok',
    summary: `Demo seed complete: ${job.done} activities, ${job.planned} planned workouts in ${secs}s`,
    durationMs: Date.parse(job.finishedAt) - Date.parse(job.startedAt),
  });
}

export async function demoStatus(env: Env): Promise<{ job?: DemoProgress; now?: string; today: LocalDate; counts: Record<string, number> }> {
  const job = await getJob(env);
  const nowMs = await getDemoNow(env);
  const [counts] = await all<Record<string, number>>(
    env.DB,
    `SELECT (SELECT count(*) FROM activities WHERE deleted_at IS NULL) AS activities,
            (SELECT count(*) FROM activity_streams) AS streams,
            (SELECT count(*) FROM workouts) AS workouts,
            (SELECT count(*) FROM workouts WHERE paired_activity_id IS NOT NULL) AS paired,
            (SELECT count(*) FROM workouts WHERE garmin_sync_state = 'synced') AS pushed,
            (SELECT count(*) FROM wellness_days) AS wellness,
            (SELECT count(*) FROM sync_log) AS syncLog`,
  );
  const out: { job?: DemoProgress; now?: string; today: LocalDate; counts: Record<string, number> } = {
    today: await syncToday(env),
    counts: counts ?? {},
  };
  if (job) out.job = progressOf(job, await getBackfill(env));
  if (nowMs !== undefined) out.now = new Date(nowMs).toISOString();
  return out;
}

/** Move the demo clock forward (`days`) or to a date (`to`, same time of day) / instant. */
export async function advanceDemo(env: Env, input: { days?: number; to?: string }): Promise<{ now: string; today: LocalDate }> {
  const base = (await getDemoNow(env)) ?? Date.now();
  let next: number;
  if (input.to) {
    next = /^\d{4}-\d{2}-\d{2}$/.test(input.to) ? Date.parse(`${input.to}T00:00:00Z`) + (((base % DAY_MS) + DAY_MS) % DAY_MS) : Date.parse(input.to);
  } else next = base + (input.days ?? 1) * DAY_MS;
  if (!Number.isFinite(next)) throw new ApiError(400, 'bad_request', 'to must be a LocalDate or ISO instant');
  if (next < base) throw new ApiError(400, 'bad_request', 'The demo clock only moves forward');
  await setDemoNow(env, next);
  return { now: new Date(next).toISOString(), today: await syncToday(env) };
}
