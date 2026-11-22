/**
 * Canonical domain contract for Cadence.
 *
 * Every layer (worker API, Garmin sync, metrics engine, web app) codes against
 * these schemas. API payloads are camelCase and validated with these zod
 * schemas; the D1 schema mirrors them in snake_case.
 *
 * Conventions
 *  - Local calendar dates: 'YYYY-MM-DD' strings (LocalDate). Never Date objects.
 *  - Instants: ISO-8601 UTC strings ('2026-11-21T07:30:00Z').
 *  - Durations: seconds. Distances: meters. Speed: m/s. Power: watts.
 *    Elevation: meters. Weight: kilograms. HR: bpm. Unit conversion is UI-only.
 *  - "Load" is the single training-load currency (1 h at threshold = 100).
 *  - ISO weeks: 'YYYY-Www' (e.g. '2026-W47'); weeks start on Monday.
 */
import { z } from 'zod';

// ───────────────────────────── primitives ─────────────────────────────

export const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
export type LocalDate = z.infer<typeof LocalDate>;

export const IsoWeek = z.string().regex(/^\d{4}-W\d{2}$/, 'YYYY-Www');
export type IsoWeek = z.infer<typeof IsoWeek>;

export const IsoInstant = z.string().min(10);
export type IsoInstant = z.infer<typeof IsoInstant>;

export const SPORTS = [
  'bike',
  'run',
  'swim',
  'row',
  'strength',
  'hike',
  'walk',
  'yoga',
  'ski',
  'other',
] as const;
export const Sport = z.enum(SPORTS);
export type Sport = z.infer<typeof Sport>;

export const SUB_SPORTS = [
  // bike
  'road', 'indoor', 'mtb', 'gravel', 'virtual',
  // run
  'road_run', 'trail', 'treadmill', 'track',
  // swim
  'pool', 'open_water',
  // row
  'erg', 'on_water',
  // strength
  'gym', 'bodyweight', 'mobility', 'hiit',
  'generic',
] as const;
export const SubSport = z.enum(SUB_SPORTS);
export type SubSport = z.infer<typeof SubSport>;

/** Display metadata; glyph names map to the icon set in the web app. */
export const SPORT_META: Record<Sport, { label: string; hasDistance: boolean; subSports: SubSport[] }> = {
  bike: { label: 'Ride', hasDistance: true, subSports: ['road', 'indoor', 'virtual', 'gravel', 'mtb'] },
  run: { label: 'Run', hasDistance: true, subSports: ['road_run', 'trail', 'treadmill', 'track'] },
  swim: { label: 'Swim', hasDistance: true, subSports: ['pool', 'open_water'] },
  row: { label: 'Row', hasDistance: true, subSports: ['erg', 'on_water'] },
  strength: { label: 'Strength', hasDistance: false, subSports: ['gym', 'bodyweight', 'mobility', 'hiit'] },
  hike: { label: 'Hike', hasDistance: true, subSports: ['generic'] },
  walk: { label: 'Walk', hasDistance: true, subSports: ['generic'] },
  yoga: { label: 'Yoga', hasDistance: false, subSports: ['generic'] },
  ski: { label: 'Ski', hasDistance: true, subSports: ['generic'] },
  other: { label: 'Other', hasDistance: false, subSports: ['generic'] },
};

// ───────────────────────────── intensity ─────────────────────────────

export const INTENSITY_CLASSES = ['recovery', 'endurance', 'tempo', 'threshold', 'high', 'race'] as const;
export const IntensityClass = z.enum(INTENSITY_CLASSES);
export type IntensityClass = z.infer<typeof IntensityClass>;

