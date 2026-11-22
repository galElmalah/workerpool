/**
 * Garmin JSON → Cadence domain (garmin.md §3.2, §3.8, §4, §10 unit notes).
 *
 * Everything here is pure and tolerant: unknown/missing fields become
 * `undefined`, never exceptions (except mapActivitySummary on an item with no id
 * or start time, which is not an activity).
 */
import type {
  ActivityFacts,
  ActivityStreams,
  Lap,
  LocalDate,
  Sport,
  StrengthSet,
  SubSport,
  ThresholdSnapshot,
  WellnessDay,
} from '@cadence/core/domain';
import { GarminError } from './errors';
import { humanizeExercise } from './exercises';
import {
  asArray,
  asObject,
  bool,
  compact,
  fnv1a,
  isObject,
  num,
  parseGarminTimestamp,
  round,
  stableStringify,
  str,
  toIsoInstant,
  utcDate,
  type JsonObject,
} from './util';

// ───────────────────────────── activity types ─────────────────────────────

export interface MappedActivityType {
  sport: Sport;
  subSport?: SubSport;
  /** Multisport container (store legs as activities; mark parent as container). */
  isMultisportParent?: boolean;
  /** Transition leg of a multisport activity. */
  isTransition?: boolean;
}

type TypeRow = [Sport, SubSport?];

/**
 * typeKey → sport/subSport. Keys VERIFIED from fixtures: trail_running,
 * hiking, open_water_swimming, stand_up_paddleboarding_v2; the rest are
 * UNVERIFIED (garmin.md §3.8) — unknown keys fall back to the parent type and
 * then to keyword heuristics, so a renamed key degrades gracefully.
 */
export const ACTIVITY_TYPE_TABLE: Record<string, TypeRow> = {
  // run
  running: ['run', 'road_run'],
  street_running: ['run', 'road_run'],
  track_running: ['run', 'track'],
  trail_running: ['run', 'trail'],
  treadmill_running: ['run', 'treadmill'],
  indoor_running: ['run', 'treadmill'],
  virtual_run: ['run', 'treadmill'],
  ultra_run: ['run', 'trail'],
  obstacle_run: ['run', 'trail'],
  // bike (outdoor)
  cycling: ['bike', 'road'],
  road_biking: ['bike', 'road'],
  gravel_cycling: ['bike', 'gravel'],
  cyclocross: ['bike', 'gravel'],
  mountain_biking: ['bike', 'mtb'],
  downhill_biking: ['bike', 'mtb'],
  e_bike_mountain: ['bike', 'mtb'],
  bmx: ['bike', 'mtb'],
  track_cycling: ['bike', 'road'],
  recumbent_cycling: ['bike', 'road'],
  e_bike_fitness: ['bike', 'road'],
  handcycling: ['bike', 'road'],
  // bike (indoor)
  indoor_cycling: ['bike', 'indoor'],
  indoor_handcycling: ['bike', 'indoor'],
  virtual_ride: ['bike', 'virtual'],
  // swim
  swimming: ['swim'],
  lap_swimming: ['swim', 'pool'],
  open_water_swimming: ['swim', 'open_water'],
  // row
  rowing_v2: ['row', 'on_water'],
  rowing: ['row', 'on_water'],
  indoor_rowing: ['row', 'erg'],
  // strength / hiit / cardio
  strength_training: ['strength', 'gym'],
  hiit: ['strength', 'hiit'],
  indoor_cardio: ['strength', 'hiit'],
  fitness_equipment: ['other', 'generic'],
  elliptical: ['other', 'generic'],
  stair_climbing: ['other', 'generic'],
  floor_climbing: ['other', 'generic'],
  // mobility
  yoga: ['yoga', 'generic'],
  pilates: ['yoga', 'generic'],
  breathwork: ['yoga', 'generic'],
  mobility: ['strength', 'mobility'],
  // walk / hike
  walking: ['walk', 'generic'],
  casual_walking: ['walk', 'generic'],
  speed_walking: ['walk', 'generic'],
  indoor_walking: ['walk', 'generic'],
  hiking: ['hike', 'generic'],
  mountaineering: ['hike', 'generic'],
  rucking: ['hike', 'generic'],
  // ski / snow
  resort_skiing_snowboarding_ws: ['ski', 'generic'],
  resort_skiing: ['ski', 'generic'],
  resort_snowboarding: ['ski', 'generic'],
  backcountry_skiing: ['ski', 'generic'],
  backcountry_snowboarding: ['ski', 'generic'],
  cross_country_skiing_ws: ['ski', 'generic'],
  skate_skiing_ws: ['ski', 'generic'],
  snow_shoe_ws: ['ski', 'generic'],
  // paddle: no paddle sport in the domain → other (raw typeKey is kept)
  kayaking_v2: ['other', 'generic'],
  stand_up_paddleboarding_v2: ['other', 'generic'],
  paddling: ['other', 'generic'],
  other: ['other', 'generic'],
};

const MULTISPORT_KEYS = new Set(['multi_sport', 'triathlon', 'duathlon', 'multisport', 'swimrun', 'brick']);

