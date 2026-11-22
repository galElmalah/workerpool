/**
 * Daily-views kit: data hooks, furniture mutations and the small interactive pieces shared by the
 * Today page and the day / agenda / season / event pages. (Feature folders never import each other,
 * so `features/calendar/day/kit.tsx` is a verbatim copy of this file — edit here, then copy.)
 */
import type { Activity, DayMarker, Event, LocalDate, Phase, PlannedWorkout, Sport, ThresholdSnapshot, WellnessDay } from '@cadence/core/domain';
import { estimateWorkout } from '@cadence/core/workout';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Check, CornerDownLeft, Plus, RefreshCw, TriangleAlert, Watch } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ProfileBlock } from '@/charts';
import { IntensityProfile, T, useChartSize } from '@/charts';
import { api, call } from '@/lib/api';
import { cn } from '@/lib/cn';
import { distanceParts, formatClockTime, formatDuration, formatInstantTime, formatLoad, NBSP, paceParts } from '@/lib/format';
import { invalidateTraining, qk } from '@/lib/query';
import { useCurrentThresholds, useGarminStatus, useSyncNow } from '@/lib/queries/shared';
import { usePatchActivity, useQuickAdd, type CalendarCard } from '@/lib/queries/training';
import { useUnits } from '@/lib/units';
import { useIsMorphTarget, vt } from '@/motion/morph';
import { onSpotlightMove } from '@/motion/pointer';
import { spring, tween } from '@/motion/tokens';
import {
  Button,
  ComplianceBar,
  ComplianceGlyph,
  complianceLabel,
  complianceStyles,
  Input,
  IntensityPips,
  KeyStar,
  MiniProfile,
  morphSourceProps,
  SaveIndicator,
  Skeleton,
  SportGlyph,
  Textarea,
  toast,
  type SaveStatus,
} from '@/ui';
import { links } from '@/shell/links';

// ───────────────────────── queries ─────────────────────────

const fetchToday = () => call(api.today.$get());
export type TodayData = Awaited<ReturnType<typeof fetchToday>>;
export const useTodayData = () => useQuery({ queryKey: qk.today, queryFn: fetchToday, staleTime: 30_000 });

const fetchWellnessTrend = (from: LocalDate, to: LocalDate) => call(api.trends.wellness.$get({ query: { from, to } }));
export type WellnessTrend = Awaited<ReturnType<typeof fetchWellnessTrend>>;
export const useWellnessTrend = (from: LocalDate | undefined, to: LocalDate | undefined) =>
  useQuery({ queryKey: qk.trends.of('wellness', { from, to }), queryFn: () => fetchWellnessTrend(from!, to!), enabled: !!from && !!to, staleTime: 60_000 });

const fetchFitness = (from: LocalDate, to: LocalDate) => call(api.trends.fitness.$get({ query: { from, to } }));
export type FitnessTrend = Awaited<ReturnType<typeof fetchFitness>>;
export const useFitnessTrend = (from: LocalDate | undefined, to: LocalDate | undefined) =>
  useQuery({ queryKey: qk.trends.of('fitness', { from, to }), queryFn: () => fetchFitness(from!, to!), enabled: !!from && !!to, staleTime: 60_000 });

const fetchWeekly = (weeks: number, end: LocalDate) => call(api.trends.weekly.$get({ query: { weeks: String(weeks), end } }));
export const useWeeklyTrend = (weeks: number, end: LocalDate | undefined) =>
  useQuery({ queryKey: qk.trends.of('weekly', { weeks, end }), queryFn: () => fetchWeekly(weeks, end!), enabled: !!end, staleTime: 60_000 });

export const useEvents = () => useQuery({ queryKey: qk.furniture.events, queryFn: () => call(api.events.$get({ query: {} })) as Promise<Event[]>, staleTime: 60_000 });
export const usePhases = () => useQuery({ queryKey: qk.furniture.phases, queryFn: () => call(api.phases.$get({ query: {} })) as Promise<Phase[]>, staleTime: 60_000 });

const refreshFurniture = (qc: ReturnType<typeof useQueryClient>) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: qk.furniture.events }),
    qc.invalidateQueries({ queryKey: qk.furniture.phases }),
    qc.invalidateQueries({ queryKey: qk.furniture.markers }),
    invalidateTraining(),
  ]);

// ───────────────────────── furniture mutations ─────────────────────────

export function useSaveDayNote() {
  return useMutation({
    mutationFn: ({ date, body }: { date: LocalDate; body: string }) => call(api['day-notes'][':date'].$put({ param: { date }, json: { body } })),
    onSettled: () => invalidateTraining(),
  });
}

