/**
 * Contract between the synthetic-athlete generator (src/synth) and the mock
 * Garmin server (src/mock). The generator produces a deterministic, realistic
 * training history; the mock server serves it in Garmin's wire formats so the
 * real sync pipeline can be exercised end-to-end offline (tests, demo mode).
 *
 * Streams are NOT held in memory for the whole history (Workers have 128 MB):
 * summaries are generated eagerly, streams/FIT bytes lazily per activity.
 */
import type {
  ActivityStreams,
  DayMarker,
  DayNote,
  Event,
  IntensityClass,
  Lap,
  LocalDate,
  Phase,
  Sport,
  StrengthSet,
  SubSport,
  WeekNote,
  WellnessDay,
  WorkoutStructure,
} from '@cadence/core/domain';

export interface SynthProfile {
  displayName: string;
  fullName: string;
  sex: 'male' | 'female';
  birthYear: number;
  timezone: string; // IANA
  utcOffsetMin: number;
  weightKg: number;
  hrMax: number;
  hrRest: number;
  lthr: number;
  /** Current values; see thresholdHistory for dated changes. */
  ftp: number;
  runThresholdMps: number;
  swimCssMps: number;
  rowThresholdW: number;
}

export interface SynthThresholdChange {
  kind: 'ftp' | 'run_threshold' | 'swim_css' | 'row_threshold' | 'lthr' | 'weight';
  value: number;
  effectiveFrom: LocalDate;
}

/** What the athlete intended to do on a day (becomes a PlannedWorkout in demo mode). */
export interface SynthPlannedSession {
  key: string; // stable id, e.g. '2026-11-17#1'
  date: LocalDate;
  startTime?: string; // 'HH:mm'
  sport: Sport;
  subSport?: SubSport;
  title: string;
  description?: string;
  preNote?: string;
  structure?: WorkoutStructure;
  plannedDurationSec: number;
  plannedDistanceM?: number;
  isKey: boolean;
  intensity: IntensityClass;
  tags: string[];
  environment: 'indoor' | 'outdoor' | 'any';
  /** Set when the session was skipped (no activity generated). */
  skipped?: { reason: 'sick' | 'injury' | 'travel' | 'fatigue' | 'life' | 'weather' | 'other' };
  /** garminActivityId of the activity performed for this session, if any. */
  activityId?: number;
}

/** Summary of a completed activity (cheap; no streams). */
export interface SynthActivity {
  garminActivityId: number;
  /** Garmin activityType.typeKey, e.g. 'road_biking', 'lap_swimming'. */
  garminTypeKey: string;
  startedAt: string; // ISO UTC instant
  utcOffsetMin: number;
  localDate: LocalDate;
  sport: Sport;
  subSport?: SubSport;
  title: string;
  durationSec: number; // elapsed
  movingSec: number;
  distanceM?: number;
  elevationGainM?: number;
  avgHr?: number;
  maxHr?: number;
  avgPower?: number;
  normPower?: number;
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
  hasGps: boolean;
  // ── detail extras (see extras.ts); Garmin reports these in the activity list / summary
  /** Reverse-geocoded place name of the start ("Girona"); none indoors. */
  locationName?: string;
  startLat?: number;
  startLng?: number;
  endLat?: number;
  endLng?: number;
  elevationLossM?: number;
  minElevationM?: number;
  maxElevationM?: number;
  maxSpeedMps?: number;
  avgTempC?: number;
  minTempC?: number;
  maxTempC?: number;
  maxCadence?: number;
  /** Running dynamics (HRM-Pro): ms, % left, cm, %, m. */
  avgGroundContactMs?: number;
  avgGroundContactBalancePct?: number;
  avgVerticalOscillationCm?: number;
  avgVerticalRatioPct?: number;
  avgStrideLengthM?: number;
  steps?: number;
  /** Dual-sided power pedals: left share in percent. */
  powerBalanceLeftPct?: number;
  /** Garmin's EPOC training load and primary benefit label. */
  deviceLoad?: number;
  trainingEffectLabel?: string;
  /** RPE 1–10 / feel 1–5 the athlete logged afterwards (applied in demo seed, not from Garmin). */
  rpe?: number;
  feel?: number;
  postNote?: string;
  /** Planned session this activity fulfils, if any. */
  plannedKey?: string;
}

/** Full detail for one activity, generated on demand. */
export interface SynthActivityDetail {
  activity: SynthActivity;
  streams?: ActivityStreams; // 1 Hz; absent for strength/yoga without HR
  laps: Lap[];
  strengthSets?: StrengthSet[];
  /** Runs: per-second running dynamics aligned with `streams.t` (ms, cm, %, m). */
  dynamics?: { gct: (number | null)[]; vo: (number | null)[]; vr: (number | null)[]; step: (number | null)[] };
}

export interface SynthAthlete {
  seed: number;
  today: LocalDate;
  profile: SynthProfile;
  thresholdHistory: SynthThresholdChange[];
  /** Completed activities, oldest → newest, all with localDate ≤ today. */
  activities: SynthActivity[];
  /** Past and future planned sessions (future ≈ 3–4 weeks ahead). */
  plan: SynthPlannedSession[];
  wellness: WellnessDay[]; // one per day up to today
  events: Omit<Event, 'id'>[];
  phases: Omit<Phase, 'id'>[];
  markers: Omit<DayMarker, 'id'>[];
  dayNotes: Omit<DayNote, 'updatedAt'>[];
  weekNotes: Omit<WeekNote, 'updatedAt'>[];
}

export interface SynthOptions {
  seed?: number; // default 7
  today: LocalDate;
  /** Months of history to generate (default 12). */
  months?: number;
}

/** Implemented in src/synth/index.ts. */
export interface SynthApi {
  generateAthlete(opts: SynthOptions): SynthAthlete;
  /** Deterministic: same athlete + id → identical detail. */
  generateActivityDetail(athlete: SynthAthlete, garminActivityId: number): SynthActivityDetail;
  /** Encode a detail as a real FIT activity file (what Garmin's "original" download contains). */
  encodeFit(detail: SynthActivityDetail): Uint8Array;
}