/** Known parent typeIds (VERIFIED: 1 running, 2 cycling, 26 swimming). */
const PARENT_TYPE_IDS: Record<number, string> = { 1: 'running', 2: 'cycling', 26: 'swimming' };

const HEURISTICS: [RegExp, TypeRow][] = [
  [/treadmill|indoor_run/, ['run', 'treadmill']],
  [/trail/, ['run', 'trail']],
  [/run/, ['run', 'road_run']],
  [/indoor_cycl|indoor_bik|virtual_ride|spin/, ['bike', 'indoor']],
  [/cycl|bik|ride/, ['bike', 'road']],
  [/open_water/, ['swim', 'open_water']],
  [/swim/, ['swim', 'pool']],
  [/indoor_row/, ['row', 'erg']],
  [/row/, ['row', 'on_water']],
  [/ski|snowboard|snow_shoe/, ['ski', 'generic']],
  [/walk/, ['walk', 'generic']],
  [/hik/, ['hike', 'generic']],
  [/yoga|pilates/, ['yoga', 'generic']],
  [/strength|weight/, ['strength', 'gym']],
];

/**
 * Map a Garmin `activityType.typeKey` to our sport. `parent` may be the parent
 * typeKey or the numeric `parentTypeId` (walked when the key itself is unknown).
 */
export function mapActivityType(typeKey: string | undefined, parent?: string | number): MappedActivityType {
  const key = (typeKey ?? '').toLowerCase();
  if (MULTISPORT_KEYS.has(key)) return { sport: 'other', subSport: 'generic', isMultisportParent: true };
  if (key.startsWith('transition')) return { sport: 'other', subSport: 'generic', isTransition: true };
  const row = ACTIVITY_TYPE_TABLE[key];
  if (row) return row[1] ? { sport: row[0], subSport: row[1] } : { sport: row[0] };
  const parentKey = typeof parent === 'number' ? PARENT_TYPE_IDS[parent] : parent;
  if (parentKey && parentKey !== key) {
    const p = mapActivityType(parentKey);
    if (p.sport !== 'other') return p;
  }
  for (const [re, r] of HEURISTICS) if (re.test(key)) return r[1] ? { sport: r[0], subSport: r[1] } : { sport: r[0] };
  return { sport: 'other', subSport: 'generic' };
}

// ───────────────────────────── activity summaries ─────────────────────────────

/** The subset of domain `Activity` knowable from Garmin's summary JSON (no load/intensity — the metrics engine derives those). */
export interface NormalizedActivity {
  source: 'garmin';
  garminActivityId: string;
  garminTypeKey: string;
  startedAt: string; // ISO UTC
  startMs: number;
  utcOffsetMin: number;
  localDate: LocalDate;
  timezone?: string; // IANA, detail only
  sport: Sport;
  subSport?: SubSport;
  title: string;
  description?: string;
  durationSec: number; // elapsed
  movingSec: number;
  timerSec?: number;
  distanceM?: number;
  elevationGainM?: number;
  elevationLossM?: number;
  avgHr?: number;
  maxHr?: number;
  avgPower?: number;
  weightedPower?: number;
  maxPower?: number;
  avgSpeedMps?: number;
  maxSpeedMps?: number;
  adjustedSpeedMps?: number;
  avgCadence?: number;
  calories?: number;
  aerobicEffect?: number;
  anaerobicEffect?: number;
  /** Garmin EPOC-based `activityTrainingLoad` (not our Load). */
  deviceLoad?: number;
  /** Device-computed TSS / IF (present only with power + FTP on the device). */
  deviceTss?: number;
  deviceIf?: number;
  // swim
  poolLengthM?: number;
  strokes?: number;
  avgSwolf?: number;
  activeLengths?: number;
  // strength
  totalSets?: number;
  totalReps?: number;
  // zones (s), index 0 = zone 1
  hrTimeInZoneSec?: number[];
  powerTimeInZoneSec?: number[];
  garminWorkoutId?: string;
  deviceId?: string;
  lapCount?: number;
  manual: boolean;
  isMultisportParent: boolean;
  isTransition?: boolean;
  parentActivityId?: string;
  childActivityIds?: string[];
  hasGps?: boolean;
  /** Garmin's place name for the start ("Girona"); absent indoors / without GPS. */
  locationName?: string;
  startLat?: number;
  startLng?: number;
  /** Detail-page extras Garmin reports in the summary (elevation range, dynamics, temperature…). */
  facts?: ActivityFacts;
  /** metadataDTO.lastUpdateDate (detail only) as ISO — the edit detector. */
  lastUpdatedAt?: string;
  /** Hash of the fields Garmin users edit (garmin.md §6.4). */
  editHash: string;
}

/** Hash of {name, type, distance, duration, calories, manual, description}; list and detail give the same value. */
export function activityEditHash(json: unknown): string {
  const o = asObject(json);
  const s = isObject(o.summaryDTO) ? o.summaryDTO : o;
  const type = asObject(o.activityType ?? o.activityTypeDTO);
  const meta = asObject(o.metadataDTO);
  const r = (v: number | undefined) => (v === undefined ? null : Math.round(v));
  return fnv1a(
    stableStringify({
      n: str(o, 'activityName') ?? '',
      t: str(type, 'typeKey') ?? '',
      d: r(num(s, 'distance')),
      s: r(num(s, 'duration')),
      c: r(num(s, 'calories')),
      m: bool(o, 'manualActivity') ?? bool(meta, 'manualActivity') ?? false,
      x: str(o, 'description') ?? '',
    }),
  );
}

