/** /trends/sport/$sport — sport volume, efficiency (output at a reference HR) and decoupling trends. */
import { SPORT_META, type Sport } from '@cadence/core';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { curveMonotoneX, line } from 'd3-shape';
import { motion } from 'motion/react';
import { useMemo } from 'react';
import { MorphPath, WeeklyBars, useChartSize } from '@/charts';
import { formatDateMedium, formatNumber, formatPace } from '@/lib/format';
import { useUnits } from '@/lib/units';
import { spring } from '@/motion/tokens';
import { SportGlyph, StatRow, StatTile } from '@/ui';
import { filterWeeks, rangeWeeks, trimLeading, useSportTrend, useWeekly } from './data';
import { fmtHours } from './Overview';
import { ChartCard, InlineError, RangeControl, TrendsFrame, useTrendsSearch } from './shared';

const route = getRouteApi('/_app/trends/sport/$sport');

interface Pt {
  activityId: string;
  date: string;
  durationSec: number;
  outputAtRefHr?: number;
  decouplingPct?: number;
}

export function TrendsSportPage() {
  const { sport } = route.useParams();
  const { search, set } = useTrendsSearch();
  const range = search.range ?? '6m';
  const n = rangeWeeks(range);
  const q = useSportTrend(sport, Math.min(104, n));
  const weekly = useWeekly(104);
  const units = useUnits();
  const navigate = useNavigate();
  const weeks = useMemo(() => filterWeeks(trimLeading(weekly.data ?? []), sport).slice(-n), [weekly.data, sport, n]);
  const power = sport === 'bike' || sport === 'row';
  const fmtOut = (v: number) => (power ? `${Math.round(v)} W` : formatPace(v, sport, units));
  const pts = (q.data?.points ?? []) as Pt[];
  const eff = pts.filter((p) => p.outputAtRefHr != null).map((p) => ({ date: p.date, v: p.outputAtRefHr!, id: p.activityId }));
  const dec = pts.filter((p) => p.decouplingPct != null && p.durationSec >= 3600).map((p) => ({ date: p.date, v: p.decouplingPct!, id: p.activityId }));
  const half = (xs: { v: number }[], first: boolean) => {
    const h = xs.slice(first ? 0 : Math.floor(xs.length / 2), first ? Math.floor(xs.length / 2) : undefined);
    return h.length ? h.reduce((a, x) => a + x.v, 0) / h.length : null;
  };
  const effA = half(eff, true);
  const effB = half(eff, false);
  const sum = (f: (w: (typeof weeks)[number]) => number) => weeks.reduce((a, w) => a + f(w), 0);

  return (
    <TrendsFrame title={SPORT_META[sport].label} back eyebrow={<span className="inline-flex items-center gap-1.5"><SportGlyph sport={sport} size={14} /> Sport trends</span>} toolbar={<RangeControl value={range} onChange={(r) => set({ range: r })} />}>
      <ChartCard title="Weekly volume" question={`${SPORT_META[sport].label} only. Click a week to review it.`}>
        <WeeklyBars weeks={weeks} loading={!weekly.data} metric={search.metric ?? 'hours'} onMetricChange={(m) => set({ metric: m })} stack="total" height={240} onWeekClick={(w) => navigate({ to: '/week/$isoWeek', params: { isoWeek: w } })} />
      </ChartCard>
      <StatRow columns={4}>
        <StatTile label="Sessions" value={sum((w) => w.bySport[0]?.doneCount ?? 0)} format={(v) => formatNumber(v, 0)} />
        <StatTile label="Time" value={sum((w) => w.doneSec) / 3600} format={fmtHours} unit="h" />
        <StatTile label="Load" value={sum((w) => w.doneLoad)} format={(v) => formatNumber(v, 0)} />
        <StatTile label={power ? `Power at ${q.data?.refHr ?? '—'} bpm` : `Pace at ${q.data?.refHr ?? '—'} bpm`} value={effB} format={fmtOut} delta={effA && effB ? effB / effA - 1 : null} good={!!effA && !!effB && effB > effA} deltaSuffix="2nd half vs 1st" />
      </StatRow>
      {q.isError ? (
        <InlineError onRetry={() => q.refetch()} />
      ) : (
        <section className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          <ChartCard title="Efficiency" question={`${power ? 'Power' : 'Pace'} you hold at ${q.data?.refHr ?? 'a reference'} bpm, per session (dots) and its trend. Up means fitter.`}>
            <PointsTrend points={eff} fmt={fmtOut} higherIsBetter />
          </ChartCard>
          <ChartCard title="Aerobic decoupling" question="Drift of output vs heart rate in sessions over an hour. Under 5 % means a solid aerobic base.">
            <PointsTrend points={dec} fmt={(v) => `${formatNumber(v, 1)}%`} refLine={5} />
          </ChartCard>
        </section>
      )}
      {(['bike', 'run', 'swim', 'row'] as Sport[]).includes(sport) && (
        <p className="text-body-sm text-fg-3">
          Best efforts and thresholds live on{' '}
          <Link to="/trends/peaks" search={{ sport }} className="text-fg-1 underline decoration-line-3 underline-offset-3">
            Peaks
          </Link>
          .
        </p>
      )}
    </TrendsFrame>
  );
}

