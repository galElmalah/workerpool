/** /trends/fitness — large Fitness · Fatigue · Form chart, form zones, ramp strip, what-if, weekly table. */
import type { FitnessDay, FormZone, Sport, WeekSummary } from '@cadence/core';
import { addDays } from '@cadence/core/time';
import { Link } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { DEFAULT_FORM_BANDS, FitnessChart, FITNESS_RANGES, type FitnessSelection } from '@/charts';
import { cn } from '@/lib/cn';
import { formatDayMonth, formatIsoWeek, formatNumber, formatSigned } from '@/lib/format';
import { spring } from '@/motion/tokens';
import { FormZoneLabel, Switch } from '@/ui';
import { chartRange, rampBand, rangeWeeks, todayIndex, trimLeading, useApiToday, useFitness, useWeekly } from './data';
import { chartEvents, chartPhases, SelectionReadout } from './Overview';
import { ChartCard, InlineError, RangeControl, SportChips, TrendsFrame, useTrendsSearch } from './shared';

const ZONE_COPY: Record<FormZone, string> = {
  transition: 'Very fresh: fitness is starting to fade. Fine after a race, not for long.',
  fresh: 'Rested and sharp: where you want to be on race day.',
  neutral: 'Balanced: maintaining fitness without much fatigue.',
  productive: 'Carrying fatigue that builds fitness. The working zone of a block.',
  overreaching: 'Deep fatigue. Short spells are a deliberate overload, long ones a risk.',
};
const FIT_SPORTS: Sport[] = ['bike', 'run', 'swim', 'row', 'strength'];

