/**
 * /activities — dense, sortable, infinitely scrolling table of every completed session, with URL
 * filters, a ticking totals strip, inline manual logging and FIT upload (drop anywhere).
 */
import { INTENSITY_CLASSES, INTENSITY_META, SPORT_META, type Activity, type IntensityClass, type LocalDate, type Sport } from '@cadence/core/domain';
import { addDays } from '@cadence/core/time';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { ArrowUp, FileUp, History, Plus, RotateCcw, Search, Star, TriangleAlert, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  complianceLabel,
  EmptyState,
  IntensityPips,
  KeyStar,
  Page,
  PageHeader,
  Section,
  Skeleton,
  SportGlyph,
  toast,
} from '@/ui';
import { Input } from '@/ui/Field';
import { PageItem } from '@/motion';
import { Ticker } from '@/motion/Ticker';
import { useIsMorphTarget, vt } from '@/motion/morph';
import { spring, tween } from '@/motion/tokens';
import { api, call } from '@/lib/api';
import { cn } from '@/lib/cn';
import { distanceParts, formatDayShort, formatDuration, formatNumber, monthShort, paceParts } from '@/lib/format';
import { useDebouncedCallback, useMediaQuery } from '@/lib/hooks';
import { useUnits } from '@/lib/units';
import { morphSourceProps } from '@/ui/domain/WorkoutCard';
import { links } from '@/shell/links';
import { uploadFit, useActivityList, type ListFilters } from './data';
import { FilterPopover, FilterSummary, activeOf } from '@/features/trends/shared';
import { ManualEntry } from './ManualEntry';

const route = getRouteApi('/_app/activities');

const SPORT_TABS: { value: Sport | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'bike', label: 'Ride' },
  { value: 'run', label: 'Run' },
  { value: 'swim', label: 'Swim' },
  { value: 'row', label: 'Row' },
  { value: 'strength', label: 'Strength' },
  { value: 'hike', label: 'Hike' },
  { value: 'walk', label: 'Walk' },
  { value: 'yoga', label: 'Yoga' },
];

type Preset = 'all' | '4w' | '3m' | '12m' | 'ytd';
const PRESETS: { value: Preset; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: '4w', label: 'Last 4 weeks' },
  { value: '3m', label: 'Last 3 months' },
  { value: '12m', label: 'Last 12 months' },
  { value: 'ytd', label: 'This year' },
];

export function useApiToday(): LocalDate | undefined {
  return useQuery({
    queryKey: ['act-today'],
    queryFn: async () => ((await call(api.today.$get())) as unknown as { date: LocalDate }).date,
    staleTime: 10 * 60_000,
  }).data;
}

function presetRange(p: Preset, today: LocalDate): { from?: LocalDate; to?: LocalDate } {
  if (p === 'all') return {};
  if (p === 'ytd') return { from: `${today.slice(0, 4)}-01-01`, to: today };
  return { from: addDays(today, p === '4w' ? -27 : p === '3m' ? -90 : -364), to: today };
}