/** Pip count 1–5 on cards; race renders a flag. */
export const INTENSITY_META: Record<IntensityClass, { label: string; level: 1 | 2 | 3 | 4 | 5; bucket: 'easy' | 'moderate' | 'hard' }> = {
  recovery: { label: 'Recovery', level: 1, bucket: 'easy' },
  endurance: { label: 'Endurance', level: 2, bucket: 'easy' },
  tempo: { label: 'Tempo', level: 3, bucket: 'moderate' },
  threshold: { label: 'Threshold', level: 4, bucket: 'hard' },
  high: { label: 'High', level: 5, bucket: 'hard' },
  race: { label: 'Race', level: 5, bucket: 'hard' },
};

// ───────────────────────────── compliance ─────────────────────────────

export const COMPLIANCE_STATES = [
  'planned', // future, or today and not yet done
  'on_target', // 80–120 %
  'partial_short', // 50–79 %
  'partial_long', // 121–150 %
  'off_short', // < 50 %
  'off_long', // > 150 %
  'missed', // planned date passed, unpaired
  'excused', // skipped with reason / sick-injured day
  'unplanned', // completed with no plan
] as const;
export const ComplianceState = z.enum(COMPLIANCE_STATES);
export type ComplianceState = z.infer<typeof ComplianceState>;

export const Compliance = z.object({
  metric: z.enum(['load', 'duration', 'distance']),
  ratio: z.number(), // actual / planned, e.g. 0.93
  state: ComplianceState,
});
export type Compliance = z.infer<typeof Compliance>;

// ───────────────────────────── workout structure ─────────────────────────────

export const Target = z.discriminatedUnion('type', [
  z.object({ type: z.literal('open') }),
  z.object({ type: z.literal('power_pct'), low: z.number(), high: z.number() }), // % of threshold power
  z.object({ type: z.literal('power_w'), low: z.number(), high: z.number() }),
  z.object({ type: z.literal('hr_zone'), zone: z.number().int().min(1).max(7) }),
  z.object({ type: z.literal('hr_pct_lthr'), low: z.number(), high: z.number() }),
  z.object({ type: z.literal('hr_bpm'), low: z.number(), high: z.number() }),
  /** Absolute pace as speed range in m/s (low = slower bound). UI renders per-unit pace. */
  z.object({ type: z.literal('pace'), lowMps: z.number(), highMps: z.number() }),
  /** % of threshold speed (run threshold pace / swim CSS / row threshold split). */
  z.object({ type: z.literal('pace_pct'), low: z.number(), high: z.number() }),
  z.object({ type: z.literal('rpe'), low: z.number(), high: z.number() }),
  z.object({ type: z.literal('cadence'), low: z.number(), high: z.number() }),
  /** Linear ramp between two intensities expressed in `basis` units. */
  z.object({
    type: z.literal('ramp'),
    basis: z.enum(['power_pct', 'pace_pct', 'hr_pct_lthr']),
    from: z.number(),
    to: z.number(),
  }),
]);
export type Target = z.infer<typeof Target>;

export const StepMeasure = z.discriminatedUnion('type', [
  z.object({ type: z.literal('time'), sec: z.number().positive() }),
  z.object({ type: z.literal('distance'), m: z.number().positive() }),
  z.object({ type: z.literal('lap_button') }),
  z.object({ type: z.literal('reps'), n: z.number().int().positive() }),
]);
export type StepMeasure = z.infer<typeof StepMeasure>;

export const STEP_ROLES = ['warmup', 'active', 'recovery', 'rest', 'cooldown', 'other'] as const;
export const StepRole = z.enum(STEP_ROLES);
export type StepRole = z.infer<typeof StepRole>;

export const SWIM_STROKES = ['free', 'back', 'breast', 'fly', 'im', 'choice', 'kick', 'drill'] as const;
export const SWIM_EQUIPMENT = ['pull_buoy', 'paddles', 'fins', 'kick_board', 'snorkel'] as const;

export const StrengthPrescription = z.object({
  exercise: z.string(), // free-text name; `exerciseKey` maps to the catalog when known
  exerciseKey: z.string().optional(),
  sets: z.number().int().positive(),
  reps: z.number().int().positive().optional(),
  durationSec: z.number().positive().optional(),
  weightKg: z.number().nonnegative().optional(),
  rpe: z.number().min(1).max(10).optional(),
  restSec: z.number().nonnegative().optional(),
  supersetGroup: z.string().optional(),
});
export type StrengthPrescription = z.infer<typeof StrengthPrescription>;

