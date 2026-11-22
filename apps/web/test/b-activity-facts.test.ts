/**
 * Activity page v3: detail facts (FIT + Garmin summary + streams), location name, swim lengths,
 * per-lap extras, watch RPE — through the real ingest pipeline and GET /api/activities/:id.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { Activity, ActivityDetail } from '@cadence/core/domain';
import { mapActivitySummary } from '@cadence/garmin';
import { activityListItem } from '@cadence/garmin/mock';
import { encodeFit, generateActivityDetail, generateAthlete, type SynthActivity, type SynthAthlete } from '@cadence/garmin/synth';
import { buildFacts, ingestActivity } from '../worker/services/ingest';
import { api, json } from './helpers';

let athlete: SynthAthlete;
const pick = (f: (a: SynthActivity) => boolean) => [...athlete.activities].reverse().find(f)!;

beforeAll(() => {
  athlete = generateAthlete({ seed: 7, today: '2026-11-21', months: 2 });
});

describe('activity facts', () => {
  it('a Garmin-synced outdoor run carries location, start position, running dynamics, device and temperature', async () => {
    const run = pick((a) => a.sport === 'run' && a.hasGps && a.subSport !== 'track');
    const fit = encodeFit(generateActivityDetail(athlete, run.garminActivityId));
    const res = await ingestActivity(env, { source: 'garmin', summary: mapActivitySummary(activityListItem(run)), fit });
    expect(res.outcome).toBe('created');
    const d = ActivityDetail.parse(await json(`/activities/${res.activityId}`));
    expect(d.locationName).toBe('Girona');
    const f = d.facts!;
    expect(f.startLat).toBeCloseTo(41.98, 1);
    expect(f.startLng).toBeCloseTo(2.82, 1);
    expect(f.avgGroundContactMs).toBeGreaterThan(180);
    expect(f.avgVerticalOscillationCm).toBeGreaterThan(6);
    expect(f.avgStrideLengthM).toBeGreaterThan(0.7);
    expect(f.avgVerticalRatioPct).toBeGreaterThan(4);
    expect(f.deviceName).toBe('Forerunner 965');
    expect(f.sensors?.some((s) => s.kind === 'Heart rate')).toBe(true);
    expect(f.avgTempC).toBeTypeOf('number');
    expect(f.maxCadence).toBeGreaterThan(d.avgCadence!);
    expect(f.minAltitudeM).toBeLessThanOrEqual(f.maxAltitudeM!);
    expect(f.trainingEffectLabel).toBeTruthy();
    // laps carry dynamics and maxima
    const lap = d.laps.find((l) => l.avgGroundContactMs !== undefined);
    expect(lap?.maxSpeedMps).toBeGreaterThan(0);
    // list rows carry the location too; search finds it
    const list = await json<{ items: Activity[] }>('/activities?q=Girona');
    expect(list.items.some((a) => a.id === res.activityId && a.locationName === 'Girona')).toBe(true);
  });

  it('an outdoor ride with dual-sided pedals reports L/R balance and the Edge', async () => {
    const ride = pick((a) => a.sport === 'bike' && a.hasGps && !!a.avgPower);
    const fit = encodeFit(generateActivityDetail(athlete, ride.garminActivityId));
    const res = await ingestActivity(env, { source: 'garmin', summary: mapActivitySummary(activityListItem(ride)), fit });
    const d = ActivityDetail.parse(await json(`/activities/${res.activityId}`));
    expect(d.facts?.deviceName).toBe('Edge 840');
    expect(d.facts?.powerBalanceLeftPct).toBeGreaterThan(45);
    expect(d.facts?.powerBalanceLeftPct).toBeLessThan(55);
    expect(d.facts?.sensors?.map((s) => s.kind)).toContain('Power');
    expect(d.facts?.elevationLossM).toBeGreaterThan(0);
    expect(d.laps.some((l) => l.maxPower !== undefined)).toBe(true);
  });

  it('a FIT upload has coordinates but no invented location name; the watch RPE is kept', async () => {
    const run = athlete.activities.find((a) => a.sport === 'run' && a.hasGps && a.rpe !== undefined)!; // oldest: not synced above
    const fit = encodeFit(generateActivityDetail(athlete, run.garminActivityId));
    const res = await api('/activities/upload', { method: 'POST', body: fit });
    const body = (await res.json()) as { activityId: string };
    const d = ActivityDetail.parse(await json(`/activities/${body.activityId}`));
    expect(d.locationName).toBeUndefined();
    expect(d.facts?.startLat).toBeTypeOf('number');
    expect(d.rpe).toBe(run.rpe);
  });

  it('a pool swim stores every length, stroke figures and no location / map facts', async () => {
    const swim = pick((a) => a.sport === 'swim' && a.subSport === 'pool');
    const fit = encodeFit(generateActivityDetail(athlete, swim.garminActivityId));
    const res = await ingestActivity(env, { source: 'garmin', summary: mapActivitySummary(activityListItem(swim)), fit });
    const d = ActivityDetail.parse(await json(`/activities/${res.activityId}`));
    expect(d.locationName).toBeUndefined();
    expect(d.facts?.startLat).toBeUndefined();
    expect(d.swimLengths?.length).toBeGreaterThan(10);
    expect(d.swimLengths!.filter((l) => !l.isRest).every((l) => l.durationSec > 0)).toBe(true);
    expect(d.facts?.avgStrokesPerLength).toBeGreaterThan(3);
    expect(d.facts?.avgDistancePerStrokeM).toBeGreaterThan(0.5);
  });

  it('a manual entry has no facts at all (nothing is invented)', async () => {
    const a = await json<Activity>('/activities/manual', { method: 'POST', body: { localDate: '2026-11-20', sport: 'run', title: 'Treadmill by hand', durationSec: 1800 } });
    const d = ActivityDetail.parse(await json(`/activities/${a.id}`));
    expect(d.facts).toBeUndefined();
    expect(d.locationName).toBeUndefined();
    expect(d.swimLengths).toBeUndefined();
  });

  it('buildFacts: summary elevation wins, FIT beats the summary otherwise, streams fill gaps', () => {
    const f = buildFacts({
      sport: 'bike',
      summary: { elevationLossM: 500, maxSpeedMps: 15, deviceLoad: 90 },
      fit: { elevationLossM: 480, maxSpeedMps: 16, deviceName: 'Edge 840' },
      stored: { t: [0, 1, 2], temp: [10, 12, 14] },
      previous: { sweatLossMl: 700 },
    });
    expect(f).toMatchObject({ elevationLossM: 500, maxSpeedMps: 16, deviceLoad: 90, deviceName: 'Edge 840', avgTempC: 12, sweatLossMl: 700 });
  });
});