export function ActivitiesPage() {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const today = useApiToday();
  const filters: ListFilters = { sport: search.sport, q: search.q, from: search.from, to: search.to, key: search.key || undefined, intensity: search.intensity };
  const q = useActivityList(filters);
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const totals = q.data?.pages[0]?.totals;
  const [logging, setLogging] = useState(false);
  const setSearch = (patch: Partial<typeof search>) => navigate({ search: (s) => ({ ...s, ...patch }), replace: true });
  const preset: Preset | 'custom' = !search.from && !search.to ? 'all' : today ? ((['4w', '3m', '12m', 'ytd'] as Preset[]).find((p) => { const r = presetRange(p, today); return r.from === search.from && r.to === search.to; }) ?? 'custom') : 'custom';
  const filtered = !!(search.sport || search.q || search.from || search.key || search.intensity);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragging = useFileDrop();
  const active = activeOf(
    search.q ? { key: 'q', label: `“${search.q}”`, icon: <Search />, onClear: () => setSearch({ q: undefined }) } : null,
    search.from || search.to ? { key: 'when', label: preset !== 'custom' && preset !== 'all' ? PRESETS.find((p) => p.value === preset)!.label : `${search.from ? formatDayShort(search.from) : '…'} – ${search.to ? formatDayShort(search.to) : '…'}`, onClear: () => setSearch({ from: undefined, to: undefined }) } : null,
    search.intensity ? { key: 'intensity', label: INTENSITY_META[search.intensity].label, icon: <IntensityPips intensity={search.intensity} />, onClear: () => setSearch({ intensity: undefined }) } : null,
    search.key ? { key: 'key', label: 'Key sessions only', icon: <Star />, onClear: () => setSearch({ key: undefined }) } : null,
  );

  return (
    <Page
      header={
        <PageHeader
          title="Activities"
          eyebrow={search.sport ? SPORT_META[search.sport].label : 'All sports'}
          actions={
            <>
              <Button size="sm" variant="secondary" icon={<FileUp />} onClick={() => fileRef.current?.click()}>
                <span className="max-sm:hidden">Upload FIT</span>
              </Button>
              <Button size="sm" variant={logging ? 'secondary' : 'primary'} icon={logging ? <X /> : <Plus />} onClick={() => setLogging((v) => !v)} aria-expanded={logging}>
                <span className="max-sm:hidden">{logging ? 'Close' : 'Log activity'}</span>
              </Button>
              <input ref={fileRef} type="file" accept=".fit,.zip" className="hidden" onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) void doUpload(f, navigate); e.currentTarget.value = ''; }} />
            </>
          }
        />
      }
    >
      <AnimatePresence initial={false}>
        {logging && (
          <motion.div key="log" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8, transition: tween('fast', 'in') }} transition={spring.smooth}>
            <ManualEntry today={today} onDone={() => setLogging(false)} />
          </motion.div>
        )}
      </AnimatePresence>
      <PageItem className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
          <SportTabs value={search.sport ?? 'all'} onChange={(v) => setSearch({ sport: v === 'all' ? undefined : v })} />
          <div className="flex min-w-0 flex-1 items-center gap-2 md:justify-end">
            <SearchBox value={search.q ?? ''} onChange={(v) => setSearch({ q: v || undefined })} />
            <FilterPopover
              active={active.length}
              groups={[
                {
                  id: 'when',
                  label: 'When',
                  value: preset === 'custom' ? 'all' : preset,
                  onChange: (p) => today && setSearch(p === 'all' ? { from: undefined, to: undefined } : presetRange(p as Preset, today)),
                  options: PRESETS.map((p) => ({ value: p.value, label: p.label })),
                },
                {
                  id: 'intensity',
                  label: 'Intensity',
                  value: search.intensity ?? 'any',
                  onChange: (v) => setSearch({ intensity: v === 'any' ? undefined : (v as IntensityClass) }),
                  options: [{ value: 'any', label: 'Any intensity' }, ...INTENSITY_CLASSES.map((c) => ({ value: c, label: INTENSITY_META[c].label, icon: <IntensityPips intensity={c} /> }))],
                },
                {
                  id: 'key',
                  label: 'Sessions',
                  value: search.key ? 'key' : 'all',
                  onChange: (v) => setSearch({ key: v === 'key' ? true : undefined }),
                  options: [
                    { value: 'all', label: 'All sessions' },
                    { value: 'key', label: 'Key sessions only', icon: <Star /> },
                  ],
                },
              ]}
            />
          </div>
        </div>
        {active.length > 0 && <FilterSummary items={active} />}
        <TotalsLine totals={totals} loading={q.isPending} />
      </PageItem>
      <Section stagger>
        {q.isPending ? (
          <ListSkeleton />
        ) : q.isError ? (
          <div className="flex items-center gap-3 rounded-lg bg-surface-1 p-4 text-body text-fg-1">
            <TriangleAlert className="size-4" /> Couldn’t load activities.
            <Button size="sm" icon={<RotateCcw />} onClick={() => q.refetch()}>Retry</Button>
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<History />}
            title={filtered ? 'Nothing matches these filters' : 'No activities yet'}
            action={filtered ? <Button onClick={() => navigate({ search: {}, replace: true })}>Clear filters</Button> : <Button icon={<Plus />} onClick={() => setLogging(true)}>Log activity</Button>}
          >
            {filtered ? 'Try another sport, a wider date range or a different search.' : 'Sync Garmin, drop a FIT file here, or log one by hand.'}
          </EmptyState>
        ) : (
          <ActivityTable items={items} fetching={q.isFetching && !q.isFetchingNextPage} />
        )}
        {q.hasNextPage && <Sentinel onVisible={() => !q.isFetchingNextPage && q.fetchNextPage()} loading={q.isFetchingNextPage} />}
      </Section>
      <AnimatePresence>
        {dragging && (
          <motion.div
            key="drop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={tween('fast')}
            className="pointer-events-none fixed inset-3 z-(--z-toast) grid place-items-center rounded-2xl border-2 border-dashed border-line-3 glass"
          >
            <div className="flex flex-col items-center gap-2">
              <FileUp className="size-6 text-fg-1" />
              <span className="text-title-3 text-fg-1">Drop a FIT file to upload</span>
              <span className="text-body-sm text-fg-2">.fit or a Garmin .zip export</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Page>
  );
}