export const Step = z.object({
  kind: z.literal('step'),
  id: z.string(), // stable client id for layout animation keys
  role: StepRole,
  label: z.string().optional(),
  cue: z.string().optional(),
  measure: StepMeasure,
  target: Target.optional(),
  secondary: Target.optional(),
  swim: z
    .object({
      stroke: z.enum(SWIM_STROKES).optional(),
      equipment: z.array(z.enum(SWIM_EQUIPMENT)).optional(),
      sendOffSec: z.number().positive().optional(),
      restSec: z.number().nonnegative().optional(),
    })
    .optional(),
  row: z.object({ strokeRateLow: z.number().optional(), strokeRateHigh: z.number().optional() }).optional(),
  strength: StrengthPrescription.optional(),
});
export type Step = z.infer<typeof Step>;

/** Inner repeat: only plain steps. */
export const InnerRepeat = z.object({
  kind: z.literal('repeat'),
  id: z.string(),
  count: z.number().int().min(1),
  label: z.string().optional(),
  steps: z.array(Step),
});
export type InnerRepeat = z.infer<typeof InnerRepeat>;

/** Outer repeat: steps or one more level of repeat (max nesting depth 2). */
export const Repeat = z.object({
  kind: z.literal('repeat'),
  id: z.string(),
  count: z.number().int().min(1),
  label: z.string().optional(),
  steps: z.array(z.discriminatedUnion('kind', [Step, InnerRepeat])),
});
export type Repeat = z.infer<typeof Repeat>;

export const StructureNode = z.discriminatedUnion('kind', [Step, Repeat]);
export type StructureNode = z.infer<typeof StructureNode>;

export const WorkoutStructure = z.object({
  steps: z.array(StructureNode),
  poolLengthM: z.number().positive().optional(),
});
export type WorkoutStructure = z.infer<typeof WorkoutStructure>;

// ───────────────────────────── planned workouts ─────────────────────────────

export const SKIP_REASONS = ['sick', 'injury', 'travel', 'fatigue', 'life', 'weather', 'other'] as const;

export const GarminLink = z.object({
  workoutId: z.string().optional(),
  scheduleId: z.string().optional(),
  syncState: z.enum(['none', 'pending', 'synced', 'error']),
  lastPushedAt: IsoInstant.optional(),
  error: z.string().optional(),
});
export type GarminLink = z.infer<typeof GarminLink>;

export const PlannedWorkout = z.object({
  id: z.string(),
  date: LocalDate,
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  sport: Sport,
  subSport: SubSport.optional(),
  title: z.string(),
  description: z.string().optional(), // purpose / coaching cues (markdown)
  preNote: z.string().optional(),
  plannedDurationSec: z.number().nonnegative().optional(),
  plannedDistanceM: z.number().nonnegative().optional(),
  plannedLoad: z.number().nonnegative().optional(),
  plannedIntensityFactor: z.number().nonnegative().optional(),
  structure: WorkoutStructure.optional(),
  isKey: z.boolean(),
  intensity: IntensityClass,
  tags: z.array(z.string()),
  environment: z.enum(['indoor', 'outdoor', 'any']),
  templateId: z.string().optional(),
  seriesId: z.string().optional(),
  eventId: z.string().optional(),
  pairedActivityId: z.string().optional(),
  status: z.enum(['planned', 'skipped']),
  skipReason: z.enum(SKIP_REASONS).optional(),
  /** Derived server-side on read (never stored). */
  compliance: Compliance.optional(),
  /** ≤ 48 values 0..1: planned intensity profile for the calendar card (derived from structure). */
  sparkline: z.array(z.number()).optional(),
  garmin: GarminLink,
  createdAt: IsoInstant,
  updatedAt: IsoInstant,
});
export type PlannedWorkout = z.infer<typeof PlannedWorkout>;

