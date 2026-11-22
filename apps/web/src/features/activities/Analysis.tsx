/**
 * Activity analysis sections: route + streams + selection stats, laps / swim intervals / strength
 * sets, time in zones, peaks against 90-day and all-time bests.
 */
import type { ActivityDetail, ActivityStreams, Lap, Sport, StrengthSet, ZoneTime } from '@cadence/core/domain';
import { estimate1RM } from '@cadence/core/metrics';
import { AnimatePresence, motion } from 'motion/react';
import { Award, Maximize2, RotateCcw, X } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  EffortCurve,
  effortsToPoints,
  PaceCurve,
  PowerCurve,
  RouteMap,
  SplitBar,
  StreamChart,
  streamStats,
  useStreamCursor,
  ZoneBars,
  type CurveSeries,
  type StreamSelection,
  type StreamTrack,
} from '@/charts';
import { Button, IconButton, Section, Segmented, Skeleton } from '@/ui';
import { Ticker } from '@/motion/Ticker';
import { spring, tween } from '@/motion/tokens';
import { cn } from '@/lib/cn';
import { formatDuration, formatNumber, paceParts } from '@/lib/format';
import { paceBasis, useUnits } from '@/lib/units';
import { usePeaks, useStreams } from './data';
import { fmtPaceSec, paceSec } from './stats';

const PACE_SPORTS = new Set<Sport>(['run', 'swim', 'row', 'walk', 'hike']);

function tracksFor(sport: Sport, s: ActivityStreams): StreamTrack[] {
  const has = (k: keyof ActivityStreams) => !!s[k]?.some((v) => v != null);
  const order: StreamTrack[] =
    sport === 'bike' ? ['power', 'hr', 'speed', 'cadence', 'altitude']
    : sport === 'row' ? ['power', 'speed', 'hr', 'cadence']
    : sport === 'swim' ? ['speed', 'hr']
    : sport === 'run' ? ['speed', 'hr', 'power', 'cadence', 'altitude']
    : sport === 'strength' || sport === 'yoga' ? ['hr']
    : ['hr', 'speed', 'altitude'];
  return order.filter((k) => has(k));
}

// ───────────────────────────── streams ─────────────────────────────

/** Lap hover (from the laps table) previews a span on the chart; selection is committed state. */
let hoverSpanSetter: ((s: StreamSelection | null) => void) | null = null;
let selectSetter: ((s: StreamSelection | null) => void) | null = null;
export const lapBus = {
  hover: (s: StreamSelection | null) => hoverSpanSetter?.(s),
  select: (s: StreamSelection | null) => selectSetter?.(s),
};

export function StreamsSection({ a }: { a: ActivityDetail }) {
  const q = useStreams(a.id, a.hasStreams);
  const cursor = useStreamCursor();
  const [sel, setSel] = useState<StreamSelection | null>(null);
  const [hover, setHover] = useState<StreamSelection | null>(null);
  hoverSpanSetter = setHover;
  selectSetter = setSel;
  const chartRef = useRef<HTMLDivElement>(null);
  const s = q.data;
  const hasMap = !!s?.lat?.some((v) => v != null);
  const tracks = useMemo(() => (s ? tracksFor(a.sport, s) : []), [s, a.sport]);
  const zoomToSel = () => {
    const el = chartRef.current?.querySelector('[role="application"]') as HTMLElement | null;
    el?.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }));
  };
  const panel = s && <SelectionPanel a={a} s={s} sel={sel} side={hasMap} onClear={() => setSel(null)} onZoom={zoomToSel} />;
  return (
    <Section id="charts" className="!scroll-mt-28" title="Charts" description={hasMap ? 'Hover the chart to trace the route; drag to select a range.' : 'Drag across the chart to select a range.'}>
      {q.isPending ? (
        <div className="flex flex-col gap-3" aria-busy>
          <div className="flex gap-6">
            {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-10 w-20" />)}
          </div>
          <Skeleton className="h-[440px] w-full" radius="lg" />
        </div>
      ) : q.isError || !s ? (
        <div className="flex items-center gap-3 rounded-lg bg-surface-1 p-4 text-body text-fg-1">
          Streams didn’t load. <Button size="sm" icon={<RotateCcw />} onClick={() => q.refetch()}>Retry</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-10">
          {hasMap ? (
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="overflow-hidden rounded-lg bg-surface-1" style={{ ['--chart-bg' as string]: 'var(--color-surface-1)' }}>
                <RouteMap streams={s} cursor={cursor} selection={hover ?? sel} height={340} elevationShading kmMarkers={false} />
              </div>
              {panel}
            </div>
          ) : (
            panel
          )}
          <div ref={chartRef}>
            <StreamChart
              streams={s}
              laps={a.laps.length > 1 ? a.laps : undefined}
              tracks={tracks}
              sport={a.sport}
              ftp={a.sport === 'bike' ? a.thresholdsUsed.ftp : undefined}
              cursor={cursor}
              selection={hover ?? sel}
              onSelect={(x) => {
                setHover(null);
                setSel(x);
              }}
              trackHeight={68}
            />
          </div>
        </div>
      )}
    </Section>
  );
}

