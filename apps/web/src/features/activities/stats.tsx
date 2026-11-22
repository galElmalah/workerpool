/**
 * Per-sport summary stats (product.md §5.2), with plain-language explanations and the delta vs
 * the previous similar session. Values are numbers so they can tick; `format` renders them.
 */
import type { Activity, ActivityDetail, LoadSource, Sport } from '@cadence/core/domain';
import { formatDuration, formatNumber } from '@/lib/format';
import { paceBasis, distanceUnit, type UnitPrefs } from '@/lib/units';

export interface Stat {
  key: string;
  label: string;
  value: number | null;
  format: (n: number) => string;
  unit?: string;
  tip?: string;
  /** Previous similar session's value, for the delta. */
  prev?: number | null;
  /** Lower is better (pace) — flips the "good" arrow. */
  lowerBetter?: boolean;
  /** Performance metric: an improvement earns the accent arrow. */
  perf?: boolean;
  signal?: boolean;
  sub?: string;
}

export const LOAD_SOURCE_COPY: Record<LoadSource, string> = {
  power: 'from power',
  pace: 'from pace',
  swim_pace: 'from swim pace',
  hr: 'from heart rate',
  rpe: 'estimated from RPE',
  duration: 'estimated from duration',
  device: 'from the device',
  manual: 'set by you',
};

const TIPS = {
  load: 'Training stress in one currency: an hour all-out at threshold = 100. Higher means more recovery needed.',
  intensity: 'Weighted Power ÷ FTP. Under 0.75 is easy, 0.85–0.95 tempo/sweet spot, around 1.0 a threshold effort for an hour.',
  wp: 'The steady power that would cost the same as this ride’s ups and downs. Closer to average power = steadier ride.',
  variability: 'Weighted ÷ average power. 1.00–1.05 is very steady (time trial, trainer); above 1.15 is surgy.',
  efficiency: 'Output per heartbeat (Weighted Power or speed ÷ average HR). Rising over weeks at the same effort = aerobic fitness improving.',
  decoupling: 'How much heart rate drifted against output from the first half to the second. Under 5% = good durability; over 8% = significant drift.',
  adjPace: 'Pace adjusted for hills: what this effort would be on flat ground.',
  swolf: 'Seconds + strokes per length. Lower is more efficient; compare only within the same pool length.',
  wkg: 'Power relative to body weight — what matters on climbs.',
  dps: 'Metres travelled per stroke. Longer at the same rate = better technique.',
};

