/**
 * Daily wellness coherent with training load (fitness/fatigue EWMAs), illness, travel and
 * vacation: HRV dips under fatigue and sickness, resting HR rises, sleep varies, weight trends
 * along the dated weight thresholds, VO2max creeps up with fitness.
 */
import type { LocalDate, WellnessDay } from '@cadence/core/domain';
import { addDays, diffDays, eachDay, isoWeekday } from '@cadence/core/time';
import { rngFor } from './prng';
import { inRange, type Season } from './season';
import type { SynthThresholdChange, SynthProfile } from './types';
import { clamp, lerp, round } from './util';

export interface WellnessInput {
  seed: number;
  season: Season;
  profile: SynthProfile;
  history: SynthThresholdChange[];
  dailyLoad: Map<LocalDate, number>;
  /** Dates with an outdoor run or ride (VO2max estimate updates). */
  vo2Days: Set<LocalDate>;
}

function weightTrend(history: SynthThresholdChange[], date: LocalDate): number {
  const pts = history.filter((h) => h.kind === 'weight');
  if (!pts.length) return 73;
  if (date <= pts[0]!.effectiveFrom) return pts[0]!.value;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (date <= b.effectiveFrom) return lerp(a.value, b.value, diffDays(a.effectiveFrom, date) / Math.max(1, diffDays(a.effectiveFrom, b.effectiveFrom)));
  }
  return pts[pts.length - 1]!.value;
}

/** HR offset (bpm) applied to an activity's HR model from that morning's wellness. */
export function hrOffsetFromWellness(w: WellnessDay | undefined, hrRest: number): number {
  if (!w || w.restingHr === undefined) return 0;
  return clamp(0.6 * (w.restingHr - hrRest) + 0.06 * (60 - (w.hrvMs ?? 60)), -3, 7);
}

export function buildWellness(inp: WellnessInput): WellnessDay[] {
  const { seed, season, history, dailyLoad } = inp;
  const out: WellnessDay[] = [];
  // warm the EWMAs as if the athlete was already moderately fit (~45)
  let ctl = 44;
  let atl = 46;
  const hrvs: number[] = [];
  const sickStart = season.sick.start;
  for (const d of eachDay(season.start, season.today)) {
    const rng = rngFor(seed, 'wellness', d);
    const load = dailyLoad.get(d) ?? 0;
    const prevCtl = ctl;
    const prevAtl = atl;
    ctl += (load - ctl) / 42;
    atl += (load - atl) / 7;
    const strain = Math.max(0, prevAtl - prevCtl);
    // illness curve: onset the day before the marker, worst on days 1-3, lingering 4 days after
    const ds = diffDays(sickStart, d);
    const sickLen = diffDays(sickStart, season.sick.end);
    const sick = ds >= -1 && ds <= sickLen + 4 ? (ds < 0 ? 0.35 : ds <= 3 ? 1 : ds <= sickLen ? 0.6 : 0.6 * (1 - (ds - sickLen) / 5)) : 0;
    const travel = inRange(d, season.travel) ? 1 : 0;
    const vac = inRange(d, season.vacation) ? 1 : 0;
    const wd = isoWeekday(d);
    const weekend = wd >= 6 ? 1 : 0;
    const postRace = d === addDays(season.aRaceDate, 1) || d === addDays(season.sprintDate, 1) ? 1 : 0;

    const rhr = Math.round(49.5 - 0.07 * (prevCtl - 45) + 0.12 * strain + 7.5 * sick + 2 * travel + 3 * postRace + rng.normal(0, 1.1));
    const hrvRaw = 59 + 0.14 * (prevCtl - 45) - 0.42 * Math.max(0, strain - 4) - 19 * sick - 6 * travel + 4 * vac - 8 * postRace + rng.normal(0, 4.5);
    const hrv = Math.round(clamp(hrvRaw, 24, 105));
    hrvs.push(hrv);
    const base60 = hrvs.slice(-60).reduce((a, b) => a + b, 0) / Math.min(60, hrvs.length);
    const avg7 = hrvs.slice(-7).reduce((a, b) => a + b, 0) / Math.min(7, hrvs.length);
    const ratio = avg7 / base60;
    const hrvStatus = ratio < 0.78 ? 'POOR' : ratio < 0.88 ? 'LOW' : ratio < 0.95 || ratio > 1.12 ? 'UNBALANCED' : 'BALANCED';

    const sleepH = clamp(7.1 + 0.45 * weekend - 0.9 * travel + 1.1 * sick + 0.4 * vac - 0.6 * postRace + rng.normal(0, 0.55), 4.6, 10);
    const sleepSec = Math.round((sleepH * 3600) / 60) * 60;
    const sleepScore = Math.round(clamp(52 + (sleepH - 6) * 13 + (hrv - 58) * 0.35 - 12 * sick + rng.normal(0, 5), 25, 99));
    const yLoad = dailyLoad.get(addDays(d, -1)) ?? 0;
    const bodyBattery = Math.round(clamp(30 + sleepScore * 0.62 - 0.06 * yLoad - 25 * sick + rng.normal(0, 5), 8, 100));
    const stress = Math.round(clamp(27 + 4 * (wd <= 5 ? 1 : 0) + 11 * travel + 16 * sick + 0.08 * strain + rng.normal(0, 6), 8, 80));
    const readiness = Math.round(clamp(52 + (hrv - base60) * 1.3 + (sleepScore - 72) * 0.55 - 0.7 * strain - 42 * sick - 18 * postRace + rng.normal(0, 6), 1, 100));

    const day: WellnessDay = { date: d, hrvMs: hrv, hrvStatus, restingHr: rhr, sleepSec, sleepScore, bodyBattery, stress, readiness };
    // weigh-ins: most weekday mornings at home, rarely when away
    if (rng.chance(travel || vac ? 0.08 : weekend ? 0.35 : 0.72)) day.weightKg = round(weightTrend(history, d) + rng.normal(0, 0.35) + 0.25 * sick * -1, 1);
    if (inp.vo2Days.has(d) && rng.chance(0.55)) {
      const sickLag = ds >= 0 && ds <= sickLen + 21 ? 1.2 : 0;
      day.vo2max = Math.round(51 + 0.11 * (prevCtl - 45) - sickLag + rng.normal(0, 0.4));
    }
    if (rng.chance(0.28) || sick > 0.5) {
      day.feel = Math.round(clamp(3 + (readiness - 55) / 22 - 2 * sick + rng.normal(0, 0.5), 1, 5));
      day.soreness = Math.round(clamp(1.6 + yLoad / 90 + rng.normal(0, 0.6), 1, 5));
    }
    out.push(day);
  }
  return out;
}
