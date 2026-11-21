/**
 * Synthetic athlete → Garmin wire shapes (garmin.md §9.2–9.5). Field names
 * follow the recorded fixtures; shapes marked UNVERIFIED in the doc are our
 * best guess and the client code reads them defensively.
 */
import type { WellnessDay } from '@cadence/core/domain';
import type { SynthActivity, SynthActivityDetail, SynthAthlete } from '../synth/types';
import { resolveExercise } from '../exercises';
import { formatGarminDetailTime, formatGarminListTime, round, type JsonObject } from '../util';

export const MOCK_PROFILE_ID = 90_000_001;
export const MOCK_DEVICE_ID = 3_600_000_001;

/** typeKey → [typeId, parentTypeId]. Ids beyond the doc's VERIFIED ones are mock-only. */
export const MOCK_ACTIVITY_TYPES: Record<string, [number, number]> = {
  running: [1, 17],
  trail_running: [6, 1],
  track_running: [8, 1],
  treadmill_running: [18, 1],
  indoor_running: [156, 1],
  cycling: [2, 17],
  road_biking: [10, 2],
  gravel_cycling: [143, 2],
  mountain_biking: [5, 2],
  indoor_cycling: [25, 2],
  virtual_ride: [152, 2],
  swimming: [26, 17],
  lap_swimming: [27, 26],
  open_water_swimming: [28, 26],
  rowing_v2: [258, 17],
  indoor_rowing: [170, 29],
  strength_training: [13, 29],
  hiit: [164, 29],
  yoga: [163, 29],
  hiking: [3, 17],
  walking: [9, 17],
  resort_skiing_snowboarding_ws: [203, 165],
  cross_country_skiing_ws: [171, 165],
  fitness_equipment: [29, 17],
  other: [4, 17],
};

/** FIT `sport` enum used as the list item's `sportTypeId`. */
const FIT_SPORT: Record<string, number> = { run: 1, bike: 2, swim: 5, row: 15, strength: 10, yoga: 10, walk: 11, hike: 17, ski: 12, other: 0 };

function typeDto(typeKey: string): JsonObject {
  const [typeId, parentTypeId] = MOCK_ACTIVITY_TYPES[typeKey] ?? [4, 17];
  return { typeId, typeKey, parentTypeId, isHidden: false, restricted: false, trimmable: true };
}

const EVENT_TYPE = { typeId: 9, typeKey: 'uncategorized', sortOrder: 10 };

function times(a: SynthActivity) {
  const startMs = Date.parse(a.startedAt);
  const localMs = startMs + a.utcOffsetMin * 60_000;
  return { startMs, localMs, endMs: startMs + a.durationSec * 1000 };
}

export interface ActivityEdits {
  activityName?: string;
  description?: string;
  lastUpdateMs?: number;
}