function SelectionPanel({ a, s, sel, side, onClear, onZoom }: { a: ActivityDetail; s: ActivityStreams; sel: StreamSelection | null; side: boolean; onClear: () => void; onZoom: () => void }) {
  const units = useUnits();
  const st = useMemo(() => streamStats(s, sel?.startSec ?? 0, sel?.endSec ?? s.t[s.t.length - 1]), [s, sel]);
  const pace = PACE_SPORTS.has(a.sport);
  const pb = paceBasis(a.sport, units);
  const rows: { label: string; value: number | null; format: (n: number) => string; unit?: string }[] = [
    { label: 'Duration', value: st.durationSec, format: (n) => formatDuration(n, 'hms') },
    ...(st.distanceM != null && st.distanceM > 0 ? [{ label: 'Distance', value: st.distanceM / (pb.meters === 100 || pb.meters === 500 ? 1 : 1000), format: (n: number) => formatNumber(n, pb.meters === 100 || pb.meters === 500 ? 0 : 2), unit: pb.meters === 100 || pb.meters === 500 ? 'm' : 'km' }] : []),
    ...(st.avgPower != null ? [{ label: 'Avg power', value: st.avgPower, format: (n: number) => formatNumber(n, 0), unit: 'W' }] : []),
    ...(st.weightedPower != null && a.sport === 'bike' ? [{ label: 'Weighted Power', value: st.weightedPower, format: (n: number) => formatNumber(n, 0), unit: 'W' }] : []),
    ...(st.avgHr != null ? [{ label: 'Avg HR', value: st.avgHr, format: (n: number) => formatNumber(n, 0), unit: 'bpm' }] : []),
    ...(st.avgSpeed != null && st.avgSpeed > 0
      ? pace
        ? [{ label: a.sport === 'row' ? 'Split' : 'Pace', value: paceSec(st.distanceM && st.durationSec ? st.distanceM / st.durationSec : st.avgSpeed, a.sport, units), format: fmtPaceSec(a.sport), unit: pb.label }]
        : [{ label: 'Speed', value: st.avgSpeed * (units.system === 'imperial' ? 2.23694 : 3.6), format: (n: number) => formatNumber(n, 1), unit: units.system === 'imperial' ? 'mph' : 'km/h' }]
      : []),
    ...(st.avgCadence != null ? [{ label: 'Cadence', value: st.avgCadence, format: (n: number) => formatNumber(n, 0), unit: a.sport === 'bike' ? 'rpm' : 'spm' }] : []),
    ...(st.elevationGain != null && st.elevationGain > 0 ? [{ label: 'Elevation', value: st.elevationGain, format: (n: number) => formatNumber(n, 0), unit: 'm' }] : []),
  ];
  return (
    <div className="relative flex flex-col gap-4 py-1">
      <div className="flex h-7 items-center justify-between gap-2">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div key={sel ? 'sel' : 'all'} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6, transition: tween('fast', 'in') }} transition={spring.smooth} className="flex items-center gap-2">
            <span className="text-body-sm font-medium text-fg-1">{sel ? 'Selection' : 'Whole activity'}</span>
            {sel && <span className="text-body-sm text-fg-3">{formatDuration(sel.startSec, 'hms')}–{formatDuration(sel.endSec, 'hms')}</span>}
          </motion.div>
        </AnimatePresence>
        <AnimatePresence>
          {sel && (
            <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96, transition: tween('fast', 'in') }} transition={spring.snappy} className="flex items-center gap-1">
              <Button size="sm" variant="ghost" icon={<Maximize2 />} onClick={onZoom}>Zoom</Button>
              <IconButton size="sm" label="Clear selection" icon={<X />} onClick={onClear} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className={cn('grid gap-x-4 gap-y-3', side ? 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-2' : 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-8')}>
        {rows.map((r) => (
          <div key={r.label} className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-body-sm text-fg-3">{r.label}</span>
            <span className="flex items-baseline gap-1 text-body-lg text-fg-1">
              {r.value == null ? '—' : <Ticker value={r.value} format={r.format} />}
              {r.unit && <span className="text-body-sm text-fg-3">{r.unit}</span>}
            </span>
          </div>
        ))}
      </div>
      {!sel && <p className="mt-auto text-body-sm text-fg-3">Drag on the chart or click a lap to inspect a range.</p>}
    </div>
  );
}

