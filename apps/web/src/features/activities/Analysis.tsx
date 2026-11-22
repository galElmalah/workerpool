/**
 * Activity analysis sections: the synchronized chart stack with selection stats, laps / swim
 * intervals + lengths / strength sets (sortable, in their own scroll containers with a sticky
 * header per DESIGN_V2 §9), time in zones (HR, power, pace — zone colours + labels side by side)
 * and peaks against 90-day and all-time bests. Map, charts and laps share `useActivitySync`.
 */
import type { ActivityDetail, ActivityStreams, Lap, Sport, StrengthSet, SwimLength, ZoneTime } from '@cadence/core/domain';
import { estimate1RM } from '@cadence/core/metrics';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUp, Award, Maximize2, RotateCcw, X } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  EffortCurve,
  effortsToPoints,
  PaceCurve,
  PowerCurve,
  StreamChart,
  streamStats,
  type CurveSeries,
  type StreamTrack,
} from '@/charts';
import { Button, IconButton, Section, Segmented, Skeleton } from '@/ui';
import { Ticker } from '@/motion/Ticker';
import { spring, tween } from '@/motion/tokens';
import { cn } from '@/lib/cn';
import { formatDuration, formatNumber, paceParts, speedParts } from '@/lib/format';
import { paceBasis, useUnits, type UnitPrefs } from '@/lib/units';
import { usePeaks } from './data';
import { elevUnit, elevValue, tempParts, zoneBg } from './fmt';
import { fmtPaceSec, paceSec } from './stats';
import { useActivitySync } from './sync';

const PACE_SPORTS = new Set<Sport>(['run', 'swim', 'row', 'walk', 'hike']);

function tracksFor(sport: Sport, s: ActivityStreams): StreamTrack[] {
  const has = (k: keyof ActivityStreams) => !!s[k]?.some((v) => v != null);
  const order: StreamTrack[] =
    sport === 'bike' ? ['power', 'hr', 'speed', 'cadence', 'altitude']
    : sport === 'row' ? ['power', 'speed', 'hr', 'cadence']
    : sport === 'swim' ? ['speed', 'hr', 'cadence']
    : sport === 'run' ? ['speed', 'hr', 'power', 'cadence', 'altitude']
    : sport === 'strength' || sport === 'yoga' ? ['hr']
    : ['hr', 'speed', 'altitude', 'cadence'];
  return order.filter((k) => has(k));
}

// ───────────────────────────── streams ─────────────────────────────

export function StreamsSection({ a, streams, loading, error, onRetry }: { a: ActivityDetail; streams?: ActivityStreams; loading: boolean; error: boolean; onRetry: () => void }) {
  const sync = useActivitySync();
  const chartRef = useRef<HTMLDivElement>(null);
  const tracks = useMemo(() => (streams ? tracksFor(a.sport, streams) : []), [streams, a.sport]);
  const zoomToSel = () => {
    const el = chartRef.current?.querySelector('[role="application"]') as HTMLElement | null;
    el?.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }));
  };
  const hasMap = !!streams?.lat?.some((v) => v != null);
  return (
    <Section id="charts" className="!scroll-mt-28" title="Charts" description={hasMap ? 'Hover to trace the route on the map; drag to select a range.' : 'Drag across the chart to select a range.'}>
      {loading ? (
        <div className="flex flex-col gap-6" aria-busy>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
            {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-11" />)}
          </div>
          <Skeleton className="h-[440px] w-full" radius="lg" />
        </div>
      ) : error || !streams ? (
        <div className="flex items-center gap-3 rounded-lg bg-surface-1 p-4 text-body text-fg-1">
          Streams didn’t load. <Button size="sm" icon={<RotateCcw />} onClick={onRetry}>Retry</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          <SelectionPanel a={a} s={streams} onZoom={zoomToSel} />
          <div ref={chartRef} className="min-w-0">
            <StreamChart
              streams={streams}
              laps={a.laps.length > 1 ? a.laps : undefined}
              tracks={tracks}
              sport={a.sport}
              ftp={a.sport === 'bike' ? a.thresholdsUsed.ftp : undefined}
              cursor={sync.cursor}
              selection={sync.hover ?? sync.selection}
              onSelect={(x) => sync.select(x)}
              trackHeight={68}
            />
          </div>
        </div>
      )}
    </Section>
  );
}

