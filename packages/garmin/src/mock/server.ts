/**
 * Offline fake Garmin: one `fetch(Request) → Response` handler for all hosts
 * (personal API, connectapi, diauth, sso). Usable as the `fetch` given to
 * GarminClient, as Miniflare `outboundService`, or mounted inside the app Worker
 * under a path prefix (`/__garmin/<personal|connect|diauth|sso>/...`) for DEMO mode.
 */
import { zipSync } from 'fflate';
import type { DiCredentials, GarminBaseUrls } from '../auth';
import { DI_CLIENT_IDS, PERSONAL_TOKEN_PATH, DI_TOKEN_PATH } from '../auth';
import type { SynthActivity, SynthActivityDetail, SynthApi, SynthAthlete } from '../synth/types';
import { base64UrlEncodeString, formatGarminDetailTime, isObject, type JsonObject } from '../util';
import {
  MOCK_ACTIVITY_TYPES,
  MOCK_DEVICE_ID,
  MOCK_PROFILE_ID,
  activityDetail,
  activityDetailsJson,
  activityListItem,
  bodyBatteryReport,
  dailySleep,
  dailySummary,
  exerciseSetsJson,
  hrZones,
  hrvSummary,
  readinessSnapshots,
  sleepDto,
  splitsJson,
  userSettings,
  type ActivityEdits,
} from './wire';

export type MockApi = 'personal' | 'connect' | 'diauth' | 'sso';

export interface MockFailures {
  /** The next `count` requests (optionally only to `api`) answer 429. */
  rateLimit?: { count: number; retryAfterSec?: number; api?: MockApi };
  /** Answer a 403 Cloudflare challenge page (HTML) on this API. */
  blocked?: MockApi | 'all';
  /** diauth refresh → 400 {"error":"invalid_grant"}. */
  refreshInvalid?: boolean;
  /** The next `count` authenticated data calls answer 401 even with a valid token ("Token is not active"). */
  unauthorized?: { count: number; api?: MockApi };
  /** The next `count` requests answer 500. */
  serverError?: { count: number; api?: MockApi };
  /** Personal API exchange answers 401 (key expired/revoked). */
  personalKeyRevoked?: boolean;
}

export interface GarminMockOptions {
  athlete: SynthAthlete;
  synth: Pick<SynthApi, 'generateActivityDetail' | 'encodeFit'>;
  now?: () => Date;
  /** Accepted Personal API key (default 'good-key'). */
  apiKey?: string;
  latencyMs?: number;
  failures?: MockFailures;
  personalTokenTtlSec?: number;
  diAccessTtlSec?: number;
  /** Credentials for the SSO mock (experimental login flow). */
  sso?: { username: string; password: string; mfaCode?: string };
  /** Path prefix for mounted mode (default '/__garmin'). */
  mountPrefix?: string;
}

export interface MockRequestLog {
  method: string;
  api: MockApi;
  path: string;
  search: string;
  status: number;
}

export interface MockSchedule {
  workoutScheduleId: number;
  workoutId: number;
  calendarDate: string;
  createdDate: string;
}

export interface GarminMockState {
  requests: MockRequestLog[];
  workouts: Map<number, JsonObject>;
  schedules: Map<number, MockSchedule>;
  deviceMessages: unknown[];
  personalTokens: Map<string, number>;
  diAccessTokens: Map<string, number>;
  diRefreshTokens: Set<string>;
  deletedActivityIds: Set<number>;
  edits: Map<number, ActivityEdits>;
  refreshCount: number;
  personalExchangeCount: number;
}

export interface GarminMock {
  fetch(request: Request): Promise<Response>;
  state: GarminMockState;
  failures: MockFailures;
  /** Mint a DI token set as python-garminconnect would write to garmin_tokens.json. */
  issueDiTokens(): DiCredentials;
  /** Expire every issued access token (refresh tokens stay valid). */
  expireAccessTokens(): void;
  /** Simulate a user edit in Garmin Connect (bumps metadataDTO.lastUpdateDate). */
  editActivity(id: number, edits: Omit<ActivityEdits, 'lastUpdateMs'>): void;
  deleteActivity(id: number): void;
  /** Activities currently visible (startedAt ≤ now, not deleted), newest first. */
  visibleActivities(): SynthActivity[];
  /** Switch a named scenario from garmin.md §9 (also reachable via POST /__mock/scenario). */
  setScenario(name: MockScenario): void;
}

export type MockScenario = 'ok' | 'expired_token' | 'rate_limited' | 'sso_blocked' | 'refresh_invalid' | 'blocked';

const HOSTS: Record<string, MockApi> = {
  'personal.connectapi.garmin.com': 'personal',
  'connectapi.garmin.com': 'connect',
  'diauth.garmin.com': 'diauth',
  'sso.garmin.com': 'sso',
  'personal.connectapi.garmin.cn': 'personal',
  'connectapi.garmin.cn': 'connect',
  'diauth.garmin.cn': 'diauth',
  'sso.garmin.cn': 'sso',
};

/** Base URLs that route to a mounted mock: `${origin}${prefix}/<api>`. */
export function mockBaseUrls(origin = 'https://garmin.mock', prefix = '/__garmin'): GarminBaseUrls {
  const o = origin.replace(/\/$/, '');
  return { personal: `${o}${prefix}/personal`, connect: `${o}${prefix}/connect`, diauth: `${o}${prefix}/diauth`, sso: `${o}${prefix}/sso` };
}

const CLOUDFLARE_HTML =
  '<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title></head><body>Attention Required! | Cloudflare</body></html>';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json;charset=UTF-8', ...headers } });
const empty = (status = 204) => new Response(null, { status });
const notFound = () => json({ message: 'Not Found', error: 'NotFoundException' }, 404);

