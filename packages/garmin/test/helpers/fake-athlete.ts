/**
 * Tiny hand-written SynthAthlete + a fake SynthApi (detail + FIT encoding via
 * @garmin/fitsdk's Encoder). Independent of the real generator in src/synth.
 */
import { Encoder, Profile, Utils, type Mesg } from '@garmin/fitsdk';
import type { Lap, StrengthSet, WellnessDay } from '@cadence/core/domain';
import type { SynthActivity, SynthActivityDetail, SynthApi, SynthAthlete } from '../../src/synth/types';

export const TODAY = '2026-11-21';
const OFFSET = 60; // Europe/Berlin in November

function act(id: number, startedAt: string, rest: Partial<SynthActivity> & Pick<SynthActivity, 'garminTypeKey' | 'sport' | 'title' | 'durationSec'>): SynthActivity {
  const startMs = Date.parse(startedAt);
  return {
    garminActivityId: id,
    startedAt,
    utcOffsetMin: OFFSET,
    localDate: new Date(startMs + OFFSET * 60_000).toISOString().slice(0, 10),
    movingSec: rest.durationSec - 30,
    hasGps: true,
    ...rest,
  };
}

export const ACTIVITIES: SynthActivity[] = [
  act(21_000_000_001, '2026-11-12T06:30:00Z', { garminTypeKey: 'running', sport: 'run', subSport: 'road_run', title: 'Easy run', durationSec: 2700, distanceM: 8100, avgHr: 138, maxHr: 152, avgSpeedMps: 3.0, avgCadence: 172, calories: 560, elevationGainM: 40 }),
  act(21_000_000_002, '2026-11-13T16:00:00Z', { garminTypeKey: 'road_biking', sport: 'bike', subSport: 'road', title: 'Sweet spot 3x12', durationSec: 5400, distanceM: 45_000, avgHr: 141, maxHr: 165, avgPower: 205, normPower: 228, maxPower: 410, avgCadence: 88, avgSpeedMps: 8.33, calories: 1100, aerobicEffect: 3.4, anaerobicEffect: 0.8 }),
  act(21_000_000_003, '2026-11-14T06:00:00Z', { garminTypeKey: 'lap_swimming', sport: 'swim', subSport: 'pool', title: 'Pool swim', durationSec: 2400, distanceM: 2000, avgHr: 128, poolLengthM: 25, strokes: 1400, avgSwolf: 38, hasGps: false }),
  act(21_000_000_004, '2026-11-15T17:00:00Z', { garminTypeKey: 'strength_training', sport: 'strength', subSport: 'gym', title: 'Gym A', durationSec: 2700, avgHr: 105, totalSets: 6, totalReps: 48, hasGps: false }),
  act(21_000_000_005, '2026-11-17T07:00:00Z', { garminTypeKey: 'indoor_rowing', sport: 'row', subSport: 'erg', title: 'Erg 5k', durationSec: 1260, distanceM: 5000, avgHr: 150, avgPower: 190, avgCadence: 24, hasGps: false }),
  act(21_000_000_006, '2026-11-18T09:00:00Z', { garminTypeKey: 'hiking', sport: 'hike', subSport: 'generic', title: 'Ridge hike', durationSec: 10_800, distanceM: 14_000, elevationGainM: 900, avgHr: 118 }),
  act(21_000_000_007, '2026-11-20T06:30:00Z', { garminTypeKey: 'trail_running', sport: 'run', subSport: 'trail', title: 'Trail tempo', durationSec: 3600, distanceM: 10_500, avgHr: 152, avgCadence: 168, elevationGainM: 320 }),
  // "later today" — invisible until the mock clock passes 09:00Z
  act(21_000_000_008, '2026-11-21T09:00:00Z', { garminTypeKey: 'indoor_cycling', sport: 'bike', subSport: 'indoor', title: 'Zwift recovery', durationSec: 2400, avgPower: 150, normPower: 155, avgHr: 118, hasGps: false }),
];