export type WellnessInput = { feel?: number | null; soreness?: number | null; note?: string | null; weightKg?: number | null };
export function useSaveWellness() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ date, input }: { date: LocalDate; input: WellnessInput }) =>
      call(api.wellness[':date'].$put({ param: { date }, json: input })) as Promise<WellnessDay>,
    onMutate: async ({ date, input }) => {
      await qc.cancelQueries({ queryKey: qk.today });
      const prev = qc.getQueryData<TodayData>(qk.today);
      if (prev && prev.date === date) {
        const cur = (prev.wellness.today ?? { date }) as WellnessDay;
        const next = { ...cur } as Record<string, unknown>;
        for (const [k, v] of Object.entries(input)) if (v === null) delete next[k];
        else if (v !== undefined) next[k] = v;
        qc.setQueryData<TodayData>(qk.today, { ...prev, wellness: { ...prev.wellness, today: next as TodayData['wellness']['today'] } });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.today, ctx.prev);
      toast.error("Couldn't save the check-in");
    },
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: qk.today }), qc.invalidateQueries({ queryKey: qk.calendar.all }), qc.invalidateQueries({ queryKey: qk.trends.all })]),
  });
}

export function useMarkerMutations() {
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: (m: Omit<DayMarker, 'id'>) => call(api.markers.$post({ json: m })) as Promise<DayMarker>,
    onSettled: () => refreshFurniture(qc),
  });
  const remove = useMutation({
    mutationFn: (id: string) => call(api.markers[':id'].$delete({ param: { id } })) as Promise<DayMarker>,
    onSettled: () => refreshFurniture(qc),
  });
  return { create, remove };
}

export type EventInput = Omit<Event, 'id'>;
export function useEventMutations() {
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: (e: EventInput) => call(api.events.$post({ json: e })) as Promise<Event>,
    onSettled: () => refreshFurniture(qc),
  });
  const patch = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      call(api.events[':id'].$patch({ param: { id }, json: patch as never })) as Promise<Event>,
    onMutate: async ({ id, patch }) => {
      const prev = qc.getQueryData<Event[]>(qk.furniture.events);
      if (prev) qc.setQueryData<Event[]>(qk.furniture.events, prev.map((e) => (e.id === id ? ({ ...e, ...patch } as Event) : e)));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(qk.furniture.events, ctx.prev),
    onSettled: () => refreshFurniture(qc),
  });
  const remove = useMutation({
    mutationFn: (id: string) => call(api.events[':id'].$delete({ param: { id } })) as Promise<Event>,
    onMutate: async (id) => {
      const prev = qc.getQueryData<Event[]>(qk.furniture.events);
      if (prev) qc.setQueryData<Event[]>(qk.furniture.events, prev.filter((e) => e.id !== id));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(qk.furniture.events, ctx.prev),
    onSettled: () => refreshFurniture(qc),
  });
  return { create, patch, remove };
}

export type PhaseInput = Omit<Phase, 'id'>;
export function usePhaseMutations() {
  const qc = useQueryClient();
  const create = useMutation({ mutationFn: (p: PhaseInput) => call(api.phases.$post({ json: p })) as Promise<Phase>, onSettled: () => refreshFurniture(qc) });
  const patch = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) => call(api.phases[':id'].$patch({ param: { id }, json: patch as never })) as Promise<Phase>,
    onMutate: async ({ id, patch }) => {
      const prev = qc.getQueryData<Phase[]>(qk.furniture.phases);
      if (prev) qc.setQueryData<Phase[]>(qk.furniture.phases, prev.map((p) => (p.id === id ? ({ ...p, ...patch } as Phase) : p)));
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.furniture.phases, ctx.prev);
      toast.error("Couldn't save the phase", { description: e instanceof Error ? e.message : undefined });
    },
    onSettled: () => refreshFurniture(qc),
  });
  const remove = useMutation({
    mutationFn: (id: string) => call(api.phases[':id'].$delete({ param: { id } })) as Promise<Phase>,
    onMutate: async (id) => {
      const prev = qc.getQueryData<Phase[]>(qk.furniture.phases);
      if (prev) qc.setQueryData<Phase[]>(qk.furniture.phases, prev.filter((p) => p.id !== id));
      return { prev };
    },
    onSettled: () => refreshFurniture(qc),
  });
  return { create, patch, remove };
}

// ───────────────────────── profile blocks ─────────────────────────

export function useThresholdsFor(sport: Sport): ThresholdSnapshot {
  const { data } = useCurrentThresholds();
  return ((data?.sports as Record<string, ThresholdSnapshot> | undefined)?.[sport] ?? {}) as ThresholdSnapshot;
}

