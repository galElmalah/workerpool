/**
 * Library feature routes (contract: src/shell/README.md): LibraryPage, TemplatePage, BlockPage.
 * NOTE: the workout builder and its helpers are shared with the workouts feature (same owner);
 * they are imported from `@/features/workouts/*` — move them to a shared folder if ownership splits.
 */
import { INTENSITY_CLASSES, INTENSITY_META, SPORT_META, type IntensityClass, type LocalDate, type Sport, type Template, type WorkoutStructure } from '@cadence/core';
import { addDays } from '@cadence/core/time';
import { estimateWorkout, estimateUnstructured } from '@cadence/core/workout';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { BookCopy, Boxes, CalendarPlus, Copy, MoreHorizontal, Plus, RotateCcw, Search, Trash2, TriangleAlert, X } from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  Button,
  ButtonLink,
  Card,
  ComplianceGlyph,
  EmptyState,
  IconButton,
  InlineEdit,
  Input,
  IntensityPicker,
  IntensityPips,
  Menu,
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
} from '@/ui';
import { cn } from '@/lib/cn';
import { formatDateMedium, formatDayShort } from '@/lib/format';
import { useToday } from '@/lib/hooks';
import { useDeleteWorkouts } from '@/lib/queries/training';
import { links } from '@/shell/links';
import { spring } from '@/motion/tokens';
import { Builder } from '@/features/workouts/builder/Builder';
import { SPORT_ORDER, useDebouncedSave, useThresholdsOn } from '@/features/workouts/model';
import { TemplateMini, TotalsTiles } from '@/features/workouts/parts';
import {
  useCreateTemplate,
  useDeleteTemplate,
  usePatchTemplate,
  useRestoreTemplates,
  useScheduleTemplate,
  useSeedStarter,
  useTemplate,
  useTemplates,
  useWorkoutsBetween,
} from '@/features/workouts/queries';

const libApi = getRouteApi('/_app/library');
const tplApi = getRouteApi('/_app/library/$templateId');
const blockApi = getRouteApi('/_app/library/blocks/$blockId');

type Sort = 'recent' | 'used' | 'duration' | 'load';

// ───────────────────────── gallery ─────────────────────────

