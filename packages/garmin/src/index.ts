/**
 * @cadence/garmin — Garmin Connect integration for Cadence.
 *
 * The offline fake Garmin lives in `@cadence/garmin/mock` (src/mock) so it is
 * never bundled into production code paths by accident.
 */
export * from './errors';
export * from './auth';
export * from './client';
export * from './mapping';
export * from './fit';
export * from './workout';
export * from './exercises';
export * from './sync';
export {
  parseGarminTimestamp,
  toIsoInstant,
  formatGarminListTime,
  formatGarminDetailTime,
  type JsonObject,
} from './util';
