import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GarminAuthError,
  GarminBlockedError,
  GarminClient,
  GarminNotFoundError,
  GarminRateLimitError,
  isFitBytes,
  memoryTokenStore,
} from '../src';
import { createGarminMock } from '../src/mock';
import { fakeSynth, makeAthlete } from './helpers/fake-athlete';
import { clock, harness } from './helpers/setup';

afterEach(() => {
  vi.useRealTimers();
});

describe('capabilities', () => {
  it('depends on which credentials exist', async () => {
    expect(await harness({ personal: true }).client.capabilities()).toEqual({ read: true, write: false, personal: true, di: false });
    expect(await harness({ di: true }).client.capabilities()).toEqual({ read: true, write: true, personal: false, di: true });
    expect(await harness({}).client.capabilities()).toEqual({ read: false, write: false, personal: false, di: false });
  });
});

describe('activities', () => {
  it('lists newest first with offset pagination on the Personal API; only startedAt ≤ now', async () => {
    const h = harness({ personal: true });
    const p1 = await h.client.listActivities({ start: 0, limit: 3 });
    const p2 = await h.client.listActivities({ start: 3, limit: 3 });
    const p3 = await h.client.listActivities({ start: 6, limit: 3 });
    const p4 = await h.client.listActivities({ start: 9, limit: 3 });
    const ids = [...p1, ...p2, ...p3].map((a) => a.activityId);
    expect(ids).toEqual([21_000_000_007, 21_000_000_006, 21_000_000_005, 21_000_000_004, 21_000_000_003, 21_000_000_002, 21_000_000_001]);
    expect(p4).toEqual([]);
    expect(h.mock.state.requests.every((r) => r.api === 'personal')).toBe(true);
    h.clk.set('2026-11-21T09:30:00Z');
    expect((await h.client.listActivities({ limit: 1 }))[0]!.activityId).toBe(21_000_000_008);
  });

  it('filters by date range', async () => {
    const h = harness({ personal: true });
    const r = await h.client.listActivities({ startDate: '2026-11-14', endDate: '2026-11-15' });
    expect(r.map((a) => a.activityId)).toEqual([21_000_000_004, 21_000_000_003]);
  });

  it('getActivity 404 → GarminNotFoundError (deleted activity)', async () => {
    const h = harness({ personal: true });
    h.mock.deleteActivity(21_000_000_002);
    await expect(h.client.getActivity(21_000_000_002)).rejects.toBeInstanceOf(GarminNotFoundError);
    const d = await h.client.getActivity(21_000_000_001);
    expect((d.summaryDTO as Record<string, unknown>).startTimeGMT).toBe('2026-11-12T06:30:00.0');
  });

  it('downloads the original file and unzips the FIT', async () => {
    const h = harness({ personal: true });
    const fit = await h.client.downloadOriginalFit(21_000_000_001);
    expect(isFitBytes(fit)).toBe(true);
    const req = h.mock.state.requests.find((r) => r.path.startsWith('/download-service'));
    expect(req?.api).toBe('personal');
  });

  it('connect-only extras return undefined without a DI token, data with one', async () => {
    const personalOnly = harness({ personal: true });
    expect(await personalOnly.client.getActivityDetails(21_000_000_002)).toBeUndefined();
    expect(await personalOnly.client.getTrainingReadiness('2026-11-20')).toBeUndefined();
    const both = harness({ personal: true, di: true });
    const details = await both.client.getActivityDetails(21_000_000_002, { maxChartSize: 50 });
    expect(details?.metricDescriptors).toBeTruthy();
    const sets = await both.client.getExerciseSets(21_000_000_004);
    expect((sets?.exerciseSets as unknown[]).length).toBe(3);
    const splits = await both.client.getSplits(21_000_000_002);
    expect((splits?.lapDTOs as unknown[]).length).toBe(2);
  });
});