/** Create/update payloads: server fills ids, timestamps, derived planned totals. */
export const PlannedWorkoutInput = PlannedWorkout.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  compliance: true,
  sparkline: true,
  garmin: true,
  pairedActivityId: true,
}).partial({ isKey: true, intensity: true, tags: true, environment: true, status: true });
export type PlannedWorkoutInput = z.infer<typeof PlannedWorkoutInput>;

export const Template = z.object({
  id: z.string(),
  sport: Sport,
  subSport: SubSport.optional(),
  title: z.string(),
  description: z.string().optional(),
  plannedDurationSec: z.number().nonnegative().optional(),
  plannedDistanceM: z.number().nonnegative().optional(),
  plannedLoad: z.number().nonnegative().optional(),
  plannedIntensityFactor: z.number().nonnegative().optional(),
  structure: WorkoutStructure.optional(),
  intensity: IntensityClass,
  tags: z.array(z.string()),
  folder: z.string().optional(),
  usageCount: z.number().int().nonnegative(),
  lastUsedAt: IsoInstant.optional(),
  createdAt: IsoInstant,
  updatedAt: IsoInstant,
});
export type Template = z.infer<typeof Template>;

// ───────────────────────────── completed activities ─────────────────────────────

export const LOAD_SOURCES = ['power', 'pace', 'swim_pace', 'hr', 'rpe', 'duration', 'device', 'manual'] as const;
export const LoadSource = z.enum(LOAD_SOURCES);
export type LoadSource = z.infer<typeof LoadSource>;

export const Activity = z.object({
  id: z.string(),
  source: z.enum(['garmin', 'upload', 'manual', 'demo']),
  garminActivityId: z.string().optional(),
  /** Raw Garmin activityType.typeKey, kept so unmapped types are not lost as 'other'. */
  garminTypeKey: z.string().optional(),
  startedAt: IsoInstant,
  utcOffsetMin: z.number().int(), // local = UTC + offset
  localDate: LocalDate,
  sport: Sport,
  subSport: SubSport.optional(),
  title: z.string(),
  durationSec: z.number().nonnegative(), // elapsed
  movingSec: z.number().nonnegative(),
  distanceM: z.number().nonnegative().optional(),
  elevationGainM: z.number().nonnegative().optional(),
  load: z.number().nonnegative(),
  loadSource: LoadSource,
  intensityFactor: z.number().nonnegative().optional(),
  avgHr: z.number().optional(),
  maxHr: z.number().optional(),
  avgPower: z.number().optional(),
  weightedPower: z.number().optional(), // "Weighted Power" (NP-equivalent)
  maxPower: z.number().optional(),
  avgSpeedMps: z.number().optional(),
  adjustedSpeedMps: z.number().optional(), // grade-adjusted (run)
  avgCadence: z.number().optional(),
  calories: z.number().optional(),
  workKj: z.number().optional(),
  variability: z.number().optional(),
  efficiency: z.number().optional(),
  decouplingPct: z.number().optional(),
  aerobicEffect: z.number().optional(), // device training effect 0–5
  anaerobicEffect: z.number().optional(),
  // swim
  poolLengthM: z.number().optional(),
  strokes: z.number().optional(),
  avgSwolf: z.number().optional(),
  // strength
  totalSets: z.number().optional(),
  totalReps: z.number().optional(),
  volumeKg: z.number().optional(),
  intensityAuto: IntensityClass,
  intensityOverride: IntensityClass.optional(),
  /** Resolved: override ?? auto. */
  intensity: IntensityClass,
  isKey: z.boolean(),
  rpe: z.number().int().min(1).max(10).optional(),
  feel: z.number().int().min(1).max(5).optional(), // 1 awful … 5 great
  postNote: z.string().optional(),
  tags: z.array(z.string()),
  pairedWorkoutId: z.string().optional(),
  compliance: Compliance.optional(),
  hasStreams: z.boolean(),
  /** ≤ 48 values 0..1, downsampled effort profile for the calendar card sparkline. */
  sparkline: z.array(z.number()).optional(),
  createdAt: IsoInstant,
  updatedAt: IsoInstant,
});
export type Activity = z.infer<typeof Activity>;

