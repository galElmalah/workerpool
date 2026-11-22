/**
 * Context sections: plan vs actual (or a pairing picker) and "compared with last time".
 */
import type { ActivityDetail } from '@cadence/core/domain';
import { addDays } from '@cadence/core/time';
import { Link } from '@tanstack/react-router';
import { ArrowRight, Link2 } from 'lucide-react';
import { CompareBars } from '@/charts';
import { Button, ButtonLink, ComplianceBar, ComplianceGlyph, complianceLabel, Popover, Section, SportGlyph, toast } from '@/ui';
import { cn } from '@/lib/cn';
import { distanceParts, formatDayShort, formatDuration, formatNumber, paceParts } from '@/lib/format';
import { useUnits } from '@/lib/units';
import { links } from '@/shell/links';
import { usePairing, useWorkoutsAround } from './data';

const COMPATIBLE: Record<string, string[]> = { bike: ['bike'], run: ['run'], swim: ['swim'], row: ['row'], strength: ['strength'], hike: ['hike', 'walk'], walk: ['walk', 'hike'] };

/** Plan vs actual for a paired session, or the pairing picker for an unplanned one. */
export function PlanSection({ a }: { a: ActivityDetail }) {
  return a.plannedWorkout ? <PlanVsActual a={a} /> : <PairPicker a={a} />;
}

type Tone = 'good' | 'warn' | 'critical';
const TONE_DOT: Record<Tone, string> = { good: 'bg-good', warn: 'bg-warn', critical: 'bg-critical' };
function ratioTone(r: number): { tone: Tone; word: string } {
  if (r >= 0.8 && r <= 1.2) return { tone: 'good', word: 'On target' };
  if (r >= 0.5 && r < 0.8) return { tone: 'warn', word: 'Short' };
  if (r > 1.2 && r <= 1.5) return { tone: 'warn', word: 'Long' };
  return { tone: 'critical', word: r < 0.5 ? 'Well short' : 'Well over' };
}