/** Activity list item (`/activitylist-service/activities/search/activities`). */
export function activityListItem(a: SynthActivity, edits: ActivityEdits = {}): JsonObject {
  const { startMs, localMs, endMs } = times(a);
  const o: JsonObject = {
    activityId: a.garminActivityId,
    activityName: edits.activityName ?? a.title,
    description: edits.description ?? null,
    startTimeLocal: formatGarminListTime(localMs),
    startTimeGMT: formatGarminListTime(startMs),
    activityType: typeDto(a.garminTypeKey),
    eventType: EVENT_TYPE,
    distance: a.distanceM ?? 0,
    duration: a.movingSec,
    elapsedDuration: a.durationSec,
    movingDuration: a.movingSec,
    elevationGain: a.elevationGainM ?? null,
    elevationLoss: a.elevationGainM ?? null,
    averageSpeed: a.avgSpeedMps ?? (a.distanceM && a.movingSec ? round(a.distanceM / a.movingSec, 3) : null),
    ownerId: MOCK_PROFILE_ID,
    calories: a.calories ?? null,
    bmrCalories: a.calories ? Math.round(a.durationSec / 60) : null,
    averageHR: a.avgHr ?? null,
    maxHR: a.maxHr ?? null,
    privacy: { typeId: 2, typeKey: 'private' },
    timeZoneId: 1,
    beginTimestamp: startMs,
    sportTypeId: FIT_SPORT[a.sport] ?? 0,
    avgPower: a.avgPower ?? null,
    maxPower: a.maxPower ?? null,
    normPower: a.normPower ?? null,
    aerobicTrainingEffect: a.aerobicEffect ?? null,
    anaerobicTrainingEffect: a.anaerobicEffect ?? null,
    deviceId: MOCK_DEVICE_ID,
    manufacturer: 'GARMIN',
    endTimeGMT: formatGarminListTime(endMs),
    hasPolyline: a.hasGps,
    manualActivity: false,
    parent: false,
    favorite: false,
    pr: false,
  };
  if (a.sport === 'run' || a.sport === 'walk' || a.sport === 'hike') {
    if (a.avgCadence !== undefined) {
      o.averageRunningCadenceInStepsPerMinute = a.avgCadence;
      o.avgDoubleCadence = a.avgCadence;
    }
  } else if (a.sport === 'bike') {
    if (a.avgCadence !== undefined) o.averageBikingCadenceInRevPerMinute = a.avgCadence;
  } else if (a.sport === 'swim') {
    if (a.avgCadence !== undefined) o.averageSwimCadenceInStrokesPerMinute = a.avgCadence;
    if (a.poolLengthM) {
      o.poolLength = round(a.poolLengthM * 100, 1);
      o.unitOfPoolLength = { unitId: 1, unitKey: 'meter', factor: 100.0 };
      if (a.distanceM) o.activeLengths = Math.round(a.distanceM / a.poolLengthM);
    }
    if (a.strokes !== undefined) o.strokes = a.strokes;
    if (a.avgSwolf !== undefined) o.averageSwolf = a.avgSwolf;
  } else if (a.sport === 'row') {
    if (a.avgCadence !== undefined) o.avgStrokeCadence = a.avgCadence;
  } else if (a.sport === 'strength') {
    if (a.totalSets !== undefined) {
      o.totalSets = a.totalSets;
      o.activeSets = a.totalSets;
    }
    if (a.totalReps !== undefined) o.totalReps = a.totalReps;
  }
  return o;
}

/** Activity detail (`/activity-service/activity/{id}`). */
export function activityDetail(a: SynthActivity, timezone: string, edits: ActivityEdits = {}): JsonObject {
  const { startMs, localMs, endMs } = times(a);
  const list = activityListItem(a, edits);
  const updated = edits.lastUpdateMs ?? endMs + 120_000;
  const summary: JsonObject = {
    startTimeLocal: formatGarminDetailTime(localMs),
    startTimeGMT: formatGarminDetailTime(startMs),
    distance: list.distance,
    duration: a.movingSec,
    movingDuration: a.movingSec,
    elapsedDuration: a.durationSec,
    elevationGain: list.elevationGain,
    elevationLoss: list.elevationLoss,
    averageSpeed: list.averageSpeed,
    calories: list.calories,
    averageHR: list.averageHR,
    maxHR: list.maxHR,
    averagePower: list.avgPower,
    maxPower: list.maxPower,
    normalizedPower: list.normPower,
    trainingEffect: list.aerobicTrainingEffect,
    anaerobicTrainingEffect: list.anaerobicTrainingEffect,
  };
  if (a.avgCadence !== undefined) {
    if (a.sport === 'run' || a.sport === 'walk' || a.sport === 'hike') summary.averageRunCadence = a.avgCadence;
    else if (a.sport === 'bike') summary.averageBikeCadence = a.avgCadence;
    else if (a.sport === 'swim') summary.averageSwimCadence = a.avgCadence;
  }
  for (const k of ['poolLength', 'unitOfPoolLength', 'strokes', 'averageSwolf', 'activeLengths', 'totalSets', 'activeSets', 'totalReps']) {
    if (list[k] !== undefined) summary[k] = list[k];
  }
  return {
    activityId: a.garminActivityId,
    activityUUID: { uuid: `00000000-0000-4000-8000-${String(a.garminActivityId).padStart(12, '0').slice(-12)}` },
    activityName: list.activityName,
    description: list.description,
    userProfileId: MOCK_PROFILE_ID,
    isMultiSportParent: false,
    activityTypeDTO: typeDto(a.garminTypeKey),
    eventTypeDTO: EVENT_TYPE,
    accessControlRuleDTO: { typeId: 2, typeKey: 'private' },
    timeZoneUnitDTO: { unitId: 1, unitKey: timezone, factor: 0.0, timeZone: timezone },
    metadataDTO: {
      isOriginal: true,
      fileFormat: { formatId: 7, formatKey: 'fit' },
      lastUpdateDate: formatGarminDetailTime(updated),
      uploadedDate: formatGarminDetailTime(endMs + 60_000),
      hasPolyline: a.hasGps,
      hasChartData: true,
      childIds: [],
      childActivityTypes: [],
      manufacturer: 'GARMIN',
      deviceMetaDataDTO: { deviceId: String(MOCK_DEVICE_ID), deviceTypePk: 37229, deviceVersionPk: 1003399 },
      manualActivity: false,
      trimmed: false,
      favorite: false,
    },
    summaryDTO: summary,
  };
}

