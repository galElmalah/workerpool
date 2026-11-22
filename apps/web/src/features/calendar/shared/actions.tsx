/**
 * Card actions shared by the month and week views: open (with the shared-element morph), move,
 * duplicate, key, intensity, skip, Garmin push, save to library, delete — all optimistic, all
 * undoable through `toast.undo` (and therefore ⌘Z).
 */
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';
import type { CalendarResponse, IntensityClass, LocalDate, PlannedWorkout } from '@cadence/core/domain';
import { api, call } from '@/lib/api';
import { formatDayShort } from '@/lib/format';
import { invalidateTraining, qk } from '@/lib/query';
import {
  useDeleteWorkouts,
  useDuplicateWorkout,
  useMoveWorkout,
  usePatchActivity,
  usePatchWorkout,
  useQuickAdd,
  useRestoreWorkouts,
  type CalendarCard,
} from '@/lib/queries/training';
import { morph } from '@/motion/morph';
import { links } from '@/shell/links';
import { toast } from '@/ui/toast';

export const SKIP_LABELS = { sick: 'Sick', injury: 'Injury', travel: 'Travel', fatigue: 'Fatigue', life: 'Life', weather: 'Weather', other: 'Other' } as const;
export type SkipReason = keyof typeof SKIP_LABELS;

const title = (c: CalendarCard) => c.model.title || 'workout';

export function useCardActions() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const mover = useMoveWorkout();
  const patch = usePatchWorkout();
  const patchAct = usePatchActivity();
  const dup = useDuplicateWorkout();
  const del = useDeleteWorkouts();
  const restore = useRestoreWorkouts();
  const quick = useQuickAdd();

  return useMemo(() => {
    const patchCache = (id: string, fn: (w: PlannedWorkout) => PlannedWorkout) =>
      qc.setQueriesData<CalendarResponse>({ queryKey: qk.calendar.all }, (cal) => (cal ? { ...cal, workouts: cal.workouts.map((w) => (w.id === id ? fn(w) : w)) } : cal));

    const open = (c: CalendarCard) => {
      morph.set(c.model.id);
      void navigate(c.target.type === 'workout' ? links.workout(c.target.id) : links.activity(c.target.id));
    };

    const move = (c: CalendarCard, date: LocalDate, opts?: { silent?: boolean }) => {
      const w = c.workout;
      if (!w || !c.draggable || w.date === date) return;
      const from = w.date;
      mover
        .move(w, date)
        .then(() => {
          if (opts?.silent) return;
          toast.undo(
            <>
              Moved <b>{title(c)}</b> to {formatDayShort(date)}
            </>,
            () => mover.mutate({ id: w.id, patch: { date: from } }),
          );
        })
        .catch(() => toast.error(`Couldn't move ${title(c)}`));
    };

    const duplicate = (c: CalendarCard, date: LocalDate) => {
      const w = c.workout;
      if (!w) return;
      dup
        .mutateAsync({ id: w.id, date })
        .then((copy) =>
          toast.undo(
            <>
              Copied <b>{title(c)}</b> to {formatDayShort(date)}
            </>,
            () => del.mutate([copy.id]),
          ),
        )
        .catch(() => toast.error(`Couldn't copy ${title(c)}`));
    };

    const paste = (cards: CalendarCard[], date: LocalDate) => {
      const ws = cards.map((c) => c.workout).filter((w): w is PlannedWorkout => !!w);
      if (!ws.length) return;
      Promise.all(ws.map((w) => dup.mutateAsync({ id: w.id, date })))
        .then((copies) =>
          toast.undo(`Pasted ${copies.length} workout${copies.length === 1 ? '' : 's'} into ${formatDayShort(date)}`, () => del.mutate(copies.map((x) => x.id))),
        )
        .catch(() => toast.error("Couldn't paste"));
    };

    const toggleKey = (c: CalendarCard) => {
      const next = !c.model.isKey;
      if (c.workout) patch.mutate({ id: c.workout.id, patch: { isKey: next } });
      else if (c.activity) patchAct.mutate({ id: c.activity.id, patch: { isKey: next } });
    };

    const setIntensity = (c: CalendarCard, intensity: IntensityClass) => {
      if (c.workout && !c.activity) patch.mutate({ id: c.workout.id, patch: { intensity } });
      else if (c.activity) patchAct.mutate({ id: c.activity.id, patch: { intensityOverride: intensity } });
    };

    const remove = (cards: CalendarCard[]) => {
      const ids = cards.filter((c) => c.workout && !c.activity).map((c) => c.workout!.id);
      if (!ids.length) {
        if (cards.length) toast('Completed activities are deleted from their own page');
        return;
      }
      const label = ids.length === 1 ? <b>{title(cards.find((c) => c.workout?.id === ids[0])!)}</b> : `${ids.length} workouts`;
      del
        .mutateAsync(ids)
        .then((deleted) => toast.undo(<>Deleted {label}</>, () => restore.mutate(deleted)))
        .catch(() => toast.error("Couldn't delete"));
    };

    const skip = (c: CalendarCard, reason: SkipReason | null) => {
      const w = c.workout;
      if (!w) return;
      patchCache(w.id, (x) => ({ ...x, status: reason ? 'skipped' : 'planned', skipReason: reason ?? undefined, compliance: reason ? { metric: 'duration', ratio: 0, state: 'excused' } : x.compliance }));
      const req = reason ? call(api.workouts[':id'].skip.$post({ param: { id: w.id }, json: { reason } })) : call(api.workouts[':id'].skip.$delete({ param: { id: w.id } }));
      req
        .then(() => {
          if (reason) toast.undo(<>Skipped <b>{title(c)}</b> · {SKIP_LABELS[reason].toLowerCase()}</>, () => skip(c, null));
        })
        .catch(() => toast.error("Couldn't update"))
        .finally(() => invalidateTraining());
    };

    const garmin = (c: CalendarCard, push: boolean) => {
      const w = c.workout;
      if (!w) return;
      patchCache(w.id, (x) => ({ ...x, garmin: { ...x.garmin, syncState: push ? 'pending' : 'none' } }));
      const req = push
        ? call(api.garmin.push[':workoutId'].$post({ param: { workoutId: w.id } }))
        : call(api.garmin.push[':workoutId'].$delete({ param: { workoutId: w.id } }));
      req
        .then(() => toast.success(push ? 'Sent to your watch' : 'Removed from your watch'))
        .catch((e: Error) => toast.error(push ? `Couldn't send: ${e.message}` : `Couldn't remove: ${e.message}`))
        .finally(() => invalidateTraining());
    };

    const saveToLibrary = (c: CalendarCard) => {
      const w = c.workout;
      if (!w) return;
      call(api.templates['from-workout'][':id'].$post({ param: { id: w.id }, json: {} }))
        .then(() => {
          void qc.invalidateQueries({ queryKey: qk.templates.all });
          toast.success(<>Saved <b>{title(c)}</b> to the library</>);
        })
        .catch(() => toast.error("Couldn't save to the library"));
    };

    const quickAdd = (date: LocalDate, text: string) => quick.mutateAsync({ date, text });

    return { open, move, duplicate, paste, toggleKey, setIntensity, remove, skip, garmin, saveToLibrary, quickAdd, deleteIds: (ids: string[]) => del.mutate(ids) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, qc]);
}

export type CardActions = ReturnType<typeof useCardActions>;