function zoneArray(o: JsonObject, prefix: string): number[] | undefined {
  const out: number[] = [];
  for (let z = 1; z <= 7; z++) {
    const v = num(o, `${prefix}${z}`);
    if (v === undefined) {
      if (z <= 5 && out.length) out.push(0);
      continue;
    }
    out.push(round(v, 1));
  }
  return out.length && out.some((v) => v > 0) ? out : undefined;
}

/**
 * Pool length in meters from Garmin's encoding (UNVERIFIED): believed
 * `poolLength` in cm with `unitOfPoolLength.factor` 100 → m = poolLength/factor;
 * yards converted. Without a factor, values > 100 are taken as cm.
 */
export function poolLengthMeters(poolLength: number | undefined, unit: unknown): number | undefined {
  if (poolLength === undefined || poolLength <= 0) return undefined;
  const u = asObject(unit);
  const factor = num(u, 'factor');
  let v = factor && factor > 0 ? poolLength / factor : poolLength > 100 ? poolLength / 100 : poolLength;
  if (/yard/i.test(str(u, 'unitKey') ?? '')) v *= 0.9144;
  return round(v, 2);
}

/**
 * List item (`/activitylist-service/...`) or detail (`/activity-service/activity/{id}`)
 * → NormalizedActivity. Detail fields live under `summaryDTO` / `activityTypeDTO`
 * / `metadataDTO` with different names (averagePower vs avgPower, trainingEffect
 * vs aerobicTrainingEffect) — both are handled.
 */
export function mapActivitySummary(json: unknown): NormalizedActivity {
  const o = asObject(json);
  const s = isObject(o.summaryDTO) ? { ...o, ...o.summaryDTO } : o;
  const meta = asObject(o.metadataDTO);
  const id = str(o, 'activityId');
  if (!id) throw new GarminError('Garmin activity has no activityId', 'bad_activity');
  const startMs = num(o, 'beginTimestamp') ?? parseGarminTimestamp(s.startTimeGMT);
  if (startMs === undefined) throw new GarminError(`Garmin activity ${id} has no start time`, 'bad_activity');
  const localMs = parseGarminTimestamp(s.startTimeLocal);
  const utcOffsetMin = localMs === undefined ? 0 : Math.round((localMs - startMs) / 60_000 / 15) * 15;
  const localDate = utcDate(startMs + utcOffsetMin * 60_000);
  const typeObj = asObject(o.activityType ?? o.activityTypeDTO);
  const typeKey = str(typeObj, 'typeKey') ?? 'other';
  const mapped = mapActivityType(typeKey, num(typeObj, 'parentTypeId'));
  const timer = num(s, 'duration');
  const elapsed = num(s, 'elapsedDuration') ?? timer ?? 0;
  const moving = num(s, 'movingDuration') ?? timer ?? elapsed;

  let avgCadence: number | undefined;
  if (mapped.sport === 'run' || mapped.sport === 'walk' || mapped.sport === 'hike') {
    // Some single-leg fields exist (fixture: avg 111.7 vs maxDouble 184) → prefer double cadence.
    avgCadence = num(s, 'avgDoubleCadence', 'averageRunningCadenceInStepsPerMinute', 'averageRunCadence');
  } else if (mapped.sport === 'bike') {
    avgCadence = num(s, 'averageBikingCadenceInRevPerMinute', 'averageBikeCadence', 'averageBikingCadence');
  } else if (mapped.sport === 'swim') {
    avgCadence = num(s, 'averageSwimCadenceInStrokesPerMinute', 'averageSwimCadence', 'avgStrokeCadence');
  } else if (mapped.sport === 'row') {
    avgCadence = num(s, 'averageRowingCadenceInStrokesPerMinute', 'avgStrokeCadence', 'averageCadence');
  }

  const isParent = bool(o, 'parent') === true || bool(o, 'isMultiSportParent') === true || mapped.isMultisportParent === true;
  const childIds = asArray(meta.childIds).map(String).filter(Boolean);
  const workoutId = str(o, 'workoutId') ?? str(meta, 'associatedWorkoutId');
  const deviceId = str(o, 'deviceId') ?? str(asObject(meta.deviceMetaDataDTO), 'deviceId');
  const lastUpd = parseGarminTimestamp(meta.lastUpdateDate);
  const tz = str(asObject(o.timeZoneUnitDTO), 'timeZone', 'unitKey');

  return compact<NormalizedActivity>({
    source: 'garmin',
    garminActivityId: id,
    garminTypeKey: typeKey,
    startedAt: toIsoInstant(startMs),
    startMs,
    utcOffsetMin,
    localDate,
    timezone: tz,
    sport: mapped.sport,
    subSport: mapped.subSport,
    title: str(o, 'activityName') ?? typeKey.replace(/_/g, ' '),
    description: str(o, 'description'),
    durationSec: round(elapsed, 1),
    movingSec: round(moving, 1),
    timerSec: timer === undefined ? undefined : round(timer, 1),
    distanceM: positive(num(s, 'distance')),
    elevationGainM: num(s, 'elevationGain'),
    elevationLossM: num(s, 'elevationLoss'),
    avgHr: num(s, 'averageHR'),
    maxHr: num(s, 'maxHR'),
    avgPower: num(s, 'avgPower', 'averagePower'),
    weightedPower: num(s, 'normPower', 'normalizedPower'),
    maxPower: num(s, 'maxPower'),
    avgSpeedMps: num(s, 'averageSpeed'),
    maxSpeedMps: num(s, 'maxSpeed'),
    adjustedSpeedMps: num(s, 'avgGradeAdjustedSpeed', 'averageGradeAdjustedSpeed'),
    avgCadence,
    calories: num(s, 'calories'),
    aerobicEffect: num(s, 'aerobicTrainingEffect', 'trainingEffect'),
    anaerobicEffect: num(s, 'anaerobicTrainingEffect'),
    deviceLoad: num(s, 'activityTrainingLoad'),
    deviceTss: num(s, 'trainingStressScore'),
    deviceIf: num(s, 'intensityFactor'),
    poolLengthM: mapped.sport === 'swim' ? poolLengthMeters(num(s, 'poolLength'), s.unitOfPoolLength) : undefined,
    strokes: num(s, 'strokes', 'totalNumberOfStrokes'),
    avgSwolf: num(s, 'averageSwolf', 'averageSWOLF'),
    activeLengths: num(s, 'activeLengths', 'numberOfActiveLengths'),
    totalSets: num(s, 'activeSets', 'totalSets'),
    totalReps: num(s, 'totalReps'),
    hrTimeInZoneSec: zoneArray(s, 'hrTimeInZone_'),
    powerTimeInZoneSec: zoneArray(s, 'powerTimeInZone_'),
    garminWorkoutId: workoutId,
    deviceId,
    lapCount: num(o, 'lapCount') ?? num(meta, 'lapCount'),
    manual: bool(o, 'manualActivity') ?? bool(meta, 'manualActivity') ?? false,
    isMultisportParent: isParent,
    isTransition: mapped.isTransition,
    parentActivityId: str(o, 'parentId'),
    childActivityIds: childIds.length ? childIds : undefined,
    hasGps: bool(o, 'hasPolyline') ?? bool(meta, 'hasPolyline'),
    locationName: str(o, 'locationName') ?? str(s, 'locationName'),
    startLat: latLng(num(s, 'startLatitude'), 90),
    startLng: latLng(num(s, 'startLongitude'), 180),
    facts: summaryFacts(s, mapped.sport, { timer, elapsed, tz }),
    lastUpdatedAt: lastUpd === undefined ? undefined : toIsoInstant(lastUpd),
    editHash: activityEditHash(o),
  });
}

