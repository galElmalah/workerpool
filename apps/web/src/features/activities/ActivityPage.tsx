/**
 * /activities/$id — the completed-activity analysis page (product.md §5). One scrolling page with
 * a sticky section nav whose active pill slides; header is the morph target for calendar cards.
 */
import { INTENSITY_META, SPORT_META, type ActivityDetail, type IntensityClass, type Sport } from '@cadence/core/domain';
import { rpeLoad } from '@cadence/core/metrics';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, ArrowRight, Download, FileDown, Info, MapPin, MoreHorizontal, RotateCcw, SearchX, Trash2, TriangleAlert, Unlink, Upload as UploadIcon, Watch, PencilLine } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Button,
  ButtonLink,
  ComplianceBar,
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
  StatRow,
  StatTile,
  TagInput,
  Textarea,
  toast,
  Tooltip,
  useAutosave,
  type MenuEntry,
} from '@/ui';
import { PageItem } from '@/motion';
import { spring } from '@/motion/tokens';
import { cn } from '@/lib/cn';
import { formatDateLong, formatInstantTime } from '@/lib/format';
import { qk } from '@/lib/query';
import { useUnits } from '@/lib/units';
import { usePatchActivity } from '@/lib/queries/training';
import { links } from '@/shell/links';
import { useActivity, useDeleteActivity, usePairing, useRestoreActivity, useStreams } from './data';
import { deltaOf, heroStats, type Stat } from './stats';
import { hasPeaks, lapsTitle, LapsSection, PeaksSection, StreamsSection, ZonesSection } from './Analysis';
import { PlanSection, PreviousSection } from './Context';
import { FiguresSection } from './figures';
import { SPORT_TEXT } from './fmt';
import { hasRoute, MapSection, MapSkeleton } from './MapSection';
import { ActivitySyncProvider } from './sync';

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

type NavId = 'overview' | 'map' | 'figures' | 'charts' | 'laps' | 'zones' | 'peaks' | 'plan' | 'notes';

const INDOOR = new Set(['indoor', 'virtual', 'treadmill', 'pool', 'erg']);

/**
 * Hero (title, sport, when, where + 4–6 headline figures and the plan line), then everything else
 * openly, in this order: map (outdoor) · all figures (grouped definition lists) · the synchronized
 * chart stack · laps · time in zones · peaks · plan vs actual · how it felt · compared with last
 * time. A sticky section nav scroll-spies the sections. Map, charts and laps share one cursor and
 * selection (`ActivitySyncProvider`).
 */
function ActivityView({ a }: { a: ActivityDetail }) {
  return (
    <ActivitySyncProvider>
      <ActivityBody a={a} />
    </ActivitySyncProvider>
  );
}