/** `/details` JSON from 1 Hz streams, downsampled to `maxChartSize`. */
export function activityDetailsJson(detail: SynthActivityDetail, maxChartSize: number): JsonObject {
  const a = detail.activity;
  const s = detail.streams;
  const startMs = Date.parse(a.startedAt);
  const cadKey = a.sport === 'bike' ? 'directBikeCadence' : a.sport === 'swim' ? 'directSwimCadence' : 'directRunCadence';
  const channels: [string, (number | null)[] | undefined, JsonObject][] = [
    ['sumDistance', s?.distance, { id: 1, key: 'meter', factor: 100.0 }],
    ['directSpeed', s?.speed, { id: 20, key: 'mps', factor: 10.0 }],
    ['directHeartRate', s?.hr, { id: 100, key: 'bpm', factor: 1.0 }],
    ['directPower', s?.power, { id: 30, key: 'watt', factor: 1.0 }],
    ['directElevation', s?.altitude, { id: 2, key: 'meter', factor: 100.0 }],
    [cadKey, s?.cadence, { id: 90, key: 'rpm', factor: 1.0 }],
    ['directLatitude', s?.lat, { id: 60, key: 'dd', factor: 1.0 }],
    ['directLongitude', s?.lng, { id: 60, key: 'dd', factor: 1.0 }],
  ];
  const present = channels.filter(([, v]) => v && v.some((x) => x !== null));
  const descriptors = [
    { metricsIndex: 0, key: 'directTimestamp', unit: { id: 120, key: 'gmt', factor: 0.0 } },
    { metricsIndex: 1, key: 'sumDuration', unit: { id: 40, key: 'second', factor: 1000.0 } },
    ...present.map(([key, , unit], i) => ({ metricsIndex: i + 2, key, unit })),
  ];
  const t = s?.t ?? [];
  const stride = Math.max(1, Math.ceil(t.length / Math.max(1, maxChartSize)));
  const rows: JsonObject[] = [];
  for (let i = 0; i < t.length; i += stride) {
    rows.push({ metrics: [startMs + t[i]! * 1000, t[i]!, ...present.map(([, v]) => v![i] ?? null)] });
  }
  return {
    activityId: a.garminActivityId,
    measurementCount: descriptors.length,
    metricsCount: rows.length,
    detailsAvailable: rows.length > 0,
    metricDescriptors: descriptors,
    activityDetailMetrics: rows,
    geoPolylineDTO: null,
    heartRateDTOs: null,
    pendingData: null,
  };
}

export function splitsJson(detail: SynthActivityDetail): JsonObject {
  const startMs = Date.parse(detail.activity.startedAt);
  return {
    activityId: detail.activity.garminActivityId,
    lapDTOs: detail.laps.map((l) => {
      const o: JsonObject = {
        lapIndex: l.index + 1,
        startTimeGMT: formatGarminDetailTime(startMs + l.startSec * 1000),
        distance: l.distanceM ?? 0,
        duration: l.movingSec ?? l.durationSec,
        movingDuration: l.movingSec ?? l.durationSec,
        elapsedDuration: l.durationSec,
        averageHR: l.avgHr ?? null,
        maxHR: l.maxHr ?? null,
        averagePower: l.avgPower ?? null,
        normalizedPower: l.weightedPower ?? null,
        averageSpeed: l.avgSpeedMps ?? null,
        elevationGain: l.elevationGainM ?? null,
      };
      if (l.avgCadence !== undefined) o[detail.activity.sport === 'bike' ? 'averageBikeCadence' : 'averageRunCadence'] = l.avgCadence;
      if (l.lengths !== undefined) o.numberOfActiveLengths = l.lengths;
      if (l.swolf !== undefined) o.averageSWOLF = l.swolf;
      if (l.stroke !== undefined) o.swimStroke = l.stroke;
      return o;
    }),
  };
}

