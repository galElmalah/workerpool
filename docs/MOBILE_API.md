# Mobile API contract (iOS app and widgets)

The iOS app (`apps/ios`) talks to the same Worker as the web app. It uses the existing JSON API
(`docs/ARCHITECTURE.md` → API surface; route files in `apps/web/worker/routes/*.ts` are the source of
truth for shapes) plus the three additions below. This file is the contract between the Worker and the
Swift code: both sides implement exactly this.

## 1. Device tokens (bearer auth)

Browsers use the `cadence_session` cookie. Native clients use a long-lived, revocable **device token**.

- `POST /api/auth/devices` — open route, same throttling/lockout as `POST /api/auth/login`.
  Request `{ "passphrase": string, "name": string (1–64), "platform": "ios" | "other" }`.
  `201` → `{ "token": "cad_<43 url-safe base64 chars>", "device": Device }`.
  `401 invalid_passphrase`, `429 too_many_attempts` (with `Retry-After`), `400 not_configured`.
  The token is returned once; the server stores only its SHA-256 hash.
- `GET /api/auth/devices` → `{ "devices": Device[] }` (newest first). Requires auth (cookie or bearer).
- `DELETE /api/auth/devices/:id` → `204`. Revokes that device at once. Requires auth.
  `404 not_found` when no such device exists (already revoked).
- `DELETE /api/auth/devices/current` → `204`. Revokes the token used for this request (sign-out on the
  phone). `400 bad_request` when the request is cookie-authenticated.

Request validation failures (empty or > 64-character `name` after trimming, unknown `platform`, missing
fields) → `400 validation`. A wrong passphrase counts towards the same lockout as a failed login, and
failed logins lock out device creation too (one throttle).

```ts
type Device = {
  id: string;            // "dev_…"
  name: string;          // e.g. "Gal's iPhone"
  platform: 'ios' | 'other';
  createdAt: string;     // ISO instant
  lastUsedAt: string | null; // ISO instant, updated at most once per hour
};
```

Every protected route accepts `Authorization: Bearer cad_…` as an alternative to the cookie. A missing,
unknown or revoked token → `401 { error: { code: "unauthorized", message } }`. A request that carries a
`Bearer` header is judged on that token alone (a bad token is a `401` even if a valid cookie is also
sent); `Authorization` headers with other schemes are ignored. Revocation is immediate in the Worker
isolate that handled it and takes at most 30 s everywhere else (per-isolate cache of valid tokens). Changing the passphrase
revokes all device tokens (same as it invalidates sessions). `GET /api/auth/status` reports
`authenticated: true` for a valid bearer token too.

Storage: migration `0004_devices.sql` — table `devices (id TEXT PRIMARY KEY, name TEXT NOT NULL,
platform TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, last_used_at TEXT)`.

## 2. Widget snapshot

`GET /api/mobile/snapshot` → `MobileSnapshot`. One small response (< 8 KB) with everything the widgets,
the Lock Screen and the app's first paint need, so a widget refresh is a single request. SI units;
durations in seconds, distances in metres; dates are `YYYY-MM-DD` in the athlete's time zone.

```ts
type SnapshotSession = {
  id: string;
  kind: 'planned' | 'activity' | 'paired';   // paired = planned workout with its completed activity
  sport: Sport;                               // 'bike' | 'run' | 'swim' | 'row' | 'strength' | … (domain.ts)
  title: string;
  startTime: string | null;                   // "HH:MM" local, planned or actual
  durationSec: number | null;                 // actual when done, else planned
  distanceM: number | null;
  load: number | null;
  isKey: boolean;
  intensity: IntensityClass | null;           // domain.ts
  state: 'planned' | 'done' | 'missed' | 'skipped';
  workoutId: string | null;                   // deep link target …/workouts/:id
  activityId: string | null;                  // deep link target …/activities/:id
};

type MobileSnapshot = {
  generatedAt: string;                        // ISO instant
  today: string;                              // LocalDate
  units: 'metric' | 'imperial';
  athleteName: string | null;
  status: {
    fitness: number | null;                   // rounded to 1 decimal
    fatigue: number | null;
    form: number | null;
    formZone: FormZone | null;                // domain.ts FORM_ZONES
    rampPerWeek: number | null;
    headline: string;                         // one short sentence, e.g. "Neutral · long ride today"
  };
  todaySessions: SnapshotSession[];           // in day order
  tomorrowSessions: SnapshotSession[];
  week: {
    isoWeek: string;                          // "2026-W47"
    label: string;                            // "W47"
    phase: string | null;                     // "Run base"
    doneSec: number; plannedSec: number;
    doneLoad: number; plannedLoad: number;
    keyDone: number; keyPlanned: number;
    days: { date: string; plannedSec: number; doneSec: number;
            state: 'rest' | 'planned' | 'done' | 'partial' | 'missed' }[];   // 7 entries, Mon–Sun
  };
  nextEvent: { id: string; name: string; date: string; daysTo: number; priority: 'A' | 'B' | 'C' } | null;
  fitnessSeries: { date: string; fitness: number; fatigue: number; form: number }[]; // last 42 days incl. today
  recentWeeks: { isoWeek: string; label: string; hours: number; load: number }[];     // last 8 complete weeks + current
  lastActivity: SnapshotSession | null;       // most recent completed activity
  lastSyncAt: string | null;                  // ISO instant of the last successful Garmin sync
};
```