export function LibraryPage() {
  const search = libApi.useSearch();
  const navigate = libApi.useNavigate();
  const q = useTemplates();
  const { thresholds, today } = useThresholdsOn('bike');
  const [text, setText] = useState(search.q ?? '');
  const deferred = useDeferredValue(text);
  const [sort, setSort] = useState<Sort>('recent');
  useEffect(() => {
    const t = setTimeout(() => navigate({ search: (s) => ({ ...s, q: text || undefined }), replace: true }), 250);
    return () => clearTimeout(t);
  }, [text, navigate]);

  const all = q.data ?? [];
  const folders = useMemo(() => [...new Set(all.map((t) => t.folder).filter((f): f is string => !!f))].sort(), [all]);
  const list = useMemo(() => {
    const words = deferred.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const out = all.filter(
      (t) =>
        (!search.sport || t.sport === search.sport) &&
        (!search.intensity || t.intensity === search.intensity) &&
        (!search.folder || t.folder === search.folder) &&
        words.every((w) => `${t.title} ${t.description ?? ''} ${t.tags.join(' ')} ${t.folder ?? ''}`.toLowerCase().includes(w)),
    );
    const by: Record<Sort, (a: Template, b: Template) => number> = {
      recent: (a, b) => (b.lastUsedAt ?? b.updatedAt).localeCompare(a.lastUsedAt ?? a.updatedAt),
      used: (a, b) => b.usageCount - a.usageCount,
      duration: (a, b) => (b.plannedDurationSec ?? 0) - (a.plannedDurationSec ?? 0),
      load: (a, b) => (b.plannedLoad ?? 0) - (a.plannedLoad ?? 0),
    };
    return out.sort(by[sort]);
  }, [all, deferred, search.sport, search.intensity, search.folder, sort]);
  const sports = useMemo(() => SPORT_ORDER.filter((s) => all.some((t) => t.sport === s)), [all]);

  const seed = useSeedStarter();
  const create = useCreateTemplate();
  const nav = useNavigate();
  const newTemplate = async () => {
    const sport = search.sport ?? 'bike';
    try {
      const t = await create.mutateAsync({ sport, title: `New ${SPORT_META[sport].label.toLowerCase()} template`, intensity: 'endurance', tags: [] });
      nav(links.template(t.id));
    } catch (e) {
      toast.error(`Couldn’t create: ${(e as Error).message}`);
    }
  };

  return (
    <Page
      header={
        <PageHeader
          title="Library"
          eyebrow={q.data ? `${all.length} templates` : 'Templates'}
          actions={
            <>
              <Button size="sm" variant="ghost" icon={<RotateCcw />} loading={seed.isPending} onClick={() => seed.mutate(undefined, { onSuccess: (r) => toast.success(r.installed ? `Reinstalled ${r.installed} starter templates` : 'Starter library is complete') })} className="max-md:hidden">
                Reinstall starters
              </Button>
              <Button size="sm" variant="primary" icon={<Plus />} loading={create.isPending} onClick={newTemplate}>
                New template
              </Button>
            </>
          }
        />
      }
    >
      <Section stagger={false}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-full sm:w-72">
              <Input leading={<Search className="size-4" />} value={text} onChange={(e) => setText(e.currentTarget.value)} placeholder="Search templates" aria-label="Search templates" trailing={text ? <IconButton size="sm" label="Clear" icon={<X />} onClick={() => setText('')} /> : undefined} />
            </div>
            <Segmented size="sm" aria-label="Sort" value={sort} onValueChange={setSort} options={[{ value: 'recent', label: 'Recent' }, { value: 'used', label: 'Most used' }, { value: 'duration', label: 'Duration' }, { value: 'load', label: 'Load' }]} />
            {folders.length > 0 && (
              <select
                aria-label="Folder"
                value={search.folder ?? ''}
                onChange={(e) => navigate({ search: (s) => ({ ...s, folder: e.currentTarget.value || undefined }), replace: true })}
                className="h-7 rounded-md border border-line-2 bg-surface-2 px-2 text-label text-fg-2 outline-none"
              >
                <option value="">All folders</option>
                {folders.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <FilterRow
              id="sport"
              value={search.sport ?? 'all'}
              onChange={(v) => navigate({ search: (s) => ({ ...s, sport: v === 'all' ? undefined : (v as Sport) }), replace: true })}
              options={[{ value: 'all', label: 'All' }, ...sports.map((s) => ({ value: s, label: SPORT_META[s].label, icon: <SportGlyph sport={s} size={14} /> }))]}
            />
            <span className="h-4 w-px bg-line-2 max-sm:hidden" />
            <FilterRow
              id="int"
              value={search.intensity ?? 'all'}
              onChange={(v) => navigate({ search: (s) => ({ ...s, intensity: v === 'all' ? undefined : (v as IntensityClass) }), replace: true })}
              options={[{ value: 'all', label: 'Any intensity' }, ...INTENSITY_CLASSES.filter((c) => c !== 'race').map((c) => ({ value: c, label: INTENSITY_META[c].label, icon: <IntensityPips intensity={c} /> }))]}
            />
          </div>
        </div>
      </Section>

      <Section stagger={false}>
        {q.isPending ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-[150px]" radius="lg" />
            ))}
          </div>
        ) : q.isError ? (
          <EmptyState icon={<TriangleAlert />} title="Couldn’t load the library" action={<Button onClick={() => q.refetch()}>Try again</Button>}>
            {q.error.message}
          </EmptyState>
        ) : !list.length ? (
          <EmptyState icon={<BookCopy />} title={all.length ? 'No templates match' : 'Your library is empty'} action={all.length ? <Button onClick={() => { setText(''); navigate({ search: {}, replace: true }); }}>Clear filters</Button> : <Button onClick={() => seed.mutate()}>Install starter library</Button>}>
            {all.length ? 'Try another word or filter.' : 'Thirty proven sessions across bike, run, swim, row and strength.'}
          </EmptyState>
        ) : (
          <LayoutGroup>
            <motion.div layout className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <AnimatePresence mode="popLayout" initial={false}>
                {list.map((t) => (
                  <TemplateCard key={t.id} t={t} thresholds={thresholds} today={today} />
                ))}
              </AnimatePresence>
            </motion.div>
          </LayoutGroup>
        )}
      </Section>
    </Page>
  );
}

