/**
 * GarminClient — hybrid Personal API (reads) + unofficial Connect API (writes,
 * extra physiology) over an injected `fetch` (garmin.md §0, §2, §10).
 *
 * Request policy:
 *  - refreshes are serialised per credential kind (one in-flight promise) and
 *    re-read the TokenStore first, so a token rotated by another isolate is adopted
 *    instead of refreshed again;
 *  - 401 → refresh once and retry once, then GarminAuthError('unauthorized');
 *  - 429 (and 5xx for idempotent methods) → bounded exponential backoff with jitter,
 *    honouring Retry-After; a Retry-After above `maxDelayMs` is not waited out —
 *    GarminRateLimitError carries it so the caller can set a global backoff;
 *  - 427 / Cloudflare HTML / 403 on a write → GarminBlockedError;
 *  - 404 → GarminNotFoundError; other non-2xx → GarminHttpError; 204 → undefined.
 */
import {
  DEFAULT_BASE_URLS,
  DI_REFRESH_MARGIN_SEC,
  NATIVE_HEADERS,
  PERSONAL_REFRESH_MARGIN_SEC,
  exchangePersonalApiKey,
  jwtExpiry,
  refreshDiToken,
  type DiCredentials,
  type GarminBaseUrls,
  type GarminCredentials,
  type TokenStore,
} from './auth';
import {
  GarminAuthError,
  GarminBlockedError,
  GarminError,
  GarminHttpError,
  GarminNotFoundError,
  GarminRateLimitError,
  isNotFound,
  isUnavailable,
} from './errors';
import { extractFitFromDownload } from './fit';
import { mapUserSettings, type GarminUserSettings } from './mapping';
import { asArray, defaultSleep, isObject, num, str, type JsonObject } from './util';
import type { GarminWorkout } from './workout';

export type FetchLike = (request: Request) => Promise<Response>;

export interface RetryOptions {
  /** Retries after the first attempt for 429 / 5xx (default 2). */
  maxRetries?: number;
  /** First backoff step (default 1000 ms); doubles per retry. */
  baseDelayMs?: number;
  /** Upper bound for a single wait (default 30 s). Longer Retry-After → throw immediately. */
  maxDelayMs?: number;
}

export interface GarminClientOptions {
  fetch: FetchLike;
  tokens: TokenStore;
  baseUrls?: Partial<GarminBaseUrls>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  retry?: RetryOptions;
  /** Jitter source in [0, 1) (default Math.random); tests pin it. */
  random?: () => number;
}

export interface Capabilities {
  /** Activity/wellness reads possible (Personal API key or DI token). */
  read: boolean;
  /** Workout/schedule writes possible (DI token). */
  write: boolean;
  personal: boolean;
  di: boolean;
}

export interface ListActivitiesParams {
  start?: number;
  limit?: number;
  startDate?: string;
  endDate?: string;
  activityType?: string;
}

export interface GarminProfile {
  displayName?: string;
  fullName?: string;
  profileId?: number;
  timezone?: string;
  raw: unknown;
}

type Api = 'personal' | 'connect';
type Query = Record<string, string | number | boolean | undefined>;
interface CallOptions {
  query?: Query;
  json?: unknown;
  accept?: string;
  responseType?: 'json' | 'bytes' | 'text';
}
interface Route {
  path: string;
  query?: Query;
}

const FIT_ACCEPT_PERSONAL = 'application/zip, application/x-zip-compressed, application/octet-stream';

export class GarminClient {
  readonly baseUrls: GarminBaseUrls;
  private readonly fetchFn: FetchLike;
  private readonly tokens: TokenStore;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly retry: Required<RetryOptions>;
  private cache: GarminCredentials | null | undefined;
  private personalInflight: Promise<string> | undefined;
  private diInflight: Promise<string> | undefined;
  private workoutTypesCache: JsonObject | undefined;
  /** Count of HTTP requests issued (handy for Workers subrequest budgeting). */
  requestCount = 0;