The zod schema lives in `packages/core/src/domain.ts` (`MobileSnapshot`, `SnapshotSession`, `Device`).
The endpoint reuses the same services as `GET /api/today` and the calendar/trends routes — no second
implementation of metrics.

### Snapshot semantics (as implemented)

- `today` follows the athlete's time zone setting and, in demo mode, the pinned demo clock (it is the same
  date `GET /api/today` returns). `generatedAt` is the real server time. `units` is the athlete's display
  preference; every number in the payload is still SI.
- **Sessions** (`todaySessions`, `tomorrowSessions`, `lastActivity`): one entry per planned workout —
  `paired` when it has its completed activity, else `planned` — then one `activity` entry per completed
  activity without a plan. For `paired`: `id` = `workoutId` = the workout, `title` is the planned title,
  `startTime`/`durationSec`/`distanceM`/`load`/`intensity` are the activity's actuals. For `activity`:
  `id` = `activityId`, `workoutId` is non-null only for a pair that crosses dates. Done durations are
  moving time (elapsed when no moving time) — the same rule as the week totals, so the day bars add up.
  `state`: `done` (completed), `skipped` (skipped by the athlete or excused by a sick/injured/travel
  marker), `missed` (date passed, not done), else `planned`. Order: by `startTime`, untimed entries last.
  `lastActivity` may therefore be `paired` (its `activityId` is the activity).
- **`week.days[].state`**: `rest` = nothing planned (or only skipped/excused workouts) and nothing done;
  `done` = something done and nothing left open; `partial` = something done and a planned workout still
  open/missed; `missed` = a past day whose planned workouts were not done; `planned` = today/future with
  open workouts. Day `plannedSec`/`doneSec` sum to the week's `plannedSec`/`doneSec` (= `GET /api/today`
  `week`, `GET /api/trends/weekly`). `phase` is the label of the week's training phase.
- **`status`** = `GET /api/today`'s fitness day; `rampPerWeek` is its `ramp` (Fitness change over 7 days).
  `headline` = `"<Form zone> · <today>"` where `<today>` is `"<title> today"` (the key or first open
  session, `"+ N more"` when several), `"done for today"` or `"rest day"`; without a form zone (no
  history) the prefix is dropped and the first letter capitalised (`"Rest day"`). Display it verbatim.
- **Empty database / no activity history**: `status` numbers and `formZone` are `null`, `fitnessSeries` is
  `[]`, `lastActivity` is `null`; `week.days` still has 7 entries and `recentWeeks` 9 (zeros).
- `fitnessSeries` = `GET /api/trends/fitness` values for the last 42 days (oldest first, ends at `today`).
  `recentWeeks` = 9 entries, oldest first, the last one is the current (incomplete) week; `hours` = done
  hours rounded to 0.1. `nextEvent` = the first event on/after today (ties: A before B before C).
- Numbers are JSON numbers that may or may not have a fraction (`464`, `539.1`): decode as `Double`
  (seconds and metres are whole numbers but still decode them as `Double` or `Int` tolerant of `.0`).
- Response header `Cache-Control: private, no-store`. Typical size 4–6 KB; two D1 round trips.

### Example

A real response from the demo dataset (`fitnessSeries` and `recentWeeks` trimmed to their last 3 entries;
the real arrays have 42 and 9):

