/**
 * /activities/$id — the completed-activity analysis page (product.md §5). One scrolling page with
 * a sticky section nav whose active pill slides; header is the morph target for calendar cards.
 */
import { INTENSITY_META, SPORT_META, type ActivityDetail, type IntensityClass, type Sport } from '@cadence/core/domain';
import { rpeLoad } from '@cadence/core/metrics';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Download, FileDown, Info, MoreHorizontal, RotateCcw, SearchX, Trash2, TriangleAlert, Upload as UploadIcon, Watch, PencilLine } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Button,
  ButtonLink,
  Chip,
  ComplianceGlyph,
  complianceLabel,
  EmptyState,
  IconButton,
  InlineEdit,
  IntensityPicker,
  IntensityPips,
  KeyStar,
  Menu,
  Page,
  PageHeader,
  Popover,
  RpeSlider,
  SaveIndicator,
  Section,
  Skeleton,
  SportGlyph,
  TagInput,
  Textarea,
  toast,
  Tooltip,
  useAutosave,
  type MenuEntry,
} from '@/ui';
import { DeltaBadge } from '@/ui/domain/DeltaBadge';
import { PageItem } from '@/motion';
import { Ticker } from '@/motion/Ticker';
import { spring } from '@/motion/tokens';
import { cn } from '@/lib/cn';
import { formatDateLong, formatInstantTime } from '@/lib/format';
import { qk } from '@/lib/query';
import { useUnits } from '@/lib/units';
import { usePatchActivity } from '@/lib/queries/training';
import { links } from '@/shell/links';
import { useActivity, useDeleteActivity, useRestoreActivity } from './data';
import { deltaOf, statsFor, type Stat } from './stats';
import { StreamsSection, LapsSection, ZonesSection, PeaksSection } from './Analysis';
import { PlanSection, PreviousSection } from './Context';

const route = getRouteApi('/_app/activities/$id');

const SOURCE_LABEL = { garmin: 'Garmin', upload: 'FIT upload', manual: 'Manual', demo: 'Garmin' } as const;

export function ActivityPage() {
  const { id } = route.useParams();
  const q = useActivity(id);
  if (q.isPending) return <ActivitySkeleton />;
  if (q.isError || !q.data)
    return (
      <Page header={<PageHeader title="Activity" back={links.activities()} />}>
        <EmptyState
          icon={q.error && 'status' in q.error && (q.error as { status: number }).status === 404 ? <SearchX /> : <TriangleAlert />}
          title={q.error && 'status' in q.error && (q.error as { status: number }).status === 404 ? 'This activity is gone' : 'Couldn’t load this activity'}
          action={
            q.error && 'status' in q.error && (q.error as { status: number }).status === 404 ? (
              <ButtonLink {...links.activities()}>All activities</ButtonLink>
            ) : (
              <Button icon={<RotateCcw />} onClick={() => q.refetch()}>
                Retry
              </Button>
            )
          }
        >
          It may have been deleted, or the connection dropped.
        </EmptyState>
      </Page>
    );
  return <ActivityView a={q.data} />;
}

// ───────────────────────────── page ─────────────────────────────

const NAV = [
  { id: 'overview', label: 'Overview' },
  { id: 'charts', label: 'Charts' },
  { id: 'laps', label: 'Laps' },
  { id: 'zones', label: 'Zones' },
  { id: 'peaks', label: 'Peaks' },
  { id: 'notes', label: 'Notes' },
] as const;