function SelectionPanel({ a, s, onZoom }: { a: ActivityDetail; s: ActivityStreams; onZoom: () => void }) {
  const units = useUnits();
  const { selection: sel, select, selectedLap } = useActivitySync();
  const st = useMemo(() => streamStats(s, sel?.startSec ?? 0, sel?.endSec ?? s.t[s.t.length - 1]!), [s, sel]);
  const pace = PACE_SPORTS.has(a.sport);
  const pb = paceBasis(a.sport, units);
  const small = pb.meters === 100 || pb.meters === 500;
  const rows: { label: string; value: number | null; format: (n: number) => string; unit?: string }[] = [
    { label: 'Duration', value: st.durationSec, format: (n) => formatDuration(n, 'hms') },
    ...(st.distanceM != null && st.distanceM > 0 ? [{ label: 'Distance', value: st.distanceM / (small ? 1 : 1000), format: (n: number) => formatNumber(n, small ? 0 : 2), unit: small ? 'm' : 'km' }] : []),
    ...(st.avgPower != null ? [{ label: 'Avg power', value: st.avgPower, format: (n: number) => formatNumber(n, 0), unit: 'W' }] : []),
    ...(st.weightedPower != null && a.sport === 'bike' ? [{ label: 'Weighted Power', value: st.weightedPower, format: (n: number) => formatNumber(n, 0), unit: 'W' }] : []),
    ...(st.avgHr != null ? [{ label: 'Avg HR', value: st.avgHr, format: (n: number) => formatNumber(n, 0), unit: 'bpm' }] : []),
    ...(st.maxHr != null ? [{ label: 'Max HR', value: st.maxHr, format: (n: number) => formatNumber(n, 0), unit: 'bpm' }] : []),
    ...(st.avgSpeed != null && st.avgSpeed > 0
      ? pace
        ? [{ label: a.sport === 'row' ? 'Split' : 'Pace', value: paceSec(st.distanceM && st.durationSec ? st.distanceM / st.durationSec : st.avgSpeed, a.sport, units), format: fmtPaceSec(a.sport), unit: pb.label }]
        : [{ label: 'Speed', value: st.avgSpeed * (units.system === 'imperial' ? 2.23694 : 3.6), format: (n: number) => formatNumber(n, 1), unit: units.system === 'imperial' ? 'mph' : 'km/h' }]
      : []),
    ...(st.avgCadence != null ? [{ label: 'Cadence', value: st.avgCadence, format: (n: number) => formatNumber(n, 0), unit: a.sport === 'bike' ? 'rpm' : 'spm' }] : []),
    ...(st.elevationGain != null && st.elevationGain > 0 ? [{ label: 'Elevation', value: elevValue(st.elevationGain, units), format: (n: number) => formatNumber(n, 0), unit: elevUnit(units) }] : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex h-8 items-center justify-between gap-2">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div key={sel ? `sel-${selectedLap}` : 'all'} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6, transition: tween('fast', 'in') }} transition={spring.smooth} className="flex min-w-0 items-center gap-2">
            <span className={cn('text-body-sm', sel ? 'font-medium text-fg-1' : 'text-fg-3')}>{sel ? (selectedLap != null ? `Lap ${selectedLap + 1}` : 'Selection') : 'Drag across the chart, or click a lap, to see that range’s figures.'}</span>
            {sel && <span className="truncate text-body-sm text-fg-3">{formatDuration(sel.startSec, 'hms')}–{formatDuration(sel.endSec, 'hms')}</span>}
          </motion.div>
        </AnimatePresence>
        <AnimatePresence>
          {sel && (
            <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96, transition: tween('fast', 'in') }} transition={spring.snappy} className="flex items-center gap-1">
              <Button size="sm" variant="ghost" icon={<Maximize2 />} onClick={onZoom}>Zoom</Button>
              <IconButton size="sm" label="Clear selection" icon={<X />} onClick={() => select(null)} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {!sel ? (
        <div className="min-h-11" aria-hidden />
      ) : (
      <div className="grid min-h-11 grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4 lg:grid-cols-8">
        {rows.slice(0, 8).map((r) => (
          <div key={r.label} className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-body-sm text-fg-3">{r.label}</span>
            <span className="flex items-baseline gap-1 text-stat-sm font-medium text-fg-1">
              {r.value == null ? '—' : <Ticker value={r.value} format={r.format} />}
              {r.unit && <span className="text-body-sm font-normal text-fg-3">{r.unit}</span>}
            </span>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}

// ───────────────────────────── shared table bits ─────────────────────────────

/** Scroll container for long secondary tables (§9): own x/y scroll, sticky header + first column. */
function TableScroll({ children, maxHeight = 480, label }: { children: ReactNode; maxHeight?: number; label: string }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className="relative -mx-4 overflow-auto overscroll-x-contain px-4 outline-none focus-visible:outline-2 focus-visible:outline-focus md:mx-0 md:px-0" style={{ maxHeight }}>
      {children}
    </div>
  );
}

const th = 'sticky top-0 z-[2] h-10 whitespace-nowrap border-b border-line-1 bg-canvas px-3 text-label font-medium text-fg-3 first:pl-0 last:pr-0';
const td = 'h-11 whitespace-nowrap border-b border-line-1 px-3 text-body tabular-nums first:pl-0 last:pr-0';
const stickyCol = 'sticky left-0 z-[1] bg-canvas transition-colors duration-(--dur-fast) group-hover:bg-surface-2 group-focus-visible:bg-surface-2';

interface Col<T> {
  key: string;
  label: string;
  /** Sort value (null sorts last). */
  sort?: (r: T) => number | string | null | undefined;
  cell: (r: T) => ReactNode;
  align?: 'left' | 'right';
  dim?: boolean;
}

function SortHead<T>({ c, sort, setSort }: { c: Col<T>; sort: { key: string; dir: 'asc' | 'desc' } | null; setSort: (s: { key: string; dir: 'asc' | 'desc' } | null) => void }) {
  const on = sort?.key === c.key;
  if (!c.sort) return <>{c.label}</>;
  return (
    <button
      type="button"
      onClick={() => setSort(on ? (sort!.dir === 'desc' ? { key: c.key, dir: 'asc' } : null) : { key: c.key, dir: 'desc' })}
      className={cn('inline-flex items-center gap-1 transition-colors hover:text-fg-1', c.align !== 'left' && 'flex-row-reverse', on && 'text-fg-1')}
    >
      {c.label}
      <motion.span initial={false} animate={{ rotate: on && sort!.dir === 'asc' ? 0 : 180, opacity: on ? 1 : 0 }} transition={spring.snappy} className="inline-flex">
        <ArrowUp className="size-3" strokeWidth={2} />
      </motion.span>
    </button>
  );
}

function useSorted<T>(rows: T[], cols: Col<T>[]) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const sorted = useMemo(() => {
    const c = sort && cols.find((x) => x.key === sort.key);
    if (!c?.sort) return rows;
    return [...rows].sort((x, y) => {
      const a = c.sort!(x);
      const b = c.sort!(y);
      if (a == null) return 1;
      if (b == null) return -1;
      const r = a < b ? -1 : a > b ? 1 : 0;
      return sort!.dir === 'asc' ? r : -r;
    });
  }, [rows, cols, sort]);
  return { sorted, sort, setSort };
}

// ───────────────────────────── laps ─────────────────────────────

function workRest(laps: Lap[], sport: Sport): ('work' | 'rest' | 'steady')[] {
  const val = (l: Lap) => (sport === 'bike' || sport === 'row' ? l.avgPower : l.avgSpeedMps) ?? null;
  const vals = laps.map(val).filter((v): v is number => v != null && v > 0);
  if (vals.length < 3) return laps.map((l) => (l.isRest ? 'rest' : 'steady'));
  const sorted = [...vals].sort((x, y) => x - y);
  const med = sorted[Math.floor(sorted.length / 2)]!;
  const spread = (sorted[sorted.length - 1]! - sorted[0]!) / med;
  if (spread < 0.15) return laps.map((l) => (l.isRest ? 'rest' : 'steady'));
  const hi = sorted[0]! + (sorted[sorted.length - 1]! - sorted[0]!) * 0.6;
  return laps.map((l) => {
    if (l.isRest) return 'rest';
    const v = val(l);
    if (v == null) return 'steady';
    return v >= hi ? 'work' : v < med * 0.85 ? 'rest' : 'steady';
  });
}

export const lapsTitle = (a: ActivityDetail) => (a.strengthSets?.length ? 'Sets' : a.sport === 'swim' && a.subSport !== 'open_water' ? 'Intervals' : 'Laps');

export function LapsSection({ a }: { a: ActivityDetail }) {
  if (a.strengthSets?.length) return <StrengthSection a={a} />;
  if (a.sport === 'swim' && a.subSport !== 'open_water' && a.laps.some((l) => l.lengths !== undefined)) return <SwimSection a={a} />;
  return <LapTable a={a} />;
}

function useLapRow() {
  const { select, setHover, selectedLap } = useActivitySync();
  const span = (l: Lap) => ({ startSec: l.startSec, endSec: l.startSec + l.durationSec });
  return (l: Lap) => ({
    tabIndex: 0,
    onPointerEnter: () => setHover(span(l)),
    onPointerLeave: () => setHover(null),
    onFocus: () => setHover(span(l)),
    onBlur: () => setHover(null),
    onClick: () => (selectedLap === l.index ? select(null) : select(span(l), l.index)),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        (e.currentTarget as HTMLElement).click();
      }
    },
    'aria-selected': selectedLap === l.index,
    className: cn(
      'group cursor-pointer outline-none transition-colors duration-(--dur-fast) hover:bg-surface-2 focus-visible:bg-surface-2',
      selectedLap === l.index && 'bg-surface-3 [&>td:first-child]:bg-surface-3',
    ),
  });
}

function paceOrSpeed(mps: number | undefined, sport: Sport, u: UnitPrefs): ReactNode {
  if (!mps) return <span className="text-fg-4">—</span>;
  const p = PACE_SPORTS.has(sport) ? paceParts(mps, sport, u) : speedParts(mps, u);
  return (
    <>
      {p.value}
      <span className="text-fg-3"> {p.unit}</span>
    </>
  );
}

const dash = <span className="text-fg-4">—</span>;

/** Work / easy labels only make sense when the session was a planned interval workout. */
const isIntervalPlan = (a: ActivityDetail) => !!a.plannedWorkout?.structure?.steps.some((n) => n.kind === 'repeat');

function LapTable({ a }: { a: ActivityDetail }) {
  const u = useUnits();
  const kinds = useMemo(() => (isIntervalPlan(a) ? workRest(a.laps, a.sport) : a.laps.map((l) => (l.isRest ? ('rest' as const) : ('steady' as const)))), [a]);
  const rowProps = useLapRow();
  const any = (f: (l: Lap) => unknown) => a.laps.some((l) => f(l) != null && f(l) !== 0);
  const pace = PACE_SPORTS.has(a.sport);
  const eu = elevUnit(u);
  const kmish = a.sport !== 'row' && a.sport !== 'swim';
  const cols: Col<Lap>[] = [
    { key: 'lap', label: 'Lap', align: 'left', sort: (l) => l.index, cell: (l) => <LapName l={l} kind={kinds[l.index] ?? 'steady'} /> },
    { key: 'time', label: 'Time', sort: (l) => l.durationSec, cell: (l) => formatDuration(l.movingSec && l.movingSec < l.durationSec - 5 ? l.movingSec : l.durationSec, 'hms') },
    ...(any((l) => l.distanceM)
      ? [{ key: 'dist', label: 'Distance', sort: (l: Lap) => l.distanceM, cell: (l: Lap) => (l.distanceM ? (kmish ? `${formatNumber(l.distanceM / (u.system === 'imperial' ? 1609.344 : 1000), 2)} ${u.system === 'imperial' ? 'mi' : 'km'}` : `${formatNumber(l.distanceM, 0)} m`) : dash) } as Col<Lap>]
      : []),
    ...(any((l) => l.avgSpeedMps)
      ? [{ key: 'pace', label: pace ? (a.sport === 'row' ? 'Split' : 'Pace') : 'Speed', sort: (l: Lap) => l.avgSpeedMps, cell: (l: Lap) => paceOrSpeed(l.avgSpeedMps, a.sport, u) } as Col<Lap>]
      : []),
    ...(any((l) => l.maxSpeedMps) && !pace ? [{ key: 'maxs', label: 'Max speed', dim: true, sort: (l: Lap) => l.maxSpeedMps, cell: (l: Lap) => paceOrSpeed(l.maxSpeedMps, a.sport, u) } as Col<Lap>] : []),
    ...(any((l) => l.avgPower) ? [{ key: 'pw', label: 'Power', sort: (l: Lap) => l.avgPower, cell: (l: Lap) => (l.avgPower != null ? <>{formatNumber(l.avgPower, 0)}<span className="text-fg-3"> W</span></> : dash) } as Col<Lap>] : []),
    ...(any((l) => l.weightedPower) && a.sport === 'bike' ? [{ key: 'np', label: 'Weighted', sort: (l: Lap) => l.weightedPower, cell: (l: Lap) => (l.weightedPower != null ? <>{formatNumber(l.weightedPower, 0)}<span className="text-fg-3"> W</span></> : dash) } as Col<Lap>] : []),
    ...(any((l) => l.maxPower) ? [{ key: 'maxp', label: 'Max power', dim: true, sort: (l: Lap) => l.maxPower, cell: (l: Lap) => (l.maxPower != null ? <>{formatNumber(l.maxPower, 0)}<span className="text-fg-3"> W</span></> : dash) } as Col<Lap>] : []),
    ...(any((l) => l.avgHr) ? [{ key: 'hr', label: 'Avg HR', sort: (l: Lap) => l.avgHr, cell: (l: Lap) => (l.avgHr != null ? <>{l.avgHr}<span className="text-fg-3"> bpm</span></> : dash) } as Col<Lap>] : []),
    ...(any((l) => l.maxHr) ? [{ key: 'maxhr', label: 'Max HR', dim: true, sort: (l: Lap) => l.maxHr, cell: (l: Lap) => l.maxHr ?? dash } as Col<Lap>] : []),
    ...(any((l) => l.avgCadence) ? [{ key: 'cad', label: 'Cadence', sort: (l: Lap) => l.avgCadence, cell: (l: Lap) => (l.avgCadence != null ? formatNumber(l.avgCadence, 0) : dash) } as Col<Lap>] : []),
    ...(any((l) => l.elevationGainM) || any((l) => l.elevationLossM)
      ? [{ key: 'elev', label: `Elev. ${eu}`, sort: (l: Lap) => l.elevationGainM, cell: (l: Lap) => <>+{formatNumber(elevValue(l.elevationGainM ?? 0, u), 0)}<span className="text-fg-3"> / −{formatNumber(elevValue(l.elevationLossM ?? 0, u), 0)}</span></> } as Col<Lap>]
      : []),
    ...(any((l) => l.avgGroundContactMs) ? [{ key: 'gct', label: 'Contact', sort: (l: Lap) => l.avgGroundContactMs, cell: (l: Lap) => (l.avgGroundContactMs != null ? <>{formatNumber(l.avgGroundContactMs, 0)}<span className="text-fg-3"> ms</span></> : dash) } as Col<Lap>] : []),
    ...(any((l) => l.avgVerticalOscillationCm) ? [{ key: 'vo', label: 'Vert. osc.', sort: (l: Lap) => l.avgVerticalOscillationCm, cell: (l: Lap) => (l.avgVerticalOscillationCm != null ? <>{formatNumber(l.avgVerticalOscillationCm, 1)}<span className="text-fg-3"> cm</span></> : dash) } as Col<Lap>] : []),
    ...(any((l) => l.avgStrideLengthM) ? [{ key: 'stride', label: 'Stride', sort: (l: Lap) => l.avgStrideLengthM, cell: (l: Lap) => (l.avgStrideLengthM != null ? <>{formatNumber(l.avgStrideLengthM, 2)}<span className="text-fg-3"> m</span></> : dash) } as Col<Lap>] : []),
    ...(any((l) => l.avgTempC) ? [{ key: 'temp', label: 'Temp', dim: true, sort: (l: Lap) => l.avgTempC, cell: (l: Lap) => (l.avgTempC != null ? `${tempParts(l.avgTempC, u).value}${tempParts(0, u).unit}` : dash) } as Col<Lap>] : []),
  ];
  const { sorted, sort, setSort } = useSorted(a.laps, cols);
  return (
    <Section stagger={false} id="laps" title="Laps" description={`${a.laps.length} laps. ${kinds.includes('work') ? 'Recoveries are dimmed. ' : ''}Hover a lap to preview it on the chart and map; click to select it.`}>
      <TableScroll label="Laps table" maxHeight={520}>
        <table className="w-full min-w-max border-separate border-spacing-0 text-body">
          <thead>
            <tr>
              {cols.map((c, i) => (
                <th key={c.key} scope="col" aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined} className={cn(th, c.align === 'left' ? 'text-left' : 'text-right', i === 0 && 'left-0 z-[3] pr-6')}>
                  <SortHead c={c} sort={sort} setSort={setSort} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((l) => {
              const dim = kinds[l.index] === 'rest';
              const p = rowProps(l);
              return (
                <tr key={l.index} {...p}>
                  {cols.map((c, i) => (
                    <td key={c.key} className={cn(td, c.align === 'left' ? 'text-left' : 'text-right', i === 0 && cn(stickyCol, 'pr-6'), dim || c.dim ? 'text-fg-3' : i === 0 ? 'text-fg-1' : 'text-fg-1', !dim && c.dim && 'text-fg-2')}>
                      {c.cell(l)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>
    </Section>
  );
}

function LapName({ l, kind }: { l: Lap; kind: 'work' | 'rest' | 'steady' }) {
  return (
    <span className="inline-flex items-baseline gap-2">
      <span className={kind === 'rest' ? 'text-fg-3' : kind === 'work' ? 'font-medium text-fg-1' : 'text-fg-1'}>{l.index + 1}</span>
      {kind === 'work' && <span className="text-body-sm text-fg-3">Work</span>}
      {kind === 'rest' && <span className="text-body-sm text-fg-4">Easy</span>}
    </span>
  );
}

const STROKE: Record<string, string> = { free: 'Free', freestyle: 'Free', back: 'Back', backstroke: 'Back', breast: 'Breast', breaststroke: 'Breast', fly: 'Fly', butterfly: 'Fly', im: 'IM', mixed: 'IM', drill: 'Drill', choice: 'Choice', kick: 'Kick' };

function SwimSection({ a }: { a: ActivityDetail }) {
  const u = useUnits();
  const rowProps = useLapRow();
  const [view, setView] = useState<'intervals' | 'lengths'>('intervals');
  const work = a.laps.filter((l) => !l.isRest && (l.distanceM ?? 0) > 0);
  const restAfter = (i: number) => {
    const n = a.laps[i + 1];
    return n?.isRest ? n.durationSec : null;
  };
  const lengths = a.swimLengths ?? [];
  const rows = work.map((l) => ({ l, n: work.indexOf(l) + 1, rest: restAfter(a.laps.indexOf(l)) }));
  type R = (typeof rows)[number];
  const cols: Col<R>[] = [
    { key: 'n', label: '#', align: 'left', sort: (r) => r.n, cell: (r) => r.n },
    { key: 'stroke', label: 'Stroke', align: 'left', sort: (r) => r.l.stroke, cell: (r) => STROKE[r.l.stroke ?? ''] ?? r.l.stroke ?? dash },
    { key: 'len', label: 'Lengths', sort: (r) => r.l.lengths, cell: (r) => r.l.lengths ?? dash },
    { key: 'dist', label: 'Distance', sort: (r) => r.l.distanceM, cell: (r) => <>{formatNumber(r.l.distanceM, 0)}<span className="text-fg-3"> m</span></> },
    { key: 'time', label: 'Time', sort: (r) => r.l.movingSec ?? r.l.durationSec, cell: (r) => formatDuration(r.l.movingSec ?? r.l.durationSec, 'hms') },
    { key: 'pace', label: 'Pace', sort: (r) => r.l.avgSpeedMps, cell: (r) => paceOrSpeed(r.l.avgSpeedMps, 'swim', u) },
    { key: 'swolf', label: 'SWOLF', sort: (r) => r.l.swolf, cell: (r) => r.l.swolf ?? dash },
    { key: 'rate', label: 'Stroke rate', sort: (r) => r.l.avgCadence, cell: (r) => (r.l.avgCadence ? <>{r.l.avgCadence}<span className="text-fg-3"> spm</span></> : dash) },
    { key: 'hr', label: 'HR', sort: (r) => r.l.avgHr, cell: (r) => r.l.avgHr ?? dash },
    { key: 'rest', label: 'Rest after', dim: true, sort: (r) => r.rest, cell: (r) => (r.rest != null ? formatDuration(r.rest, 'hms') : dash) },
  ];
  const { sorted, sort, setSort } = useSorted(rows, cols);
  const lenCols: Col<SwimLength>[] = [
    { key: 'i', label: 'Length', align: 'left', sort: (l) => l.index, cell: (l) => l.index + 1 },
    { key: 'int', label: 'Interval', sort: (l) => l.lapIndex, cell: (l) => (l.lapIndex != null ? (work.findIndex((w) => w.index === l.lapIndex) + 1 || dash) : dash) },
    { key: 'stroke', label: 'Stroke', align: 'left', sort: (l) => l.stroke, cell: (l) => (l.isRest ? 'Rest' : (STROKE[l.stroke ?? ''] ?? l.stroke ?? dash)) },
    { key: 'time', label: 'Time', sort: (l) => l.durationSec, cell: (l) => formatDuration(l.durationSec, 'hms') },
    { key: 'pace', label: 'Pace', sort: (l) => (l.isRest || !a.poolLengthM ? null : a.poolLengthM / l.durationSec), cell: (l) => (l.isRest || !a.poolLengthM ? dash : paceOrSpeed(a.poolLengthM / l.durationSec, 'swim', u)) },
    { key: 'strokes', label: 'Strokes', sort: (l) => l.strokes, cell: (l) => l.strokes ?? dash },
    { key: 'swolf', label: 'SWOLF', sort: (l) => l.swolf, cell: (l) => l.swolf ?? dash },
    { key: 'rate', label: 'Stroke rate', sort: (l) => l.strokeRate, cell: (l) => (l.strokeRate ? <>{l.strokeRate}<span className="text-fg-3"> spm</span></> : dash) },
  ];
  const lenSorted = useSorted(lengths, lenCols);
  return (
    <Section
      stagger={false}
      id="laps"
      title="Intervals"
      description={view === 'intervals' ? `${work.length} swims in a ${formatNumber(a.poolLengthM ?? 25, 0)} m pool. Click an interval to select it on the chart.` : `${lengths.filter((l) => !l.isRest).length} lengths, each as the watch recorded it.`}
      actions={lengths.length ? <Segmented size="sm" aria-label="Swim detail" value={view} onValueChange={setView} options={[{ value: 'intervals', label: 'Intervals' }, { value: 'lengths', label: 'Lengths' }]} /> : undefined}
    >
      {view === 'intervals' ? (
        <TableScroll label="Swim intervals" maxHeight={520}>
          <table className="w-full min-w-max border-separate border-spacing-0 text-body">
            <thead>
              <tr>
                {cols.map((c, i) => (
                  <th key={c.key} scope="col" aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined} className={cn(th, c.align === 'left' ? 'text-left' : 'text-right', i === 0 && 'left-0 z-[3]')}>
                    <SortHead c={c} sort={sort} setSort={setSort} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const drill = r.l.stroke === 'drill' || r.l.stroke === 'kick';
                return (
                  <tr key={r.l.index} {...rowProps(r.l)}>
                    {cols.map((c, i) => (
                      <td key={c.key} className={cn(td, c.align === 'left' ? 'text-left' : 'text-right', i === 0 && stickyCol, drill || c.dim ? 'text-fg-3' : 'text-fg-1')}>
                        {c.cell(r)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      ) : (
        <TableScroll label="Swim lengths" maxHeight={520}>
          <table className="w-full min-w-max border-separate border-spacing-0 text-body">
            <thead>
              <tr>
                {lenCols.map((c, i) => (
                  <th key={c.key} scope="col" aria-sort={lenSorted.sort?.key === c.key ? (lenSorted.sort.dir === 'asc' ? 'ascending' : 'descending') : undefined} className={cn(th, c.align === 'left' ? 'text-left' : 'text-right', i === 0 && 'left-0 z-[3]')}>
                    <SortHead c={c} sort={lenSorted.sort} setSort={lenSorted.setSort} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lenSorted.sorted.map((l) => (
                <tr key={l.index} className="group transition-colors duration-(--dur-fast) hover:bg-surface-2">
                  {lenCols.map((c, i) => (
                    <td key={c.key} className={cn(td, c.align === 'left' ? 'text-left' : 'text-right', i === 0 && stickyCol, l.isRest ? 'text-fg-3' : 'text-fg-1')}>
                      {c.cell(l)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </Section>
  );
}

function StrengthSection({ a }: { a: ActivityDetail }) {
  const units = useUnits();
  const groups = useMemo(() => {
    const m = new Map<string, StrengthSet[]>();
    for (const s of a.strengthSets ?? []) {
      if (s.isRest || !s.reps) continue;
      m.set(s.exercise, [...(m.get(s.exercise) ?? []), s]);
    }
    return [...m.entries()].map(([exercise, sets]) => {
      const volume = sets.reduce((t, s) => t + (s.reps ?? 0) * (s.weightKg ?? 0), 0);
      const e1rm = Math.max(0, ...sets.map((s) => estimate1RM(s.weightKg, s.reps) ?? 0));
      const time = sets.reduce((t, s) => t + (s.durationSec ?? 0), 0);
      return { exercise, sets, volume, e1rm, time };
    });
  }, [a.strengthSets]);
  const maxVol = Math.max(1, ...groups.map((g) => g.volume));
  const kg = (v: number) => (units.system === 'imperial' ? v / 0.45359237 : v);
  const wu = units.system === 'imperial' ? 'lb' : 'kg';
  return (
    <Section stagger={false} id="laps" title="Sets" description={`${groups.length} exercises · ${a.totalSets ?? 0} sets · ${a.totalReps ?? 0} reps`}>
      <TableScroll label="Strength sets" maxHeight={560}>
        <table className="w-full min-w-max border-separate border-spacing-0 text-body">
          <thead>
            <tr className="text-right">
              <th className={cn(th, 'left-0 z-[3] text-left')}>Exercise</th>
              <th className={cn(th, 'text-left')}>Reps × weight</th>
              <th className={th}>Time</th>
              <th className={cn(th, 'w-48')}>Volume</th>
              <th className={th}>Est. 1RM</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.exercise} className="group text-right transition-colors duration-(--dur-fast) hover:bg-surface-2">
                <td className={cn(td, stickyCol, 'pr-6 text-left font-medium text-fg-1')}>{g.exercise}</td>
                <td className={cn(td, 'text-left')}>
                  <span className="flex gap-1 py-2">
                    {g.sets.map((s, i) => (
                      <span key={i} className="rounded-xs bg-surface-2 px-1.5 text-body-sm text-fg-1 group-hover:bg-surface-3">
                        {s.reps}
                        {s.weightKg ? <span className="text-fg-3"> × {formatNumber(kg(s.weightKg), 1, { trim: true })}</span> : null}
                      </span>
                    ))}
                  </span>
                </td>
                <td className={cn(td, 'text-fg-2')}>{g.time ? formatDuration(g.time, 'hms') : dash}</td>
                <td className={td}>
                  <span className="flex items-center justify-end gap-2">
                    <span className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-3">
                      <motion.span className="block h-full origin-left rounded-full bg-sport-strength" initial={{ scaleX: 0 }} animate={{ scaleX: g.volume / maxVol }} transition={spring.smooth} />
                    </span>
                    <span className="w-20 text-fg-1">{g.volume ? `${formatNumber(kg(g.volume), 0)} ${wu}` : '—'}</span>
                  </span>
                </td>
                <td className={cn(td, 'text-fg-1')}>{g.e1rm ? `${formatNumber(kg(g.e1rm), 1)} ${wu}` : dash}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </Section>
  );
}

// ───────────────────────────── zones ─────────────────────────────

function bucketSplit(z: ZoneTime[]): { easy: number; moderate: number; hard: number } {
  const out = { easy: 0, moderate: 0, hard: 0 };
  for (const x of z) out[x.zone <= 2 ? 'easy' : x.zone === 3 ? 'moderate' : 'hard'] += x.seconds;
  return out;
}

export function ZonesSection({ a }: { a: ActivityDetail }) {
  const units = useUnits();
  const t = a.thresholdsUsed;
  const models: { kind: 'hr' | 'power' | 'pace'; title: string; basis: string | null; zones: ZoneTime[] }[] = [];
  if (a.zones.hr?.some((z) => z.seconds > 0)) models.push({ kind: 'hr', title: 'Heart rate', basis: t.lthr ? `LTHR ${t.lthr} bpm` : null, zones: a.zones.hr });
  if (a.zones.power?.some((z) => z.seconds > 0))
    models.push({ kind: 'power', title: 'Power', basis: a.sport === 'row' ? (t.rowThresholdW ? `Threshold ${t.rowThresholdW} W` : null) : t.ftp ? `FTP ${t.ftp} W` : null, zones: a.zones.power });
  if (a.zones.pace?.some((z) => z.seconds > 0))
    models.push({
      kind: 'pace',
      title: 'Pace',
      basis: a.sport === 'swim' ? (t.swimCssMps ? `CSS ${paceParts(t.swimCssMps, 'swim', units).value} /100 m` : null) : t.runThresholdMps ? `Threshold ${paceParts(t.runThresholdMps, a.sport, units).value} ${paceBasis(a.sport, units).label}` : null,
      zones: a.zones.pace,
    });
  if (!models.length) return null;
  return (
    <Section id="zones" title="Time in zones" description="Zones from your thresholds on this date. Each bar is the share of moving time.">
      <div className="grid gap-x-12 gap-y-12 lg:grid-cols-2">
        {models.map((m) => (
          <ZoneColumn key={m.kind} kind={m.kind} title={m.title} basis={m.basis} zones={m.zones} sport={a.sport} units={units} />
        ))}
      </div>
    </Section>
  );
}

function ZoneColumn({ kind, title, basis, zones, sport, units }: { kind: 'hr' | 'power' | 'pace'; title: string; basis: string | null; zones: ZoneTime[]; sport: Sport; units: UnitPrefs }) {
  const total = zones.reduce((s, z) => s + z.seconds, 0) || 1;
  const max = Math.max(1, ...zones.map((z) => z.seconds));
  const sp = bucketSplit(zones);
  const range = (lo: number | null, hi: number | null) => {
    if (kind === 'pace') {
      const f = (v: number | null) => (v ? paceParts(v, sport, units).value : '');
      return hi == null ? `faster than ${f(lo)}` : lo == null ? `slower than ${f(hi)}` : `${f(hi)}–${f(lo)}`;
    }
    const u = kind === 'power' ? 'W' : 'bpm';
    const r = (v: number) => Math.round(v);
    return hi == null ? `${r(lo ?? 0)}+ ${u}` : lo == null ? `< ${r(hi)} ${u}` : `${r(lo)}–${r(hi)} ${u}`;
  };
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-body font-medium text-fg-1">{title}</h3>
        {basis && <span className="text-body-sm text-fg-3">{basis}</span>}
      </div>
      <ol className="flex flex-col gap-2.5" aria-label={`${title} zones`}>
        {zones.map((z) => {
          const pct = (z.seconds / total) * 100;
          return (
            <li key={z.zone} className="grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_4.5rem_3rem] items-center gap-x-3 max-sm:grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_3.25rem_2.75rem]">
              <span className="flex min-w-0 flex-col">
                <span className="flex items-center gap-2 text-body text-fg-1">
                  <span className={cn('size-2 shrink-0 rounded-full', zoneBg(z.zone))} aria-hidden />
                  <span className="shrink-0 tabular-nums text-fg-3">Z{z.zone}</span>
                  <span className="truncate">{z.name}</span>
                </span>
                <span className="truncate pl-4 text-body-sm text-fg-3 tabular-nums">{range(z.low, z.high)}</span>
              </span>
              <span className="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                <motion.span className={cn('block h-full origin-left rounded-full', zoneBg(z.zone))} initial={{ scaleX: 0 }} animate={{ scaleX: z.seconds / max }} transition={spring.smooth} />
              </span>
              <span className="text-right text-body tabular-nums text-fg-1">{z.seconds > 0 ? formatDuration(z.seconds, 'hms') : <span className="text-fg-4">—</span>}</span>
              <span className="text-right text-body-sm tabular-nums text-fg-3">{z.seconds > 0 ? `${Math.round(pct)}%` : ''}</span>
            </li>
          );
        })}
      </ol>
      <p className="text-body-sm text-fg-3">
        Easy <span className="text-fg-1 tabular-nums">{Math.round((sp.easy / total) * 100)}%</span> · Moderate <span className="text-fg-1 tabular-nums">{Math.round((sp.moderate / total) * 100)}%</span> · Hard{' '}
        <span className="text-fg-1 tabular-nums">{Math.round((sp.hard / total) * 100)}%</span>
      </p>
    </div>
  );
}

// ───────────────────────────── peaks ─────────────────────────────

const KEY_DURS = [5, 60, 300, 1200, 3600];
const durLabel = (s: number) => (s < 60 ? `${s} s` : s < 3600 ? `${s / 60} min` : `${s / 3600} h`);
const EFFORT_LABEL: Record<number, string> = { 400: '400 m', 500: '500 m', 1000: '1 km', 1609: '1 mi', 1609.344: '1 mi', 2000: '2 km', 5000: '5 km', 6000: '6 km', 10000: '10 km', 21097.5: 'Half', 21097: 'Half', 42195: 'Marathon', 50: '50 m', 100: '100 m', 200: '200 m', 800: '800 m', 1500: '1500 m', 3800: '3.8 km', 1900: '1.9 km' };

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="mt-0.5 inline-flex items-center gap-1 text-body-sm text-fg-2">
      <Award className="size-3 text-good" aria-hidden />
      {children}
    </span>
  );
}

export function hasPeaks(a: ActivityDetail) {
  return !!(a.peaks.power?.length || a.peaks.efforts?.length || a.peaks.speed?.length || a.peaks.hr?.length);
}

export function PeaksSection({ a }: { a: ActivityDetail }) {
  const units = useUnits();
  const q = usePeaks(a.sport, true);
  const r90 = q.data?.find((r) => r.key === '90d');
  const rAll = q.data?.find((r) => r.key === 'all');
  const isPower = (a.sport === 'bike' || a.sport === 'row') && !!a.peaks.power?.length;
  const at = (pts: { durationSec: number; value: number; activityId?: string }[] | undefined, d: number) => pts?.find((p) => p.durationSec === d);

  if (isPower) {
    const series: CurveSeries[] = [
      { id: 'this', label: 'This activity', points: a.peaks.power!, variant: 'primary' },
      ...(r90?.power?.length ? [{ id: '90d', label: '90-day best', points: r90.power, variant: 'secondary' as const }] : []),
      ...(rAll?.power?.length ? [{ id: 'all', label: 'All-time', points: rAll.power, variant: 'comparison' as const }] : []),
    ];
    const rows = KEY_DURS.map((d) => ({ d, me: at(a.peaks.power, d), b90: at(r90?.power, d), all: at(rAll?.power, d) })).filter((r) => r.me);
    return (
      <Section id="peaks" title="Peaks" description="Best average power for each duration in this session, against your 90-day and all-time bests.">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            <PowerCurve series={series} weightKg={a.thresholdsUsed.weightKg} loading={q.isPending} height={280} />
          </div>
          <PeakTable
            head={['Duration', 'This', '90 d', 'All-time']}
            rows={rows.map((r) => ({
              key: r.d,
              label: durLabel(r.d),
              me: `${Math.round(r.me!.value)} W`,
              sub: a.thresholdsUsed.weightKg ? `${(r.me!.value / a.thresholdsUsed.weightKg).toFixed(2)} W/kg` : undefined,
              b90: r.b90 ? `${Math.round(r.b90.value)}` : '—',
              all: r.all ? `${Math.round(r.all.value)}` : '—',
              badge: r.all?.activityId === a.id ? 'All-time best' : r.b90?.activityId === a.id ? '90-day best' : null,
            }))}
          />
        </div>
      </Section>
    );
  }

  const efforts = a.peaks.efforts ?? [];
  const best = (rng: typeof r90, dist: number) => rng?.efforts?.find((e) => e.distanceM === dist);
  const pb = paceBasis(a.sport, units);
  const useSpeed = !!a.peaks.speed?.length;
  const pts = (r: typeof r90) => (useSpeed ? (r?.speed ?? []) : effortsToPoints(r?.efforts ?? []));
  const mine = useSpeed ? a.peaks.speed! : effortsToPoints(efforts);
  const speedSeries: CurveSeries[] =
    mine.length > 1
      ? [
          { id: 'this', label: 'This activity', points: mine, variant: 'primary' },
          ...(pts(r90).length > 1 ? [{ id: '90d', label: '90-day best', points: pts(r90), variant: 'secondary' as const }] : []),
          ...(pts(rAll).length > 1 ? [{ id: 'all', label: 'All-time', points: pts(rAll), variant: 'comparison' as const }] : []),
        ]
      : [];
  const hrRows = KEY_DURS.map((d) => ({ d, me: at(a.peaks.hr, d) })).filter((r) => r.me);
  return (
    <Section id="peaks" title={efforts.length ? 'Best efforts' : 'Peaks'} description={efforts.length ? 'Fastest time over each distance within this session, against your 90-day and all-time bests.' : 'Highest average heart rate held for each duration.'}>
      <div className={cn('grid gap-10', (speedSeries.length || !efforts.length) && 'lg:grid-cols-[minmax(0,1fr)_320px]')}>
        {speedSeries.length > 0 ? (
          <div className="min-w-0">
            <PaceCurve series={speedSeries} per={pb.meters} loading={q.isPending} height={280} />
          </div>
        ) : !efforts.length && a.peaks.hr?.length ? (
          <div className="min-w-0">
            <EffortCurve series={[{ id: 'hr', label: 'Heart rate', points: a.peaks.hr, variant: 'primary' }]} unit="bpm" zeroBased={false} height={260} />
          </div>
        ) : null}
        {efforts.length > 0 ? (
          <PeakTable
            head={['Distance', 'This', '90 d', 'All-time']}
            rows={efforts.map((e) => {
              const b90 = best(r90, e.distanceM);
              const all = best(rAll, e.distanceM);
              return {
                key: e.distanceM,
                label: EFFORT_LABEL[e.distanceM] ?? `${formatNumber(e.distanceM, 0)} m`,
                me: formatDuration(e.timeSec, 'hms'),
                sub: paceParts(e.distanceM / e.timeSec, a.sport, units).value + ' ' + pb.label,
                b90: b90 ? formatDuration(b90.timeSec, 'hms') : '—',
                all: all ? formatDuration(all.timeSec, 'hms') : '—',
                badge: all?.activityId === a.id ? 'All-time best' : b90?.activityId === a.id ? '90-day best' : null,
              };
            })}
          />
        ) : hrRows.length ? (
          <PeakTable head={['Duration', 'Heart rate', '', '']} rows={hrRows.map((r) => ({ key: r.d, label: durLabel(r.d), me: `${Math.round(r.me!.value)} bpm`, b90: '', all: '', badge: null }))} />
        ) : null}
      </div>
    </Section>
  );
}

function PeakTable({ head, rows }: { head: string[]; rows: { key: number; label: string; me: string; sub?: string; b90: string; all: string; badge: string | null }[] }) {
  return (
    <TableScroll label="Peaks table" maxHeight={420}>
      <table className="w-full border-separate border-spacing-0">
        <thead>
          <tr className="text-right">
            {head.map((h, i) => (
              <th key={i} className={cn(th, i === 0 && 'text-left')}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="text-right">
              <td className={cn(td, 'h-auto py-2 text-left')}>
                <div className="text-body text-fg-1">{r.label}</div>
                {r.badge && <Badge>{r.badge}</Badge>}
              </td>
              <td className={cn(td, 'h-auto py-2 text-fg-1')}>
                {r.me}
                {r.sub && <div className="text-body-sm text-fg-3">{r.sub}</div>}
              </td>
              <td className={cn(td, 'text-fg-2')}>{r.b90}</td>
              <td className={cn(td, 'text-fg-3')}>{r.all}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}