function positive(v: number | undefined): number | undefined {
  return v !== undefined && v > 0 ? v : undefined;
}

function latLng(v: number | undefined, lim: number): number | undefined {
  return v !== undefined && Math.abs(v) <= lim && v !== 0 ? round(v, 6) : undefined;
}

/** Elevation in m; values > 9000 are taken as cm (UNVERIFIED unit on some list endpoints). */
function elevationM(v: number | undefined): number | undefined {
  if (v === undefined) return undefined;
  return round(Math.abs(v) > 9000 ? v / 100 : v, 1);
}

/**
 * Summary/detail JSON → ActivityFacts. Field names from Connect's activity list / summaryDTO
 * (running dynamics UNVERIFIED: stride length in cm, vertical oscillation in cm, GCT in ms).
 */
function summaryFacts(s: JsonObject, sport: Sport, ctx: { timer?: number; elapsed: number; tz?: string }): ActivityFacts | undefined {
  const legs = sport === 'run' || sport === 'walk' || sport === 'hike';
  const stride = num(s, 'avgStrideLength');
  const maxCadence = legs
    ? num(s, 'maxDoubleCadence', 'maxRunningCadenceInStepsPerMinute', 'maxRunCadence')
    : sport === 'bike'
      ? num(s, 'maxBikingCadenceInRevPerMinute', 'maxBikeCadence')
      : sport === 'swim'
        ? num(s, 'maxSwimCadenceInStrokesPerMinute', 'maxSwimCadence')
        : sport === 'row'
          ? num(s, 'maxRowingCadenceInStrokesPerMinute', 'maxStrokeCadence')
          : undefined;
  const gctBal = num(s, 'avgGroundContactBalance');
  const label = str(s, 'trainingEffectLabel');
  const f = compact<ActivityFacts>({
    startLat: latLng(num(s, 'startLatitude'), 90),
    startLng: latLng(num(s, 'startLongitude'), 180),
    endLat: latLng(num(s, 'endLatitude'), 90),
    endLng: latLng(num(s, 'endLongitude'), 180),
    timezone: ctx.tz,
    timerSec: ctx.timer === undefined ? undefined : round(ctx.timer, 1),
    pausedSec: ctx.timer !== undefined && ctx.elapsed - ctx.timer >= 1 ? Math.round(ctx.elapsed - ctx.timer) : undefined,
    maxSpeedMps: sport === 'swim' ? undefined : positive(num(s, 'maxSpeed')),
    elevationLossM: num(s, 'elevationLoss'),
    minAltitudeM: elevationM(num(s, 'minElevation')),
    maxAltitudeM: elevationM(num(s, 'maxElevation')),
    minHr: positive(num(s, 'minHR', 'minHeartRate')),
    powerBalanceLeftPct: num(s, 'avgLeftBalance', 'leftBalance'),
    maxCadence: positive(maxCadence),
    avgGroundContactMs: positive(num(s, 'avgGroundContactTime')),
    avgGroundContactBalanceLeftPct: gctBal !== undefined && gctBal > 0 && gctBal < 100 ? gctBal : undefined,
    avgVerticalOscillationCm: positive(num(s, 'avgVerticalOscillation')),
    avgVerticalRatioPct: positive(num(s, 'avgVerticalRatio')),
    avgStrideLengthM: stride !== undefined && stride > 0 ? round(stride / 100, 2) : undefined,
    steps: legs ? positive(num(s, 'steps')) : undefined,
    activeLengths: sport === 'swim' ? num(s, 'activeLengths', 'numberOfActiveLengths') : undefined,
    avgStrokesPerLength: sport === 'swim' ? positive(num(s, 'avgStrokes', 'averageStrokes')) : undefined,
    avgDistancePerStrokeM: sport === 'swim' || sport === 'row' ? positive(num(s, 'avgStrokeDistance', 'averageStrokeDistance')) : undefined,
    totalStrokes: sport === 'row' ? positive(num(s, 'strokes', 'totalNumberOfStrokes')) : undefined,
    avgTempC: num(s, 'averageTemperature', 'avgTemperature'),
    minTempC: num(s, 'minTemperature'),
    maxTempC: num(s, 'maxTemperature'),
    deviceLoad: positive(num(s, 'activityTrainingLoad')),
    trainingEffectLabel: label && label !== 'UNKNOWN' ? label : undefined,
    sweatLossMl: positive(num(s, 'waterEstimated')),
  });
  return Object.keys(f).length ? f : undefined;
}