// ───────────────────────────── upload ─────────────────────────────

async function doUpload(file: File, navigate: ReturnType<typeof useNavigate>) {
  const p = uploadFit(file);
  toast.promise(p, {
    loading: <>Uploading <b>{file.name}</b>…</>,
    success: (r) => (r.outcome === 'created' ? <>Uploaded <b>{r.activity?.title ?? file.name}</b></> : r.outcome === 'skipped' ? <>Already have this one{r.reason ? ` · ${r.reason}` : ''}</> : <>Updated <b>{r.activity?.title ?? file.name}</b></>),
    error: (e) => <>Couldn’t read <b>{file.name}</b>: {(e as Error).message}</>,
  });
  try {
    const r = await p;
    if (r.activityId && r.outcome !== 'skipped') void navigate(links.activity(r.activityId));
  } catch {
    /* toast shows it */
  }
}

function useFileDrop() {
  const [over, setOver] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    let depth = 0;
    const isFile = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const enter = (e: DragEvent) => {
      if (!isFile(e)) return;
      depth++;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!isFile(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    };
    const overFn = (e: DragEvent) => isFile(e) && e.preventDefault();
    const drop = (e: DragEvent) => {
      if (!isFile(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) void doUpload(f, navigate);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', overFn);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', overFn);
      window.removeEventListener('drop', drop);
    };
  }, [navigate]);
  return over;
}

// ───────────────────────────── filters ─────────────────────────────