function FilterRow({ id, value, onChange, options }: { id: string; value: string; onChange: (v: string) => void; options: { value: string; label: string; icon?: React.ReactNode }[] }) {
  return (
    <div role="radiogroup" aria-label={id === 'sport' ? 'Sport' : 'Intensity'} className="flex gap-1 max-sm:-mx-4 max-sm:w-[calc(100%+2rem)] max-sm:overflow-x-auto max-sm:px-4 sm:flex-wrap [&>button]:shrink-0">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn('relative inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-label transition-colors duration-(--dur-fast)', on ? 'text-fg-1' : 'text-fg-3 hover:text-fg-1')}
          >
            {on && <motion.span layoutId={`lib-filter-${id}`} transition={spring.snappy} className="absolute inset-0 -z-10 rounded-md border border-line-3 bg-surface-active" />}
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function TemplateCard({ t, thresholds, today }: { t: Template; thresholds: Parameters<typeof TemplateMini>[0]['thresholds']; today?: LocalDate }) {
  const schedule = useScheduleTemplate();
  const del = useDeleteTemplate();
  const restore = useRestoreTemplates();
  const create = useCreateTemplate();
  const delWorkouts = useDeleteWorkouts();
  const navigate = useNavigate();
  const doSchedule = (date: LocalDate) =>
    schedule.mutateAsync({ id: t.id, dates: [date] }).then(
      (r) => {
        const w = r.workouts[0];
        toast.undo(
          <>
            Scheduled <b>{t.title}</b> · {formatDayShort(date)}
          </>,
          () => delWorkouts.mutate(r.workouts.map((x) => x.id)),
        );
        if (w) toast('Open the new workout?', { action: { label: 'Open', onClick: () => navigate(links.workout(w.id)) }, timeout: 5000 });
      },
      (e) => toast.error(`Couldn’t schedule: ${(e as Error).message}`),
    );
  const remove = () =>
    del.mutateAsync(t.id).then(
      (gone) => toast.undo(<>Deleted <b>{gone.title}</b></>, () => restore.mutate([gone])),
      (e) => toast.error((e as Error).message),
    );
  const duplicate = () =>
    create
      .mutateAsync({ sport: t.sport, subSport: t.subSport, title: `${t.title} (copy)`, description: t.description, structure: t.structure, intensity: t.intensity, tags: t.tags, folder: t.folder, plannedDurationSec: t.plannedDurationSec, plannedDistanceM: t.plannedDistanceM })
      .then((c) => toast.success(<>Duplicated as <b>{c.title}</b></>), (e) => toast.error((e as Error).message));
  return (
    <motion.div layout initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.12 } }} transition={spring.smooth} className="group relative">
      <Link {...links.template(t.id)} className="spotlight block rounded-lg border border-line-1 bg-surface-1 p-4 pb-12 transition-colors duration-(--dur-fast) hover:border-line-3 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
        <TemplateMini t={t} thresholds={thresholds} />
      </Link>
      <div className="absolute inset-x-4 bottom-3 flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-body-sm text-fg-3">
          {t.usageCount ? `Used ${t.usageCount}×${t.lastUsedAt ? ` · last ${formatDateMedium(t.lastUsedAt.slice(0, 10))}` : ''}` : 'Never used'}
          {t.folder && <span className="text-fg-4"> · {t.folder}</span>}
        </span>
        <Popover title="Schedule on" trigger={<Button size="sm" variant="ghost" icon={<CalendarPlus />}>Schedule</Button>}>
          {(close) => (
            <MonthGrid
              value={null}
              today={today}
              onSelect={(d) => {
                close();
                void doSchedule(d);
              }}
            />
          )}
        </Popover>
        <Menu
          trigger={<IconButton size="sm" label="More actions" icon={<MoreHorizontal />} />}
          items={[
            { label: 'New workout from this', icon: <Plus />, onSelect: () => navigate(links.newWorkout({ from: t.id, sport: t.sport })) },
            { label: 'Duplicate', icon: <Copy />, onSelect: duplicate },
            { type: 'separator' },
            { label: 'Delete', icon: <Trash2 />, destructive: true, onSelect: remove },
          ]}
        />
      </div>
    </motion.div>
  );
}