/** Dots per session + a rolling-mean line, date x-axis. */
function PointsTrend({ points, fmt, higherIsBetter, refLine }: { points: { date: string; v: number; id: string }[]; fmt: (v: number) => string; higherIsBetter?: boolean; refLine?: number }) {
  const [ref, size] = useChartSize<HTMLDivElement>();
  const navigate = useNavigate();
  const W = size.width;
  const H = 200;
  const L = { l: 56, r: 12, t: 10, b: 22 };
  if (!points.length) return <p className="py-10 text-center text-body text-fg-3">Not enough sessions with heart rate in this range.</p>;
  const xs = points.map((p) => Date.parse(p.date));
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs, x0 + 864e5);
  let lo = Math.min(...points.map((p) => p.v), refLine ?? Infinity);
  let hi = Math.max(...points.map((p) => p.v), refLine ?? -Infinity);
  const pad = (hi - lo || 1) * 0.12;
  lo -= pad;
  hi += pad;
  const x = (t: number) => L.l + ((t - x0) / (x1 - x0)) * (W - L.l - L.r);
  const y = (v: number) => L.t + (1 - (v - lo) / (hi - lo)) * (H - L.t - L.b);
  const roll = points.map((_, i) => {
    const win = points.slice(Math.max(0, i - 4), i + 1);
    return win.reduce((a, p) => a + p.v, 0) / win.length;
  });
  const d = line<number>().x((_, i) => x(xs[i])).y((v) => y(v)).curve(curveMonotoneX)(roll) ?? '';
  const ticks = [lo + pad, (lo + hi) / 2, hi - pad];
  void higherIsBetter;
  return (
    <div ref={ref} className="w-full" style={{ height: H }}>
      {W > 0 && (
        <svg width={W} height={H} className="block overflow-visible" role="img" aria-label={`Trend from ${fmt(roll[0])} to ${fmt(roll[roll.length - 1])}`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L.l} x2={W - L.r} y1={y(t)} y2={y(t)} className="stroke-line-1" />
              <text x={L.l - 8} y={y(t)} textAnchor="end" dominantBaseline="central" className="fill-fg-3 text-label font-normal">
                {fmt(t)}
              </text>
            </g>
          ))}
          {refLine != null && <line x1={L.l} x2={W - L.r} y1={y(refLine)} y2={y(refLine)} className="stroke-fg-3" strokeDasharray="3 3" />}
          <text x={L.l} y={H - 4} className="fill-fg-3 text-label font-normal">{formatDateMedium(points[0].date)}</text>
          <text x={W - L.r} y={H - 4} textAnchor="end" className="fill-fg-3 text-label font-normal">{formatDateMedium(points[points.length - 1].date)}</text>
          {points.map((p, i) => (
            <motion.circle key={p.id} cx={x(xs[i])} cy={y(p.v)} r={3} className="cursor-pointer fill-fg-2 hover:fill-fg-1" initial={{ opacity: 0 }} animate={{ opacity: 0.9 }} transition={{ ...spring.smooth, delay: Math.min(i * 0.004, 0.24) }} onClick={() => navigate({ to: '/activities/$id', params: { id: p.id } })}>
              <title>{`${formatDateMedium(p.date)} · ${fmt(p.v)}`}</title>
            </motion.circle>
          ))}
          <MorphPath d={d} fill="none" className="stroke-accent" style={{ strokeWidth: 2 }} />
        </svg>
      )}
    </div>
  );
}
