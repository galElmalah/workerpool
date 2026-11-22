/**
 * History backfill driver for onboarding. A module-level loop (not tied to a component) calls
 * `POST /garmin/backfill/step` until the server says it is done, so the import keeps running while
 * the athlete moves on to the next step or lands on the calendar. Cron also advances it in
 * production; this loop just makes progress live while the app is open.
 */
import { useSyncExternalStore } from 'react';
import { ApiError, api, call } from '@/lib/api';
import { invalidateTraining, qk, queryClient } from '@/lib/query';
import { garminStatusQuery } from '@/lib/queries/shared';

const postStep = () => call(api.garmin.backfill.step.$post());
export type BackfillProgress = Awaited<ReturnType<typeof postStep>>;

export interface BackfillState {
  progress: BackfillProgress | null;
  looping: boolean;
  error: string | null;
}

let state: BackfillState = { progress: null, looping: false, error: null };
let token = 0;
const subs = new Set<() => void>();
const set = (patch: Partial<BackfillState>) => {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const busy = (e: unknown) => e instanceof ApiError && (e.code === 'sync_in_progress' || e.status === 409);

export function useBackfill(): BackfillState {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => void subs.delete(f);
    },
    () => state,
    () => state,
  );
}

export async function startBackfill(months: number): Promise<void> {
  const my = ++token;
  set({ looping: true, error: null });
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const p = await call(api.garmin.backfill.$post({ json: { months } }));
      if (my !== token) return;
      set({ progress: p });
      publish(p);
      return loop(my);
    } catch (e) {
      // the initial connect sync holds the lock for a few seconds
      if (busy(e) && my === token) {
        await sleep(1500);
        continue;
      }
      if (my === token) set({ looping: false, error: message(e) });
      return;
    }
  }
  if (my === token) set({ looping: false, error: 'Garmin is busy. Try again in a moment.' });
}

/** Continue a backfill the server reports as running (e.g. after a reload). */
export function resumeBackfill(p: BackfillProgress): void {
  if (state.looping) return;
  set({ progress: p, error: null });
  if (p.running) void loop(++token);
}

async function loop(my: number): Promise<void> {
  set({ looping: true });
  let failures = 0;
  while (my === token && (state.progress?.running ?? true)) {
    try {
      const p = await postStep();
      if (my !== token) return;
      failures = 0;
      set({ progress: p });
      publish(p);
    } catch (e) {
      if (my !== token) return;
      if (busy(e) || ++failures < 3) {
        await sleep(1500);
        continue;
      }
      set({ error: message(e) });
      break;
    }
    await sleep(150);
  }
  if (my === token) set({ looping: false });
  void queryClient.invalidateQueries({ queryKey: qk.garmin.status });
  void invalidateTraining();
}

/**
 * Mirror each step's progress into the cached Garmin status, so the rail's sync state and the
 * calendar's import note know about the import at once (and the status query switches to its
 * fast poll, which in turn refreshes the training views as activities arrive — see
 * `useGarminStatusSync`).
 */
function publish(p: BackfillProgress): void {
  queryClient.setQueryData(garminStatusQuery.queryKey, (s) =>
    s ? { ...s, backfillProgress: p, backfill: { running: p.running, done: p.done, total: p.total, ...(p.oldestDate ? { oldestDate: p.oldestDate } : {}) } } : s,
  );
}

export async function cancelBackfill(): Promise<void> {
  token++;
  set({ looping: false });
  try {
    const p = await call(api.garmin.backfill.$delete());
    if ('phase' in p) set({ progress: p as BackfillProgress });
  } catch (e) {
    set({ error: message(e) });
  }
  void queryClient.invalidateQueries({ queryKey: qk.garmin.status });
}
