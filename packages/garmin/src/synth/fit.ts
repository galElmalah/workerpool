/**
 * Encode a synthetic activity detail as a real FIT activity file using Garmin's JS SDK
 * (what Connect's "original" download contains): file_id, device_info (watch/Edge + sensors),
 * timer events incl. auto-pauses, 1 Hz records, laps, lengths (pool swim), sets (strength),
 * session and activity messages.
 */
import { Encoder, Profile } from '@garmin/fitsdk';
import type {
  ActivityMesg,
  DeviceInfoMesg,
  EventMesg,
  FileIdMesg,
  LapMesg,
  LengthMesg,
  RecordMesg,
  SessionMesg,
  SetMesg,
} from '@garmin/fitsdk';
import type { Lap } from '@cadence/core/domain';
import type { SynthActivityDetail } from './types';
import { exerciseByName } from './sessions/strength';

const MN = Profile.MesgNum as Record<string, number>;
const FIT_EPOCH_S = 631_065_600;

const reverse = new Map<string, Map<string, number>>();
/** FIT enum value by profile type and value name (e.g. enumVal('sport', 'cycling') → 2). */
function enumVal(type: string, name: string, fallback = 0): number {
  let m = reverse.get(type);
  if (!m) {
    m = new Map();
    const t = (Profile.types as Record<string, Record<string, string>>)[type] ?? {};
    for (const [k, v] of Object.entries(t)) m.set(v, Number(k));
    reverse.set(type, m);
  }
  return m.get(name) ?? fallback;
}

type Enc = { mesgNum: number };
const write = (enc: Encoder, mesgNum: number, mesg: object) => enc.writeMesg({ mesgNum, ...mesg } as Enc);

function fitSport(sport: string, sub?: string): { sport: number; subSport: number; name: string } {
  const s = (a: string, b: string, name: string) => ({ sport: enumVal('sport', a), subSport: enumVal('subSport', b), name });
  switch (sport) {
    case 'bike':
      return sub === 'indoor' ? s('cycling', 'indoorCycling', 'Bike') : sub === 'gravel' ? s('cycling', 'gravelCycling', 'Bike') : sub === 'mtb' ? s('cycling', 'mountain', 'Bike') : sub === 'virtual' ? s('cycling', 'virtualActivity', 'Bike') : s('cycling', 'road', 'Road Bike');
    case 'run':
      return sub === 'trail' ? s('running', 'trail', 'Trail Run') : sub === 'track' ? s('running', 'track', 'Track Run') : sub === 'treadmill' ? s('running', 'treadmill', 'Treadmill') : s('running', 'generic', 'Run');
    case 'swim':
      return sub === 'open_water' ? s('swimming', 'openWater', 'Open Water') : s('swimming', 'lapSwimming', 'Pool Swim');
    case 'row':
      return s('rowing', 'indoorRowing', 'Indoor Row');
    case 'strength':
      return s('training', 'strengthTraining', 'Strength');
    case 'yoga':
      return s('training', 'yoga', 'Yoga');
    case 'hike':
      return s('hiking', 'generic', 'Hike');
    case 'walk':
      return s('walking', 'generic', 'Walk');
    default:
      return s('generic', 'generic', 'Other');
  }
}

const semi = (deg: number) => Math.round((deg * 2 ** 31) / 180);

function swimStroke(name: string | undefined): number | undefined {
  switch (name) {
    case 'free':
      return enumVal('swimStroke', 'freestyle');
    case 'back':
      return enumVal('swimStroke', 'backstroke');
    case 'breast':
      return enumVal('swimStroke', 'breaststroke');
    case 'fly':
      return enumVal('swimStroke', 'butterfly');
    case 'drill':
      return enumVal('swimStroke', 'drill');
    case 'mixed':
      return enumVal('swimStroke', 'mixed');
    default:
      return undefined;
  }
}

