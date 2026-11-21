import { describe, expect, it } from 'vitest';
import { GarminLink, WellnessDay } from '@cadence/core/domain';
import {
  needsPush,
  planIncrementalPull,
  pullWellnessRange,
  pushPlannedWorkout,
  runBackfillStep,
  runIncrementalSync,
  toGarminWorkout,
  makeWorkoutTag,
  type ActivitySyncRepository,
  type ActivitySyncState,
  type BackfillCursor,
  type NormalizedActivity,
} from '../src';
import { harness } from './helpers/setup';
import { planned, repeat, step } from './helpers/planned';

const TH = { ftp: 260, runThresholdMps: 4.0, swimCssMps: 1.25, lthr: 172 };

function memRepo() {
  const rows = new Map<string, NormalizedActivity & { deleted?: boolean }>();
  let state: ActivitySyncState = {};
  const repo: ActivitySyncRepository & { rows: typeof rows; state: () => ActivitySyncState; upserts: number } = {
    rows,
    upserts: 0,
    state: () => state,
    async loadState() {
      return structuredClone(state);
    },
    async saveState(s) {
      state = structuredClone(s);
    },
    async listKnownSince(ms) {
      return [...rows.values()].filter((r) => !r.deleted && r.startMs >= ms).map((r) => ({ garminActivityId: r.garminActivityId, startMs: r.startMs, editHash: r.editHash }));
    },
    async upsert(items) {
      repo.upserts += items.length;
      for (const i of items) rows.set(i.garminActivityId, { ...i });
    },
    async markDeleted(ids) {
      for (const id of ids) rows.get(id)!.deleted = true;
    },
  };
  return repo;
}

const ids = (xs: { garminActivityId: string }[]) => xs.map((x) => Number(x.garminActivityId) - 21_000_000_000);

describe('incremental pull', () => {
  it('plans the stop point as min(watermark − overlap, now − recheck window)', () => {
    const now = new Date('2026-11-21T08:00:00Z');
    expect(planIncrementalPull({}, { now }).cursor.stopBeforeMs).toBe(Date.parse('2026-11-07T08:00:00Z'));
    const recent = planIncrementalPull({ watermark: { startMs: Date.parse('2026-11-20T00:00:00Z'), activityId: '1' } }, { now, recheckDays: 1 });
    expect(recent.cursor.stopBeforeMs).toBe(Date.parse('2026-11-18T00:00:00Z'));
    expect(recent.recheckFromMs).toBe(Date.parse('2026-11-20T08:00:00Z'));
  });

  it('first run imports the window, then new/edited/deleted activities are detected; watermark advances', async () => {
    const h = harness({ personal: true });
    const repo = memRepo();
    const r1 = await runIncrementalSync(h.client, repo, { now: h.clk.now(), pageSize: 5 });
    expect(ids(r1.created)).toEqual([7, 6, 5, 4, 3, 2, 1]);
    expect(r1).toMatchObject({ complete: true, pages: 2, watermark: { activityId: '21000000007' } });
    expect(repo.state().watermark?.activityId).toBe('21000000007');

    const r2 = await runIncrementalSync(h.client, repo, { now: h.clk.now(), pageSize: 5 });
    expect([r2.created.length, r2.updated.length, r2.deleted.length]).toEqual([0, 0, 0]);

    h.clk.set('2026-11-21T10:00:00Z'); // activity 8 (09:00Z) becomes visible
    h.mock.editActivity(21_000_000_006, { activityName: 'Ridge hike (renamed)' });
    h.mock.deleteActivity(21_000_000_003);
    const r3 = await runIncrementalSync(h.client, repo, { now: h.clk.now(), pageSize: 5 });
    expect(ids(r3.created)).toEqual([8]);
    expect(ids(r3.updated)).toEqual([6]);
    expect(r3.deleted).toEqual(['21000000003']);
    expect(repo.rows.get('21000000003')?.deleted).toBe(true);
    expect(repo.rows.get('21000000006')?.title).toBe('Ridge hike (renamed)');
    expect(repo.state().watermark?.activityId).toBe('21000000008');
  });

  it('an exhausted request budget upserts what it saw but does not advance state', async () => {
    const h = harness({ personal: true });
    const repo = memRepo();
    const r = await runIncrementalSync(h.client, repo, { now: h.clk.now(), pageSize: 2, maxRequests: 1 });
    expect(r.complete).toBe(false);
    expect(ids(r.created)).toEqual([7, 6]);
    expect(repo.state()).toEqual({});
    expect(r.deleted).toEqual([]);
  });
});

