/**
 * /activities — dense, sortable, infinitely scrolling table of every completed session, with URL
 * filters, a ticking totals strip, inline manual logging and FIT upload (drop anywhere).
 */
import { INTENSITY_CLASSES, INTENSITY_META, SPORT_META, type Activity, type IntensityClass, type LocalDate, type Sport } from '@cadence/core/domain';
import { addDays } from '@cadence/core/time';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { ArrowUp, FileUp, History, Pilcrow, Plus, RotateCcw, Search, Star, TriangleAlert, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  ComplianceGlyph,
  EmptyState,
  IntensityPips,
  KeyStar,
  MiniProfile,
  Page,
  PageHeader,
  Section,
  Segmented,
  Select,
  Skeleton,
  SportGlyph,
  toast,
} from '@/ui';
import { Input } from '@/ui/Field';
import { PageItem } from '@/motion';
import { Ticker } from '@/motion/Ticker';
import { useIsMorphTarget, vt } from '@/motion/morph';
import { onSpotlightMove } from '@/motion/pointer';
import { spring, tween } from '@/motion/tokens';
import { api, call } from '@/lib/api';
import { cn } from '@/lib/cn';
import { distanceParts, formatDayShort, formatDuration, formatNumber, monthShort, paceParts } from '@/lib/format';
import { useDebouncedCallback, useMediaQuery } from '@/lib/hooks';
import { useUnits } from '@/lib/units';
import { morphSourceProps } from '@/ui/domain/WorkoutCard';
import { links } from '@/shell/links';
import { uploadFit, useActivityList, type ListFilters } from './data';
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
      <PageItem className="flex flex-col gap-3">
        <SportTabs value={search.sport ?? 'all'} onChange={(v) => setSearch({ sport: v === 'all' ? undefined : v })} />
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox value={search.q ?? ''} onChange={(v) => setSearch({ q: v || undefined })} />
          <button
            type="button"
            aria-pressed={!!search.key}
            onClick={() => setSearch({ key: search.key ? undefined : true })}
            className={cn('flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-label transition-colors duration-(--dur-fast)', search.key ? 'border-accent-a5 bg-accent-a1 text-accent-ink' : 'border-line-2 text-fg-2 hover:bg-surface-2 hover:text-fg-1')}
          >
            <Star className={cn('size-3.5', search.key && 'fill-current')} /> Key only
          </button>
          <Select
            size="sm"
            hideLabel
            label="Intensity"
            value={search.intensity ?? 'any'}
            onValueChange={(v) => setSearch({ intensity: v === 'any' ? undefined : (v as IntensityClass) })}
            options={[{ value: 'any', label: 'Any intensity' }, ...INTENSITY_CLASSES.map((c) => ({ value: c, label: INTENSITY_META[c].label, icon: <IntensityPips intensity={c} /> }))]}
            className="w-44"
          />
          <Segmented
            size="sm"
            aria-label="Date range"
            value={preset === 'custom' ? 'all' : preset}
            onValueChange={(p: Preset) => today && setSearch(p === 'all' ? { from: undefined, to: undefined } : presetRange(p, today))}
            options={[
              { value: 'all', label: 'All time' },
              { value: '4w', label: '4W' },
              { value: '3m', label: '3M' },
              { value: '12m', label: '12M' },
              { value: 'ytd', label: 'YTD' },
            ]}
          />
          {filtered && (
            <Button size="sm" variant="ghost" icon={<X />} onClick={() => navigate({ search: {}, replace: true })}>
              Clear
            </Button>
          )}
        </div>
      </PageItem>
      <PageItem>
        <TotalsStrip totals={totals} loading={q.isPending} />
      </PageItem>
      <Section stagger>
        {q.isPending ? (
          <ListSkeleton />
        ) : q.isError ? (
          <div className="flex items-center gap-3 rounded-lg border border-dashed border-line-3 p-4 text-body text-fg-1">
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
            className="pointer-events-none fixed inset-3 z-(--z-toast) grid place-items-center rounded-2xl border-2 border-dashed border-accent-a6 bg-accent-a1 glass"
          >
            <div className="flex flex-col items-center gap-2">
              <FileUp className="size-6 text-accent-ink" />
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
    <div role="tablist" aria-label="Sport" className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 [scrollbar-width:none]">
      {SPORT_TABS.map((t) => {
        const on = value === t.value;
        return (
          <button
            key={t.value}
            role="tab"
            type="button"
            aria-selected={on}
            onClick={() => onChange(t.value)}
            className={cn('relative flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-label transition-colors duration-(--dur-fast)', on ? 'text-fg-1' : 'text-fg-3 hover:text-fg-1')}
          >
            {on && <motion.span layoutId="act-sport-pill" transition={spring.snappy} className="absolute inset-0 rounded-md border border-line-3 bg-surface-2" />}
            <span className="relative flex items-center gap-1.5">
              {t.value !== 'all' && <SportGlyph sport={t.value} size={14} />}
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
    <div className="w-full sm:w-64">
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

function TotalsStrip({ totals, loading }: { totals?: { count: number; movingSec: number; durationSec: number; distanceM: number; load: number }; loading: boolean }) {
  const units = useUnits();
  const km = units.system === 'imperial' ? 1609.344 : 1000;
  const cells: { label: string; value: number; format: (n: number) => string; unit?: string; accent?: boolean }[] = [
    { label: 'Activities', value: totals?.count ?? 0, format: (n) => formatNumber(n, 0) },
    { label: 'Time', value: (totals?.movingSec || totals?.durationSec || 0) / 3600, format: (n) => formatNumber(n, n < 100 ? 1 : 0), unit: 'h' },
    { label: 'Distance', value: (totals?.distanceM ?? 0) / km, format: (n) => formatNumber(n, 0), unit: units.system === 'imperial' ? 'mi' : 'km' },
    { label: 'Load', value: totals?.load ?? 0, format: (n) => formatNumber(n, 0), accent: true },
  ];
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-line-2 bg-surface-1 md:grid-cols-4">
      {cells.map((c) => (
        <div key={c.label} className="-mr-px -mb-px flex flex-col gap-1 border-r border-b border-line-1 px-4 py-3">
          <span className="text-micro uppercase text-fg-3">{c.label}</span>
          {loading ? (
            <Skeleton className="h-8 w-24" />
          ) : (
            <span className={cn('flex items-baseline gap-1 text-stat-md', c.accent ? 'text-accent-ink' : 'text-fg-1')}>
              <Ticker value={c.value} format={c.format} />
              {c.unit && <span className="text-[1.1rem] font-[450] tracking-normal text-fg-3">{c.unit}</span>}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ───────────────────────────── table ─────────────────────────────

type SortKey = 'date' | 'title' | 'dur' | 'dist' | 'load' | 'int' | 'hr' | 'out';
const COLS = 'grid-cols-[5.5rem_1.5rem_minmax(12rem,1fr)_4.5rem_5rem_3.5rem_3.5rem_3.5rem_6.75rem_1.25rem_4.5rem]';

function outputOf(a: Activity) {
  if (a.sport === 'bike' || (a.sport === 'row' && a.avgPower)) return a.weightedPower ?? a.avgPower ?? null;
  return a.avgSpeedMps ? -1 / a.avgSpeedMps : null; // pace: faster sorts higher
}

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
        case 'hr': return a.avgHr ?? null;
        case 'out': return outputOf(a);
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
        className={cn('flex items-center gap-1 whitespace-nowrap uppercase transition-colors hover:text-fg-1', right && 'flex-row-reverse justify-self-end', on && 'text-fg-1')}
      >
        {label}
        <motion.span initial={false} animate={{ rotate: on && sort.dir === 'asc' ? 0 : 180, opacity: on ? 1 : 0.3 }} transition={spring.snappy} className="inline-flex">
          <ArrowUp className="size-3" strokeWidth={2} />
        </motion.span>
      </button>
    );
  };
  return (
    <div role="table" aria-label="Activities" className={cn('rounded-lg border border-line-2 bg-surface-1 transition-opacity duration-(--dur-base)', fetching && 'opacity-70')}>
      <div role="row" className={cn('sticky top-(--header-h) z-(--z-sticky) grid h-9 items-center gap-x-3 rounded-t-lg border-b border-line-1 bg-surface-1 px-4 text-micro font-[600] uppercase text-fg-3', COLS)}>
        {head('date', 'Date')}
        <span />
        {head('title', 'Title')}
        {head('dur', 'Time', true)}
        {head('dist', 'Dist', true)}
        {head('load', 'Load', true)}
        {head('int', 'Int', true)}
        {head('hr', 'HR', true)}
        {head('out', 'Power / pace', true)}
        <span />
        <span className="justify-self-end">Effort</span>
      </div>
      {rows.map((a, i) => (
        <Row key={a.id} a={a} prevMonth={i > 0 && sort.key === 'date' ? rows[i - 1].localDate.slice(0, 7) : null} />
      ))}
    </div>
  );
}

function Out({ a }: { a: Activity }) {
  const units = useUnits();
  if (a.sport === 'bike' || (a.sport === 'row' && a.avgPower && !a.avgSpeedMps)) {
    const w = a.weightedPower ?? a.avgPower;
    return w ? <>{formatNumber(w, 0)}<span className="text-fg-3"> W</span></> : <span className="text-fg-4">—</span>;
  }
  if (a.avgSpeedMps && SPORT_META[a.sport].hasDistance) {
    const p = paceParts(a.avgSpeedMps, a.sport, units);
    return <>{p.value}<span className="text-fg-3"> {p.unit}</span></>;
  }
  return <span className="text-fg-4">—</span>;
}

function Row({ a, prevMonth }: { a: Activity; prevMonth: string | null }) {
  const units = useUnits();
  const on = useIsMorphTarget(a.id);
  const d = a.distanceM ? distanceParts(a.distanceM, a.sport, units) : null;
  const month = a.localDate.slice(0, 7);
  return (
    <>
      {prevMonth !== null && prevMonth !== month && (
        <div className="border-b border-line-1 bg-canvas/40 px-4 pt-4 pb-1.5 text-micro uppercase text-fg-3">
          {monthShort(a.localDate)} {a.localDate.slice(0, 4)}
        </div>
      )}
      <Link
        {...links.activity(a.id)}
        {...morphSourceProps(a.id)}
        role="row"
        onPointerMove={onSpotlightMove}
        style={vt(on, 'card')}
        className={cn('spotlight group relative grid h-11 items-center gap-x-3 border-b border-line-1 px-4 text-body outline-none transition-colors duration-(--dur-fast) last:rounded-b-lg last:border-b-0 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus', COLS)}
      >
        <span className="font-mono text-mono-sm text-fg-2">{formatDayShort(a.localDate)} <span className="text-fg-4">{monthShort(a.localDate)}</span></span>
        <SportGlyph sport={a.sport} subSport={a.subSport} size={16} style={vt(on, 'glyph')} className="text-fg-1" />
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-fg-1" style={vt(on, 'title')}>{a.title}</span>
          {a.isKey && <KeyStar pressed readOnly size="sm" />}
          {a.postNote && <Pilcrow className="size-3 shrink-0 text-fg-3" aria-label="Has a note" />}
        </span>
        <span className="text-right font-mono text-mono text-fg-1">{formatDuration(a.movingSec || a.durationSec)}</span>
        <span className="text-right font-mono text-mono text-fg-2">{d ? <>{d.value}<span className="text-fg-3"> {d.unit}</span></> : <span className="text-fg-4">—</span>}</span>
        <span className="text-right font-mono text-mono text-accent-ink">{formatNumber(a.load, 0)}</span>
        <span className="flex justify-end"><IntensityPips intensity={a.intensity} /></span>
        <span className="text-right font-mono text-mono text-fg-2">{a.avgHr ?? <span className="text-fg-4">—</span>}</span>
        <span className="text-right font-mono text-mono whitespace-nowrap text-fg-1"><Out a={a} /></span>
        <span className="flex justify-center">{a.compliance && <ComplianceGlyph state={a.compliance.state} />}</span>
        <span className="flex justify-end">{a.sparkline && a.sparkline.length > 1 ? <MiniProfile values={a.sparkline} height={16} className="w-[4.5rem]" /> : null}</span>
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
    <Link {...links.activity(a.id)} {...morphSourceProps(a.id)} style={vt(on, 'card')} className="flex flex-col gap-2 rounded-lg border border-line-2 bg-surface-1 p-3 outline-none active:bg-surface-2 focus-visible:outline-2 focus-visible:outline-focus">
      <div className="flex items-center gap-2">
        <SportGlyph sport={a.sport} subSport={a.subSport} size={16} style={vt(on, 'glyph')} />
        <span className="min-w-0 flex-1 truncate text-body font-[520] text-fg-1" style={vt(on, 'title')}>{a.title}</span>
        {a.isKey && <KeyStar pressed readOnly size="sm" />}
        {a.compliance && <ComplianceGlyph state={a.compliance.state} />}
      </div>
      <div className="flex items-end gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5 font-mono text-mono-sm text-fg-2">
          <span>{formatDayShort(a.localDate)} {monthShort(a.localDate)}</span>
          <span className="text-fg-1">{formatDuration(a.movingSec || a.durationSec)}</span>
          {d && <span>{d.value} {d.unit}</span>}
          <span className="text-accent-ink">{formatNumber(a.load, 0)} <span className="font-sans text-fg-3">load</span></span>
        </div>
        <IntensityPips intensity={a.intensity} />
      </div>
      {a.sparkline && a.sparkline.length > 1 && <MiniProfile values={a.sparkline} height={14} />}
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
    <div className="flex flex-col overflow-hidden rounded-lg border border-line-2 bg-surface-1" aria-busy>
      <div className="h-9 border-b border-line-1" />
      {Array.from({ length: 12 }, (_, i) => (
        <div key={i} className="flex h-11 items-center gap-4 border-b border-line-1 px-4">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="size-4" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-40" />
        </div>
      ))}
    </div>
  );
}

