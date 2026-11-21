import { describe, expect, it } from 'vitest';
import { GarminClient, memoryTokenStore, parseFit, pushPlannedWorkout } from '../src';
import { createGarminMock, mockBaseUrls } from '../src/mock';
import { fakeSynth, makeAthlete } from './helpers/fake-athlete';
import { planned, step } from './helpers/planned';
import { clock, harness } from './helpers/setup';

const req = (url: string, init?: RequestInit) => new Request(url, init);

describe('mounted mode (DEMO): path-prefix routing', () => {
  it('a client pointed at mockBaseUrls works end to end', async () => {
    const clk = clock();
    const mock = createGarminMock({ athlete: makeAthlete(), synth: fakeSynth, now: clk.now });
    const client = new GarminClient({
      fetch: mock.fetch,
      baseUrls: mockBaseUrls('https://cadence.example.workers.dev'),
      tokens: memoryTokenStore({ personal: { apiKey: 'good-key' }, di: mock.issueDiTokens() }),
      now: clk.now,
    });
    expect(await client.listActivities({ limit: 2 })).toHaveLength(2);
    const fit = await client.downloadOriginalFit(21_000_000_002);
    expect(parseFit(fit).sport).toBe('bike');
    const link = await pushPlannedWorkout(client, planned({ sport: 'run', title: 'Easy', plannedDurationSec: 1800 }), {}, undefined);
    expect(link.syncState).toBe('synced');
    expect(mock.state.requests.map((r) => r.api)).toEqual(expect.arrayContaining(['personal', 'connect']));
    expect(mockBaseUrls('https://x.dev/', '/g')).toEqual({ personal: 'https://x.dev/g/personal', connect: 'https://x.dev/g/connect', diauth: 'https://x.dev/g/diauth', sso: 'https://x.dev/g/sso' });
  });
});

describe('auth enforcement', () => {
  it('bearer tokens are host-specific; missing/expired tokens → 401', async () => {
    const h = harness({ personal: true, di: true });
    await h.client.listActivities({ limit: 1 });
    const personalBearer = h.store.current!.personal!.bearer!;
    const di = h.store.current!.di!.di_token;
    const call = (host: string, token: string, path = '/activitylist-service/activities/search/activities') =>
      h.mock.fetch(req(`https://${host}${path}`, { headers: { Authorization: `Bearer ${token}` } })).then((r) => r.status);
    expect(await call('personal.connectapi.garmin.com', personalBearer)).toBe(200);
    expect(await call('connectapi.garmin.com', personalBearer)).toBe(401);
    expect(await call('personal.connectapi.garmin.com', di)).toBe(401);
    expect(await call('connectapi.garmin.com', di)).toBe(200);
    h.clk.advance(25 * 3600_000);
    expect(await call('connectapi.garmin.com', di)).toBe(401);
    expect((await h.mock.fetch(req('https://connectapi.garmin.com/userprofile-service/socialProfile'))).status).toBe(401);
  });

  it('Personal API is GET-only and limited to its documented paths', async () => {
    const h = harness({ personal: true });
    await h.client.listActivities({ limit: 1 });
    const bearer = h.store.current!.personal!.bearer!;
    const auth = { Authorization: `Bearer ${bearer}` };
    expect((await h.mock.fetch(req('https://personal.connectapi.garmin.com/workout-service/workout', { method: 'POST', headers: auth, body: '{}' }))).status).toBe(405);
    expect((await h.mock.fetch(req('https://personal.connectapi.garmin.com/metrics-service/metrics/trainingreadiness/2026-11-20', { headers: auth }))).status).toBe(404);
    expect((await h.mock.fetch(req('https://personal.connectapi.garmin.com/sleep-service/sleep/dailySleep?date=2026-11-20', { headers: auth }))).status).toBe(200);
  });

  it('connectapi rejects cookies (the library never sends them)', async () => {
    const h = harness({ di: true });
    const di = h.store.current!.di!.di_token;
    const r = await h.mock.fetch(req('https://connectapi.garmin.com/userprofile-service/socialProfile', { headers: { Authorization: `Bearer ${di}`, Cookie: 'JWT_WEB=x' } }));
    expect(r.status).toBe(400);
  });
});