describe('backfill', () => {
  async function drain(h: ReturnType<typeof harness>, opts: Parameters<typeof runBackfillStep>[2], between?: (step: number) => void) {
    let cursor: BackfillCursor | null = null;
    const seen: string[] = [];
    let steps = 0;
    for (;;) {
      const r = await runBackfillStep(h.client, cursor, opts);
      seen.push(...r.items.map((i) => i.garminActivityId));
      cursor = JSON.parse(JSON.stringify(r.nextCursor)); // must survive persistence
      steps++;
      if (r.done) break;
      between?.(steps);
      if (steps > 50) throw new Error('no progress');
    }
    return { seen, steps, cursor: cursor! };
  }

  it('steps through all history exactly once within a request budget', async () => {
    const h = harness({ personal: true });
    const before = h.mock.state.requests.length;
    const { seen, steps, cursor } = await drain(h, { pageSize: 3, maxRequests: 1 });
    expect(ids(seen.map((garminActivityId) => ({ garminActivityId })))).toEqual([7, 6, 5, 4, 3, 2, 1]);
    expect(steps).toBe(4);
    expect(cursor.emitted).toBe(7);
    expect(cursor.oldestLocalDate).toBe('2026-11-12');
    const listCalls = h.mock.state.requests.slice(before).filter((r) => r.path.includes('activitylist')).length;
    expect(listCalls).toBe(4); // maxRequests respected (1 per step)
  });

  it('new uploads and deletions during the backfill cause neither duplicates nor gaps', async () => {
    const h = harness({ personal: true });
    const { seen } = await drain(h, { pageSize: 3, maxRequests: 1 }, (s) => {
      if (s === 1) {
        h.clk.set('2026-11-21T10:00:00Z'); // a new activity shifts offsets down
        h.mock.deleteActivity(21_000_000_005); // and a deletion shifts them up
        h.mock.deleteActivity(21_000_000_007);
      }
    });
    expect(new Set(seen).size).toBe(seen.length);
    for (const id of [4, 3, 2, 1]) expect(seen).toContain(String(21_000_000_000 + id));
  });

  it('stops at sinceDate (with a day of timezone slack) and supports multi-page steps', async () => {
    const h = harness({ personal: true });
    const { seen, steps } = await drain(h, { pageSize: 2, maxRequests: 5, sinceDate: '2026-11-15' });
    expect(ids(seen.map((garminActivityId) => ({ garminActivityId })))).toEqual([7, 6, 5, 4, 3]);
    expect(steps).toBe(1);
  });
});