export const Lap = z.object({
  index: z.number().int(),
  startSec: z.number(),
  durationSec: z.number(),
  movingSec: z.number().optional(),
  distanceM: z.number().optional(),
  avgHr: z.number().optional(),
  maxHr: z.number().optional(),
  avgPower: z.number().optional(),
  weightedPower: z.number().optional(),
  avgSpeedMps: z.number().optional(),
  avgCadence: z.number().optional(),
  elevationGainM: z.number().optional(),
  // swim
  lengths: z.number().optional(),
  stroke: z.string().optional(),
  swolf: z.number().optional(),
  isRest: z.boolean().optional(),
});
export type Lap = z.infer<typeof Lap>;

export const ZoneTime = z.object({
  zone: z.number().int(), // 1-based
  name: z.string(),
  low: z.number().nullable(), // in the zone model's native unit (W, bpm, m/s)
  high: z.number().nullable(),
  seconds: z.number(),
});
export type ZoneTime = z.infer<typeof ZoneTime>;

/** Mean-maximal point: best average `value` held for `durationSec`. */
export const PeakPoint = z.object({ durationSec: z.number(), value: z.number(), startSec: z.number().optional() });
export type PeakPoint = z.infer<typeof PeakPoint>;

/** Best time over a fixed distance (run / swim / row). */
export const BestEffort = z.object({ distanceM: z.number(), timeSec: z.number(), startSec: z.number().optional() });
export type BestEffort = z.infer<typeof BestEffort>;

export const StrengthSet = z.object({
  index: z.number().int(),
  exercise: z.string(),
  category: z.string().optional(),
  reps: z.number().optional(),
  weightKg: z.number().optional(),
  durationSec: z.number().optional(),
  isRest: z.boolean().optional(),
});
export type StrengthSet = z.infer<typeof StrengthSet>;

export const ThresholdSnapshot = z.object({
  ftp: z.number().optional(), // W (bike)
  runThresholdMps: z.number().optional(),
  swimCssMps: z.number().optional(),
  rowThresholdW: z.number().optional(),
  lthr: z.number().optional(),
  hrMax: z.number().optional(),
  hrRest: z.number().optional(),
  weightKg: z.number().optional(),
});
export type ThresholdSnapshot = z.infer<typeof ThresholdSnapshot>;

export const ActivityDetail = Activity.extend({
  laps: z.array(Lap),
  zones: z.object({
    hr: z.array(ZoneTime).optional(),
    power: z.array(ZoneTime).optional(),
    pace: z.array(ZoneTime).optional(),
  }),
  peaks: z.object({
    power: z.array(PeakPoint).optional(),
    hr: z.array(PeakPoint).optional(),
    speed: z.array(PeakPoint).optional(), // m/s
    efforts: z.array(BestEffort).optional(),
  }),
  strengthSets: z.array(StrengthSet).optional(),
  thresholdsUsed: ThresholdSnapshot,
  plannedWorkout: PlannedWorkout.optional(),
  /** The previous activity of the same sport with similar duration, for comparison. */
  previousSimilar: Activity.optional(),
});
export type ActivityDetail = z.infer<typeof ActivityDetail>;

/**
 * 1 Hz (resampled) time series. All arrays share the length of `t`.
 * null = no sample. `latlng` is omitted for indoor sessions.
 */