export function profileBlocks(w: PlannedWorkout | undefined, th: ThresholdSnapshot): ProfileBlock[] {
  if (!w?.structure?.steps.length) return [];
  try {
    return estimateWorkout(w.structure, w.sport, th).profile.map((b) => ({
      id: `${b.stepId}-${b.index}`,
      startSec: b.startSec,
      durationSec: b.durationSec,
      intensity: b.rampFrom ?? b.intensity,
      ...(b.rampTo !== undefined ? { intensityEnd: b.rampTo } : {}),
      level: b.level,
      role: b.role,
      ...(b.label ? { label: b.label } : {}),
    }));
  } catch {
    return [];
  }
}

/** Step profile for a planned workout (compact chart) or the card sparkline as a fallback. */
export function WorkoutProfile({ workout, sparkline, height = 40, className }: { workout?: PlannedWorkout; sparkline?: number[]; height?: number; className?: string }) {
  const th = useThresholdsFor(workout?.sport ?? 'bike');
  const blocks = useMemo(() => profileBlocks(workout, th), [workout, th]);
  if (blocks.length > 1) return <IntensityProfile variant="compact" blocks={blocks} height={height} className={className} />;
  const s = sparkline ?? workout?.sparkline;
  if (s && s.length > 1) return <MiniProfile values={s} height={Math.min(height, 28)} className={className} />;
  return null;
}

// ───────────────────────── autosave ─────────────────────────

/**
 * Debounced autosave that only fires when the value differs from the last saved one (safe under
 * StrictMode double effects and remounts — never writes the initial value back).
 */
export function useChangeAutosave<T>(value: T, save: (v: T) => Promise<unknown>, delay = 700): SaveStatus {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const saved = useRef(value);
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (Object.is(value, saved.current)) return;
    let cancelled = false;
    let relax: ReturnType<typeof setTimeout> | undefined;
    const t = setTimeout(async () => {
      setStatus('saving');
      try {
        await saveRef.current(value);
        saved.current = value;
        if (cancelled) return;
        setStatus('saved');
        relax = setTimeout(() => !cancelled && setStatus('idle'), 2400);
      } catch {
        if (!cancelled) setStatus('error');
      }
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(t);
      if (relax) clearTimeout(relax);
    };
  }, [value, delay]);
  return status;
}

/** "7:51" from seconds (h:mm). */
export const hm = (sec: number | null | undefined) => {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const m = Math.round(sec / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};

// ───────────────────────── small atoms ─────────────────────────

export function Stat({ label, value, unit, className, size = 'sm' }: { label: ReactNode; value: ReactNode; unit?: ReactNode; className?: string; size?: 'sm' | 'md' }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-0.5', className)}>
      <span className="text-micro uppercase text-fg-3">{label}</span>
      <span className={cn('flex items-baseline gap-1 text-fg-1', size === 'md' ? 'text-stat-md' : 'text-stat-sm')}>
        {value}
        {unit && <span className="text-label font-[450] text-fg-3">{unit}</span>}
      </span>
    </div>
  );
}

/** Duration · distance · load row for a session. */
export function SessionStats({ durationSec, distanceM, load, sport, className }: { durationSec?: number | null; distanceM?: number | null; load?: number | null; sport: Sport; className?: string }) {
  const units = useUnits();
  const dist = distanceM ? distanceParts(distanceM, sport, units) : null;
  return (
    <div className={cn('flex flex-wrap gap-x-6 gap-y-2', className)}>
      {durationSec ? <Stat label="Time" value={formatDuration(durationSec, 'clock')} /> : null}
      {dist && <Stat label="Distance" value={dist.value} unit={dist.unit} />}
      {load != null && load > 0 && <Stat label="Load" value={formatLoad(load)} />}
    </div>
  );
}