  constructor(opts: GarminClientOptions) {
    const f = opts.fetch;
    // Calling a bare global fetch with a foreign `this` throws "Illegal invocation" in Workers.
    this.fetchFn = (req) => f.call(globalThis, req);
    this.tokens = opts.tokens;
    this.baseUrls = { ...DEFAULT_BASE_URLS, ...opts.baseUrls };
    this.now = opts.now ?? (() => new Date());
    this.sleep = opts.sleep ?? defaultSleep;
    this.random = opts.random ?? Math.random;
    this.retry = { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 30_000, ...opts.retry };
  }

  // ───────────────────────────── credentials ─────────────────────────────

  private nowSec(): number {
    return Math.floor(this.now().getTime() / 1000);
  }

  private async creds(): Promise<GarminCredentials> {
    if (this.cache === undefined) this.cache = await this.tokens.load();
    return this.cache ?? {};
  }

  /** Drop the in-memory credential cache (e.g. after the user pasted new tokens). */
  invalidateCredentials(): void {
    this.cache = undefined;
  }

  async capabilities(): Promise<Capabilities> {
    const c = await this.creds();
    const personal = !!c.personal?.apiKey;
    const di = !!c.di?.di_token && !!c.di.di_refresh_token;
    return { read: personal || di, write: di, personal, di };
  }

  private async bearer(api: Api): Promise<string> {
    const c = await this.creds();
    if (api === 'personal') {
      const p = c.personal;
      if (!p?.apiKey) throw new GarminAuthError('No Garmin Personal API key configured', 'personal', 'no_credentials');
      if (p.bearer && p.bearerExp !== undefined && p.bearerExp - this.nowSec() > PERSONAL_REFRESH_MARGIN_SEC) return p.bearer;
      return this.exchangePersonal(p.bearer);
    }
    const d = c.di;
    if (!d?.di_token) throw new GarminAuthError('No Garmin Connect (DI) token configured', 'di', 'no_credentials');
    const exp = jwtExpiry(d.di_token);
    if (exp !== undefined && exp - this.nowSec() < DI_REFRESH_MARGIN_SEC) return this.refreshDi(d.di_token);
    return d.di_token;
  }

  private exchangePersonal(stale: string | undefined): Promise<string> {
    if (this.personalInflight) return this.personalInflight;
    const run = async (): Promise<string> => {
      const latest = (await this.tokens.load()) ?? {};
      const p = latest.personal;
      if (!p?.apiKey) throw new GarminAuthError('No Garmin Personal API key configured', 'personal', 'no_credentials');
      if (p.bearer && p.bearer !== stale && (p.bearerExp ?? 0) - this.nowSec() > PERSONAL_REFRESH_MARGIN_SEC) {
        this.cache = latest;
        return p.bearer;
      }
      this.requestCount++;
      const { bearer, bearerExp } = await exchangePersonalApiKey(this.fetchFn, this.baseUrls.personal, p.apiKey, this.nowSec());
      const next: GarminCredentials = { ...latest, personal: { ...p, bearer, bearerExp } };
      await this.tokens.save(next);
      this.cache = next;
      return bearer;
    };
    this.personalInflight = run().finally(() => {
      this.personalInflight = undefined;
    });
    return this.personalInflight;
  }

  private refreshDi(stale: string): Promise<string> {
    if (this.diInflight) return this.diInflight;
    const run = async (): Promise<string> => {
      const latest = (await this.tokens.load()) ?? {};
      const d = latest.di;
      if (!d?.di_token) throw new GarminAuthError('No Garmin Connect (DI) token configured', 'di', 'no_credentials');
      const exp = jwtExpiry(d.di_token);
      if (d.di_token !== stale && (exp === undefined || exp - this.nowSec() > DI_REFRESH_MARGIN_SEC)) {
        this.cache = latest; // another isolate already rotated it
        return d.di_token;
      }
      this.requestCount++;
      const fresh: DiCredentials = await refreshDiToken(this.fetchFn, this.baseUrls.diauth, d);
      const next: GarminCredentials = { ...latest, di: fresh };
      await this.tokens.save(next); // persist BEFORE use: the old refresh token may be dead now
      this.cache = next;
      return fresh.di_token;
    };
    this.diInflight = run().finally(() => {
      this.diInflight = undefined;
    });
    return this.diInflight;
  }