const n0 = (n: number) => formatNumber(n, 0);
const n1 = (n: number) => formatNumber(n, 1);
const n2 = (n: number) => n.toFixed(2);
const hms = (n: number) => formatDuration(n, 'hms');
const mmss = (s: number) => {
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
const mmss1 = (s: number) => {
  const t = Math.round(s * 10) / 10;
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`;
};

export const paceSec = (mps: number | null | undefined, sport: Sport, u: UnitPrefs) => (mps && mps > 0 ? paceBasis(sport, u).meters / mps : null);
export const fmtPaceSec = (sport: Sport) => (sport === 'row' ? mmss1 : mmss);

function distStat(a: Activity, prev: Activity | undefined, u: UnitPrefs): Stat {
  const { unit, mPer } = distanceUnit(a.sport, u);
  const metres = unit === 'm' || unit === 'yd';
  return {
    key: 'distance',
    label: 'Distance',
    value: a.distanceM != null ? a.distanceM / mPer : null,
    prev: prev?.distanceM != null ? prev.distanceM / mPer : null,
    format: metres ? n0 : (v) => formatNumber(v, v < 100 ? 2 : 1),
    unit,
  };
}

/** Moving time when it differs meaningfully, else elapsed. */
const timeOf = (a: Activity) => (a.movingSec > 0 ? a.movingSec : a.durationSec);

export function statsFor(a: ActivityDetail, u: UnitPrefs, liveLoad?: number): Stat[] {
  const p = a.previousSimilar;
  const w = a.thresholdsUsed.weightKg;
  const sport = a.sport;
  const pb = paceBasis(sport, u);
  const dur: Stat = { key: 'duration', label: a.movingSec && a.movingSec < a.durationSec - 60 ? 'Moving time' : 'Duration', value: timeOf(a), prev: p ? timeOf(p) : null, format: hms };
  const load: Stat = { key: 'load', label: 'Load', value: liveLoad ?? a.load, prev: p?.load, format: n0, tip: TIPS.load, signal: true, sub: LOAD_SOURCE_COPY[a.loadSource] };
  const avgHr: Stat = { key: 'avgHr', label: 'Avg HR', value: a.avgHr ?? null, prev: p?.avgHr, format: n0, unit: 'bpm' };
  const maxHr: Stat = { key: 'maxHr', label: 'Max HR', value: a.maxHr ?? null, format: n0, unit: 'bpm' };
  const elev: Stat = { key: 'elev', label: 'Elevation', value: a.elevationGainM ?? null, prev: p?.elevationGainM, format: (v) => n0(u.system === 'imperial' ? v / 0.3048 : v), unit: u.system === 'imperial' ? 'ft' : 'm' };
  const dec: Stat = { key: 'dec', label: 'Decoupling', value: a.decouplingPct ?? null, prev: p?.decouplingPct, format: n1, unit: '%', tip: TIPS.decoupling, lowerBetter: true };
  const pace = (label: string, mps: number | undefined, prevMps: number | undefined, tip?: string): Stat => ({
    key: label,
    label,
    value: paceSec(mps, sport, u),
    prev: paceSec(prevMps, sport, u),
    format: fmtPaceSec(sport),
    unit: pb.label,
    lowerBetter: true,
    perf: true,
    tip,
  });
  const dist = distStat(a, p, u);
  const has = (s: Stat) => s.value != null && Number.isFinite(s.value);

  let out: Stat[];
  switch (sport) {
    case 'bike':
      out = [
        dur,
        dist,
        load,
        { key: 'if', label: 'Intensity', value: a.intensityFactor ?? null, prev: p?.intensityFactor, format: n2, tip: TIPS.intensity },
        { key: 'wp', label: 'Weighted Power', value: a.weightedPower ?? null, prev: p?.weightedPower, format: n0, unit: 'W', tip: TIPS.wp, perf: true },
        { key: 'avgP', label: 'Avg power', value: a.avgPower ?? null, prev: p?.avgPower, format: n0, unit: 'W', perf: true },
        { key: 'wkg', label: 'W/kg', value: w && (a.weightedPower ?? a.avgPower) ? (a.weightedPower ?? a.avgPower)! / w : null, format: n2, tip: TIPS.wkg },
        { key: 'work', label: 'Work', value: a.workKj ?? null, prev: p?.workKj, format: n0, unit: 'kJ' },
        avgHr,
        maxHr,
        { key: 'cad', label: 'Cadence', value: a.avgCadence ?? null, format: n0, unit: 'rpm' },
        { key: 'speed', label: 'Speed', value: a.avgSpeedMps ? a.avgSpeedMps * (u.system === 'imperial' ? 2.23694 : 3.6) : null, prev: p?.avgSpeedMps ? p.avgSpeedMps * (u.system === 'imperial' ? 2.23694 : 3.6) : null, format: n1, unit: u.system === 'imperial' ? 'mph' : 'km/h' },
        elev,
        { key: 'vi', label: 'Variability', value: a.variability ?? null, format: n2, tip: TIPS.variability },
        { key: 'ef', label: 'Efficiency', value: a.efficiency ?? null, prev: p?.efficiency, format: n2, tip: TIPS.efficiency, perf: true },
        dec,
      ];
      break;
    case 'run':
    case 'walk':
    case 'hike':
      out = [
        dur,
        dist,
        load,
        pace('Pace', a.avgSpeedMps, p?.avgSpeedMps),
        ...(sport === 'run' ? [pace('Adjusted Pace', a.adjustedSpeedMps, p?.adjustedSpeedMps, TIPS.adjPace)] : []),
        avgHr,
        maxHr,
        { key: 'cad', label: 'Cadence', value: a.avgCadence ?? null, format: n0, unit: 'spm' },
        elev,
        ...(a.avgPower ? [{ key: 'avgP', label: 'Run power', value: a.avgPower, prev: p?.avgPower, format: n0, unit: 'W' } as Stat] : []),
        { key: 'ef', label: 'Efficiency', value: a.efficiency ?? null, prev: p?.efficiency, format: (v) => v.toFixed(3), tip: TIPS.efficiency, perf: true },
        dec,
        { key: 'cal', label: 'Calories', value: a.calories ?? null, format: n0, unit: 'kcal' },
      ];
      break;
    case 'swim': {
      const lengths = a.poolLengthM && a.distanceM ? a.distanceM / a.poolLengthM : null;
      out = [
        dist,
        dur,
        load,
        pace('Pace', a.avgSpeedMps, p?.avgSpeedMps),
        { key: 'swolf', label: 'SWOLF', value: a.avgSwolf ?? null, prev: p?.avgSwolf, format: n0, tip: TIPS.swolf, lowerBetter: true, perf: true },
        { key: 'strokes', label: 'Strokes', value: a.strokes ?? null, format: n0 },
        { key: 'spl', label: 'Strokes / length', value: a.strokes && lengths ? a.strokes / lengths : null, format: n1 },
        { key: 'pool', label: 'Pool length', value: a.poolLengthM ?? null, format: n0, unit: 'm' },
        { key: 'lengths', label: 'Lengths', value: lengths, format: n0 },
        { key: 'elapsed', label: 'Elapsed', value: a.durationSec, format: hms },
        avgHr,
        { key: 'rate', label: 'Stroke rate', value: a.avgCadence ?? null, format: n0, unit: 'spm' },
      ];
      break;
    }
    case 'row':
      out = [
        dist,
        dur,
        load,
        pace('Split', a.avgSpeedMps, p?.avgSpeedMps),
        { key: 'avgP', label: 'Avg power', value: a.avgPower ?? null, prev: p?.avgPower, format: n0, unit: 'W', perf: true },
        { key: 'rate', label: 'Stroke rate', value: a.avgCadence ?? null, format: n0, unit: 'spm' },
        { key: 'dps', label: 'Distance / stroke', value: a.avgCadence && a.distanceM && a.movingSec ? a.distanceM / (a.avgCadence * (a.movingSec / 60)) : null, format: n1, unit: 'm', tip: TIPS.dps },
        { key: 'wkg', label: 'W/kg', value: w && a.avgPower ? a.avgPower / w : null, format: n2, tip: TIPS.wkg },
        avgHr,
        maxHr,
        { key: 'ef', label: 'Efficiency', value: a.efficiency ?? null, prev: p?.efficiency, format: n2, tip: TIPS.efficiency, perf: true },
        dec,
      ];
      break;
    case 'strength': {
      const exercises = new Set((a.strengthSets ?? []).filter((s) => !s.isRest && s.reps).map((s) => s.exercise)).size;
      out = [
        dur,
        { key: 'sets', label: 'Sets', value: a.totalSets ?? null, prev: p?.totalSets, format: n0 },
        { key: 'reps', label: 'Reps', value: a.totalReps ?? null, prev: p?.totalReps, format: n0 },
        { key: 'vol', label: 'Volume', value: a.volumeKg != null ? (u.system === 'imperial' ? a.volumeKg / 0.4536 : a.volumeKg) : null, prev: p?.volumeKg, format: n0, unit: u.system === 'imperial' ? 'lb' : 'kg', perf: true },
        load,
        { key: 'ex', label: 'Exercises', value: exercises || null, format: n0 },
        avgHr,
        maxHr,
        { key: 'cal', label: 'Calories', value: a.calories ?? null, format: n0, unit: 'kcal' },
      ];
      break;
    }
    default:
      out = [dur, ...(a.distanceM ? [dist] : []), load, avgHr, maxHr, ...(a.elevationGainM ? [elev] : []), { key: 'cal', label: 'Calories', value: a.calories ?? null, format: n0, unit: 'kcal' }];
  }
  return out.filter((s, i) => i < 4 || has(s));
}

const HERO_KEYS: Partial<Record<Sport, string[]>> = {
  bike: ['duration', 'distance', 'elev', 'wp', 'avgP', 'load', 'avgHr'],
  run: ['duration', 'distance', 'Pace', 'elev', 'load', 'avgHr'],
  walk: ['duration', 'distance', 'Pace', 'elev', 'load', 'avgHr'],
  hike: ['duration', 'distance', 'elev', 'Pace', 'load', 'avgHr'],
  swim: ['distance', 'duration', 'Pace', 'swolf', 'load', 'avgHr'],
  row: ['distance', 'duration', 'Split', 'avgP', 'load', 'avgHr'],
  strength: ['duration', 'sets', 'reps', 'vol', 'load', 'avgHr'],
};

/** The 4–6 headline figures of the hero, in sport order (absent figures are skipped). */
export function heroStats(a: ActivityDetail, u: UnitPrefs, liveLoad?: number): Stat[] {
  const all = statsFor(a, u, liveLoad);
  const byKey = new Map(all.map((s) => [s.key, s]));
  const keys = HERO_KEYS[a.sport] ?? ['duration', 'distance', 'load', 'avgHr', 'elev', 'cal'];
  const ok = (s: Stat | undefined): s is Stat => !!s && s.value != null && Number.isFinite(s.value) && !(s.key === 'elev' && !s.value);
  const out: Stat[] = [];
  for (const k of keys) {
    if (out.length >= 6) break;
    if (k === 'avgP' && out.some((s) => s.key === 'wp')) continue;
    const s = byKey.get(k);
    if (ok(s)) out.push(s);
  }
  for (const s of all) {
    if (out.length >= 4) break;
    if (ok(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Fractional delta vs the previous session, or undefined (no tile delta row). */
export function deltaOf(s: Stat): number | undefined {
  if (s.value == null || s.prev == null || !s.prev) return undefined;
  return s.value / s.prev - 1;
}