function ActivityBody({ a }: { a: ActivityDetail }) {
  const units = useUnits();
  const patch = usePatchActivity();
  const set = (p: Parameters<typeof patch.mutate>[0]['patch']) => patch.mutateAsync({ id: a.id, patch: p });
  const [rpe, setRpe] = useState<number | null>(a.rpe ?? null);
  useEffect(() => setRpe(a.rpe ?? null), [a.rpe]);
  const liveLoad = a.loadSource === 'rpe' && rpe ? rpeLoad(rpe, a.durationSec) : undefined;
  const hero = useMemo(() => heroStats(a, units, liveLoad), [a, units, liveLoad]);
  const sq = useStreams(a.id, a.hasStreams);
  const streams = sq.data;
  const likelyOutdoor = a.hasStreams && (a.facts?.startLat != null || !!a.locationName || (SPORT_META[a.sport].hasDistance && !INDOOR.has(a.subSport ?? '')));
  const showMap = !!streams && hasRoute(streams);
  const mapPending = !streams && sq.isPending && likelyOutdoor;
  const zones = !!(a.zones.hr?.some((z) => z.seconds > 0) || a.zones.power?.some((z) => z.seconds > 0) || a.zones.pace?.some((z) => z.seconds > 0));
  const laps = a.laps.length > 1 || !!a.strengthSets?.length;
  const nav: { id: NavId; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    ...(showMap || mapPending ? [{ id: 'map' as const, label: 'Map' }] : []),
    { id: 'figures', label: 'Figures' },
    ...(a.hasStreams ? [{ id: 'charts' as const, label: 'Charts' }] : []),
    ...(laps ? [{ id: 'laps' as const, label: lapsTitle(a) === 'Laps' ? 'Laps' : lapsTitle(a) }] : []),
    ...(zones ? [{ id: 'zones' as const, label: 'Zones' }] : []),
    ...(hasPeaks(a) ? [{ id: 'peaks' as const, label: 'Peaks' }] : []),
    { id: 'plan', label: 'Plan' },
    { id: 'notes', label: 'Notes' },
  ];
  const empty = a.rpe == null && !a.postNote && a.feel == null;
  const cols = hero.length >= 6 ? 'lg:grid-cols-6' : hero.length === 5 ? 'lg:grid-cols-5' : 'lg:grid-cols-4';

  return (
    <Page
      header={
        <PageHeader
          morph
          back={links.activities()}
          breadcrumb={[{ label: 'Activities', link: links.activities() }]}
          glyph={<SportGlyph sport={a.sport} subSport={a.subSport} size={32} className={SPORT_TEXT[a.sport]} />}
          eyebrow={
            <span className="flex flex-wrap items-center gap-x-2">
              <span>{formatDateLong(a.localDate, true)}</span>
              <span className="text-fg-4">·</span>
              <span>{formatInstantTime(a.startedAt, a.utcOffsetMin)}</span>
              <span className="text-fg-4">·</span>
              <span>{SPORT_META[a.sport].label}{a.subSport && a.subSport !== 'generic' ? ` · ${a.subSport.replace('_', ' ')}` : ''}</span>
              {a.locationName && (
                <>
                  <span className="text-fg-4">·</span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3.5 text-fg-3" aria-hidden />
                    {a.locationName}
                  </span>
                </>
              )}
            </span>
          }
          titleText={a.title}
          title={<InlineEdit className="[&>button]:!w-auto" variant="title" value={a.title} onSave={(t) => set({ title: t })} aria-label="Activity title" />}
          meta={<HeaderMeta a={a} set={set} />}
          actions={<ActionsMenu a={a} set={set} />}
        />
      }
    >
      <SectionNav items={nav} />
      <Section id="overview" className="-mt-4 md:-mt-6">
        <div className="flex flex-col gap-8">
          <div className={cn('grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 md:gap-x-8', cols)}>
            {hero.map((s) => (
              <HeroStat key={s.key} s={s} hasPrev={!!a.previousSimilar} />
            ))}
          </div>
          <PlanLine a={a} />
          {empty && (
            <button type="button" onClick={() => document.getElementById('notes')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="group inline-flex w-fit items-center gap-1.5 text-body text-fg-2 transition-colors hover:text-fg-1">
              <PencilLine className="size-4 text-fg-3" aria-hidden /> How did it feel? Add RPE and a note
            </button>
          )}
        </div>
      </Section>
      {showMap ? <MapSection a={a} streams={streams!} /> : mapPending ? <MapSkeleton /> : null}
      <FiguresSection a={a} />
      {a.hasStreams && <StreamsSection a={a} streams={streams} loading={sq.isPending} error={sq.isError} onRetry={() => sq.refetch()} />}
      {laps && <LapsSection a={a} />}
      {zones && <ZonesSection a={a} />}
      {hasPeaks(a) && <PeaksSection a={a} />}
      <PlanSection a={a} />
      <NotesSection a={a} rpe={rpe} setRpe={setRpe} set={set} />
      {a.previousSimilar && <PreviousSection a={a} />}
    </Page>
  );
}

// ───────────────────────────── header bits ─────────────────────────────

type Setter = (p: Parameters<ReturnType<typeof usePatchActivity>['mutate']>[0]['patch']) => Promise<unknown>;

/** Quiet meta row: source · key toggle · intensity (popover). No outlined pills. */
function HeaderMeta({ a, set }: { a: ActivityDetail; set: Setter }) {
  const overridden = !!a.intensityOverride;
  return (
    <>
      <span className="inline-flex items-center gap-1.5 text-body-sm text-fg-3 [&_svg]:size-3.5">
        {a.source === 'manual' ? <PencilLine /> : a.source === 'upload' ? <UploadIcon /> : <Watch />}
        {SOURCE_LABEL[a.source]}
      </span>
      <span className="text-fg-4" aria-hidden>·</span>
      <span className="inline-flex items-center gap-1.5">
        <KeyStar pressed={a.isKey} onPressedChange={(v) => void set({ isKey: v })} />
        <span className={cn('text-body-sm', a.isKey ? 'font-medium text-fg-1' : 'text-fg-3')}>{a.isKey ? 'Key session' : 'Mark key'}</span>
      </span>
      <span className="text-fg-4" aria-hidden>·</span>
      <Popover
        title="Intensity"
        trigger={
          <button type="button" className="-mx-1.5 flex h-7 items-center gap-2 rounded-md px-1.5 transition-colors duration-(--dur-fast) hover:bg-surface-2" aria-label="Change intensity">
            <IntensityPips intensity={a.intensity} size="md" />
            <span className="text-body-sm text-fg-1">{INTENSITY_META[a.intensity].label}</span>
            <span className="text-body-sm text-fg-3">{overridden ? 'set by you' : 'auto'}</span>
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
              <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={() => { void set({ intensityOverride: null }); close(); }}>
                Back to auto
              </Button>
            )}
          </div>
        )}
      </Popover>
    </>
  );
}

