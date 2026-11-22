/**
 * Cadence metrics engine — pure, dependency-free, isomorphic TypeScript.
 * Implements docs/research/metrics.md. Units: seconds, metres, m/s, W, bpm, kg, kJ.
 */
export * from './streams';
export * from './power';
export * from './pace';
export * from './swim';
export * from './row';
export * from './hr';
export * from './rpe';
export * from './strength';
export * from './zones';
export * from './load';
export * from './fitness';
export * from './thresholds';
export * from './weekly';
export * from './wellness';
export * from './facts';
export { roundHalfAway, type NumSeries } from './util';
