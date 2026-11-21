/**
 * Human-readable titles and step descriptions.
 */
import { INTENSITY_META, SPORT_META } from '../domain';
import type { InnerRepeat, IntensityClass, Repeat, Sport, Step, Target, ThresholdSnapshot, WorkoutStructure } from '../domain';
import { estimateStep, estimateWorkout } from './estimate';
import { classifyPlannedIntensity } from './intensity';
import { PACE_UNIT_M, fmtClock, fmtDistance, fmtNum, fmtPace, fmtPrime, fmtRange, paceUnitFor } from './format';
import type { Units } from './format';
import { listSteps } from './structure';
import { HR_ZONE_PCT_LTHR, POWER_ZONE_PCT, SWIM_ZONE_PCT } from './tables';

const r0 = (x: number) => fmtNum(Math.round(x));

function zoneMatch(table: Record<number, readonly [number, number]>, lo: number, hi: number): number | undefined {
  for (const [z, [a, b]] of Object.entries(table)) if (a === lo && b === hi) return +z;
  return undefined;
}

function paceText(mps: number, sport: Sport, units: Units): string {
  const unit = paceUnitFor(sport, units, sport === 'swim' && units === 'imperial');
  return fmtPace(PACE_UNIT_M[unit] / mps);
}

function paceRangeText(lowMps: number, highMps: number, sport: Sport, units: Units): string {
  const unit = paceUnitFor(sport, units, sport === 'swim' && units === 'imperial');
  return `${fmtRange(paceText(highMps, sport, units), paceText(lowMps, sport, units))}/${unit}`;
}

/** Compact target text: "95–100%", "Z2", "4:30/km", "CSS", "RPE 7", "50→75%". */
export function targetShort(t: Target, sport: Sport, units: Units = 'metric'): string {
  const rng = (a: number, b: number) => fmtRange(fmtNum(a), fmtNum(b));
  switch (t.type) {
    case 'open':
      return 'open';
    case 'power_pct': {
      const z = sport === 'bike' ? zoneMatch(POWER_ZONE_PCT, t.low, t.high) : undefined;
      return z ? `Z${z}` : `${rng(t.low, t.high)}%`;
    }
    case 'power_w':
      return `${rng(t.low, t.high)} W`;
    case 'hr_zone':
      return `HR Z${t.zone}`;
    case 'hr_pct_lthr':
      return `${rng(t.low, t.high)}% LTHR`;
    case 'hr_bpm':
      return `${rng(t.low, t.high)} bpm`;
    case 'pace':
      return paceRangeText(t.lowMps, t.highMps, sport, units);
    case 'pace_pct': {
      if (sport === 'swim') {
        const z = zoneMatch(SWIM_ZONE_PCT, t.low, t.high);
        if (z) return `Z${z}`;
        return t.low === 100 && t.high === 100 ? 'CSS' : `${rng(t.low, t.high)}% CSS`;
      }
      return `${rng(t.low, t.high)}% pace`;
    }
    case 'rpe':
      return `RPE ${rng(t.low, t.high)}`;
    case 'cadence':
      return `${rng(t.low, t.high)} ${sport === 'run' ? 'spm' : 'rpm'}`;
    case 'ramp':
      return `${fmtNum(t.from)}→${fmtNum(t.to)}%${t.basis === 'hr_pct_lthr' ? ' LTHR' : t.basis === 'pace_pct' && sport !== 'swim' ? ' pace' : ''}`;
  }
}

