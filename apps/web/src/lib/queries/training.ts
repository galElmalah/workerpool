/**
 * Shared training data layer: the calendar window, card view-models, and the workout / activity
 * mutations used by calendar, today, week and the workout pages.
 *
 * Mutations are optimistic: they patch every cached calendar window immediately (so cards move
 * without waiting for the network), then invalidate so weekly totals and fitness numbers settle a
 * moment later. Destructive ones return what is needed to undo — pair them with `toast.undo(...)`.
 */
import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  Activity,
  ActivityPatch,
  CalendarResponse,
  IntensityClass,
  LocalDate,
  PlannedWorkout,
  PlannedWorkoutInput,
} from '@cadence/core/domain';
import type { WorkoutCardModel } from '@/ui/domain/WorkoutCard';
import { api, call } from '../api';
import { invalidateTraining, qk } from '../query';

// ───────────────────────── calendar window ─────────────────────────

export const calendarQuery = (from: LocalDate, to: LocalDate) =>
  queryOptions({
    queryKey: qk.calendar.range(from, to),
    queryFn: () => call(api.calendar.$get({ query: { from, to } })) as Promise<CalendarResponse>,
    staleTime: 30_000,
  });

/** One window of the calendar (whole ISO weeks are returned even if from/to are mid-week). */
export function useCalendar(from: LocalDate, to: LocalDate, opts?: { enabled?: boolean }) {
  return useQuery({ ...calendarQuery(from, to), placeholderData: keepPreviousData, enabled: opts?.enabled ?? true });
}

// ───────────────────────── card view-models ─────────────────────────

export interface CalendarCard {
  /** Stable key for lists and layout animation: the planned id when there is one, else the activity id. */
  key: string;
  model: WorkoutCardModel;
  /** Where a click goes. Paired and completed cards open the activity. */
  target: { type: 'workout' | 'activity'; id: string };
  workout?: PlannedWorkout;
  activity?: Activity;
  /** Only planned, not-yet-completed workouts can be dragged to another day. */
  draggable: boolean;
}

export function workoutCardModel(w: PlannedWorkout): WorkoutCardModel {
  return {
    id: w.id,
    kind: 'planned',
    sport: w.sport,
    subSport: w.subSport,
    title: w.title,
    durationSec: w.plannedDurationSec,
    distanceM: w.plannedDistanceM,
    load: w.plannedLoad,
    isKey: w.isKey,
    intensity: w.intensity,
    compliance: w.compliance ?? { state: 'planned' },
    hasNote: Boolean(w.preNote || w.description),
    garminState: w.garmin.syncState === 'none' ? null : w.garmin.syncState,
    sparkline: w.sparkline,
    startTime: w.startTime,
    skipReason: w.status === 'skipped' ? (w.skipReason ?? 'other') : null,
  };
}

export function activityCardModel(a: Activity, planned?: PlannedWorkout): WorkoutCardModel {
  return {
    id: a.id,
    kind: planned ? 'paired' : 'activity',
    sport: a.sport,
    subSport: a.subSport,
    title: a.title,
    durationSec: a.movingSec || a.durationSec,
    distanceM: a.distanceM,
    load: a.load,
    isKey: a.isKey || Boolean(planned?.isKey),
    intensity: a.intensity,
    compliance: a.compliance ?? { state: planned ? 'on_target' : 'unplanned' },
    hasNote: Boolean(a.postNote || planned?.preNote),
    garminState: null,
    sparkline: a.sparkline ?? planned?.sparkline,
  };
}

