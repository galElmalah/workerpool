import { describe, expect, it } from 'vitest';
import { ActivityStreams, WellnessDay } from '@cadence/core/domain';
import {
  activityEditHash,
  gramsToKg,
  mapActivityDetailsToStreams,
  mapActivitySummary,
  mapActivityType,
  mapExerciseSets,
  mapSplitsToLaps,
  mapUserSettings,
  mapWellness,
  mapWellnessRange,
  poolLengthMeters,
  toThresholdSnapshot,
} from '../src';

// §9.2 run list item (real garth cassette, trimmed)
const RUN_ITEM = {
  activityId: 21482825013, activityName: 'Cuajimalpa de Morelos - Base',
  startTimeLocal: '2026-01-08 08:10:21', startTimeGMT: '2026-01-08 14:10:21',
  activityType: { typeId: 6, typeKey: 'trail_running', parentTypeId: 1, isHidden: false, restricted: false, trimmable: true },
  distance: 4261.18994140625, duration: 2223.326904296875, elapsedDuration: 2225.44091796875, movingDuration: 2216.0,
  elevationGain: 151.0, elevationLoss: 147.0, averageSpeed: 1.9170000553131106, maxSpeed: 2.76200008392334,
  calories: 390.0, averageHR: 142.0, maxHR: 162.0, averageRunningCadenceInStepsPerMinute: 111.734375,
  beginTimestamp: 1767881421000, sportTypeId: 1, avgPower: 194.0, maxPower: 587.0,
  aerobicTrainingEffect: 2.700000047683716, anaerobicTrainingEffect: 0.0, normPower: 226.0,
  workoutId: 3618356072, deviceId: 3618356072, avgGradeAdjustedSpeed: 2.2239999771118164, activityTrainingLoad: 50.886444091796875,
  hrTimeInZone_1: 376.545, hrTimeInZone_2: 1601.888, hrTimeInZone_3: 233.231, hrTimeInZone_4: 10.999, hrTimeInZone_5: 0.0,
  lapCount: 2, hasPolyline: true, manualActivity: false, parent: false,
};

// §9.3 detail (real, trimmed)
const RUN_DETAIL = {
  activityId: 21482825013, activityName: 'Cuajimalpa de Morelos - Base', isMultiSportParent: false,
  activityTypeDTO: { typeId: 6, typeKey: 'trail_running', parentTypeId: 1 },
  timeZoneUnitDTO: { unitId: 150, unitKey: 'America/Costa_Rica', factor: 0.0, timeZone: 'America/Costa_Rica' },
  metadataDTO: { lastUpdateDate: '2026-01-08T15:15:04.0', childIds: [], lapCount: 2, associatedWorkoutId: 3618356072, manualActivity: false, deviceMetaDataDTO: { deviceId: '3618356072' } },
  summaryDTO: {
    startTimeLocal: '2026-01-08T08:10:21.0', startTimeGMT: '2026-01-08T14:10:21.0', distance: 4261.19, duration: 2223.327,
    movingDuration: 2216.0, elapsedDuration: 2225.441, elevationGain: 151.0, calories: 390.0, averageHR: 142.0, maxHR: 162.0,
    averageRunCadence: 111.734375, averagePower: 194.0, maxPower: 587.0, normalizedPower: 226.0, trainingEffect: 2.700000047683716,
    anaerobicTrainingEffect: 0.0, activityTrainingLoad: 50.886444091796875,
  },
};

const RIDE_ITEM = {
  activityId: 21500000001, activityName: 'Sweet spot 4x8', startTimeLocal: '2026-01-10 07:02:11', startTimeGMT: '2026-01-10 13:02:11',
  activityType: { typeId: 10, typeKey: 'road_biking', parentTypeId: 2 }, distance: 61234.5, duration: 7260.2, elapsedDuration: 7590.0,
  movingDuration: 7201.0, averageBikingCadenceInRevPerMinute: 88.0, beginTimestamp: 1768050131000, avgPower: 212.0, normPower: 236.0,
  trainingStressScore: 112.4, intensityFactor: 0.84, powerTimeInZone_1: 1500.0, powerTimeInZone_2: 1700.0, powerTimeInZone_3: 2100.0,
  powerTimeInZone_4: 1900.0, powerTimeInZone_5: 60.0,
};

