/** /trends/peaks — power / pace curves by range, best-efforts table, threshold history + suggestions. */
import type { PeakPoint, Sport, Threshold, ThresholdKind } from '@cadence/core';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight, FlaskConical } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PaceCurve, PowerCurve, effortsToPoints, type CurveSeries } from '@/charts';
import { cn } from '@/lib/cn';
import { distanceParts, formatDateMedium, formatDuration, formatNumber, formatPace, formatSigned } from '@/lib/format';
import { useUnits } from '@/lib/units';
import { Segmented, SportGlyph } from '@/ui';
import { usePeaks, useThresholdHistory } from './data';
import { ChartCard, InlineError, TrendsFrame, useTrendsSearch } from './shared';

const PEAK_SPORTS: Sport[] = ['bike', 'run', 'swim', 'row'];
const RANGES = [
  { value: '42d', label: '42 d' },
  { value: '90d', label: '90 d' },
  { value: 'season', label: 'Season' },
  { value: 'all', label: 'All-time' },
] as const;
type RangeKey = (typeof RANGES)[number]['value'];
const KIND_FOR: Record<string, ThresholdKind> = { bike: 'ftp', run: 'run_threshold', swim: 'swim_css', row: 'row_threshold' };
const KIND_LABEL: Record<string, string> = { ftp: 'FTP', run_threshold: 'Threshold pace', swim_css: 'CSS', row_threshold: 'Row threshold', lthr: 'LTHR', hr_max: 'Max HR', hr_rest: 'Resting HR' };

type SourcedPoint = PeakPoint & { activityId?: string; date?: string };
interface PeakRange {
  key: string;
  from: string;
  to: string;
  activities: number;
  power?: SourcedPoint[];
  speed?: SourcedPoint[];
  efforts?: { distanceM: number; timeSec: number; activityId: string; date: string }[];
}