  /** Force a DI refresh now (daily cron keeps the refresh token rolling, garmin.md §2.2 step 4). */
  async refreshDiNow(): Promise<void> {
    const d = (await this.creds()).di;
    if (!d) throw new GarminAuthError('No Garmin Connect (DI) token configured', 'di', 'no_credentials');
    await this.refreshDi(d.di_token);
  }

  /** Force a Personal API re-exchange now. */
  async refreshPersonalNow(): Promise<void> {
    const p = (await this.creds()).personal;
    await this.exchangePersonal(p?.bearer ?? '');
  }

  private async readApi(): Promise<Api> {
    const c = await this.creds();
    if (c.personal?.apiKey) return 'personal';
    if (c.di?.di_token) return 'connect';
    throw new GarminAuthError('No Garmin credentials configured', 'personal', 'no_credentials');
  }

  // ───────────────────────────── transport ─────────────────────────────

  private backoffMs(attempt: number): number {
    const exp = this.retry.baseDelayMs * 2 ** attempt;
    return Math.min(this.retry.maxDelayMs, Math.round(exp * (0.75 + this.random() * 0.5)));
  }

  private async call(api: Api, method: string, path: string, opts: CallOptions = {}): Promise<unknown> {
    const base = api === 'personal' ? this.baseUrls.personal : this.baseUrls.connect;
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const idempotent = method !== 'POST';
    let token = await this.bearer(api);
    let authRetried = false;
    let attempt = 0;
    for (;;) {
      const headers: Record<string, string> = api === 'connect' ? { ...NATIVE_HEADERS } : {};
      headers.Authorization = `Bearer ${token}`;
      headers.Accept = opts.accept ?? 'application/json';
      let body: string | undefined;
      if (opts.json !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(opts.json);
      }
      this.requestCount++;
      const res = await this.fetchFn(new Request(url.toString(), { method, headers, body }));

      if (res.status === 401) {
        if (authRetried) {
          throw new GarminAuthError(`Garmin ${api} API returned 401 after refresh`, api === 'personal' ? 'personal' : 'di', 'unauthorized');
        }
        authRetried = true;
        token = api === 'personal' ? await this.exchangePersonal(token) : await this.refreshDi(token);
        continue;
      }
      if (res.status === 429 || (res.status >= 500 && idempotent)) {
        const ra = parseRetryAfter(res.headers.get('retry-after'), this.now().getTime());
        const wait = ra ?? this.backoffMs(attempt);
        if (attempt >= this.retry.maxRetries || wait > this.retry.maxDelayMs) {
          if (res.status === 429) throw new GarminRateLimitError(`Garmin ${api} API rate limited`, api, 429, wait);
          throw new GarminHttpError(api, method, path, res.status, await snippet(res));
        }
        attempt++;
        await this.sleep(wait);
        continue;
      }
      if (res.status === 427) throw new GarminBlockedError(`Garmin ${api} API refused the request (427)`, api, 427);
      if (res.status === 403) {
        const text = await res.text();
        if (looksLikeHtml(text) || (api === 'connect' && method !== 'GET')) {
          throw new GarminBlockedError(`Garmin ${api} API refused ${method} (403; client/network block?)`, api, 403);
        }
        throw new GarminHttpError(api, method, path, 403, text.slice(0, 200));
      }
      if (res.status === 404) throw new GarminNotFoundError(api, method, path, await snippet(res));
      if (!res.ok) throw new GarminHttpError(api, method, path, res.status, await snippet(res));
      if (res.status === 204) return undefined;
      if (opts.responseType === 'bytes') return new Uint8Array(await res.arrayBuffer());
      const text = await res.text();
      if (opts.responseType === 'text') return text;
      if (text.trim() === '') return undefined;
      if (looksLikeHtml(text)) throw new GarminBlockedError(`Garmin ${api} API returned HTML instead of JSON (challenge page?)`, api, res.status);
      try {
        return JSON.parse(text);
      } catch {
        // Some endpoints (syncTimestamp) answer with a bare string.
        return text;
      }
    }
  }