const SWIM_ITEM = {
  activityId: 21500000002, activityName: 'Pool Swim', startTimeLocal: '2026-01-11 06:30:05', startTimeGMT: '2026-01-11 12:30:05',
  activityType: { typeId: 27, typeKey: 'lap_swimming', parentTypeId: 26 }, distance: 2500.0, duration: 2950.4, elapsedDuration: 3302.0,
  movingDuration: 2830.0, averageSwimCadenceInStrokesPerMinute: 28.0, averageSwolf: 39.0, strokes: 1650.0, activeLengths: 100,
  poolLength: 2500.0, unitOfPoolLength: { unitId: 1, unitKey: 'meter', factor: 100.0 }, beginTimestamp: 1768134605000,
};

describe('mapActivityType', () => {
  it.each([
    ['running', 'run', 'road_run'],
    ['trail_running', 'run', 'trail'],
    ['treadmill_running', 'run', 'treadmill'],
    ['road_biking', 'bike', 'road'],
    ['gravel_cycling', 'bike', 'gravel'],
    ['mountain_biking', 'bike', 'mtb'],
    ['indoor_cycling', 'bike', 'indoor'],
    ['virtual_ride', 'bike', 'virtual'],
    ['lap_swimming', 'swim', 'pool'],
    ['open_water_swimming', 'swim', 'open_water'],
    ['rowing_v2', 'row', 'on_water'],
    ['rowing', 'row', 'on_water'],
    ['indoor_rowing', 'row', 'erg'],
    ['strength_training', 'strength', 'gym'],
    ['hiit', 'strength', 'hiit'],
    ['mobility', 'strength', 'mobility'],
    ['yoga', 'yoga', 'generic'],
    ['pilates', 'yoga', 'generic'],
    ['walking', 'walk', 'generic'],
    ['hiking', 'hike', 'generic'],
    ['resort_skiing_snowboarding_ws', 'ski', 'generic'],
    ['cross_country_skiing_ws', 'ski', 'generic'],
    ['stand_up_paddleboarding_v2', 'other', 'generic'],
    ['elliptical', 'other', 'generic'],
  ])('%s → %s/%s', (key, sport, subSport) => {
    expect(mapActivityType(key)).toEqual({ sport, subSport });
  });

  it('multisport parents and transitions are flagged', () => {
    expect(mapActivityType('multi_sport')).toMatchObject({ sport: 'other', isMultisportParent: true });
    expect(mapActivityType('triathlon').isMultisportParent).toBe(true);
    expect(mapActivityType('transition_v2')).toMatchObject({ isTransition: true });
  });

  it('unknown keys walk the parent (key or numeric id) then heuristics', () => {
    expect(mapActivityType('some_new_running_v3')).toEqual({ sport: 'run', subSport: 'road_run' });
    expect(mapActivityType('weird_key', 2)).toEqual({ sport: 'bike', subSport: 'road' });
    expect(mapActivityType('weird_key', 'swimming')).toEqual({ sport: 'swim' });
    expect(mapActivityType('zorbing')).toEqual({ sport: 'other', subSport: 'generic' });
    expect(mapActivityType(undefined)).toEqual({ sport: 'other', subSport: 'generic' });
  });
});