// ───────────────────────────── details JSON → streams (fallback) ─────────────────────────────

const DETAIL_CHANNEL: Record<string, keyof Omit<ActivityStreams, 't'>> = {
  directHeartRate: 'hr',
  directPower: 'power',
  directSpeed: 'speed',
  directElevation: 'altitude',
  sumDistance: 'distance',
  directAirTemperature: 'temp',
  directLatitude: 'lat',
  directLongitude: 'lng',
};
const CADENCE_KEYS = ['directDoubleCadence', 'directRunCadence', 'directBikeCadence', 'directSwimCadence', 'directFractionalCadence'];

/**
 * `/activity-service/activity/{id}/details` → streams (downsampled to maxChartSize
 * by Garmin). Positional samples are mapped by `metricsIndex`; shorter rows and
 * nulls are tolerated; `t` is seconds from the first timestamp.
 */
export function mapActivityDetailsToStreams(details: unknown): ActivityStreams | undefined {
  const d = asObject(details);
  const descriptors = asArray(d.metricDescriptors).filter(isObject);
  const rows = asArray(d.activityDetailMetrics).filter(isObject).map((r) => asArray(r.metrics));
  if (!descriptors.length || !rows.length) return undefined;
  const idx = new Map<string, number>();
  for (const desc of descriptors) {
    const k = str(desc, 'key');
    const i = num(desc, 'metricsIndex');
    if (k && i !== undefined) idx.set(k, i);
  }
  const at = (row: unknown[], key: string): number | null => {
    const i = idx.get(key);
    if (i === undefined) return null;
    const v = row[i];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  const tsKey = idx.has('directTimestamp') ? 'directTimestamp' : undefined;
  const durKey = ['sumElapsedDuration', 'sumDuration'].find((k) => idx.has(k));
  const t0 = tsKey ? rows.map((r) => at(r, tsKey)).find((v) => v !== null) : undefined;
  const t: number[] = [];
  rows.forEach((r, i) => {
    const ts = tsKey ? at(r, tsKey) : null;
    if (ts !== null && t0 !== undefined && t0 !== null) t.push(round((ts - t0) / 1000, 3));
    else if (durKey && at(r, durKey) !== null) t.push(at(r, durKey)!);
    else t.push(t.length ? t[t.length - 1]! + 1 : i);
  });
  const streams: ActivityStreams = { t };
  for (const [key, ch] of Object.entries(DETAIL_CHANNEL)) {
    if (!idx.has(key)) continue;
    const vals = rows.map((r) => at(r, key));
    if (vals.some((v) => v !== null)) streams[ch] = vals;
  }
  const cadKey = CADENCE_KEYS.find((k) => idx.has(k));
  if (cadKey) {
    const vals = rows.map((r) => at(r, cadKey));
    if (vals.some((v) => v !== null)) streams.cadence = vals;
  }
  return streams;
}

// ───────────────────────────── splits / exercise sets ─────────────────────────────

/** `/splits` lapDTOs → Lap[] (fallback when no FIT). Field names partly UNVERIFIED. */
export function mapSplitsToLaps(splits: unknown): Lap[] {
  const dtos = asArray(asObject(splits).lapDTOs).filter(isObject);
  const t0 = parseGarminTimestamp(dtos[0]?.startTimeGMT);
  let cursor = 0;
  return dtos.map((l, i) => {
    const start = parseGarminTimestamp(l.startTimeGMT);
    const duration = num(l, 'elapsedDuration', 'duration') ?? 0;
    const startSec = start !== undefined && t0 !== undefined ? (start - t0) / 1000 : cursor;
    cursor = startSec + duration;
    const lengths = num(l, 'numberOfActiveLengths');
    return compact<Lap>({
      index: i,
      startSec: round(startSec, 1),
      durationSec: round(duration, 1),
      movingSec: num(l, 'movingDuration'),
      distanceM: num(l, 'distance'),
      avgHr: num(l, 'averageHR'),
      maxHr: num(l, 'maxHR'),
      avgPower: num(l, 'averagePower', 'avgPower'),
      weightedPower: num(l, 'normalizedPower', 'normPower'),
      avgSpeedMps: num(l, 'averageSpeed'),
      avgCadence: num(l, 'averageRunCadence', 'averageBikeCadence', 'averageSwimCadence'),
      elevationGainM: num(l, 'elevationGain'),
      lengths,
      stroke: str(l, 'swimStroke'),
      swolf: num(l, 'averageSWOLF', 'averageSwolf'),
      isRest: lengths === 0 ? true : undefined,
    });
  });
}

/**
 * `/exerciseSets` → StrengthSet[]. Only exercises[].category/name are VERIFIED;
 * `weight` is assumed GRAMS when > 500 (UNVERIFIED), else kg.
 */
export function mapExerciseSets(json: unknown): StrengthSet[] {
  const sets = asArray(asObject(json).exerciseSets).filter(isObject);
  return sets.map((set, index) => {
    const ex = asArray(set.exercises)
      .filter(isObject)
      .sort((a, b) => (num(b, 'probability') ?? 0) - (num(a, 'probability') ?? 0))[0];
    const category = str(ex, 'category');
    const name = str(ex, 'name');
    const w = num(set, 'weight');
    const isRest = str(set, 'setType') === 'REST';
    return compact<StrengthSet>({
      index,
      exercise: isRest ? 'Rest' : humanizeExercise(name || category || 'UNKNOWN'),
      category,
      reps: isRest ? undefined : num(set, 'repetitionCount'),
      weightKg: w === undefined || w <= 0 ? undefined : w > 500 ? round(w / 1000, 2) : w,
      durationSec: num(set, 'duration'),
      isRest: isRest || undefined,
    });
  });
}

// ───────────────────────────── wellness ─────────────────────────────

/** Raw responses (day or range shapes; arrays of chunked responses allowed). */
export interface WellnessRaw {
  sleep?: unknown;
  hrv?: unknown;
  dailySummaries?: unknown;
  bodyBattery?: unknown;
  stress?: unknown;
  weight?: unknown;
  vo2max?: unknown;
  readiness?: unknown;
  restingHr?: unknown;
}

type Partial1 = Partial<Omit<WellnessDay, 'date'>>;
type ByDate = Map<string, Partial1>;

function put(m: ByDate, date: unknown, patch: Partial1): void {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(date)) return;
  const d = date.slice(0, 10);
  const cur = m.get(d) ?? {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined && (cur as Record<string, unknown>)[k] === undefined) (cur as Record<string, unknown>)[k] = v;
  m.set(d, cur);
}

