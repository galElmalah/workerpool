# @cadence/garmin

Garmin Connect integration for Cadence: auth, HTTP client, Garmin JSON → domain mapping, FIT parsing,
structured-workout encoding, sync planners, and an offline fake Garmin (`@cadence/garmin/mock`).
Runs on Cloudflare Workers (Web APIs only: `fetch`, WebCrypto/`atob`/`btoa`, `TextEncoder`).
The reference this is built from is [`docs/research/garmin.md`](../../docs/research/garmin.md).

| Module | What it does |
|---|---|
| `auth.ts` | Credential model, `TokenStore`, Personal API key exchange, DI token refresh (rotation), `parseGarminTokensJson`, experimental SSO login |
| `client.ts` | `GarminClient`: reads, wellness, settings, workouts, schedule, calendar; refresh/retry/backoff policy; typed errors |
| `mapping.ts` | activity type table, `mapActivitySummary` → `NormalizedActivity`, wellness → `WellnessDay`, user settings → thresholds, details/splits/sets fallbacks |
| `fit.ts` | `parseFit` (never throws) → summary overrides, streams, laps (incl. swim lengths), strength sets; ZIP unwrapping |
| `workout.ts` | `toGarminWorkout` / `fromGarminWorkout`, workout dictionary, re-association tags |
| `sync.ts` | `runIncrementalSync`, `runBackfillStep`, `pullWellnessRange`, `pushPlannedWorkout`, `needsPush` |
| `mock/` | `createGarminMock`: one `fetch` handler for every Garmin host, in Garmin's wire shapes |

## How auth works for the athlete

Cadence uses two independent credentials. Either one alone is useful; both together unlock everything.

### 1. Read access: a Garmin Personal API key (official)

1. Open Garmin Connect → **Settings → Personal API Token**
   (`https://connect.garmin.com/app/settings/personalApiToken`).
2. Create a key and choose its lifetime (30 / 90 / 180 / 365 days). It is shown **once**: copy it.
3. Paste it into Cadence (Settings → Garmin), together with the expiry date you chose; Cadence warns
   14 days before it runs out. A key cannot be renewed from code: create a new one.

Cadence exchanges the key for a 24 h bearer token (`POST personal.connectapi.garmin.com/…/token`),
caches it, and re-exchanges it when less than 1 h remains or on a 401. This path is sanctioned by
Garmin, read-only, and limited to the account owner's own data.

### 2. Write access: a Connect token set (`garmin_tokens.json`, unofficial)

