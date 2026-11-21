/**
 * Constant tables and small pure mappings shared by the workout library.
 *
 * "IF" throughout this module is an intensity *fraction of threshold*:
 *  - bike / row / strength / other: power-equivalent fraction (1.0 = FTP / threshold effort);
 *  - run: speed fraction of threshold speed (rTSS-style, load = h × IF² × 100);
 *  - swim: speed fraction of CSS (load = h × IF³ × 100).
 * Sources: docs/research/product.md §4.3–4.4 and docs/research/metrics.md §2.9, §3.
 */
import type { Sport, StepRole, ThresholdSnapshot } from '../domain';

export type Level = 1 | 2 | 3 | 4 | 5;

/** Linear interpolation over an ascending [x, y] table, extrapolating with the end segments. */
export function interp(table: ReadonlyArray<readonly [number, number]>, x: number): number {
  if (!Number.isFinite(x)) return table[0][1];
  if (x <= table[0][0]) {
    const [x0, y0] = table[0];
    const [x1, y1] = table[1];
    return Math.max(0, y0 + ((x - x0) * (y1 - y0)) / (x1 - x0));
  }
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i];
    if (x <= x1) {
      const [x0, y0] = table[i - 1];
      return y0 + ((x - x0) * (y1 - y0)) / (x1 - x0);
    }
  }
  const [x0, y0] = table[table.length - 2];
  const [x1, y1] = table[table.length - 1];
  return y1 + ((x - x1) * (y1 - y0)) / (x1 - x0);
}

/** RPE (CR10) → IF-equivalent, product.md §4.4. Non-integer RPE interpolates. */
export const RPE_TO_IF: ReadonlyArray<readonly [number, number]> = [
  [1, 0.5],
  [2, 0.55],
  [3, 0.65],
  [4, 0.7],
  [5, 0.75],
  [6, 0.82],
  [7, 0.88],
  [8, 0.95],
  [9, 1.02],
  [10, 1.1],
];

export function rpeToIF(rpe: number): number {
  return interp(RPE_TO_IF, Math.min(10, Math.max(1, rpe)));
}

/**
 * Heart rate (fraction of LTHR) → power-equivalent IF. Ours, anchored at LTHR = 1.00 and
 * aligned with the §4.3 level boundaries (81 % LTHR ≈ 56 % FTP, 90 % ≈ 76 %, 95 % ≈ 91 %).
 * HR is compressed relative to power, so the slope above LTHR is steep.
 */
export const HR_FRACTION_TO_IF: ReadonlyArray<readonly [number, number]> = [
  [0.6, 0.4],
  [0.81, 0.56],
  [0.9, 0.76],
  [0.95, 0.91],
  [1.0, 1.0],
  [1.03, 1.08],
  [1.07, 1.18],
  [1.1, 1.25],
];

export function hrFractionToIF(fractionOfLthr: number): number {
  return interp(HR_FRACTION_TO_IF, fractionOfLthr);
}

/**
 * HR zone (1–7, Friel 7-zone: Z1, Z2, Z3, Z4, Z5a, Z5b, Z5c) → planning midpoint as a
 * fraction of LTHR (metrics.md §2.9.1).
 */
export const HR_ZONE_MID_LTHR: Record<number, number> = {
  1: 0.75,
  2: 0.855,
  3: 0.92,
  4: 0.97,
  5: 1.015,
  6: 1.05,
  7: 1.09,
};

/** Friel HR zone bounds in % LTHR (bike table) used to show bpm ranges. */
export const HR_ZONE_PCT_LTHR: Record<number, readonly [number, number]> = {
  1: [65, 80],
  2: [81, 89],
  3: [90, 93],
  4: [94, 99],
  5: [100, 102],
  6: [103, 106],
  7: [107, 110],
};

/** `zN` on a bike → % FTP range (Coggan 7 levels; Z1 and Z7 bounds are ours). */
export const POWER_ZONE_PCT: Record<number, readonly [number, number]> = {
  1: [45, 55],
  2: [56, 75],
  3: [76, 90],
  4: [91, 105],
  5: [106, 120],
  6: [121, 150],
  7: [151, 200],
};