/** Cards for one day: paired planned+completed collapse into one card; sorted for display. */
export function dayCards(cal: Pick<CalendarResponse, 'workouts' | 'activities'>, date: LocalDate): CalendarCard[] {
  const activitiesById = new Map(cal.activities.map((a) => [a.id, a]));
  const pairedActivityIds = new Set<string>();
  const cards: CalendarCard[] = [];

  for (const w of cal.workouts) {
    if (w.date !== date) continue;
    const a = w.pairedActivityId ? activitiesById.get(w.pairedActivityId) : undefined;
    if (a) {
      pairedActivityIds.add(a.id);
      cards.push({ key: w.id, model: activityCardModel(a, w), target: { type: 'activity', id: a.id }, workout: w, activity: a, draggable: false });
    } else {
      cards.push({ key: w.id, model: workoutCardModel(w), target: { type: 'workout', id: w.id }, workout: w, draggable: w.status !== 'skipped' });
    }
  }
  for (const a of cal.activities) {
    if (a.localDate !== date || pairedActivityIds.has(a.id)) continue;
    // Paired with a workout planned on another day: still shown on the day it was done.
    cards.push({ key: a.id, model: activityCardModel(a), target: { type: 'activity', id: a.id }, activity: a, draggable: false });
  }

  const startOf = (c: CalendarCard) => c.activity?.startedAt ?? (c.workout?.startTime ? `~${c.workout.startTime}` : '~~');
  return cards.sort((x, y) => {
    const sx = startOf(x);
    const sy = startOf(y);
    if (sx !== sy) return sx < sy ? -1 : 1;
    if (x.model.isKey !== y.model.isKey) return x.model.isKey ? -1 : 1;
    return (y.model.durationSec ?? 0) - (x.model.durationSec ?? 0);
  });
}

// ───────────────────────── optimistic cache helpers ─────────────────────────

type CalPatch = (cal: CalendarResponse) => CalendarResponse;

function patchCalendars(qc: QueryClient, patch: CalPatch): Array<[readonly unknown[], CalendarResponse | undefined]> {
  const snapshot = qc.getQueriesData<CalendarResponse>({ queryKey: qk.calendar.all });
  qc.setQueriesData<CalendarResponse>({ queryKey: qk.calendar.all }, (cal) => (cal ? patch(cal) : cal));
  return snapshot;
}

function restoreCalendars(qc: QueryClient, snapshot: Array<[readonly unknown[], CalendarResponse | undefined]>) {
  for (const [key, data] of snapshot) qc.setQueryData(key, data);
}

const mapWorkouts = (fn: (w: PlannedWorkout) => PlannedWorkout): CalPatch => (cal) => ({ ...cal, workouts: cal.workouts.map(fn) });

const inWindow = (cal: CalendarResponse, date: LocalDate) => date >= cal.from && date <= cal.to;

// ───────────────────────── workout mutations ─────────────────────────

export type WorkoutPatch = Partial<PlannedWorkoutInput>;

/** PATCH a planned workout (move date, toggle key, set intensity, edit fields). Optimistic. */
export function usePatchWorkout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch, scope }: { id: string; patch: WorkoutPatch; scope?: 'this' | 'following' }) =>
      call(api.workouts[':id'].$patch({ param: { id }, query: scope ? { scope } : {}, json: patch })) as Promise<PlannedWorkout>,
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: qk.calendar.all });
      const snapshot = patchCalendars(qc, mapWorkouts((w) => (w.id === id ? ({ ...w, ...patch } as PlannedWorkout) : w)));
      const prevDetail = qc.getQueryData<PlannedWorkout>(qk.workouts.detail(id));
      if (prevDetail) qc.setQueryData<PlannedWorkout>(qk.workouts.detail(id), { ...prevDetail, ...patch } as PlannedWorkout);
      return { snapshot, prevDetail };
    },
    onError: (_e, { id }, ctx) => {
      if (ctx?.snapshot) restoreCalendars(qc, ctx.snapshot);
      if (ctx?.prevDetail) qc.setQueryData(qk.workouts.detail(id), ctx.prevDetail);
    },
    onSuccess: (w) => qc.setQueryData(qk.workouts.detail(w.id), w),
    onSettled: () => invalidateTraining(),
  });
}

/** Move a planned workout to another day. Resolves with the previous date so the caller can offer undo. */
export function useMoveWorkout() {
  const patch = usePatchWorkout();
  return {
    ...patch,
    move: (workout: Pick<PlannedWorkout, 'id' | 'date'>, date: LocalDate) =>
      patch.mutateAsync({ id: workout.id, patch: { date } }).then(() => ({ previousDate: workout.date })),
  };
}

export function useCreateWorkout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PlannedWorkoutInput) => call(api.workouts.$post({ json: input })) as Promise<PlannedWorkout>,
    onSuccess: (w) => {
      qc.setQueryData(qk.workouts.detail(w.id), w);
      patchCalendars(qc, (cal) => (inWindow(cal, w.date) ? { ...cal, workouts: [...cal.workouts, w] } : cal));
    },
    onSettled: () => invalidateTraining(),
  });
}