/** "On plan · 107% of planned load · Long ride 2h05 (planned Sat 21) →" + one thin bar. */
function PlanLine({ a }: { a: ActivityDetail }) {
  const w = a.plannedWorkout;
  const c = a.compliance;
  if (!w || !c) return null;
  const ratios = [
    { label: 'Duration', planned: w.plannedDurationSec, actual: a.movingSec || a.durationSec },
    { label: 'Distance', planned: w.plannedDistanceM, actual: a.distanceM },
    { label: 'Load', planned: w.plannedLoad, actual: a.load },
  ].filter((r) => r.planned && r.actual != null);
  const tip = ratios.map((r) => `${r.label} ${Math.round((r.actual! / r.planned!) * 100)}%`).join(' · ');
  return (
    <div className="flex max-w-xl flex-col gap-2">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body text-fg-2" title={tip}>
        <ComplianceGlyph state={c.state} size={14} />
        <span className="font-medium text-fg-1">{complianceLabel(c.state)}</span>
        <span>
          · {Math.round(c.ratio * 100)}% of planned {c.metric}
        </span>
        <span>·</span>
        <Link {...links.workout(w.id)} className="group inline-flex min-w-0 items-center gap-1 text-fg-2 underline decoration-line-3 underline-offset-3 transition-colors hover:text-fg-1 hover:decoration-fg-1">
          <span className="truncate">{w.title}</span>
          <ArrowRight className="size-3.5 shrink-0 transition-transform duration-(--dur-fast) group-hover:translate-x-0.5" aria-hidden />
        </Link>
      </p>
      <ComplianceBar ratio={c.ratio} state={c.state} />
    </div>
  );
}

function HeroStat({ s, hasPrev }: { s: Stat; hasPrev: boolean }) {
  const d = hasPrev ? deltaOf(s) : undefined;
  return (
    <StatTile
      label={<StatLabel s={s} />}
      value={s.value}
      format={s.format}
      unit={s.unit}
      delta={s.sub ? undefined : d}
      good={d != null && !!s.perf && (s.lowerBetter ? d < 0 : d > 0)}
      deltaSuffix={s.sub || d === undefined ? undefined : 'vs last time'}
      hint={s.sub}
    />
  );
}

const SPORT_CHOICES: Sport[] = ['bike', 'run', 'swim', 'row', 'strength', 'hike', 'walk', 'yoga', 'ski', 'other'];

