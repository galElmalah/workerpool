/**
 * /trends/fitness — ONE hero chart (Fitness · Fatigue · Form with form zones and the ramp strip; its
 * own readout shows today's or the hovered day's values), a short row of figures the chart does not
 * show (change over the range, ramp, where the plan leads), then two short tables: days per form
 * zone and week by week.
 */
import type { FitnessDay, FormZone, Sport, WeekSummary } from '@cadence/core';
import { addDays } from '@cadence/core/time';
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { DEFAULT_FORM_BANDS, FitnessChart, FITNESS_RANGES, type FitnessSelection } from '@/charts';
import { cn } from '@/lib/cn';
import { formatDayMonth, formatIsoWeek, formatNumber, formatSigned } from '@/lib/format';
import { FormZoneLabel, Section, StatRow, StatTile, Switch } from '@/ui';
import { chartRange, rampBand, rangeWeeks, todayIndex, trimLeading, useApiToday, useFitness, useWeekly } from './data';
import { chartEvents, chartPhases, SelectionReadout } from './Overview';
import { FilterPopover, InlineError, QuietTable, RangeControl, TrendsFrame, activeOf, qtCell, qtRow, sportFilter, sportGroup, useTrendsSearch } from './shared';

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
  const filters = activeOf(sportFilter(sport, () => set({ sport: undefined })));

  return (
    <TrendsFrame
      title="Fitness"
      back
      eyebrow={sport ? 'Fitness, fatigue and form from this sport only' : 'Fitness, fatigue and form'}
      filters={filters}
      toolbar={
        <>
          <RangeControl value={range} onChange={(r) => set({ range: r })} />
          <FilterPopover active={filters.length} groups={[sportGroup(FIT_SPORTS, sport, (s) => set({ sport: s }))]} />
        </>
      }
    >
      <Section
        title="Fitness · Fatigue · Form"
        description={whatIf ? 'Dashed lines follow your planned workouts forward. Drag across the chart to measure a block.' : 'Completed training only. Drag across the chart to measure a block.'}
        actions={<Switch checked={whatIf} onCheckedChange={setWhatIf} label="Include plan" />}
      >
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
            showFormZones
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
      </Section>

      <StatRow columns={3}>
        <StatTile label="Change over the range" value={startFit != null && cur ? cur.fitness - startFit : null} format={(v) => formatSigned(v, 1)} hint={startFit != null ? `from ${formatNumber(startFit, 0)} Fitness` : undefined} />
        <StatTile label="Ramp" value={cur?.ramp ?? null} format={(v) => formatSigned(v, 1)} unit="/wk" hint={rampBand(cur?.ramp) ? `${rampBand(cur?.ramp)} · up to +5 is sustainable` : undefined} />
        <StatTile label="Projected Fitness" value={whatIf ? (last?.fitness ?? null) : null} format={(v) => formatNumber(v, 0)} hint={whatIf && last ? `on ${formatDayMonth(last.date)} if you train the plan` : 'turn on “Include plan”'} />
      </StatRow>

      <Section title="Form zones" description="Form is yesterday's Fitness minus Fatigue. Days spent in each zone over the range.">
        <QuietTable head={[{ label: 'Zone' }, { label: 'Form' }, { label: 'What it means', className: 'max-md:hidden' }, { label: 'Days', numeric: true }, { label: 'Share', numeric: true }]}>
          {DEFAULT_FORM_BANDS.map((b) => {
            const n = zoneDays.get(b.zone) ?? 0;
            const share = inRange.length ? n / inRange.length : 0;
            const on = cur?.formZone === b.zone;
            return (
              <tr key={b.zone} className={qtRow}>
                <td className={cn(qtCell(), on ? 'font-medium text-fg-1' : 'text-fg-1')}>
                  {b.label}
                  {on && <span className="ml-1.5 font-normal text-fg-3">now</span>}
                </td>
                <td className={cn(qtCell(), 'text-fg-3')}>{Number.isFinite(b.min) && Number.isFinite(b.max) ? `${formatSigned(b.min)} to ${formatSigned(b.max)}` : Number.isFinite(b.min) ? `above ${formatSigned(b.min)}` : `below ${formatSigned(b.max)}`}</td>
                <td className={cn(qtCell(), 'text-body-sm text-fg-2 max-md:hidden')}>{ZONE_COPY[b.zone]}</td>
                <td className={cn(qtCell(true), 'text-fg-1')}>{n}</td>
                <td className={cn(qtCell(true), 'text-fg-3')}>{Math.round(share * 100)}%</td>
              </tr>
            );
          })}
        </QuietTable>
      </Section>

      <Section title="Week by week" description="End-of-week values. Click a week to open its review.">
        <WeekTable weeks={weeks} />
      </Section>
    </TrendsFrame>
  );
}

function WeekTable({ weeks }: { weeks: WeekSummary[] }) {
  const rows = [...weeks].reverse();
  return (
    <QuietTable minWidth={560} head={[{ label: 'Week' }, { label: 'Load', numeric: true }, { label: 'Fitness', numeric: true }, { label: 'Ramp', numeric: true }, { label: 'Form', numeric: true }, { label: 'Zone' }]}>
      {rows.map((w) => (
        <tr key={w.isoWeek} className={cn(qtRow, 'hover:bg-surface-2')} title={`Fatigue ${formatNumber(w.fatigue, 1)}`}>
          <td className={qtCell()}>
            <Link to="/week/$isoWeek" params={{ isoWeek: w.isoWeek }} className="text-fg-1 hover:underline">
              {formatIsoWeek(w.isoWeek)} <span className="text-fg-3">{formatDayMonth(w.startDate)}</span>
              {w.isProjected && <span className="ml-1 text-fg-3">· projected</span>}
            </Link>
          </td>
          <td className={cn(qtCell(true), 'text-fg-1')}>{formatNumber(w.doneLoad, 0)}</td>
          <td className={cn(qtCell(true), 'text-fg-1')}>{formatNumber(w.fitness, 1)}</td>
          <td className={cn(qtCell(true), w.fitnessDelta > 8 ? 'font-medium text-fg-1' : 'text-fg-2')}>{formatSigned(w.fitnessDelta, 1)}</td>
          <td className={cn(qtCell(true), 'text-fg-1')}>{formatSigned(w.form, 1)}</td>
          <td className={qtCell()}>
            <FormZoneLabel zone={w.formZone} />
          </td>
        </tr>
      ))}
    </QuietTable>
  );
}