  private async read(path: string, query?: Query): Promise<unknown> {
    return this.call(await this.readApi(), 'GET', path, query ? { query } : {});
  }

  /** GET that maps 403/404/no-credentials → undefined, trying the Personal API first. */
  private async tolerant(routes: { personal?: Route; connect?: Route }): Promise<unknown> {
    const c = await this.creds();
    const order: [Api, Route][] = [];
    if (routes.personal && c.personal?.apiKey) order.push(['personal', routes.personal]);
    if (routes.connect && c.di?.di_token) order.push(['connect', routes.connect]);
    for (const [api, route] of order) {
      try {
        return await this.call(api, 'GET', route.path, route.query ? { query: route.query } : {});
      } catch (e) {
        if (isUnavailable(e)) continue;
        throw e;
      }
    }
    return undefined;
  }

  private both(path: string, query?: Query): { personal: Route; connect: Route } {
    const r: Route = query ? { path, query } : { path };
    return { personal: r, connect: r };
  }

  private async requireDi(): Promise<void> {
    if (!(await this.creds()).di?.di_token) {
      throw new GarminAuthError('Garmin writes need a Connect (DI) token: paste garmin_tokens.json', 'di', 'no_credentials');
    }
  }

  // ───────────────────────────── identity ─────────────────────────────

  async getProfile(): Promise<GarminProfile> {
    const c = await this.creds();
    if (c.personal?.apiKey) {
      const raw = asObjectOrEmpty(await this.call('personal', 'GET', '/userprofile-service/userprofile/settings'));
      const ud = isObject(raw.userData) ? raw.userData : {};
      return pruneProfile({
        displayName: str(raw, 'displayName') ?? str(ud, 'displayName') ?? c.di?.displayName,
        fullName: str(raw, 'fullName', 'userProfileFullName') ?? str(ud, 'fullName'),
        profileId: num(raw, 'profileId', 'id', 'userProfileId'),
        timezone: str(raw, 'timeZone', 'timezone') ?? str(ud, 'timeZone', 'timezone'),
        raw,
      });
    }
    return this.verifyDiToken();
  }

  /** GET /userprofile-service/socialProfile on connectapi — the recommended DI token check; caches displayName. */
  async verifyDiToken(): Promise<GarminProfile> {
    await this.requireDi();
    const raw = asObjectOrEmpty(await this.call('connect', 'GET', '/userprofile-service/socialProfile'));
    const displayName = str(raw, 'displayName');
    const profileId = num(raw, 'profileId');
    const d = (await this.creds()).di;
    if (d && displayName && (d.displayName !== displayName || d.profileId !== profileId)) {
      const latest = (await this.tokens.load()) ?? {};
      if (latest.di) {
        const next: GarminCredentials = { ...latest, di: { ...latest.di, displayName, ...(profileId !== undefined ? { profileId } : {}) } };
        await this.tokens.save(next);
        this.cache = next;
      }
    }
    return pruneProfile({ displayName, fullName: str(raw, 'userProfileFullName', 'fullName'), profileId, raw });
  }

  private async displayName(): Promise<string | undefined> {
    const d = (await this.creds()).di;
    if (!d) return undefined;
    if (d.displayName) return d.displayName;
    return (await this.verifyDiToken()).displayName;
  }

  // ───────────────────────────── activities ─────────────────────────────