/** 1–5 dot scale (feel / soreness). Big touch targets on coarse pointers. */
export function DotScale({
  value,
  onChange,
  labels,
  label,
  size = 'md',
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  labels: string[];
  label: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const id = useId();
  const box = size === 'lg' ? 'size-11' : size === 'md' ? 'size-9 pointer-coarse:size-11' : 'size-7 pointer-coarse:size-10';
  const dot = size === 'lg' ? 'size-4' : size === 'md' ? 'size-3' : 'size-2.5';
  return (
    <div className="flex flex-col gap-1">
      <div role="radiogroup" aria-label={label} className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => {
          const on = value != null && n <= value;
          const sel = value === n;
          return (
            <motion.button
              key={n}
              type="button"
              role="radio"
              aria-checked={sel}
              aria-label={`${n} — ${labels[n - 1]}`}
              title={labels[n - 1]}
              whileTap={{ scale: 0.88 }}
              transition={spring.snappy}
              onClick={() => onChange(sel ? null : n)}
              className={cn('group/dot relative grid place-items-center rounded-full outline-none focus-visible:outline-2 focus-visible:outline-focus', box)}
            >
              {sel && <motion.span layoutId={`${id}-sel`} transition={spring.snappy} className="absolute inset-0.5 rounded-full border border-line-3 bg-surface-3" />}
              <motion.span
                initial={false}
                animate={{ scale: on ? 1 : 0.72 }}
                transition={on ? spring.bouncy : spring.snappy}
                className={cn(
                  'relative rounded-full transition-colors duration-(--dur-fast)',
                  dot,
                  on ? 'bg-fg-1' : 'border-[1.5px] border-fg-3 bg-transparent group-hover/dot:border-fg-1',
                )}
              />
            </motion.button>
          );
        })}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={value ?? 0}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: tween('fast', 'in') }}
          className={cn('pl-1 text-body-sm', value ? 'text-fg-1' : 'text-fg-3')}
        >
          {value ? labels[value - 1] : 'Tap to rate'}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

export const CHECKIN_FEEL = ['Very tired', 'Tired', 'Normal', 'Fresh', 'Very fresh'];
export const SORENESS = ['None', 'A little', 'Some', 'Sore', 'Very sore'];
export const ACTIVITY_FEEL = ['Awful', 'Poor', 'Okay', 'Good', 'Great'];
const RPE_WORDS = ['Very easy', 'Easy', 'Easy', 'Steady', 'Moderate', 'Moderate', 'Hard', 'Very hard', 'Very hard', 'Max'];
const RPE_FILL = ['bg-z1', 'bg-z2', 'bg-z2', 'bg-z3', 'bg-z3', 'bg-z4', 'bg-z5', 'bg-z5', 'bg-z6', 'bg-z7'];

/** RPE 1–10 as ten large segments (product.md §8.9): thumb-reachable, two taps to done. */
export function RpeSegments({ value, onChange }: { value: number | null | undefined; onChange: (v: number) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-label text-fg-2">How hard was it?</span>
        <span className="flex items-baseline gap-1.5">
          <span className="text-stat-sm text-fg-1">{value ?? '—'}</span>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={value ?? 0} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: tween('fast', 'in') }} className="text-body-sm text-fg-3">
              {value ? RPE_WORDS[value - 1] : 'RPE'}
            </motion.span>
          </AnimatePresence>
        </span>
      </div>
      <div
        role="radiogroup"
        aria-label="Rate of perceived exertion"
        className="grid grid-cols-10 gap-1"
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onChange(Math.min(10, (value ?? 0) + 1));
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onChange(Math.max(1, (value ?? 2) - 1));
          else return;
          e.preventDefault();
        }}
      >
        {Array.from({ length: 10 }, (_, i) => {
          const n = i + 1;
          const on = value != null && n <= value;
          const sel = value === n;
          return (
            <motion.button
              key={n}
              type="button"
              role="radio"
              aria-checked={sel}
              tabIndex={sel || (value == null && n === 1) ? 0 : -1}
              aria-label={`${n}, ${RPE_WORDS[i]}`}
              onClick={() => onChange(n)}
              whileTap={{ scale: 0.92 }}
              transition={spring.snappy}
              className={cn(
                'relative flex h-12 flex-col items-center justify-end overflow-hidden rounded-sm border pb-1.5 outline-none pointer-coarse:h-14',
                'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus transition-colors duration-(--dur-fast)',
                sel ? 'border-fg-2' : 'border-line-2 hover:border-line-3',
              )}
            >
              <motion.span
                aria-hidden
                className={cn('absolute inset-x-0 bottom-0 origin-bottom', RPE_FILL[i])}
                style={{ height: `${28 + i * 8}%` }}
                initial={false}
                animate={{ scaleY: on ? 1 : 0, opacity: on ? 1 : 0 }}
                transition={{ ...spring.snappy, delay: on ? i * 0.012 : 0 }}
              />
              <span className={cn('relative font-mono text-mono-sm', sel ? 'font-[600] text-fg-1' : on ? 'text-fg-1' : 'text-fg-3')}>{n}</span>
            </motion.button>
          );
        })}
      </div>
      <div className="grid grid-cols-10 text-micro uppercase text-fg-3" aria-hidden>
        <span className="col-span-3">Very easy</span>
        <span className="col-span-3 text-center">Steady</span>
        <span className="col-span-3 text-center">Hard</span>
        <span className="text-right">Max</span>
      </div>
    </div>
  );
}

/**
 * "Log how it went": RPE segments, feel dots and a note, each saved as you go (optimistic PATCH)
 * with a "Saved" tick. Collapses to a one-line summary once RPE and feel are in.
 */