// ───────────────────────────── laps ─────────────────────────────

function workRest(laps: Lap[], sport: Sport): ('work' | 'rest' | 'steady')[] {
  const val = (l: Lap) => (sport === 'bike' || sport === 'row' ? l.avgPower : l.avgSpeedMps) ?? null;
  const vals = laps.map(val).filter((v): v is number => v != null && v > 0);
  if (vals.length < 3) return laps.map((l) => (l.isRest ? 'rest' : 'steady'));
  const sorted = [...vals].sort((x, y) => x - y);
  const med = sorted[Math.floor(sorted.length / 2)];
  const spread = (sorted[sorted.length - 1] - sorted[0]) / med;
  if (spread < 0.15) return laps.map((l) => (l.isRest ? 'rest' : 'steady'));
  const hi = sorted[0] + (sorted[sorted.length - 1] - sorted[0]) * 0.6;
  return laps.map((l) => {
    if (l.isRest) return 'rest';
    const v = val(l);
    if (v == null) return 'steady';
    return v >= hi ? 'work' : v < med * 0.85 ? 'rest' : 'steady';
  });
}

export function LapsSection({ a }: { a: ActivityDetail }) {
  if (a.strengthSets?.length) return <StrengthSection a={a} />;
  if (a.sport === 'swim') return <SwimSection a={a} />;
  return <LapTable a={a} />;
}

const th = 'h-9 border-b border-line-1 px-3 text-label font-medium text-fg-3 first:pl-0 last:pr-0';
const td = 'h-11 border-b border-line-1 px-3 text-body first:pl-0 last:pr-0';

function useLapInteraction() {
  const [selected, setSelected] = useState<number | null>(null);
  const span = (l: Lap) => ({ startSec: l.startSec, endSec: l.startSec + l.durationSec });
  return {
    selected,
    rowProps: (l: Lap) => ({
      tabIndex: 0,
      onPointerEnter: () => lapBus.hover(span(l)),
      onPointerLeave: () => lapBus.hover(null),
      onFocus: () => lapBus.hover(span(l)),
      onBlur: () => lapBus.hover(null),
      onClick: () => {
        const next = selected === l.index ? null : l.index;
        setSelected(next);
        lapBus.select(next == null ? null : span(l));
        lapBus.hover(null);
      },
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          (e.currentTarget as HTMLElement).click();
        }
      },
      'aria-selected': selected === l.index,
    }),
  };
}