/** `zN` on a swim → % CSS speed range (Skiba swim zones; Z1 lower bound is ours). */
export const SWIM_ZONE_PCT: Record<number, readonly [number, number]> = {
  1: [80, 92],
  2: [93, 96],
  3: [97, 98],
  4: [99, 101],
  5: [102, 108],
  6: [109, 115],
};

/** Level from a power-like IF (product.md §4.3 bike column). */
export function levelForPowerIF(x: number): Level {
  if (x > 1.05) return 5;
  if (x > 0.905) return 4;
  if (x > 0.755) return 3;
  if (x >= 0.555) return 2;
  return 1;
}

/** Level from a run speed fraction (§4.3 run column). */
export function levelForRunSpeed(x: number): Level {
  if (x > 1.02) return 5;
  if (x >= 0.95) return 4;
  if (x >= 0.88) return 3;
  if (x >= 0.78) return 2;
  return 1;
}

/** Level from a swim speed fraction of CSS (ours, aligned with the swim zones above). */
export function levelForSwimSpeed(x: number): Level {
  if (x > 1.015) return 5;
  if (x >= 0.99) return 4;
  if (x >= 0.965) return 3;
  if (x >= 0.925) return 2;
  return 1;
}

/** Level from heart rate as a fraction of LTHR (§4.3 HR column). */
export function levelForHrFraction(x: number): Level {
  if (x > 1.0) return 5;
  if (x >= 0.945) return 4;
  if (x >= 0.895) return 3;
  if (x >= 0.805) return 2;
  return 1;
}

/** Level from RPE (§4.3 RPE column). */
export function levelForRpe(rpe: number): Level {
  if (rpe >= 8.5) return 5;
  if (rpe >= 6.5) return 4;
  if (rpe >= 4.5) return 3;
  if (rpe >= 2.5) return 2;
  return 1;
}

/** How a sport's IF is defined (see module doc). */
export function ifKind(sport: Sport): 'power' | 'run' | 'swim' {
  if (sport === 'run') return 'run';
  if (sport === 'swim') return 'swim';
  return 'power';
}

/** Intensity level of a step-level IF for a sport. */
export function levelForIF(sport: Sport, x: number): Level {
  const k = ifKind(sport);
  if (k === 'run') return levelForRunSpeed(x);
  if (k === 'swim') return levelForSwimSpeed(x);
  return levelForPowerIF(x);
}

/**
 * Converts a power-equivalent IF (from RPE/HR tables) into the sport's IF kind.
 * Swim: speed fraction s with s³ = IF² so the load is identical. Others: unchanged.
 */
export function fromPowerEquivalent(sport: Sport, x: number): number {
  return ifKind(sport) === 'swim' ? Math.pow(Math.max(0, x), 2 / 3) : x;
}

/** Default IF (sport kind) for steps without a usable target, by role. */
export function roleDefaultIF(sport: Sport, role: StepRole): number {
  const k = ifKind(sport);
  const t =
    k === 'run'
      ? { warmup: 0.75, active: 0.8, recovery: 0.65, rest: 0, cooldown: 0.72, other: 0.75 }
      : k === 'swim'
        ? { warmup: 0.88, active: 0.92, recovery: 0.82, rest: 0, cooldown: 0.85, other: 0.88 }
        : { warmup: 0.6, active: 0.7, recovery: 0.5, rest: 0, cooldown: 0.55, other: 0.6 };
  return t[role];
}

/** Lap-button steps have no duration; planning assumes these (seconds), by role. */
export const LAP_BUTTON_DEFAULT_SEC: Record<StepRole, number> = {
  warmup: 600,
  active: 300,
  recovery: 120,
  rest: 60,
  cooldown: 600,
  other: 300,
};