  /** Newest first. `start` is an offset. Returns raw Garmin list items (see mapping.mapActivitySummary). */
  async listActivities(params: ListActivitiesParams = {}): Promise<JsonObject[]> {
    const body = await this.read('/activitylist-service/activities/search/activities', {
      start: params.start ?? 0,
      limit: params.limit ?? 20,
      startDate: params.startDate,
      endDate: params.endDate,
      activityType: params.activityType,
    });
    return asArray(body).filter(isObject);
  }

  /** Raw activity detail (`summaryDTO`, `metadataDTO`, …). Throws GarminNotFoundError for deleted activities. */
  async getActivity(id: string | number): Promise<JsonObject> {
    return asObjectOrEmpty(await this.read(`/activity-service/activity/${id}`));
  }

  /** Original upload: ZIP → FIT bytes (unzipped with fflate). */
  async downloadOriginalFit(id: string | number): Promise<Uint8Array> {
    const api = await this.readApi();
    const bytes = (await this.call(api, 'GET', `/download-service/files/activity/${id}`, {
      accept: api === 'personal' ? FIT_ACCEPT_PERSONAL : '*/*',
      responseType: 'bytes',
    })) as Uint8Array | undefined;
    if (!bytes || bytes.length === 0) throw new GarminHttpError(api, 'GET', `/download-service/files/activity/${id}`, 204, 'empty download');
    const fit = extractFitFromDownload(bytes);
    if (!fit) throw new GarminError(`Download for activity ${id} contained no FIT file`, 'no_fit');
    return fit;
  }

  /** Downsampled time series JSON (connectapi only) — fallback when no FIT. */
  async getActivityDetails(id: string | number, opts: { maxChartSize?: number; maxPolylineSize?: number } = {}): Promise<JsonObject | undefined> {
    const r = await this.tolerant({
      connect: {
        path: `/activity-service/activity/${id}/details`,
        query: { maxChartSize: opts.maxChartSize ?? 2000, maxPolylineSize: opts.maxPolylineSize ?? 4000 },
      },
    });
    return isObject(r) ? r : undefined;
  }

  async getSplits(id: string | number): Promise<JsonObject | undefined> {
    const r = await this.tolerant({ connect: { path: `/activity-service/activity/${id}/splits` } });
    return isObject(r) ? r : undefined;
  }

  async getExerciseSets(id: string | number): Promise<JsonObject | undefined> {
    const r = await this.tolerant({ connect: { path: `/activity-service/activity/${id}/exerciseSets` } });
    return isObject(r) ? r : undefined;
  }

  async getHrTimeInZones(id: string | number): Promise<unknown[] | undefined> {
    const r = await this.tolerant({ connect: { path: `/activity-service/activity/${id}/hrTimeInZones` } });
    return Array.isArray(r) ? r : undefined;
  }

  /** Workouts linked to an activity ([P] + connect). Shape UNVERIFIED. */
  async getActivityWorkouts(id: string | number): Promise<unknown[] | undefined> {
    const r = await this.tolerant(this.both(`/activity-service/activity/${id}/workouts`));
    return Array.isArray(r) ? r : undefined;
  }

  /** Last device sync time (connectapi only) — cheap change detector. */
  async getSyncTimestamp(): Promise<string | undefined> {
    const r = await this.tolerant({ connect: { path: '/wellness-service/wellness/syncTimestamp' } });
    return typeof r === 'string' ? r.replace(/^"|"$/g, '') : undefined;
  }

  // ───────────────────────────── wellness (all tolerant → undefined) ─────────────────────────────

  async getSleep(date: string): Promise<unknown> {
    return this.tolerant({
      personal: { path: '/sleep-service/sleep/dailySleep', query: { date } },
      connect: { path: '/sleep-service/sleep/dailySleepData', query: { date, nonSleepBufferMinutes: 60 } },
    });
  }