export function TrendsFitnessPage() {
  const { search, set } = useTrendsSearch();
  const range = search.range ?? '6m';
  const sport = search.sport;
  const { today } = useApiToday();
  const fitness = useFitness(today, sport);
  const weekly = useWeekly(104);
  const [whatIf, setWhatIf] = useState(true);
  const [sel, setSel] = useState<FitnessSelection | null>(null);

  const allDays = fitness.data?.days ?? [];
  const days = useMemo(() => (whatIf ? allDays : allDays.filter((d) => !d.projected)), [allDays, whatIf]);
  const ti = todayIndex(allDays, today);
  const cur = ti >= 0 ? allDays[ti] : undefined;
  const span = FITNESS_RANGES.find((r) => r.value === chartRange(range))?.days ?? 182;
  const inRange = useMemo(() => {
    if (!today) return [] as FitnessDay[];
    const from = Number.isFinite(span) ? addDays(today, -span) : '0000-01-01';
    return allDays.filter((d) => !d.projected && d.date >= from && d.date <= today && d.fitness > 0);
  }, [allDays, today, span]);
  const zoneDays = useMemo(() => {
    const m = new Map<FormZone, number>();
    inRange.forEach((d) => d.formZone && m.set(d.formZone, (m.get(d.formZone) ?? 0) + 1));
    return m;
  }, [inRange]);
  const weeks = useMemo(() => trimLeading(weekly.data ?? []).slice(-rangeWeeks(range)), [weekly.data, range]);
  const last = allDays.filter((d) => d.projected).at(-1);
  const startFit = inRange[0]?.fitness;

  return (
    <TrendsFrame
      title="Fitness"
      back
      eyebrow={sport ? `Fitness from ${sport} only` : 'Fitness · Fatigue · Form'}
      controls={
        <>
          <RangeControl value={range} onChange={(r) => set({ range: r })} />
          <SportChips sports={FIT_SPORTS} value={sport} onChange={(s) => set({ sport: s })} />
          <div className="ml-auto">
            <Switch checked={whatIf} onCheckedChange={setWhatIf} label="Include planned workouts" />
          </div>
        </>
      }
    >
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Hero label="Fitness" value={cur?.fitness} accent sub={startFit != null && cur ? `${formatSigned(cur.fitness - startFit, 1)} over the range` : ''} />
        <Hero label="Fatigue" value={cur?.fatigue} sub="7-day load average" />
        <Hero label="Form" value={cur?.form} signed sub={<FormZoneLabel zone={cur?.formZone} />} />
        <Hero label={whatIf ? 'Projected Fitness' : 'Ramp'} value={whatIf ? last?.fitness : cur?.ramp ?? null} signed={!whatIf} sub={whatIf && last ? `on ${formatDayMonth(last.date)} if you train the plan` : `per week · ${rampBand(cur?.ramp) ?? ''}`} />
      </section>

      <section>
        <ChartCard title="Fitness · Fatigue · Form" question={whatIf ? 'Dashed lines project your planned workouts forward. Drag to measure a block.' : 'Completed training only. Drag to measure a block.'}>
          {fitness.isError ? (
            <InlineError onRetry={() => fitness.refetch()} />
          ) : (
            <FitnessChart
              days={days}
              loading={!fitness.data}
              today={today}
              range={chartRange(range)}
              onRangeChange={(r) => set({ range: r })}
              showRangeControl={false}
              events={chartEvents(fitness.data)}
              phases={chartPhases(fitness.data)}
              showRamp
              height={320}
              formHeight={120}
              projectionDays={whatIf ? 56 : 0}
              onSelect={setSel}
            />
          )}
          <SelectionReadout sel={sel} />
        </ChartCard>
      </section>

      <section className="grid gap-6 lg:grid-cols-12">
        <ChartCard className="lg:col-span-7" title="Form zones" question="Form = yesterday's Fitness − Fatigue. Days spent in each zone over the range.">
          <ul className="flex flex-col gap-1">
            {DEFAULT_FORM_BANDS.map((b) => {
              const n = zoneDays.get(b.zone) ?? 0;
              const share = inRange.length ? n / inRange.length : 0;
              const on = cur?.formZone === b.zone;
              return (
                <li key={b.zone} className={cn('grid grid-cols-[120px_1fr_88px] items-center gap-3 rounded-md px-2 py-2', on && 'bg-surface-2')}>
                  <span className="flex flex-col">
                    <span className={cn('text-label', on ? 'text-fg-1' : 'text-fg-2')}>{b.label}{on ? ' · now' : ''}</span>
                    <span className="font-mono text-mono-sm text-fg-3">{Number.isFinite(b.min) && Number.isFinite(b.max) ? `${formatSigned(b.min)} … ${formatSigned(b.max)}` : Number.isFinite(b.min) ? `> ${formatSigned(b.min)}` : `< ${formatSigned(b.max)}`}</span>
                  </span>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                      <motion.span className={cn('block h-full origin-left rounded-full', b.zone === 'productive' ? 'bg-accent' : b.zone === 'overreaching' ? 'bg-fg-1' : 'bg-fg-3')} initial={{ scaleX: 0 }} animate={{ scaleX: share }} transition={spring.gentle} />
                    </span>
                    <span className="truncate text-body-sm text-fg-3 max-sm:hidden">{ZONE_COPY[b.zone]}</span>
                  </span>
                  <span className="text-right font-mono text-mono text-fg-1">
                    {n}d <span className="text-fg-3">{Math.round(share * 100)}%</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </ChartCard>
        <ChartCard className="lg:col-span-5" title="Ramp rate" question="Weekly Fitness change. Up to +5/wk is sustainable, 5–8 aggressive, above 8 risky.">
          <RampStrip weeks={weeks} />
        </ChartCard>
      </section>

      <section>
        <ChartCard title="Week by week" question="End-of-week values. Click a week to open its review.">
          <WeekTable weeks={weeks} />
        </ChartCard>
      </section>
    </TrendsFrame>
  );
}

function Hero({ label, value, sub, accent, signed }: { label: string; value: number | null | undefined; sub?: React.ReactNode; accent?: boolean; signed?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-line-1 bg-surface-1 p-4">
      <span className="text-micro uppercase text-fg-3">{label}</span>
      <span className={cn('text-stat-md', accent ? 'text-accent-ink' : 'text-fg-1')}>{value == null ? '—' : signed ? formatSigned(value, Math.abs(value) < 10 ? 1 : 0) : formatNumber(value, 0)}</span>
      <span className="min-h-5 truncate text-body-sm text-fg-3">{sub}</span>
    </div>
  );
}

function RampStrip({ weeks }: { weeks: WeekSummary[] }) {
  const ws = weeks.slice(-16);
  const max = 12;
  return (
    <div className="flex flex-col gap-3">
      <div className="relative flex h-40 items-stretch gap-1">
        <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-line-3" style={{ top: `${50 - (5 / max) * 50}%` }} />
        <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-fg-3" style={{ top: `${50 - (8 / max) * 50}%` }} />
        <div className="pointer-events-none absolute inset-x-0 border-t border-line-2" style={{ top: '50%' }} />
        <span className="absolute right-0 font-mono text-mono-sm text-fg-3" style={{ top: `calc(${50 - (8 / max) * 50}% - 16px)` }}>8 risky</span>
        <span className="absolute right-0 font-mono text-mono-sm text-fg-3" style={{ top: `calc(${50 - (5 / max) * 50}% - 16px)` }}>5</span>
        {ws.map((w, i) => {
          const v = Math.max(-max, Math.min(max, w.fitnessDelta));
          const h = (Math.abs(v) / max) * 50;
          const band = rampBand(w.fitnessDelta);
          return (
            <Link key={w.isoWeek} to="/week/$isoWeek" params={{ isoWeek: w.isoWeek }} className="group relative flex-1" title={`${formatIsoWeek(w.isoWeek)}: ${formatSigned(w.fitnessDelta, 1)}/wk (${band})`}>
              <motion.span
                className={cn('absolute inset-x-0.5 rounded-xs', v >= 0 ? 'origin-bottom' : 'origin-top', band === 'risky' ? 'bg-fg-1' : band === 'aggressive' ? 'bg-hatch-fg border border-fg-2' : v >= 0 ? 'bg-accent' : 'border border-line-3 bg-transparent', w.isProjected && 'opacity-50')}
                style={v >= 0 ? { bottom: '50%', height: `${h}%` } : { top: '50%', height: `${h}%` }}
                initial={{ scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{ ...spring.gentle, delay: Math.min(i * 0.012, 0.24) }}
              />
            </Link>
          );
        })}
      </div>
      <div className="flex justify-between font-mono text-mono-sm text-fg-3">
        <span>{ws[0] ? formatDayMonth(ws[0].startDate) : ''}</span>
        <span>{ws.at(-1) ? `${formatIsoWeek(ws.at(-1)!.isoWeek)} ${formatSigned(ws.at(-1)!.fitnessDelta, 1)}` : ''}</span>
      </div>
    </div>
  );
}

function WeekTable({ weeks }: { weeks: WeekSummary[] }) {
  const rows = [...weeks].reverse();
  return (
    <div className="relative -mx-4 overflow-x-auto md:mx-0">
      <table className="w-full min-w-[620px] text-left">
        <thead>
          <tr className="border-b border-line-1 text-micro uppercase text-fg-3">
            {['Week', 'Load', 'Fitness', 'Δ', 'Fatigue', 'Form', 'Zone'].map((h, i) => (
              <th key={h} className={cn('px-4 py-2 font-[600]', i > 0 && i < 6 && 'text-right')}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono text-mono">
          {rows.map((w) => (
            <tr key={w.isoWeek} className="border-b border-line-1 last:border-0 hover:bg-surface-2">
              <td className="px-4 py-2">
                <Link to="/week/$isoWeek" params={{ isoWeek: w.isoWeek }} className="text-fg-1 hover:underline">
                  {formatIsoWeek(w.isoWeek)} <span className="text-fg-3">{formatDayMonth(w.startDate)}</span>
                  {w.isProjected && <span className="ml-1 text-micro uppercase text-fg-3">proj.</span>}
                </Link>
              </td>
              <td className="px-4 py-2 text-right text-accent-ink">{formatNumber(w.doneLoad, 0)}</td>
              <td className="px-4 py-2 text-right text-fg-1">{formatNumber(w.fitness, 1)}</td>
              <td className={cn('px-4 py-2 text-right', w.fitnessDelta > 8 ? 'font-[600] text-fg-1 underline decoration-dotted' : 'text-fg-2')}>{formatSigned(w.fitnessDelta, 1)}</td>
              <td className="px-4 py-2 text-right text-fg-2">{formatNumber(w.fatigue, 1)}</td>
              <td className="px-4 py-2 text-right text-fg-1">{formatSigned(w.form, 1)}</td>
              <td className="px-4 py-2 font-sans">
                <FormZoneLabel zone={w.formZone} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
