/**
 * The single entry point through which every completed activity enters the system —
 * Garmin sync, FIT upload, manual entry and demo seeding all call `ingestActivity`
 * (implemented in ./ingest.ts).
 *
 * Pipeline: (parse FIT) → merge summary → resolve thresholds effective on the activity's
 * local date → core/metrics.computeActivityMetrics → upsert `activities` (+ gzip streams,
 * + original file when small) → auto-pair with a planned workout (core/workout.pairActivities,
 * never touching manual pairs).
 */
import type { ActivityStreams, Lap, LocalDate, Sport, StrengthSet, SubSport } from '@cadence/core/domain';

/** Source-agnostic summary. `NormalizedActivity` from @cadence/garmin is assignable to this. */
export interface IngestSummary {
  garminActivityId?: string;
  garminTypeKey?: string;
  startedAt: string; // ISO UTC
  utcOffsetMin: number;
  localDate: LocalDate;
  sport: Sport;
  subSport?: SubSport;
  title: string;
  durationSec: number;
  movingSec: number;
  distanceM?: number;
  elevationGainM?: number;
  avgHr?: number;
  maxHr?: number;
  avgPower?: number;
  weightedPower?: number;
  maxPower?: number;
  avgSpeedMps?: number;
  avgCadence?: number;
  calories?: number;
  aerobicEffect?: number;
  anaerobicEffect?: number;
  poolLengthM?: number;
  strokes?: number;
  avgSwolf?: number;
  totalSets?: number;
  totalReps?: number;
  /** Seconds per zone as reported upstream, index 0 = zone 1 (used when there are no streams). */
  hrTimeInZoneSec?: number[];
  powerTimeInZoneSec?: number[];
  /** Hash of upstream-editable fields; unchanged hash + same id ⇒ ingest is a no-op. */
  editHash?: string;
}

export interface IngestInput {
  source: 'garmin' | 'upload' | 'manual' | 'demo';
  /** Required unless `fit` is given (then the FIT session provides it; a given summary wins field by field). */
  summary?: IngestSummary;
  /** Original FIT file; parsed with @cadence/garmin `parseFit`. */
  fit?: Uint8Array;
  /** Already-decoded data (alternative to `fit`). */
  streams?: ActivityStreams;
  laps?: Lap[];
  strengthSets?: StrengthSet[];
  /** Athlete-entered fields (manual entry / demo); never overwritten by later syncs. */
  user?: { rpe?: number; feel?: number; postNote?: string; isKey?: boolean; tags?: string[]; loadManual?: number };
  /** Force recomputation even when editHash is unchanged. */
  force?: boolean;
}

export interface IngestResult {
  activityId: string;
  outcome: 'created' | 'updated' | 'unchanged' | 'skipped';
  /** Why it was skipped (e.g. soft-deleted locally, multisport parent). */
  reason?: string;
  pairedWorkoutId?: string;
  warnings: string[];
}

export type IngestActivity = (env: Env, input: IngestInput) => Promise<IngestResult>;

/** Recompute stored metrics (after a threshold change). Implemented in ./ingest.ts. */
export type RecomputeActivities = (
  env: Env,
  opts: { from?: LocalDate; to?: LocalDate; sport?: Sport; limit?: number; cursor?: string },
) => Promise<{ recomputed: number; nextCursor?: string }>;