// ───────────────────────── template page ─────────────────────────

export function TemplatePage() {
  const { templateId } = tplApi.useParams();
  const q = useTemplate(templateId);
  if (q.isPending)
    return (
      <Page header={<PageHeader title={<Skeleton className="h-9 w-72" />} titleText="Template" back={links.library()} />}>
        <Skeleton className="h-[214px] w-full" radius="lg" />
      </Page>
    );
  if (q.isError || !q.data)
    return (
      <Page header={<PageHeader title="Template" back={links.library()} />}>
        <EmptyState icon={<TriangleAlert />} title="Couldn’t load this template" action={<ButtonLink {...links.library()}>Back to library</ButtonLink>}>
          {q.error?.message}
        </EmptyState>
      </Page>
    );
  return <TemplateView key={q.data.id} t={q.data} />;
}

function TemplateView({ t }: { t: Template }) {
  const patchM = usePatchTemplate();
  const del = useDeleteTemplate();
  const restore = useRestoreTemplates();
  const navigate = useNavigate();
  const { thresholds, today: apiToday } = useThresholdsOn(t.sport);
  const localToday = useToday();
  const today = apiToday ?? localToday;
  const [draft, setDraft] = useState<WorkoutStructure>(() => t.structure ?? { steps: [] });
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const patch = async (p: Record<string, unknown>) => {
    setStatus('saving');
    try {
      await patchM.mutateAsync({ id: t.id, patch: p });
      setStatus('saved');
      setTimeout(() => setStatus((s) => (s === 'saved' ? 'idle' : s)), 2400);
    } catch (e) {
      setStatus('error');
      toast.error(`Couldn’t save: ${(e as Error).message}`);
    }
  };
  const initial = useMemo(() => draft, []); // eslint-disable-line react-hooks/exhaustive-deps
  useDebouncedSave(draft, initial, (s) => patch({ structure: s.steps.length ? s : null }));
  const estimate = useMemo(() => estimateWorkout(draft, t.sport, thresholds), [draft, t.sport, thresholds]);
  const totals = draft.steps.length
    ? { durationSec: estimate.durationSec, distanceM: estimate.distanceM, load: estimate.load, intensityFactor: estimate.intensityFactor }
    : (() => {
        const u = estimateUnstructured(t.plannedDurationSec, t.intensity, t.sport, { distanceM: t.plannedDistanceM, thresholds });
        return { durationSec: u.durationSec, distanceM: t.plannedDistanceM, load: u.load, intensityFactor: u.intensityFactor };
      })();
  const onDelete = () =>
    del.mutateAsync(t.id).then((gone) => {
      toast.undo(<>Deleted <b>{gone.title}</b></>, () => restore.mutate([gone]));
      navigate(links.library());
    });

  return (
    <Page
      header={
        <PageHeader
          back={links.library()}
          breadcrumb={[{ label: 'Library', link: links.library() }, ...(t.folder ? [{ label: t.folder, link: links.library({ folder: t.folder }) }] : [])]}
          glyph={<SportGlyph sport={t.sport} subSport={t.subSport} size={24} />}
          titleText={t.title}
          title={<InlineEdit value={t.title} onSave={(title) => patch({ title })} variant="title" aria-label="Template title" className="[&>button]:w-auto" />}
          eyebrow={`Template${t.folder ? ` · ${t.folder}` : ''}`}
          meta={
            <>
              <Popover
                title="Intensity"
                trigger={
                  <button type="button" className="inline-flex h-7 items-center gap-2 rounded-sm border border-line-1 px-2 text-label text-fg-2 transition-colors hover:border-line-3 hover:text-fg-1">
                    <IntensityPips intensity={t.intensity} size="md" />
                    {INTENSITY_META[t.intensity].label}
                  </button>
                }
              >
                <IntensityPicker value={t.intensity} onValueChange={(intensity) => void patch({ intensity })} />
              </Popover>
              <span className="text-body-sm text-fg-3">{t.usageCount ? `Scheduled ${t.usageCount}×` : 'Not scheduled yet'}</span>
            </>
          }
          actions={
            <>
              <SaveIndicator status={status} className="max-sm:hidden" />
              <ButtonLink size="sm" variant="secondary" icon={<Plus />} {...links.newWorkout({ from: t.id, sport: t.sport })}>
                <span className="max-sm:hidden">New workout</span>
              </ButtonLink>
              <IconButton size="sm" label="Delete template" icon={<Trash2 />} onClick={onDelete} />
            </>
          }
        />
      }
    >
      <Section title="Structure" description="Totals use your current thresholds.">
        <Builder sport={t.sport} subSport={t.subSport} structure={draft} onChange={setDraft} thresholds={thresholds} estimate={estimate} />
      </Section>
      <Section>
        <TotalsTiles totals={totals} sport={t.sport} />
      </Section>
      <Section stagger={false}>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex min-w-0 flex-col gap-6">
            <TplNotes t={t} patch={patch} />
            <Instances t={t} today={today} />
          </div>
          <ScheduleCard t={t} today={today} />
        </div>
      </Section>
    </Page>
  );
}