/** Personal API exposes only these GET paths (garmin.md §1). */
const PERSONAL_PATHS: RegExp[] = [
  /^\/activitylist-service\/activities\/search\/activities$/,
  /^\/activity-service\/activity\/\d+$/,
  /^\/activity-service\/activity\/\d+\/workouts$/,
  /^\/download-service\/files\/activity\/\d+$/,
  /^\/activity-service\/activity\/activityTypes\/simple$/,
  /^\/usersummary-service\/v2\/dailysummaries$/,
  /^\/usersummary-service\/stats\/(stress|steps|hydration)\/daily\/[\d-]+\/[\d-]+$/,
  /^\/sleep-service\/sleep\/dailySleep$/,
  /^\/sleep-service\/sleep\/dailySleepSummariesByDate$/,
  /^\/wellness-service\/wellness\/bodyBattery\/reports\/daily$/,
  /^\/wellness-service\/wellness\/dailyHeartRate$/,
  /^\/hrv-service\/hrv\/[\d-]+$/,
  /^\/hrv-service\/hrv\/daily\/[\d-]+\/[\d-]+$/,
  /^\/metrics-service\/metrics\/maxmet\/daily\/[\d-]+\/[\d-]+$/,
  /^\/biometric-service\/heartRateZones\/v2$/,
  /^\/weight-service\/weight\/range\/[\d-]+\/[\d-]+$/,
  /^\/userprofile-service\/userprofile\/settings$/,
];

/** Paths that exist only on the Personal API host. */
const PERSONAL_ONLY = [/^\/sleep-service\/sleep\/dailySleep$/, /^\/sleep-service\/sleep\/dailySleepSummariesByDate$/, /^\/userprofile-service\/userprofile\/settings$/];

const VALID_SPORT_IDS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
const VALID_STEP_IDS = new Set([1, 2, 3, 4, 5, 6, 7, 8]);
const VALID_COND_IDS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
const VALID_TARGET_IDS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 15, 17]);

const WORKOUT_TYPES = {
  workoutSportTypes: [
    ['running', 1], ['cycling', 2], ['other', 3], ['swimming', 4], ['strength_training', 5], ['cardio_training', 6],
    ['yoga', 7], ['pilates', 8], ['hiit', 9], ['multi_sport', 10], ['mobility', 11],
  ].map(([k, id]) => ({ sportTypeId: id, sportTypeKey: k, displayOrder: id })),
  workoutStepTypes: ['warmup', 'cooldown', 'interval', 'recovery', 'rest', 'repeat', 'other', 'main'].map((k, i) => ({
    stepTypeId: i + 1, stepTypeKey: k, displayOrder: i + 1,
  })),
  workoutConditionTypes: ['lap.button', 'time', 'distance', 'calories', 'power', 'heart.rate', 'iterations', 'fixed.rest', 'fixed.repetition', 'reps'].map(
    (k, i) => ({ conditionTypeId: i + 1, conditionTypeKey: k, displayOrder: i + 1, displayable: k !== 'iterations' }),
  ),
  workoutTargetTypes: [
    ['no.target', 1], ['power.zone', 2], ['cadence', 3], ['heart.rate.zone', 4], ['speed.zone', 5], ['pace.zone', 6],
    ['grade', 7], ['heart.rate.lap', 8], ['power.lap', 9], ['resistance', 15], ['swim.css.offset', 17],
  ].map(([k, id]) => ({ workoutTargetTypeId: id, workoutTargetTypeKey: k, displayOrder: id })),
  workoutStrokeTypes: [{ strokeTypeId: 0, strokeTypeKey: null }, ...['any_stroke', 'backstroke', 'breaststroke', 'drill', 'fly', 'free', 'individual_medley', 'mixed'].map((k, i) => ({ strokeTypeId: i + 1, strokeTypeKey: k }))],
  workoutEquipmentTypes: [{ equipmentTypeId: 0, equipmentTypeKey: null }, ...['fins', 'kickboard', 'paddles', 'pull_buoy', 'snorkel'].map((k, i) => ({ equipmentTypeId: i + 1, equipmentTypeKey: k }))],
};

function makeJwt(payload: Record<string, unknown>): string {
  return `${base64UrlEncodeString(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'mock' }))}.${base64UrlEncodeString(JSON.stringify(payload))}.bW9jay1zaWduYXR1cmU`;
}

function addDaysStr(d: string, n: number): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

function dateRange(a: string, b: string): string[] {
  const out: string[] = [];
  for (let d = a; d <= b && out.length < 400; d = addDaysStr(d, 1)) out.push(d);
  return out;
}