export function ActivityLogger({ activity, compact, className }: { activity: Activity; compact?: boolean; className?: string }) {
  const patch = usePatchActivity();
  const [rpe, setRpe] = useState<number | null>(activity.rpe ?? null);
  const [feel, setFeel] = useState<number | null>(activity.feel ?? null);
  const [note, setNote] = useState(activity.postNote ?? '');
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [open, setOpen] = useState(true);
  const relax = useRef<ReturnType<typeof setTimeout>>(undefined);
  const save = (p: Parameters<typeof patch.mutateAsync>[0]['patch']) => {
    setStatus('saving');
    clearTimeout(relax.current);
    return patch
      .mutateAsync({ id: activity.id, patch: p })
      .then(() => {
        setStatus('saved');
        relax.current = setTimeout(() => setStatus('idle'), 2400);
      })
      .catch(() => {
        setStatus('error');
        toast.error("Couldn't save. Your rating is kept here — try again.");
      });
  };
  const noteStatus = useChangeAutosave(note, (v) => patch.mutateAsync({ id: activity.id, patch: { postNote: v.trim() ? v : null } }), 700);
  useEffect(() => () => clearTimeout(relax.current), []);
  const done = rpe != null && feel != null;
  useEffect(() => {
    if (done) {
      const t = setTimeout(() => setOpen(false), 1400);
      return () => clearTimeout(t);
    }
  }, [done]);
  const shown = noteStatus !== 'idle' ? noteStatus : status;

  return (
    <motion.div layout transition={spring.smooth} className={cn('flex flex-col gap-4', className)}>
      <AnimatePresence initial={false} mode="popLayout">
        {open ? (
          <motion.div key="form" layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: tween('fast', 'in') }} className="flex flex-col gap-5">
            <RpeSegments
              value={rpe}
              onChange={(v) => {
                setRpe(v);
                void save({ rpe: v });
              }}
            />
            <div className={cn('flex gap-6', compact ? 'flex-col' : 'flex-wrap items-start justify-between')}>
              <div className="flex flex-col gap-1.5">
                <span className="text-label text-fg-2">How did it feel?</span>
                <DotScale
                  label="Session feel"
                  labels={ACTIVITY_FEEL}
                  value={feel}
                  size="lg"
                  onChange={(v) => {
                    setFeel(v);
                    void save({ feel: v });
                  }}
                />
              </div>
              <label className="flex min-w-0 flex-1 basis-64 flex-col gap-1.5">
                <span className="text-label text-fg-2">Note</span>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} minRows={2} maxRows={8} placeholder="Legs, fuelling, anything worth remembering…" />
              </label>
            </div>
          </motion.div>
        ) : (
          <motion.button
            key="sum"
            layout
            type="button"
            onClick={() => setOpen(true)}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: tween('fast', 'in') }}
            className="flex items-center gap-3 rounded-md text-left text-body text-fg-2 outline-none hover:text-fg-1 focus-visible:outline-2 focus-visible:outline-focus"
          >
            <motion.span
              initial={{ scale: 0.4 }}
              animate={{ scale: 1 }}
              transition={spring.bouncy}
              className="grid size-6 place-items-center rounded-full bg-accent text-on-accent"
            >
              <Check className="size-3.5" strokeWidth={2.5} />
            </motion.span>
            <span>
              Logged · RPE <b className="font-[560] text-fg-1">{rpe}</b> · {ACTIVITY_FEEL[(feel ?? 3) - 1]}
              {note.trim() && <span className="text-fg-3"> · “{note.trim().slice(0, 48)}{note.trim().length > 48 ? '…' : ''}”</span>}
            </span>
            <span className="text-label text-fg-3 underline decoration-line-3 underline-offset-4">Edit</span>
          </motion.button>
        )}
      </AnimatePresence>
      <div className="flex h-5 justify-end">
        <SaveIndicator status={shown} />
      </div>
    </motion.div>
  );
}

/** Autosaving day note editor (plain text, markdown-ish). Mount once the note is loaded. */
export function DayNoteEditor({ date, initial, minRows = 3, placeholder = 'How did today go? Sleep, legs, life…' }: { date: LocalDate; initial: string; minRows?: number; placeholder?: string }) {
  const [body, setBody] = useState(initial);
  const m = useSaveDayNote();
  const status = useChangeAutosave(body, (v) => m.mutateAsync({ date, body: v }), 800);
  return (
    <div className="flex flex-col gap-2">
      <Textarea aria-label="Day note" value={body} onChange={(e) => setBody(e.target.value)} minRows={minRows} maxRows={18} placeholder={placeholder} />
      <div className="flex h-5 items-center justify-between">
        <span className="text-body-sm text-fg-3">Autosaves · shows in the journal</span>
        <SaveIndicator status={status} />
      </div>
    </div>
  );
}