/** Absolute equivalent of a relative target (or vice-versa) when thresholds are known. */
function targetAbsolute(t: Target, sport: Sport, th: ThresholdSnapshot, units: Units): string | undefined {
  const powerThr = sport === 'row' ? th.rowThresholdW : th.ftp;
  const speedThr = sport === 'swim' ? th.swimCssMps : sport === 'run' ? th.runThresholdMps : undefined;
  const rng = (a: number, b: number) => fmtRange(r0(a), r0(b));
  switch (t.type) {
    case 'power_pct':
      return powerThr ? `${rng((t.low / 100) * powerThr, (t.high / 100) * powerThr)} W` : undefined;
    case 'power_w':
      return powerThr ? `${rng((100 * t.low) / powerThr, (100 * t.high) / powerThr)}%` : undefined;
    case 'pace_pct':
      return speedThr ? paceRangeText((t.low / 100) * speedThr, (t.high / 100) * speedThr, sport, units) : undefined;
    case 'pace':
      return speedThr ? `${rng((100 * t.lowMps) / speedThr, (100 * t.highMps) / speedThr)}%` : undefined;
    case 'hr_zone': {
      if (!th.lthr) return undefined;
      const [a, b] = HR_ZONE_PCT_LTHR[t.zone] ?? [0, 0];
      return `${rng((a / 100) * th.lthr, (b / 100) * th.lthr)} bpm`;
    }
    case 'hr_pct_lthr':
      return th.lthr ? `${rng((t.low / 100) * th.lthr, (t.high / 100) * th.lthr)} bpm` : undefined;
    case 'hr_bpm':
      return th.lthr ? `${rng((100 * t.low) / th.lthr, (100 * t.high) / th.lthr)}% LTHR` : undefined;
    case 'ramp':
      if (t.basis === 'power_pct' && powerThr) return `${r0((t.from / 100) * powerThr)}→${r0((t.to / 100) * powerThr)} W`;
      if (t.basis === 'hr_pct_lthr' && th.lthr) return `${r0((t.from / 100) * th.lthr)}→${r0((t.to / 100) * th.lthr)} bpm`;
      if (t.basis === 'pace_pct' && speedThr) return `${paceText((t.from / 100) * speedThr, sport, units)}→${paceText((t.to / 100) * speedThr, sport, units)}`;
      return undefined;
    default:
      return undefined;
  }
}

const STROKE_LABEL: Record<string, string> = {
  free: 'Free',
  back: 'Back',
  breast: 'Breast',
  fly: 'Fly',
  im: 'IM',
  choice: 'Choice',
  kick: 'Kick',
  drill: 'Drill',
};
const EQUIP_LABEL: Record<string, string> = {
  pull_buoy: 'pull buoy',
  paddles: 'paddles',
  fins: 'fins',
  kick_board: 'kickboard',
  snorkel: 'snorkel',
};

function measureLong(step: Step, sport: Sport, units: Units): string {
  const m = step.measure;
  switch (m.type) {
    case 'time':
      return fmtClock(m.sec);
    case 'distance':
      return fmtDistance(m.m, sport, units, sport === 'swim' && units === 'imperial');
    case 'lap_button':
      return 'Until lap';
    case 'reps':
      return `${m.n} reps`;
  }
}

/**
 * One-line description of a step, e.g. "8:00 @ 95–100% · 238–250 W",
 * "100 m Free @ 97% CSS · 1:53/100m · pull buoy · on 1:50", "Back squat 4×6 @ 80 kg · RPE 8 · rest 2:00".
 * Absolute equivalents are added when `thresholds` has the needed value.
 */