function TplNotes({ t, patch }: { t: Template; patch: (p: Record<string, unknown>) => Promise<void> }) {
  const [desc, setDesc] = useState(t.description ?? '');
  return (
    <Section title="Description" variant="micro">
      <div className="flex flex-col gap-4">
        <Textarea value={desc} minRows={3} onChange={(e) => setDesc(e.currentTarget.value)} onBlur={() => desc.trim() !== (t.description ?? '') && void patch({ description: desc.trim() || null })} placeholder="Purpose, cues, fuelling…" className="bg-surface-1" />
        <div className="flex flex-col gap-1.5">
          <span className="text-micro uppercase text-fg-3">Tags</span>
          <TagInput value={t.tags} onValueChange={(tags) => void patch({ tags })} aria-label="Tags" />
        </div>
      </div>
    </Section>
  );
}

function ScheduleCard({ t, today }: { t: Template; today: LocalDate }) {
  const [dates, setDates] = useState<LocalDate[]>([]);
  const schedule = useScheduleTemplate();
  const del = useDeleteWorkouts();
  const navigate = useNavigate();
  const go = () =>
    schedule.mutateAsync({ id: t.id, dates }).then(
      (r) => {
        setDates([]);
        toast.undo(<>Scheduled <b>{r.workouts.length}</b> × {t.title}</>, () => del.mutate(r.workouts.map((w) => w.id)));
        if (r.workouts.length === 1) toast('Open it?', { action: { label: 'Open', onClick: () => navigate(links.workout(r.workouts[0].id)) }, timeout: 5000 });
      },
      (e) => toast.error((e as Error).message),
    );
  return (
    <Card padding="md" className="flex flex-col gap-3 self-start">
      <span className="text-micro uppercase text-fg-3">Schedule</span>
      <MonthGrid value={dates.at(-1) ?? null} today={today} min={today} onSelect={(d) => setDates((x) => (x.includes(d) ? x.filter((y) => y !== d) : [...x, d].sort()))} />
      <div className="flex min-h-7 flex-wrap gap-1">
        <AnimatePresence initial={false}>
          {dates.map((d) => (
            <motion.button key={d} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={spring.snappy} type="button" onClick={() => setDates((x) => x.filter((y) => y !== d))} className="inline-flex h-6 items-center gap-1 rounded-sm border border-line-3 bg-surface-3 px-2 text-label text-fg-1">
              {formatDayShort(d)} <X className="size-3 text-fg-3" />
            </motion.button>
          ))}
        </AnimatePresence>
        {!dates.length && <span className="text-body-sm text-fg-3">Pick one or more days.</span>}
      </div>
      <Button variant="primary" disabled={!dates.length} loading={schedule.isPending} onClick={go} icon={<CalendarPlus />}>
        {dates.length > 1 ? `Schedule ${dates.length} workouts` : 'Schedule'}
      </Button>
    </Card>
  );
}