function LapTable({ a }: { a: ActivityDetail }) {
  const units = useUnits();
  const kinds = useMemo(() => workRest(a.laps, a.sport), [a.laps, a.sport]);
  const { selected, rowProps } = useLapInteraction();
  const pace = PACE_SPORTS.has(a.sport);
  const hasPower = a.laps.some((l) => l.avgPower);
  const hasCad = a.laps.some((l) => l.avgCadence);
  const hasElev = a.laps.some((l) => l.elevationGainM);
  const pb = paceBasis(a.sport, units);
  return (
    <Section stagger={false} id="laps" title="Laps" description={kinds.includes('work') ? 'Recoveries are dimmed. Hover a lap to see it on the chart; click to select it.' : 'Hover a lap to highlight it on the chart; click to select it.'}>
      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <table className="w-full min-w-[640px] border-separate border-spacing-0 text-body">
          <thead>
            <tr className="text-right">
              <th className={cn(th, 'w-14 text-left')}>Lap</th>
              <th className={th}>Time</th>
              <th className={th}>Distance</th>
              {hasPower && <th className={th}>{a.sport === 'bike' ? 'Power · weighted' : 'Power'}</th>}
              {(pace || !hasPower) && <th className={th}>{pace ? (a.sport === 'row' ? 'Split' : 'Pace') : 'Speed'}</th>}
              <th className={th}>HR</th>
              {hasCad && <th className={th}>Cadence</th>}
              {hasElev && <th className={th}>Elevation</th>}
            </tr>
          </thead>
          <tbody>
            {a.laps.map((l, i) => {
              const k = kinds[i];
              const sel = selected === l.index;
              const dim = k === 'rest';
              return (
                <tr key={l.index} {...rowProps(l)} className={cn('group relative cursor-default text-right outline-none transition-colors duration-(--dur-fast) hover:bg-surface-2 focus-visible:bg-surface-2', sel && 'bg-surface-3', dim && 'text-fg-3')}>
                  <td className={cn(td, 'text-left')}>
                    <span className={dim ? 'text-fg-3' : k === 'work' ? 'font-medium text-fg-1' : 'text-fg-1'}>{l.index + 1}</span>
                    {k === 'work' && <span className="ml-2 text-body-sm text-fg-3">Work</span>}
                    {k === 'rest' && <span className="ml-2 text-body-sm text-fg-4">Easy</span>}
                  </td>
                  <td className={cn(td, dim ? 'text-fg-3' : 'text-fg-1')}>{formatDuration(l.durationSec, 'hms')}</td>
                  <td className={cn(td, 'text-fg-2')}>{l.distanceM ? (pb.meters >= 500 && a.sport !== 'row' ? formatNumber(l.distanceM / 1000, 2) + ' km' : formatNumber(l.distanceM, 0) + ' m') : '—'}</td>
                  {hasPower && (
                    <td className={cn(td, dim ? 'text-fg-3' : 'text-fg-1')}>
                      {l.avgPower != null ? formatNumber(l.avgPower, 0) : '—'}
                      {a.sport === 'bike' && l.weightedPower != null && <span className="text-fg-3"> / {formatNumber(l.weightedPower, 0)}</span>}
                      <span className="text-fg-3"> W</span>
                    </td>
                  )}
                  {(pace || !hasPower) && (
                    <td className={cn(td, dim ? 'text-fg-3' : 'text-fg-1')}>
                      {l.avgSpeedMps ? (pace ? paceParts(l.avgSpeedMps, a.sport, units).value : formatNumber(l.avgSpeedMps * 3.6, 1)) : '—'}
                      <span className="text-fg-3"> {pace ? pb.label : 'km/h'}</span>
                    </td>
                  )}
                  <td className={cn(td, 'text-fg-2')}>{l.avgHr != null ? formatNumber(l.avgHr, 0) : '—'}{l.maxHr != null && <span className="text-fg-4"> · {l.maxHr}</span>}</td>
                  {hasCad && <td className={cn(td, 'text-fg-2')}>{l.avgCadence != null ? formatNumber(l.avgCadence, 0) : '—'}</td>}
                  {hasElev && <td className={cn(td, 'text-fg-2')}>{l.elevationGainM != null ? `${formatNumber(l.elevationGainM, 0)} m` : '—'}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

const STROKE: Record<string, string> = { free: 'Free', freestyle: 'Free', back: 'Back', backstroke: 'Back', breast: 'Breast', breaststroke: 'Breast', fly: 'Fly', butterfly: 'Fly', im: 'IM', mixed: 'IM', drill: 'Drill', choice: 'Choice', kick: 'Kick' };

function SwimSection({ a }: { a: ActivityDetail }) {
  const units = useUnits();
  const { selected, rowProps } = useLapInteraction();
  const work = a.laps.filter((l) => !l.isRest && (l.distanceM ?? 0) > 0);
  const restAfter = (i: number) => {
    const n = a.laps[i + 1];
    return n?.isRest ? n.durationSec : null;
  };
  return (
    <Section stagger={false} id="laps" title="Intervals" description={`${work.length} swims · ${formatNumber(a.poolLengthM ?? 25, 0)} m pool. Rest is shown after each interval.`}>
      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <table className="w-full min-w-[600px] border-separate border-spacing-0 text-body">
          <thead>
            <tr className="text-right">
              <th className={cn(th, 'w-14 text-left')}>#</th>
              <th className={cn(th, 'text-left')}>Stroke</th>
              <th className={th}>Lengths</th>
              <th className={th}>Distance</th>
              <th className={th}>Time</th>
              <th className={th}>Pace</th>
              <th className={th}>SWOLF</th>
              <th className={th}>HR</th>
              <th className={th}>Rest</th>
            </tr>
          </thead>
          <tbody>
            {a.laps.map((l, i) => {
              if (l.isRest || !(l.distanceM ?? 0)) return null;
              const n = work.indexOf(l) + 1;
              const sel = selected === l.index;
              const drill = l.stroke === 'drill' || l.stroke === 'kick';
              const rest = restAfter(i);
              return (
                <tr key={l.index} {...rowProps(l)} className={cn('cursor-default text-right outline-none transition-colors duration-(--dur-fast) hover:bg-surface-2 focus-visible:bg-surface-2', sel && 'bg-surface-3')}>
                  <td className={cn(td, 'text-left', drill ? 'text-fg-3' : 'text-fg-1')}>
                    {n}
                  </td>
                  <td className={cn(td, 'text-left', drill ? 'text-fg-3' : 'text-fg-1')}>{STROKE[l.stroke ?? ''] ?? (l.stroke ? l.stroke : '—')}</td>
                  <td className={cn(td, 'text-fg-2')}>{l.lengths ?? '—'}</td>
                  <td className={cn(td, 'text-fg-1')}>{formatNumber(l.distanceM, 0)} m</td>
                  <td className={cn(td, 'text-fg-1')}>{formatDuration(l.movingSec ?? l.durationSec, 'hms')}</td>
                  <td className={cn(td, 'text-fg-1')}>{l.avgSpeedMps ? paceParts(l.avgSpeedMps, 'swim', units).value : '—'}<span className="text-fg-3"> /100</span></td>
                  <td className={cn(td, 'text-fg-2')}>{l.swolf ?? '—'}</td>
                  <td className={cn(td, 'text-fg-2')}>{l.avgHr ?? '—'}</td>
                  <td className={cn(td, 'text-fg-3')}>{rest != null ? formatDuration(rest, 'hms') : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
      return { exercise, sets, volume, e1rm };
    });
  }, [a.strengthSets]);
  const maxVol = Math.max(1, ...groups.map((g) => g.volume));
  const kg = (v: number) => (units.system === 'imperial' ? v / 0.4536 : v);
  const wu = units.system === 'imperial' ? 'lb' : 'kg';
  return (
    <Section stagger={false} id="laps" title="Sets" description={`${groups.length} exercises · ${a.totalSets ?? 0} sets · ${a.totalReps ?? 0} reps`}>
      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <table className="w-full min-w-[620px] border-separate border-spacing-0 text-body">
          <thead>
            <tr className="text-right">
              <th className={cn(th, 'text-left')}>Exercise</th>
              <th className={cn(th, 'text-left')}>Sets × reps × weight</th>
              <th className={cn(th, 'w-48')}>Volume</th>
              <th className={th}>Est. 1RM</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.exercise} className="text-right transition-colors duration-(--dur-fast) hover:bg-surface-2">
                <td className={cn(td, 'text-left font-medium text-fg-1')}>{g.exercise}</td>
                <td className={cn(td, 'text-left')}>
                  <span className="flex flex-wrap gap-1 py-2">
                    {g.sets.map((s, i) => (
                      <span key={i} className="rounded-xs bg-surface-2 px-1.5 text-body-sm text-fg-1">
                        {s.reps}
                        {s.weightKg ? <span className="text-fg-3"> × {formatNumber(kg(s.weightKg), 1, { trim: true })}</span> : null}
                      </span>
                    ))}
                  </span>
                </td>
                <td className={td}>
                  <span className="flex items-center justify-end gap-2">
                    <span className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-3">
                      <motion.span className="block h-full origin-left rounded-full bg-fg-2" initial={{ scaleX: 0 }} animate={{ scaleX: g.volume / maxVol }} transition={spring.smooth} />
                    </span>
                    <span className="w-20 text-fg-1">{g.volume ? `${formatNumber(kg(g.volume), 0)} ${wu}` : '—'}</span>
                  </span>
                </td>
                <td className={cn(td, 'text-fg-1')}>{g.e1rm ? `${formatNumber(kg(g.e1rm), 1)} ${wu}` : <span className="text-fg-3">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ───────────────────────────── zones ─────────────────────────────

function split(z: ZoneTime[]): { easy: number; moderate: number; hard: number } {
  const n = z.length;
  const out = { easy: 0, moderate: 0, hard: 0 };
  for (const x of z) {
    const bucket = n >= 7 ? (x.zone <= 2 ? 'easy' : x.zone === 3 ? 'moderate' : 'hard') : x.zone <= 2 ? 'easy' : x.zone === 3 ? 'moderate' : 'hard';
    out[bucket] += x.seconds;
  }
  return out;
}

export function ZonesSection({ a }: { a: ActivityDetail }) {
  const units = useUnits();
  const t = a.thresholdsUsed;
  const opts = [
    ...(a.zones.power ? [{ value: 'power' as const, label: 'Power' }] : []),
    ...(a.zones.pace ? [{ value: 'pace' as const, label: 'Pace' }] : []),
    ...(a.zones.hr ? [{ value: 'hr' as const, label: 'Heart rate' }] : []),
  ];
  const [kind, setKind] = useState(opts[0]?.value ?? 'hr');
  const zones = a.zones[kind] ?? [];
  const sp = split(zones);
  const total = sp.easy + sp.moderate + sp.hard || 1;
  const basis =
    kind === 'power' ? (a.sport === 'row' ? (t.rowThresholdW ? `Threshold ${t.rowThresholdW} W` : null) : t.ftp ? `FTP ${t.ftp} W` : null)
    : kind === 'pace' ? (a.sport === 'swim' ? (t.swimCssMps ? `CSS ${paceParts(t.swimCssMps, 'swim', units).value} /100m` : null) : t.runThresholdMps ? `Threshold ${paceParts(t.runThresholdMps, a.sport, units).value} ${paceBasis(a.sport, units).label}` : null)
    : t.lthr ? `LTHR ${t.lthr} bpm` : null;
  const fmtRange = (lo: number | null, hi: number | null) => {
    if (kind === 'pace') {
      const f = (v: number | null) => (v ? paceParts(v, a.sport, units).value : '');
      return hi == null ? `> ${f(lo)}` : lo == null ? `< ${f(hi)}` : `${f(hi)}–${f(lo)}`;
    }
    const u = kind === 'power' ? 'W' : 'bpm';
    const r = (v: number) => Math.round(v);
    return hi == null ? `${r(lo ?? 0)}+ ${u}` : lo == null ? `< ${r(hi)} ${u}` : `${r(lo)}–${r(hi)} ${u}`;
  };
  return (
    <Section
      stagger={false}
      id="zones"
      title="Time in zones"
      description={basis ? <>Zones from <span className="text-fg-1">{basis}</span> on this date.</> : undefined}
      actions={opts.length > 1 ? <Segmented size="sm" aria-label="Zone model" value={kind} onValueChange={setKind} options={opts} /> : undefined}
    >
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_240px]">
        <ZoneBars key={kind} zones={zones} formatRange={fmtRange} />
        <div className="flex flex-col gap-4">
          <span className="text-body-sm text-fg-3">Easy · moderate · hard</span>
          <SplitBar easy={sp.easy} moderate={sp.moderate} hard={sp.hard} height={8} />
          <div className="grid grid-cols-3 gap-2">
            {(['easy', 'moderate', 'hard'] as const).map((k) => (
              <div key={k} className="flex flex-col">
                <span className="text-stat-sm text-fg-1">
                  <Ticker value={(sp[k] / total) * 100} format={(n) => `${Math.round(n)}%`} />
                </span>
                <span className="text-body-sm text-fg-3" title={formatDuration(sp[k], 'hms')}>{k}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}

// ───────────────────────────── peaks ─────────────────────────────

const KEY_DURS = [5, 60, 300, 1200, 3600];
const durLabel = (s: number) => (s < 60 ? `${s} s` : s < 3600 ? `${s / 60} min` : `${s / 3600} h`);
const EFFORT_LABEL: Record<number, string> = { 400: '400 m', 500: '500 m', 1000: '1 km', 1609: '1 mi', 1609.344: '1 mi', 2000: '2 km', 5000: '5 km', 6000: '6 km', 10000: '10 km', 21097.5: 'Half', 21097: 'Half', 42195: 'Marathon', 100: '100 m', 200: '200 m', 1500: '1500 m', 3800: '3.8 km', 1900: '1.9 km' };

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="mt-0.5 inline-flex items-center gap-1 text-body-sm text-fg-2">
      <Award className="size-3" aria-hidden />
      {children}
    </span>
  );
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
      <Section stagger={false} id="peaks" title="Peaks" description="Best average power for each duration in this session, against your 90-day and all-time bests.">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div>
            <PowerCurve series={series} weightKg={a.thresholdsUsed.weightKg} loading={q.isPending} height={280} />
          </div>
          <PeakTable
            head={['Duration', 'This', '90 d', 'All-time']}
            rows={rows.map((r) => ({
              key: r.d,
              label: durLabel(r.d),
              me: `${Math.round(r.me!.value)} W`,
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
  const pts = (r: typeof r90) => (useSpeed ? r?.speed ?? [] : effortsToPoints(r?.efforts ?? []));
  const mine = useSpeed ? a.peaks.speed! : effortsToPoints(efforts);
  const speedSeries: CurveSeries[] =
    mine.length > 1
      ? [
          { id: 'this', label: 'This activity', points: mine, variant: 'primary' },
          ...(pts(r90).length > 1 ? [{ id: '90d', label: '90-day best', points: pts(r90), variant: 'secondary' as const }] : []),
          ...(pts(rAll).length > 1 ? [{ id: 'all', label: 'All-time', points: pts(rAll), variant: 'comparison' as const }] : []),
        ]
      : [];
  return (
    <Section stagger={false} id="peaks" title={efforts.length ? 'Best efforts' : 'Peaks'} description={efforts.length ? 'Fastest time over each distance within this session.' : 'Highest average heart rate held for each duration.'}>
      <div className={cn('grid gap-10', (speedSeries.length || !efforts.length) && 'lg:grid-cols-[minmax(0,1fr)_320px]')}>
        {speedSeries.length > 0 ? (
          <div>
            <PaceCurve series={speedSeries} per={pb.meters} loading={q.isPending} height={280} />
          </div>
        ) : !efforts.length && a.peaks.hr?.length ? (
          <div>
            <EffortCurve series={[{ id: 'hr', label: 'Heart rate', points: a.peaks.hr, variant: 'primary' }]} unit="bpm" zeroBased={false} height={260} />
          </div>
        ) : null}
        {efforts.length > 0 && (
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
        )}
      </div>
    </Section>
  );
}

function PeakTable({ head, rows }: { head: string[]; rows: { key: number; label: string; me: string; sub?: string; b90: string; all: string; badge: string | null }[] }) {
  return (
    <div>
      <table className="w-full border-separate border-spacing-0">
        <thead>
          <tr className="text-right">
            {head.map((h, i) => (
              <th key={h} className={cn(th, i === 0 && 'text-left')}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="text-right">
              <td className={cn(td, 'py-2 text-left')}>
                <div className="text-body text-fg-1">{r.label}</div>
                {r.badge && <Badge>{r.badge}</Badge>}
              </td>
              <td className={cn(td, 'text-fg-1')}>
                {r.me}
                {r.sub && <div className="text-body-sm text-fg-3">{r.sub}</div>}
              </td>
              <td className={cn(td, 'text-fg-2')}>{r.b90}</td>
              <td className={cn(td, 'text-fg-3')}>{r.all}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