Pushing structured workouts to the Garmin calendar (and some extra physiology: training readiness and
status, FTP, LTHR, splits, exercise sets) needs the unofficial Connect API. Garmin blocks scripted
logins from data centres, so you sign in **once on your own computer** with
[python-garminconnect](https://pypi.org/project/garminconnect/) and paste the resulting token file:

```bash
python3 -m venv gc && . gc/bin/activate && pip install "garminconnect>=0.3.20" curl_cffi
python3 - <<'EOF'
from getpass import getpass
from garminconnect import Garmin
g = Garmin(input("email: "), getpass("password: "), prompt_mfa=lambda: input("MFA code: "))
g.login("./gc_tokens")          # writes ./gc_tokens/garmin_tokens.json
print(open("./gc_tokens/garmin_tokens.json").read())   # paste this JSON into the platform
EOF
```

Paste the printed JSON (`{"di_token": …, "di_refresh_token": …, "di_client_id": …}`) into Cadence.
The Worker refreshes the token itself at `diauth.garmin.com`, at least daily from cron so the refresh
token keeps rolling, and stores every rotated refresh token before using it. If the refresh token is
ever rejected (`GarminAuthError` code `needs_reauth`), run the snippet again.
These tokens give full access to the account: Cadence encrypts them at rest. Disconnecting deletes them.
To revoke them on Garmin's side, use your Garmin account security settings.

### 3. Experimental: sign in from the Worker

`experimentalPasswordLogin` / `experimentalCompleteMfa` implement the iOS "mobile" SSO flow
(+ MFA, with a serializable pending state). They make **one attempt, with no retries**, and report
exactly how they failed (`GarminBlockedError` for a 429/427/403/CAPTCHA, or `GarminAuthError` with code
`invalid_credentials` / `invalid_mfa_code`). Expect them to be blocked from Cloudflare egress. Keep them
behind a feature flag.

## Capability matrix

| Feature | Personal API key | Connect token (DI) |
|---|---|---|
| Activity list / summary / original FIT | ✅ (preferred) | ✅ |
| Activity details JSON, splits, exercise sets, HR-zone times | — | ✅ |
| Sleep, HRV, daily summaries (RHR, stress, body battery), weight, VO2max | ✅ | ✅ (assumed same paths) |
| HR zones | ✅ | ✅ |
| Training readiness, training status, resting-HR series | — | ✅ |
| FTP, LTHR, run LT speed (user settings) | — (LTHR via HR zones) | ✅ |
| Create / update / delete workouts, schedule / unschedule, calendar | — | ✅ |
| Push workout to device now | — | ✅ |

`client.capabilities()` → `{ read, write, personal, di }`. Reads try the Personal API first. Wellness
getters fall back to Connect when the Personal API answers 403/404, and return `undefined` when no
route has the data.

## Using it

```ts
import { GarminClient, runIncrementalSync, pushPlannedWorkout } from '@cadence/garmin';

const client = new GarminClient({
  fetch,                                   // or mock.fetch
  tokens: d1TokenStore(env),               // { load(), save(c) } — encrypted, CAS on a version column
  // baseUrls: mockBaseUrls(origin),       // DEMO mode
});
const report = await runIncrementalSync(client, activityRepo, { now: new Date(), maxRequests: 10 });
// enqueue FIT downloads for report.created + report.updated → downloadOriginalFit → parseFit
const link = await pushPlannedWorkout(client, planned, thresholds, planned.garmin);
```

Client policy: refreshes are serialized per credential kind. Before a refresh the client re-reads the
`TokenStore` and adopts a token another isolate already rotated. A 401 triggers one refresh and one retry.
429 and idempotent 5xx responses get bounded exponential backoff with jitter, honouring `Retry-After`.
If `Retry-After` is above `maxDelayMs`, the client throws `GarminRateLimitError` with `retryAfterMs`
instead of waiting; use it to set a global backoff. 427, Cloudflare HTML and 403 on writes raise
`GarminBlockedError`. 404 raises `GarminNotFoundError`. `client.requestCount` helps with subrequest
budgeting.

`pushPlannedWorkout` treats Garmin workouts as immutable. If the content is unchanged, it keeps the
workout. If the plan changed, it creates a new workout, schedules it, then unschedules and deletes the
old one. If only the date moved, it reschedules. A skipped plan is removed from Garmin. Every workout
carries a `[cadence:<plannedId>:<fingerprint>]` tag in its description, so a retry after a crash adopts
the orphan instead of creating a duplicate. On errors the function throws: the caller records
`syncState: 'error'` and retries later.

### Mock (`@cadence/garmin/mock`)

```ts
const mock = createGarminMock({ athlete, synth: { generateActivityDetail, encodeFit }, now: () => clock });
new GarminClient({ fetch: mock.fetch, tokens: memoryTokenStore({ personal: { apiKey: 'good-key' }, di: mock.issueDiTokens() }) });
// Miniflare: outboundService: (req) => mock.fetch(req)
// DEMO (inside the app Worker): if (url.pathname.startsWith('/__garmin/')) return mock.fetch(request);
//   and baseUrls: mockBaseUrls(url.origin)
```

The mock supports the following:

- It routes requests by hostname (real Garmin hosts) or by the `/__garmin/<personal|connect|diauth|sso>/…` prefix.
- It enforces bearer tokens per host.
- It rotates DI refresh tokens.
- It shows only activities with `startedAt ≤ now()`.
- It keeps workouts and schedules in memory (`mock.state`).
- It injects failures (`mock.failures`, `mock.setScenario(…)`, `POST /__mock/scenario`).

## Bundle weight

`@garmin/fitsdk` 21.222.0 is pure ESM and imports cleanly in Workers. It is about 1.14 MB unminified;
the FIT profile tables account for about 1.04 MB of that. A minified bundle of `src/index.ts` is
524 KB (94 KB gzip), of which the SDK is 435 KB. To keep the main Worker small, import the FIT
parser lazily in the queue consumer. Parsing a 4.4 h hike FIT (432 KB, 15.7k records) takes about 50 ms
on Node.

## UNVERIFIED assumptions baked in (check on the first live run)

- Personal API paths are also served by connectapi with the same shapes. Sleep is the exception
  (`dailySleep` vs `dailySleepData`). Range-endpoint shapes (sleep summaries, HRV range, v2 daily summaries,
  stress stats, weight range) are read defensively.
- Schedule id field (`workoutScheduleId` | `scheduleId` | `id`). Calendar item fields. Deleting a workout
  is assumed to cascade its schedules (we unschedule first anyway).
- Swim stroke/equipment ids (default alphabetical: free = 6, pull_buoy = 4), the `fixed.rest` condition
  (only used when `/workout/types` lists it), and `poolLength`/`poolLengthUnit` on workouts. On activities,
  `poolLength` is taken as cm with factor 100.
- Nested `RepeatGroupDTO`s. By default the outer repeat is unrolled (`nestedRepeats: 'nest'` opts in).
- Rowing/hiking/walking/skiing have no workout sport type. They are sent as `cardio_training` / `other`,
  and targets the sport cannot carry move into step notes.
- `exerciseSets[].weight` in grams (values > 500 are converted). `lactateThresholdSpeed` in units of
  10 m/s (values < 1.5 are ×10). Weight endpoints in grams.
- FIT running cadence is per leg and gets doubled. If the median is above 130 the data is taken as
  already being steps/min.

## First live spike checklist (garmin.md §11, in order)

1. From a deployed Worker: Personal API token exchange, then activity list, then FIT download (expected to work).
2. From a deployed Worker with a pasted DI token: `client.verifyDiToken()` (`GET …/socialProfile`), then
   `client.refreshDiNow()`. If either is blocked (403/429/HTML → `GarminBlockedError`), switch writes to a
   home bridge or intervals.icu.
3. Decode the DI `access_token` `exp`. Check whether `refresh_token` rotates and how long it lives
   (log the `expires_in` fields).
4. Upload example C (swim), GET it back, and diff the fields (pool length, stroke/equipment ids, rest step).
5. Find the schedule response field name for the schedule id, and the calendar item fields for workouts
   (`workoutId`?).
6. Check `workoutId` / `associatedWorkoutId` on an activity executed from a workout we scheduled.
7. Make one in-Worker SSO mobile login attempt (single try) and record how it is blocked.
