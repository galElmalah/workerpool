/**
 * Context sections: plan vs actual (or a pairing picker) and "compared with last time".
 */
import type { ActivityDetail, PlannedWorkout } from '@cadence/core/domain';
import { addDays } from '@cadence/core/time';
import { estimateWorkout } from '@cadence/core/workout';
import { Link } from '@tanstack/react-router';
import { ArrowRight, Link2, Unlink } from 'lucide-react';
import { useMemo } from 'react';
import { CompareBars, IntensityProfile, type ProfileBlock } from '@/charts';
import { Button, ButtonLink, ComplianceBar, ComplianceGlyph, complianceLabel, Popover, Section, SportGlyph, toast } from '@/ui';
import { morphSourceProps } from '@/ui/domain/WorkoutCard';
import { useIsMorphTarget, vt } from '@/motion/morph';
import { formatDayShort, formatDuration, formatNumber, paceParts } from '@/lib/format';
import { useUnits } from '@/lib/units';
import { links } from '@/shell/links';
import { usePairing, useWorkoutsAround } from './data';

const COMPATIBLE: Record<string, string[]> = { bike: ['bike'], run: ['run'], swim: ['swim'], row: ['row'], strength: ['strength'], hike: ['hike', 'walk'], walk: ['walk', 'hike'] };

export function PlanSection({ a }: { a: ActivityDetail }) {
  const w = a.plannedWorkout;
  return w ? <PlanVsActual a={a} w={w} /> : <PairPicker a={a} />;
}

function PlanVsActual({ a, w }: { a: ActivityDetail; w: PlannedWorkout }) {
  const { unpair } = usePairing(a.id);
  const { pair } = usePairing(a.id);
  const morphOn = useIsMorphTarget(w.id);
  const est = useMemo(() => (w.structure?.steps.length && ['bike', 'run', 'swim', 'row'].includes(w.sport) ? estimateWorkout(w.structure, w.sport, a.thresholdsUsed) : null), [w, a.thresholdsUsed]);
  const blocks: ProfileBlock[] = (est?.profile ?? []).map((b) => ({
    id: `${b.stepId}-${b.index}`,
    startSec: b.startSec,
    durationSec: b.durationSec,
    intensity: b.rampFrom ?? b.intensity,
    intensityEnd: b.rampTo,
    role: b.role,
    label: b.label,
  }));
  const ratios = [
    { label: 'Duration', planned: w.plannedDurationSec, actual: a.movingSec || a.durationSec, fmt: (v: number) => formatDuration(v, 'hms') },
    { label: 'Distance', planned: w.plannedDistanceM, actual: a.distanceM, fmt: (v: number) => (a.sport === 'swim' || a.sport === 'row' ? `${formatNumber(v, 0)} m` : `${formatNumber(v / 1000, 1)} km`) },
    { label: 'Load', planned: w.plannedLoad, actual: a.load, fmt: (v: number) => formatNumber(v, 0) },
  ].filter((r) => r.planned && r.actual != null);
  const c = a.compliance;
  return (
    <Section
      id="plan"
      title="Plan vs actual"
      actions={
        <Button
          size="sm"
          variant="ghost"
          icon={<Unlink />}
          onClick={async () => {
            await unpair.mutateAsync(w.id);
            toast.undo(<>Unpaired from <b>{w.title}</b></>, () => pair.mutate(w.id));
          }}
        >
          Unpair
        </Button>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-4 rounded-lg border border-line-2 bg-surface-1 p-4 md:p-5">
          <Link {...links.workout(w.id)} {...morphSourceProps(w.id)} style={vt(morphOn, 'card')} className="group flex items-center gap-3 rounded-md outline-none focus-visible:outline-2 focus-visible:outline-focus">
            <SportGlyph sport={w.sport} subSport={w.subSport} size={20} style={vt(morphOn, 'glyph')} />
            <div className="min-w-0 flex-1">
              <div className="text-micro uppercase text-fg-3">Planned · {formatDayShort(w.date)}</div>
              <div className="truncate text-title-3 text-fg-1 group-hover:underline" style={vt(morphOn, 'title')}>{w.title}</div>
            </div>
            <ArrowRight className="size-4 text-fg-3 transition-transform duration-(--dur-fast) group-hover:translate-x-0.5" />
          </Link>
          {blocks.length > 0 ? (
            <div style={{ ['--chart-bg' as string]: 'var(--color-surface-1)' }}>
              <div className="mb-1 text-micro uppercase text-fg-3">Planned structure</div>
              <IntensityProfile blocks={blocks} height={96} showAxis axisLabel={w.sport === 'bike' ? '%FTP' : w.sport === 'run' ? '% threshold pace' : w.sport === 'swim' ? '% CSS' : '% threshold'} />
            </div>
          ) : (
            <p className="text-body-sm text-fg-3">Unstructured session — compared on totals.</p>
          )}
          {(w.description || w.preNote) && (
            <div className="grid gap-3 border-t border-line-1 pt-4 md:grid-cols-2">
              {w.description && (
                <div>
                  <div className="mb-1 text-micro uppercase text-fg-3">Purpose</div>
                  <p className="text-body-sm whitespace-pre-wrap text-fg-2">{w.description}</p>
                </div>
              )}
              {w.preNote && (
                <div>
                  <div className="mb-1 text-micro uppercase text-fg-3">Pre-note</div>
                  <p className="text-body-sm whitespace-pre-wrap text-fg-2">{w.preNote}</p>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-4 rounded-lg border border-line-2 bg-surface-1 p-4 md:p-5">
          {c && (
            <div className="flex items-center gap-2">
              <ComplianceGlyph state={c.state} size={14} />
              <span className="text-title-3 text-fg-1">{complianceLabel(c.state)}</span>
              <span className="ml-auto font-mono text-mono text-fg-2">
                {Math.round(c.ratio * 100)}% <span className="text-fg-3">{c.metric}</span>
              </span>
            </div>
          )}
          {ratios.map((r) => (
            <div key={r.label} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-micro uppercase text-fg-3">{r.label}</span>
                <span className="font-mono text-mono-sm text-fg-1">
                  {r.fmt(r.actual!)} <span className="text-fg-3">/ {r.fmt(r.planned!)}</span>
                </span>
              </div>
              <ComplianceBar ratio={r.actual! / r.planned!} showLabel />
            </div>
          ))}
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
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-line-3 p-4">
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
                      <span className="font-mono text-mono-sm text-fg-3">{formatDayShort(w.date)} · {formatDuration(w.plannedDurationSec)}</span>
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
    { label: 'Load', current: a.load, previous: p.load, format: (v: number) => formatNumber(v, 0), accent: true },
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
      <div className="rounded-lg border border-line-2 bg-surface-1 p-4 md:p-5">
        <CompareBars items={items} currentLabel="This session" previousLabel={formatDayShort(p.localDate)} />
      </div>
    </Section>
  );
}
