/**
 * /workouts/$id (view + edit in place) and /workouts/$id/edit (same page, builder open + focused).
 * The header is the morph target of the calendar card (wk-card / wk-glyph / wk-title).
 */
import { SKIP_REASONS, type PlannedWorkout, type WorkoutStructure, type LocalDate } from '@cadence/core';
import { addDays } from '@cadence/core/time';
import { estimateWorkout, garminSupport } from '@cadence/core/workout';
import { useNavigate, Link } from '@tanstack/react-router';
import { ArrowUpRight, CalendarDays, Check, Copy, Library, Pencil, Repeat, RotateCcw, SkipForward, Trash2, TriangleAlert, Unlink, Watch } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { IntensityProfile } from '@/charts';
import {
  Button,
  ButtonLink,
  Card,
  ComplianceGlyph,
  complianceLabel,
  EmptyState,
  IconButton,
  InlineEdit,
  IntensityPicker,
  IntensityPips,
  KeyStar,
  Meter,
  MonthGrid,
  Page,
  PageHeader,
  Popover,
  SaveIndicator,
  Section,
  Segmented,
  Skeleton,
  SportGlyph,
  TagInput,
  Textarea,
  toast,
  usePaletteSource,
  GarminStateIcon,
} from '@/ui';
import { cn } from '@/lib/cn';
import { formatDateLong, formatDayShort, formatDuration, formatRelativeDay, formatClockTime, formatDistance, formatInstantTime } from '@/lib/format';
import { useToday } from '@/lib/hooks';
import { useGarminStatus } from '@/lib/queries/shared';
import { useDeleteWorkouts, useDuplicateWorkout, usePatchWorkout, useRestoreWorkouts, type WorkoutPatch } from '@/lib/queries/training';
import { useUnits } from '@/lib/units';
import { links } from '@/shell/links';
import { useShortcut } from '@/shell/shortcuts';
import { spring } from '@/motion/tokens';
import { Builder, GarminLine } from './builder/Builder';
import { axisLabelFor, chartBlocks, useDebouncedSave, useThresholdsOn } from './model';
import { StepsReadable, TotalsTiles } from './parts';
import { useActivitiesBetween, useActivity, useGarminPush, useGarminRemove, usePair, useRepeatWeekly, useSaveToLibrary, useSkip, useWorkout, type SkipReason } from './queries';

let skipToast: string | null = null;
const SKIP_LABEL: Record<SkipReason, string> = { sick: 'Sick', injury: 'Injury', travel: 'Travel', fatigue: 'Fatigue', life: 'Life', weather: 'Weather', other: 'Other' };

export function WorkoutDetail({ id, edit }: { id: string; edit: boolean }) {
  const q = useWorkout(id);
  if (q.isPending) return <WorkoutSkeleton />;
  if (q.isError || !q.data)
    return (
      <Page header={<PageHeader title="Workout" back={links.calendar()} />}>
        <EmptyState icon={<TriangleAlert />} title={q.error && 'status' in q.error && (q.error as { status: number }).status === 404 ? 'This workout no longer exists' : 'Couldn’t load this workout'} action={<Button onClick={() => q.refetch()}>Try again</Button>}>
          {q.error?.message}
        </EmptyState>
      </Page>
    );
  return <WorkoutView w={q.data} edit={edit} />;
}

function WorkoutSkeleton() {
  return (
    <Page header={<PageHeader title={<Skeleton className="h-9 w-80" />} titleText="Workout" eyebrow={<Skeleton className="h-3 w-40" />} back={links.calendar()} morph glyph={<Skeleton className="size-6" />} />}>
      <Skeleton className="h-[214px] w-full" radius="lg" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[92px]" radius="lg" />
        ))}
      </div>
    </Page>
  );
}