export function describeStep(step: Step, sport: Sport, units: Units = 'metric', thresholds?: ThresholdSnapshot): string {
  const s = step.strength;
  if (s) {
    const vol = s.reps !== undefined || s.durationSec === undefined ? `${s.sets}×${s.reps ?? (step.measure.type === 'reps' ? step.measure.n : 1)}` : `${s.sets}×${fmtClock(s.durationSec)}`;
    const parts = [`${s.exercise} ${vol}${s.weightKg !== undefined ? (s.weightKg === 0 ? ' @ BW' : ` @ ${fmtNum(Math.round(s.weightKg * 10) / 10)} kg`) : ''}`];
    if (s.rpe !== undefined) parts.push(`RPE ${fmtNum(s.rpe)}`);
    if (s.restSec !== undefined) parts.push(`rest ${fmtClock(s.restSec)}`);
    return parts.join(' · ');
  }
  let head = measureLong(step, sport, units);
  if (step.swim?.stroke) head += ` ${STROKE_LABEL[step.swim.stroke] ?? step.swim.stroke}`;
  if (step.label) head = `${step.label} · ${head}`;
  const parts = [head];
  if (step.target && step.target.type !== 'open') {
    const abs = thresholds ? targetAbsolute(step.target, sport, thresholds, units) : undefined;
    parts[0] += ` @ ${targetShort(step.target, sport, units)}`;
    if (abs) parts.push(abs);
  }
  if (step.secondary) parts.push(targetShort(step.secondary, sport, units));
  if (step.swim?.equipment?.length) parts.push(step.swim.equipment.map((e) => EQUIP_LABEL[e] ?? e).join(', '));
  if (step.swim?.sendOffSec) parts.push(`on ${fmtClock(step.swim.sendOffSec)}`);
  if (step.swim?.restSec !== undefined) parts.push(`rest ${fmtClock(step.swim.restSec)}`);
  if (step.row && (step.row.strokeRateLow !== undefined || step.row.strokeRateHigh !== undefined)) {
    const lo = step.row.strokeRateLow ?? step.row.strokeRateHigh!;
    parts.push(`${fmtRange(fmtNum(lo), fmtNum(step.row.strokeRateHigh ?? lo))} spm`);
  }
  return parts.join(' · ');
}

// ───────────────────────────── auto titles ─────────────────────────────

function measureShort(step: Step, sport: Sport, inRepeat: boolean): string {
  const m = step.measure;
  switch (m.type) {
    case 'time':
      return fmtPrime(m.sec);
    case 'distance':
      if (sport === 'swim') return inRepeat ? fmtNum(Math.round(m.m)) : `${fmtNum(Math.round(m.m))} m`;
      if (sport === 'row') return `${fmtNum(Math.round(m.m))} m`;
      if (m.m >= 1000 && m.m % 100 === 0 && (m.m % 1000 === 0 || m.m >= 5000)) return `${fmtNum(m.m / 1000)} km`;
      return `${fmtNum(Math.round(m.m))} m`;
    case 'lap_button':
      return 'lap';
    case 'reps':
      return `${m.n} reps`;
  }
}

function stepShort(step: Step, sport: Sport, inRepeat = false, withTarget = true): string {
  let txt = measureShort(step, sport, inRepeat);
  if (sport === 'swim' && step.swim?.stroke && step.swim.stroke !== 'free') txt += ` ${STROKE_LABEL[step.swim.stroke]?.toLowerCase() ?? step.swim.stroke}`;
  if (withTarget && step.target && step.target.type !== 'open') txt += ` @ ${targetShort(step.target, sport)}`;
  if (sport === 'swim' && step.swim?.sendOffSec) txt += ` on ${fmtClock(step.swim.sendOffSec)}`;
  return txt;
}

function repeatShort(r: Repeat | InnerRepeat, sport: Sport): string {
  const kids = r.steps;
  const active = kids.filter((k) => k.kind === 'repeat' || k.role === 'active');
  // 30/30 style: one short timed effort + one timed recovery
  if (kids.length === 2 && kids[0].kind === 'step' && kids[1].kind === 'step') {
    const [a, b] = kids;
    if (a.role === 'active' && b.role !== 'active' && a.measure.type === 'time' && b.measure.type === 'time' && a.measure.sec <= 60) {
      const tgt = a.target && a.target.type !== 'open' ? ` @ ${targetShort(a.target, sport)}` : '';
      return `${r.count}×${fmtPrime(a.measure.sec)}/${fmtPrime(b.measure.sec)}${tgt}`;
    }
  }
  const chosen = active.length ? active : kids.slice(0, 1);
  const parts = chosen.map((k) => (k.kind === 'repeat' ? repeatShort(k, sport) : stepShort(k, sport, true)));
  return parts.length === 1 && chosen[0].kind === 'step' ? `${r.count}×${parts[0]}` : `${r.count}×(${parts.join(' + ')})`;
}