export function exerciseSetsJson(detail: SynthActivityDetail): JsonObject {
  const startMs = Date.parse(detail.activity.startedAt);
  let t = 0;
  return {
    activityId: detail.activity.garminActivityId,
    exerciseSets: (detail.strengthSets ?? []).map((s) => {
      const ex = s.isRest ? undefined : resolveExercise(s.exercise);
      const set: JsonObject = {
        exercises: s.isRest
          ? []
          : [{ category: s.category ?? ex?.category ?? 'UNKNOWN', name: ex?.exerciseName || null, probability: 100.0 }],
        duration: s.durationSec ?? null,
        repetitionCount: s.isRest ? null : (s.reps ?? null),
        weight: s.weightKg !== undefined ? s.weightKg * 1000 : null, // grams (UNVERIFIED)
        setType: s.isRest ? 'REST' : 'ACTIVE',
        startTime: formatGarminDetailTime(startMs + t * 1000),
        wktStepIndex: null,
      };
      t += s.durationSec ?? 45;
      return set;
    }),
  };
}

// ───────────────────────────── wellness ─────────────────────────────

const pk = MOCK_PROFILE_ID;

export function sleepDto(d: WellnessDay, tzOffsetMin: number): JsonObject {
  const s = d.sleepSec;
  const wakeMs = Date.parse(`${d.date}T06:30:00Z`) - tzOffsetMin * 60_000;
  return {
    id: s ? Date.parse(d.date) / 1000 : null,
    userProfilePK: pk,
    calendarDate: d.date,
    sleepTimeSeconds: s ?? null,
    deepSleepSeconds: s ? Math.round(s * 0.2) : null,
    lightSleepSeconds: s ? Math.round(s * 0.53) : null,
    remSleepSeconds: s ? Math.round(s * 0.22) : null,
    awakeSleepSeconds: s ? Math.round(s * 0.05) : null,
    sleepStartTimestampGMT: s ? wakeMs - s * 1000 : null,
    sleepEndTimestampGMT: s ? wakeMs : null,
    avgSleepHRV: d.hrvMs ?? null,
    sleepScores: d.sleepScore !== undefined ? { overall: { value: d.sleepScore, qualifierKey: d.sleepScore >= 80 ? 'GOOD' : 'FAIR' } } : null,
  };
}

export function dailySleep(d: WellnessDay | undefined, date: string, tzOffsetMin: number): JsonObject {
  if (!d) return { dailySleepDTO: { id: null, userProfilePK: pk, calendarDate: date, sleepTimeSeconds: null } };
  return { dailySleepDTO: sleepDto(d, tzOffsetMin), restingHeartRate: d.restingHr ?? null, avgOvernightHrv: d.hrvMs ?? null, bodyBatteryChange: null };
}

export function hrvSummary(d: WellnessDay): JsonObject {
  return {
    calendarDate: d.date,
    weeklyAvg: d.hrvMs ?? null,
    lastNightAvg: d.hrvMs ?? null,
    lastNight5MinHigh: d.hrvMs !== undefined ? Math.round(d.hrvMs * 1.4) : null,
    baseline: { lowUpper: 36, balancedLow: 39, balancedUpper: 62, markerValue: 0.5 },
    status: d.hrvStatus ?? 'BALANCED',
    feedbackPhrase: 'HRV_BALANCED_1',
    createTimeStamp: `${d.date}T07:14:11.898`,
  };
}

export function dailySummary(d: WellnessDay, displayName: string): JsonObject {
  return {
    userProfileId: pk,
    displayName,
    calendarDate: d.date,
    totalSteps: 9000,
    totalKilocalories: 2600,
    activeKilocalories: 800,
    bmrKilocalories: 1800,
    restingHeartRate: d.restingHr ?? null,
    minHeartRate: d.restingHr !== undefined ? d.restingHr - 3 : null,
    maxHeartRate: null,
    lastSevenDaysAvgRestingHeartRate: d.restingHr ?? null,
    averageStressLevel: d.stress ?? -1,
    maxStressLevel: d.stress !== undefined ? Math.min(100, d.stress * 2 + 20) : -1,
    bodyBatteryHighestValue: d.bodyBattery ?? null,
    bodyBatteryLowestValue: d.bodyBattery !== undefined ? Math.max(5, d.bodyBattery - 55) : null,
    bodyBatteryAtWakeTime: d.bodyBattery ?? null,
    sleepingSeconds: d.sleepSec ?? null,
    moderateIntensityMinutes: 20,
    vigorousIntensityMinutes: 30,
    floorsAscended: 8,
  };
}