export const ActivityStreams = z.object({
  t: z.array(z.number()), // seconds from start
  hr: z.array(z.number().nullable()).optional(),
  power: z.array(z.number().nullable()).optional(),
  speed: z.array(z.number().nullable()).optional(), // m/s
  cadence: z.array(z.number().nullable()).optional(),
  altitude: z.array(z.number().nullable()).optional(), // m
  distance: z.array(z.number().nullable()).optional(), // cumulative m
  grade: z.array(z.number().nullable()).optional(), // fraction
  temp: z.array(z.number().nullable()).optional(),
  lat: z.array(z.number().nullable()).optional(),
  lng: z.array(z.number().nullable()).optional(),
});
export type ActivityStreams = z.infer<typeof ActivityStreams>;
export const STREAM_CHANNELS = ['hr', 'power', 'speed', 'cadence', 'altitude', 'distance', 'grade', 'temp', 'lat', 'lng'] as const;
export type StreamChannel = (typeof STREAM_CHANNELS)[number];

export const ActivityPatch = z
  .object({
    title: z.string(),
    sport: Sport,
    subSport: SubSport,
    isKey: z.boolean(),
    intensityOverride: IntensityClass.nullable(),
    rpe: z.number().int().min(1).max(10).nullable(),
    feel: z.number().int().min(1).max(5).nullable(),
    postNote: z.string().nullable(),
    tags: z.array(z.string()),
  })
  .partial();
export type ActivityPatch = z.infer<typeof ActivityPatch>;

export const ManualActivityInput = z.object({
  localDate: LocalDate,
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  sport: Sport,
  subSport: SubSport.optional(),
  title: z.string(),
  durationSec: z.number().positive(),
  distanceM: z.number().nonnegative().optional(),
  avgHr: z.number().optional(),
  avgPower: z.number().optional(),
  rpe: z.number().int().min(1).max(10).optional(),
  feel: z.number().int().min(1).max(5).optional(),
  postNote: z.string().optional(),
  load: z.number().nonnegative().optional(), // manual override
});
export type ManualActivityInput = z.infer<typeof ManualActivityInput>;

// ───────────────────────────── calendar furniture ─────────────────────────────

export const Event = z.object({
  id: z.string(),
  date: LocalDate,
  name: z.string(),
  priority: z.enum(['A', 'B', 'C']),
  sport: Sport.optional(),
  distanceM: z.number().optional(),
  goal: z.string().optional(),
  location: z.string().optional(),
  note: z.string().optional(),
  resultActivityId: z.string().optional(),
});
export type Event = z.infer<typeof Event>;

export const PHASE_TYPES = ['base', 'build', 'peak', 'taper', 'race', 'recovery', 'transition'] as const;
export const Phase = z.object({
  id: z.string(),
  type: z.enum(PHASE_TYPES),
  label: z.string(),
  startDate: LocalDate, // inclusive, a Monday
  endDate: LocalDate, // inclusive, a Sunday
  weeklyLoadTarget: z.number().optional(),
});
export type Phase = z.infer<typeof Phase>;

export const DAY_MARKER_TYPES = ['rest', 'sick', 'injured', 'travel', 'vacation', 'altitude'] as const;
export const DayMarker = z.object({
  id: z.string(),
  type: z.enum(DAY_MARKER_TYPES),
  date: LocalDate,
  endDate: LocalDate.optional(), // inclusive
  label: z.string().optional(),
});
export type DayMarker = z.infer<typeof DayMarker>;

export const DayNote = z.object({ date: LocalDate, body: z.string(), updatedAt: IsoInstant });
export type DayNote = z.infer<typeof DayNote>;

export const WeekNote = z.object({
  isoWeek: IsoWeek,
  body: z.string(),
  targetHours: z.number().optional(),
  targetLoad: z.number().optional(),
  updatedAt: IsoInstant,
});
export type WeekNote = z.infer<typeof WeekNote>;