function wellness(date: string, i: number): WellnessDay {
  return { date, hrvMs: 50 + i, hrvStatus: 'BALANCED', restingHr: 48 - (i % 3), sleepSec: 27_000 + i * 300, sleepScore: 75 + i, weightKg: 72.4 + i / 10, bodyBattery: 70 + i, stress: 25 + i, readiness: 60 + i, vo2max: 55.2 };
}

export const WELLNESS: WellnessDay[] = Array.from({ length: 10 }, (_, i) => wellness(`2026-11-${String(12 + i).padStart(2, '0')}`, i));

export function makeAthlete(): SynthAthlete {
  return {
    seed: 1,
    today: TODAY,
    profile: {
      displayName: 'cadence-test',
      fullName: 'Test Athlete',
      sex: 'female',
      birthYear: 1990,
      timezone: 'Europe/Berlin',
      utcOffsetMin: OFFSET,
      weightKg: 72.4,
      hrMax: 188,
      hrRest: 46,
      lthr: 172,
      ftp: 260,
      runThresholdMps: 4.0,
      swimCssMps: 1.25,
      rowThresholdW: 230,
    },
    thresholdHistory: [],
    activities: structuredClone(ACTIVITIES),
    plan: [],
    wellness: structuredClone(WELLNESS),
    events: [],
    phases: [],
    markers: [],
    dayNotes: [],
    weekNotes: [],
  };
}

// ───────────────────────────── fake synth api ─────────────────────────────

export function fakeDetail(athlete: SynthAthlete, id: number): SynthActivityDetail {
  const a = athlete.activities.find((x) => x.garminActivityId === id);
  if (!a) throw new Error(`no activity ${id}`);
  const n = 120; // keep tests fast: 120 samples at 1 Hz
  const t = Array.from({ length: n }, (_, i) => i);
  const speed = a.avgSpeedMps ?? (a.distanceM ? a.distanceM / a.movingSec : undefined);
  const laps: Lap[] = [
    { index: 0, startSec: 0, durationSec: 60, distanceM: speed ? speed * 60 : undefined, avgHr: (a.avgHr ?? 120) - 5 },
    { index: 1, startSec: 60, durationSec: 60, distanceM: speed ? speed * 60 : undefined, avgHr: (a.avgHr ?? 120) + 5 },
  ];
  const detail: SynthActivityDetail = {
    activity: a,
    laps,
    streams: {
      t,
      hr: t.map((i) => (a.avgHr ?? 120) + (i % 10) - 5),
      ...(a.avgPower ? { power: t.map((i) => a.avgPower! + ((i % 6) - 3) * 10) } : {}),
      ...(speed ? { speed: t.map(() => speed), distance: t.map((i) => speed * i) } : {}),
      ...(a.avgCadence ? { cadence: t.map(() => a.avgCadence!) } : {}),
      altitude: t.map((i) => 100 + i * 0.5),
      ...(a.hasGps ? { lat: t.map((i) => 47.5 + i * 1e-5), lng: t.map((i) => 11.1 + i * 1e-5) } : {}),
    },
  };
  if (a.sport === 'strength') {
    const sets: StrengthSet[] = [
      { index: 0, exercise: 'Back Squat', category: 'SQUAT', reps: 8, weightKg: 80, durationSec: 40 },
      { index: 1, exercise: 'Rest', isRest: true, durationSec: 90 },
      { index: 2, exercise: 'Bench Press', category: 'BENCH_PRESS', reps: 8, weightKg: 60, durationSec: 35 },
    ];
    detail.strengthSets = sets;
  }
  return detail;
}

const FIT_SPORT: Record<string, [string, string]> = {
  run: ['running', 'generic'],
  bike: ['cycling', 'road'],
  swim: ['swimming', 'lapSwimming'],
  strength: ['training', 'strengthTraining'],
  row: ['rowing', 'indoorRowing'],
  hike: ['hiking', 'generic'],
};