function ActivityView({ a }: { a: ActivityDetail }) {
  const units = useUnits();
  const patch = usePatchActivity();
  const set = (p: Parameters<typeof patch.mutate>[0]['patch']) => patch.mutateAsync({ id: a.id, patch: p });
  const [rpe, setRpe] = useState<number | null>(a.rpe ?? null);
  useEffect(() => setRpe(a.rpe ?? null), [a.rpe]);
  const liveLoad = a.loadSource === 'rpe' && rpe ? rpeLoad(rpe, a.durationSec) : undefined;
  const stats = useMemo(() => statsFor(a, units, liveLoad), [a, units, liveLoad]);
  const hasStreams = a.hasStreams;
  const nav = NAV.filter((n) => (n.id === 'charts' ? hasStreams : n.id === 'zones' ? !!(a.zones.hr || a.zones.power || a.zones.pace) : n.id === 'peaks' ? !!(a.peaks.power?.length || a.peaks.efforts?.length || a.peaks.speed?.length) : n.id === 'laps' ? a.laps.length > 1 || !!a.strengthSets?.length : true));

  return (
    <Page
      header={
        <PageHeader
          morph
          back={links.activities()}
          breadcrumb={[{ label: 'Activities', link: links.activities() }]}
          glyph={<SportGlyph sport={a.sport} subSport={a.subSport} size={32} />}
          eyebrow={
            <span className="flex flex-wrap items-center gap-x-2">
              <span>{formatDateLong(a.localDate, true)}</span>
              <span className="text-fg-4">·</span>
              <span className="">{formatInstantTime(a.startedAt, a.utcOffsetMin)}</span>
              <span className="text-fg-4">·</span>
              <span>{SPORT_META[a.sport].label}{a.subSport && a.subSport !== 'generic' ? ` · ${a.subSport.replace('_', ' ')}` : ''}</span>
            </span>
          }
          titleText={a.title}
          title={<InlineEdit className="[&>button]:!w-auto" variant="title" value={a.title} onSave={(t) => set({ title: t })} aria-label="Activity title" />}
          meta={<HeaderMeta a={a} set={set} />}
          aside={<HeroLoad a={a} liveLoad={liveLoad} />}
          actions={<ActionsMenu a={a} set={set} />}
        />
      }
    >
      <SectionNav items={nav} />
      <Section id="overview" stagger className="-mt-2">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <StatGrid stats={stats} hasPrev={!!a.previousSimilar} />
          <FeltCard a={a} rpe={rpe} setRpe={setRpe} set={set} />
        </div>
      </Section>
      {hasStreams && <StreamsSection a={a} />}
      {(a.laps.length > 1 || !!a.strengthSets?.length) && <LapsSection a={a} />}
      {(a.zones.hr || a.zones.power || a.zones.pace) && <ZonesSection a={a} />}
      {(a.peaks.power?.length || a.peaks.efforts?.length || a.peaks.speed?.length) ? <PeaksSection a={a} /> : null}
      <PlanSection a={a} />
      {a.previousSimilar && <PreviousSection a={a} />}
    </Page>
  );
}

// ───────────────────────────── header bits ─────────────────────────────

type Setter = (p: Parameters<ReturnType<typeof usePatchActivity>['mutate']>[0]['patch']) => Promise<unknown>;

function HeaderMeta({ a, set }: { a: ActivityDetail; set: Setter }) {
  const overridden = !!a.intensityOverride;
  return (
    <>
      <Chip size="sm" icon={a.source === 'manual' ? <PencilLine /> : a.source === 'upload' ? <UploadIcon /> : <Watch />}>
        {SOURCE_LABEL[a.source]}
      </Chip>
      <span className="flex items-center gap-1.5 rounded-sm border border-line-2 py-0.5 pr-2 pl-1">
        <KeyStar pressed={a.isKey} onPressedChange={(v) => void set({ isKey: v })} />
        <span className={cn('text-label', a.isKey ? 'text-accent-ink' : 'text-fg-2')}>{a.isKey ? 'Key session' : 'Mark key'}</span>
      </span>
      <Popover
        title="Intensity"
        trigger={
          <button type="button" className="flex h-7 items-center gap-2 rounded-sm border border-line-2 px-2 transition-colors duration-(--dur-fast) hover:bg-surface-2" aria-label="Change intensity">
            <IntensityPips intensity={a.intensity} size="md" />
            <span className="text-label text-fg-1">{INTENSITY_META[a.intensity].label}</span>
            <span className="text-micro text-fg-3">{overridden ? 'Set by you' : 'Auto'}</span>
          </button>
        }
      >
        {(close) => (
          <div className="flex w-64 flex-col gap-3 p-1">
            <IntensityPicker value={a.intensity} onValueChange={(v: IntensityClass) => void set({ intensityOverride: v })} />
            <p className="text-body-sm text-fg-2">
              Auto · <span className="text-fg-1">{INTENSITY_META[a.intensityAuto].label}</span> — from time in zone across the whole session.
            </p>
            {overridden && (
              <Button size="sm" variant="outline" icon={<RotateCcw />} onClick={() => { void set({ intensityOverride: null }); close(); }}>
                Back to auto
              </Button>
            )}
          </div>
        )}
      </Popover>
      {a.compliance && a.compliance.state !== 'unplanned' && (
        <span className="flex h-7 items-center gap-1.5 rounded-sm border border-line-2 px-2 text-label text-fg-1">
          <ComplianceGlyph state={a.compliance.state} />
          {complianceLabel(a.compliance.state)}
          <span className="text-mono-sm text-fg-2">
            {Math.round(a.compliance.ratio * 100)}% {a.compliance.metric}
          </span>
        </span>
      )}
      {a.compliance?.state === 'unplanned' && (
        <span className="flex h-7 items-center gap-1.5 px-1 text-micro text-fg-3">
          <ComplianceGlyph state="unplanned" /> Unplanned
        </span>
      )}
    </>
  );
}