function WorkoutView({ w, edit }: { w: PlannedWorkout; edit: boolean }) {
  const navigate = useNavigate();
  const units = useUnits();
  const { thresholds, today: apiToday } = useThresholdsOn(w.sport, w.date);
  const localToday = useToday();
  const today = apiToday ?? localToday;
  const patchM = usePatchWorkout();
  const [scope, setScope] = useState<'this' | 'following'>('this');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [hovered, setHovered] = useState<string | null>(null);

  const patch = async (p: WorkoutPatch, s: 'this' | 'following' = 'this') => {
    setStatus('saving');
    try {
      await patchM.mutateAsync({ id: w.id, patch: p, scope: s });
      setStatus('saved');
      setTimeout(() => setStatus((x) => (x === 'saved' ? 'idle' : x)), 2400);
    } catch (e) {
      setStatus('error');
      toast.error(`Couldn’t save: ${(e as Error).message}`);
      throw e;
    }
  };

  // ── structure draft (edit mode autosaves) ──
  const [draft, setDraft] = useState<WorkoutStructure>(() => w.structure ?? { steps: [] });
  const lastServer = useRef(w.structure);
  useEffect(() => {
    if (!edit && w.structure !== lastServer.current) setDraft(w.structure ?? { steps: [] });
    lastServer.current = w.structure;
  }, [w.structure, edit]);
  const initialDraft = useMemo(() => draft, []); // eslint-disable-line react-hooks/exhaustive-deps
  useDebouncedSave(draft, edit ? initialDraft : draft, (s) => patch({ structure: s.steps.length ? s : (null as never) }, scope).catch(() => undefined));
  const shownStatus = status;

  const structure = edit ? draft : (w.structure ?? { steps: [] });
  const estimate = useMemo(() => estimateWorkout(structure, w.sport, thresholds), [structure, w.sport, thresholds]);
  const { blocks, repeats } = useMemo(() => chartBlocks(estimate, structure), [estimate, structure]);
  const structured = structure.steps.length > 0;
  const totals = structured
    ? { durationSec: estimate.durationSec, distanceM: estimate.distanceM, load: estimate.load, intensityFactor: estimate.intensityFactor }
    : { durationSec: w.plannedDurationSec, distanceM: w.plannedDistanceM, load: w.plannedLoad, intensityFactor: w.plannedIntensityFactor };

  const past = w.date < today;
  const compliance = w.compliance?.state;
  const goEdit = () => navigate({ ...links.workoutEdit(w.id), replace: true });
  const doneEdit = () => navigate({ ...links.workout(w.id), replace: true });

  useShortcut('e', () => (edit ? undefined : goEdit()), { enabled: !edit });
  useShortcut('mod+enter', () => edit && doneEdit(), { enabled: edit, allowInInputs: true });

  // ── delete ──
  const del = useDeleteWorkouts();
  const restore = useRestoreWorkouts();
  const onDelete = async () => {
    const deleted = await del.mutateAsync([w.id]).catch((e) => {
      toast.error(`Couldn’t delete: ${(e as Error).message}`);
      return null;
    });
    if (!deleted) return;
    toast.undo(
      <>
        Deleted <b>{w.title}</b>
      </>,
      () => restore.mutate(deleted, { onSuccess: () => toast.success('Restored') }),
    );
    navigate(links.calendar(w.date));
  };

  usePaletteSource(
    {
      id: 'workout.page',
      commands: [
        { id: 'wk.edit', group: 'Workout', title: 'Edit structure', perform: goEdit },
        { id: 'wk.key', group: 'Workout', title: w.isKey ? 'Unmark key session' : 'Mark as key session', perform: () => void patch({ isKey: !w.isKey }) },
        { id: 'wk.delete', group: 'Workout', title: 'Delete workout', perform: () => void onDelete() },
      ],
    },
    [w.id, w.isKey],
  );

  const header = (
    <PageHeader
      morph
      back={links.calendar(w.date)}
      breadcrumb={[{ label: 'Calendar', link: links.calendar(w.date) }, { label: formatDayShort(w.date), link: links.calendarDay(w.date) }]}
      glyph={<SportGlyph sport={w.sport} subSport={w.subSport} size={24} />}
      titleText={w.title}
      title={<InlineEdit value={w.title} onSave={(title) => patch({ title })} variant="title" aria-label="Workout title" className="[&>button]:w-auto max-md:[&_*]:text-title-2" />}
      eyebrow={
        <span className="flex items-center gap-2">
          <span>{formatDateLong(w.date, true)}</span>
          <span className="text-fg-4">·</span>
          <span>{formatRelativeDay(w.date, today)}</span>
          {w.startTime && (
            <>
              <span className="text-fg-4">·</span>
              <span>{formatClockTime(w.startTime)}</span>
            </>
          )}
        </span>
      }
      meta={
        <>
          <KeyStar pressed={w.isKey} onPressedChange={(isKey) => void patch({ isKey })} />
          <Popover
            title="Intensity"
            trigger={
              <button type="button" className="inline-flex h-7 items-center gap-2 rounded-sm border border-line-1 px-2 text-label text-fg-2 transition-colors hover:border-line-3 hover:text-fg-1" aria-label="Intensity">
                <IntensityPips intensity={w.intensity} size="md" />
                <span className="capitalize">{w.intensity}</span>
              </button>
            }
          >
            <IntensityPicker value={w.intensity} onValueChange={(intensity) => void patch({ intensity })} />
          </Popover>
          <MoveDate w={w} today={today} onMove={(date) => patch({ date })} />
          {past && compliance && compliance !== 'planned' && (
            <span className="inline-flex h-7 items-center gap-1.5 rounded-sm px-2 text-label text-fg-2">
              <ComplianceGlyph state={compliance} />
              {complianceLabel(compliance, w.skipReason)}
            </span>
          )}
          {w.garmin.syncState !== 'none' && <GarminStateIcon state={w.garmin.syncState} error={w.garmin.error} />}
          {w.seriesId && (
            <span className="inline-flex h-7 items-center gap-1 text-label text-fg-3">
              <Repeat className="size-3.5" /> Weekly series
            </span>
          )}
        </>
      }
      actions={
        <>
          <SaveIndicator status={shownStatus} className="max-sm:hidden" />
          {edit ? (
            <Button size="sm" variant="secondary" icon={<Check />} onClick={doneEdit} kbd="mod+enter">
              Done
            </Button>
          ) : (
            <Button size="sm" variant="secondary" icon={<Pencil />} onClick={goEdit} kbd="e">
              <span className="max-sm:hidden">Edit structure</span>
            </Button>
          )}
          <IconButton size="sm" label="Delete workout" icon={<Trash2 />} onClick={onDelete} />
        </>
      }
    />
  );

  return (
    <Page header={header}>
      {w.status === 'skipped' && (
        <Section stagger={false}>
          <div className="flex items-center gap-3 rounded-lg border border-dashed border-line-3 px-4 py-3">
            <SkipForward className="size-4 text-fg-2" />
            <span className="flex-1 text-body text-fg-1">Skipped · {SKIP_LABEL[w.skipReason ?? 'other']}</span>
            <UnskipButton id={w.id} />
          </div>
        </Section>
      )}

      {edit ? (
        <Section
          title="Structure"
          actions={
            w.seriesId ? (
              <Segmented
                size="sm"
                aria-label="Apply edits to"
                value={scope}
                onValueChange={setScope}
                options={[
                  { value: 'this', label: 'This only' },
                  { value: 'following', label: 'This and following' },
                ]}
              />
            ) : undefined
          }
        >
          <Builder sport={w.sport} subSport={w.subSport} structure={draft} onChange={setDraft} thresholds={thresholds} estimate={estimate} autoFocus={draft.steps.length ? 'steps' : 'text'} />
        </Section>
      ) : (
        structured &&
        w.sport !== 'strength' && (
          <Section>
            <div className="rounded-xl border border-line-1 bg-surface-1 px-3 pt-3 pb-1" style={{ '--chart-bg': 'var(--color-surface-1)' } as React.CSSProperties}>
              <IntensityProfile blocks={blocks} repeats={repeats} height={160} axisLabel={axisLabelFor(w.sport)} hoveredId={hovered} onHover={(id) => setHovered(id ? id.split('#')[0] : null)} />
            </div>
          </Section>
        )
      )}

      <Section>
        <TotalsTiles totals={totals} sport={w.sport} />
      </Section>

      <Section stagger={false}>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex min-w-0 flex-col gap-8">
            {!edit && (
              <Section title="Steps" variant="micro" actions={<Button size="sm" variant="ghost" icon={<Pencil />} onClick={goEdit}>Edit</Button>}>
                <StepsReadable structure={structure} sport={w.sport} thresholds={thresholds} estimate={estimate} hovered={hovered} onHover={setHovered} />
              </Section>
            )}
            <Notes w={w} patch={patch} />
            <PairPanel w={w} past={past} today={today} />
          </div>
          <div className="flex min-w-0 flex-col gap-6">
            <GarminPanel w={w} structure={structure} />
            <PlanActions w={w} today={today} />
          </div>
        </div>
      </Section>
    </Page>
  );
}