describe('mapActivitySummary', () => {
  it('maps the recorded run list item', () => {
    const a = mapActivitySummary(RUN_ITEM);
    expect(a).toMatchObject({
      garminActivityId: '21482825013',
      garminTypeKey: 'trail_running',
      startedAt: '2026-01-08T14:10:21Z',
      utcOffsetMin: -360,
      localDate: '2026-01-08',
      sport: 'run',
      subSport: 'trail',
      durationSec: 2225.4,
      movingSec: 2216,
      timerSec: 2223.3,
      avgHr: 142,
      avgPower: 194,
      weightedPower: 226,
      adjustedSpeedMps: 2.2239999771118164,
      aerobicEffect: 2.700000047683716,
      deviceLoad: 50.886444091796875,
      garminWorkoutId: '3618356072',
      lapCount: 2,
      manual: false,
      isMultisportParent: false,
      hasGps: true,
    });
    expect(a.hrTimeInZoneSec).toEqual([376.5, 1601.9, 233.2, 11, 0]);
    expect(a.avgCadence).toBeCloseTo(111.73, 1);
  });

  it('maps the detail shape (summaryDTO names) consistently with the list item', () => {
    const list = mapActivitySummary(RUN_ITEM);
    const det = mapActivitySummary(RUN_DETAIL);
    expect(det.startedAt).toBe(list.startedAt);
    expect(det.utcOffsetMin).toBe(-360);
    expect(det.timezone).toBe('America/Costa_Rica');
    expect(det.avgPower).toBe(194);
    expect(det.weightedPower).toBe(226);
    expect(det.aerobicEffect).toBe(list.aerobicEffect);
    expect(det.garminWorkoutId).toBe('3618356072');
    expect(det.deviceId).toBe('3618356072');
    expect(det.lastUpdatedAt).toBe('2026-01-08T15:15:04Z');
    expect(det.editHash).toBe(list.editHash); // rounding makes list/detail hashes comparable
  });

  it('ride: biking cadence, device TSS/IF, power zones', () => {
    const r = mapActivitySummary(RIDE_ITEM);
    expect(r).toMatchObject({ sport: 'bike', subSport: 'road', avgCadence: 88, deviceTss: 112.4, deviceIf: 0.84, utcOffsetMin: -360 });
    expect(r.powerTimeInZoneSec).toEqual([1500, 1700, 2100, 1900, 60]);
  });

  it('pool swim: pool length cm/factor → 25 m, swim fields', () => {
    const s = mapActivitySummary(SWIM_ITEM);
    expect(s).toMatchObject({ sport: 'swim', subSport: 'pool', poolLengthM: 25, strokes: 1650, avgSwolf: 39, activeLengths: 100, avgCadence: 28 });
  });

  it('pool length encodings', () => {
    expect(poolLengthMeters(2500, { factor: 100, unitKey: 'meter' })).toBe(25);
    expect(poolLengthMeters(2500, undefined)).toBe(25);
    expect(poolLengthMeters(50, undefined)).toBe(50);
    expect(poolLengthMeters(2500, { factor: 100, unitKey: 'yard' })).toBe(22.86);
  });

  it('edit hash changes on rename, not on irrelevant fields', () => {
    const h = activityEditHash(RUN_ITEM);
    expect(activityEditHash({ ...RUN_ITEM, maxHR: 170 })).toBe(h);
    expect(activityEditHash({ ...RUN_ITEM, activityName: 'Renamed' })).not.toBe(h);
  });

  it('throws on items that are not activities', () => {
    expect(() => mapActivitySummary({ activityName: 'x' })).toThrow(/activityId/);
    expect(() => mapActivitySummary({ activityId: 1 })).toThrow(/start time/);
  });

  it('multisport parent and children', () => {
    const p = mapActivitySummary({ ...RUN_ITEM, activityType: { typeKey: 'multi_sport' }, parent: true, metadataDTO: { childIds: [1, 2] } });
    expect(p.isMultisportParent).toBe(true);
    expect(p.childActivityIds).toEqual(['1', '2']);
    const c = mapActivitySummary({ ...RUN_ITEM, parentId: 999 });
    expect(c.parentActivityId).toBe('999');
  });
});