/** Flatten a response (or array of chunk responses) into candidate items using known wrapper keys. */
function items(raw: unknown, wrappers: string[]): JsonObject[] {
  const out: JsonObject[] = [];
  const visit = (v: unknown, depth: number) => {
    if (depth > 3) return;
    if (Array.isArray(v)) {
      for (const x of v) visit(x, depth + 1);
      return;
    }
    if (!isObject(v)) return;
    let wrapped = false;
    for (const w of wrappers) {
      if (w in v) {
        wrapped = true;
        visit(v[w], depth + 1);
      }
    }
    if (!wrapped) out.push(v);
  };
  visit(raw, 0);
  return out;
}

const nonNeg = (v: number | undefined) => (v !== undefined && v >= 0 ? v : undefined);

function sleepByDate(raw: unknown, m: ByDate): void {
  for (const it of items(raw, ['dailySleepSummaries', 'sleepSummaries', 'individualStats'])) {
    const dto = isObject(it.dailySleepDTO) ? it.dailySleepDTO : it;
    const values = asObject(it.values);
    const scores = asObject(dto.sleepScores);
    put(m, str(dto, 'calendarDate') ?? str(it, 'calendarDate'), {
      sleepSec: num(dto, 'sleepTimeSeconds', 'totalSleepTimeInSeconds') ?? num(values, 'totalSleepTimeInSeconds', 'sleepTimeSeconds'),
      sleepScore:
        num(asObject(scores.overall), 'value') ?? num(dto, 'sleepScore', 'overallSleepScore') ?? num(values, 'sleepScore', 'overallSleepScore'),
    });
  }
}

