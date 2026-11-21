# Worker module contract

Three engineers build the Worker in parallel. Each owns the files listed and must provide the
cross-module functions below **with exactly these names and signatures, as early as possible**
(write the signature + a working first version before polishing your own routes). Import the other
modules' functions as if they exist; typecheck converges when everyone lands. Never edit a file you
do not own — if you need something else from another module, add a thin helper in your own area.

Shared, already written (do not change): `index.ts` (mounts every `routes/*.ts` at the API root and
exports `AppType`), `env.ts`, `lib/http.ts` (`ApiError`, `notFound`, `badRequest`), `lib/ids.ts`,
`db/sql.ts`, `services/ingest.types.ts`, `../migrations/0001_init.sql` (the schema — add a new
numbered migration only if you truly need a column, and say so in your report), `../test/helpers.ts`
(`api`, `json`, `anon`).

Rules for all: routes are chained on the exported Hono instance (`export const xRoutes = new
Hono<AppEnv>().get(...).post(...)`) so types flow to the SPA client; validate input with
`@hono/zod-validator` + the zod schemas in `@cadence/core/domain`; return domain objects exactly as
typed there (omit absent optionals, never `null`, unless the schema says nullable); errors via
`throw new ApiError(...)`; "today" always comes from `getToday(env)`.

## A — planning (`routes/auth|settings|workouts|templates|furniture|journal|search|data.ts`,
`middleware/auth.ts`, `db/settings.ts`, `db/thresholds.ts`, `db/workouts.ts`, `db/templates.ts`,
`db/furniture.ts`, `services/context.ts`, `services/planning.ts`, `lib/crypto.ts`)

```ts
// lib/crypto.ts
encryptJson(env: Env, value: unknown): Promise<string>            // AES-GCM, key derived from ENCRYPTION_KEY
decryptJson<T>(env: Env, payload: string): Promise<T>
// db/settings.ts
getSettings(db: D1Database): Promise<Settings>                     // DEFAULT_SETTINGS when unset
updateSettings(db: D1Database, patch: Partial<Settings>): Promise<Settings>
// services/context.ts
getToday(env: Env): Promise<LocalDate>                             // todayIn(settings.timezone)
// db/thresholds.ts
listThresholds(db: D1Database): Promise<Threshold[]>
insertThreshold(db: D1Database, t: Omit<Threshold, 'id'>): Promise<Threshold>
thresholdsOn(db: D1Database, date: LocalDate, sport: Sport): Promise<ThresholdSnapshot>  // via core resolveThresholds
// db/workouts.ts  (returned WITHOUT `compliance`; B's withCompliance adds it)
listWorkouts(db: D1Database, q: { from?: LocalDate; to?: LocalDate; ids?: string[] }): Promise<PlannedWorkout[]>
getWorkout(db: D1Database, id: string): Promise<PlannedWorkout | null>
insertWorkouts(db: D1Database, workouts: PlannedWorkout[]): Promise<void>   // verbatim (ids included)
updateGarminLink(db: D1Database, id: string, link: GarminLink & { fingerprint?: string }): Promise<void>
// services/planning.ts
createWorkout(env: Env, input: PlannedWorkoutInput): Promise<PlannedWorkout>  // derives planned totals, sparkline, intensity, title
// db/templates.ts
insertTemplates(db: D1Database, templates: Template[]): Promise<void>
// db/furniture.ts
listEvents(db, q: { from: LocalDate; to: LocalDate }): Promise<Event[]>
listPhases(db, q: { from: LocalDate; to: LocalDate }): Promise<Phase[]>      // overlapping the range
listMarkers(db, q: { from: LocalDate; to: LocalDate }): Promise<DayMarker[]> // overlapping the range
listDayNotes(db, q: { from: LocalDate; to: LocalDate }): Promise<DayNote[]>
listWeekNotes(db, q: { from: IsoWeek; to: IsoWeek }): Promise<WeekNote[]>
listWellness(db, q: { from: LocalDate; to: LocalDate }): Promise<WellnessDay[]>
upsertWellnessDevice(db, days: WellnessDay[]): Promise<void>                 // device columns only; never feel/soreness/note
insertEvents(db, e: Event[]) / insertPhases(db, p: Phase[]) / insertMarkers(db, m: DayMarker[]): Promise<void>
putDayNote(db, date: LocalDate, body: string) / putWeekNote(db, w: Omit<WeekNote,'updatedAt'>): Promise<void>
```

## B — activities & analytics (`routes/activities|calendar|trends|weeks|today.ts`,
`db/activities.ts`, `db/streams.ts`, `services/ingest.ts`, `services/pairing.ts`,
`services/compliance.ts`, `services/analytics.ts`)

```ts
// services/ingest.ts — see services/ingest.types.ts
ingestActivity: IngestActivity
recomputeActivities: RecomputeActivities
// db/activities.ts
listActivities(db: D1Database, q: { from?: LocalDate; to?: LocalDate; sport?: Sport; ids?: string[] }): Promise<Activity[]>  // excludes soft-deleted
getActivity(db: D1Database, id: string): Promise<Activity | null>
getActivityByGarminId(db: D1Database, garminActivityId: string): Promise<{ id: string; summaryHash?: string; deleted: boolean } | null>
softDeleteActivity(db: D1Database, id: string): Promise<void>
// services/pairing.ts
pairManually(env: Env, workoutId: string, activityId: string): Promise<void>
unpair(env: Env, workoutId: string): Promise<void>                  // marks both sides manual so auto-pairing leaves them alone
autoPairDates(env: Env, dates: LocalDate[]): Promise<number>         // re-run auto pairing for those local dates
// services/compliance.ts
withCompliance(env: Env, workouts: PlannedWorkout[], activities?: Activity[]): Promise<PlannedWorkout[]>
// services/analytics.ts
fitnessSeries(env: Env, q: { from: LocalDate; to: LocalDate; sport?: Sport }): Promise<FitnessDay[]>   // warm-up window handled inside
weekSummaries(env: Env, q: { from: LocalDate; to: LocalDate }): Promise<WeekSummary[]>
```

## C — Garmin sync & demo (`routes/garmin.ts`, `routes/demo.ts`, `cron.ts`, `db/garmin.ts`,
`db/sync.ts`, `services/garmin.ts`, `services/sync.ts`, `services/push.ts`, `services/demo.ts`)

```ts
// services/garmin.ts
getGarminClient(env: Env): Promise<GarminClient | null>   // null when not connected; demo mode injects the mock fetch
// services/push.ts
pushWorkout(env: Env, workoutId: string): Promise<GarminLink>      // create-or-replace + schedule; records sync_log
unpushWorkout(env: Env, workoutId: string): Promise<void>
markWorkoutDirty(env: Env, workoutId: string): Promise<void>       // A calls this after edits/moves of a synced workout → state 'pending'
// db/sync.ts
logSync(db: D1Database, entry: Omit<SyncLogEntry, 'id' | 'at'>): Promise<void>
```
Routes owned by C: `GET garmin/status`, `POST garmin/connect`, `DELETE garmin/connect`,
`POST garmin/sync`, `POST garmin/backfill`, `POST garmin/push/:workoutId`,
`DELETE garmin/push/:workoutId`, `GET sync/log`, `POST demo/seed`, `POST demo/reset`.