describe('details / splits / sets fallbacks', () => {
  const DETAILS = {
    activityId: 21482825013, measurementCount: 6, metricsCount: 3,
    metricDescriptors: [
      { metricsIndex: 0, key: 'directTimestamp', unit: { id: 120, key: 'gmt', factor: 0.0 } },
      { metricsIndex: 1, key: 'sumDistance', unit: { id: 1, key: 'meter', factor: 100.0 } },
      { metricsIndex: 2, key: 'directSpeed', unit: { id: 20, key: 'mps', factor: 10.0 } },
      { metricsIndex: 3, key: 'sumDuration', unit: { id: 40, key: 'second', factor: 1000.0 } },
      { metricsIndex: 4, key: 'directHeartRate', unit: { id: 100, key: 'bpm', factor: 1.0 } },
      { metricsIndex: 5, key: 'directPower', unit: { id: 30, key: 'watt', factor: 1.0 } },
    ],
    activityDetailMetrics: [
      { metrics: [1767881421000.0, 0.0, 0.0, 0.0, 122.0, null] },
      { metrics: [1767881422000.0, 1.9, 1.9, 1.0, 123.0, 180.0] },
      { metrics: [1767881423000.0, 3.9, 2.0, 2.0, 125.0] }, // shorter row
    ],
  };

  it('maps §9.4 positional samples by metricsIndex and tolerates short rows', () => {
    const s = mapActivityDetailsToStreams(DETAILS)!;
    expect(ActivityStreams.safeParse(s).success).toBe(true);
    expect(s).toEqual({ t: [0, 1, 2], hr: [122, 123, 125], power: [null, 180, null], speed: [0, 1.9, 2], distance: [0, 1.9, 3.9] });
    expect(mapActivityDetailsToStreams({})).toBeUndefined();
  });

  it('splits → laps; exercise sets → strength sets (grams heuristic)', () => {
    const laps = mapSplitsToLaps({
      lapDTOs: [
        { startTimeGMT: '2026-01-08T14:10:21.0', elapsedDuration: 600, distance: 2000, averageHR: 140, averageRunCadence: 170 },
        { startTimeGMT: '2026-01-08T14:20:21.0', elapsedDuration: 300, distance: 1000, averageHR: 150 },
      ],
    });
    expect(laps).toEqual([
      { index: 0, startSec: 0, durationSec: 600, distanceM: 2000, avgHr: 140, avgCadence: 170 },
      { index: 1, startSec: 600, durationSec: 300, distanceM: 1000, avgHr: 150 },
    ]);
    const sets = mapExerciseSets({
      exerciseSets: [
        { exercises: [{ category: 'SQUAT', name: 'BARBELL_BACK_SQUAT', probability: 90 }, { category: 'LUNGE', name: 'LUNGE', probability: 10 }], repetitionCount: 8, weight: 80000, duration: 40, setType: 'ACTIVE' },
        { exercises: [], setType: 'REST', duration: 90 },
        { exercises: [{ category: 'PULL_UP', name: null }], repetitionCount: 6, weight: 0, setType: 'ACTIVE' },
      ],
    });
    expect(sets).toEqual([
      { index: 0, exercise: 'Barbell Back Squat', category: 'SQUAT', reps: 8, weightKg: 80, durationSec: 40 },
      { index: 1, exercise: 'Rest', durationSec: 90, isRest: true },
      { index: 2, exercise: 'Pull Up', category: 'PULL_UP', reps: 6 },
    ]);
  });
});

