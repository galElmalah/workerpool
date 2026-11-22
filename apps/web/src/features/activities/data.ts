/**
 * Activities feature data layer: detail / streams / list / peaks queries and the mutations that
 * are not in the shared training layer (delete + restore, manual entry, FIT upload, pairing).
 *
 * Streams and peaks use keys outside the `activities` / `trends` prefixes on purpose: every PATCH
 * calls `invalidateTraining()`, and refetching a 3 h 1 Hz stream after each RPE tap would be waste.
 */
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Activity, ActivityDetail, ActivityStreams, BestEffort, IntensityClass, LocalDate, ManualActivityInput, PeakPoint, PlannedWorkout, Sport } from '@cadence/core/domain';
import { api, call, raw } from '@/lib/api';
import { invalidateTraining, qk } from '@/lib/query';

export const detailQuery = (id: string) => ({
  queryKey: qk.activities.detail(id),
  queryFn: () => call(api.activities[':id'].$get({ param: { id } })) as Promise<ActivityDetail>,
  staleTime: 30_000,
});
export const useActivity = (id: string) => useQuery(detailQuery(id));

export const streamsKey = (id: string) => ['activity-streams', id] as const;
export function useStreams(id: string, enabled: boolean) {
  return useQuery({
    queryKey: streamsKey(id),
    queryFn: async () => (await (await raw(`/activities/${id}/streams`)).json()) as ActivityStreams,
    enabled,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
  });
}

export interface ListFilters {
  sport?: Sport;
  q?: string;
  from?: LocalDate;
  to?: LocalDate;
  key?: boolean;
  intensity?: IntensityClass;
}
export interface ListTotals {
  count: number;
  durationSec: number;
  movingSec: number;
  distanceM: number;
  load: number;
  elevationGainM: number;
}
interface ListPage {
  items: Activity[];
  totals: ListTotals;
  nextCursor?: string;
}

export function useActivityList(f: ListFilters) {
  return useInfiniteQuery({
    queryKey: qk.activities.list(f),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      call(
        api.activities.$get({
          query: {
            ...(f.sport ? { sport: f.sport } : {}),
            ...(f.q ? { q: f.q } : {}),
            ...(f.from ? { from: f.from } : {}),
            ...(f.to ? { to: f.to } : {}),
            ...(f.key ? { key: '1' as const } : {}),
            ...(f.intensity ? { intensity: f.intensity } : {}),
            limit: '60',
            ...(pageParam ? { cursor: pageParam } : {}),
          } as never,
        }),
      ) as Promise<ListPage>,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export type PeakRange = {
  key: string;
  from: LocalDate;
  to: LocalDate;
  activities: number;
  power?: Array<PeakPoint & { activityId?: string; date?: LocalDate }>;
  speed?: Array<PeakPoint & { activityId?: string; date?: LocalDate }>;
  hr?: Array<PeakPoint & { activityId?: string; date?: LocalDate }>;
  efforts?: Array<BestEffort & { activityId: string; date: LocalDate }>;
};
export function usePeaks(sport: Sport, enabled: boolean) {
  return useQuery({
    queryKey: ['act-peaks', sport],
    queryFn: async () => {
      const r = (await call(api.trends.peaks.$get({ query: { sport, ranges: '90d,all' } }))) as unknown as { ranges: PeakRange[] };
      return r.ranges;
    },
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useWorkoutsAround(from: LocalDate, to: LocalDate, enabled: boolean) {
  return useQuery({
    queryKey: ['workouts', 'range', from, to],
    queryFn: () => call(api.workouts.$get({ query: { from, to } })) as Promise<PlannedWorkout[]>,
    enabled,
    staleTime: 30_000,
  });
}

/** Delete (soft) — resolves with the activity so the caller can offer undo via restore. */
export function useDeleteActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => call(api.activities[':id'].$delete({ param: { id } })) as Promise<Activity>,
    onSuccess: (_a, id) => qc.removeQueries({ queryKey: qk.activities.detail(id) }),
    onSettled: () => invalidateTraining(),
  });
}
export function useRestoreActivity() {
  return useMutation({
    mutationFn: (id: string) => call(api.activities[':id'].restore.$post({ param: { id } })) as Promise<Activity>,
    onSettled: () => invalidateTraining(),
  });
}

export function useManualActivity() {
  return useMutation({
    mutationFn: (input: ManualActivityInput) => call(api.activities.manual.$post({ json: input })) as Promise<Activity>,
    onSettled: () => invalidateTraining(),
  });
}

export interface UploadResult {
  outcome: 'created' | 'updated' | 'skipped' | string;
  activityId?: string;
  reason?: string;
  activity?: Activity;
}
export async function uploadFit(file: Blob): Promise<UploadResult> {
  const res = await raw('/activities/upload', { method: 'POST', body: file, headers: { 'content-type': 'application/octet-stream' } });
  void invalidateTraining();
  return (await res.json()) as UploadResult;
}

export function usePairing(activityId: string) {
  const qc = useQueryClient();
  const settle = () => Promise.all([qc.invalidateQueries({ queryKey: qk.activities.detail(activityId) }), invalidateTraining()]);
  const pair = useMutation({
    mutationFn: (workoutId: string) => call(api.workouts[':id'].pair.$post({ param: { id: workoutId }, json: { activityId } })),
    onSettled: settle,
  });
  const unpair = useMutation({
    mutationFn: (workoutId: string) => call(api.workouts[':id'].pair.$delete({ param: { id: workoutId } })),
    onSettled: settle,
  });
  return { pair, unpair };
}
