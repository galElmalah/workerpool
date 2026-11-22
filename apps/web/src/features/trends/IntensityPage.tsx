/** /trends/intensity — weekly easy/moderate/hard, time in zone per sport, key sessions per week. */
import { SPORT_META, type Sport, type ZoneTime } from '@cadence/core';
import { useNavigate } from '@tanstack/react-router';
import { Star } from 'lucide-react';
import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { IntensityDistribution, ZoneBars, type IntensitySplit } from '@/charts';
import { cn } from '@/lib/cn';
import { formatDayMonth, formatIsoWeek } from '@/lib/format';
import { spring } from '@/motion/tokens';
import { DeltaBadge, Segmented, SportGlyph } from '@/ui';
import { rangeWeeks, trimLeading, useIntensity, useWeekly } from './data';
import { ChartCard, InlineError, RangeControl, TrendsFrame, useTrendsSearch } from './shared';

type Channel = 'power' | 'hr' | 'pace';
interface SportZones {
  sport: Sport;
  seconds: number;
  hr?: ZoneTime[];
  power?: ZoneTime[];
  pace?: ZoneTime[];
}
const DIST_LABEL: Record<string, string> = { polarized: 'Polarized', pyramidal: 'Pyramidal', threshold: 'Threshold-heavy', mixed: 'Mixed', hiit: 'HIIT-heavy', base: 'Base' };

export function TrendsIntensityPage() {
  const { search, set } = useTrendsSearch();
  const range = search.range ?? '12w';
  const n = Math.min(104, rangeWeeks(range));
  const q = useIntensity(n);
  const weekly = useWeekly(104);
  const navigate = useNavigate();
  const items: IntensitySplit[] = useMemo(
    () => (q.data?.weeks ?? []).filter((w) => w.easy + w.moderate + w.hard > 0).map((w) => ({ key: w.isoWeek, label: formatDayMonth(w.startDate), easy: w.easy, moderate: w.moderate, hard: w.hard })),
    [q.data],
  );
  const total = q.data?.total;
  const hardShare = (ws: typeof items) => {
    const t = ws.reduce((a, w) => a + w.easy + w.moderate + w.hard, 0);
    return t ? ws.reduce((a, w) => a + w.hard + w.moderate, 0) / t : null;
  };
  const last4 = hardShare(items.slice(-4));
  const prev4 = hardShare(items.slice(-8, -4));
  const weeks = useMemo(() => trimLeading(weekly.data ?? []).slice(-n), [weekly.data, n]);

  return (
    <TrendsFrame title="Intensity" back eyebrow="How hard the training was" controls={<RangeControl value={range} onChange={(r) => set({ range: r })} />}>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Distribution" value={total?.distribution ? (DIST_LABEL[total.distribution] ?? total.distribution) : '—'} />
        <Tile label="Easy" value={total?.pct ? `${Math.round(total.pct.easy)}%` : '—'} sub="target ≈ 80%" />
        <Tile label="Moderate" value={total?.pct ? `${Math.round(total.pct.moderate)}%` : '—'} sub="the grey zone" />
        <Tile
          label="Moderate + hard, last 4 wk"
          value={last4 != null ? `${Math.round(last4 * 100)}%` : '—'}
          sub={<span className="inline-flex items-center gap-1.5"><DeltaBadge value={last4 != null && prev4 ? last4 / prev4 - 1 : null} size="sm" /> vs prior 4</span>}
        />
      </section>
      <section>
        <ChartCard title="Weekly distribution" question="Time in easy / moderate / hard each week, from zones when recorded. Click a week to review it.">
          {q.isError ? <InlineError onRetry={() => q.refetch()} /> : <IntensityDistribution items={items} loading={!q.data} height={220} onItemClick={(w) => navigate({ to: '/week/$isoWeek', params: { isoWeek: w } })} />}
        </ChartCard>
      </section>
      <section className="grid gap-6 lg:grid-cols-12">
        <ChartCard className="lg:col-span-7" title="Time in zone by sport" question="Where the minutes went, per sport and zone model.">
          <ZonesBySport list={(q.data?.bySport ?? []) as unknown as SportZones[]} />
        </ChartCard>
        <ChartCard className="lg:col-span-5" title="Key sessions per week" question="Hit / planned. The sessions that matter most.">
          <KeyPerWeek weeks={weeks.map((w) => ({ isoWeek: w.isoWeek, done: w.keyDone, planned: w.keyPlanned }))} onOpen={(w) => navigate({ to: '/week/$isoWeek', params: { isoWeek: w } })} />
        </ChartCard>
      </section>
    </TrendsFrame>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-line-1 bg-surface-1 p-4">
      <span className="truncate text-micro uppercase text-fg-3">{label}</span>
      <span className="text-stat-md text-fg-1">{value}</span>
      <span className="min-h-5 text-body-sm text-fg-3">{sub}</span>
    </div>
  );
}