export function createGarminMock(opts: GarminMockOptions): GarminMock {
  const athlete = opts.athlete;
  const now = opts.now ?? (() => new Date());
  const apiKey = opts.apiKey ?? 'good-key';
  const prefix = opts.mountPrefix ?? '/__garmin';
  const tz = athlete.profile.timezone;
  const tzOff = athlete.profile.utcOffsetMin;
  const displayName = athlete.profile.displayName;
  const failures: MockFailures = { ...opts.failures };
  const wellnessByDate = new Map(athlete.wellness.map((w) => [w.date, w]));
  const byId = new Map(athlete.activities.map((a) => [a.garminActivityId, a]));
  const detailCache = new Map<number, SynthActivityDetail>();
  const fitCache = new Map<number, Uint8Array>();
  let counter = 0;
  let nextWorkoutId = 1_000_000_001;
  let nextScheduleId = 500_000_001;
  let nextStepId = 9_000_000_001;

  const state: GarminMockState = {
    requests: [],
    workouts: new Map(),
    schedules: new Map(),
    deviceMessages: [],
    personalTokens: new Map(),
    diAccessTokens: new Map(),
    diRefreshTokens: new Set(),
    deletedActivityIds: new Set(),
    edits: new Map(),
    refreshCount: 0,
    personalExchangeCount: 0,
  };
  const ssoSessions = new Set<string>();
  const ssoTickets = new Set<string>();
  const mfaPending = new Set<string>();

  const nowMs = () => now().getTime();

  function detailFor(id: number): SynthActivityDetail {
    let d = detailCache.get(id);
    if (!d) {
      d = opts.synth.generateActivityDetail(athlete, id);
      detailCache.set(id, d);
      if (detailCache.size > 8) detailCache.delete(detailCache.keys().next().value!);
    }
    return d;
  }

  function visibleActivities(): SynthActivity[] {
    const t = nowMs();
    return athlete.activities
      .filter((a) => Date.parse(a.startedAt) <= t && !state.deletedActivityIds.has(a.garminActivityId))
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || b.garminActivityId - a.garminActivityId);
  }

  function visibleActivity(id: number): SynthActivity | undefined {
    const a = byId.get(id);
    if (!a || state.deletedActivityIds.has(id) || Date.parse(a.startedAt) > nowMs()) return undefined;
    return a;
  }

  function issueDi(clientId: string = DI_CLIENT_IDS[0]): { access: string; refresh: string } {
    const n = ++counter;
    const exp = Math.floor(nowMs() / 1000) + (opts.diAccessTtlSec ?? 86_400);
    const access = makeJwt({ client_id: clientId, exp, iat: Math.floor(nowMs() / 1000), jti: `di-${n}`, scope: ['CONNECT_READ', 'CONNECT_WRITE'] });
    const refresh = `mock-refresh-${n}-${Math.random().toString(36).slice(2, 10)}`;
    state.diAccessTokens.set(access, exp * 1000);
    state.diRefreshTokens.add(refresh);
    return { access, refresh };
  }

  // ───────────────────────────── failure injection ─────────────────────────────

  function injected(api: MockApi): Response | undefined {
    const rl = failures.rateLimit;
    if (rl && rl.count > 0 && (!rl.api || rl.api === api)) {
      rl.count--;
      return json(
        { message: 'Too Many Requests' },
        429,
        rl.retryAfterSec !== undefined ? { 'Retry-After': String(rl.retryAfterSec) } : {},
      );
    }
    if (failures.blocked && (failures.blocked === 'all' || failures.blocked === api)) {
      return new Response(CLOUDFLARE_HTML, { status: 403, headers: { 'Content-Type': 'text/html' } });
    }
    const se = failures.serverError;
    if (se && se.count > 0 && (!se.api || se.api === api)) {
      se.count--;
      return json({ message: 'Internal Server Error' }, 500);
    }
    return undefined;
  }

  function checkBearer(req: Request, api: 'personal' | 'connect'): Response | undefined {
    const ua = failures.unauthorized;
    if (ua && ua.count > 0 && (!ua.api || ua.api === api)) {
      ua.count--;
      return json({ message: 'Token is not active' }, 401);
    }
    const h = req.headers.get('authorization') ?? '';
    const m = /^Bearer (.+)$/.exec(h);
    if (!m) return json({ message: 'Unauthorized' }, 401);
    const exp = (api === 'personal' ? state.personalTokens : state.diAccessTokens).get(m[1]!);
    if (exp === undefined || exp <= nowMs()) return json({ message: 'Unauthorized' }, 401);
    if (api === 'connect' && req.headers.get('cookie')) return json({ message: 'cookies not accepted' }, 400);
    return undefined;
  }

  // ───────────────────────────── handlers ─────────────────────────────

  async function handleDiauth(req: Request, path: string): Promise<Response> {
    if (req.method !== 'POST' || path !== DI_TOKEN_PATH) return notFound();
    const form = new URLSearchParams(await req.text());
    const clientId = form.get('client_id') ?? '';
    const basic = req.headers.get('authorization') ?? '';
    if (basic !== `Basic ${btoa(`${clientId}:`)}`) return json({ error: 'invalid_client' }, 401);
    const grant = form.get('grant_type');
    if (grant === 'refresh_token') {
      const rt = form.get('refresh_token') ?? '';
      if (failures.refreshInvalid || !state.diRefreshTokens.has(rt)) return json({ error: 'invalid_grant' }, 400);
      state.diRefreshTokens.delete(rt); // rotation: the old refresh token dies
      state.refreshCount++;
      const t = issueDi(clientId);
      return json({ access_token: t.access, refresh_token: t.refresh, token_type: 'Bearer', expires_in: opts.diAccessTtlSec ?? 86_400 });
    }
    if (grant?.endsWith('/grant/service_ticket')) {
      const ticket = form.get('service_ticket') ?? '';
      if (clientId !== DI_CLIENT_IDS[0]) return json({ error: 'unauthorized_client' }, 400);
      if (!ssoTickets.delete(ticket)) return json({ error: 'invalid_grant' }, 400);
      const t = issueDi(clientId);
      return json({ access_token: t.access, refresh_token: t.refresh, token_type: 'Bearer', expires_in: opts.diAccessTtlSec ?? 86_400 });
    }
    return json({ error: 'unsupported_grant_type' }, 400);
  }

  async function handleSso(req: Request, path: string): Promise<Response> {
    const cookies = Object.fromEntries(
      (req.headers.get('cookie') ?? '')
        .split(';')
        .map((c) => c.trim().split('='))
        .filter((p) => p.length === 2) as [string, string][],
    );
    if (req.method === 'GET' && path === '/mobile/sso/en_US/sign-in') {
      const session = `sess-${++counter}`;
      ssoSessions.add(session);
      const h = new Headers({ 'Content-Type': 'text/html' });
      h.append('Set-Cookie', `SESSION=${session}; Path=/; Secure; HttpOnly`);
      h.append('Set-Cookie', '__cf_bm=mockbm; Path=/; Secure; HttpOnly');
      return new Response('<html><body>sign in</body></html>', { status: 200, headers: h });
    }
    const session = cookies.SESSION;
    if (req.method === 'POST' && (path === '/mobile/api/login' || path === '/mobile/api/mfa/verifyCode')) {
      if (!session || !ssoSessions.has(session)) return json({ error: { 'status-code': '429' } }, 429);
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const cfg = opts.sso;
      const ticket = () => {
        const t = `ST-${++counter}-mock-sso`;
        ssoTickets.add(t);
        return json({ serviceTicketId: t, responseStatus: { type: 'SUCCESSFUL' }, customerMfaInfo: null });
      };
      if (path === '/mobile/api/login') {
        if (!cfg || body.username !== cfg.username || body.password !== cfg.password) {
          return json({ serviceTicketId: null, responseStatus: { type: 'INVALID_USERNAME_PASSWORD' } });
        }
        if (cfg.mfaCode) {
          mfaPending.add(session);
          return json({ serviceTicketId: null, responseStatus: { type: 'MFA_REQUIRED' }, customerMfaInfo: { mfaLastMethodUsed: 'email' } });
        }
        return ticket();
      }
      if (!mfaPending.has(session) || body.mfaVerificationCode !== cfg?.mfaCode) {
        return json({ serviceTicketId: null, responseStatus: { type: 'INVALID_MFA_CODE' } });
      }
      mfaPending.delete(session);
      return ticket();
    }
    return notFound();
  }

  function listActivities(url: URL): Response {
    const start = Math.max(0, Number(url.searchParams.get('start') ?? 0) || 0);
    const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit') ?? 20) || 20));
    const sd = url.searchParams.get('startDate');
    const ed = url.searchParams.get('endDate');
    const type = url.searchParams.get('activityType');
    let list = visibleActivities();
    if (sd) list = list.filter((a) => a.localDate >= sd);
    if (ed) list = list.filter((a) => a.localDate <= ed);
    if (type) {
      list = list.filter((a) => {
        if (a.garminTypeKey === type) return true;
        const parentId = MOCK_ACTIVITY_TYPES[a.garminTypeKey]?.[1];
        return parentId !== undefined && MOCK_ACTIVITY_TYPES[type]?.[0] === parentId;
      });
    }
    return json(list.slice(start, start + limit).map((a) => activityListItem(a, state.edits.get(a.garminActivityId))));
  }

  function wellnessIn(s: string, e: string) {
    return dateRange(s, e)
      .map((d) => wellnessByDate.get(d))
      .filter((w): w is NonNullable<typeof w> => !!w && w.date <= athlete.today && Date.parse(`${w.date}T00:00:00Z`) <= nowMs());
  }

  function workoutSummary(w: JsonObject): JsonObject {
    const { workoutSegments: _segments, ...rest } = w;
    return rest;
  }

  function validateWorkout(body: unknown): string | undefined {
    if (!isObject(body)) return 'body must be an object';
    if (typeof body.workoutName !== 'string' || !body.workoutName.trim()) return 'workoutName required';
    const sid = isObject(body.sportType) ? body.sportType.sportTypeId : undefined;
    if (typeof sid !== 'number' || !VALID_SPORT_IDS.has(sid)) return 'invalid sportType.sportTypeId';
    if (!Array.isArray(body.workoutSegments) || !body.workoutSegments.length) return 'workoutSegments required';
    const orders = new Set<number>();
    const walk = (steps: unknown): string | undefined => {
      if (!Array.isArray(steps) || !steps.length) return 'workoutSteps required';
      for (const s of steps) {
        if (!isObject(s)) return 'step must be an object';
        if (s.type !== 'ExecutableStepDTO' && s.type !== 'RepeatGroupDTO') return `invalid step type ${String(s.type)}`;
        if (typeof s.stepOrder !== 'number' || s.stepOrder < 1 || orders.has(s.stepOrder)) return `invalid/duplicate stepOrder ${String(s.stepOrder)}`;
        orders.add(s.stepOrder);
        const st = isObject(s.stepType) ? s.stepType.stepTypeId : undefined;
        if (typeof st !== 'number' || !VALID_STEP_IDS.has(st)) return 'invalid stepType';
        const ec = isObject(s.endCondition) ? s.endCondition.conditionTypeId : undefined;
        if (typeof ec !== 'number' || !VALID_COND_IDS.has(ec)) return 'invalid endCondition';
        if (s.type === 'RepeatGroupDTO') {
          if (typeof s.numberOfIterations !== 'number' || s.numberOfIterations < 1) return 'numberOfIterations required';
          const err = walk(s.workoutSteps);
          if (err) return err;
        } else {
          const tt = isObject(s.targetType) ? s.targetType.workoutTargetTypeId : undefined;
          if (typeof tt !== 'number' || !VALID_TARGET_IDS.has(tt)) return 'invalid targetType';
          if (isObject(s.secondaryTargetType)) {
            const st2 = s.secondaryTargetType.workoutTargetTypeId;
            if (typeof st2 !== 'number' || !VALID_TARGET_IDS.has(st2)) return 'invalid secondaryTargetType';
          }
        }
      }
      return undefined;
    };
    for (const seg of body.workoutSegments) {
      if (!isObject(seg)) return 'segment must be an object';
      const err = walk(seg.workoutSteps);
      if (err) return err;
    }
    return undefined;
  }

  function assignStepIds(steps: unknown): void {
    if (!Array.isArray(steps)) return;
    for (const s of steps) {
      if (!isObject(s)) continue;
      s.stepId = nextStepId++;
      assignStepIds(s.workoutSteps);
    }
  }

  function scheduleEntry(s: MockSchedule): JsonObject {
    const w = state.workouts.get(s.workoutId);
    return {
      workoutScheduleId: s.workoutScheduleId,
      workoutId: s.workoutId,
      calendarDate: s.calendarDate,
      createdDate: s.createdDate,
      ownerId: MOCK_PROFILE_ID,
      workout: w ? workoutSummary(w) : { workoutId: s.workoutId },
    };
  }

  async function handleConnectWrites(req: Request, path: string): Promise<Response | undefined> {
    const m = (re: RegExp) => re.exec(path);
    let r: RegExpExecArray | null;
    const stamp = () => formatGarminDetailTime(nowMs());
    if (req.method === 'POST' && path === '/workout-service/workout') {
      const body = await req.json().catch(() => undefined);
      const err = validateWorkout(body);
      if (err) return json({ message: err }, 400);
      const w = structuredClone(body) as JsonObject;
      w.workoutId = nextWorkoutId++;
      w.ownerId = MOCK_PROFILE_ID;
      w.createdDate = stamp();
      w.updatedDate = w.createdDate;
      for (const seg of w.workoutSegments as JsonObject[]) assignStepIds(seg.workoutSteps);
      state.workouts.set(w.workoutId as number, w);
      return json(w);
    }
    if ((r = m(/^\/workout-service\/workout\/(\d+)$/))) {
      const id = Number(r[1]);
      const existing = state.workouts.get(id);
      if (req.method === 'GET') return existing ? json(existing) : notFound();
      if (req.method === 'PUT') {
        if (!existing) return notFound();
        const body = await req.json().catch(() => undefined);
        if (!isObject(body) || body.workoutId !== id) return json({ message: 'workoutId must match the path' }, 400);
        const err = validateWorkout(body);
        if (err) return json({ message: err }, 400);
        const w = structuredClone(body) as JsonObject;
        w.ownerId = MOCK_PROFILE_ID;
        w.createdDate = existing.createdDate;
        w.updatedDate = stamp();
        for (const seg of w.workoutSegments as JsonObject[]) assignStepIds(seg.workoutSteps);
        state.workouts.set(id, w);
        return empty(204);
      }
      if (req.method === 'DELETE') {
        if (!existing) return notFound();
        state.workouts.delete(id);
        for (const [sid, s] of state.schedules) if (s.workoutId === id) state.schedules.delete(sid); // cascade (UNVERIFIED)
        return empty(204);
      }
    }
    if (req.method === 'GET' && path === '/workout-service/workouts') {
      const url = new URL(req.url);
      const start = Number(url.searchParams.get('start') ?? 0) || 0;
      const limit = Number(url.searchParams.get('limit') ?? 100) || 100;
      const list = [...state.workouts.values()].sort((a, b) => String(b.updatedDate).localeCompare(String(a.updatedDate)) || Number(b.workoutId) - Number(a.workoutId));
      return json(list.slice(start, start + limit).map(workoutSummary));
    }
    if (req.method === 'GET' && path === '/workout-service/workout/types') return json(WORKOUT_TYPES);
    if (req.method === 'GET' && path === '/workout-service/schedule/workoutScheduleByPeriod') {
      const url = new URL(req.url);
      const s = url.searchParams.get('startDate') ?? '0000-00-00';
      const e = url.searchParams.get('endDate') ?? '9999-99-99';
      return json([...state.schedules.values()].filter((x) => x.calendarDate >= s && x.calendarDate <= e).map(scheduleEntry));
    }
    if ((r = m(/^\/workout-service\/schedule\/(\d+)$/))) {
      const id = Number(r[1]);
      if (req.method === 'POST') {
        // POST uses the WORKOUT id in the path
        if (!state.workouts.has(id)) return notFound();
        const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
        if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) return json({ message: 'date required' }, 400);
        const s: MockSchedule = { workoutScheduleId: nextScheduleId++, workoutId: id, calendarDate: body.date, createdDate: stamp() };
        state.schedules.set(s.workoutScheduleId, s);
        return json(scheduleEntry(s));
      }
      const s = state.schedules.get(id);
      if (!s) return notFound();
      if (req.method === 'GET') return json(scheduleEntry(s));
      if (req.method === 'DELETE') {
        state.schedules.delete(id);
        return empty(204);
      }
      if (req.method === 'PUT') {
        const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
        if (typeof body.calendarDate === 'string') s.calendarDate = body.calendarDate;
        return json(scheduleEntry(s));
      }
    }
    if ((r = m(/^\/calendar-service\/year\/(\d{4})\/month\/(\d{1,2})$/)) && req.method === 'GET') {
      const year = Number(r[1]);
      const m0 = Number(r[2]);
      if (m0 < 0 || m0 > 11) return json({ message: 'month out of range' }, 400);
      const ym = `${year}-${String(m0 + 1).padStart(2, '0')}`;
      const items: JsonObject[] = [];
      for (const s of state.schedules.values()) {
        if (!s.calendarDate.startsWith(ym)) continue;
        const w = state.workouts.get(s.workoutId);
        items.push({
          id: s.workoutScheduleId,
          itemType: 'workout',
          date: s.calendarDate,
          title: w?.workoutName ?? null,
          workoutId: s.workoutId,
          sportTypeKey: isObject(w?.sportType) ? w.sportType.sportTypeKey : null,
        });
      }
      for (const a of visibleActivities()) {
        if (!a.localDate.startsWith(ym)) continue;
        items.push({ id: a.garminActivityId, itemType: 'activity', date: a.localDate, title: a.title, activityTypeId: MOCK_ACTIVITY_TYPES[a.garminTypeKey]?.[0] ?? 4, duration: a.durationSec, distance: a.distanceM ?? null });
      }
      items.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      return json({ startDayOfMonth: 0, numOfDaysInMonth: new Date(Date.UTC(year, m0 + 1, 0)).getUTCDate(), year, month: m0, calendarItems: items });
    }
    if (req.method === 'POST' && path === '/device-service/devicemessage/messages') {
      const body = await req.json().catch(() => undefined);
      if (!Array.isArray(body)) return json({ message: 'Internal Server Error' }, 500);
      state.deviceMessages.push(...body);
      return json(body.map((b, i) => ({ ...(b as JsonObject), messageId: 700_000 + state.deviceMessages.length + i, messageStatus: 'new' })));
    }
    return undefined;
  }

  function handleReads(req: Request, api: 'personal' | 'connect', path: string, url: URL): Response | undefined {
    if (req.method !== 'GET') return undefined;
    const q = (k: string) => url.searchParams.get(k);
    let r: RegExpExecArray | null;
    const m = (re: RegExp) => (r = re.exec(path));
    const p = athlete.profile;

    if (path === '/activitylist-service/activities/search/activities') return listActivities(url);
    if (path === '/activitylist-service/activities/count') return json({ totalCount: visibleActivities().length });
    if (path === '/activity-service/activity/activityTypes/simple' || path === '/activity-service/activity/activityTypes') {
      return json(Object.entries(MOCK_ACTIVITY_TYPES).map(([typeKey, [typeId, parentTypeId]]) => ({ typeId, typeKey, parentTypeId, isHidden: false, restricted: false, trimmable: true })));
    }
    if (m(/^\/activity-service\/activity\/(\d+)(\/[a-zA-Z_]+)?$/)) {
      const id = Number(r![1]);
      const sub = r![2];
      const a = visibleActivity(id);
      if (!a) return notFound();
      if (!sub) return json(activityDetail(a, tz, state.edits.get(id)));
      if (sub === '/workouts') return json([]);
      if (api !== 'connect') return undefined;
      if (sub === '/details') return json(activityDetailsJson(detailFor(id), Number(q('maxChartSize') ?? 2000) || 2000));
      if (sub === '/splits' || sub === '/laps') return json(splitsJson(detailFor(id)));
      if (sub === '/exerciseSets') {
        if (a.sport !== 'strength') return json({ activityId: id, exerciseSets: [] });
        return json(exerciseSetsJson(detailFor(id)));
      }
      if (sub === '/hrTimeInZones') return json([]);
      return undefined;
    }
    if (m(/^\/download-service\/files\/activity\/(\d+)$/)) {
      const id = Number(r![1]);
      if (!visibleActivity(id)) return notFound();
      let fit = fitCache.get(id);
      if (!fit) {
        fit = opts.synth.encodeFit(detailFor(id));
        fitCache.set(id, fit);
        if (fitCache.size > 4) fitCache.delete(fitCache.keys().next().value!);
      }
      const zip = zipSync({ [`${id}_ACTIVITY.fit`]: fit });
      return new Response(zip, { status: 200, headers: { 'Content-Type': 'application/x-zip-compressed', 'Content-Disposition': `attachment; filename="${id}.zip"` } });
    }
    // identity / settings
    if (path === '/userprofile-service/socialProfile') {
      return json({ id: MOCK_PROFILE_ID, profileId: MOCK_PROFILE_ID, garminGUID: 'mock-guid', displayName, fullName: p.fullName, userProfileFullName: p.fullName, location: null });
    }
    if (path === '/userprofile-service/userprofile/settings') {
      return json({ ...userSettings(p, latestVo2()), displayName, fullName: p.fullName, timeZone: tz, locale: 'en' });
    }
    if (path === '/userprofile-service/userprofile/user-settings') return json(userSettings(p, latestVo2()));
    if (path === '/biometric-service/heartRateZones/v2' || path === '/biometric-service/heartRateZones') return json(hrZones(p));
    if (path === '/biometric-service/biometric/latestFunctionalThresholdPower/CYCLING') {
      return json({ userProfilePK: MOCK_PROFILE_ID, functionalThresholdPower: p.ftp, sport: 'CYCLING', calendarDate: athlete.today, isStale: false });
    }
    if (path === '/wellness-service/wellness/syncTimestamp') {
      const last = visibleActivities()[0];
      const t = last ? Date.parse(last.startedAt) + last.durationSec * 1000 + 60_000 : nowMs();
      return json(formatGarminDetailTime(t));
    }
    // wellness
    if (path === '/sleep-service/sleep/dailySleep' || path === '/sleep-service/sleep/dailySleepData') {
      const d = q('date') ?? athlete.today;
      return json(dailySleep(wellnessIn(d, d)[0], d, tzOff));
    }
    if (path === '/sleep-service/sleep/dailySleepSummariesByDate') {
      return json(wellnessIn(q('startDate') ?? athlete.today, q('endDate') ?? athlete.today).filter((w) => w.sleepSec).map((w) => sleepDto(w, tzOff)));
    }
    if (m(/^\/sleep-service\/stats\/sleep\/daily\/([\d-]+)\/([\d-]+)$/)) {
      return json({
        overallStats: {},
        individualStats: wellnessIn(r![1]!, r![2]!).filter((w) => w.sleepSec).map((w) => ({
          calendarDate: w.date,
          values: { totalSleepTimeInSeconds: w.sleepSec, sleepScore: w.sleepScore ?? null, restingHeartRate: w.restingHr ?? null },
        })),
      });
    }
    if (m(/^\/hrv-service\/hrv\/daily\/([\d-]+)\/([\d-]+)$/)) {
      return json({ userProfilePk: MOCK_PROFILE_ID, hrvSummaries: wellnessIn(r![1]!, r![2]!).filter((w) => w.hrvMs !== undefined).map(hrvSummary) });
    }
    if (m(/^\/hrv-service\/hrv\/([\d-]+)$/)) {
      const w = wellnessIn(r![1]!, r![1]!)[0];
      if (!w || w.hrvMs === undefined) return empty(204);
      return json({ userProfilePk: MOCK_PROFILE_ID, hrvSummary: hrvSummary(w), hrvReadings: [{ hrvValue: w.hrvMs, readingTimeGMT: `${w.date}T04:00:00.0`, readingTimeLocal: `${w.date}T05:00:00.0` }] });
    }
    if (path === '/usersummary-service/v2/dailysummaries') {
      return json(wellnessIn(q('startDate') ?? athlete.today, q('endDate') ?? athlete.today).map((w) => dailySummary(w, displayName)));
    }
    if (m(/^\/usersummary-service\/usersummary\/daily\/([^/]+)$/)) {
      if (decodeURIComponent(r![1]!) !== displayName) return notFound();
      const d = q('calendarDate') ?? athlete.today;
      const w = wellnessIn(d, d)[0];
      return w ? json(dailySummary(w, displayName)) : json({ calendarDate: d, restingHeartRate: null });
    }
    if (m(/^\/usersummary-service\/stats\/stress\/daily\/([\d-]+)\/([\d-]+)$/)) {
      return json(wellnessIn(r![1]!, r![2]!).filter((w) => w.stress !== undefined).map((w) => ({ calendarDate: w.date, values: { overallStressLevel: w.stress, restStressDuration: 30_000, highStressDuration: 1200 } })));
    }
    if (m(/^\/usersummary-service\/stats\/(steps|hydration)\/daily\/([\d-]+)\/([\d-]+)$/)) return json([]);
    if (path === '/wellness-service/wellness/bodyBattery/reports/daily') {
      return json(wellnessIn(q('startDate') ?? athlete.today, q('endDate') ?? athlete.today).filter((w) => w.bodyBattery !== undefined).map((w) => bodyBatteryReport(w, tzOff)));
    }
    if (path === '/wellness-service/wellness/dailyHeartRate') {
      const d = q('date') ?? athlete.today;
      const w = wellnessIn(d, d)[0];
      return json({ userProfilePK: MOCK_PROFILE_ID, calendarDate: d, restingHeartRate: w?.restingHr ?? null, heartRateValues: [] });
    }
    if (m(/^\/weight-service\/weight\/range\/([\d-]+)\/([\d-]+)$/)) {
      const list = wellnessIn(r![1]!, r![2]!).filter((w) => w.weightKg !== undefined);
      return json({
        dailyWeightSummaries: list.map((w) => ({
          summaryDate: w.date,
          numOfWeightEntries: 1,
          latestWeight: { samplePk: Date.parse(w.date), date: Date.parse(`${w.date}T06:00:00Z`), calendarDate: w.date, weight: Math.round(w.weightKg! * 1000), bmi: null, sourceType: 'MANUAL' },
        })),
        totalAverage: { weight: list.length ? Math.round((list.reduce((a, w) => a + w.weightKg!, 0) / list.length) * 1000) : null },
      });
    }
    if (path === '/weight-service/weight/dateRange') {
      const list = wellnessIn(q('startDate') ?? athlete.today, q('endDate') ?? athlete.today).filter((w) => w.weightKg !== undefined);
      return json({ dateWeightList: list.map((w) => ({ samplePk: Date.parse(w.date), date: Date.parse(`${w.date}T06:00:00Z`), calendarDate: w.date, weight: Math.round(w.weightKg! * 1000), sourceType: 'MANUAL' })), totalAverage: {} });
    }
    if (m(/^\/metrics-service\/metrics\/maxmet\/daily\/([\d-]+)\/([\d-]+)$/)) {
      return json(wellnessIn(r![1]!, r![2]!).filter((w) => w.vo2max !== undefined).map((w) => ({ userId: MOCK_PROFILE_ID, generic: { calendarDate: w.date, vo2MaxPreciseValue: w.vo2max, vo2MaxValue: Math.round(w.vo2max!), fitnessAge: null }, cycling: null, heatAltitudeAcclimation: null })));
    }
    if (api !== 'connect') return undefined;
    if (m(/^\/metrics-service\/metrics\/trainingreadiness\/([\d-]+)(?:\/([\d-]+))?$/)) {
      return json(wellnessIn(r![1]!, r![2] ?? r![1]!).flatMap((w) => readinessSnapshots(w, tzOff)));
    }
    if (m(/^\/metrics-service\/metrics\/trainingstatus\/aggregated\/([\d-]+)$/)) {
      return json({
        userId: MOCK_PROFILE_ID,
        mostRecentVO2Max: { generic: { calendarDate: r![1], vo2MaxPreciseValue: latestVo2() ?? null } },
        mostRecentTrainingStatus: { latestTrainingStatusData: { [String(MOCK_DEVICE_ID)]: { calendarDate: r![1], trainingStatus: 4, trainingStatusFeedbackPhrase: 'PRODUCTIVE_1', acuteTrainingLoadDTO: { acwrPercent: 45, acwrStatus: 'OPTIMAL', dailyTrainingLoadAcute: 520, dailyTrainingLoadChronic: 480, dailyAcuteChronicWorkloadRatio: 1.1 } } } },
      });
    }
    if (m(/^\/userstats-service\/wellness\/daily\/([^/]+)$/)) {
      if (decodeURIComponent(r![1]!) !== displayName) return notFound();
      const list = wellnessIn(q('fromDate') ?? athlete.today, q('untilDate') ?? athlete.today).filter((w) => w.restingHr !== undefined);
      return json({ userProfileId: MOCK_PROFILE_ID, allMetrics: { metricsMap: { WELLNESS_RESTING_HEART_RATE: list.map((w) => ({ value: w.restingHr, calendarDate: w.date })) } } });
    }
    return undefined;
  }

  function latestVo2(): number | undefined {
    for (let i = athlete.wellness.length - 1; i >= 0; i--) if (athlete.wellness[i]!.vo2max !== undefined) return athlete.wellness[i]!.vo2max;
    return undefined;
  }

  async function handleControl(req: Request, path: string): Promise<Response> {
    if (path === '/__mock/scenario' && req.method === 'POST') {
      const body = (await req.json().catch(() => ({}))) as { scenario?: MockScenario };
      setScenario(body.scenario ?? 'ok');
      return json({ ok: true, failures });
    }
    if (path === '/__mock/state' && req.method === 'GET') {
      return json({
        now: now().toISOString(),
        visibleActivities: visibleActivities().length,
        workouts: [...state.workouts.values()].map((w) => ({ workoutId: w.workoutId, workoutName: w.workoutName })),
        schedules: [...state.schedules.values()],
        requests: state.requests.length,
      });
    }
    return notFound();
  }

  function setScenario(name: MockScenario): void {
    for (const k of Object.keys(failures)) delete (failures as Record<string, unknown>)[k];
    switch (name) {
      case 'expired_token':
        failures.unauthorized = { count: 1 };
        break;
      case 'rate_limited':
        failures.rateLimit = { count: 1_000_000, retryAfterSec: 3600 };
        break;
      case 'sso_blocked':
        failures.blocked = 'sso';
        break;
      case 'refresh_invalid':
        failures.refreshInvalid = true;
        break;
      case 'blocked':
        failures.blocked = 'connect';
        break;
      default:
        break;
    }
  }

  function resolve(url: URL): { api: MockApi; path: string } | undefined {
    if (url.pathname.startsWith(`${prefix}/`)) {
      const rest = url.pathname.slice(prefix.length + 1);
      const slash = rest.indexOf('/');
      const key = slash === -1 ? rest : rest.slice(0, slash);
      if (key === 'personal' || key === 'connect' || key === 'diauth' || key === 'sso') {
        return { api: key, path: slash === -1 ? '/' : rest.slice(slash) };
      }
    }
    const api = HOSTS[url.hostname];
    return api ? { api, path: url.pathname } : undefined;
  }

  async function route(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const ctl = url.pathname.indexOf('/__mock/');
    if (ctl !== -1) return handleControl(req, url.pathname.slice(ctl));
    const target = resolve(url);
    if (!target) return json({ message: `mock: unknown Garmin host ${url.hostname}` }, 502);
    const { api, path } = target;
    const fail = injected(api);
    if (fail) return fail;
    if (api === 'diauth') return handleDiauth(req, path);
    if (api === 'sso') return handleSso(req, path);
    if (api === 'personal') {
      if (path === PERSONAL_TOKEN_PATH) {
        if (req.method !== 'POST') return json({ message: 'Method Not Allowed' }, 405);
        if (failures.personalKeyRevoked || req.headers.get('authorization') !== `ApiKey ${apiKey}`) return json({ message: 'Invalid API key' }, 401);
        state.personalExchangeCount++;
        const exp = Math.floor(nowMs() / 1000) + (opts.personalTokenTtlSec ?? 86_400);
        const token = makeJwt({ exp, iat: Math.floor(nowMs() / 1000), jti: `p-${++counter}`, scope: 'PERSONAL_API_READ' });
        state.personalTokens.set(token, exp * 1000);
        return new Response(token, { status: 200, headers: { 'Content-Type': 'text/plain' } });
      }
      if (req.method !== 'GET') return json({ message: 'Method Not Allowed' }, 405);
      const denied = checkBearer(req, 'personal');
      if (denied) return denied;
      if (!PERSONAL_PATHS.some((re) => re.test(path))) return notFound();
      return handleReads(req, 'personal', path, url) ?? notFound();
    }
    // connect
    const denied = checkBearer(req, 'connect');
    if (denied) return denied;
    if (PERSONAL_ONLY.some((re) => re.test(path))) return notFound();
    const w = await handleConnectWrites(req, path);
    if (w) return w;
    return handleReads(req, 'connect', path, url) ?? notFound();
  }

  async function fetchHandler(request: Request): Promise<Response> {
    if (opts.latencyMs && opts.latencyMs > 0) await new Promise((r) => setTimeout(r, opts.latencyMs));
    const url = new URL(request.url);
    let res: Response;
    try {
      res = await route(request);
    } catch (e) {
      res = json({ message: `mock error: ${e instanceof Error ? e.message : String(e)}` }, 500);
    }
    const target = resolve(url);
    state.requests.push({ method: request.method, api: target?.api ?? 'connect', path: target?.path ?? url.pathname, search: url.search, status: res.status });
    return res;
  }

  return {
    fetch: fetchHandler,
    state,
    failures,
    issueDiTokens() {
      const t = issueDi();
      return { di_token: t.access, di_refresh_token: t.refresh, di_client_id: DI_CLIENT_IDS[0] };
    },
    expireAccessTokens() {
      const past = nowMs() - 1;
      for (const k of state.diAccessTokens.keys()) state.diAccessTokens.set(k, past);
      for (const k of state.personalTokens.keys()) state.personalTokens.set(k, past);
    },
    editActivity(id, edits) {
      state.edits.set(id, { ...state.edits.get(id), ...edits, lastUpdateMs: nowMs() });
    },
    deleteActivity(id) {
      state.deletedActivityIds.add(id);
    },
    visibleActivities,
    setScenario,
  };
}