describe('wellness', () => {
  // §9.5 fixtures
  const HRV = { userProfilePk: 2591602, hrvSummary: { calendarDate: '2023-07-20', weeklyAvg: 39, lastNightAvg: 42, lastNight5MinHigh: 66, status: 'BALANCED' }, hrvReadings: [] };
  const READINESS = [
    { calendarDate: '2025-07-07', timestamp: '2025-07-08T03:50:17.0', score: 50, inputContext: 'UPDATE_REALTIME_VARIABLES' },
    { calendarDate: '2025-07-07', timestamp: '2025-07-07T05:10:00.0', score: 71, inputContext: 'AFTER_WAKEUP_RESET' },
  ];

  it('day-shaped responses → WellnessDay', () => {
    const d = mapWellness('2023-07-20', {
      hrv: HRV,
      sleep: { dailySleepDTO: { calendarDate: '2023-07-20', sleepTimeSeconds: 27000.4, sleepScores: { overall: { value: 81 } } }, restingHeartRate: 47 },
      dailySummaries: { calendarDate: '2023-07-20', restingHeartRate: 46, averageStressLevel: 28, bodyBatteryAtWakeTime: 88 },
      weight: { dateWeightList: [{ calendarDate: '2023-07-20', weight: 83000.0 }] },
      vo2max: [{ generic: { calendarDate: '2023-07-20', vo2MaxPreciseValue: 54.63 }, cycling: null }],
    });
    expect(WellnessDay.safeParse(d).success).toBe(true);
    expect(d).toEqual({ date: '2023-07-20', hrvMs: 42, hrvStatus: 'BALANCED', sleepSec: 27000, sleepScore: 81, restingHr: 46, stress: 28, bodyBattery: 88, weightKg: 83, vo2max: 54.6 });
  });

  it('readiness picks the morning (AFTER_WAKEUP_RESET) snapshot', () => {
    expect(mapWellness('2025-07-07', { readiness: READINESS }).readiness).toBe(71);
    expect(mapWellness('2025-07-07', { readiness: [READINESS[0]] }).readiness).toBe(50);
  });

  it('range shapes and chunk arrays merge per day; negative "no data" stress is dropped', () => {
    const days = mapWellnessRange({
      hrv: [{ hrvSummaries: [{ calendarDate: '2026-11-01', lastNightAvg: 50 }] }, { hrvSummaries: [{ calendarDate: '2026-11-02', lastNightAvg: 52 }] }],
      dailySummaries: [[{ calendarDate: '2026-11-01', averageStressLevel: -1, restingHeartRate: 45 }]],
      bodyBattery: [{ date: '2026-11-02', bodyBatteryValuesArray: [[1, 40], [2, 77], [3, 50]] }],
      stress: [{ calendarDate: '2026-11-02', values: { overallStressLevel: 31 } }],
      weight: { dailyWeightSummaries: [{ summaryDate: '2026-11-02', latestWeight: { weight: 72400 } }] },
      restingHr: { allMetrics: { metricsMap: { WELLNESS_RESTING_HEART_RATE: [{ calendarDate: '2026-11-02', value: 47 }] } } },
      sleep: { individualStats: [{ calendarDate: '2026-11-02', values: { totalSleepTimeInSeconds: 26000, sleepScore: 70 } }] },
    });
    expect(days).toEqual([
      { date: '2026-11-01', hrvMs: 50, restingHr: 45 },
      { date: '2026-11-02', hrvMs: 52, sleepSec: 26000, sleepScore: 70, restingHr: 47, bodyBattery: 77, stress: 31, weightKg: 72.4 },
    ]);
  });

  it('gramsToKg', () => {
    expect(gramsToKg(83000)).toBe(83);
    expect(gramsToKg(72.5)).toBe(72.5);
    expect(gramsToKg(0)).toBeUndefined();
  });
});

describe('user settings', () => {
  it('maps the user-settings fixture (lactateThresholdSpeed in 10 m/s units, weight in g)', () => {
    const s = mapUserSettings({
      userSettings: { userData: { weight: 83000.0, lactateThresholdSpeed: 0.3472, lactateThresholdHeartRate: 168, vo2MaxRunning: 52 } },
      heartRateZones: [{ sport: 'DEFAULT', zone1Floor: 100, zone2Floor: 120, zone3Floor: 140, zone4Floor: 155, zone5Floor: 168, maxHeartRateUsed: 190, restingHeartRateUsed: 45 }],
      ftp: [{ functionalThresholdPower: 281 }],
    });
    expect(toThresholdSnapshot(s)).toEqual({ ftp: 281, runThresholdMps: 3.472, lthr: 168, hrMax: 190, hrRest: 45, weightKg: 83 });
    expect(s.hrZones?.[0]?.floors).toEqual([100, 120, 140, 155, 168]);
  });
});