export const WellnessDay = z.object({
  date: LocalDate,
  hrvMs: z.number().optional(), // overnight rMSSD
  hrvStatus: z.string().optional(),
  restingHr: z.number().optional(),
  sleepSec: z.number().optional(),
  sleepScore: z.number().optional(),
  weightKg: z.number().optional(),
  bodyBattery: z.number().optional(),
  stress: z.number().optional(),
  readiness: z.number().optional(), // device training readiness 0–100
  vo2max: z.number().optional(),
  feel: z.number().int().min(1).max(5).optional(), // manual morning check-in
  soreness: z.number().int().min(1).max(5).optional(),
  note: z.string().optional(),
});
export type WellnessDay = z.infer<typeof WellnessDay>;

// ───────────────────────────── athlete settings ─────────────────────────────

export const THRESHOLD_KINDS = [
  'ftp', // W, sport: bike
  'run_threshold', // m/s threshold speed, sport: run
  'swim_css', // m/s critical swim speed, sport: swim
  'row_threshold', // W, sport: row
  'lthr', // bpm, per sport or sport 'all'
  'hr_max', // bpm
  'hr_rest', // bpm
  'weight', // kg
] as const;
export const ThresholdKind = z.enum(THRESHOLD_KINDS);
export type ThresholdKind = z.infer<typeof ThresholdKind>;

/** Effective-dated: a metric on date D uses the latest entry with effectiveFrom ≤ D. */
export const Threshold = z.object({
  id: z.string(),
  kind: ThresholdKind,
  sport: z.union([Sport, z.literal('all')]),
  value: z.number().positive(),
  effectiveFrom: LocalDate,
  source: z.enum(['manual', 'garmin', 'estimated']),
  note: z.string().optional(),
});
export type Threshold = z.infer<typeof Threshold>;

/** UI accent options (DESIGN_V2 §2). */
export const ACCENTS = ['blue', 'green', 'rose'] as const;
export const Accent = z.enum(ACCENTS);
export type Accent = z.infer<typeof Accent>;

export const Settings = z.object({
  name: z.string(),
  sex: z.enum(['male', 'female', 'unspecified']),
  birthYear: z.number().int().optional(),
  units: z.enum(['metric', 'imperial']),
  weekStart: z.enum(['monday', 'sunday']),
  timezone: z.string(), // IANA
  theme: z.enum(['dark', 'light', 'system']),
  /** UI accent hue (<html data-accent>). Required in the type; stored settings without it are merged
   *  over DEFAULT_SETTINGS by the Worker. Deliberately no `.default()`: zod 4 applies defaults inside
   *  `.partial()`, so a PATCH without `accent` would silently reset it. */
  accent: Accent,
  density: z.enum(['comfortable', 'compact']),
  reducedMotion: z.boolean(),
  homeRoute: z.enum(['today', 'calendar']),
  garminAutoPushDays: z.number().int().min(0).max(30), // push planned workouts this many days ahead
  onboarded: z.boolean(),
});
export type Settings = z.infer<typeof Settings>;

export const DEFAULT_SETTINGS: Settings = {
  name: '',
  sex: 'unspecified',
  units: 'metric',
  weekStart: 'monday',
  timezone: 'UTC',
  theme: 'dark',
  accent: 'blue',
  density: 'comfortable',
  reducedMotion: false,
  homeRoute: 'calendar',
  garminAutoPushDays: 7,
  onboarded: false,
};

// ───────────────────────────── aggregates served by the API ─────────────────────────────

export const FORM_ZONES = ['transition', 'fresh', 'neutral', 'productive', 'overreaching'] as const;
export const FormZone = z.enum(FORM_ZONES);
export type FormZone = z.infer<typeof FormZone>;

/** One day of the fitness model. `projected` days use planned load. */
export const FitnessDay = z.object({
  date: LocalDate,
  load: z.number(), // completed load that day
  plannedLoad: z.number(), // planned (unpaired remaining) load that day
  fitness: z.number(), // 42-day EWMA (end of day)
  fatigue: z.number(), // 7-day EWMA (end of day)
  form: z.number(), // yesterday's fitness − fatigue
  formPct: z.number().nullable(), // form as PERCENT of fitness (−24 = −24 %)
  formZone: FormZone.nullable(),
  ramp: z.number().nullable(), // fitness − fitness 7 days earlier
  projected: z.boolean(),
});
export type FitnessDay = z.infer<typeof FitnessDay>;