// ───────────────────────── header bits ─────────────────────────

function MoveDate({ w, today, onMove }: { w: PlannedWorkout; today: LocalDate; onMove: (d: LocalDate) => Promise<unknown> }) {
  return (
    <Popover
      title="Move to"
      trigger={
        <button type="button" className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-line-1 px-2 text-label text-fg-2 transition-colors hover:border-line-3 hover:text-fg-1">
          <CalendarDays className="size-3.5" /> Move
        </button>
      }
    >
      {(close) => (
        <MonthGrid
          value={w.date}
          today={today}
          onSelect={(d) => {
            close();
            if (d === w.date) return;
            const from = w.date;
            void onMove(d).then(() => toast.undo(<>Moved to <b>{formatDayShort(d)}</b></>, () => void onMove(from)));
          }}
        />
      )}
    </Popover>
  );
}

function UnskipButton({ id }: { id: string }) {
  const skip = useSkip();
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={<RotateCcw />}
      loading={skip.isPending}
      onClick={() => {
        if (skipToast) toast.dismiss(skipToast);
        skipToast = null;
        skip.mutate({ id, reason: null });
      }}
    >
      Unskip
    </Button>
  );
}

// ───────────────────────── notes ─────────────────────────

function NoteField({ label, value, placeholder, onSave }: { label: string; value?: string; placeholder: string; onSave: (v: string) => Promise<unknown> }) {
  const [v, setV] = useState(value ?? '');
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setV(value ?? '');
  }, [value]);
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-micro text-fg-3">{label}</span>
      <Textarea
        value={v}
        minRows={2}
        placeholder={placeholder}
        onFocus={() => (focused.current = true)}
        onChange={(e) => setV(e.currentTarget.value)}
        onBlur={() => {
          focused.current = false;
          if (v.trim() !== (value ?? '').trim()) void onSave(v.trim());
        }}
        className="bg-surface-1"
      />
    </label>
  );
}

