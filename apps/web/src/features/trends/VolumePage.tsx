/** /trends/volume — weekly ↔ monthly volume by sport, per-sport table (WoW / YoY), year-over-year lines. */
import { SPORT_META, type Sport, type WeekSummary } from '@cadence/core';
import { useNavigate } from '@tanstack/react-router';
import { line, curveMonotoneX } from 'd3-shape';
import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { MorphPath, WeeklyBars, useChartSize } from '@/charts';
import { cn } from '@/lib/cn';
import { formatNumber, formatPercent } from '@/lib/format';
import { distanceUnit, useUnits } from '@/lib/units';
import { spring } from '@/motion/tokens';
import { DeltaBadge, Segmented, SportGlyph } from '@/ui';
import { filterWeeks, METRIC_NAME, rangeWeeks, trimLeading, useWeekly, type Metric } from './data';
import { fmtHours } from './Overview';
import { ChartCard, InlineError, RangeControl, SportChips, TrendsFrame, useTrendsSearch } from './shared';

type Period = 'week' | 'month';

/** Merge weeks into calendar months (a week belongs to the month of its Thursday). */
function toMonths(weeks: WeekSummary[]): WeekSummary[] {
  const map = new Map<string, WeekSummary[]>();
  for (const w of weeks) {
    const thu = new Date(Date.parse(w.startDate) + 3 * 864e5).toISOString().slice(0, 7);
    (map.get(thu) ?? map.set(thu, []).get(thu)!).push(w);
  }
  const months = [...map.entries()].map(([m, ws]) => {
    const sum = (f: (w: WeekSummary) => number) => ws.reduce((a, w) => a + f(w), 0);
    const bySport = new Map<Sport, WeekSummary['bySport'][number]>();
    ws.forEach((w) =>
      w.bySport.forEach((s) => {
        const c = bySport.get(s.sport);
        if (!c) bySport.set(s.sport, { ...s });
        else for (const k of ['plannedSec', 'doneSec', 'plannedLoad', 'doneLoad', 'plannedDistanceM', 'doneDistanceM', 'plannedCount', 'doneCount', 'elevationGainM'] as const) c[k] += s[k];
      }),
    );
    const lastW = ws[ws.length - 1];
    return {
      ...lastW,
      isoWeek: ws[0].isoWeek,
      startDate: `${m}-01`,
      plannedSec: sum((w) => w.plannedSec),
      doneSec: sum((w) => w.doneSec),
      plannedLoad: sum((w) => w.plannedLoad),
      doneLoad: sum((w) => w.doneLoad),
      plannedDistanceM: sum((w) => w.plannedDistanceM),
      doneDistanceM: sum((w) => w.doneDistanceM),
      projectedSec: sum((w) => w.projectedSec),
      projectedLoad: sum((w) => w.projectedLoad),
      targetHours: undefined,
      targetLoad: undefined,
      bySport: [...bySport.values()],
      keyDone: sum((w) => w.keyDone),
      keyPlanned: sum((w) => w.keyPlanned),
    } satisfies WeekSummary;
  });
  return months.map((m, i) => ({
    ...m,
    wowSec: i && months[i - 1].doneSec ? m.doneSec / months[i - 1].doneSec - 1 : null,
    wowLoad: i && months[i - 1].doneLoad ? m.doneLoad / months[i - 1].doneLoad - 1 : null,
    wowDistanceM: i && months[i - 1].doneDistanceM ? m.doneDistanceM / months[i - 1].doneDistanceM - 1 : null,
  }));
}