function sleepRhrByDate(raw: unknown, m: ByDate): void {
  for (const it of items(raw, ['dailySleepSummaries', 'sleepSummaries', 'individualStats'])) {
    const dto = isObject(it.dailySleepDTO) ? it.dailySleepDTO : it;
    put(m, str(dto, 'calendarDate') ?? str(it, 'calendarDate'), {
      restingHr: nonNeg(num(it, 'restingHeartRate') ?? num(asObject(it.values), 'restingHeartRate')),
    });
  }
}

function hrvByDate(raw: unknown, m: ByDate): void {
  for (const it of items(raw, ['hrvSummaries'])) {
    const s = isObject(it.hrvSummary) ? it.hrvSummary : it;
    put(m, str(s, 'calendarDate'), { hrvMs: num(s, 'lastNightAvg'), hrvStatus: str(s, 'status') });
  }
}

function dailiesByDate(raw: unknown, m: ByDate): void {
  for (const it of items(raw, ['dailySummaries', 'summaries'])) {
    put(m, str(it, 'calendarDate'), {
      restingHr: nonNeg(num(it, 'restingHeartRate')),
      stress: nonNeg(num(it, 'averageStressLevel')),
      bodyBattery: nonNeg(num(it, 'bodyBatteryAtWakeTime', 'bodyBatteryHighestValue')),
      sleepSec: nonNeg(num(it, 'sleepingSeconds')),
    });
  }
}

function bodyBatteryByDate(raw: unknown, m: ByDate): void {
  for (const it of items(raw, ['bodyBatteryReports'])) {
    let best: number | undefined;
    for (const e of asArray(it.bodyBatteryValuesArray)) {
      const arr = asArray(e);
      // [ts, level] (reports/daily) or [ts, status, level, version] (dailyStress)
      const v = arr.length >= 3 ? arr[2] : arr[1];
      if (typeof v === 'number' && Number.isFinite(v)) best = best === undefined ? v : Math.max(best, v);
    }
    put(m, str(it, 'date', 'calendarDate'), { bodyBattery: best ?? nonNeg(num(it, 'charged')) });
  }
}

function stressByDate(raw: unknown, m: ByDate): void {
  for (const it of items(raw, [])) {
    const values = asObject(it.values);
    put(m, str(it, 'calendarDate', 'date'), {
      stress: nonNeg(num(values, 'overallStressLevel', 'averageStressLevel') ?? num(it, 'overallStressLevel', 'averageStressLevel')),
    });
  }
}

/** Weight in grams on the wire → kg (values ≤ 500 are taken as kg already). */
export function gramsToKg(v: number | undefined): number | undefined {
  if (v === undefined || v <= 0) return undefined;
  return v > 500 ? round(v / 1000, 2) : round(v, 2);
}

function weightByDate(raw: unknown, m: ByDate): void {
  for (const it of items(raw, ['dailyWeightSummaries', 'dateWeightList'])) {
    const latest = isObject(it.latestWeight) ? it.latestWeight : it;
    put(m, str(it, 'summaryDate', 'calendarDate') ?? str(latest, 'calendarDate'), { weightKg: gramsToKg(num(latest, 'weight')) });
  }
}

function vo2ByDate(raw: unknown, m: ByDate): void {
  for (const it of items(raw, [])) {
    for (const k of ['generic', 'cycling']) {
      const g = asObject(it[k]);
      put(m, str(g, 'calendarDate'), { vo2max: num(g, 'vo2MaxPreciseValue', 'vo2MaxValue') });
    }
  }
}

function readinessByDate(raw: unknown, m: ByDate): void {
  const byDay = new Map<string, JsonObject[]>();
  for (const it of items(raw, [])) {
    const d = str(it, 'calendarDate');
    if (d && num(it, 'score') !== undefined) byDay.set(d, [...(byDay.get(d) ?? []), it]);
  }
  for (const [d, snaps] of byDay) {
    // The morning value (inputContext AFTER_WAKEUP_RESET) is the day's readiness; else the earliest snapshot.
    const morning =
      snaps.find((s) => str(s, 'inputContext') === 'AFTER_WAKEUP_RESET') ??
      [...snaps].sort((a, b) => (parseGarminTimestamp(a.timestamp) ?? 0) - (parseGarminTimestamp(b.timestamp) ?? 0))[0];
    put(m, d, { readiness: num(morning, 'score') });
  }
}

function restingHrByDate(raw: unknown, m: ByDate): void {
  const mm = asObject(asObject(asObject(raw).allMetrics).metricsMap);
  const list = Array.isArray(mm.WELLNESS_RESTING_HEART_RATE) ? mm.WELLNESS_RESTING_HEART_RATE : Array.isArray(raw) ? raw : [];
  for (const it of list.filter(isObject)) put(m, str(it, 'calendarDate'), { restingHr: nonNeg(num(it, 'value', 'restingHeartRate')) });
}