function ActionsMenu({ a, set }: { a: ActivityDetail; set: Setter }) {
  const del = useDeleteActivity();
  const restore = useRestoreActivity();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { pair, unpair } = usePairing(a.id);
  const w = a.plannedWorkout;
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
    ...(w
      ? [
          {
            label: 'Unpair from planned workout',
            icon: <Unlink />,
            onSelect: async () => {
              await unpair.mutateAsync(w.id);
              toast.undo(<>Unpaired from <b>{w.title}</b></>, () => pair.mutate(w.id));
            },
          },
        ]
      : []),
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

/** Sticky pill nav: each item scrolls to its section; scroll-spy keeps the pill in sync. */
function SectionNav({ items }: { items: readonly { id: NavId; label: string }[] }) {
  const [active, setActive] = useState<NavId>('overview');
  const lock = useRef(0);
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const onScroll = () => {
      if (Date.now() < lock.current) return;
      const y = 180;
      let cur: NavId = items[0]?.id ?? 'overview';
      for (const i of items) {
        const el = document.getElementById(i.id);
        if (el && el.getBoundingClientRect().top - y <= 0) cur = i.id;
      }
      // at the very bottom the last short sections can never reach the top: pick the last visible
      const doc = document.scrollingElement;
      if (doc && doc.scrollTop + doc.clientHeight >= doc.scrollHeight - 4) {
        const last = [...items].reverse().find((i) => {
          const el = document.getElementById(i.id);
          return el && el.getBoundingClientRect().top < window.innerHeight * 0.6;
        });
        if (last) cur = last.id;
      }
      setActive(cur);
    };
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll, { capture: true });
  }, [items]);
  useEffect(() => {
    navRef.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);
  const go = (id: NavId) => {
    setActive(id);
    lock.current = Date.now() + 900;
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  return (
    <PageItem className="sticky top-(--header-h) z-(--z-sticky) -mx-4 -mt-6 bg-canvas/85 px-4 backdrop-blur-md md:-mx-6 md:-mt-8 md:px-6 xl:-mx-12 xl:px-12">
      <nav ref={navRef} aria-label="Sections" className="-ml-3 flex h-12 items-center gap-1 overflow-x-auto [scrollbar-width:none] max-md:ml-0">
        {items.map((i) => (
          <button
            key={i.id}
            type="button"
            aria-current={active === i.id ? 'true' : undefined}
            onClick={() => go(i.id)}
            className={cn('relative z-0 h-8 shrink-0 rounded-md px-3 text-body-sm transition-colors duration-(--dur-fast)', active === i.id ? 'font-medium text-fg-1' : 'text-fg-3 hover:text-fg-1')}
          >
            {active === i.id && <motion.span layoutId="act-section-pill" transition={spring.snappy} className="absolute inset-0 -z-10 rounded-md bg-surface-2" />}
            {i.label}
          </button>
        ))}
      </nav>
    </PageItem>
  );
}

function StatLabel({ s }: { s: Stat }) {
  if (!s.tip) return <span className="truncate">{s.label}</span>;
  return (
    <Tooltip content={<span className="block max-w-64">{s.tip}</span>}>
      <span tabIndex={0} className="flex w-fit cursor-help items-center gap-1 truncate rounded-xs outline-none hover:text-fg-2 focus-visible:outline-2 focus-visible:outline-focus">
        {s.label}
        <Info className="size-3 opacity-60" aria-hidden />
      </span>
    </Tooltip>
  );
}

// ───────────────────────────── how it felt ─────────────────────────────

const FEEL = ['Awful', 'Bad', 'OK', 'Good', 'Great'];

function NotesSection({ a, rpe, setRpe, set }: { a: ActivityDetail; rpe: number | null; setRpe: (n: number) => void; set: Setter }) {
  const [note, setNote] = useState(a.postNote ?? '');
  const noteStatus = useAutosave(note, (v) => set({ postNote: v || null }), { delay: 700 });
  const empty = a.rpe == null && !a.postNote && a.feel == null;
  return (
    <Section id="notes" title={empty ? 'How did it feel?' : 'How it felt'} actions={<SaveIndicator status={noteStatus} />} stagger={false}>
      <div className="grid gap-x-12 gap-y-8 lg:grid-cols-2">
        <div className="flex flex-col gap-8">
          <RpeSlider value={rpe} onValueChange={setRpe} onValueCommitted={(v) => void set({ rpe: v })} />
          <div className="flex flex-col gap-2">
            <span className="text-body-sm text-fg-3">Feel</span>
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
                    className={cn('flex h-12 flex-col items-center justify-center gap-1 rounded-md text-label transition-colors duration-(--dur-fast)', on ? 'bg-surface-3 text-fg-1' : 'bg-surface-1 text-fg-3 hover:bg-surface-2 hover:text-fg-1')}
                  >
                    <span className="flex gap-0.5" aria-hidden>
                      {Array.from({ length: 5 }, (_, k) => (
                        <span key={k} className={cn('size-1 rounded-full', k <= i ? (on ? 'bg-fg-1' : 'bg-fg-3') : 'bg-surface-3')} />
                      ))}
                    </span>
                    {f}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-body-sm text-fg-3">Tags</span>
            <TagInput value={a.tags} onValueChange={(tags) => void set({ tags })} aria-label="Tags" />
          </div>
        </div>
        <div className="flex flex-col gap-6">
          <label className="flex flex-col gap-2">
            <span className="text-body-sm text-fg-3">Post-workout note</span>
            <Textarea value={note} onChange={(e) => setNote(e.currentTarget.value)} minRows={5} placeholder="Legs, fuelling, what you’d change next time…" aria-label="Post-workout note" />
          </label>
          {a.plannedWorkout?.preNote && (
            <div>
              <div className="mb-1 text-body-sm text-fg-3">Pre-workout note</div>
              <p className="text-body whitespace-pre-wrap text-fg-2">{a.plannedWorkout.preNote}</p>
            </div>
          )}
          {a.plannedWorkout?.description && (
            <div>
              <div className="mb-1 text-body-sm text-fg-3">Purpose of the planned session</div>
              <p className="text-body whitespace-pre-wrap text-fg-2">{a.plannedWorkout.description}</p>
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

// ───────────────────────────── skeleton ─────────────────────────────

function ActivitySkeleton() {
  return (
    <Page header={<PageHeader title={<Skeleton className="h-9 w-72" />} titleText="Activity" back={links.activities()} eyebrow={<Skeleton className="h-3 w-48" />} />}>
      <StatRow columns={4}>
        {Array.from({ length: 4 }, (_, i) => (
          <StatTile.Skeleton key={i} />
        ))}
      </StatRow>
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