describe('401 → refresh → retry once', () => {
  it('DI: a "Token is not active" 401 triggers one refresh and a successful retry', async () => {
    const h = harness({ di: true });
    h.mock.failures.unauthorized = { count: 1, api: 'connect' };
    const profile = await h.client.verifyDiToken();
    expect(profile.displayName).toBe('cadence-test');
    expect(h.mock.state.refreshCount).toBe(1);
    expect(h.mock.state.requests.map((r) => `${r.api} ${r.status}`)).toEqual(['connect 401', 'diauth 200', 'connect 200']);
  });

  it('a second 401 after refresh surfaces as GarminAuthError unauthorized', async () => {
    const h = harness({ di: true });
    h.mock.failures.unauthorized = { count: 2, api: 'connect' };
    await expect(h.client.verifyDiToken()).rejects.toMatchObject({ name: 'GarminAuthError', code: 'unauthorized' });
    expect(h.mock.state.refreshCount).toBe(1);
  });

  it('Personal: expired bearer → 401 → re-exchange → retry', async () => {
    const h = harness({ personal: true });
    await h.client.listActivities({ limit: 1 });
    h.mock.expireAccessTokens(); // server-side revocation, client still thinks it is valid
    await h.client.listActivities({ limit: 1 });
    expect(h.mock.state.personalExchangeCount).toBe(2);
  });

  it('serialises concurrent refreshes into one diauth call', async () => {
    const h = harness({ di: true });
    h.mock.expireAccessTokens();
    await Promise.all([h.client.getSplits(21_000_000_002), h.client.getSplits(21_000_000_001), h.client.verifyDiToken()]);
    expect(h.mock.state.refreshCount).toBe(1);
  });

  it('adopts a token rotated by another isolate instead of refreshing again', async () => {
    const clk = clock();
    const mock = createGarminMock({ athlete: makeAthlete(), synth: fakeSynth, now: clk.now });
    const store = memoryTokenStore({ di: mock.issueDiTokens() });
    const a = new GarminClient({ fetch: mock.fetch, tokens: store, now: clk.now });
    const b = new GarminClient({ fetch: mock.fetch, tokens: store, now: clk.now });
    await a.verifyDiToken();
    await b.verifyDiToken(); // b caches the original token
    mock.expireAccessTokens();
    await a.refreshDiNow(); // a rotates; old refresh token is now dead
    await b.getSplits(21_000_000_002); // b gets 401, re-reads the store, adopts a's token
    expect(mock.state.refreshCount).toBe(1);
  });
});