function Notes({ w, patch }: { w: PlannedWorkout; patch: (p: WorkoutPatch) => Promise<unknown> }) {
  return (
    <Section title="Notes" variant="micro">
      <div className="flex flex-col gap-4">
        <NoteField label="Pre-workout note" value={w.preNote} placeholder="Intent for the day — “legs heavy, keep it honest”" onSave={(v) => patch({ preNote: v || (null as never) })} />
        <NoteField label="Description & coaching cues" value={w.description} placeholder="Purpose, cues, fuelling…" onSave={(v) => patch({ description: v || (null as never) })} />
        <div className="flex flex-col gap-1.5">
          <span className="text-micro text-fg-3">Tags</span>
          <TagInput value={w.tags} onValueChange={(tags) => void patch({ tags })} aria-label="Tags" />
        </div>
      </div>
    </Section>
  );
}

// ───────────────────────── garmin ─────────────────────────

export function GarminPanel({ w, structure }: { w: PlannedWorkout; structure: WorkoutStructure }) {
  const status = useGarminStatus();
  const push = useGarminPush();
  const remove = useGarminRemove();
  const g = w.garmin;
  const support = garminSupport(w.sport, structure, { subSport: w.subSport });
  const connected = status.data?.connected;
  const send = () =>
    toast.promise(push.mutateAsync(w.id), {
      loading: 'Sending to Garmin…',
      success: () => <>On your Garmin · <b>{w.title}</b></>,
      error: (e) => `Garmin push failed: ${(e as Error).message}`,
    }).catch(() => undefined);
  const unsend = () => toast.promise(remove.mutateAsync(w.id), { loading: 'Removing from Garmin…', success: 'Removed from Garmin', error: (e) => `Couldn’t remove: ${(e as Error).message}` }).catch(() => undefined);
  const busy = push.isPending || remove.isPending;
  const line =
    g.syncState === 'synced'
      ? `On your Garmin${g.lastPushedAt ? ` since ${formatInstantTime(g.lastPushedAt)}` : ''}`
      : g.syncState === 'pending'
        ? 'Changes waiting to send'
        : g.syncState === 'error'
          ? 'Last push failed'
          : 'Not on your Garmin yet';
  return (
    <Card padding="md" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Watch className="size-4 text-fg-2" />
        <span className="text-micro text-fg-3">Garmin</span>
        <span className="ml-auto">
          <GarminStateIcon state={g.syncState === 'none' ? null : g.syncState} error={g.error} />
        </span>
      </div>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div key={g.syncState + (busy ? 'b' : '')} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring.snappy} className="text-body text-fg-1">
          {busy ? (push.isPending ? 'Sending…' : 'Removing…') : line}
          {g.syncState === 'synced' && g.lastPushedAt && <span className="block text-body-sm text-fg-3">{formatDateLong(g.lastPushedAt.slice(0, 10))}</span>}
          {g.syncState === 'error' && g.error && <span className="mt-1 block text-body-sm text-fg-2">{g.error}</span>}
        </motion.div>
      </AnimatePresence>
      {status.data && !connected ? (
        <p className="text-body-sm text-fg-2">
          Garmin isn’t connected.{' '}
          <Link {...links.settingsGarmin()} className="text-fg-1 underline underline-offset-3">
            Connect in Settings
          </Link>
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={g.syncState === 'synced' ? 'secondary' : 'primary'} loading={push.isPending} disabled={busy || !support.pushable || w.status === 'skipped'} onClick={send}>
            {g.syncState === 'synced' ? 'Resend' : g.syncState === 'pending' ? 'Send changes' : 'Send to Garmin'}
          </Button>
          {g.syncState !== 'none' && (
            <Button size="sm" variant="ghost" loading={remove.isPending} disabled={busy} onClick={unsend}>
              Remove
            </Button>
          )}
        </div>
      )}
      <GarminLine sport={w.sport} subSport={w.subSport} structure={structure} />
    </Card>
  );
}