/** Quick-add field: "run 45m easy", "bike 4x8m 95-100% @key". */
export function QuickAdd({ date, className, autoFocus }: { date: LocalDate; className?: string; autoFocus?: boolean }) {
  const [text, setText] = useState('');
  const m = useQuickAdd();
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    m.mutate(
      { date, text: t },
      {
        onSuccess: (res) => {
          setText('');
          toast.success(
            <>
              Added <b>{(res.workout as PlannedWorkout).title}</b>
            </>,
          );
        },
        onError: (e) => toast.error("Couldn't add that", { description: e instanceof Error ? e.message : undefined }),
      },
    );
  };
  return (
    <form
      className={cn('flex gap-2', className)}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Input
        aria-label="Quick add a workout"
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => setText(e.target.value)}
        placeholder="Quick add · run 45m easy"
        leading={<Plus />}
        trailing={text ? <CornerDownLeft className="size-3.5" /> : undefined}
      />
      <Button type="submit" variant="secondary" loading={m.isPending} disabled={!text.trim()}>
        Add
      </Button>
    </form>
  );
}

/** Garmin push state + "Send to watch" action for a planned workout. */
export function SendToWatch({ workout, size = 'sm' }: { workout: PlannedWorkout; size?: 'sm' | 'md' }) {
  const qc = useQueryClient();
  const [state, setState] = useState(workout.garmin.syncState);
  useEffect(() => setState(workout.garmin.syncState), [workout.garmin.syncState]);
  const push = useMutation({
    mutationFn: () => call(api.garmin.push[':workoutId'].$post({ param: { workoutId: workout.id } })),
    onMutate: () => setState('pending'),
    onSuccess: () => {
      setState('synced');
      toast.success(
        <>
          <b>{workout.title}</b> is on your watch
        </>,
      );
    },
    onError: (e) => {
      setState('error');
      toast.error("Couldn't send", { description: e instanceof Error ? e.message : undefined });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.today });
      void qc.invalidateQueries({ queryKey: qk.calendar.all });
    },
  });
  if (state === 'synced')
    return (
      <span className="inline-flex items-center gap-2 text-label text-fg-2">
        <span className="inline-flex items-center gap-1.5">
          <Watch className="size-3.5 text-fg-3" aria-hidden />
          On your watch
          <Check className="size-3.5 text-accent-ink" strokeWidth={2.5} aria-hidden />
        </span>
        <button type="button" onClick={() => push.mutate()} className="rounded-xs text-fg-3 underline decoration-line-3 underline-offset-4 outline-none hover:text-fg-1 focus-visible:outline-2 focus-visible:outline-focus">
          Resend
        </button>
      </span>
    );
  return (
    <Button
      size={size}
      variant={state === 'error' ? 'danger' : 'secondary'}
      icon={state === 'pending' ? <RefreshCw className="animate-spin" /> : state === 'error' ? <TriangleAlert /> : <Watch />}
      onClick={() => push.mutate()}
      disabled={state === 'pending'}
    >
      {state === 'pending' ? 'Sending…' : state === 'error' ? "Couldn't send · Retry" : 'Send to watch'}
    </Button>
  );
}

/** "Sync now" with the last-sync time; spins while running. */
export function SyncNowButton({ compact }: { compact?: boolean }) {
  const sync = useSyncNow();
  const { data } = useGarminStatus();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const ago = data?.lastSyncAt ? relTime(now - Date.parse(data.lastSyncAt)) : null;
  const label = sync.isPending ? 'Syncing…' : data && !data.connected ? 'Garmin off' : ago ? `Synced ${ago}` : 'Sync now';
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={`Sync now. ${label}`}
      icon={<RefreshCw className={cn(sync.isPending && 'animate-spin')} />}
      onClick={() =>
        sync.mutate(undefined, {
          onSuccess: () => toast.success('Synced with Garmin'),
          onError: (e) => toast.error("Couldn't sync", { description: e instanceof Error ? e.message : undefined }),
        })
      }
      disabled={sync.isPending}
    >
      {!compact && <span className="font-mono text-mono-sm">{label}</span>}
    </Button>
  );
}