/** Merge all sources into per-day WellnessDay values (precedence: specific endpoint > daily summary > fallbacks). */
export function mapWellnessRange(raw: WellnessRaw, dates?: LocalDate[]): WellnessDay[] {
  const m: ByDate = new Map();
  // order = precedence (first writer wins per field)
  if (raw.hrv !== undefined) hrvByDate(raw.hrv, m);
  if (raw.sleep !== undefined) sleepByDate(raw.sleep, m);
  if (raw.dailySummaries !== undefined) dailiesByDate(raw.dailySummaries, m);
  if (raw.restingHr !== undefined) restingHrByDate(raw.restingHr, m);
  if (raw.sleep !== undefined) sleepRhrByDate(raw.sleep, m);
  if (raw.bodyBattery !== undefined) bodyBatteryByDate(raw.bodyBattery, m);
  if (raw.stress !== undefined) stressByDate(raw.stress, m);
  if (raw.weight !== undefined) weightByDate(raw.weight, m);
  if (raw.vo2max !== undefined) vo2ByDate(raw.vo2max, m);
  if (raw.readiness !== undefined) readinessByDate(raw.readiness, m);
  const keys = dates ?? [...m.keys()].sort();
  const out: WellnessDay[] = [];
  for (const date of keys) {
    const v = m.get(date);
    if (!v && !dates) continue;
    out.push(compact<WellnessDay>({ date, ...roundWellness(v ?? {}) }));
  }
  return out;
}

function roundWellness(v: Partial1): Partial1 {
  const r = { ...v };
  for (const k of ['restingHr', 'stress', 'bodyBattery', 'sleepScore', 'readiness'] as const) if (r[k] !== undefined) r[k] = Math.round(r[k]!);
  if (r.sleepSec !== undefined) r.sleepSec = Math.round(r.sleepSec);
  if (r.vo2max !== undefined) r.vo2max = round(r.vo2max, 1);
  return r;
}

/** One day from day- or range-shaped responses. */
export function mapWellness(date: LocalDate, raw: WellnessRaw): WellnessDay {
  return mapWellnessRange(raw, [date])[0] ?? { date };
}

// ───────────────────────────── user settings / thresholds ─────────────────────────────

export interface GarminHrZoneSet {
  sport: string;
  method?: string;
  /** zone floors in bpm, zone 1..5 */
  floors: number[];
  maxHr?: number;
  restingHr?: number;
  lthr?: number;
}

export interface GarminUserSettings {
  hrZones?: GarminHrZoneSet[];
  lthr?: number;
  hrMax?: number;
  hrRest?: number;
  ftp?: number;
  runThresholdMps?: number;
  weightKg?: number;
  vo2MaxRunning?: number;
  vo2MaxCycling?: number;
  raw: { heartRateZones?: unknown; userSettings?: unknown; ftp?: unknown };
}

/**
 * Normalise HR zones ([P] `/biometric-service/heartRateZones/v2` — v2 shape
 * UNVERIFIED, read like v1), `/userprofile/user-settings` (weight in grams;
 * `lactateThresholdSpeed` appears to be in units of 10 m/s — values < 1.5 are
 * multiplied by 10, UNVERIFIED) and the cycling FTP endpoint.
 */
export function mapUserSettings(raw: { heartRateZones?: unknown; userSettings?: unknown; ftp?: unknown }): GarminUserSettings {
  const zones: GarminHrZoneSet[] = [];
  for (const z of items(raw.heartRateZones, ['heartRateZones', 'zones'])) {
    const floors = [1, 2, 3, 4, 5].map((i) => num(z, `zone${i}Floor`)).filter((v): v is number => v !== undefined);
    if (!floors.length) continue;
    zones.push(
      compact<GarminHrZoneSet>({
        sport: str(z, 'sport') ?? 'DEFAULT',
        method: str(z, 'trainingMethod'),
        floors,
        maxHr: num(z, 'maxHeartRateUsed'),
        restingHr: num(z, 'restingHeartRateUsed'),
        lthr: num(z, 'lactateThresholdHeartRateUsed'),
      }),
    );
  }
  const def = zones.find((z) => z.sport === 'DEFAULT') ?? zones[0];
  const ud = asObject(asObject(raw.userSettings).userData);
  const lts = num(ud, 'lactateThresholdSpeed');
  const ftpObj = items(raw.ftp, [])[0];
  const ftp = typeof raw.ftp === 'number' ? raw.ftp : num(ftpObj, 'functionalThresholdPower', 'ftp', 'value');
  return compact<GarminUserSettings>({
    hrZones: zones.length ? zones : undefined,
    lthr: num(ud, 'lactateThresholdHeartRate') ?? def?.lthr,
    hrMax: def?.maxHr,
    hrRest: def?.restingHr,
    ftp: ftp !== undefined && ftp > 0 ? ftp : undefined,
    runThresholdMps: lts === undefined || lts <= 0 ? undefined : lts < 1.5 ? round(lts * 10, 3) : lts,
    weightKg: gramsToKg(num(ud, 'weight')),
    vo2MaxRunning: num(ud, 'vo2MaxRunning'),
    vo2MaxCycling: num(ud, 'vo2MaxCycling'),
    raw,
  });
}

export function toThresholdSnapshot(s: GarminUserSettings): ThresholdSnapshot {
  return compact<ThresholdSnapshot>({
    ftp: s.ftp,
    runThresholdMps: s.runThresholdMps,
    lthr: s.lthr,
    hrMax: s.hrMax,
    hrRest: s.hrRest,
    weightKg: s.weightKg,
  });
}