describe('workout-service emulation', () => {
  it('validates create bodies, requires workoutId on PUT, cascades schedules on delete', async () => {
    const h = harness({ di: true });
    const di = h.store.current!.di!.di_token;
    const post = (body: unknown) =>
      h.mock.fetch(req('https://connectapi.garmin.com/workout-service/workout', { method: 'POST', headers: { Authorization: `Bearer ${di}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
    expect((await post({ workoutName: 'x', sportType: { sportTypeId: 99 }, workoutSegments: [] })).status).toBe(400);
    const dupOrder = {
      workoutName: 'x',
      sportType: { sportTypeId: 1 },
      workoutSegments: [{ segmentOrder: 1, sportType: { sportTypeId: 1 }, workoutSteps: [1, 1].map((o) => ({ type: 'ExecutableStepDTO', stepOrder: o, stepType: { stepTypeId: 3 }, endCondition: { conditionTypeId: 1 }, targetType: { workoutTargetTypeId: 1 } })) }],
    };
    const bad = await post(dupOrder);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ message: expect.stringMatching(/stepOrder/) });

    const created = await h.client.createWorkout({ workoutName: 'ok', sportType: { sportTypeId: 1, sportTypeKey: 'running' }, workoutSegments: [{ ...dupOrder.workoutSegments[0]!, sportType: { sportTypeId: 1, sportTypeKey: 'running' }, workoutSteps: [dupOrder.workoutSegments[0]!.workoutSteps[0]!] }] } as never);
    expect(created.workoutId).toBeGreaterThan(0);
    expect((created.workoutSegments[0]!.workoutSteps[0] as { stepId?: number }).stepId).toBeGreaterThan(0);
    const put = await h.mock.fetch(req(`https://connectapi.garmin.com/workout-service/workout/${created.workoutId}`, { method: 'PUT', headers: { Authorization: `Bearer ${di}` }, body: JSON.stringify({ ...created, workoutId: 1 }) }));
    expect(put.status).toBe(400);
    await h.client.updateWorkout(created.workoutId, { ...created, workoutName: 'renamed' });
    expect((await h.client.getWorkout(created.workoutId))?.workoutName).toBe('renamed');

    const sid = await h.client.scheduleWorkout(created.workoutId, '2026-11-24');
    expect(await h.client.getSchedule(sid)).toMatchObject({ calendarDate: '2026-11-24', workout: { workoutId: created.workoutId } });
    expect(await h.client.deleteWorkout(created.workoutId)).toBe(true);
    expect(h.mock.state.schedules.size).toBe(0);
    expect(await h.client.deleteWorkout(created.workoutId)).toBe(false); // idempotent
    expect(await h.client.unschedule(sid)).toBe(false);
  });

  it('device messages must be an array (bare object → 500)', async () => {
    const h = harness({ di: true });
    const di = h.store.current!.di!.di_token;
    const r = await h.mock.fetch(req('https://connectapi.garmin.com/device-service/devicemessage/messages', { method: 'POST', headers: { Authorization: `Bearer ${di}` }, body: '{"deviceId":1}' }));
    expect(r.status).toBe(500);
  });

  it('calendar shows scheduled workouts with the 0-based month', async () => {
    const h = harness({ di: true });
    await pushPlannedWorkout(h.client, planned({ sport: 'bike', title: 'Spin', date: '2026-12-02', plannedDurationSec: 3600 }), {}, undefined);
    const dec = await h.client.getCalendarMonth(2026, 12);
    expect(dec.calendarItems).toEqual([expect.objectContaining({ itemType: 'workout', date: '2026-12-02', title: 'Spin', sportTypeKey: 'cycling' })]);
    expect((dec.raw as { month: number }).month).toBe(11);
  });

  it('workout types dictionary feeds the encoder (stroke ids, fixed.rest)', async () => {
    const h = harness({ di: true });
    const types = await h.client.getWorkoutTypes();
    expect(types).toHaveProperty('workoutStrokeTypes');
    await h.client.getWorkoutTypes();
    expect(h.mock.state.requests.filter((r) => r.path === '/workout-service/workout/types')).toHaveLength(1); // cached
    const link = await pushPlannedWorkout(
      h.client,
      planned({ sport: 'swim', title: 'Send-offs' }, [step({ role: 'active', measure: { type: 'distance', m: 100 }, swim: { stroke: 'free', sendOffSec: 100 } })], 25),
      { swimCssMps: 1.25 },
      undefined,
    );
    const w = h.mock.state.workouts.get(Number(link.workoutId))!;
    const steps = (w.workoutSegments as { workoutSteps: { endCondition: { conditionTypeKey: string } }[] }[])[0]!.workoutSteps;
    expect(steps[1]!.endCondition.conditionTypeKey).toBe('fixed.rest');
  });
});

describe('control + failure injection', () => {
  it('POST /__mock/scenario switches scenarios; GET /__mock/state summarises', async () => {
    const h = harness({ personal: true });
    await h.client.listActivities({ limit: 1 });
    const set = await h.mock.fetch(req('https://connectapi.garmin.com/__mock/scenario', { method: 'POST', body: JSON.stringify({ scenario: 'rate_limited' }) }));
    expect(set.status).toBe(200);
    await expect(h.client.listActivities({ limit: 1 })).rejects.toMatchObject({ name: 'GarminRateLimitError' });
    await h.mock.fetch(req('https://garmin.mock/__garmin/__mock/scenario', { method: 'POST', body: JSON.stringify({ scenario: 'ok' }) }));
    await expect(h.client.listActivities({ limit: 1 })).resolves.toHaveLength(1);
    const st = await (await h.mock.fetch(req('https://connectapi.garmin.com/__mock/state'))).json();
    expect(st).toMatchObject({ visibleActivities: 7, workouts: [], schedules: [] });
  });

  it('unknown hosts are reported, not silently served', async () => {
    const h = harness({});
    expect((await h.mock.fetch(req('https://example.com/x'))).status).toBe(502);
  });

  it('only activities with startedAt ≤ now are exposed', async () => {
    const h = harness({ personal: true });
    expect(h.mock.visibleActivities()).toHaveLength(7);
    await expect(h.client.getActivity(21_000_000_008)).rejects.toMatchObject({ status: 404 });
    h.clk.set('2026-11-21T09:00:00Z');
    expect(h.mock.visibleActivities()).toHaveLength(8);
    await expect(h.client.getActivity(21_000_000_008)).resolves.toMatchObject({ activityName: 'Zwift recovery' });
  });

  it('latency option delays responses', async () => {
    const clk = clock();
    const mock = createGarminMock({ athlete: makeAthlete(), synth: fakeSynth, now: clk.now, latencyMs: 20 });
    const t0 = performance.now();
    await mock.fetch(req('https://connectapi.garmin.com/__mock/state'));
    expect(performance.now() - t0).toBeGreaterThanOrEqual(15);
  });
});