export const SportTotals = z.object({
  sport: Sport,
  plannedSec: z.number(),
  doneSec: z.number(),
  plannedLoad: z.number(),
  doneLoad: z.number(),
  plannedDistanceM: z.number(),
  doneDistanceM: z.number(),
  plannedCount: z.number().int(),
  doneCount: z.number().int(),
  elevationGainM: z.number(),
});
export type SportTotals = z.infer<typeof SportTotals>;

/** WoW delta as a fraction (0.08 = +8 %); null when the previous week is zero. */
export const WeekSummary = z.object({
  isoWeek: IsoWeek,
  startDate: LocalDate,
  endDate: LocalDate,
  plannedSec: z.number(),
  doneSec: z.number(),
  plannedLoad: z.number(),
  doneLoad: z.number(),
  plannedDistanceM: z.number(),
  doneDistanceM: z.number(),
  elevationGainM: z.number(),
  /** Done so far + still-planned remainder (current/future weeks). */
  projectedSec: z.number(),
  projectedLoad: z.number(),
  targetHours: z.number().optional(),
  targetLoad: z.number().optional(),
  bySport: z.array(SportTotals),
  keyPlanned: z.number().int(),
  keyDone: z.number().int(),
  /** Seconds of done time by intensity bucket. */
  intensitySec: z.object({ easy: z.number(), moderate: z.number(), hard: z.number() }),
  /** Mean clamped compliance over past planned workouts in PERCENT (0–100), null when none. */
  compliancePct: z.number().nullable(),
  fitness: z.number(), // at week end (projected for current/future)
  fatigue: z.number(),
  form: z.number(),
  formPct: z.number().nullable(), // percent
  formZone: FormZone.nullable(),
  fitnessDelta: z.number(), // vs previous week end
  wowSec: z.number().nullable(),
  wowLoad: z.number().nullable(),
  wowDistanceM: z.number().nullable(),
  isProjected: z.boolean(), // week ends in the future
  hasNote: z.boolean(),
  phaseId: z.string().optional(),
  /** Daily done load Mon..Sun for the summary sparkline. */
  dailyLoad: z.array(z.number()).length(7),
});
export type WeekSummary = z.infer<typeof WeekSummary>;

export const CalendarResponse = z.object({
  from: LocalDate,
  to: LocalDate,
  today: LocalDate,
  workouts: z.array(PlannedWorkout),
  activities: z.array(Activity),
  events: z.array(Event),
  phases: z.array(Phase),
  markers: z.array(DayMarker),
  dayNotes: z.array(DayNote),
  wellness: z.array(WellnessDay),
  weeks: z.array(WeekSummary),
});
export type CalendarResponse = z.infer<typeof CalendarResponse>;

export const SyncLogEntry = z.object({
  id: z.string(),
  at: IsoInstant,
  kind: z.enum(['pull_activities', 'pull_wellness', 'push_workout', 'backfill', 'auth', 'recompute']),
  status: z.enum(['ok', 'error', 'running']),
  summary: z.string(),
  detail: z.string().optional(),
  durationMs: z.number().optional(),
});
export type SyncLogEntry = z.infer<typeof SyncLogEntry>;

export const GarminStatus = z.object({
  connected: z.boolean(),
  displayName: z.string().optional(),
  lastSyncAt: IsoInstant.optional(),
  lastError: z.string().optional(),
  state: z.enum(['disconnected', 'needs_mfa', 'connected', 'error']),
  backfill: z
    .object({ running: z.boolean(), done: z.number(), total: z.number().nullable(), oldestDate: LocalDate.optional() })
    .optional(),
});
export type GarminStatus = z.infer<typeof GarminStatus>;