/** Calendar quick-add: "run 45m easy", "bike 4x8m 95-100% @key #vo2". */
export function useQuickAdd() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { date: LocalDate; text: string; startTime?: string }) => call(api.workouts.quick.$post({ json: input })),
    onSuccess: (res) => {
      const w = res.workout as PlannedWorkout;
      qc.setQueryData(qk.workouts.detail(w.id), w);
      patchCalendars(qc, (cal) => (inWindow(cal, w.date) ? { ...cal, workouts: [...cal.workouts, w] } : cal));
    },
    onSettled: () => invalidateTraining(),
  });
}

export function useDuplicateWorkout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, date }: { id: string; date: LocalDate }) =>
      call(api.workouts[':id'].duplicate.$post({ param: { id }, json: { date } })) as Promise<PlannedWorkout>,
    onSuccess: (w) => patchCalendars(qc, (cal) => (inWindow(cal, w.date) ? { ...cal, workouts: [...cal.workouts, w] } : cal)),
    onSettled: () => invalidateTraining(),
  });
}

/**
 * Delete planned workouts. Resolves with the deleted objects; pass them to `useRestoreWorkouts`
 * from an undo toast:  toast.undo('Deleted …', () => restore.mutate(deleted))
 */
export function useDeleteWorkouts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await call(api.calendar.delete.$post({ json: { ids } }));
      return res.deleted as PlannedWorkout[];
    },
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: qk.calendar.all });
      const gone = new Set(ids);
      return { snapshot: patchCalendars(qc, (cal) => ({ ...cal, workouts: cal.workouts.filter((w) => !gone.has(w.id)) })) };
    },
    onError: (_e, _ids, ctx) => ctx?.snapshot && restoreCalendars(qc, ctx.snapshot),
    onSettled: () => invalidateTraining(),
  });
}

/** Re-insert workouts verbatim (undo for delete, shift and copy operations). */
export function useRestoreWorkouts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (workouts: PlannedWorkout[]) => call(api.calendar.restore.$post({ json: { workouts } })),
    onMutate: (workouts) => {
      const ids = new Set(workouts.map((w) => w.id));
      patchCalendars(qc, (cal) => ({
        ...cal,
        workouts: [...cal.workouts.filter((w) => !ids.has(w.id)), ...workouts.filter((w) => inWindow(cal, w.date))],
      }));
    },
    onSettled: () => invalidateTraining(),
  });
}

export function useSetWorkoutKey() {
  const patch = usePatchWorkout();
  return (id: string, isKey: boolean) => patch.mutate({ id, patch: { isKey } });
}

export function useSetWorkoutIntensity() {
  const patch = usePatchWorkout();
  return (id: string, intensity: IntensityClass) => patch.mutate({ id, patch: { intensity } });
}

// ───────────────────────── activity mutations ─────────────────────────

/** PATCH an activity (title, key, intensity override, RPE, feel, note, tags). Optimistic. */
export function usePatchActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ActivityPatch }) =>
      call(api.activities[':id'].$patch({ param: { id }, json: patch })) as Promise<Activity>,
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: qk.calendar.all });
      const clean = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === null ? undefined : v])) as Partial<Activity>;
      const apply = <T extends Activity>(a: T): T => ({
        ...a,
        ...clean,
        intensity: (clean.intensityOverride ?? ('intensityOverride' in patch ? a.intensityAuto : a.intensity)) as IntensityClass,
      });
      const snapshot = patchCalendars(qc, (cal) => ({ ...cal, activities: cal.activities.map((a) => (a.id === id ? apply(a) : a)) }));
      const prevDetail = qc.getQueryData<Activity>(qk.activities.detail(id));
      if (prevDetail) qc.setQueryData(qk.activities.detail(id), apply(prevDetail));
      return { snapshot, prevDetail };
    },
    onError: (_e, { id }, ctx) => {
      if (ctx?.snapshot) restoreCalendars(qc, ctx.snapshot);
      if (ctx?.prevDetail) qc.setQueryData(qk.activities.detail(id), ctx.prevDetail);
    },
    onSettled: () => invalidateTraining(),
  });
}