/** Per-lap maxima, descent, temperature and running dynamics from the 1 Hz streams. */
function lapStats(detail: SynthActivityDetail, l: Lap, isRun: boolean): Record<string, number> {
  const st = detail.streams!;
  const out: Record<string, number> = {};
  let i0 = 0;
  while (i0 < st.t.length && st.t[i0]! < l.startSec) i0++;
  let i1 = i0;
  while (i1 < st.t.length && st.t[i1]! < l.startSec + l.durationSec) i1++;
  if (i1 - i0 < 2) return out;
  const max = (ch: ReadonlyArray<number | null> | undefined) => {
    let m = -Infinity;
    if (ch) for (let i = i0; i < i1; i++) if (ch[i] != null && ch[i]! > m) m = ch[i]!;
    return Number.isFinite(m) && m > 0 ? m : undefined;
  };
  const mean = (ch: ReadonlyArray<number | null> | undefined) => {
    let s = 0;
    let c = 0;
    if (ch) for (let i = i0; i < i1; i++) if (ch[i] != null) (s += ch[i]!), c++;
    return c ? s / c : undefined;
  };
  const mp = max(st.power);
  if (mp !== undefined) out.maxPower = Math.round(mp);
  const ms = detail.activity.sport === 'swim' ? undefined : max(st.speed);
  if (ms !== undefined) out.enhancedMaxSpeed = ms;
  const mc = max(st.cadence);
  if (mc !== undefined) out.maxCadence = Math.min(254, Math.round(isRun ? mc / 2 : mc));
  if (st.altitude) {
    let down = 0;
    for (let i = i0 + 1; i < i1; i++) {
      const d = (st.altitude[i - 1] ?? 0) - (st.altitude[i] ?? 0);
      if (d > 0) down += d;
    }
    out.totalDescent = Math.round(down);
  }
  const tm = mean(st.temp);
  if (tm !== undefined) out.avgTemperature = Math.round(tm);
  const dy = detail.dynamics;
  if (dy) {
    const g = mean(dy.gct);
    const v = mean(dy.vo);
    const r = mean(dy.vr);
    const s = mean(dy.step);
    if (g !== undefined) out.avgStanceTime = Math.round(g * 10) / 10;
    if (v !== undefined) out.avgVerticalOscillation = Math.round(v * 10);
    if (r !== undefined) out.avgVerticalRatio = Math.round(r * 100) / 100;
    if (s !== undefined) out.avgStepLength = Math.round(s * 1000);
  }
  return out;
}