function Instances({ t, today }: { t: Template; today: LocalDate }) {
  const q = useWorkoutsBetween(addDays(today, -180), addDays(today, 180));
  const items = (q.data ?? []).filter((w) => w.templateId === t.id).sort((a, b) => b.date.localeCompare(a.date));
  const done = items.filter((w) => w.pairedActivityId && w.compliance);
  return (
    <>
      <Section title="Scheduled instances" variant="micro">
        {q.isPending ? (
          <Skeleton className="h-20 w-full" radius="md" />
        ) : items.length ? (
          <ul className="flex flex-col gap-1">
            {items.slice(0, 12).map((w) => (
              <li key={w.id}>
                <Link {...links.workout(w.id)} className="flex h-10 items-center gap-3 rounded-md px-3 text-body transition-colors hover:bg-surface-1">
                  <ComplianceGlyph state={w.compliance?.state ?? 'planned'} />
                  <span className="w-28 shrink-0 font-mono text-mono text-fg-2">{formatDateMedium(w.date)}</span>
                  <span className="min-w-0 flex-1 truncate text-fg-1">{w.title}</span>
                  <span className={cn('text-micro uppercase', w.date >= today ? 'text-fg-2' : 'text-fg-3')}>{w.date >= today ? 'Upcoming' : w.pairedActivityId ? 'Done' : w.status === 'skipped' ? 'Skipped' : 'Missed'}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body-sm text-fg-3">Not on the calendar in the last or next six months.</p>
        )}
      </Section>
      {done.length > 0 && (
        <Section title="Performance history" variant="micro">
          <div className="flex items-end gap-1.5" role="list" aria-label="Compliance of past instances">
            {done.slice(0, 16).reverse().map((w) => (
              <Link key={w.id} {...links.workout(w.id)} role="listitem" title={`${formatDayShort(w.date)} · ${Math.round(w.compliance!.ratio * 100)}%`} className="flex flex-col items-center gap-1">
                <span className="w-6 rounded-xs bg-accent" style={{ height: Math.max(4, Math.min(1.5, w.compliance!.ratio) * 40), opacity: w.compliance!.state === 'on_target' ? 1 : 0.5 }} />
                <span className="font-mono text-mono-sm text-fg-3">{Math.round(w.compliance!.ratio * 100)}</span>
              </Link>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

// ───────────────────────── blocks ─────────────────────────

export function BlockPage() {
  const { blockId } = blockApi.useParams();
  return (
    <Page header={<PageHeader title="Training block" eyebrow={blockId} back={links.library()} glyph={<Boxes className="size-6" />} />}>
      <Section>
        <EmptyState icon={<Boxes />} title="Multi-week blocks are coming" action={<ButtonLink {...links.library()}>Browse templates</ButtonLink>}>
          Save a run of weeks as a block and apply it from any date. For now, schedule templates one session at a time or repeat a workout weekly.
        </EmptyState>
      </Section>
    </Page>
  );
}