// ───────────────────────── plan actions ─────────────────────────

function PlanActions({ w, today }: { w: PlannedWorkout; today: LocalDate }) {
  const dup = useDuplicateWorkout();
  const repeat = useRepeatWeekly();
  const skip = useSkip();
  const lib = useSaveToLibrary();
  const navigate = useNavigate();
  const [open, setOpen] = useState<null | 'repeat' | 'skip'>(null);
  const [weeks, setWeeks] = useState(6);
  return (
    <Card padding="md" className="flex flex-col gap-1">
      <span className="mb-1 text-micro text-fg-3">Plan</span>
      <Popover
        title="Duplicate to"
        trigger={<ActionRow icon={<Copy />} label="Duplicate to…" />}
      >
        {(close) => (
          <MonthGrid
            value={addDays(w.date, 1)}
            today={today}
            onSelect={(date) => {
              close();
              void dup.mutateAsync({ id: w.id, date }).then(
                (copy) =>
                  toast.success(
                    <>
                      Copied to <b>{formatDayShort(date)}</b>
                    </>,
                    { action: { label: 'Open', onClick: () => navigate(links.workout(copy.id)) } } ,
                  ),
                (e) => toast.error(`Couldn’t duplicate: ${(e as Error).message}`),
              );
            }}
          />
        )}
      </Popover>
      <ActionRow icon={<Repeat />} label="Repeat weekly" onClick={() => setOpen(open === 'repeat' ? null : 'repeat')} expanded={open === 'repeat'} />
      <Expand open={open === 'repeat'}>
        <div className="flex items-center gap-2 py-2 pl-7">
          <span className="text-body-sm text-fg-2">For</span>
          <div className="flex items-center rounded-sm border border-line-2 bg-surface-2">
            <button type="button" aria-label="Fewer weeks" className="size-7 text-fg-3 hover:text-fg-1" onClick={() => setWeeks((x) => Math.max(2, x - 1))}>
              −
            </button>
            <span className="w-6 text-center text-mono text-fg-1">{weeks}</span>
            <button type="button" aria-label="More weeks" className="size-7 text-fg-3 hover:text-fg-1" onClick={() => setWeeks((x) => Math.min(52, x + 1))}>
              +
            </button>
          </div>
          <span className="text-body-sm text-fg-2">weeks</span>
          <Button
            size="sm"
            className="ml-auto"
            loading={repeat.isPending}
            onClick={() =>
              repeat.mutateAsync({ id: w.id, weeks }).then(
                (r) => {
                  setOpen(null);
                  toast.success(<>Weekly series · <b>{r.workouts.length}</b> sessions until {formatDayShort(r.workouts[r.workouts.length - 1]?.date ?? w.date)}</>);
                },
                (e) => toast.error(`Couldn’t repeat: ${(e as Error).message}`),
              )
            }
          >
            Create
          </Button>
        </div>
      </Expand>
      {w.status !== 'skipped' && (
        <>
          <ActionRow icon={<SkipForward />} label="Skip with reason" onClick={() => setOpen(open === 'skip' ? null : 'skip')} expanded={open === 'skip'} />
          <Expand open={open === 'skip'}>
            <div className="flex flex-wrap gap-1.5 py-2 pl-7">
              {SKIP_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() =>
                    skip.mutate(
                      { id: w.id, reason: r },
                      {
                        onSuccess: () => {
                          setOpen(null);
                          skipToast = toast.undo(<>Skipped · {SKIP_LABEL[r]}</>, () => skip.mutate({ id: w.id, reason: null }));
                        },
                      },
                    )
                  }
                  className="h-7 rounded-sm border border-line-2 px-2.5 text-label text-fg-2 transition-colors hover:border-line-3 hover:text-fg-1"
                >
                  {SKIP_LABEL[r]}
                </button>
              ))}
            </div>
          </Expand>
        </>
      )}
      <ActionRow
        icon={<Library />}
        label="Save to library"
        onClick={() =>
          lib.mutateAsync(w.id).then(
            (t) => toast.success(<>Saved <b>{t.title}</b> to the library</>, { action: { label: 'Open', onClick: () => navigate(links.template(t.id)) } }),
            (e) => toast.error(`Couldn’t save: ${(e as Error).message}`),
          )
        }
      />
    </Card>
  );
}