export function bodyBatteryReport(d: WellnessDay, tzOffsetMin: number): JsonObject {
  const dayStart = Date.parse(`${d.date}T00:00:00Z`) - tzOffsetMin * 60_000;
  const top = d.bodyBattery ?? 50;
  const curve = [top - 20, top - 5, top, top - 10, top - 30, top - 45].map((v) => Math.max(5, v));
  return {
    date: d.date,
    charged: 50,
    drained: 55,
    startTimestampGMT: formatGarminDetailTime(dayStart),
    endTimestampGMT: formatGarminDetailTime(dayStart + 86_399_000),
    bodyBatteryValuesArray: curve.map((v, i) => [dayStart + i * 4 * 3_600_000, v]),
    bodyBatteryValueDescriptorDTOList: [
      { bodyBatteryValueDescriptorIndex: 0, bodyBatteryValueDescriptorKey: 'timestamp' },
      { bodyBatteryValueDescriptorIndex: 1, bodyBatteryValueDescriptorKey: 'bodyBatteryLevel' },
    ],
  };
}

export function readinessSnapshots(d: WellnessDay, tzOffsetMin: number): JsonObject[] {
  if (d.readiness === undefined) return [];
  const wake = Date.parse(`${d.date}T06:45:00Z`) - tzOffsetMin * 60_000;
  const snap = (score: number, ts: number, ctx: string): JsonObject => ({
    userProfilePK: pk,
    calendarDate: d.date,
    timestamp: formatGarminDetailTime(ts),
    timestampLocal: formatGarminDetailTime(ts + tzOffsetMin * 60_000),
    deviceId: MOCK_DEVICE_ID,
    level: score >= 75 ? 'HIGH' : score >= 50 ? 'MODERATE' : 'LOW',
    feedbackShort: 'RECOVERY_IN_PROGRESS',
    score,
    sleepScore: d.sleepScore ?? null,
    recoveryTime: 600,
    acuteLoad: 400,
    hrvWeeklyAverage: d.hrvMs ?? null,
    inputContext: ctx,
    validSleep: true,
    primaryActivityTracker: true,
  });
  // A later real-time update precedes the morning value in the array (newest first).
  return [snap(Math.max(1, d.readiness - 12), wake + 8 * 3_600_000, 'UPDATE_REALTIME_VARIABLES'), snap(d.readiness, wake, 'AFTER_WAKEUP_RESET')];
}

export function hrZones(p: SynthAthlete['profile']): JsonObject[] {
  const floors = [0.68, 0.84, 0.92, 0.98, 1.03].map((f) => Math.round(p.lthr * f));
  return [
    {
      sport: 'DEFAULT',
      trainingMethod: 'LACTATE_THRESHOLD',
      lactateThresholdHeartRateUsed: p.lthr,
      maxHeartRateUsed: p.hrMax,
      restingHeartRateUsed: p.hrRest,
      restingHrAutoUpdateUsed: false,
      zone1Floor: floors[0],
      zone2Floor: floors[1],
      zone3Floor: floors[2],
      zone4Floor: floors[3],
      zone5Floor: floors[4],
    },
  ];
}

export function userSettings(p: SynthAthlete['profile'], vo2?: number): JsonObject {
  return {
    id: MOCK_PROFILE_ID,
    userData: {
      gender: p.sex.toUpperCase(),
      weight: Math.round(p.weightKg * 1000),
      height: 178.0,
      birthDate: `${p.birthYear}-06-15`,
      measurementSystem: 'metric',
      timeFormat: 'time_twenty_four_hr',
      powerFormat: { formatId: 30, formatKey: 'watt', minFraction: 0, maxFraction: 0, groupingUsed: true },
      heartRateFormat: { formatId: 21, formatKey: 'bpm', minFraction: 0, maxFraction: 0, groupingUsed: false },
      firstDayOfWeek: { dayId: 2, dayName: 'monday', sortOrder: 2, isPossibleFirstDay: true },
      vo2MaxRunning: vo2 ?? null,
      vo2MaxCycling: vo2 ?? null,
      lactateThresholdSpeed: round(p.runThresholdMps / 10, 4), // UNVERIFIED unit (10 m/s), as in the fixture
      lactateThresholdHeartRate: p.lthr,
      thresholdHeartRateAutoDetected: false,
      ftpAutoDetected: false,
    },
    userSleep: { sleepTime: 79200, defaultSleepTime: false, wakeTime: 23400, defaultWakeTime: false },
    connectDate: null,
    sourceType: null,
  };
}