function HeroLoad({ a, liveLoad }: { a: ActivityDetail; liveLoad?: number }) {
  return (
    <div className="flex items-end gap-6 lg:flex-col lg:items-end lg:gap-1">
      <div className="flex items-baseline gap-2">
        <span className="text-stat-lg text-accent-ink">
          <Ticker value={liveLoad ?? a.load} format={(n) => String(Math.round(n))} />
        </span>
        <span className="text-micro text-fg-3">Load</span>
      </div>
      <span className="text-body-sm text-fg-3">{a.loadSource === 'rpe' ? 'estimated from RPE' : a.loadSource === 'hr' ? 'from heart rate' : a.loadSource === 'power' ? 'from power' : a.loadSource === 'manual' ? 'set by you' : `from ${a.loadSource.replace('_', ' ')}`}</span>
    </div>
  );
}

const SPORT_CHOICES: Sport[] = ['bike', 'run', 'swim', 'row', 'strength', 'hike', 'walk', 'yoga', 'ski', 'other'];

function ActionsMenu({ a, set }: { a: ActivityDetail; set: Setter }) {
  const del = useDeleteActivity();
  const restore = useRestoreActivity();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const download = (path: string) => {
    const el = document.createElement('a');
    el.href = `/api/activities/${a.id}/${path}`;
    el.download = '';
    document.body.appendChild(el);
    el.click();
    el.remove();
  };
  const items: MenuEntry[] = [
    ...(a.previousSimilar ? [{ label: 'Compare…', icon: <ArrowLeftRight />, onSelect: () => navigate(links.activityCompare(a.id, [a.previousSimilar!.id])) }] : []),
    ...(a.hasStreams ? [{ label: 'Export CSV', icon: <FileDown />, onSelect: () => download('export.csv') }] : []),
    ...(a.source !== 'manual' ? [{ label: 'Download original FIT', icon: <Download />, onSelect: () => download('original') }] : []),
    {
      type: 'submenu',
      label: 'Change sport',
      icon: <SportGlyph sport={a.sport} size={16} />,
      items: SPORT_CHOICES.map((s) => ({ label: SPORT_META[s].label, icon: <SportGlyph sport={s} size={16} />, checked: s === a.sport, onSelect: () => void set({ sport: s }) })),
    },
    { type: 'separator' },
    {
      label: 'Delete',
      icon: <Trash2 />,
      destructive: true,
      onSelect: async () => {
        await del.mutateAsync(a.id);
        void navigate(links.activities());
        toast.undo(<>Deleted <b>{a.title}</b></>, async () => {
          await restore.mutateAsync(a.id);
          await qc.invalidateQueries({ queryKey: qk.activities.all });
          void navigate(links.activity(a.id));
        });
      },
    },
  ];
  return <Menu trigger={<IconButton label="More actions" icon={<MoreHorizontal />} size="sm" />} items={items} />;
}

