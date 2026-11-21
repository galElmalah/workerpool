/**
 * Workout logic: structure utilities, estimation, intensity, text syntax, titles,
 * compliance & pairing, scheduling helpers, Garmin support checks and the starter library.
 * Pure, dependency-free (besides the domain types) and isomorphic.
 */
export * from './structure';
export * from './estimate';
export * from './intensity';
export * from './text';
export * from './title';
export * from './compliance';
export * from './scheduling';
export * from './garminable';
export * from './library';
export {
  DEFAULT_THRESHOLDS,
  RPE_TO_IF,
  HR_FRACTION_TO_IF,
  LAP_BUTTON_DEFAULT_SEC,
  rpeToIF,
  hrFractionToIF,
} from './tables';
export type { Level } from './tables';
export { fmtClock, fmtHMM, fmtPrime, fmtPace, fmtDistance } from './format';
export type { Units, PaceUnit } from './format';
