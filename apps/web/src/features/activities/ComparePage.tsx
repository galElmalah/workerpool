/**
 * /activities/$id/compare?with=id2,id3 — overlaid traces (aligned by time or distance) for power,
 * HR and pace, plus a delta table of summary metrics with CompareBars.
 */
import type { Activity, ActivityDetail, ActivityStreams, Sport } from '@cadence/core/domain';
import { useQueries, useQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { scaleLinear } from 'd3-scale';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Plus, RotateCcw, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { CompareBars, lowerBound, rollingMeanF64, toF64, useChartSize } from '@/charts';
import { Button, EmptyState, IconButton, Page, PageHeader, Popover, Section, Segmented, Skeleton, SportGlyph } from '@/ui';
import { api, call, raw } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDayShort, formatDuration, formatNumber, monthShort, paceParts } from '@/lib/format';
import { useUnits } from '@/lib/units';
import { links } from '@/shell/links';
import { detailQuery, streamsKey } from './data';

const route = getRouteApi('/_app/activities/$id/compare');
const PACE = new Set<Sport>(['run', 'swim', 'row', 'walk', 'hike']);
type Metric = 'power' | 'hr' | 'speed';
const STROKES = [
  { cls: '', c: 'var(--color-accent)', w: 2, dash: undefined, label: 'text-accent-ink' },
  { cls: '', c: 'var(--color-fg-1)', w: 1.5, dash: undefined, label: 'text-fg-1' },
  { cls: '', c: 'var(--color-fg-3)', w: 1.25, dash: '4 3', label: 'text-fg-2' },
];

export function ActivityComparePage() {
  const { id } = route.useParams();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const others = (search.with ?? '').split(',').filter((x) => x && x !== id).slice(0, 2);
  const ids = [id, ...others];
  const details = useQueries({ queries: ids.map((x) => detailQuery(x)) });
  const streams = useQueries({
    queries: ids.map((x, i) => ({
      queryKey: streamsKey(x),
      queryFn: async () => (await (await raw(`/activities/${x}/streams`)).json()) as ActivityStreams,
      enabled: !!details[i].data?.hasStreams,
      staleTime: Infinity,
    })),
  });
  const base = details[0].data;
  const setWith = (next: string[]) => navigate({ search: { with: next.join(',') || undefined }, replace: true });

  return (
    <Page
      header={
        <PageHeader
          title="Compare"
          eyebrow={base ? base.title : 'Activity'}
          back={links.activity(id)}
          breadcrumb={[{ label: 'Activities', link: links.activities() }, ...(base ? [{ label: base.title, link: links.activity(id) }] : [])]}
        />
      }
    >
      {details[0].isError ? (
        <EmptyState title="Couldn’t load this activity" action={<Button icon={<RotateCcw />} onClick={() => details[0].refetch()}>Retry</Button>} />
      ) : !base ? (
        <Skeleton className="h-[520px]" radius="lg" />
      ) : (
        <>
          <Section stagger>
            <div className="flex flex-wrap items-center gap-2">
              {details.map((d, i) =>
                d.data ? (
                  <span key={d.data.id} className="flex h-9 items-center gap-2 rounded-md border border-line-2 bg-surface-1 pr-1 pl-3">
                    <svg width="18" height="6" aria-hidden><line x1="0" y1="3" x2="18" y2="3" style={{ stroke: STROKES[i].c }} strokeWidth={STROKES[i].w} strokeDasharray={STROKES[i].dash} /></svg>
                    <SportGlyph sport={d.data.sport} size={14} />
                    <Link {...links.activity(d.data.id)} className="max-w-56 truncate text-label text-fg-1 hover:underline">{d.data.title}</Link>
                    <span className="text-mono-sm text-fg-3">{formatDayShort(d.data.localDate)} {monthShort(d.data.localDate)}</span>
                    {i > 0 ? <IconButton size="sm" label="Remove" icon={<X />} onClick={() => setWith(others.filter((o) => o !== d.data!.id))} /> : <span className="w-2" />}
                  </span>
                ) : (
                  <Skeleton key={i} className="h-9 w-56" />
                ),
              )}
              {others.length < 2 && <AddPicker base={base} exclude={ids} onPick={(x) => setWith([...others, x])} />}
            </div>
          </Section>
          {others.length === 0 ? (
            <EmptyState title="Pick something to compare" action={<AddPicker base={base} exclude={ids} onPick={(x) => setWith([x])} />}>
              Similar sessions of the same sport are suggested first.
            </EmptyState>
          ) : (
            <>
              <Overlay acts={details.map((d) => d.data)} streams={streams.map((s) => s.data)} />
              <DeltaTable acts={details.map((d) => d.data).filter(Boolean) as ActivityDetail[]} />
            </>
          )}
        </>
      )}
    </Page>
  );
}