describe('wellness range', () => {
  it('Personal API only: merges range endpoints per day (no readiness)', async () => {
    const h = harness({ personal: true });
    const r = await pullWellnessRange(h.client, '2026-11-18', '2026-11-20');
    expect(r.days.map((d) => d.date)).toEqual(['2026-11-18', '2026-11-19', '2026-11-20']);
    expect(r.days.every((d) => WellnessDay.safeParse(d).success)).toBe(true);
    expect(r.days[2]).toEqual({ date: '2026-11-20', hrvMs: 58, hrvStatus: 'BALANCED', sleepSec: 29400, sleepScore: 83, restingHr: 46, stress: 33, bodyBattery: 78, weightKg: 73.2, vo2max: 55.2 });
    expect(r.sources).not.toContain('readiness');
  });

  it('with a DI token also readiness (morning value) and RHR; chunks long ranges', async () => {
    const h = harness({ personal: true, di: true });
    const before = h.mock.state.requests.length;
    const r = await pullWellnessRange(h.client, '2026-10-01', '2026-11-20');
    expect(r.days).toHaveLength(9); // fixture has data from 11-12
    expect(r.days.at(-1)?.readiness).toBe(68);
    expect(r.sources).toEqual(expect.arrayContaining(['readiness', 'restingHr', 'hrv', 'sleep']));
    const hrvCalls = h.mock.state.requests.slice(before).filter((x) => x.path.startsWith('/hrv-service/hrv/daily'));
    expect(hrvCalls.map((x) => x.path)).toEqual(['/hrv-service/hrv/daily/2026-10-01/2026-10-28', '/hrv-service/hrv/daily/2026-10-29/2026-11-20']);
  });
});

