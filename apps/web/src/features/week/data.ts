/** Weekly review data: the week bundle, notes (own + next week's targets), wellness, phases, copy-forward. */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LocalDate, Phase, PlannedWorkout, WeekNote } from '@cadence/core';
import { api, call } from '@/lib/api';
import { invalidateTraining, qk } from '@/lib/query';

/** API "today" (user timezone) — shared cache entry with the trends feature. */
export function useApiToday(): LocalDate | undefined {
  const q = useQuery({
    queryKey: qk.trends.of('today'),
    queryFn: () => call(api.trends.consistency.$get({ query: { days: '7' } as never })),
    staleTime: 60_000,
  });
  return q.data?.to;
}

export const weekQuery = (isoWeek: string) => ({
  queryKey: qk.weeks.detail(isoWeek),
  queryFn: () => call(api.weeks[':isoWeek'].$get({ param: { isoWeek } })),
});
export function useWeek(isoWeek: string) {
  return useQuery({ ...weekQuery(isoWeek), placeholderData: keepPreviousData });
}
export type WeekBundle = NonNullable<ReturnType<typeof useWeek>['data']>;

export function useWeekNote(isoWeek: string) {
  return useQuery({
    queryKey: qk.furniture.weekNote(isoWeek),
    queryFn: () => call(api['week-notes'][':isoWeek'].$get({ param: { isoWeek } })) as Promise<WeekNote | null>,
  });
}

export function useSaveWeekNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ isoWeek, body, targetHours, targetLoad }: { isoWeek: string; body: string; targetHours?: number | null; targetLoad?: number | null }) =>
      call(api['week-notes'][':isoWeek'].$put({ param: { isoWeek }, json: { body, ...(targetHours !== undefined ? { targetHours } : {}), ...(targetLoad !== undefined ? { targetLoad } : {}) } })) as Promise<WeekNote>,
    onSuccess: (note) => {
      qc.setQueryData(qk.furniture.weekNote(note.isoWeek), note);
      void qc.invalidateQueries({ queryKey: qk.weeks.all });
      void qc.invalidateQueries({ queryKey: qk.calendar.all });
      void qc.invalidateQueries({ queryKey: qk.journal.all });
    },
  });
}

export function useWeekWellness(from: LocalDate, to: LocalDate) {
  return useQuery({
    queryKey: qk.trends.of('wellness', { from, to }),
    queryFn: () => call(api.trends.wellness.$get({ query: { from, to } })),
    placeholderData: keepPreviousData,
  });
}

export function usePhases(from: LocalDate, to: LocalDate) {
  return useQuery({
    queryKey: [...qk.furniture.phases, from, to],
    queryFn: () => call(api.phases.$get({ query: { from, to } })) as Promise<Phase[]>,
    staleTime: 5 * 60_000,
  });
}

export function useCopyWeek() {
  return useMutation({
    mutationFn: async (b: { fromWeek: string; toWeek: string; progressionPct: number }) => {
      const res = await call(api.calendar['copy-week'].$post({ json: b }));
      return res.created as PlannedWorkout[];
    },
    onSettled: () => invalidateTraining(),
  });
}

export async function deleteWorkouts(ids: string[]) {
  await call(api.calendar.delete.$post({ json: { ids } }));
  await invalidateTraining();
}