function SportTabs({ value, onChange }: { value: Sport | 'all'; onChange: (v: Sport | 'all') => void }) {
  return (
    <div role="tablist" aria-label="Sport" className="-mx-4 flex shrink-0 items-center gap-1 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:-ml-3 md:px-0">
      {SPORT_TABS.map((t) => {
        const on = value === t.value;
        return (
          <button
            key={t.value}
            role="tab"
            type="button"
            aria-selected={on}
            onClick={() => onChange(t.value)}
            className={cn('relative flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-body-sm transition-colors duration-(--dur-fast)', on ? 'font-medium text-fg-1' : 'text-fg-3 hover:text-fg-1')}
          >
            {on && <motion.span layoutId="act-sport-pill" transition={spring.snappy} className="absolute inset-0 rounded-md bg-surface-2" />}
            <span className="relative flex items-center gap-1.5">
              {t.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const push = useDebouncedCallback(onChange, 250);
  return (
    <div className="min-w-0 flex-1 md:w-56 md:flex-none">
    <Input
      size="sm"
      value={v}
      onChange={(e) => {
        setV(e.currentTarget.value);
        push(e.currentTarget.value.trim());
      }}
      leading={<Search className="size-3.5" />}
      placeholder="Search titles, notes, tags"
      aria-label="Search activities"
    />
    </div>
  );
}

// ───────────────────────────── totals ─────────────────────────────

/** One quiet line: "443 activities · 429 h · 6,131 km · 24,799 load". */
function TotalsLine({ totals, loading }: { totals?: { count: number; movingSec: number; durationSec: number; distanceM: number; load: number }; loading: boolean }) {
  const units = useUnits();
  const km = units.system === 'imperial' ? 1609.344 : 1000;
  if (loading) return <Skeleton className="h-5 w-72" />;
  const h = (totals?.movingSec || totals?.durationSec || 0) / 3600;
  const parts: { value: number; format: (n: number) => string; unit: string }[] = [
    { value: totals?.count ?? 0, format: (n) => formatNumber(n, 0), unit: (totals?.count ?? 0) === 1 ? 'activity' : 'activities' },
    { value: h, format: (n) => formatNumber(n, n < 100 ? 1 : 0), unit: 'h' },
    { value: (totals?.distanceM ?? 0) / km, format: (n) => formatNumber(n, 0), unit: units.system === 'imperial' ? 'mi' : 'km' },
    { value: totals?.load ?? 0, format: (n) => formatNumber(n, 0), unit: 'load' },
  ];
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 text-body text-fg-2" aria-label="Totals">
      {parts.map((p, i) => (
        <span key={p.unit} className="inline-flex items-baseline gap-1">
          {i > 0 && <span className="mr-1 text-fg-4" aria-hidden>·</span>}
          <span className="text-fg-1"><Ticker value={p.value} format={p.format} /></span>
          <span className="text-fg-3">{p.unit}</span>
        </span>
      ))}
    </p>
  );
}

// ───────────────────────────── table ─────────────────────────────

type SortKey = 'date' | 'title' | 'dur' | 'dist' | 'load' | 'int';
/** Six columns: date · sport + title · time · distance · load · effort (intensity). HR, power/pace,
 *  compliance and the effort profile are on the activity page (and in each row's tooltip). */
const COLS = 'grid-cols-[6.5rem_minmax(12rem,1fr)_5rem_6rem_4.5rem_5.5rem]';

function ActivityTable({ items, fetching }: { items: Activity[]; fetching: boolean }) {
  const wide = useMediaQuery('(min-width: 1024px)');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });
  const rows = useMemo(() => {
    if (sort.key === 'date' && sort.dir === 'desc') return items;
    const v = (a: Activity): string | number | null => {
      switch (sort.key) {
        case 'date': return a.startedAt;
        case 'title': return a.title.toLowerCase();
        case 'dur': return a.movingSec || a.durationSec;
        case 'dist': return a.distanceM ?? null;
        case 'load': return a.load;
        case 'int': return INTENSITY_META[a.intensity].level;
      }
    };
    return [...items].sort((x, y) => {
      const a = v(x);
      const b = v(y);
      if (a == null) return 1;
      if (b == null) return -1;
      const r = a < b ? -1 : a > b ? 1 : 0;
      return sort.dir === 'asc' ? r : -r;
    });
  }, [items, sort]);
  if (!wide) return <CardList items={rows} />;
  const head = (key: SortKey, label: string, right = false) => {
    const on = sort.key === key;
    return (
      <button
        type="button"
        onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))}
        aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
        className={cn('flex items-center gap-1 whitespace-nowrap transition-colors hover:text-fg-1', right && 'flex-row-reverse justify-self-end', on && 'text-fg-1')}
      >
        {label}
        <motion.span initial={false} animate={{ rotate: on && sort.dir === 'asc' ? 0 : 180, opacity: on ? 1 : 0 }} transition={spring.snappy} className="inline-flex">
          <ArrowUp className="size-3" strokeWidth={2} />
        </motion.span>
      </button>
    );
  };
  return (
    <div role="table" aria-label="Activities" className={cn('transition-opacity duration-(--dur-base)', fetching && 'opacity-70')}>
      <div role="row" className={cn('sticky top-(--header-h) z-(--z-sticky) -mx-3 grid h-10 items-center gap-x-4 border-b border-line-1 bg-canvas px-3 text-label font-medium text-fg-3', COLS)}>
        {head('date', 'Date')}
        {head('title', 'Activity')}
        {head('dur', 'Time', true)}
        {head('dist', 'Distance', true)}
        {head('load', 'Load', true)}
        {head('int', 'Intensity', true)}
      </div>
      {rows.map((a, i) => (
        <Row key={a.id} a={a} prevMonth={i > 0 && sort.key === 'date' ? rows[i - 1].localDate.slice(0, 7) : null} />
      ))}
    </div>
  );
}

function outText(a: Activity, units: ReturnType<typeof useUnits>): string | null {
  if (a.sport === 'bike' || (a.sport === 'row' && a.avgPower && !a.avgSpeedMps)) {
    const w = a.weightedPower ?? a.avgPower;
    return w ? `${formatNumber(w, 0)} W` : null;
  }
  if (a.avgSpeedMps && SPORT_META[a.sport].hasDistance) {
    const p = paceParts(a.avgSpeedMps, a.sport, units);
    return `${p.value} ${p.unit}`;
  }
  return null;
}

