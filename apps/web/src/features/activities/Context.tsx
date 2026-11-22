/**
 * Context sections: plan vs actual (or a pairing picker) and "compared with last time".
 */
import type { ActivityDetail } from '@cadence/core/domain';
import { addDays } from '@cadence/core/time';
import { ArrowRight, Link2 } from 'lucide-react';
import { CompareBars } from '@/charts';
import { Button, ButtonLink, ComplianceGlyph, Popover, Section, SportGlyph, toast } from '@/ui';
import { formatDayShort, formatDuration, formatNumber, paceParts } from '@/lib/format';
import { useUnits } from '@/lib/units';
import { links } from '@/shell/links';
import { usePairing, useWorkoutsAround } from './data';

const COMPATIBLE: Record<string, string[]> = { bike: ['bike'], run: ['run'], swim: ['swim'], row: ['row'], strength: ['strength'], hike: ['hike', 'walk'], walk: ['walk', 'hike'] };

/** Pairing picker for an unplanned session. (Plan vs actual itself is one line in the activity hero.) */
export function PlanSection({ a }: { a: ActivityDetail }) {
  return a.plannedWorkout ? null : <PairPicker a={a} />;
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