export function TrendsPeaksPage() {
  const { search, set } = useTrendsSearch();
  const sport: Sport = search.sport && PEAK_SPORTS.includes(search.sport) ? search.sport : 'bike';
  const [primary, setPrimary] = useState<RangeKey>('90d');
  const peaks = usePeaks(sport);
  const thr = useThresholdHistory();
  const units = useUnits();
  const ranges = (peaks.data?.ranges ?? []) as unknown as PeakRange[];
  const byKey = new Map(ranges.map((r) => [r.key, r]));
  const weight = thr.data?.history.weight.at(-1)?.value;
  const estimate = peaks.data?.estimate as { criticalPower?: { cp: number; wPrime: number; valid: boolean; r2: number | null }; ftp?: { value: number; basis: string } } | undefined;

  const powerSport = sport === 'bike' || sport === 'row';
  const per = sport === 'swim' ? 100 : sport === 'row' ? 500 : 1000;
  const pts = (r?: PeakRange): PeakPoint[] => (!r ? [] : powerSport ? (r.power ?? []) : sport === 'run' ? (r.speed?.length ? r.speed : effortsToPoints(r.efforts ?? [])) : effortsToPoints(r.efforts ?? []));
  const series: CurveSeries[] = useMemo(() => {
    const out: CurveSeries[] = [];
    const cmpKey: RangeKey = primary === 'all' ? 'season' : 'all';
    const p = byKey.get(primary);
    const c = byKey.get(cmpKey);
    if (c && pts(c).length) out.push({ id: cmpKey, label: RANGES.find((x) => x.value === cmpKey)!.label, points: pts(c), variant: 'comparison' });
    if (p && pts(p).length) out.push({ id: primary, label: RANGES.find((x) => x.value === primary)!.label, points: pts(p), variant: 'primary' });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peaks.data, primary, sport]);

  const sel = byKey.get(primary);
  const allTime = byKey.get('all');
  const history = thr.data?.history[KIND_FOR[sport]] ?? [];
  const suggestions = (thr.data?.suggestions ?? []).filter((s) => s.sport === sport || (s.sport === 'all' && false));
  const fmtThr = (kind: ThresholdKind, v: number) =>
    kind === 'run_threshold' || kind === 'swim_css' ? formatPace(v, kind === 'swim_css' ? 'swim' : 'run', units) : kind === 'ftp' || kind === 'row_threshold' ? `${Math.round(v)} W` : `${Math.round(v)} bpm`;

  return (
    <TrendsFrame
      title="Peaks"
      back
      eyebrow="Best efforts, curves and thresholds"
      controls={
        <>
          <Segmented aria-label="Sport" size="sm" value={sport} onValueChange={(s) => set({ sport: s })} options={PEAK_SPORTS.map((s) => ({ value: s, label: <span className="inline-flex items-center gap-1.5"><SportGlyph sport={s} size={14} />{s === 'bike' ? 'Ride' : s[0].toUpperCase() + s.slice(1)}</span> }))} />
          <Segmented aria-label="Range" size="sm" value={primary} onValueChange={setPrimary} options={RANGES} />
        </>
      }
    >
      <section>
        <ChartCard
          title={powerSport ? 'Power curve' : 'Pace curve'}
          question={`${RANGES.find((r) => r.value === primary)!.label} (green) against ${primary === 'all' ? 'this season' : 'all-time'} (dashed). ${sel ? `${sel.activities} sessions in range.` : ''}`}
          actions={
            powerSport && estimate?.criticalPower ? (
              <span className="flex items-baseline gap-3 font-mono text-mono-sm text-fg-3">
                <span>
                  CP <span className="text-mono text-fg-1">{estimate.criticalPower.cp} W</span>
                </span>
                <span>
                  W′ <span className="text-mono text-fg-1">{formatNumber(estimate.criticalPower.wPrime / 1000, 1)} kJ</span>
                </span>
                <span className="text-fg-4">last 90 d</span>
              </span>
            ) : null
          }
        >
          {peaks.isError ? (
            <InlineError onRetry={() => peaks.refetch()} />
          ) : powerSport ? (
            <PowerCurve series={series} loading={!peaks.data} weightKg={sport === 'bike' ? weight : undefined} model={estimate?.criticalPower?.valid ? { cp: estimate.criticalPower.cp, wPrime: estimate.criticalPower.wPrime } : null} height={300} />
          ) : (
            <PaceCurve series={series} loading={!peaks.data} per={per} height={300} markers={sport === 'swim' ? [30, 60, 120, 300, 600] : [60, 300, 1200, 3600]} />
          )}
        </ChartCard>
      </section>

      <section className="grid gap-6 lg:grid-cols-12">
        <ChartCard className="lg:col-span-7" title={powerSport && sport === 'bike' ? 'Best powers' : 'Best efforts'} question={`${RANGES.find((r) => r.value === primary)!.label} bests. A dot marks an all-time best. Click to open the activity.`}>
          {powerSport && sport === 'bike' ? (
            <PowerTable points={sel?.power ?? []} all={allTime?.power ?? []} weight={weight} />
          ) : (
            <EffortTable sport={sport} efforts={sel?.efforts ?? []} all={allTime?.efforts ?? []} />
          )}
        </ChartCard>
        <ChartCard className="lg:col-span-5" title={`${KIND_LABEL[KIND_FOR[sport]]} history`} question="Threshold changes over time. Each step is a test or a manual update.">
          <ThresholdSteps history={history} fmt={(v) => fmtThr(KIND_FOR[sport], v)} invert={false} />
          {suggestions.length > 0 && (
            <div className="mt-4 flex flex-col gap-2 border-t border-line-1 pt-4">
              <span className="inline-flex items-center gap-1.5 text-micro uppercase text-fg-3">
                <FlaskConical className="size-3.5" /> Suggestions · estimated from the last 90 days, never applied automatically
              </span>
              {suggestions.map((s, i) => (
                <div key={i} className="flex items-center justify-between gap-3 rounded-md border border-dashed border-line-3 px-3 py-2">
                  <span className="flex min-w-0 flex-col">
                    <span className="text-label text-fg-1">
                      {KIND_LABEL[s.kind] ?? s.kind} <span className="font-mono">{fmtThr(s.kind, s.value)}</span>
                      {'current' in s && s.current != null && <span className="ml-1 font-mono text-mono-sm text-fg-3">now {fmtThr(s.kind, s.current)}</span>}
                    </span>
                    <span className="truncate text-body-sm text-fg-3">{s.basis}</span>
                  </span>
                  <Link to="/settings/zones" className="inline-flex shrink-0 items-center gap-1 text-label text-fg-1 underline decoration-line-3 underline-offset-3 hover:decoration-fg-1">
                    Review & apply <ArrowUpRight className="size-3.5" />
                  </Link>
                </div>
              ))}
            </div>
          )}
        </ChartCard>
      </section>
    </TrendsFrame>
  );
}

const POWER_DURS = [5, 15, 60, 300, 600, 1200, 3600];
const durLabel = (s: number) => (s < 60 ? `${s} s` : s < 3600 ? `${s / 60} min` : `${s / 3600} h`);