export function encodeFit(detail: SynthActivityDetail): Uint8Array {
  const a = detail.activity;
  const st = detail.streams;
  const enc = new Encoder();
  const start = Math.floor(Date.parse(a.startedAt) / 1000) - FIT_EPOCH_S;
  const end = start + a.durationSec;
  const fs = fitSport(a.sport, a.subSport);
  const isBike = a.sport === 'bike';
  const isRun = a.sport === 'run' || a.sport === 'walk' || a.sport === 'hike';
  const product = isBike && !a.subSport?.includes('indoor') ? 'edge840' : 'fr965';
  const serial = 3_400_000_000 + (a.garminActivityId % 10_000_000);

  write(enc, MN.FILE_ID!, {
    type: enumVal('file', 'activity'),
    manufacturer: enumVal('manufacturer', 'garmin', 1),
    product: enumVal('garminProduct', product),
    serialNumber: serial,
    timeCreated: start,
  } satisfies FileIdMesg);

  write(enc, MN.DEVICE_INFO!, {
    timestamp: start,
    deviceIndex: 0,
    manufacturer: enumVal('manufacturer', 'garmin', 1),
    product: enumVal('garminProduct', product),
    serialNumber: serial,
    softwareVersion: product === 'edge840' ? 27.12 : 25.24,
    productName: product === 'edge840' ? 'Edge 840' : 'Forerunner 965',
  } satisfies DeviceInfoMesg);
  if (st?.hr) {
    write(enc, MN.DEVICE_INFO!, {
      timestamp: start,
      deviceIndex: 1,
      deviceType: enumVal('antplusDeviceType', 'heartRate', 120),
      sourceType: enumVal('sourceType', 'antplus', 1),
      manufacturer: enumVal('manufacturer', 'garmin', 1),
      product: enumVal('garminProduct', 'hrmPro'),
      serialNumber: 1_234_567 + (a.garminActivityId % 1000),
      batteryStatus: enumVal('batteryStatus', 'good', 3),
    } satisfies DeviceInfoMesg);
  }
  if (st?.power && isBike) {
    write(enc, MN.DEVICE_INFO!, {
      timestamp: start,
      deviceIndex: 2,
      deviceType: enumVal('antplusDeviceType', a.subSport === 'indoor' ? 'fitnessEquipment' : 'bikePower', 11),
      sourceType: enumVal('sourceType', 'antplus', 1),
      manufacturer: enumVal('manufacturer', a.subSport === 'indoor' ? 'wahooFitness' : 'garmin', 1),
      serialNumber: 98_765 + (a.garminActivityId % 1000),
      productName: a.subSport === 'indoor' ? 'KICKR' : 'Rally XC200',
    } satisfies DeviceInfoMesg);
  }

  const timer = enumVal('event', 'timer');
  write(enc, MN.EVENT!, { timestamp: start, event: timer, eventType: enumVal('eventType', 'start'), eventGroup: 0 } satisfies EventMesg);

  // records + timer stop/start around pauses
  let totalTimer = 0;
  if (st) {
    const n = st.t.length;
    const cadHalf = isRun; // FIT running cadence is strides/min
    for (let i = 0; i < n; i++) {
      const t = st.t[i]!;
      if (i > 0 && t - st.t[i - 1]! > 1) {
        write(enc, MN.EVENT!, { timestamp: start + st.t[i - 1]! + 1, event: timer, eventType: enumVal('eventType', 'stopAll') } satisfies EventMesg);
        write(enc, MN.EVENT!, { timestamp: start + t, event: timer, eventType: enumVal('eventType', 'start') } satisfies EventMesg);
      }
      const r: RecordMesg & Record<string, unknown> = { timestamp: start + t };
      const lat = st.lat?.[i];
      const lng = st.lng?.[i];
      if (lat != null && lng != null) {
        r.positionLat = semi(lat);
        r.positionLong = semi(lng);
      }
      const d = st.distance?.[i];
      if (d != null) r.distance = d;
      const alt = st.altitude?.[i];
      if (alt != null) r.enhancedAltitude = alt;
      const v = st.speed?.[i];
      if (v != null) r.enhancedSpeed = v;
      const hr = st.hr?.[i];
      if (hr != null) r.heartRate = hr;
      const c = st.cadence?.[i];
      if (c != null) r.cadence = Math.min(254, cadHalf ? Math.round(c / 2) : c);
      const p = st.power?.[i];
      if (p != null) r.power = p;
      const tmp = st.temp?.[i];
      if (tmp != null) r.temperature = tmp;
      const dy = detail.dynamics;
      if (dy && dy.gct[i] != null) {
        r.stanceTime = dy.gct[i]!;
        r.verticalOscillation = Math.round(dy.vo[i]! * 10); // mm
        r.verticalRatio = dy.vr[i]!;
        r.stepLength = Math.round(dy.step[i]! * 1000); // mm
        if (a.avgGroundContactBalancePct !== undefined) r.stanceTimeBalance = a.avgGroundContactBalancePct;
      }
      write(enc, MN.RECORD!, r);
    }
    totalTimer = n;
  } else totalTimer = a.durationSec;

  // pool lengths: reconstructed per active lap from the distance stream (boundaries at k × pool length)
  const swimLaps = a.poolLengthM !== undefined;
  let lengthIdx = 0;
  const firstLength = new Map<number, number>();
  if (swimLaps && st?.distance) {
    const L = a.poolLengthM!;
    const dist = st.distance;
    for (const l of detail.laps) {
      if (l.isRest || !l.lengths) continue;
      let i = st.t.findIndex((t) => t >= l.startSec);
      if (i < 0) continue;
      firstLength.set(l.index, lengthIdx);
      const d0 = i > 0 ? (dist[i - 1] ?? 0) : 0;
      let tPrev = l.startSec;
      for (let k = 1; k <= l.lengths; k++) {
        const target = d0 + k * L - 1e-6;
        while (i < st.t.length - 1 && (dist[i] ?? 0) < target) i++;
        const tEnd = k === l.lengths ? l.startSec + l.durationSec : st.t[i]!;
        const dt = Math.max(1, tEnd - tPrev);
        const cad = st.cadence?.[Math.max(0, i - 1)] ?? 0;
        const stroke = l.stroke === 'mixed' ? 'free' : l.stroke;
        write(enc, MN.LENGTH!, {
          messageIndex: lengthIdx++,
          timestamp: start + Math.round(tEnd),
          startTime: start + Math.round(tPrev),
          event: enumVal('event', 'length'),
          eventType: enumVal('eventType', 'stop'),
          totalElapsedTime: dt,
          totalTimerTime: dt,
          totalStrokes: Math.round((cad * dt) / 60),
          avgSpeed: L / dt,
          swimStroke: swimStroke(stroke) ?? enumVal('swimStroke', 'freestyle'),
          avgSwimmingCadence: Math.min(254, cad),
          lengthType: enumVal('lengthType', 'active'),
        } satisfies LengthMesg);
        tPrev = tEnd;
      }
    }
  }

  // laps
  const laps: Lap[] = detail.laps;
  laps.forEach((l, i) => {
    const lm: LapMesg & Record<string, unknown> = {
      messageIndex: i,
      timestamp: start + Math.round(l.startSec + l.durationSec),
      event: enumVal('event', 'lap'),
      eventType: enumVal('eventType', 'stop'),
      startTime: start + Math.round(l.startSec),
      totalElapsedTime: l.durationSec,
      totalTimerTime: l.movingSec !== undefined && swimLaps ? l.durationSec : l.durationSec,
      lapTrigger: enumVal('lapTrigger', l.isRest !== undefined ? 'manual' : a.sport === 'strength' ? 'sessionEnd' : 'distance'),
      sport: fs.sport,
      subSport: fs.subSport,
    };
    if (l.distanceM !== undefined) lm.totalDistance = l.distanceM;
    if (l.avgSpeedMps !== undefined) lm.enhancedAvgSpeed = l.avgSpeedMps;
    if (l.avgHr !== undefined) lm.avgHeartRate = l.avgHr;
    if (l.maxHr !== undefined) lm.maxHeartRate = l.maxHr;
    if (l.avgPower !== undefined) lm.avgPower = l.avgPower;
    if (l.weightedPower !== undefined) lm.normalizedPower = l.weightedPower;
    if (l.avgCadence !== undefined) lm.avgCadence = Math.min(254, isRun ? Math.round(l.avgCadence / 2) : l.avgCadence);
    if (l.elevationGainM !== undefined) lm.totalAscent = l.elevationGainM;
    if (l.movingSec !== undefined) lm.totalMovingTime = l.movingSec;
    if (st) Object.assign(lm, lapStats(detail, l, isRun));
    if (swimLaps) {
      lm.numLengths = l.isRest ? 0 : (l.lengths ?? 0);
      if (firstLength.has(l.index)) lm.firstLengthIndex = firstLength.get(l.index)!;
      lm.numActiveLengths = l.isRest ? 0 : (l.lengths ?? 0);
      lm.intensity = enumVal('intensity', l.isRest ? 'rest' : 'active');
      const ss = swimStroke(l.stroke);
      if (ss !== undefined) lm.swimStroke = ss;
      if (l.swolf !== undefined) lm.avgSwolf = l.swolf;
    }
    write(enc, MN.LAP!, lm);
  });

  // strength sets
  if (detail.strengthSets) {
    let t = start;
    detail.strengthSets.forEach((s, i) => {
      const dur = s.durationSec ?? 30;
      const ex = exerciseByName(s.exercise);
      const sm: SetMesg & Record<string, unknown> = {
        messageIndex: i,
        timestamp: t + dur,
        startTime: t,
        duration: dur,
        setType: enumVal('setType', s.isRest ? 'rest' : 'active'),
      };
      if (!s.isRest) {
        sm.category = [enumVal('exerciseCategory', ex?.fit ?? 'core', 65534)];
        if (s.reps !== undefined) sm.repetitions = s.reps;
        if (s.weightKg !== undefined) sm.weight = s.weightKg;
      }
      write(enc, MN.SET!, sm);
      t += dur;
    });
  }

  write(enc, MN.EVENT!, { timestamp: end, event: timer, eventType: enumVal('eventType', 'stopAll') } satisfies EventMesg);

  // session
  const sm: SessionMesg & Record<string, unknown> = {
    messageIndex: 0,
    timestamp: end,
    event: enumVal('event', 'session'),
    eventType: enumVal('eventType', 'stop'),
    startTime: start,
    sport: fs.sport,
    subSport: fs.subSport,
    sportProfileName: fs.name,
    totalElapsedTime: a.durationSec,
    totalTimerTime: totalTimer,
    totalMovingTime: a.movingSec,
    totalCalories: a.calories ?? 0,
    firstLapIndex: 0,
    numLaps: laps.length,
    trigger: enumVal('sessionTrigger', 'activityEnd'),
  };
  if (a.distanceM !== undefined) sm.totalDistance = a.distanceM;
  if (a.avgSpeedMps !== undefined) sm.enhancedAvgSpeed = a.avgSpeedMps;
  if (st?.speed) {
    let mx = 0;
    for (const v of st.speed) if (v != null && v > mx) mx = v;
    sm.enhancedMaxSpeed = mx;
  }
  if (a.avgHr !== undefined) sm.avgHeartRate = a.avgHr;
  if (a.maxHr !== undefined) sm.maxHeartRate = a.maxHr;
  if (a.avgPower !== undefined) sm.avgPower = a.avgPower;
  if (a.maxPower !== undefined) sm.maxPower = a.maxPower;
  if (a.normPower !== undefined) sm.normalizedPower = a.normPower;
  if (a.avgCadence !== undefined) sm.avgCadence = Math.min(254, isRun ? Math.round(a.avgCadence / 2) : a.avgCadence);
  if (a.elevationGainM !== undefined) sm.totalAscent = a.elevationGainM;
  if (a.aerobicEffect !== undefined) sm.totalTrainingEffect = a.aerobicEffect;
  if (a.anaerobicEffect !== undefined) sm.totalAnaerobicTrainingEffect = a.anaerobicEffect;
  if (a.poolLengthM !== undefined) {
    sm.poolLength = a.poolLengthM;
    sm.poolLengthUnit = enumVal('displayMeasure', 'metric');
    sm.numLengths = lengthIdx;
    sm.numActiveLengths = lengthIdx;
  }
  if (a.strokes !== undefined) sm.totalCycles = a.strokes;
  if (a.avgSwolf !== undefined) sm.avgSwolf = a.avgSwolf;
  if (a.totalReps !== undefined) sm.totalReps = a.totalReps;
  if (a.avgPower !== undefined) sm.totalWork = Math.round(a.avgPower * totalTimer);
  if (st?.lat) {
    const i0 = st.lat.findIndex((v) => v != null);
    if (i0 >= 0) {
      sm.startPositionLat = semi(st.lat[i0]!);
      sm.startPositionLong = semi(st.lng![i0]!);
    }
  }
  // detail extras (what a Forerunner / Edge writes in the session message)
  const ext: Record<string, number | undefined> = {
    totalDescent: a.elevationLossM,
    enhancedMinAltitude: a.minElevationM,
    enhancedMaxAltitude: a.maxElevationM,
    avgTemperature: a.avgTempC,
    minTemperature: a.minTempC,
    maxTemperature: a.maxTempC,
    maxCadence: a.maxCadence === undefined ? undefined : Math.min(254, isRun ? Math.round(a.maxCadence / 2) : a.maxCadence),
    avgStanceTime: a.avgGroundContactMs,
    avgStanceTimeBalance: a.avgGroundContactBalancePct,
    avgVerticalOscillation: a.avgVerticalOscillationCm === undefined ? undefined : Math.round(a.avgVerticalOscillationCm * 10),
    avgVerticalRatio: a.avgVerticalRatioPct,
    avgStepLength: a.avgStrideLengthM === undefined ? undefined : Math.round(a.avgStrideLengthM * 1000),
    leftRightBalance: a.powerBalanceLeftPct === undefined ? undefined : 0x8000 | Math.round((100 - a.powerBalanceLeftPct) * 100),
  };
  if (isRun && a.steps !== undefined && a.sport === 'run') ext.totalCycles = Math.round(a.steps / 2);
  if (a.sport === 'row' && st?.cadence) {
    let strokes = 0;
    for (const c of st.cadence) if (c != null && c > 0) strokes += c / 60;
    ext.totalCycles = Math.round(strokes);
    if (a.distanceM && strokes > 0) ext.avgStrokeDistance = Math.round((a.distanceM / strokes) * 100) / 100;
  }
  if (st?.lat) {
    let j = st.lat.length - 1;
    while (j >= 0 && (st.lat[j] == null || st.lng?.[j] == null)) j--;
    if (j >= 0) {
      ext.endPositionLat = semi(st.lat[j]!);
      ext.endPositionLong = semi(st.lng![j]!);
    }
  }
  for (const [k, v] of Object.entries(ext)) if (v !== undefined) sm[k] = v;
  if (a.rpe !== undefined) sm.workoutRpe = a.rpe * 10;
  if (a.feel !== undefined) sm.workoutFeel = (a.feel - 1) * 25;
  write(enc, MN.SESSION!, sm);

  write(enc, MN.ACTIVITY!, {
    timestamp: end,
    totalTimerTime: totalTimer,
    numSessions: 1,
    type: enumVal('activity', 'manual'),
    event: enumVal('event', 'activity'),
    eventType: enumVal('eventType', 'stop'),
    localTimestamp: end + a.utcOffsetMin * 60,
  } satisfies ActivityMesg);

  return enc.close();
}