export function TrendsVolumePage() {
  const { search, set } = useTrendsSearch();
  const range = search.range ?? '12w';
  const metric: Metric = search.metric ?? 'hours';
  const sport = search.sport;
  const [period, setPeriod] = useState<Period>('week');
  const weekly = useWeekly(104);
  const navigate = useNavigate();
  const raw = useMemo(() => trimLeading(weekly.data ?? []), [weekly.data]);
  const all = useMemo(() => filterWeeks(raw, sport), [raw, sport]);
  const n = period === 'month' ? Math.max(rangeWeeks(range), 26) : rangeWeeks(range);
  const weeks = useMemo(() => all.slice(-n), [all, n]);
  const bars = useMemo(() => (period === 'month' ? toMonths(weeks) : weeks), [weeks, period]);
  const sports = useMemo(() => {
    const s = new Set<Sport>();
    raw.forEach((w) => w.bySport.forEach((x) => x.doneSec > 0 && s.add(x.sport)));
    return [...s];
  }, [raw]);

  return (
    <TrendsFrame
      title="Volume"
      back
      eyebrow="Hours · Load · Distance by sport"
      controls={
        <>
          <RangeControl value={range} onChange={(r) => set({ range: r })} />
          <Segmented aria-label="Period" size="sm" value={period} onValueChange={setPeriod} options={[{ value: 'week', label: 'Weekly' }, { value: 'month', label: 'Monthly' }]} />
          <SportChips sports={sports} value={sport} onChange={(s) => set({ sport: s })} />
        </>
      }
    >
      <section>
        <ChartCard title={period === 'week' ? 'Weekly volume' : 'Monthly volume'} question={period === 'week' ? 'Stacked by sport. Dashed = planned, line = 4-week average. Click a week to review it.' : 'Calendar months (a week counts in the month of its Thursday).'}>
          {weekly.isError ? (
            <InlineError onRetry={() => weekly.refetch()} />
          ) : (
            <WeeklyBars
              key={period}
              weeks={bars}
              loading={!weekly.data}
              metric={metric}
              onMetricChange={(m) => set({ metric: m })}
              height={300}
              showRollingAvg={period === 'week'}
              onWeekClick={period === 'week' ? (w) => navigate({ to: '/week/$isoWeek', params: { isoWeek: w } }) : undefined}
            />
          )}
        </ChartCard>
      </section>
      <section>
        <ChartCard title="By sport" question={`Totals over the range, with this week vs last and this range vs the same range a year earlier.`}>
          <SportTable raw={raw} n={rangeWeeks(range)} metric={metric} />
        </ChartCard>
      </section>
      <section>
        <YearOverYear raw={all} metric={metric} />
      </section>
    </TrendsFrame>
  );
}