function Row({ a, prevMonth }: { a: Activity; prevMonth: string | null }) {
  const units = useUnits();
  const on = useIsMorphTarget(a.id);
  const d = a.distanceM ? distanceParts(a.distanceM, a.sport, units) : null;
  const month = a.localDate.slice(0, 7);
  const out = outText(a, units);
  const tip = [a.avgHr ? `Avg HR ${a.avgHr} bpm` : null, out, a.compliance && a.compliance.state !== 'unplanned' ? complianceLabel(a.compliance.state) : null, a.postNote ? 'Has a note' : null].filter(Boolean).join(' · ');
  return (
    <>
      {prevMonth !== null && prevMonth !== month && (
        <div className="-mx-3 border-b border-line-1 px-3 pt-8 pb-2 text-body-sm font-medium text-fg-2">
          {monthShort(a.localDate)} {a.localDate.slice(0, 4)}
        </div>
      )}
      <Link
        {...links.activity(a.id)}
        {...morphSourceProps(a.id)}
        role="row"
        title={tip || undefined}
        style={vt(on, 'card')}
        className={cn('group relative -mx-3 grid h-11 items-center gap-x-4 rounded-md border-b border-line-1 px-3 text-body outline-none transition-colors duration-(--dur-fast) hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus', COLS)}
      >
        <span className="text-fg-3">{formatDayShort(a.localDate)} {monthShort(a.localDate)}</span>
        <span className="flex min-w-0 items-center gap-2.5">
          <SportGlyph sport={a.sport} subSport={a.subSport} size={16} style={vt(on, 'glyph')} className="shrink-0 text-fg-2" />
          <span className={cn('truncate text-fg-1', a.isKey && 'font-medium')} style={vt(on, 'title')}>{a.title}</span>
          {a.isKey && <KeyStar pressed readOnly size="sm" />}
        </span>
        <span className="text-right text-fg-1">{formatDuration(a.movingSec || a.durationSec)}</span>
        <span className="text-right text-fg-2">{d ? <>{d.value}<span className="text-fg-3"> {d.unit}</span></> : <span className="text-fg-4">—</span>}</span>
        <span className="text-right text-fg-1">{formatNumber(a.load, 0)}</span>
        <span className="flex justify-end" aria-label={INTENSITY_META[a.intensity].label}><IntensityPips intensity={a.intensity} /></span>
      </Link>
    </>
  );
}

function CardList({ items }: { items: Activity[] }) {
  const units = useUnits();
  return (
    <div className="flex flex-col gap-2">
      {items.map((a) => (
        <MobileCard key={a.id} a={a} units={units} />
      ))}
    </div>
  );
}

function MobileCard({ a, units }: { a: Activity; units: ReturnType<typeof useUnits> }) {
  const on = useIsMorphTarget(a.id);
  const d = a.distanceM ? distanceParts(a.distanceM, a.sport, units) : null;
  return (
    <Link {...links.activity(a.id)} {...morphSourceProps(a.id)} style={vt(on, 'card')} className="flex flex-col gap-1 rounded-lg bg-surface-1 px-4 py-3 outline-none active:bg-surface-2 focus-visible:outline-2 focus-visible:outline-focus">
      <div className="flex items-center gap-2">
        <SportGlyph sport={a.sport} subSport={a.subSport} size={16} style={vt(on, 'glyph')} />
        <span className={cn('min-w-0 flex-1 truncate text-body text-fg-1', a.isKey && 'font-medium')} style={vt(on, 'title')}>{a.title}</span>
        {a.isKey && <KeyStar pressed readOnly size="sm" />}
      </div>
      <div className="flex items-end gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 text-body-sm text-fg-3">
          <span>{formatDayShort(a.localDate)} {monthShort(a.localDate)}</span>
          <span>·</span>
          <span className="text-fg-2">{formatDuration(a.movingSec || a.durationSec)}</span>
          {d && <><span>·</span><span>{d.value} {d.unit}</span></>}
          <span>·</span>
          <span>{formatNumber(a.load, 0)} load</span>
        </div>
        <IntensityPips intensity={a.intensity} />
      </div>
    </Link>
  );
}

function Sentinel({ onVisible, loading }: { onVisible: () => void; loading: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onVisible);
  cb.current = onVisible;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && cb.current(), { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className="flex h-16 items-center justify-center text-body-sm text-fg-3">
      {loading ? 'Loading more…' : ''}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col" aria-busy>
      <div className="h-10 border-b border-line-1" />
      {Array.from({ length: 12 }, (_, i) => (
        <div key={i} className="flex h-11 items-center gap-4 border-b border-line-1">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="size-4" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-40" />
        </div>
      ))}
    </div>
  );
}

