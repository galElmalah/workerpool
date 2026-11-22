/** /trends/wellness — HRV with baseline band, resting HR, sleep, weight; shared crosshair + Load overlay. */
import type { WellnessDay } from '@cadence/core';
import { addDays } from '@cadence/core/time';
import { useMemo } from 'react';
import { WellnessChart, createHoverSync, useHoverValue, type HoverSync } from '@/charts';
import { formatDateMedium, formatDuration, formatNumber } from '@/lib/format';
import { DeltaBadge, Segmented } from '@/ui';
import { useApiToday, useWellness, type TrendRange } from './data';
import { ChartCard, InlineError, TrendsFrame, useTrendsSearch } from './shared';

const W_RANGES: { value: TrendRange; label: string; days: number }[] = [
  { value: '6w', label: '6W', days: 42 },
  { value: '3m', label: '90D', days: 90 },
  { value: '6m', label: '6M', days: 182 },
  { value: '1y', label: '1Y', days: 365 },
];

export function TrendsWellnessPage() {
  const { search, set } = useTrendsSearch();
  const range = W_RANGES.some((r) => r.value === search.range) ? search.range! : '3m';
  const days = W_RANGES.find((r) => r.value === range)!.days;
  const { today } = useApiToday();
  const q = useWellness(today ? addDays(today, -(days - 1)) : undefined, today);
  const sync = useMemo(() => createHoverSync<string>(), []);
  const list = (q.data?.days ?? []) as unknown as (WellnessDay & { load: number; hrvBaseline: { lowMs: number | null; highMs: number | null; b7Ms: number | null; status: string }; restingHrTrend: { rhr7: number | null; rhr60: number | null; elevated: boolean }; readiness: { state: string; reasons: string[] } })[];
  const loads = useMemo(() => list.map((d) => ({ date: d.date, load: d.load })), [list]);
  const mean = (xs: (number | undefined)[]) => {
    const v = xs.filter((x): x is number => typeof x === 'number');
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const last7 = list.slice(-7);
  const prev7 = list.slice(-14, -7);
  const latest = list.at(-1);
  const stats = [
    { label: 'HRV · 7-day', v: mean(last7.map((d) => d.hrvMs)), p: mean(prev7.map((d) => d.hrvMs)), fmt: (x: number) => `${formatNumber(x, 0)} ms`, sub: latest?.hrvBaseline.lowMs ? `baseline ${formatNumber(latest.hrvBaseline.lowMs, 0)}–${formatNumber(latest.hrvBaseline.highMs, 0)} ms` : '' },
    { label: 'Resting HR · 7-day', v: mean(last7.map((d) => d.restingHr)), p: mean(prev7.map((d) => d.restingHr)), fmt: (x: number) => `${formatNumber(x, 0)} bpm`, sub: latest?.restingHrTrend.rhr60 ? `60-day ${formatNumber(latest.restingHrTrend.rhr60, 0)} bpm${latest.restingHrTrend.elevated ? ' · elevated' : ''}` : '' },
    { label: 'Sleep · 7-day', v: mean(last7.map((d) => d.sleepSec)), p: mean(prev7.map((d) => d.sleepSec)), fmt: (x: number) => formatDuration(x, 'clock'), sub: 'per night' },
    { label: 'Weight', v: [...list].reverse().find((d) => d.weightKg)?.weightKg ?? null, p: mean(prev7.map((d) => d.weightKg)), fmt: (x: number) => `${formatNumber(x, 1)} kg`, sub: 'latest' },
  ];
  return (
    <TrendsFrame
      title="Wellness"
      back
      eyebrow={latest ? `Readiness today: ${latest.readiness.state === 'green' ? 'ready' : latest.readiness.state === 'amber' ? 'take care' : latest.readiness.state === 'red' ? 'back off' : 'unknown'} · ${q.data?.readinessLabel ?? ''}` : 'HRV · resting HR · sleep · weight'}
      controls={<Segmented aria-label="Range" size="sm" value={range} onValueChange={(r) => set({ range: r })} options={W_RANGES.map((r) => ({ value: r.value, label: r.label }))} />}
    >
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-line-1 bg-surface-1 p-4">
            <span className="truncate text-micro uppercase text-fg-3">{s.label}</span>
            <span className="text-stat-md text-fg-1">{s.v == null ? '—' : s.fmt(s.v)}</span>
            <span className="flex min-h-5 flex-wrap items-center gap-1.5 text-body-sm text-fg-3">
              <DeltaBadge value={s.v != null && s.p ? s.v / s.p - 1 : null} size="sm" />
              {s.sub}
            </span>
          </div>
        ))}
      </section>
      <section>
        <ChartCard title="Body signals" question="Dots = daily, line = 7-day mean, band = 60-day baseline. Faint bars under HRV are daily Load: does a hard block push HRV down?" aside={<Readout sync={sync} list={list} />}>
          {q.isError ? <InlineError onRetry={() => q.refetch()} /> : <WellnessChart days={list} loads={loads} loading={!q.data} today={today} sync={sync as HoverSync<string>} panelHeight={96} />}
        </ChartCard>
      </section>
    </TrendsFrame>
  );
}

function Readout({ sync, list }: { sync: HoverSync<string>; list: (WellnessDay & { load: number })[] }) {
  const d = useHoverValue(sync);
  const day = d ? list.find((x) => x.date === d) : list.at(-1);
  if (!day) return null;
  return (
    <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1 border-t border-line-1 pt-3 font-mono text-mono-sm text-fg-3">
      <span className="font-sans text-label text-fg-1">{formatDateMedium(day.date)}</span>
      <span>HRV <span className="text-fg-1">{day.hrvMs ?? '—'}</span></span>
      <span>RHR <span className="text-fg-1">{day.restingHr ?? '—'}</span></span>
      <span>Sleep <span className="text-fg-1">{day.sleepSec ? formatDuration(day.sleepSec) : '—'}</span></span>
      <span>Weight <span className="text-fg-1">{day.weightKg ?? '—'}</span></span>
      <span>Load <span className="text-accent-ink">{formatNumber(day.load, 0)}</span></span>
    </div>
  );
}