function ZonesBySport({ list }: { list: SportZones[] }) {
  const sports = list.filter((s) => s.hr || s.power || s.pace);
  const [sport, setSport] = useState<Sport | null>(null);
  const cur = sports.find((s) => s.sport === sport) ?? sports[0];
  const channels = cur ? (['power', 'pace', 'hr'] as Channel[]).filter((c) => cur[c]?.length) : [];
  const [ch, setCh] = useState<Channel>('power');
  const channel = channels.includes(ch) ? ch : channels[0];
  if (!cur) return <p className="text-body text-fg-3">No zone data in this range.</p>;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented aria-label="Sport" size="sm" value={cur.sport} onValueChange={setSport} options={sports.map((s) => ({ value: s.sport, label: <span className="inline-flex items-center gap-1.5"><SportGlyph sport={s.sport} size={14} />{SPORT_META[s.sport].label}</span> }))} />
        {channels.length > 1 && <Segmented aria-label="Zone model" size="sm" value={channel} onValueChange={setCh} options={channels.map((c) => ({ value: c, label: c === 'hr' ? 'Heart rate' : c === 'power' ? 'Power' : 'Pace' }))} />}
      </div>
      <motion.div key={`${cur.sport}-${channel}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={spring.smooth}>
        <ZoneBars zones={cur[channel] ?? []} />
      </motion.div>
    </div>
  );
}

function KeyPerWeek({ weeks, onOpen }: { weeks: { isoWeek: string; done: number; planned: number }[]; onOpen: (w: string) => void }) {
  const max = Math.max(1, ...weeks.map((w) => Math.max(w.done, w.planned)));
  const rows = weeks.slice(-12).reverse();
  return (
    <ul className="flex flex-col gap-1">
      {rows.map((w, i) => (
        <li key={w.isoWeek}>
          <button type="button" onClick={() => onOpen(w.isoWeek)} className="grid w-full grid-cols-[44px_1fr_44px] items-center gap-3 rounded-sm px-1 py-1 text-left hover:bg-surface-2">
            <span className="font-mono text-mono-sm text-fg-3">{formatIsoWeek(w.isoWeek)}</span>
            <span className="flex items-center gap-1">
              {Array.from({ length: Math.max(w.planned, w.done) }, (_, k) => (
                <motion.span key={k} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...spring.smooth, delay: Math.min((i * 3 + k) * 0.012, 0.24) }}>
                  <Star className={cn('size-3.5', k < w.done ? 'fill-accent text-accent-ink' : 'text-fg-4')} strokeWidth={1.75} />
                </motion.span>
              ))}
              {!w.planned && !w.done && <span className="text-body-sm text-fg-4">none</span>}
              <span className="sr-only">{`${w.done} of ${w.planned}`}</span>
              <span aria-hidden style={{ width: 0 }} data-max={max} />
            </span>
            <span className="text-right font-mono text-mono-sm text-fg-2">
              {w.done}/{w.planned}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
