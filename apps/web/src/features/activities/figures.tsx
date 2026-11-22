/**
 * "All figures": the full data set of an activity, shown openly and organised into labelled groups
 * (time & distance, pace & speed, heart rate, power, cadence & dynamics, elevation, swim / row /
 * strength, energy & effect, conditions & device) as calm definition lists — label fg-3, value
 * fg-1 with tabular figures, unit fg-3. A figure that is absent is simply not shown.
 */
import { INTENSITY_META, SPORT_META, type ActivityDetail } from '@cadence/core/domain';
import { estimate1RM } from '@cadence/core/metrics';
import { Info } from 'lucide-react';
import { Section, Tooltip } from '@/ui';
import { cn } from '@/lib/cn';
import { distanceParts, formatDuration, formatNumber, paceParts, speedParts } from '@/lib/format';
import { paceBasis, useUnits, type UnitPrefs } from '@/lib/units';
import { benefitLabel, cadenceUnit, effectWord, elevUnit, elevValue, formatCoords, localClock, SOURCE_LABEL, tempParts } from './fmt';
import { LOAD_SOURCE_COPY } from './stats';

export interface Fig {
  label: string;
  value: string;
  unit?: string;
  /** One quiet line of context under or beside the value. */
  sub?: string;
  tip?: string;
}
export interface FigGroup {
  id: string;
  title: string;
  rows: Fig[];
}

const TIP = {
  gap: 'Pace adjusted for hills: what this effort would be on flat ground.',
  wp: 'The steady power that would cost the same as this session’s ups and downs.',
  if: 'Weighted Power ÷ FTP. About 0.75 easy, 0.85–0.95 tempo, 1.0 an hour all-out.',
  vi: 'Weighted ÷ average power. 1.00–1.05 is very steady; above 1.15 is surgy.',
  ef: 'Output per heartbeat (Weighted Power or normalised speed ÷ average HR). Rising over weeks at the same effort = aerobic fitness improving.',
  dec: 'Heart-rate drift against output from the first half to the second. Under 5 % is good durability.',
  swolf: 'Seconds + strokes per length. Lower is more efficient (compare within one pool length).',
  dps: 'Metres travelled per stroke. Longer at the same rate = better technique.',
  gct: 'How long each foot stays on the ground. Shorter usually means a more elastic stride.',
  vr: 'Vertical oscillation ÷ stride length. Lower = less bounce for the distance gained.',
  te: 'Garmin’s estimate of the effect on aerobic / anaerobic fitness, 0–5.',
  load: 'Training stress in one currency: an hour all-out at threshold = 100.',
  deviceLoad: 'Garmin’s own EPOC-based load. It is not the same scale as Cadence Load.',
};

const n0 = (v: number) => formatNumber(v, 0);
const hms = (v: number) => formatDuration(v, 'hms');
const has = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

function paceFig(label: string, mps: number | undefined, a: ActivityDetail, u: UnitPrefs, tip?: string): Fig | null {
  if (!has(mps) || mps <= 0) return null;
  const p = paceParts(mps, a.sport, u);
  return { label, value: p.value, unit: p.unit, tip };
}
function speedFig(label: string, mps: number | undefined, u: UnitPrefs): Fig | null {
  if (!has(mps) || mps <= 0) return null;
  const p = speedParts(mps, u);
  return { label, value: p.value, unit: p.unit };
}