function PowerTable({ points, all, weight }: { points: SourcedPoint[]; all: SourcedPoint[]; weight?: number }) {
  const at = (ps: SourcedPoint[], d: number) => ps.find((p) => p.durationSec === d);
  return (
    <table className="w-full text-left">
      <thead>
        <tr className="border-b border-line-1 text-micro uppercase text-fg-3">
          <th className="px-2 py-2 font-[600]">Duration</th>
          <th className="px-2 py-2 text-right font-[600]">Power</th>
          <th className="px-2 py-2 text-right font-[600] max-sm:hidden">W/kg</th>
          <th className="px-2 py-2 text-right font-[600]">vs all-time</th>
          <th className="px-2 py-2 text-right font-[600]">Date</th>
        </tr>
      </thead>
      <tbody className="font-mono text-mono">
        {POWER_DURS.map((d) => {
          const p = at(points, d);
          const a = at(all, d);
          const isBest = p && a && p.value >= a.value;
          return (
            <tr key={d} className="border-b border-line-1 last:border-0">
              <td className="px-2 py-2 text-fg-2">{durLabel(d)}</td>
              <td className="px-2 py-2 text-right text-fg-1">
                {isBest && <span className="mr-1.5 inline-block size-1.5 rounded-full bg-accent align-middle" aria-label="All-time best" />}
                {p ? `${Math.round(p.value)} W` : '—'}
              </td>
              <td className="px-2 py-2 text-right text-fg-2 max-sm:hidden">{p && weight ? (p.value / weight).toFixed(2) : '—'}</td>
              <td className="px-2 py-2 text-right text-fg-3">{p && a ? (isBest ? 'best' : formatSigned(p.value - a.value)) : '—'}</td>
              <td className="px-2 py-2 text-right">
                {p?.activityId ? (
                  <Link to="/activities/$id" params={{ id: p.activityId }} className="text-fg-1 underline decoration-line-3 underline-offset-3 hover:decoration-fg-1">
                    {p.date ? formatDateMedium(p.date) : 'Open'}
                  </Link>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function EffortTable({ sport, efforts, all }: { sport: Sport; efforts: { distanceM: number; timeSec: number; activityId: string; date: string }[]; all: { distanceM: number; timeSec: number }[] }) {
  const units = useUnits();
  if (!efforts.length) return <p className="text-body text-fg-3">No best efforts recorded in this range.</p>;
  return (
    <table className="w-full text-left">
      <thead>
        <tr className="border-b border-line-1 text-micro uppercase text-fg-3">
          <th className="px-2 py-2 font-[600]">Distance</th>
          <th className="px-2 py-2 text-right font-[600]">Time</th>
          <th className="px-2 py-2 text-right font-[600]">Pace</th>
          <th className="px-2 py-2 text-right font-[600]">Date</th>
        </tr>
      </thead>
      <tbody className="font-mono text-mono">
        {efforts.map((e) => {
          const best = all.find((a) => a.distanceM === e.distanceM);
          const isBest = best && e.timeSec <= best.timeSec;
          const d = distanceParts(e.distanceM, sport, units, e.distanceM % 1000 === 0 || e.distanceM < 1000 ? 0 : 1);
          return (
            <tr key={e.distanceM} className="border-b border-line-1 last:border-0">
              <td className="px-2 py-2 text-fg-2">{Math.abs(e.distanceM - 1609.344) < 1 ? '1 mile' : Math.abs(e.distanceM - 21097.5) < 1 ? 'Half' : Math.abs(e.distanceM - 42195) < 1 ? 'Marathon' : e.distanceM < 1000 && sport !== 'swim' ? `${e.distanceM} m` : `${d.value} ${d.unit}`}</td>
              <td className={cn('px-2 py-2 text-right text-fg-1')}>
                {isBest && <span className="mr-1.5 inline-block size-1.5 rounded-full bg-accent align-middle" aria-label="All-time best" />}
                {formatDuration(e.timeSec, 'hms')}
              </td>
              <td className="px-2 py-2 text-right text-fg-2">{formatPace(e.distanceM / e.timeSec, sport, units)}</td>
              <td className="px-2 py-2 text-right">
                <Link to="/activities/$id" params={{ id: e.activityId }} className="text-fg-1 underline decoration-line-3 underline-offset-3 hover:decoration-fg-1">
                  {formatDateMedium(e.date)}
                </Link>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ThresholdSteps({ history, fmt }: { history: Threshold[]; fmt: (v: number) => string; invert?: boolean }) {
  if (!history.length) return <p className="text-body text-fg-3">No threshold set yet.</p>;
  const lo = Math.min(...history.map((h) => h.value));
  const hi = Math.max(...history.map((h) => h.value));
  return (
    <ol className="relative flex flex-col gap-0">
      {[...history].reverse().map((h, i, arr) => {
        const prev = arr[i + 1];
        const f = hi > lo ? (h.value - lo) / (hi - lo) : 1;
        const d = prev ? h.value - prev.value : null;
        return (
          <li key={h.id} className="grid grid-cols-[92px_1fr_auto] items-center gap-3 py-2">
            <span className="font-mono text-mono-sm text-fg-3">{formatDateMedium(h.effectiveFrom, true)}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-surface-3">
              <span className={cn('block h-full rounded-full', i === 0 ? 'bg-accent' : 'bg-fg-3')} style={{ width: `${30 + f * 70}%` }} />
            </span>
            <span className="flex items-baseline gap-2 font-mono text-mono">
              <span className="text-fg-1">{fmt(h.value)}</span>
              {d != null && Math.abs(d) > 1e-6 && <span className="text-mono-sm text-fg-3">{d > 0 ? '↗' : '↘'}</span>}
              <span className="text-micro uppercase text-fg-4">{h.source === 'manual' ? 'test' : h.source}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