// ───────────────────────────── section nav ─────────────────────────────

function SectionNav({ items }: { items: readonly { id: string; label: string }[] }) {
  const [active, setActive] = useState(items[0]?.id);
  const lock = useRef(0);
  useEffect(() => {
    const els = items.map((i) => document.getElementById(i.id)).filter(Boolean) as HTMLElement[];
    const onScroll = () => {
      if (Date.now() < lock.current) return;
      const y = 140;
      let cur = els[0]?.id;
      for (const el of els) if (el.id !== 'notes' && el.getBoundingClientRect().top - y <= 0) cur = el.id;
      const sc = document.scrollingElement;
      setActive(cur);
    };
    const target: HTMLElement | Window = document.querySelector('main') ?? window;
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll, { capture: true });
    void target;
  }, [items]);
  return (
    <PageItem className="sticky top-(--header-h) z-(--z-sticky) -mx-4 -mt-4 border-b border-line-1 bg-canvas/85 px-4 backdrop-blur-md md:-mx-6 md:px-6 xl:-mx-10 xl:px-10">
      <nav aria-label="Sections" className="flex h-11 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
        {items.map((i) => (
          <button
            key={i.id}
            type="button"
            aria-current={active === i.id ? 'true' : undefined}
            onClick={() => {
              setActive(i.id);
              lock.current = Date.now() + 700;
              document.getElementById(i.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            className={cn('relative h-7 shrink-0 rounded-sm px-3 text-label transition-colors duration-(--dur-fast)', active === i.id ? 'text-fg-1' : 'text-fg-3 hover:text-fg-1')}
          >
            {active === i.id && <motion.span layoutId="act-section-pill" transition={spring.snappy} className="absolute inset-0 -z-10 rounded-sm bg-surface-3" />}
            <span className="relative">{i.label}</span>
          </button>
        ))}
      </nav>
    </PageItem>
  );
}

// ───────────────────────────── stat grid ─────────────────────────────

function StatGrid({ stats, hasPrev }: { stats: Stat[]; hasPrev: boolean }) {
  const hero = stats.slice(0, 4);
  const rest = stats.slice(4);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {hero.map((s) => (
          <div key={s.key} className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-line-2 bg-surface-1 p-4">
            <StatLabel s={s} />
            <div className={cn('flex min-w-0 items-baseline gap-1 text-stat-md', s.signal ? 'text-accent-ink' : 'text-fg-1')}>
              {s.value == null ? <span className="text-fg-4">—</span> : <Ticker value={s.value} format={s.format} />}
              {s.unit && <span className="text-[1.1rem] font-[450] tracking-normal text-fg-3">{s.unit}</span>}
            </div>
            <div className="flex h-4 items-center gap-2">
              {s.sub ? <span className="truncate text-body-sm text-fg-3">{s.sub}</span> : hasPrev && deltaOf(s) !== undefined ? <DeltaBadge value={deltaOf(s)!} good={s.perf && (s.lowerBetter ? deltaOf(s)! < 0 : deltaOf(s)! > 0)} suffix="vs last" /> : null}
            </div>
          </div>
        ))}
      </div>
      {rest.length > 0 && (
        <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-line-2 bg-surface-1 sm:grid-cols-3 xl:grid-cols-4">
          {rest.map((s) => (
            <div key={s.key} className="-mr-px -mb-px flex min-w-0 flex-col gap-1 border-r border-b border-line-1 px-4 py-3">
              <StatLabel s={s} />
              <div className="flex items-baseline gap-1 text-stat-sm text-fg-1">
                {s.value == null ? <span className="text-fg-4">—</span> : <Ticker value={s.value} format={s.format} />}
                {s.unit && <span className="text-label font-[450] text-fg-3">{s.unit}</span>}
              </div>
              {hasPrev && deltaOf(s) !== undefined && <DeltaBadge size="sm" value={deltaOf(s)!} good={s.perf && (s.lowerBetter ? deltaOf(s)! < 0 : deltaOf(s)! > 0)} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatLabel({ s }: { s: Stat }) {
  if (!s.tip) return <span className="truncate text-micro text-fg-3">{s.label}</span>;
  return (
    <Tooltip content={<span className="block max-w-64">{s.tip}</span>}>
      <span tabIndex={0} className="flex w-fit cursor-help items-center gap-1 truncate rounded-xs text-micro text-fg-3 outline-none hover:text-fg-2 focus-visible:outline-2 focus-visible:outline-focus">
        {s.label}
        <Info className="size-3 opacity-60" aria-hidden />
      </span>
    </Tooltip>
  );
}

// ───────────────────────────── how it felt ─────────────────────────────

const FEEL = ['Awful', 'Bad', 'OK', 'Good', 'Great'];

function FeltCard({ a, rpe, setRpe, set }: { a: ActivityDetail; rpe: number | null; setRpe: (n: number) => void; set: Setter }) {
  const [note, setNote] = useState(a.postNote ?? '');
  const noteStatus = useAutosave(note, (v) => set({ postNote: v || null }), { delay: 700 });
  const empty = a.rpe == null && !a.postNote && a.feel == null;
  return (
    <div
      id="notes"
      className={cn('flex scroll-mt-32 flex-col gap-5 rounded-lg border bg-surface-1 p-4 lg:sticky lg:top-[calc(var(--header-h)+3.5rem)] lg:self-start', empty ? 'border-accent-a5' : 'border-line-2')}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-title-3 text-fg-1">{empty ? 'How did it feel?' : 'How it felt'}</h2>
        <SaveIndicator status={noteStatus} />
      </div>
      <RpeSlider value={rpe} onValueChange={setRpe} onValueCommitted={(v) => void set({ rpe: v })} />
      <div className="flex flex-col gap-2">
        <span className="text-label text-fg-2">Feel</span>
        <div role="radiogroup" aria-label="Feel" className="grid grid-cols-5 gap-1">
          {FEEL.map((f, i) => {
            const on = a.feel === i + 1;
            return (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => void set({ feel: on ? null : i + 1 })}
                className={cn('flex h-12 flex-col items-center justify-center gap-1 rounded-md border text-micro transition-colors duration-(--dur-fast)', on ? 'border-line-3 bg-surface-3 text-fg-1' : 'border-line-1 text-fg-3 hover:bg-surface-2 hover:text-fg-1')}
              >
                <span className="flex gap-0.5" aria-hidden>
                  {Array.from({ length: 5 }, (_, k) => (
                    <span key={k} className={cn('size-1 rounded-full', k <= i ? (on ? 'bg-fg-1' : 'bg-fg-3') : 'bg-gray-7')} />
                  ))}
                </span>
                {f}
              </button>
            );
          })}
        </div>
      </div>
      <label className="flex flex-col gap-2">
        <span className="text-label text-fg-2">Post-workout note</span>
        <Textarea value={note} onChange={(e) => setNote(e.currentTarget.value)} minRows={4} placeholder="Legs, fuelling, what you’d change next time…" aria-label="Post-workout note" />
      </label>
      <div className="flex flex-col gap-2">
        <span className="text-label text-fg-2">Tags</span>
        <TagInput value={a.tags} onValueChange={(tags) => void set({ tags })} aria-label="Tags" />
      </div>
      {a.plannedWorkout?.preNote && (
        <div className="border-t border-line-1 pt-4">
          <div className="mb-1 text-micro text-fg-3">Pre-workout note</div>
          <p className="text-body-sm whitespace-pre-wrap text-fg-2">{a.plannedWorkout.preNote}</p>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── skeleton ─────────────────────────────

function ActivitySkeleton() {
  return (
    <Page header={<PageHeader title={<Skeleton className="h-9 w-72" />} titleText="Activity" back={links.activities()} eyebrow={<Skeleton className="h-3 w-48" />} />}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-[108px]" radius="lg" />
            ))}
          </div>
          <Skeleton className="h-[220px]" radius="lg" />
        </div>
        <Skeleton className="h-[420px]" radius="lg" />
      </div>
      <Skeleton className="h-[480px]" radius="lg" />
    </Page>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <h2 className="text-title-2 text-fg-1">{children}</h2>
      {aside}
    </div>
  );
}