  /** Personal: summaries by date; connect: sleep stats (≤ 28 days per call — chunk upstream). */
  async getSleepRange(startDate: string, endDate: string): Promise<unknown> {
    return this.tolerant({
      personal: { path: '/sleep-service/sleep/dailySleepSummariesByDate', query: { startDate, endDate } },
      connect: { path: `/sleep-service/stats/sleep/daily/${startDate}/${endDate}` },
    });
  }

  async getHrv(date: string): Promise<unknown> {
    return this.tolerant(this.both(`/hrv-service/hrv/${date}`));
  }

  async getHrvRange(startDate: string, endDate: string): Promise<unknown> {
    return this.tolerant(this.both(`/hrv-service/hrv/daily/${startDate}/${endDate}`));
  }

  /** v2 daily summaries range (RHR, stress, body battery, steps). Assumed on both hosts. */
  async getDailySummaries(startDate: string, endDate: string): Promise<unknown> {
    return this.tolerant(this.both('/usersummary-service/v2/dailysummaries', { startDate, endDate }));
  }

  /** One day's summary: connect `/usersummary/daily/{displayName}`; personal → v2 range of one day. */
  async getDailySummary(date: string): Promise<unknown> {
    const c = await this.creds();
    if (c.personal?.apiKey) {
      const r = await this.tolerant({ personal: { path: '/usersummary-service/v2/dailysummaries', query: { startDate: date, endDate: date } } });
      if (r !== undefined) return r;
    }
    const dn = c.di ? await this.displayName() : undefined;
    if (!dn) return undefined;
    return this.tolerant({ connect: { path: `/usersummary-service/usersummary/daily/${encodeURIComponent(dn)}`, query: { calendarDate: date } } });
  }

  async getBodyBattery(startDate: string, endDate: string): Promise<unknown> {
    return this.tolerant(this.both('/wellness-service/wellness/bodyBattery/reports/daily', { startDate, endDate }));
  }

  async getStress(startDate: string, endDate: string): Promise<unknown> {
    return this.tolerant(this.both(`/usersummary-service/stats/stress/daily/${startDate}/${endDate}`));
  }

  /** Weight entries; values in GRAMS on the wire (mapping converts). */
  async getWeight(startDate: string, endDate: string): Promise<unknown> {
    return this.tolerant({
      personal: { path: `/weight-service/weight/range/${startDate}/${endDate}`, query: { includeAll: true } },
      connect: { path: '/weight-service/weight/dateRange', query: { startDate, endDate } },
    });
  }

  async getVo2Max(startDate: string, endDate: string): Promise<unknown> {
    return this.tolerant(this.both(`/metrics-service/metrics/maxmet/daily/${startDate}/${endDate}`));
  }

  /** Connect only: resting HR per day (metricId 60). */
  async getRestingHr(startDate: string, endDate: string): Promise<unknown> {
    if (!(await this.creds()).di) return undefined;
    const dn = await this.displayName();
    if (!dn) return undefined;
    return this.tolerant({
      connect: {
        path: `/userstats-service/wellness/daily/${encodeURIComponent(dn)}`,
        query: { fromDate: startDate, untilDate: endDate, metricId: 60 },
      },
    });
  }

  /** Connect only: array of readiness snapshots for a day (or a range when endDate is given). */
  async getTrainingReadiness(date: string, endDate?: string): Promise<unknown> {
    return this.tolerant({ connect: { path: `/metrics-service/metrics/trainingreadiness/${date}${endDate ? `/${endDate}` : ''}` } });
  }

  /** Connect only: aggregated training status (nested; keys UNVERIFIED). */
  async getTrainingStatus(date: string): Promise<unknown> {
    return this.tolerant({ connect: { path: `/metrics-service/metrics/trainingstatus/aggregated/${date}` } });
  }

  /** HR zones ([P]), user settings (connect: LTHR, run LT speed, weight), cycling FTP (connect). */
  async getUserSettings(): Promise<GarminUserSettings> {
    const heartRateZones = await this.tolerant(this.both('/biometric-service/heartRateZones/v2'));
    const userSettings = await this.tolerant({ connect: { path: '/userprofile-service/userprofile/user-settings' } });
    const ftp = await this.tolerant({ connect: { path: '/biometric-service/biometric/latestFunctionalThresholdPower/CYCLING' } });
    return mapUserSettings({ heartRateZones, userSettings, ftp });
  }