function ActionRow({ icon, label, onClick, expanded, ...rest }: { icon: ReactNode; label: string; onClick?: () => void; expanded?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      {...rest}
      className="flex h-9 w-full items-center gap-2.5 rounded-md px-2 text-left text-body text-fg-1 transition-colors duration-(--dur-fast) hover:bg-surface-2 data-[popup-open]:bg-surface-2 [&_svg]:size-4 [&_svg]:text-fg-3"
    >
      {icon}
      {label}
    </button>
  );
}

function Expand({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={spring.smooth} className="overflow-hidden">
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ───────────────────────── pairing ─────────────────────────

function PairPanel({ w, past, today }: { w: PlannedWorkout; past: boolean; today: LocalDate }) {
  const pair = usePair();
  const act = useActivity(w.pairedActivityId);
  const units = useUnits();
  const near = useActivitiesBetween(addDays(w.date, -1), addDays(w.date, 1) > today ? today : addDays(w.date, 1), past && !w.pairedActivityId && w.status !== 'skipped');
  if (w.pairedActivityId) {
    const a = act.data;
    type Row = { label: string; plan?: number; done?: number; fmt: (n: number) => string };
    const all: Row[] = [
      { label: 'Duration', plan: w.plannedDurationSec, done: a?.movingSec || a?.durationSec, fmt: (n) => formatDuration(n, 'clock') },
      { label: 'Distance', plan: w.plannedDistanceM, done: a?.distanceM, fmt: (n) => formatDistance(n, w.sport, units) },
      { label: 'Load', plan: w.plannedLoad, done: a?.load, fmt: (n) => String(Math.round(n)) },
    ];
    const rows = all.filter((r) => r.plan);
    return (
      <Section
        title="Plan vs actual"
        variant="micro"
        actions={
          <Button size="sm" variant="ghost" icon={<Unlink />} loading={pair.isPending} onClick={() => pair.mutate({ id: w.id, activityId: null }, { onSuccess: () => toast('Unpaired') })}>
            Unpair
          </Button>
        }
      >
        <Card padding="md" className="flex flex-col gap-4">
          {a ? (
            <Link {...links.activity(a.id)} className="group flex items-center gap-2 text-body text-fg-1">
              <SportGlyph sport={a.sport} size={16} className="text-fg-2" />
              <span className="truncate font-[560] group-hover:underline">{a.title}</span>
              <ArrowUpRight className="size-3.5 text-fg-3" />
              {w.compliance && (
                <span className="ml-auto inline-flex items-center gap-1.5 text-label text-fg-2">
                  <ComplianceGlyph state={w.compliance.state} /> {Math.round(w.compliance.ratio * 100)}%
                </span>
              )}
            </Link>
          ) : (
            <Skeleton className="h-5 w-48" />
          )}
          {rows.map((r) => (
            <div key={r.label} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-3">
              <span className="text-micro text-fg-3">{r.label}</span>
              <Meter value={r.done ?? 0} max={Math.max(r.plan! * 1.3, r.done ?? 0)} target={r.plan} aria-label={`${r.label} compliance`} />
              <span className="text-mono text-fg-2">
                {r.done != null ? r.fmt(r.done) : '—'} <span className="text-fg-4">/ {r.fmt(r.plan!)}</span>
              </span>
            </div>
          ))}
        </Card>
      </Section>
    );
  }
  if (!past || w.status === 'skipped') return null;
  const items = near.data ?? [];
  return (
    <Section title="Pair with an activity" variant="micro">
      {near.isPending ? (
        <Skeleton className="h-12 w-full" radius="md" />
      ) : items.length ? (
        <ul className="flex flex-col gap-1">
          {items.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => pair.mutate({ id: w.id, activityId: a.id }, { onSuccess: () => toast.success(<>Paired with <b>{a.title}</b></>), onError: (e) => toast.error((e as Error).message) })}
                className={cn('flex h-11 w-full items-center gap-3 rounded-md border border-line-1 px-3 text-left transition-colors hover:border-line-3 hover:bg-surface-1', a.sport === w.sport && 'border-line-2')}
              >
                <SportGlyph sport={a.sport} size={16} className="text-fg-2" />
                <span className="min-w-0 flex-1 truncate text-body text-fg-1">{a.title}</span>
                <span className="text-mono-sm text-fg-3">{formatDayShort(a.localDate)}</span>
                <span className="text-mono-sm text-fg-3">{formatDuration(a.movingSec || a.durationSec, 'clock')}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body-sm text-fg-3">No activities within a day of this workout.</p>
      )}
    </Section>
  );
}
