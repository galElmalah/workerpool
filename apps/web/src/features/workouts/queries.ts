/**
 * Workout-page data: detail query and the mutations not covered by `@/lib/queries/training`
 * (Garmin push, skip, repeat, pair, save to library, templates).
 */
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Activity, GarminLink, LocalDate, PlannedWorkout, Template } from '@cadence/core';
import { SKIP_REASONS } from '@cadence/core';
import { api, call } from '@/lib/api';
import { invalidateTraining, qk } from '@/lib/query';

export type SkipReason = (typeof SKIP_REASONS)[number];

export const workoutQuery = (id: string) =>
  queryOptions({
    queryKey: qk.workouts.detail(id),
    queryFn: () => call(api.workouts[':id'].$get({ param: { id } })) as Promise<PlannedWorkout>,
    staleTime: 15_000,
  });

export const useWorkout = (id: string) => useQuery({ ...workoutQuery(id), enabled: !!id });

function useSetDetail() {
  const qc = useQueryClient();
  return (w: PlannedWorkout) => qc.setQueryData(qk.workouts.detail(w.id), w);
}

export function useGarminPush() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => call(api.garmin.push[':workoutId'].$post({ param: { workoutId: id } })) as Promise<GarminLink>,
    onMutate: (id) => {
      const prev = qc.getQueryData<PlannedWorkout>(qk.workouts.detail(id));
      if (prev) qc.setQueryData(qk.workouts.detail(id), { ...prev, garmin: { ...prev.garmin, syncState: 'pending' as const } });
      return { prev };
    },
    onSuccess: (link, id) => {
      const prev = qc.getQueryData<PlannedWorkout>(qk.workouts.detail(id));
      if (prev) qc.setQueryData(qk.workouts.detail(id), { ...prev, garmin: link });
    },
    onError: (_e, id, ctx) => ctx?.prev && qc.setQueryData(qk.workouts.detail(id), ctx.prev),
    onSettled: () => Promise.all([invalidateTraining(), qc.invalidateQueries({ queryKey: qk.garmin.log() })]),
  });
}

export function useGarminRemove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => call(api.garmin.push[':workoutId'].$delete({ param: { workoutId: id } })),
    onSuccess: (_r, id) => {
      const prev = qc.getQueryData<PlannedWorkout>(qk.workouts.detail(id));
      if (prev) qc.setQueryData(qk.workouts.detail(id), { ...prev, garmin: { syncState: 'none' as const } });
    },
    onSettled: () => invalidateTraining(),
  });
}

export function useSkip() {
  const set = useSetDetail();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: SkipReason | null }) =>
      (reason
        ? call(api.workouts[':id'].skip.$post({ param: { id }, json: { reason } }))
        : call(api.workouts[':id'].skip.$delete({ param: { id } }))) as Promise<PlannedWorkout>,
    onSuccess: set,
    onSettled: () => invalidateTraining(),
  });
}

export function useRepeatWeekly() {
  return useMutation({
    mutationFn: ({ id, weeks }: { id: string; weeks: number }) => call(api.workouts[':id'].repeat.$post({ param: { id }, json: { weeks } })),
    onSettled: () => invalidateTraining(),
  });
}

export function usePair() {
  const set = useSetDetail();
  return useMutation({
    mutationFn: ({ id, activityId }: { id: string; activityId: string | null }) =>
      (activityId
        ? call(api.workouts[':id'].pair.$post({ param: { id }, json: { activityId } }))
        : call(api.workouts[':id'].pair.$delete({ param: { id } }))) as Promise<PlannedWorkout>,
    onSuccess: set,
    onSettled: () => invalidateTraining(),
  });
}

/** Activities in [from, to] (for "Pair with…"). */
export function useActivitiesBetween(from: LocalDate, to: LocalDate, enabled: boolean) {
  return useQuery({
    queryKey: qk.activities.list({ from, to, pair: true }),
    queryFn: async () => (await call(api.activities.$get({ query: { from, to } }))).items as Activity[],
    enabled,
  });
}

export function useActivity(id: string | undefined) {
  return useQuery({
    queryKey: qk.activities.detail(id ?? '-'),
    queryFn: () => call(api.activities[':id'].$get({ param: { id: id! } })) as Promise<Activity>,
    enabled: !!id,
  });
}

// ───────────────────────── templates ─────────────────────────

export const templatesQuery = queryOptions({
  queryKey: qk.templates.list('all'),
  queryFn: () => call(api.templates.$get({ query: {} })) as Promise<Template[]>,
  staleTime: 60_000,
});
export const useTemplates = (enabled = true) => useQuery({ ...templatesQuery, enabled });

export const templateQuery = (id: string) =>
  queryOptions({
    queryKey: qk.templates.detail(id),
    queryFn: () => call(api.templates[':id'].$get({ param: { id } })) as Promise<Template>,
  });
export const useTemplate = (id: string | undefined) => useQuery({ ...templateQuery(id ?? '-'), enabled: !!id });

export function useSaveToLibrary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => call(api.templates['from-workout'][':id'].$post({ param: { id }, json: {} })) as Promise<Template>,
    onSettled: () => qc.invalidateQueries({ queryKey: qk.templates.all }),
  });
}

export type TemplateInput = Omit<Template, 'id' | 'usageCount' | 'lastUsedAt' | 'createdAt' | 'updatedAt'>;

export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<TemplateInput> & Pick<TemplateInput, 'sport' | 'title'>) => call(api.templates.$post({ json: input })) as Promise<Template>,
    onSettled: () => qc.invalidateQueries({ queryKey: qk.templates.all }),
  });
}

export function usePatchTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      call(api.templates[':id'].$patch({ param: { id }, json: patch as never })) as Promise<Template>,
    onMutate: ({ id, patch }) => {
      const prev = qc.getQueryData<Template>(qk.templates.detail(id));
      if (prev) qc.setQueryData(qk.templates.detail(id), { ...prev, ...patch });
      return { prev };
    },
    onError: (_e, { id }, ctx) => ctx?.prev && qc.setQueryData(qk.templates.detail(id), ctx.prev),
    onSuccess: (t) => qc.setQueryData(qk.templates.detail(t.id), t),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.templates.list('all') }),
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => call(api.templates[':id'].$delete({ param: { id } })) as Promise<Template>,
    onMutate: (id) => {
      const prev = qc.getQueryData<Template[]>(qk.templates.list('all'));
      if (prev) qc.setQueryData(qk.templates.list('all'), prev.filter((t) => t.id !== id));
      return { prev };
    },
    onError: (_e, _id, ctx) => ctx?.prev && qc.setQueryData(qk.templates.list('all'), ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.templates.all }),
  });
}

export function useRestoreTemplates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (templates: Template[]) => call(api.templates.restore.$post({ json: { templates } })),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.templates.all }),
  });
}

export function useScheduleTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dates }: { id: string; dates: LocalDate[] }) => call(api.templates[':id'].schedule.$post({ param: { id }, json: { dates } })),
    onSettled: () => Promise.all([invalidateTraining(), qc.invalidateQueries({ queryKey: qk.templates.all })]),
  });
}

export function useSeedStarter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => call(api.templates['seed-starter'].$post()),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.templates.all }),
  });
}

/** Planned workouts in a window (for "scheduled instances" of a template). */
export function useWorkoutsBetween(from: LocalDate | undefined, to: LocalDate | undefined) {
  return useQuery({
    queryKey: [...qk.workouts.all, 'range', from, to],
    queryFn: () => call(api.workouts.$get({ query: { from: from!, to: to! } })) as Promise<PlannedWorkout[]>,
    enabled: !!from && !!to,
  });
}