describe('429 backoff', () => {
  it('honours Retry-After with real (fake-timer) sleeps, then succeeds', async () => {
    vi.useFakeTimers();
    const clk = clock();
    const mock = createGarminMock({ athlete: makeAthlete(), synth: fakeSynth, now: clk.now });
    const client = new GarminClient({ fetch: mock.fetch, tokens: memoryTokenStore({ personal: { apiKey: 'good-key' } }), now: clk.now });
    await client.listActivities({ limit: 1 }); // token exchange first
    mock.failures.rateLimit = { count: 2, retryAfterSec: 3, api: 'personal' };
    let settled = false;
    const p = client.listActivities({ limit: 2 }).then((r) => {
      settled = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(2_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(3_001); // second 3 s wait
    const items = await p;
    expect(items).toHaveLength(2);
    expect(mock.state.requests.filter((r) => r.status === 429)).toHaveLength(2);
  });

  it('exponential backoff with jitter when no Retry-After; gives up with GarminRateLimitError', async () => {
    const h = harness({ personal: true });
    await h.client.listActivities({ limit: 1 });
    h.mock.failures.rateLimit = { count: 10, api: 'personal' };
    const err = await h.client.listActivities({ limit: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(GarminRateLimitError);
    expect(h.sleeps).toEqual([1000, 2000]); // random pinned at 0.5 → no jitter offset
    expect((err as GarminRateLimitError).retryAfterMs).toBe(4000);
  });

  it('does not wait out a Retry-After above maxDelayMs', async () => {
    const h = harness({ personal: true });
    await h.client.listActivities({ limit: 1 });
    h.mock.setScenario('rate_limited'); // Retry-After: 3600
    const err = await h.client.listActivities({ limit: 1 }).catch((e) => e);
    expect(err).toMatchObject({ name: 'GarminRateLimitError', retryAfterMs: 3_600_000 });
    expect(h.sleeps).toEqual([]);
  });

  it('retries 5xx for GETs but never for POST createWorkout', async () => {
    const h = harness({ di: true });
    await h.client.verifyDiToken();
    h.mock.failures.serverError = { count: 1, api: 'connect' };
    await h.client.getSplits(21_000_000_002);
    expect(h.sleeps).toEqual([1000]);
    h.mock.failures.serverError = { count: 1, api: 'connect' };
    await expect(
      h.client.createWorkout({ workoutName: 'x', sportType: { sportTypeId: 1, sportTypeKey: 'running' }, workoutSegments: [] }),
    ).rejects.toMatchObject({ status: 500 });
  });
});

describe('blocking and capability errors', () => {
  it('Cloudflare HTML → GarminBlockedError', async () => {
    const h = harness({ di: true });
    h.mock.setScenario('blocked');
    await expect(h.client.verifyDiToken()).rejects.toBeInstanceOf(GarminBlockedError);
  });

  it('writes without DI credentials → GarminAuthError no_credentials', async () => {
    const h = harness({ personal: true });
    await expect(h.client.scheduleWorkout(1, '2026-11-24')).rejects.toBeInstanceOf(GarminAuthError);
    await expect(h.client.deleteWorkout(1)).rejects.toMatchObject({ code: 'no_credentials' });
  });

  it('wrong API key surfaces personal_key_invalid', async () => {
    const clk = clock();
    const mock = createGarminMock({ athlete: makeAthlete(), synth: fakeSynth, now: clk.now, apiKey: 'other' });
    const c = new GarminClient({ fetch: mock.fetch, tokens: memoryTokenStore({ personal: { apiKey: 'good-key' } }), now: clk.now });
    await expect(c.listActivities()).rejects.toMatchObject({ code: 'personal_key_invalid' });
  });
});

describe('wellness getters (tolerant)', () => {
  it('Personal API: whitelisted paths answer, others → undefined', async () => {
    const h = harness({ personal: true });
    expect(await h.client.getHrv('2026-11-20')).toMatchObject({ hrvSummary: { lastNightAvg: 58 } });
    expect(await h.client.getSleep('2026-11-20')).toMatchObject({ dailySleepDTO: { calendarDate: '2026-11-20' } });
    expect(await h.client.getRestingHr('2026-11-19', '2026-11-20')).toBeUndefined();
    expect(await h.client.getTrainingStatus('2026-11-20')).toBeUndefined();
    expect(await h.client.getHrv('2026-10-01')).toBeUndefined(); // 204 no data
  });

  it('falls back to connectapi when the Personal API lacks the path', async () => {
    const h = harness({ personal: true, di: true });
    const rhr = await h.client.getRestingHr('2026-11-19', '2026-11-20');
    expect(rhr).toMatchObject({ allMetrics: { metricsMap: { WELLNESS_RESTING_HEART_RATE: [{ calendarDate: '2026-11-19' }, { calendarDate: '2026-11-20' }] } } });
    expect(await h.client.getDailySummary('2026-11-20')).toBeTruthy();
  });

  it('user settings combine HR zones, LTHR, run LT speed (×10 unit fix), weight (g→kg) and FTP', async () => {
    const h = harness({ personal: true, di: true });
    const s = await h.client.getUserSettings();
    expect(s).toMatchObject({ lthr: 172, hrMax: 188, hrRest: 46, ftp: 260, runThresholdMps: 4, weightKg: 72.4 });
    expect(s.hrZones?.[0]?.floors).toHaveLength(5);
    const p = await harness({ personal: true }).client.getUserSettings();
    expect(p.ftp).toBeUndefined(); // FTP is not on the Personal API
    expect(p.lthr).toBe(172); // from HR zones
  });
});

describe('workouts + calendar', () => {
  it('calendar month: 1-based in the API, 0-based on the wire', async () => {
    const h = harness({ di: true });
    const cal = await h.client.getCalendarMonth(2026, 11);
    expect(h.mock.state.requests.at(-1)?.path).toBe('/calendar-service/year/2026/month/10');
    expect(cal.calendarItems.filter((i) => i.itemType === 'activity')).toHaveLength(7);
    await expect(h.client.getCalendarMonth(2026, 0)).rejects.toThrow(RangeError);
  });

  it('device message body must be an array (client sends one)', async () => {
    const h = harness({ di: true });
    await h.client.sendWorkoutToDevice(3_600_000_001, 1, 'x');
    expect(h.mock.state.deviceMessages).toHaveLength(1);
  });
});