```json
{
  "generatedAt": "2026-11-22T05:44:52.361Z",
  "today": "2026-11-21",
  "units": "metric",
  "athleteName": "Jonas Weber",
  "status": {
    "fitness": 65.6,
    "fatigue": 71.5,
    "form": -2,
    "formZone": "neutral",
    "rampPerWeek": 2.5,
    "headline": "Neutral · done for today"
  },
  "todaySessions": [
    {
      "id": "wk_d20261121_1",
      "kind": "paired",
      "sport": "bike",
      "title": "Long ride 2h05 — Gavarres loop",
      "startTime": "09:26",
      "durationSec": 7561,
      "distanceM": 57840,
      "load": 102.6,
      "isKey": true,
      "intensity": "tempo",
      "state": "done",
      "workoutId": "wk_d20261121_1",
      "activityId": "act_uxe16yozne"
    }
  ],
  "tomorrowSessions": [
    {
      "id": "wk_d20261122_1",
      "kind": "planned",
      "sport": "run",
      "title": "Trail run 1h30 — Gavarres",
      "startTime": "09:00",
      "durationSec": 5400,
      "distanceM": null,
      "load": 69.4,
      "isKey": false,
      "intensity": "endurance",
      "state": "planned",
      "workoutId": "wk_d20261122_1",
      "activityId": null
    }
  ],
  "week": {
    "isoWeek": "2026-W47",
    "label": "W47",
    "phase": "Run base",
    "doneSec": 28100,
    "plannedSec": 35087,
    "doneLoad": 464,
    "plannedLoad": 539.1,
    "keyDone": 3,
    "keyPlanned": 3,
    "days": [
      { "date": "2026-11-16", "plannedSec": 5664, "doneSec": 6305, "state": "done" },
      { "date": "2026-11-17", "plannedSec": 6300, "doneSec": 6314, "state": "done" },
      { "date": "2026-11-18", "plannedSec": 5151, "doneSec": 4910, "state": "done" },
      { "date": "2026-11-19", "plannedSec": 3000, "doneSec": 3010, "state": "done" },
      { "date": "2026-11-20", "plannedSec": 2072, "doneSec": 0, "state": "missed" },
      { "date": "2026-11-21", "plannedSec": 7500, "doneSec": 7561, "state": "done" },
      { "date": "2026-11-22", "plannedSec": 5400, "doneSec": 0, "state": "planned" }
    ]
  },
  "nextEvent": {
    "id": "evt_demo_3",
    "name": "Riu Ter Half Marathon",
    "date": "2026-12-27",
    "daysTo": 36,
    "priority": "B"
  },
  "fitnessSeries": [
    { "date": "2026-11-19", "fitness": 66.2, "fatigue": 76.9, "form": -13.6 },
    { "date": "2026-11-20", "fitness": 64.7, "fatigue": 66.7, "form": -10.7 },
    { "date": "2026-11-21", "fitness": 65.6, "fatigue": 71.5, "form": -2 }
  ],
  "recentWeeks": [
    { "isoWeek": "2026-W45", "label": "W45", "hours": 5.8, "load": 195.7 },
    { "isoWeek": "2026-W46", "label": "W46", "hours": 10.9, "load": 647.7 },
    { "isoWeek": "2026-W47", "label": "W47", "hours": 7.8, "load": 464 }
  ],
  "lastActivity": {
    "id": "wk_d20261121_1",
    "kind": "paired",
    "sport": "bike",
    "title": "Long ride 2h05 — Gavarres loop",
    "startTime": "09:26",
    "durationSec": 7561,
    "distanceM": 57840,
    "load": 102.6,
    "isKey": true,
    "intensity": "tempo",
    "state": "done",
    "workoutId": "wk_d20261121_1",
    "activityId": "act_uxe16yozne"
  },
  "lastSyncAt": "2026-11-21T18:02:06.824Z"
}
```

## 3. Wellness check-in from an interactive widget

Uses the existing `PUT /api/wellness/:date` (manual check-in fields). No new endpoint.

## Client rules

- Base URL is entered by the user (their Worker's origin). All requests are HTTPS (plain HTTP allowed only
  for `localhost` and private-network hosts during development).
- Send `Authorization: Bearer <token>`, `Accept: application/json`, and `X-Cadence-Client: ios/<version>`.
- Errors are `{ "error": { "code": string, "message": string } }` with a matching HTTP status.
- `401` on any call → the token was revoked: clear it and return to the connect screen.

## Local development server

The Worker runs in `vite dev` (demo mode, seeded synthetic athlete, passphrase `cadence-demo`):

```sh
B=http://localhost:5240/api
# 1. get a device token (returned once)
curl -s -X POST $B/auth/devices -H 'content-type: application/json' \
  -d '{"passphrase":"cadence-demo","name":"Dev iPhone","platform":"ios"}'
# → {"token":"cad_…","device":{"id":"dev_…","name":"Dev iPhone","platform":"ios","createdAt":"…","lastUsedAt":null}}
TOKEN=cad_…
# 2. snapshot
curl -s $B/mobile/snapshot -H "Authorization: Bearer $TOKEN" -H 'Accept: application/json' -H 'X-Cadence-Client: ios/0.1'
# 3. sign out
curl -s -X DELETE $B/auth/devices/current -H "Authorization: Bearer $TOKEN"   # → 204
```

A fresh local D1 state needs the `0004_devices` migration first:
`npx wrangler d1 migrations apply DB --local --persist-to .wrangler/<name>` (from `apps/web`).
`POST /api/demo/reset` and re-seeding keep device tokens (like the passphrase).