/**
 * Title from the structure: the main set(s) ("4×8′ @ 95–100%", "10×100 on 1:45",
 * "10×30″/30″ @ 120%"), the dominant hard block ("Tempo 30′ @ 85%"), or the class and length
 * ("Endurance 1:30"). Strength: the first exercises ("Back squat, Romanian deadlift +2").
 */
export function autoTitle(structure: WorkoutStructure, sport: Sport, thresholds: ThresholdSnapshot = {}): string {
  const steps = listSteps(structure).map((s) => s.step);
  if (!steps.length) return SPORT_META[sport]?.label ?? 'Workout';
  const strength = steps.filter((s) => s.strength);
  if (strength.length && (sport === 'strength' || strength.length === steps.length)) {
    const names = [...new Set(strength.map((s) => s.strength!.exercise))];
    return names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : '');
  }
  const loadOf = (n: Step | Repeat | InnerRepeat): number =>
    n.kind === 'step' ? (n.role === 'active' ? estimateStep(n, sport, thresholds).load : 0) : n.count * n.steps.reduce((a, c) => a + loadOf(c), 0);
  const repeats = structure.steps.filter((n): n is Repeat => n.kind === 'repeat').map((r) => ({ r, w: loadOf(r) }));
  repeats.sort((a, b) => b.w - a.w);
  if (repeats.length && repeats[0].w > 0) {
    const main = [repeats[0]];
    if (repeats[1] && repeats[1].w >= 0.5 * repeats[0].w) main.push(repeats[1]);
    main.sort((a, b) => structure.steps.indexOf(a.r) - structure.steps.indexOf(b.r));
    return main.map((m) => repeatShort(m.r, sport)).join(' + ');
  }
  const cls = classifyPlannedIntensity(structure, sport, thresholds);
  const e = estimateWorkout(structure, sport, thresholds);
  if (cls.level >= 3) {
    const hard = e.profile.filter((b) => b.role === 'active' && b.level >= 3 && !b.isRepeatChild);
    const byStep = new Map<string, number>();
    for (const b of hard) byStep.set(b.stepId, (byStep.get(b.stepId) ?? 0) + 1);
    const top = structure.steps.filter((n): n is Step => n.kind === 'step' && byStep.has(n.id));
    if (top.length) {
      const sig = (s: Step) => JSON.stringify([s.measure, s.target]);
      const groups = new Map<string, Step[]>();
      for (const s of top) groups.set(sig(s), [...(groups.get(sig(s)) ?? []), s]);
      const [best] = [...groups.values()].sort((a, b) => b.length - a.length);
      return best.length > 1 ? `${best.length}×${stepShort(best[0], sport)}` : `${INTENSITY_META[cls.intensity].label} ${stepShort(best[0], sport)}`;
    }
  }
  if (steps.every((s) => s.measure.type === 'distance') && e.distanceM)
    return `${INTENSITY_META[cls.intensity].label} ${fmtDistance(e.distanceM, sport)}`;
  return `${INTENSITY_META[cls.intensity].label} ${fmtPrime(e.durationSec)}`;
}

/** Title for a workout with only a duration/distance and an intensity: "Endurance 45′", "Tempo 1:15". */
export function autoTitleUnstructured(w: { sport: Sport; durationSec?: number; distanceM?: number; intensity: IntensityClass }): string {
  const label = INTENSITY_META[w.intensity]?.label ?? 'Workout';
  if (w.durationSec && w.durationSec > 0) return `${label} ${fmtPrime(w.durationSec)}`;
  if (w.distanceM && w.distanceM > 0) return `${label} ${fmtDistance(w.distanceM, w.sport)}`;
  return `${label} ${SPORT_META[w.sport]?.label.toLowerCase() ?? ''}`.trim();
}