/** Every figure the activity carries, grouped. Groups without rows are dropped. */
export function buildFigureGroups(a: ActivityDetail, u: UnitPrefs): FigGroup[] {
  const f = a.facts ?? {};
  const t = a.thresholdsUsed;
  const sport = a.sport;
  const groups: FigGroup[] = [];
  const push = (id: string, title: string, rows: Array<Fig | null | false | undefined | '' | 0>) => {
    const r = rows.filter((x): x is Fig => !!x);
    if (r.length) groups.push({ id, title, rows: r });
  };
  const workLaps = a.laps.filter((l) => !l.isRest && (l.distanceM ?? l.durationSec) > 0);
  const restSec = a.laps.filter((l) => l.isRest).reduce((s, l) => s + l.durationSec, 0);
  const dist = has(a.distanceM) && a.distanceM > 0 ? distanceParts(a.distanceM, sport, u) : null;

  // ── time & distance
  push('time', 'Time & distance', [
    a.movingSec > 0 && { label: 'Moving time', value: hms(a.movingSec) },
    { label: 'Elapsed time', value: hms(a.durationSec) },
    sport !== 'swim' && has(f.pausedSec) && f.pausedSec >= 5 && f.pausedSec <= a.durationSec - a.movingSec + 5 && { label: 'Paused', value: hms(f.pausedSec), sub: has(f.pauseCount) ? `${f.pauseCount} ${f.pauseCount === 1 ? 'stop' : 'stops'}` : undefined },
    dist && { label: 'Distance', value: dist.value, unit: dist.unit },
    { label: 'Started', value: localClock(a.startedAt, a.utcOffsetMin) },
    { label: 'Finished', value: localClock(a.startedAt, a.utcOffsetMin, a.durationSec) },
    sport !== 'swim' && sport !== 'strength' && a.laps.length > 1 && { label: 'Laps', value: String(a.laps.length) },
  ]);

  // ── pace & speed
  if (SPORT_META[sport].hasDistance && has(a.avgSpeedMps) && a.avgSpeedMps > 0) {
    if (sport === 'bike' || sport === 'ski')
      push('pace', 'Speed', [speedFig('Average speed', a.avgSpeedMps, u), speedFig('Max speed', f.maxSpeedMps, u), a.durationSec > 0 && has(a.distanceM) && speedFig('Elapsed average', a.distanceM / a.durationSec, u)]);
    else if (sport === 'row') push('pace', 'Split', [paceFig('Average split', a.avgSpeedMps, a, u), paceFig('Fastest split', f.maxSpeedMps, a, u), speedFig('Average speed', a.avgSpeedMps, u)]);
    else if (sport === 'swim') push('pace', 'Pace', [paceFig('Average pace', a.avgSpeedMps, a, u), has(a.distanceM) && a.durationSec > 0 && paceFig('Elapsed pace', a.distanceM / a.durationSec, a, u)]);
    else
      push('pace', 'Pace & speed', [
        paceFig('Average pace', a.avgSpeedMps, a, u),
        sport === 'run' && paceFig('Grade-adjusted pace', a.adjustedSpeedMps, a, u, TIP.gap),
        paceFig('Fastest pace', f.maxSpeedMps, a, u),
        speedFig('Average speed', a.avgSpeedMps, u),
        speedFig('Max speed', f.maxSpeedMps, u),
      ]);
  }

  // ── heart rate
  push('hr', 'Heart rate', [
    has(a.avgHr) && { label: 'Average', value: n0(a.avgHr), unit: 'bpm', sub: has(t.lthr) ? `${Math.round((a.avgHr / t.lthr) * 100)} % of LTHR` : undefined },
    has(a.maxHr) && { label: 'Max', value: n0(a.maxHr), unit: 'bpm', sub: has(t.hrMax) ? `${Math.round((a.maxHr / t.hrMax) * 100)} % of max` : undefined },
    has(f.minHr) && { label: 'Lowest', value: n0(f.minHr), unit: 'bpm' },
    has(a.efficiency) && { label: 'Efficiency factor', value: a.efficiency.toFixed(sport === 'bike' || sport === 'row' ? 2 : 3), tip: TIP.ef },
    has(a.decouplingPct) && { label: 'Aerobic decoupling', value: formatNumber(a.decouplingPct, 1), unit: '%', tip: TIP.dec },
  ]);

  // ── power
  const w = t.weightKg;
  if (has(a.avgPower) || has(a.weightedPower)) {
    push('power', sport === 'run' ? 'Running power' : 'Power', [
      has(a.avgPower) && { label: 'Average', value: n0(a.avgPower), unit: 'W', sub: w ? `${(a.avgPower / w).toFixed(2)} W/kg` : undefined },
      has(a.weightedPower) && sport !== 'run' && { label: 'Weighted Power', value: n0(a.weightedPower), unit: 'W', sub: w ? `${(a.weightedPower / w).toFixed(2)} W/kg` : undefined, tip: TIP.wp },
      has(a.maxPower) && { label: 'Max', value: n0(a.maxPower), unit: 'W' },
      has(a.intensityFactor) && sport === 'bike' && { label: 'Intensity', value: a.intensityFactor.toFixed(2), tip: TIP.if },
      has(a.variability) && { label: 'Variability', value: a.variability.toFixed(2), tip: TIP.vi },
      has(a.workKj) && { label: 'Work', value: n0(a.workKj), unit: 'kJ' },
      has(f.powerBalanceLeftPct) && { label: 'Left / right balance', value: `${formatNumber(f.powerBalanceLeftPct, 1)} / ${formatNumber(100 - f.powerBalanceLeftPct, 1)}`, unit: '%' },
      sport === 'bike' && has(t.ftp) && { label: 'FTP on this date', value: n0(t.ftp), unit: 'W' },
      sport === 'row' && has(t.rowThresholdW) && { label: 'Threshold on this date', value: n0(t.rowThresholdW), unit: 'W' },
    ]);
  }

  // ── cadence & running dynamics
  if (sport !== 'swim' && sport !== 'row') {
    const cu = cadenceUnit(sport);
    push('cadence', sport === 'run' ? 'Cadence & running dynamics' : 'Cadence', [
      has(a.avgCadence) && a.avgCadence > 0 && { label: 'Average cadence', value: n0(a.avgCadence), unit: cu },
      has(f.maxCadence) && { label: 'Max cadence', value: n0(f.maxCadence), unit: cu },
      has(f.steps) && { label: 'Steps', value: n0(f.steps) },
      has(f.avgStrideLengthM) && { label: 'Stride length', value: u.system === 'imperial' ? formatNumber(f.avgStrideLengthM / 0.3048, 1) : formatNumber(f.avgStrideLengthM, 2), unit: u.system === 'imperial' ? 'ft' : 'm' },
      has(f.avgGroundContactMs) && { label: 'Ground contact time', value: n0(f.avgGroundContactMs), unit: 'ms', tip: TIP.gct },
      has(f.avgGroundContactBalanceLeftPct) && { label: 'Ground contact balance', value: `${formatNumber(f.avgGroundContactBalanceLeftPct, 1)} / ${formatNumber(100 - f.avgGroundContactBalanceLeftPct, 1)}`, unit: '% L/R' },
      has(f.avgVerticalOscillationCm) && { label: 'Vertical oscillation', value: u.system === 'imperial' ? formatNumber(f.avgVerticalOscillationCm / 2.54, 1) : formatNumber(f.avgVerticalOscillationCm, 1), unit: u.system === 'imperial' ? 'in' : 'cm' },
      has(f.avgVerticalRatioPct) && { label: 'Vertical ratio', value: formatNumber(f.avgVerticalRatioPct, 1), unit: '%', tip: TIP.vr },
    ]);
  }

  // ── elevation
  const eu = elevUnit(u);
  const ev = (m: number) => n0(elevValue(m, u));
  push('elevation', 'Elevation', [
    has(a.elevationGainM) && (a.elevationGainM > 0 || has(f.elevationLossM)) && { label: 'Gain', value: ev(a.elevationGainM), unit: eu },
    has(f.elevationLossM) && (f.elevationLossM > 0 || has(a.elevationGainM)) && { label: 'Loss', value: ev(f.elevationLossM), unit: eu },
    has(f.maxAltitudeM) && { label: 'Highest point', value: ev(f.maxAltitudeM), unit: eu },
    has(f.minAltitudeM) && { label: 'Lowest point', value: ev(f.minAltitudeM), unit: eu },
    has(f.maxGradePct) && f.maxGradePct > 0.5 && { label: 'Steepest climb', value: formatNumber(f.maxGradePct, 1), unit: '%', sub: 'over 200 m' },
    has(f.minGradePct) && f.minGradePct < -0.5 && { label: 'Steepest descent', value: formatNumber(f.minGradePct, 1), unit: '%', sub: 'over 200 m' },
  ]);

  // ── swim
  if (sport === 'swim') {
    const lengths = f.activeLengths ?? (a.poolLengthM && a.distanceM ? Math.round(a.distanceM / a.poolLengthM) : undefined);
    const byStroke = new Map<string, number>();
    for (const l of workLaps) if (l.stroke) byStroke.set(l.stroke, (byStroke.get(l.stroke) ?? 0) + (l.distanceM ?? 0));
    const main = [...byStroke.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
    const strokeName: Record<string, string> = { free: 'Freestyle', back: 'Backstroke', breast: 'Breaststroke', fly: 'Butterfly', im: 'IM', drill: 'Drill', kick: 'Kick', choice: 'Choice', mixed: 'Mixed' };
    push('swim', 'Swim', [
      has(a.poolLengthM) && { label: 'Pool length', value: n0(a.poolLengthM), unit: 'm' },
      has(lengths) && { label: 'Lengths', value: n0(lengths) },
      a.subSport !== 'open_water' && workLaps.length > 1 && { label: 'Intervals', value: String(workLaps.length) },
      restSec > 0 && { label: 'Rest between', value: hms(restSec) },
      main && { label: 'Main stroke', value: strokeName[main] ?? main },
      has(a.strokes) && { label: 'Strokes', value: n0(a.strokes) },
      has(f.avgStrokesPerLength) && { label: 'Strokes per length', value: formatNumber(f.avgStrokesPerLength, 1) },
      has(a.avgCadence) && a.avgCadence > 0 && { label: 'Stroke rate', value: n0(a.avgCadence), unit: 'spm' },
      has(a.avgSwolf) && { label: 'SWOLF', value: n0(a.avgSwolf), tip: TIP.swolf },
      has(f.avgDistancePerStrokeM) && { label: 'Distance per stroke', value: formatNumber(f.avgDistancePerStrokeM, 2), unit: 'm', tip: TIP.dps },
    ]);
  }

  // ── row
  if (sport === 'row') {
    const dps = f.avgDistancePerStrokeM ?? (a.avgCadence && a.distanceM && a.movingSec ? a.distanceM / (a.avgCadence * (a.movingSec / 60)) : undefined);
    push('row', 'Row', [
      has(a.avgCadence) && a.avgCadence > 0 && { label: 'Stroke rate', value: n0(a.avgCadence), unit: 'spm' },
      has(f.maxCadence) && { label: 'Max stroke rate', value: n0(f.maxCadence), unit: 'spm' },
      has(f.totalStrokes) && { label: 'Strokes', value: n0(f.totalStrokes) },
      has(dps) && { label: 'Distance per stroke', value: formatNumber(dps, 1), unit: 'm', tip: TIP.dps },
    ]);
  }

  // ── strength
  if (a.strengthSets?.length || has(a.totalSets)) {
    const sets = a.strengthSets ?? [];
    const work = sets.filter((s) => !s.isRest);
    const workSec = work.reduce((s, x) => s + (x.durationSec ?? 0), 0);
    const restS = sets.filter((s) => s.isRest).reduce((s, x) => s + (x.durationSec ?? 0), 0);
    const heaviest = work.filter((s) => s.weightKg).sort((x, y) => (y.weightKg ?? 0) - (x.weightKg ?? 0))[0];
    const best1rm = work.reduce<{ v: number; ex: string } | null>((b, s) => {
      const e = estimate1RM(s.weightKg, s.reps);
      return e && (!b || e > b.v) ? { v: e, ex: s.exercise } : b;
    }, null);
    const kg = (v: number) => (u.system === 'imperial' ? v / 0.45359237 : v);
    const wu = u.system === 'imperial' ? 'lb' : 'kg';
    push('strength', 'Strength', [
      has(a.totalSets) && { label: 'Sets', value: n0(a.totalSets) },
      has(a.totalReps) && { label: 'Reps', value: n0(a.totalReps) },
      new Set(work.filter((s) => s.reps).map((s) => s.exercise)).size > 0 && { label: 'Exercises', value: String(new Set(work.filter((s) => s.reps).map((s) => s.exercise)).size) },
      has(a.volumeKg) && { label: 'Volume', value: n0(kg(a.volumeKg)), unit: wu },
      workSec > 0 && { label: 'Time under work', value: hms(workSec) },
      restS > 0 && { label: 'Rest', value: hms(restS) },
      heaviest && { label: 'Heaviest set', value: formatNumber(kg(heaviest.weightKg!), 1, { trim: true }), unit: wu, sub: `${heaviest.exercise} × ${heaviest.reps ?? '?'}` },
      best1rm && { label: 'Best estimated 1RM', value: formatNumber(kg(best1rm.v), 1, { trim: true }), unit: wu, sub: best1rm.ex },
    ]);
  }

  // ── energy & effect
  push('effect', 'Energy & effect', [
    { label: 'Load', value: n0(a.load), sub: LOAD_SOURCE_COPY[a.loadSource], tip: TIP.load },
    { label: 'Intensity', value: INTENSITY_META[a.intensity].label, sub: a.intensityOverride ? 'set by you' : 'auto' },
    has(a.calories) && a.calories > 0 && { label: 'Calories', value: n0(a.calories), unit: 'kcal' },
    has(a.aerobicEffect) && { label: 'Aerobic effect', value: a.aerobicEffect.toFixed(1), sub: effectWord(a.aerobicEffect), tip: TIP.te },
    has(a.anaerobicEffect) && { label: 'Anaerobic effect', value: a.anaerobicEffect.toFixed(1), sub: effectWord(a.anaerobicEffect), tip: TIP.te },
    f.trainingEffectLabel && { label: 'Primary benefit', value: benefitLabel(f.trainingEffectLabel) },
    has(f.deviceLoad) && { label: 'Garmin training load', value: n0(f.deviceLoad), tip: TIP.deviceLoad },
    has(f.sweatLossMl) && { label: 'Estimated sweat loss', value: n0(f.sweatLossMl), unit: 'ml' },
  ]);

  // ── conditions & device
  const temp = has(f.avgTempC) ? tempParts(f.avgTempC, u) : null;
  const range = has(f.minTempC) && has(f.maxTempC) && f.minTempC !== f.maxTempC ? `${tempParts(f.minTempC, u).value}–${tempParts(f.maxTempC, u).value} ${tempParts(0, u).unit}` : undefined;
  push('device', 'Conditions & device', [
    a.locationName && { label: 'Location', value: a.locationName },
    has(f.startLat) && has(f.startLng) && { label: 'Start position', value: formatCoords(f.startLat, f.startLng) },
    temp ? { label: 'Temperature', value: temp.value, unit: temp.unit, sub: range } : has(f.minTempC) && has(f.maxTempC) ? { label: 'Temperature', value: range ?? tempParts(f.minTempC, u).value, unit: range ? undefined : tempParts(0, u).unit } : null,
    f.deviceName && { label: 'Device', value: f.deviceName, sub: f.deviceSoftware ? `Software ${f.deviceSoftware}` : undefined },
    ...(f.sensors ?? []).map((s) => ({ label: `${s.kind} sensor`, value: s.name ?? 'Connected' })),
    f.sportProfile && { label: 'Sport profile', value: f.sportProfile },
    { label: 'Source', value: SOURCE_LABEL[a.source] },
    f.timezone && { label: 'Time zone', value: f.timezone.replace(/_/g, ' ') },
  ]);
  return groups;
}

export function FiguresSection({ a }: { a: ActivityDetail }) {
  const u = useUnits();
  const groups = buildFigureGroups(a, u);
  const count = groups.reduce((s, g) => s + g.rows.length, 0);
  return (
    <Section id="figures" title="All figures" description={`${count} figures from ${a.source === 'manual' ? 'your entry' : 'the device'} and Cadence’s analysis, grouped.`}>
      <div className="columns-1 gap-x-12 sm:columns-2 lg:columns-3">
        {groups.map((g) => (
          <FigureGroup key={g.id} g={g} />
        ))}
      </div>
    </Section>
  );
}

function FigureGroup({ g }: { g: FigGroup }) {
  return (
    <section aria-labelledby={`fig-${g.id}`} className="mb-10 break-inside-avoid">
      <h3 id={`fig-${g.id}`} className="mb-2 text-body font-medium text-fg-1">
        {g.title}
      </h3>
      <dl className="flex flex-col">
        {g.rows.map((r) => (
          <div key={r.label} className="flex min-h-9 items-baseline justify-between gap-4 border-b border-line-1 py-2 last:border-b-0">
            <dt className="min-w-0 text-body text-fg-3">
              {r.tip ? (
                <Tooltip content={<span className="block max-w-64">{r.tip}</span>}>
                  <span tabIndex={0} className="inline-flex cursor-help items-center gap-1 rounded-xs outline-none hover:text-fg-2 focus-visible:outline-2 focus-visible:outline-focus">
                    {r.label}
                    <Info className="size-3 opacity-60" aria-hidden />
                  </span>
                </Tooltip>
              ) : (
                r.label
              )}
            </dt>
            <dd className={cn('min-w-0 text-right text-body tabular-nums text-fg-1')}>
              <span className="whitespace-nowrap">
                {r.value}
                {r.unit && <span className="text-fg-3"> {r.unit}</span>}
              </span>
              {r.sub && <span className="block text-body-sm text-fg-3">{r.sub}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