  // ───────────────────────────── workouts (connect only) ─────────────────────────────

  /** POST /workout-service/workout → stored workout incl. `workoutId`. Never auto-retried on 5xx. */
  async createWorkout(payload: GarminWorkout): Promise<GarminWorkout & { workoutId: number }> {
    await this.requireDi();
    const res = await this.call('connect', 'POST', '/workout-service/workout', { json: stripServerIds(payload) });
    const id = num(res, 'workoutId');
    if (!isObject(res) || id === undefined) throw new GarminError('Garmin createWorkout returned no workoutId', 'bad_response');
    return res as unknown as GarminWorkout & { workoutId: number };
  }

  /** PUT replaces the whole workout (keeps the id, so schedules stay valid). */
  async updateWorkout(workoutId: string | number, payload: GarminWorkout): Promise<GarminWorkout | undefined> {
    await this.requireDi();
    const res = await this.call('connect', 'PUT', `/workout-service/workout/${workoutId}`, {
      json: { ...payload, workoutId: Number(workoutId) },
    });
    return isObject(res) ? (res as unknown as GarminWorkout) : undefined;
  }

  /** Idempotent: returns false if it was already gone. */
  async deleteWorkout(workoutId: string | number): Promise<boolean> {
    await this.requireDi();
    try {
      await this.call('connect', 'DELETE', `/workout-service/workout/${workoutId}`);
      return true;
    } catch (e) {
      if (isNotFound(e)) return false;
      throw e;
    }
  }

  async getWorkout(workoutId: string | number): Promise<GarminWorkout | undefined> {
    await this.requireDi();
    try {
      const r = await this.call('connect', 'GET', `/workout-service/workout/${workoutId}`);
      return isObject(r) ? (r as unknown as GarminWorkout) : undefined;
    } catch (e) {
      if (isNotFound(e)) return undefined;
      throw e;
    }
  }

  async listWorkouts(params: { start?: number; limit?: number; myWorkoutsOnly?: boolean } = {}): Promise<JsonObject[]> {
    await this.requireDi();
    const r = await this.call('connect', 'GET', '/workout-service/workouts', {
      query: {
        start: params.start ?? 0,
        limit: params.limit ?? 100,
        myWorkoutsOnly: params.myWorkoutsOnly ?? true,
        orderBy: 'UPDATE_DATE',
        orderSeq: 'DESC',
      },
    });
    return asArray(r).filter(isObject);
  }

  /** `/workout-service/workout/types` dictionaries, cached per client instance; undefined if unavailable. */
  async getWorkoutTypes(): Promise<JsonObject | undefined> {
    if (this.workoutTypesCache) return this.workoutTypesCache;
    const r = await this.tolerant({ connect: { path: '/workout-service/workout/types' } });
    if (isObject(r)) this.workoutTypesCache = r;
    return this.workoutTypesCache;
  }

  /** POST /workout-service/schedule/{id} {date} → schedule id (field name UNVERIFIED: workoutScheduleId|scheduleId|id). */
  async scheduleWorkout(workoutId: string | number, date: string): Promise<string> {
    await this.requireDi();
    const r = await this.call('connect', 'POST', `/workout-service/schedule/${workoutId}`, { json: { date } });
    const id = str(r, 'workoutScheduleId', 'scheduleId', 'id');
    if (!id) throw new GarminError('Garmin scheduleWorkout returned no schedule id', 'bad_response');
    return id;
  }

  async getSchedule(scheduleId: string | number): Promise<JsonObject | undefined> {
    await this.requireDi();
    const r = await this.tolerant({ connect: { path: `/workout-service/schedule/${scheduleId}` } });
    return isObject(r) ? r : undefined;
  }