function AddPicker({ base, exclude, onPick }: { base: ActivityDetail; exclude: string[]; onPick: (id: string) => void }) {
  const q = useQuery({
    queryKey: ['activities', 'list', { sport: base.sport, compare: true }],
    queryFn: () => call(api.activities.$get({ query: { sport: base.sport, limit: '40' } as never })) as Promise<{ items: Activity[] }>,
  });
  const d = base.movingSec || base.durationSec;
  const suggestions = (q.data?.items ?? [])
    .filter((a) => !exclude.includes(a.id))
    .map((a) => ({ a, score: Math.abs((a.movingSec || a.durationSec) / d - 1) + (a.subSport === base.subSport ? 0 : 0.3) + (a.title === base.title ? -0.5 : 0) }))
    .sort((x, y) => x.score - y.score)
    .slice(0, 8);
  return (
    <Popover title="Add an activity" showTitle trigger={<Button size="sm" icon={<Plus />}>Add activity</Button>}>
      {(close) => (
        <div className="flex w-80 flex-col gap-0.5">
          {q.isPending && <Skeleton className="h-24" />}
          {suggestions.map(({ a }) => (
            <button key={a.id} type="button" onClick={() => { onPick(a.id); close(); }} className="flex items-center gap-2 rounded-sm px-2 py-2 text-left transition-colors duration-(--dur-fast) hover:bg-surface-3">
              <SportGlyph sport={a.sport} subSport={a.subSport} size={16} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body text-fg-1">{a.title}</span>
                <span className="text-mono-sm text-fg-3">{formatDayShort(a.localDate)} {monthShort(a.localDate)} · {formatDuration(a.movingSec || a.durationSec)} · {Math.round(a.load)} load</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

// ───────────────────────────── overlay chart ─────────────────────────────

interface Series {
  x: Float64Array;
  y: Float64Array;
}

function Overlay({ acts, streams }: { acts: (ActivityDetail | undefined)[]; streams: (ActivityStreams | undefined)[] }) {
  const units = useUnits();
  const base = acts[0]!;
  const pace = PACE.has(base.sport);
  const avail = (m: Metric) => streams.some((s) => s?.[m]?.some((v) => v != null));
  const metrics = (['power', 'hr', 'speed'] as Metric[]).filter(avail);
  const [picked, setMetric] = useState<Metric | null>(null);
  const metric: Metric = picked && metrics.includes(picked) ? picked : (metrics[0] ?? 'hr');
  const [axis, setAxis] = useState<'time' | 'distance'>('time');
  const [ref, size] = useChartSize<HTMLDivElement>();
  const H = 280;
  const PADL = 44;
  const PADB = 22;
  const series: (Series | null)[] = useMemo(
    () =>
      streams.map((s) => {
        if (!s || !s[metric]) return null;
        const y = rollingMeanF64(toF64(s[metric]), 30);
        const x = axis === 'distance' && s.distance ? toF64(s.distance) : toF64(s.t);
        // bucket to ~700 points
        const n = x.length;
        const step = Math.max(1, Math.floor(n / 700));
        const xs: number[] = [];
        const ys: number[] = [];
        for (let i = 0; i < n; i += step) {
          if (x[i] === x[i] && y[i] === y[i]) {
            xs.push(x[i]);
            ys.push(y[i]);
          }
        }
        return { x: Float64Array.from(xs), y: Float64Array.from(ys) };
      }),
    [streams, metric, axis],
  );
  const loading = streams.some((s, i) => !s && acts[i]?.hasStreams);
  const valid = series.filter(Boolean) as Series[];
  const xMax = Math.max(1, ...valid.map((s) => s.x[s.x.length - 1] ?? 0));
  const ys = valid.flatMap((s) => Array.from(s.y));
  ys.sort((a, b) => a - b);
  const lo = ys.length ? ys[Math.floor(ys.length * 0.01)] : 0;
  const hi = ys.length ? ys[Math.floor(ys.length * 0.995)] : 1;
  const w = size.width;
  const sx = scaleLinear().domain([0, xMax]).range([PADL, Math.max(PADL + 10, w - 8)]);
  const sy = scaleLinear().domain(metric === 'power' ? [0, hi * 1.08] : [lo * 0.95, hi * 1.04]).range([H - PADB, 8]).nice();
  const fmtY = (v: number) => (metric === 'speed' ? (pace ? paceParts(v, base.sport, units).value : formatNumber(v * 3.6, 0)) : formatNumber(v, 0));
  const unit = metric === 'power' ? 'W' : metric === 'hr' ? 'bpm' : pace ? paceParts(1, base.sport, units).unit : 'km/h';
  const ruleRef = useRef<SVGLineElement>(null);
  const readRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const atRef = useRef<HTMLSpanElement>(null);
  const onMove = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = Math.max(PADL, Math.min(w - 8, e.clientX - r.left));
    const xv = sx.invert(px);
    ruleRef.current?.setAttribute('x1', String(px));
    ruleRef.current?.setAttribute('x2', String(px));
    ruleRef.current?.setAttribute('opacity', '1');
    if (atRef.current) atRef.current.textContent = axis === 'time' ? formatDuration(xv, 'hms') : `${formatNumber(xv / 1000, 2)} km`;
    series.forEach((s, i) => {
      const el = readRefs.current[i];
      if (!el) return;
      if (!s) return void (el.textContent = '—');
      const k = Math.min(s.x.length - 1, lowerBound(s.x, xv));
      el.textContent = xv > s.x[s.x.length - 1] ? '—' : fmtY(s.y[k]);
    });
  };
  const onLeave = () => {
    ruleRef.current?.setAttribute('opacity', '0');
    if (atRef.current) atRef.current.textContent = 'move over the chart';
    series.forEach((s, i) => {
      const el = readRefs.current[i];
      if (el && s) {
        let t = 0;
        for (const v of s.y) t += v;
        el.textContent = `avg ${fmtY(t / s.y.length)}`;
      }
    });
  };
  const path = (s: Series) => {
    let d = '';
    for (let i = 0; i < s.x.length; i++) d += `${i ? 'L' : 'M'}${sx(s.x[i]).toFixed(1)} ${sy(s.y[i]).toFixed(1)}`;
    return d;
  };
  const avgOf = (s: Series | null) => (s ? Array.from(s.y).reduce((a, b) => a + b, 0) / s.y.length : null);
  return (
    <Section
      title="Overlay"
      description="30-second smoothing. Aligned from the start of each activity."
      actions={
        <div className="flex flex-wrap gap-2">
          {metrics.length > 1 && <Segmented size="sm" aria-label="Metric" value={metric} onValueChange={setMetric} options={metrics.map((m) => ({ value: m, label: m === 'power' ? 'Power' : m === 'hr' ? 'Heart rate' : pace ? 'Pace' : 'Speed' }))} />}
          {streams.every((s) => !s || s.distance) && <Segmented size="sm" aria-label="Align by" value={axis} onValueChange={setAxis} options={[{ value: 'time', label: 'Time' }, { value: 'distance', label: 'Distance' }]} />}
        </div>
      }
    >
      <div className="rounded-lg border border-line-2 bg-surface-1 p-4">
        <div className="mb-3 flex flex-wrap items-end gap-x-6 gap-y-2">
          <div className="flex flex-col">
            <span className="text-micro text-fg-3">Cursor</span>
            <span ref={atRef} className="text-mono text-fg-2">move over the chart</span>
          </div>
          {acts.map((a, i) =>
            a ? (
              <div key={a.id} className="flex flex-col">
                <span className="flex items-center gap-1.5 text-micro text-fg-3">
                  <svg width="14" height="6" aria-hidden><line x1="0" y1="3" x2="14" y2="3" style={{ stroke: STROKES[i].c }} strokeWidth={STROKES[i].w} strokeDasharray={STROKES[i].dash} /></svg>
                  {formatDayShort(a.localDate)} {monthShort(a.localDate)}
                </span>
                <span className="flex items-baseline gap-1">
                  <span ref={(el) => void (readRefs.current[i] = el)} className={cn('text-stat-sm', STROKES[i].label)}>
                    {series[i] ? `avg ${fmtY(avgOf(series[i])!)}` : '—'}
                  </span>
                  <span className="text-label text-fg-3">{unit}</span>
                </span>
              </div>
            ) : null,
          )}
        </div>
        <div ref={ref} className="relative w-full" style={{ height: H }}>
          {loading ? (
            <Skeleton className="h-full w-full" radius="md" />
          ) : w > 0 ? (
            <svg width={w} height={H} className="touch-pan-y select-none" onPointerMove={onMove} onPointerLeave={onLeave} role="img" aria-label={`Overlay of ${metric} for ${acts.length} activities`}>
              {sy.ticks(4).map((t) => (
                <g key={t}>
                  <line x1={PADL} x2={w - 8} y1={sy(t)} y2={sy(t)} style={{ stroke: 'var(--color-line-1)' }} />
                  <text x={PADL - 8} y={sy(t)} dy="0.32em" textAnchor="end" className="fill-fg-3 text-[11px]">{fmtY(t)}</text>
                </g>
              ))}
              {sx.ticks(Math.max(2, Math.floor(w / 110))).map((t) => (
                <text key={t} x={sx(t)} y={H - 4} textAnchor="middle" className="fill-fg-3 text-[11px]">{axis === 'time' ? formatDuration(t, 'clock') : `${formatNumber(t / 1000, 0)}`}</text>
              ))}
              {[...series].reverse().map((s, ri) => {
                const i = series.length - 1 - ri;
                if (!s) return null;
                return (
                  <path
                    key={`${i}-${metric}-${axis}`}
                    d={path(s)}
                    fill="none"
                    style={{ stroke: STROKES[i].c }}
                    strokeWidth={STROKES[i].w}
                    strokeDasharray={STROKES[i].dash}
                    strokeLinejoin="round"
                  />
                );
              })}
              <line ref={ruleRef} y1={8} y2={H - PADB} style={{ stroke: 'var(--color-fg-3)' }} opacity={0} />
            </svg>
          ) : null}
        </div>
      </div>
    </Section>
  );
}

// ───────────────────────────── delta table ─────────────────────────────

function DeltaTable({ acts }: { acts: ActivityDetail[] }) {
  const units = useUnits();
  const base = acts[0];
  const pace = PACE.has(base.sport);
  type Row = { label: string; get: (a: Activity) => number | undefined | null; fmt: (v: number) => string; unit?: string; lowerBetter?: boolean };
  const all: Row[] = [
    { label: 'Duration', get: (a) => a.movingSec || a.durationSec, fmt: (v) => formatDuration(v, 'hms') },
    { label: 'Distance', get: (a) => a.distanceM, fmt: (v) => formatNumber(v / 1000, 2), unit: 'km' },
    { label: 'Load', get: (a) => a.load, fmt: (v) => formatNumber(v, 0) },
    { label: 'Intensity', get: (a) => a.intensityFactor, fmt: (v) => v.toFixed(2) },
    { label: 'Weighted Power', get: (a) => a.weightedPower, fmt: (v) => formatNumber(v, 0), unit: 'W' },
    { label: 'Avg power', get: (a) => a.avgPower, fmt: (v) => formatNumber(v, 0), unit: 'W' },
    ...(pace ? [{ label: base.sport === 'row' ? 'Split' : 'Pace', get: (a: Activity) => a.avgSpeedMps, fmt: (v: number) => paceParts(v, base.sport, units).value, unit: paceParts(1, base.sport, units).unit }] : []),
    { label: 'Avg HR', get: (a) => a.avgHr, fmt: (v) => formatNumber(v, 0), unit: 'bpm', lowerBetter: true },
    { label: 'Efficiency', get: (a) => a.efficiency, fmt: (v) => v.toFixed(base.sport === 'bike' ? 2 : 3) },
    { label: 'Decoupling', get: (a) => a.decouplingPct, fmt: (v) => formatNumber(v, 1), unit: '%', lowerBetter: true },
    { label: 'Elevation', get: (a) => a.elevationGainM, fmt: (v) => formatNumber(v, 0), unit: 'm' },
  ];
  const rows = all.filter((r) => acts.some((a) => r.get(a) != null));
  const other = acts[1];
  const bars = other
    ? rows
        .filter((r) => ['Duration', 'Load', 'Avg power', 'Pace', 'Split', 'Avg HR'].includes(r.label) && r.get(base) != null && r.get(other) != null)
        .map((r) => ({ label: r.label, current: r.get(base)!, previous: r.get(other)!, format: r.fmt, unit: r.unit, accent: r.label === 'Load' }))
    : [];
  return (
    <Section title="Side by side" description="Deltas are against the first activity.">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="overflow-x-auto rounded-lg border border-line-2 bg-surface-1">
          <table className="w-full min-w-[520px] border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="h-9 border-b border-line-1 px-4 text-left text-micro text-fg-3">Metric</th>
                {acts.map((a, i) => (
                  <th key={a.id} className="h-9 border-b border-line-1 px-4 text-right text-micro text-fg-3">
                    <span className="inline-flex items-center gap-1.5">
                      <svg width="14" height="6" aria-hidden><line x1="0" y1="3" x2="14" y2="3" style={{ stroke: STROKES[i].c }} strokeWidth={STROKES[i].w} strokeDasharray={STROKES[i].dash} /></svg>
                      {formatDayShort(a.localDate)} {monthShort(a.localDate)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="transition-colors duration-(--dur-fast) hover:bg-surface-2">
                  <td className="h-10 border-b border-line-1 px-4 text-label text-fg-2">{r.label}</td>
                  {acts.map((a, i) => {
                    const v = r.get(a);
                    const b = r.get(base);
                    const d = i > 0 && v != null && b != null && b !== 0 ? v / b - 1 : null;
                    return (
                      <td key={a.id} className="h-10 border-b border-line-1 px-4 text-right text-mono text-fg-1">
                        {v == null ? <span className="text-fg-4">—</span> : r.fmt(v)}
                        {v != null && r.unit && <span className="text-fg-3"> {r.unit}</span>}
                        {d != null && (
                          <span className={cn('ml-2 inline-flex items-center text-mono-sm', Math.abs(d) < 0.01 ? 'text-fg-3' : d > 0 ? 'font-[600] text-fg-1' : 'text-fg-2')}>
                            {Math.abs(d) < 0.01 ? <ArrowRight className="size-3" /> : d > 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
                            {Math.abs(d) < 0.01 ? '±0%' : `${d > 0 ? '+' : '−'}${Math.round(Math.abs(d) * 100)}%`}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {other && bars.length > 0 && (
          <div className="rounded-lg border border-line-2 bg-surface-1 p-4">
            <CompareBars items={bars} currentLabel={formatDayShort(base.localDate)} previousLabel={formatDayShort(other.localDate)} />
          </div>
        )}
      </div>
    </Section>
  );
}