function PlanVsActual({ a }: { a: ActivityDetail }) {
  const units = useUnits();
  const w = a.plannedWorkout!;
  const c = a.compliance;
  const rows = [
    { label: 'Duration', planned: w.plannedDurationSec, actual: a.movingSec || a.durationSec, fmt: (v: number) => formatDuration(v, 'hms'), unit: '' },
    {
      label: 'Distance',
      planned: w.plannedDistanceM,
      actual: a.distanceM,
      fmt: (v: number) => distanceParts(v, a.sport, units).value,
      unit: a.distanceM ? distanceParts(a.distanceM, a.sport, units).unit : '',
    },
    { label: 'Load', planned: w.plannedLoad, actual: a.load, fmt: (v: number) => formatNumber(v, 0), unit: '' },
  ].filter((r) => r.planned && r.actual != null && r.actual > 0);
  return (
    <Section
      id="plan"
      title="Plan vs actual"
      description={
        <Link {...links.workout(w.id)} className="group inline-flex min-w-0 items-center gap-1 text-fg-2 underline decoration-line-3 underline-offset-3 transition-colors hover:text-fg-1 hover:decoration-fg-1">
          <span className="truncate">{w.title}</span>
          <span className="text-fg-3">· planned {formatDayShort(w.date)}</span>
          <ArrowRight className="size-3.5 shrink-0 transition-transform duration-(--dur-fast) group-hover:translate-x-0.5" aria-hidden />
        </Link>
      }
    >
      <div className="grid gap-10 lg:grid-cols-[16rem_minmax(0,1fr)]">
        {c && (
          <div className="flex flex-col gap-3">
            <span className="inline-flex items-center gap-2 text-body-lg font-medium text-fg-1">
              <ComplianceGlyph state={c.state} size={16} />
              {complianceLabel(c.state)}
            </span>
            <span className="text-body text-fg-2">
              <span className="text-stat-md text-fg-1 tabular-nums">{Math.round(c.ratio * 100)}%</span> of planned {c.metric}
            </span>
            <ComplianceBar ratio={c.ratio} state={c.state} />
          </div>
        )}
        <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
          <table className="w-full min-w-[30rem] border-separate border-spacing-0 text-body">
            <thead>
              <tr className="text-right">
                {['', 'Planned', 'Actual', 'Of plan', ''].map((h, i) => (
                  <th key={i} className={cn('h-9 border-b border-line-1 px-3 text-label font-medium text-fg-3 first:pl-0 last:pr-0', i === 0 && 'text-left', i === 4 && 'text-left')}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const ratio = r.actual! / r.planned!;
                const t = ratioTone(ratio);
                return (
                  <tr key={r.label} className="text-right tabular-nums">
                    <td className="h-11 border-b border-line-1 pr-3 text-left text-fg-3">{r.label}</td>
                    <td className="h-11 border-b border-line-1 px-3 text-fg-2">
                      {r.fmt(r.planned!)}
                      {r.unit && <span className="text-fg-3"> {r.unit}</span>}
                    </td>
                    <td className="h-11 border-b border-line-1 px-3 text-fg-1">
                      {r.fmt(r.actual!)}
                      {r.unit && <span className="text-fg-3"> {r.unit}</span>}
                    </td>
                    <td className="h-11 border-b border-line-1 px-3 text-fg-1">{Math.round(ratio * 100)}%</td>
                    <td className="h-11 border-b border-line-1 pl-3 text-left">
                      <span className="inline-flex items-center gap-2 text-body-sm text-fg-2">
                        <span className={cn('size-2 rounded-full', TONE_DOT[t.tone])} aria-hidden />
                        {t.word}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
  );
}

function PairPicker({ a }: { a: ActivityDetail }) {
  const from = addDays(a.localDate, -1);
  const to = addDays(a.localDate, 1);
  const q = useWorkoutsAround(from, to, true);
  const { pair } = usePairing(a.id);
  const ok = COMPATIBLE[a.sport] ?? [a.sport];
  const candidates = (q.data ?? []).filter((w) => !w.pairedActivityId && w.status !== 'skipped').sort((x, y) => Number(ok.includes(y.sport)) - Number(ok.includes(x.sport)));
  return (
    <Section id="plan" title="Plan" variant="title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ComplianceGlyph state="unplanned" size={14} />
          <div>
            <div className="text-body text-fg-1">Unplanned session</div>
            <div className="text-body-sm text-fg-3">{candidates.length ? `${candidates.length} open planned workout${candidates.length > 1 ? 's' : ''} within a day.` : 'No open planned workouts within a day.'}</div>
          </div>
        </div>
        {candidates.length > 0 && (
          <Popover
            title="Pair with a planned workout"
            showTitle
            align="end"
            trigger={<Button size="sm" icon={<Link2 />}>Pair with a planned workout</Button>}
          >
            {(close) => (
              <div className="flex w-72 flex-col gap-0.5">
                {candidates.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={async () => {
                      close();
                      await pair.mutateAsync(w.id);
                      toast.success(<>Paired with <b>{w.title}</b></>);
                    }}
                    className="flex items-center gap-2 rounded-sm px-2 py-2 text-left transition-colors duration-(--dur-fast) hover:bg-surface-3"
                  >
                    <SportGlyph sport={w.sport} size={16} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body text-fg-1">{w.title}</span>
                      <span className="text-body-sm text-fg-3">{formatDayShort(w.date)} · {formatDuration(w.plannedDurationSec)}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Popover>
        )}
      </div>
    </Section>
  );
}

export function PreviousSection({ a }: { a: ActivityDetail }) {
  const units = useUnits();
  const p = a.previousSimilar!;
  const pace = ['run', 'swim', 'row', 'walk', 'hike'].includes(a.sport);
  const items = [
    { label: 'Duration', current: a.movingSec || a.durationSec, previous: p.movingSec || p.durationSec, format: (v: number) => formatDuration(v, 'hms') },
    { label: 'Load', current: a.load, previous: p.load, format: (v: number) => formatNumber(v, 0) },
    ...(a.avgPower && p.avgPower ? [{ label: 'Avg power', current: a.avgPower, previous: p.avgPower, unit: 'W' }] : []),
    ...(pace && a.avgSpeedMps && p.avgSpeedMps ? [{ label: 'Speed', current: a.avgSpeedMps, previous: p.avgSpeedMps, format: (v: number) => paceParts(v, a.sport, units).value, unit: paceParts(1, a.sport, units).unit }] : []),
    ...(a.avgHr && p.avgHr ? [{ label: 'Avg HR', current: a.avgHr, previous: p.avgHr, unit: 'bpm' }] : []),
    ...(a.efficiency && p.efficiency ? [{ label: 'Efficiency', current: a.efficiency, previous: p.efficiency, format: (v: number) => v.toFixed(a.sport === 'bike' ? 2 : 3) }] : []),
  ];
  return (
    <Section
      id="previous"
      title="Compared with last time"
      description={
        <>
          {p.title} · {formatDayShort(p.localDate)}
        </>
      }
      actions={<ButtonLink size="sm" variant="ghost" iconRight={<ArrowRight />} {...links.activityCompare(a.id, [p.id])}>Full compare</ButtonLink>}
    >
      <div>
        <CompareBars items={items} currentLabel="This session" previousLabel={formatDayShort(p.localDate)} />
      </div>
    </Section>
  );
}