/** Encode a detail as a FIT activity file (FIT conventions: run cadence per leg, semicircles). */
export function fakeEncodeFit(detail: SynthActivityDetail): Uint8Array {
  const a = detail.activity;
  const M = Profile.MesgNum;
  const start = new Date(a.startedAt);
  const enc = new Encoder();
  const e = { onMesg: (num: number, m: Record<string, unknown>) => enc.onMesg(num, m as Mesg) };
  const at = (s: number) => new Date(start.getTime() + s * 1000);
  const [sport, subSport] = FIT_SPORT[a.sport] ?? ['generic', 'generic'];
  e.onMesg(M.FILE_ID!, { type: 'activity', manufacturer: 'development', product: 1, timeCreated: start, serialNumber: 4242 });
  const s = detail.streams;
  const legs = a.sport === 'run' || a.sport === 'hike';
  if (s) {
    s.t.forEach((sec, i) => {
      const rec: Record<string, unknown> = { timestamp: at(sec) };
      if (s.hr?.[i] != null) rec.heartRate = s.hr[i];
      if (s.power?.[i] != null) rec.power = s.power[i];
      if (s.speed?.[i] != null) rec.enhancedSpeed = s.speed[i];
      if (s.distance?.[i] != null) rec.distance = s.distance[i];
      if (s.altitude?.[i] != null) rec.enhancedAltitude = s.altitude[i];
      if (s.cadence?.[i] != null) rec.cadence = legs ? Math.round(s.cadence[i]! / 2) : s.cadence[i];
      if (s.lat?.[i] != null) rec.positionLat = Math.round((s.lat[i]! * 2 ** 31) / 180);
      if (s.lng?.[i] != null) rec.positionLong = Math.round((s.lng[i]! * 2 ** 31) / 180);
      e.onMesg(M.RECORD!, rec);
    });
  }
  if (a.sport === 'swim' && a.poolLengthM) {
    // 4 lengths, then idle, then 4 lengths
    let tt = 0;
    let idx = 0;
    for (const block of [4, 0, 4]) {
      if (block === 0) {
        e.onMesg(M.LENGTH!, { messageIndex: idx++, timestamp: at(tt + 20), startTime: at(tt), totalElapsedTime: 20, totalTimerTime: 20, lengthType: 'idle' });
        tt += 20;
        continue;
      }
      for (let k = 0; k < block; k++) {
        e.onMesg(M.LENGTH!, { messageIndex: idx++, timestamp: at(tt + 22), startTime: at(tt), totalElapsedTime: 22, totalTimerTime: 22, totalStrokes: 16, swimStroke: k === 3 ? 'backstroke' : 'freestyle', lengthType: 'active' });
        tt += 22;
      }
    }
    e.onMesg(M.LAP!, { messageIndex: 0, timestamp: at(88), startTime: at(0), totalElapsedTime: 88, totalTimerTime: 88, totalDistance: 100, firstLengthIndex: 0, numLengths: 4, numActiveLengths: 4, sport, subSport });
    e.onMesg(M.LAP!, { messageIndex: 1, timestamp: at(108), startTime: at(88), totalElapsedTime: 20, totalTimerTime: 0, totalDistance: 0, firstLengthIndex: 4, numLengths: 1, numActiveLengths: 0, sport, subSport });
    e.onMesg(M.LAP!, { messageIndex: 2, timestamp: at(196), startTime: at(108), totalElapsedTime: 88, totalTimerTime: 88, totalDistance: 100, firstLengthIndex: 5, numLengths: 4, numActiveLengths: 4, sport, subSport });
  } else {
    for (const l of detail.laps) {
      e.onMesg(M.LAP!, {
        messageIndex: l.index,
        timestamp: at(l.startSec + l.durationSec),
        startTime: at(l.startSec),
        totalElapsedTime: l.durationSec,
        totalTimerTime: l.durationSec,
        ...(l.distanceM !== undefined ? { totalDistance: l.distanceM } : {}),
        ...(l.avgHr !== undefined ? { avgHeartRate: Math.round(l.avgHr) } : {}),
        sport,
      });
    }
  }
  for (const st of detail.strengthSets ?? []) {
    const cat = st.category === 'SQUAT' ? 'squat' : st.category === 'BENCH_PRESS' ? 'benchPress' : undefined;
    const sub = cat === 'squat' ? nameIndex('squatExerciseName', 'barbellBackSquat') : cat === 'benchPress' ? nameIndex('benchPressExerciseName', 'barbellBenchPress') : undefined;
    e.onMesg(M.SET!, {
      messageIndex: st.index,
      timestamp: at(st.index * 60),
      startTime: at(st.index * 60),
      duration: st.durationSec,
      setType: st.isRest ? 'rest' : 'active',
      ...(st.reps !== undefined ? { repetitions: st.reps } : {}),
      ...(st.weightKg !== undefined ? { weight: st.weightKg } : {}),
      ...(cat ? { category: [cat], categorySubtype: [sub] } : {}),
    });
  }
  e.onMesg(M.SESSION!, {
    messageIndex: 0,
    timestamp: at(a.durationSec),
    startTime: start,
    totalElapsedTime: a.durationSec,
    totalTimerTime: a.movingSec,
    sport,
    subSport,
    ...(a.distanceM !== undefined ? { totalDistance: a.distanceM } : {}),
    ...(a.avgHr !== undefined ? { avgHeartRate: a.avgHr } : {}),
    ...(a.maxHr !== undefined ? { maxHeartRate: a.maxHr } : {}),
    ...(a.avgPower !== undefined ? { avgPower: a.avgPower } : {}),
    ...(a.normPower !== undefined ? { normalizedPower: a.normPower } : {}),
    ...(a.avgSpeedMps !== undefined ? { enhancedAvgSpeed: a.avgSpeedMps } : {}),
    ...(a.avgCadence !== undefined ? { avgCadence: legs ? Math.round(a.avgCadence / 2) : a.avgCadence } : {}),
    ...(a.calories !== undefined ? { totalCalories: a.calories } : {}),
    ...(a.elevationGainM !== undefined ? { totalAscent: a.elevationGainM } : {}),
    ...(a.poolLengthM ? { poolLength: a.poolLengthM, totalCycles: a.strokes ?? 0, numActiveLengths: 8 } : {}),
    ...(a.avgPower ? { totalWork: a.avgPower * a.movingSec, trainingStressScore: 80.5, intensityFactor: 0.82, thresholdPower: 260 } : {}),
    firstLapIndex: 0,
    numLaps: detail.laps.length,
  });
  e.onMesg(M.ACTIVITY!, {
    timestamp: at(a.durationSec),
    totalTimerTime: a.movingSec,
    numSessions: 1,
    type: 'manual',
    event: 'activity',
    eventType: 'stop',
    localTimestamp: Utils.convertDateToDateTime(at(a.durationSec)) + a.utcOffsetMin * 60,
  });
  return enc.close();
}

function nameIndex(table: string, name: string): number {
  const t = Profile.types[table]!;
  const hit = Object.entries(t).find(([, v]) => v === name);
  if (!hit) throw new Error(`no ${name} in ${table}`);
  return Number(hit[0]);
}

/** Encoder whose onMesg accepts plain records (the SDK's Mesg type rejects literal fields). */
export function looseEncoder(opts?: ConstructorParameters<typeof Encoder>[0]) {
  const enc = new Encoder(opts);
  return { onMesg: (num: number, m: Record<string, unknown>) => enc.onMesg(num, m as Mesg), close: () => enc.close() };
}

export const fakeSynth: Pick<SynthApi, 'generateActivityDetail' | 'encodeFit'> = {
  generateActivityDetail: fakeDetail,
  encodeFit: fakeEncodeFit,
};