/** Strength planning: seconds per rep (incl. setup) and default rest between sets. */
export const STRENGTH_SEC_PER_REP = 4;
export const STRENGTH_DEFAULT_REST_SEC = 90;
/** RPE assumed for strength work without one (product.md §4.4). */
export const STRENGTH_DEFAULT_RPE = 6;

/**
 * Fallback thresholds used only when the snapshot lacks a value needed to turn a distance
 * into a duration or an absolute target into an IF. Results carry `usedDefaults: true`.
 */
export const DEFAULT_THRESHOLDS: Required<Pick<ThresholdSnapshot, 'ftp' | 'runThresholdMps' | 'swimCssMps' | 'rowThresholdW' | 'lthr' | 'hrMax' | 'hrRest'>> = {
  ftp: 200, // W
  runThresholdMps: 1000 / 300, // 5:00 /km
  swimCssMps: 100 / 110, // 1:50 /100 m
  rowThresholdW: 180, // W (≈ 2:04 /500 m)
  lthr: 165,
  hrMax: 185,
  hrRest: 55,
};

/** Concept2 relation: P [W] = 2.80 · v³ (v in m/s). */
export function rowPowerFromSpeed(v: number): number {
  return 2.8 * v * v * v;
}
export function rowSpeedFromPower(p: number): number {
  return Math.cbrt(Math.max(0, p) / 2.8);
}

/** Flat-road bike speed (m/s) for an IF — rough, only to estimate distance. 32.4 km/h at FTP. */
export function bikeSpeedForIF(x: number): number {
  return 9 * Math.cbrt(Math.max(0.3, x));
}

/** Steady speeds (m/s) for sports without a threshold speed. */
export const NOMINAL_SPEED_MPS: Partial<Record<Sport, number>> = {
  hike: 1.25,
  walk: 1.4,
  ski: 4,
  other: 2.5,
};

/**
 * Session IF by planned intensity label for unstructured workouts (metrics.md §2.9.2).
 * Swim values are CSS speed fractions (load uses IF³), ours.
 */
export const UNSTRUCTURED_IF: Record<'recovery' | 'endurance' | 'tempo' | 'threshold' | 'high', number> = {
  recovery: 0.55,
  endurance: 0.68,
  tempo: 0.8,
  threshold: 0.88,
  high: 0.87,
};
export const UNSTRUCTURED_SWIM_IF: Record<'recovery' | 'endurance' | 'tempo' | 'threshold' | 'high' | 'race', number> = {
  recovery: 0.8,
  endurance: 0.88,
  tempo: 0.93,
  threshold: 0.97,
  high: 0.96,
  race: 1.0,
};
/** Planned RPE by intensity label for strength / yoga / mobility sessions (ours). */
export const INTENSITY_DEFAULT_RPE: Record<'recovery' | 'endurance' | 'tempo' | 'threshold' | 'high' | 'race', number> = {
  recovery: 3,
  endurance: 4,
  tempo: 6,
  threshold: 7,
  high: 8,
  race: 9,
};

/** Words accepted as intensity labels (quick-add, step text). */
export const INTENSITY_WORDS: Record<string, 'recovery' | 'endurance' | 'tempo' | 'threshold' | 'high' | 'race'> = {
  recovery: 'recovery',
  rec: 'recovery',
  easy: 'endurance',
  endurance: 'endurance',
  aerobic: 'endurance',
  long: 'endurance',
  steady: 'tempo',
  tempo: 'tempo',
  sweetspot: 'tempo',
  threshold: 'threshold',
  ftp: 'threshold',
  vo2: 'high',
  vo2max: 'high',
  hard: 'high',
  anaerobic: 'high',
  sprint: 'high',
  sprints: 'high',
  race: 'race',
};

/** Step-level intensity words → RPE target (documented in text.ts). */
export const STEP_INTENSITY_RPE: Record<string, number> = {
  recovery: 2,
  easy: 3,
  steady: 5,
  moderate: 5,
  tempo: 6,
  threshold: 7,
  hard: 8,
  vo2: 9,
  max: 10,
  allout: 10,
  sprint: 10,
};