  /** Idempotent: false if the schedule entry was already gone. Keeps the workout template. */
  async unschedule(scheduleId: string | number): Promise<boolean> {
    await this.requireDi();
    try {
      await this.call('connect', 'DELETE', `/workout-service/schedule/${scheduleId}`);
      return true;
    } catch (e) {
      if (isNotFound(e)) return false;
      throw e;
    }
  }

  async getScheduledWorkouts(startDate: string, endDate: string): Promise<unknown> {
    await this.requireDi();
    return this.call('connect', 'GET', '/workout-service/schedule/workoutScheduleByPeriod', { query: { startDate, endDate } });
  }

  /**
   * Calendar month. `month` is 1–12 (human); the wire path is 0-based
   * (`/calendar-service/year/2026/month/10` = November) and is converted here.
   */
  async getCalendarMonth(year: number, month: number): Promise<{ year: number; month: number; calendarItems: JsonObject[]; raw: unknown }> {
    await this.requireDi();
    if (!Number.isInteger(month) || month < 1 || month > 12) throw new RangeError('month must be 1–12');
    const raw = await this.call('connect', 'GET', `/calendar-service/year/${year}/month/${month - 1}`);
    return { year, month, calendarItems: asArray(isObject(raw) ? raw.calendarItems : undefined).filter(isObject), raw };
  }

  /** Queue a workout for immediate delivery to a device (body must be an ARRAY). */
  async sendWorkoutToDevice(deviceId: number, workoutId: number, workoutName: string): Promise<unknown> {
    await this.requireDi();
    return this.call('connect', 'POST', '/device-service/devicemessage/messages', {
      json: [
        {
          deviceId,
          messageUrl: `workout-service/workout/FIT/${workoutId}`,
          messageType: 'workouts',
          messageName: workoutName,
          groupName: null,
          priority: 1,
          fileType: 'FIT',
          metaDataId: workoutId,
        },
      ],
    });
  }
}

// ───────────────────────────── helpers ─────────────────────────────

function parseRetryAfter(h: string | null, nowMs: number): number | undefined {
  if (!h) return undefined;
  const s = Number(h);
  if (Number.isFinite(s)) return Math.max(0, s * 1000);
  const t = Date.parse(h);
  return Number.isFinite(t) ? Math.max(0, t - nowMs) : undefined;
}

function looksLikeHtml(text: string): boolean {
  const t = text.trimStart().slice(0, 64).toLowerCase();
  return t.startsWith('<!doctype html') || t.startsWith('<html') || t.startsWith('<head') || t.startsWith('<body');
}

async function snippet(res: Response): Promise<string | undefined> {
  try {
    const t = await res.text();
    return t ? t.slice(0, 200) : undefined;
  } catch {
    return undefined;
  }
}

function asObjectOrEmpty(v: unknown): JsonObject {
  return isObject(v) ? v : {};
}

function pruneProfile(p: GarminProfile): GarminProfile {
  const out: GarminProfile = { raw: p.raw };
  if (p.displayName) out.displayName = p.displayName;
  if (p.fullName) out.fullName = p.fullName;
  if (p.profileId !== undefined) out.profileId = p.profileId;
  if (p.timezone) out.timezone = p.timezone;
  return out;
}

/** Remove server-assigned ids before a create (stepId, workoutId, ownerId, dates). */
function stripServerIds(w: GarminWorkout): GarminWorkout {
  const clone = structuredClone(w) as GarminWorkout & Record<string, unknown>;
  delete clone.workoutId;
  delete clone.ownerId;
  delete clone.createdDate;
  delete clone.updatedDate;
  const walk = (steps: unknown[]): void => {
    for (const s of steps) {
      if (!isObject(s)) continue;
      delete s.stepId;
      if (Array.isArray(s.workoutSteps)) walk(s.workoutSteps);
    }
  };
  for (const seg of clone.workoutSegments ?? []) walk(seg.workoutSteps as unknown[]);
  return clone;
}