function SportTable({ raw, n, metric }: { raw: WeekSummary[]; n: number; metric: Metric }) {
  const units = useUnits();
  const du = distanceUnit('run', units);
  const cur = raw.slice(-n);
  const curWeek = raw.at(-1);
  const prevWeek = raw.at(-2);
  // Same range a year earlier (by ISO week offset of 52).
  const lyEnd = raw.length - 52;
  const ly = lyEnd > 0 ? raw.slice(Math.max(0, lyEnd - n), lyEnd) : [];
  const val = (s: WeekSummary['bySport'][number] | undefined) => (!s ? 0 : metric === 'hours' ? s.doneSec : metric === 'load' ? s.doneLoad : s.doneDistanceM);
  const sum = (ws: WeekSummary[], sp: Sport, f: (s: WeekSummary['bySport'][number]) => number) => ws.reduce((a, w) => a + (w.bySport.find((x) => x.sport === sp) ? f(w.bySport.find((x) => x.sport === sp)!) : 0), 0);
  const sports = [...new Set(cur.flatMap((w) => w.bySport.filter((s) => s.doneSec > 0).map((s) => s.sport)))];
  const rows = sports
    .map((sp) => ({
      sp,
      sec: sum(cur, sp, (s) => s.doneSec),
      dist: sum(cur, sp, (s) => s.doneDistanceM),
      load: sum(cur, sp, (s) => s.doneLoad),
      count: sum(cur, sp, (s) => s.doneCount),
      wow: (() => {
        const a = val(curWeek?.bySport.find((x) => x.sport === sp));
        const b = val(prevWeek?.bySport.find((x) => x.sport === sp));
        return b ? a / b - 1 : null;
      })(),
      yoy: (() => {
        const b = sum(ly, sp, val);
        return b ? sum(cur, sp, val) / b - 1 : null;
      })(),
    }))
    .sort((a, b) => b.sec - a.sec);
  const totalSec = rows.reduce((a, r) => a + r.sec, 0) || 1;
  if (!rows.length) return <p className="text-body text-fg-3">No completed sessions in this range.</p>;
  return (
    <div className="relative -mx-4 overflow-x-auto md:mx-0">
      <table className="w-full min-w-[680px] text-left">
        <thead>
          <tr className="border-b border-line-1 text-micro uppercase text-fg-3">
            {['Sport', 'Sessions', 'Time', 'Distance', 'Load', 'Share', `${METRIC_NAME[metric]} WoW`, `${METRIC_NAME[metric]} YoY`].map((h, i) => (
              <th key={h} className={cn('px-4 py-2 font-[600]', i > 0 && 'text-right')}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono text-mono">
          {rows.map((r) => (
            <tr key={r.sp} className="border-b border-line-1 last:border-0">
              <td className="px-4 py-2.5">
                <span className="inline-flex items-center gap-2 font-sans text-body text-fg-1">
                  <SportGlyph sport={r.sp} size={16} /> {SPORT_META[r.sp].label}
                </span>
              </td>
              <td className="px-4 py-2.5 text-right text-fg-1">{r.count}</td>
              <td className="px-4 py-2.5 text-right text-fg-1">{fmtHours(r.sec / 3600)}</td>
              <td className="px-4 py-2.5 text-right text-fg-1">{SPORT_META[r.sp].hasDistance ? `${formatNumber(r.dist / du.mPer, 0)} ${du.unit}` : '—'}</td>
              <td className="px-4 py-2.5 text-right text-accent-ink">{formatNumber(r.load, 0)}</td>
              <td className="px-4 py-2.5 text-right text-fg-2">{formatPercent(r.sec / totalSec)}</td>
              <td className="px-4 py-2.5 text-right">
                <DeltaBadge value={r.wow} size="sm" />
              </td>
              <td className="px-4 py-2.5 text-right">
                <DeltaBadge value={r.yoy} size="sm" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function YearOverYear({ raw, metric }: { raw: WeekSummary[]; metric: Metric }) {
  const [mode, setMode] = useState<'cumulative' | 'weekly'>('cumulative');
  const f = (w: WeekSummary) => (metric === 'hours' ? w.doneSec / 3600 : metric === 'load' ? w.doneLoad : w.doneDistanceM / 1000);
  const year = raw.at(-1)?.isoWeek.slice(0, 4) ?? '';
  const prevYear = String(Number(year) - 1);
  const series = (y: string) => {
    const ws = raw.filter((w) => w.isoWeek.startsWith(y));
    const out: (number | null)[] = Array(53).fill(null);
    let acc = 0;
    ws.forEach((w) => {
      const i = Number(w.isoWeek.slice(6)) - 1;
      acc += f(w);
      out[i] = mode === 'cumulative' ? acc : f(w);
    });
    return out;
  };
  const a = series(year);
  const b = series(prevYear);
  const lastA = [...a].reverse().find((v) => v != null) ?? 0;
  const idxA = a.reduce<number>((m, v, i) => (v != null ? i : m), -1);
  const bAt = idxA >= 0 ? b.slice(0, idxA + 1).reduce<number | null>((m, v) => (v != null ? v : m), null) : null;
  const unit = metric === 'hours' ? 'h' : metric === 'load' ? '' : 'km';
  const fmt = (v: number) => (metric === 'hours' ? fmtHours(v) : formatNumber(v, 0));
  return (
    <ChartCard
      title={mode === 'cumulative' ? `${METRIC_NAME[metric]} this year vs last` : `Weekly ${METRIC_NAME[metric].toLowerCase()}, ${year} vs ${prevYear}`}
      question={
        mode === 'cumulative'
          ? `${year} to date: ${fmt(lastA)}${unit ? ' ' + unit : ''}${bAt != null ? ` vs ${fmt(bAt)} by the same week of ${prevYear}` : ` (no ${prevYear} data at this point)`}.`
          : 'Same ISO week, two years overlaid.'
      }
      actions={<Segmented aria-label="Year view" size="sm" value={mode} onValueChange={setMode} options={[{ value: 'cumulative', label: 'Cumulative' }, { value: 'weekly', label: 'Weekly' }]} />}
    >
      <YearLines a={a} b={b} labelA={year} labelB={prevYear} fmt={fmt} />
    </ChartCard>
  );
}

function YearLines({ a, b, labelA, labelB, fmt }: { a: (number | null)[]; b: (number | null)[]; labelA: string; labelB: string; fmt: (v: number) => string }) {
  const [ref, size] = useChartSize<HTMLDivElement>();
  const W = size.width;
  const H = 220;
  const L = { l: 40, r: 56, t: 12, b: 22 };
  const max = Math.max(1, ...a.map((v) => v ?? 0), ...b.map((v) => v ?? 0)) * 1.08;
  const x = (i: number) => L.l + (i / 52) * (W - L.l - L.r);
  const y = (v: number) => L.t + (1 - v / max) * (H - L.t - L.b);
  const path = (s: (number | null)[]) => line<number | null>().defined((v) => v != null).x((_, i) => x(i)).y((v) => y(v!)).curve(curveMonotoneX)(s) ?? '';
  const last = (s: (number | null)[]) => {
    const i = s.reduce<number>((m, v, k) => (v != null ? k : m), -1);
    return i >= 0 ? { x: x(i), y: y(s[i]!), v: s[i]! } : null;
  };
  const la = last(a);
  const lb = last(b);
  const ticks = [0, 0.5, 1].map((t) => t * max);
  const months = ['Jan', 'Apr', 'Jul', 'Oct'];
  return (
    <div ref={ref} className="w-full" style={{ height: H }}>
      {W > 0 && (
        <svg width={W} height={H} className="block overflow-visible" role="img" aria-label={`${labelA} vs ${labelB}`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L.l} x2={W - L.r} y1={y(t)} y2={y(t)} className="stroke-line-1" />
              <text x={L.l - 8} y={y(t)} textAnchor="end" dominantBaseline="central" className="fill-fg-3 font-mono text-[11px]">
                {fmt(t)}
              </text>
            </g>
          ))}
          {months.map((m, i) => (
            <text key={m} x={x(i * 13)} y={H - 4} className="fill-fg-3 font-mono text-[11px]">
              {m}
            </text>
          ))}
          <MorphPath d={path(b)} fill="none" transition={spring.gentle} className="stroke-fg-3" style={{ strokeWidth: 1.25, strokeDasharray: '2 3' }} />
          <MorphPath d={path(a)} fill="none" transition={spring.gentle} className="stroke-accent" style={{ strokeWidth: 2 }} />
          {lb && (
            <text x={lb.x + 6} y={lb.y} dominantBaseline="central" className="fill-fg-3 font-mono text-[11px]">
              ’{labelB.slice(2)} {fmt(lb.v)}
            </text>
          )}
          {la && (
            <g>
              <motion.circle cx={la.x} cy={la.y} r={3.5} className="fill-accent" initial={false} animate={{ cx: la.x, cy: la.y }} transition={spring.gentle} />
              <text x={la.x + 7} y={la.y - (lb && Math.abs(lb.y - la.y) < 14 ? 8 : 0)} dominantBaseline="central" className="fill-accent-ink font-mono text-[11px]">
                ’{labelA.slice(2)} {fmt(la.v)}
              </text>
            </g>
          )}
        </svg>
      )}
    </div>
  );
}