function relTime(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m}${NBSP}min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}${NBSP}h ago`;
  return `${Math.round(h / 24)}${NBSP}d ago`;
}

/** Link to the day page (typed). */
export function DayLink({ date, children, className }: { date: LocalDate; children: ReactNode; className?: string }) {
  return (
    <Link {...links.calendarDay(date)} className={className}>
      {children}
    </Link>
  );
}

// ───────────────────────── session card (large) ─────────────────────────

const SPORT_LABEL: Record<string, string> = { bike: 'Ride', run: 'Run', swim: 'Swim', row: 'Row', strength: 'Strength', hike: 'Hike', walk: 'Walk', yoga: 'Yoga', ski: 'Ski', other: 'Other' };

/**
 * Large session card for the Today / Day / Agenda pages. Planned → workout page, completed or
 * paired → activity page; both morph (wk-card / wk-glyph / wk-title). Paired shows plan vs actual.
 */
export function SessionCard({ card, morphId, showSend = true, showLog = false, className }: { card: CalendarCard; morphId?: string; showSend?: boolean; showLog?: boolean; className?: string }) {
  const { workout: w, activity: a, model: m } = card;
  const mid = morphId ?? m.id;
  const on = useIsMorphTarget(mid);
  const state = m.compliance?.state ?? (a ? 'unplanned' : 'planned');
  const s = complianceStyles(state);
  const link = a ? links.activity(a.id) : links.workout(w!.id);
  const rail = s.rail ?? (m.isKey ? 'bg-accent' : null);
  const time = a ? formatInstantTime(a.startedAt, a.utcOffsetMin) : w?.startTime ? formatClockTime(w.startTime) : null;
  return (
    <div
      className={cn('spotlight group/sc relative flex min-w-0 flex-col overflow-hidden rounded-lg', s.card, s.dim && 'opacity-60', className)}
      style={vt(on, 'card')}
      onPointerMove={onSpotlightMove}
    >
      {rail && <span aria-hidden className={cn('absolute inset-y-3 left-0 w-[3px] rounded-r-full', rail)} />}
      <Link
        {...link}
        {...morphSourceProps(mid)}
        className="flex flex-col gap-4 rounded-lg p-4 pl-5 outline-none transition-colors duration-(--dur-fast) hover:bg-surface-3/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus md:p-5 md:pl-6"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-md border border-line-2 bg-surface-1 text-fg-1" style={vt(on, 'glyph')}>
            <SportGlyph sport={m.sport} subSport={m.subSport ?? undefined} size={20} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center gap-2 text-micro uppercase text-fg-3">
              <span>{SPORT_LABEL[m.sport]}</span>
              {time && <span className="font-mono normal-case tracking-normal">{time}</span>}
              <span className="flex items-center gap-1">
                <ComplianceGlyph state={state} />
                {complianceLabel(state, w?.skipReason)}
              </span>
            </div>
            <h3 className={cn('text-title-3 text-fg-1', s.title)} style={vt(on, 'title')}>
              {m.title}
            </h3>
          </div>
          <span className="flex shrink-0 items-center gap-2 pt-1">
            {m.intensity && <IntensityPips intensity={m.intensity} size="md" />}
            {m.isKey && <KeyStar pressed readOnly />}
          </span>
        </div>

        {a ? (
          <div className="flex flex-col gap-3">
            <ActivityStats a={a} />
            {w && a.compliance?.ratio != null && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between text-body-sm text-fg-3">
                  <span>
                    vs plan · {formatDuration(w.plannedDurationSec, 'clock')}
                    {w.plannedLoad ? ` · ${formatLoad(w.plannedLoad)} load` : ''}
                  </span>
                </div>
                <ComplianceBar ratio={a.compliance.ratio} state={state} showLabel />
              </div>
            )}
            {a.sparkline && a.sparkline.length > 1 && <MiniProfile values={a.sparkline} height={28} tone="fg" />}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <SessionStats durationSec={w?.plannedDurationSec} distanceM={w?.plannedDistanceM} load={w?.plannedLoad} sport={m.sport} />
            <WorkoutProfile workout={w} height={44} />
            {w?.preNote && <p className="border-l-2 border-line-3 pl-3 text-body text-fg-2">{w.preNote}</p>}
          </div>
        )}
      </Link>
      {(a ? (a.rpe != null || a.feel != null || a.postNote) && !showLog : false) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line-1 px-5 py-3 text-body-sm text-fg-2 md:px-6">
          {a!.rpe != null && (
            <span>
              RPE <b className="font-[560] text-fg-1">{a!.rpe}</b>
            </span>
          )}
          {a!.feel != null && <span>Felt {ACTIVITY_FEEL[a!.feel - 1]!.toLowerCase()}</span>}
          {a!.postNote && <span className="min-w-0 flex-1 truncate text-fg-3">“{a!.postNote}”</span>}
        </div>
      )}
      {a && showLog && (
        <div className="border-t border-line-1 px-4 pt-4 pb-2 md:px-6">
          <ActivityLogger activity={a} />
        </div>
      )}
      {!a && w && showSend && w.status !== 'skipped' && (
        <div className="flex items-center justify-between gap-3 border-t border-line-1 px-4 py-2.5 md:px-6">
          <SendToWatch workout={w} />
          {w.environment !== 'any' && <span className="text-micro uppercase text-fg-3">{w.environment}</span>}
        </div>
      )}
    </div>
  );
}

function ActivityStats({ a }: { a: Activity }) {
  const units = useUnits();
  const dist = a.distanceM ? distanceParts(a.distanceM, a.sport, units) : null;
  const pace = a.avgSpeedMps && (a.sport === 'run' || a.sport === 'swim' || a.sport === 'row' || a.sport === 'walk' || a.sport === 'hike') ? paceParts(a.avgSpeedMps, a.sport, units) : null;
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2">
      <Stat label="Time" value={formatDuration(a.movingSec || a.durationSec, 'clock')} />
      {dist && <Stat label="Distance" value={dist.value} unit={dist.unit} />}
      <Stat label="Load" value={<span className="text-accent-ink">{formatLoad(a.load)}</span>} />
      {a.weightedPower ? <Stat label="W. power" value={Math.round(a.weightedPower)} unit="W" /> : pace ? <Stat label="Pace" value={pace.value} unit={pace.unit} /> : null}
      {a.avgHr ? <Stat label="Avg HR" value={Math.round(a.avgHr)} unit="bpm" /> : null}
    </div>
  );
}

export function SessionCardSkeleton() {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-line-2 p-5" aria-hidden>
      <div className="flex gap-3">
        <Skeleton className="size-10 rounded-md" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-5 w-56" />
        </div>
      </div>
      <div className="flex gap-6">
        <Skeleton className="h-9 w-16" />
        <Skeleton className="h-9 w-16" />
        <Skeleton className="h-9 w-12" />
      </div>
      <Skeleton className="h-11 w-full" />
    </div>
  );
}

// ───────────────────────── HRV mini chart ─────────────────────────

export interface HrvPoint {
  date: LocalDate;
  hrv: number | null;
  mean: number | null;
  lo: number | null;
  hi: number | null;
}

/** HRV dots + 7-day mean over the personal baseline band (normal range). Today's dot in accent. */
export function HrvMini({ points, height = 44, className }: { points: HrvPoint[]; height?: number; className?: string }) {
  const [ref, size] = useChartSize<HTMLDivElement>();
  const w = size.width;
  const vals = points.flatMap((p) => [p.hrv, p.lo, p.hi].filter((v): v is number => v != null));
  const lo = Math.min(...vals) - 2;
  const hi = Math.max(...vals) + 2;
  const x = (i: number) => 3 + (i / Math.max(1, points.length - 1)) * (w - 6);
  const y = (v: number) => 3 + (1 - (v - lo) / (hi - lo || 1)) * (height - 6);
  let band = '';
  const top: string[] = [];
  const bot: string[] = [];
  points.forEach((p, i) => {
    if (p.lo != null && p.hi != null) {
      top.push(`${x(i).toFixed(1)},${y(p.hi).toFixed(1)}`);
      bot.unshift(`${x(i).toFixed(1)},${y(p.lo).toFixed(1)}`);
    }
  });
  if (top.length > 1) band = `M${top.join('L')}L${bot.join('L')}Z`;
  const meanPts = points.map((p, i) => (p.mean != null ? `${x(i).toFixed(1)},${y(p.mean).toFixed(1)}` : null));
  const mean = meanPts.filter(Boolean).length > 1 ? `M${meanPts.filter(Boolean).join('L')}` : '';
  const last = points.length - 1;
  return (
    <div ref={ref} className={cn('w-full', className)} style={{ height }} role="img" aria-label={`HRV over the last ${points.length} days against the normal range`}>
      {w > 0 && vals.length > 0 && (
        <svg width={w} height={height} className="block overflow-visible" aria-hidden>
          {band && <path d={band} style={{ fill: T.fg1, opacity: 0.08 }} />}
          {mean && <motion.path d={mean} fill="none" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={spring.gentle} style={{ stroke: T.fg2, strokeWidth: 1.25 }} strokeLinecap="round" />}
          {points.map((p, i) =>
            p.hrv == null ? null : (
              <circle key={p.date} cx={x(i)} cy={y(p.hrv)} r={i === last ? 3 : 1.6} style={{ fill: i === last ? T.accent : T.fg3, stroke: i === last ? T.bg : 'none', strokeWidth: 1.5 }} />
            ),
          )}
        </svg>
      )}
    </div>
  );
}