describe('pushPlannedWorkout', () => {
  const base = () =>
    planned({ id: 'pw_42', sport: 'run', title: '5x1k', date: '2026-11-24' }, [
      step({ role: 'warmup', measure: { type: 'time', sec: 900 } }),
      repeat(5, [step({ role: 'active', measure: { type: 'distance', m: 1000 }, target: { type: 'pace_pct', low: 96, high: 100 } }), step({ role: 'recovery', measure: { type: 'time', sec: 120 } })]),
    ]);
  const posts = (h: ReturnType<typeof harness>) => h.mock.state.requests.filter((r) => r.method === 'POST' && r.path === '/workout-service/workout').length;

  it('create → schedule; tagged; unchanged re-push is a no-op', async () => {
    const h = harness({ personal: true, di: true });
    const now = new Date('2026-11-21T08:00:00Z');
    const link = await pushPlannedWorkout(h.client, base(), TH, undefined, { now });
    expect(GarminLink.safeParse(link).success).toBe(true);
    expect(link).toMatchObject({ syncState: 'synced', lastPushedAt: '2026-11-21T08:00:00Z' });
    const w = h.mock.state.workouts.get(Number(link.workoutId))!;
    expect(String(w.description)).toMatch(/\[cadence:pw_42:[0-9a-f]{8}\]/);
    expect([...h.mock.state.schedules.values()]).toEqual([expect.objectContaining({ workoutId: Number(link.workoutId), calendarDate: '2026-11-24' })]);
    const again = await pushPlannedWorkout(h.client, base(), TH, link, { now });
    expect(again).toMatchObject({ workoutId: link.workoutId, scheduleId: link.scheduleId });
    expect(posts(h)).toBe(1);
    expect(h.mock.state.schedules.size).toBe(1);
  });

  it('editing a synced plan creates a new workout, reschedules, deletes the old one', async () => {
    const h = harness({ di: true });
    const link1 = await pushPlannedWorkout(h.client, base(), TH, undefined);
    const edited = base();
    (edited.structure!.steps[1] as { count: number }).count = 6;
    const link2 = await pushPlannedWorkout(h.client, edited, TH, link1);
    expect(link2.workoutId).not.toBe(link1.workoutId);
    expect(link2.scheduleId).not.toBe(link1.scheduleId);
    expect([...h.mock.state.workouts.keys()]).toEqual([Number(link2.workoutId)]);
    expect([...h.mock.state.schedules.values()]).toEqual([expect.objectContaining({ workoutId: Number(link2.workoutId), calendarDate: '2026-11-24' })]);
  });

  it('a moved date keeps the workout and reschedules it', async () => {
    const h = harness({ di: true });
    const link1 = await pushPlannedWorkout(h.client, base(), TH, undefined);
    const moved = { ...base(), date: '2026-11-26' };
    const link2 = await pushPlannedWorkout(h.client, moved, TH, link1);
    expect(link2.workoutId).toBe(link1.workoutId);
    expect(link2.scheduleId).not.toBe(link1.scheduleId);
    expect([...h.mock.state.schedules.values()].map((s) => s.calendarDate)).toEqual(['2026-11-26']);
  });

  it('retry after a crash before the link was stored adopts the workout and schedule (no duplicates)', async () => {
    const h = harness({ di: true });
    const link1 = await pushPlannedWorkout(h.client, base(), TH, undefined);
    const link2 = await pushPlannedWorkout(h.client, base(), TH, undefined); // link never persisted
    expect(link2).toMatchObject({ workoutId: link1.workoutId, scheduleId: link1.scheduleId });
    expect(posts(h)).toBe(1);
    expect(h.mock.state.schedules.size).toBe(1);
  });

  it('stale tagged copies from earlier versions are cleaned up', async () => {
    const h = harness({ di: true });
    const old = toGarminWorkout({ ...base(), title: 'old version' }, TH, { tag: makeWorkoutTag('pw_42', '00000000') });
    const orphan = await h.client.createWorkout(old);
    const unrelated = await h.client.createWorkout(toGarminWorkout({ ...base(), id: 'pw_other' }, TH, { tag: makeWorkoutTag('pw_other', '11111111') }));
    const link = await pushPlannedWorkout(h.client, base(), TH, undefined);
    expect(h.mock.state.workouts.has(orphan.workoutId)).toBe(false);
    expect(h.mock.state.workouts.has(unrelated.workoutId)).toBe(true);
    expect(h.mock.state.workouts.has(Number(link.workoutId))).toBe(true);
  });

  it('a workout deleted in Garmin Connect is recreated', async () => {
    const h = harness({ di: true });
    const link1 = await pushPlannedWorkout(h.client, base(), TH, undefined);
    await h.client.deleteWorkout(link1.workoutId!); // user deleted it (cascades the schedule)
    const link2 = await pushPlannedWorkout(h.client, base(), TH, link1);
    expect(link2.workoutId).not.toBe(link1.workoutId);
    expect(h.mock.state.schedules.size).toBe(1);
  });

  it('skipped plans are unscheduled and deleted; removal is idempotent', async () => {
    const h = harness({ di: true });
    const link1 = await pushPlannedWorkout(h.client, base(), TH, undefined);
    const skipped = { ...base(), status: 'skipped' as const, skipReason: 'sick' as const };
    const link2 = await pushPlannedWorkout(h.client, skipped, TH, link1);
    expect(link2.syncState).toBe('none');
    expect(h.mock.state.workouts.size).toBe(0);
    expect(h.mock.state.schedules.size).toBe(0);
    await expect(pushPlannedWorkout(h.client, skipped, TH, link1)).resolves.toMatchObject({ syncState: 'none' });
  });

  it('errors propagate (caller records syncState error); a retry then succeeds', async () => {
    const h = harness({ di: true });
    await h.client.verifyDiToken();
    h.mock.failures.blocked = 'connect';
    await expect(pushPlannedWorkout(h.client, base(), TH, undefined)).rejects.toMatchObject({ name: 'GarminBlockedError' });
    delete h.mock.failures.blocked;
    await expect(pushPlannedWorkout(h.client, base(), TH, undefined)).resolves.toMatchObject({ syncState: 'synced' });
  });

  it('needsPush: window, changes since last push, skipped with remote ids', () => {
    const p = base();
    expect(needsPush(p, '2026-11-21', 7)).toBe(true);
    expect(needsPush(p, '2026-11-21', 2)).toBe(false);
    expect(needsPush(p, '2026-11-25', 7)).toBe(false);
    const synced = { ...p, garmin: { syncState: 'synced' as const, workoutId: '1', lastPushedAt: '2026-11-20T11:00:00Z' } };
    expect(needsPush(synced, '2026-11-21', 7)).toBe(false);
    expect(needsPush({ ...synced, updatedAt: '2026-11-20T12:00:00Z' }, '2026-11-21', 7)).toBe(true);
    expect(needsPush({ ...synced, status: 'skipped' }, '2026-11-21', 7)).toBe(true);
  });
});
