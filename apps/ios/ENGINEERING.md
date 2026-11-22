# Cadence iOS — engineering notes (start here)

Two targets build on this: **App** (screens) and **Widgets**. Everything that is not a view lives in
`CadenceKit` (pure Swift + Foundation, tested); views only lay out view-models and formatted strings.
Contract: docs/MOBILE_API.md + apps/web/worker/routes/*.ts. Design: docs/DESIGN_V2.md.

## CadenceKit API surface

**Client** — `APIClient` (thread-safe class; share one). All methods `async throws`; errors are `APIError`.
```swift
APIClient(baseURL: URL, tokenStore: TokenStore, transport: HTTPTransport = URLSessionTransport(),
          responseCache: ResponseCache? = nil, appVersion: String = CadenceKitInfo.version,
          onUnauthorized: (@Sendable () -> Void)? = nil)
APIClient.restore(tokenStore:transport:responseCache:appVersion:onUnauthorized:) -> APIClient?  // nil = not connected
send<T>(_ endpoint: Endpoint<T>) -> T        cached<T>(_ endpoint: Endpoint<T>) -> Cached<T>?  // .value, .storedAt
// auth
connect(passphrase:deviceName:) -> Device   // stores DeviceCredentials(serverURL, token, …)
signOut() async  (non-throwing; revokes + clears)   authStatus() -> AuthStatus   devices() -> [Device]   revokeDevice(id:)
// snapshot / today / calendar
snapshot() -> MobileSnapshot    refreshSnapshot(into: SnapshotCache, now: Date = Date()) -> MobileSnapshot
today() -> TodayResponse        calendar(from: LocalDate, to: LocalDate) -> CalendarResponse
// workouts
workouts(from:to:) -> [PlannedWorkout]   workout(id:) -> PlannedWorkout   createWorkout(_ WorkoutInput) -> PlannedWorkout
patchWorkout(id:_ WorkoutPatch, scope: SeriesScope? = nil) -> PlannedWorkout   moveWorkout(id:to:)   duplicateWorkout(id:to:)
deleteWorkout(id:scope:) -> [PlannedWorkout] (keep for undo)   restoreWorkouts(_ [PlannedWorkout]) -> [PlannedWorkout]
skipWorkout(id:reason: SkipReason)   unskipWorkout(id:)   quickAdd(date:text:startTime:) -> QuickAddResponse
setWorkoutKey(id:_ Bool)   setWorkoutIntensity(id:_ IntensityClass)   setWorkoutNote(id:_ String?)   // all -> PlannedWorkout
// activities
activities(_ ActivityQuery = .init()) -> ActivityPage   activity(id:) -> ActivityDetail   streams(activityId:maxPoints: = 1200) -> ActivityStreams
patchActivity(id:_ ActivityPatch) -> Activity   setRPE(activityId:_ Int?)   setFeel(activityId:_ Int?)   setActivityNote(activityId:_ String?)
setActivityKey(activityId:_ Bool)   setActivityIntensity(activityId:_ IntensityClass?)   createManualActivity(_ ManualActivityInput) -> Activity
// trends, week, journal, notes, wellness, events
fitness(from:to:sport:) -> FitnessTrend   weekly(weeks: = 12, end:) -> [WeekSummary]   intensity(weeks:) -> IntensityTrend
peaks(sport:ranges: = ["42d","90d","season","all"]) -> PeaksTrend   wellnessTrend(from:to:) -> WellnessTrend   consistency(days: = 365) -> ConsistencyTrend
week(_ IsoWeek) -> WeekReview   journal(cursor:types:query:limit:) -> JournalPage
dayNote(date:) -> DayNote?   setDayNote(date:body:) -> DayNote? ("" deletes)   weekNote(_:) -> WeekNote?   setWeekNote(_:_ WeekNoteInput) -> WeekNote
wellness(date:) -> WellnessDay   checkIn(date:_ WellnessCheckIn) -> WellnessDay
events(from:to:) -> [Event]   createEvent(_ EventInput)   patchEvent(id:_ EventPatch)   deleteEvent(id:)   phases() -> [Phase]
// settings, garmin, search
settings() -> AthleteSettings   patchSettings(_ SettingsPatch) -> AthleteSettings   garminStatus() -> GarminStatus
syncNow() -> SyncReport   pushWorkout(id:) -> GarminLink   syncLog(limit:) -> SyncLogPage   search(_ String) -> SearchResponse
```
`Endpoints.*` builds the same requests as values (`Endpoints.today()`, `.calendar(from:to:)` …) — use
them with `client.cached(_:)` for offline first paint. GETs are cached automatically when the client
has a `ResponseCache`.

**Errors** — `APIError`: `.unauthorized` (token revoked: the client already cleared the store and
called `onUnauthorized` → show Connect), `.throttled(retryAfter:code:message:)`, `.server(code:message:status:)`
(`invalid_passphrase`, `not_found`, `sync_in_progress`, `garmin_not_connected`, `validation`…),
`.transport(message:offline:)`, `.decoding(detail:)`, `.invalidBaseURL(reason:)`, `.notConnected`.
`.message` is user-presentable; `.isOffline` → keep showing cached data.

**Models** (`Models/`, names = domain.ts except `AthleteSettings`, renamed to avoid SwiftUI's `Settings`):
`MobileSnapshot` (+`SnapshotStatus/Session/Week/Day/Event/FitnessPoint/WeekTotal`), `TodayResponse`,
`CalendarResponse` (+ helpers `workouts(on:)`, `activities(on:)`, `unplannedActivities(on:)`, `week(containing:)`,
`phase(on:)`, `markers(on:)`, `dayNote(on:)`, `events(on:)`), `PlannedWorkout`, `WorkoutStructure` /
`StructureNode` (flat recursive: `kind` .step/.repeat; builders `.step(id:role:measure:target:)`,
`.repeatBlock(id:count:steps:)`; `StepMeasure.time(_)/.distance(_)/.reps(_)`), `Target`, `Activity`,
`ActivityDetail` (`detail.title` works via dynamic member lookup), `ActivityStreams`, `Lap`, `ZoneTime`,
`WeekSummary`, `FitnessDay`, `WeekReview`, trends types, `Event`, `Phase`, `DayMarker`, `DayNote`, `WeekNote`,
`WellnessDay`, `JournalItem`, `SearchItem`, `GarminStatus`, `SyncReport`, `Device`. Inputs: `WorkoutInput`,
`WorkoutPatch`, `ActivityPatch`, `WellnessCheckIn`, `EventInput/Patch`, `WeekNoteInput`, `SettingsPatch`,
`ManualActivityInput`, `ActivityQuery`. In patches `nil` = unchanged, `Nullable.null` = clear, `.value(x)` = set.
Every enum is a `TolerantEnum`: unknown raw values decode as `.unknown`; `Enum.knownCases` for pickers.
Units are SI (s, m, m/s, W, kg). Dates are `LocalDate` strings; do arithmetic with `Day`.

**Dates** — `Day("2026-11-21")`, `Day(date, timeZone:)`, `.string`, `.adding(days:)`, `.days(until:)`,
`.isoWeekday` (1 = Mon), `.isoWeek`, `.weekStart/.weekEnd`, `Day.isoWeekStart(_:)`, `Day.range(_:_:)`,
`.startDate(in:)`. `Instant.parse(_ IsoInstant?) -> Date?`.

**Format** (pure, English, U+2212 minus, U+202F before units, "—" for nil): `number(_:decimals:trim:)`,
`signed`, `percent(_:decimals:signed:)`, `duration(_:style: .clock "1:25" | .hms "1:15:30" | .short "1h 25m" | .compact "45m"/"1:25")`,
`hours`, `distance(_:sport:units:swimYards:)` (km/mi; swim m/yd; row m), `pace(_:sport:units:)` ("4:05 /km",
"1:45 /100m", "1:52.4 /500m"), `speedParts`, `speedOrPace`, `load`, `power`, `heartRate`, `elevation`, `weight`,
`fitness`, `form` (signed), `weekdayShort/Initial`, `dayShort` "Sat 21", `dayMonth` "21 Nov", `dateMedium`
"Sat 21 Nov", `dateLong`, `monthYear`, `relativeDay(_:today:)` "Tomorrow"/"in 36 days", `countdown(daysTo:)`,
`weekLabel` "W47", `weekRange` "16–22 Nov", `clock(_:hour12:)`, `ago(_:now:)`; `Format.dot` = " · ".
Styles: `sport.style` / `.label` / `.symbolName` (SF Symbol), `intensity.style` (`label`, `level`, `bucket`,
`showsDot`, `rampIndex`), `formZone.style` (`label`, `summary`, `position`), `FormZone.of(formPct:)`,
`compliance.deviationLabel`, `priority.label`, `skipReason.label`.

**Widget view-models** (`WidgetModels`, all pure): `today(_ s, fetchedAt:, now:, timeZone:) -> TodayWidgetModel`
(`heading`, `dateText`, `lines`, `primary`, `emptyText`, `headline`, `allDone`, `upNext`, `upNextLabel`,
`inlineText`, `staleText`, `deepLink`) · `week(_:now:timeZone:) -> WeekWidgetModel` (`title`, `doneText`,
`plannedText`, `fraction`, `loadText`, `keyText`, `days: [WeekDayCell]`, `recentWeeks: [WeekBar]`, `isCurrentWeek`)
· `form(_:) -> FormWidgetModel` (`formText`, `zoneText`, `line`, `fitnessText`, `fatigueText`, `rampText`, `series`,
`range`) · `race(_:now:timeZone:) -> RaceWidgetModel?` · `schedule(for:now:timeZone:) -> WidgetSchedule`
(`entryDates`, `reloadAfter`). `ResolvedDay.resolve` rolls a cached snapshot over at local midnight
(tomorrowSessions become today's). `SessionLine` (init from `SnapshotSession`, `PlannedWorkout`+`Activity?`,
or `Activity`) is the row model for widgets **and** app lists. `MobileSnapshot.preview` = sample data.

**Deep links** — `DeepLink`: `.today .calendar(date:) .month .week .workout(id:) .activity(id:) .event(id:)
.template(id:) .checkIn(date:) .newWorkout(date:) .trends`; `.url` → `cadence://workout/wk_1`;
`DeepLink(url:)`, `DeepLink(webPath:)` (maps `SearchItem.href`). The app sets `AppModel.pendingLink` in `.onOpenURL`.

**Storage** — `TokenStore` protocol (`load() -> DeviceCredentials?`, `save(_:)`, `clear()`, `token`, `isConnected`);
`KeychainTokenStore(accessGroup:)` (after-first-unlock, this device only; falls back to the default group
when the entitlement is missing) and `InMemoryTokenStore`. `SnapshotCache(directory:)` (`load() -> Entry?`
with `.snapshot/.fetchedAt`, `save(_:fetchedAt:)`, `clear()`) in the App Group container.
`ResponseCache(directory:maxEntries:)`. `AppGroupConfig.fromInfoPlist()` (`appGroup`, `keychainGroup`,
`containerURL`, `defaults`). `SharedPreferences(defaults:)` (`accent`, `units`, `theme`, `apply(_ AthleteSettings)`).

## Shared (both targets) — `Shared/`

`Theme.colors(accent)` → `ThemeColors`: `canvas surface1 surface2 surface3 surfaceActive fg1…fg4 line1…line3
accentColor accentPress accentInk onAccent zone(1…7)` (all adapt to light/dark; generated from app.css by
`scripts/make_assets.py` — never hand-edit `Palette.generated.swift`). `Theme.Space` (xxs 4, xs 8, s 12, m 16,
l 24, xl 32, xxl 48, gutter 16, card 20, section 48), `Theme.Radius` (card 14, control 10, small 6),
`Theme.Typography` (title1/2/3, body, bodySmall, label, caption, statSmall/Medium/Large/Display, numeric —
all stat styles are `monospacedDigit()`), `Theme.Motion` (fast, base, slow, snappy, smooth, gentle,
`resolved(_:reduceMotion:)`). Environment: `@Environment(\.cadenceAccent)`; `.cadenceAccent(_:)` sets it +
tint; `.cadenceCard()`; `ThemePreference.colorScheme`.
Components: `SportGlyph(sport:size:)`, `LabelledStat(label:value:unit:context:size:)`,
`ThinProgressBar(fraction:tint:)` (neutral by default), `IntensityDot(rampIndex:)`, `SessionRow(line:showsTime:)`,
`SectionHeader(title:actionTitle:action:)`, `EmptyState(symbol:title:message:actionTitle:action:)`, `PrimaryButtonStyle`.

## Conventions

- Visual rules (DESIGN_V2): accent only for the one primary action, today/now, selection, the hero
  chart series; never for "done", Load or stat numbers; **no coloured edge stripes anywhere**; no borders
  around cards (surface step instead); sentence-case labels; numbers in SF Pro with tabular digits
  (never monospaced fonts); "Load, Fitness, Fatigue, Form" — never TSS/CTL/ATL/TSB.
- Views never format or compute: add a formatter/view-model to CadenceKit with a test instead.
- After any write that changes today/week, call `refreshSnapshot(into:)` and
  `WidgetCenter.shared.reloadAllTimelines()` (AppModel.refresh does both).
- Widgets: build from `SnapshotEntry.snapshot` with `WidgetModels`; `.containerBackground(c.canvas, for: .widget)`
  is mandatory on iOS 17; `placeholder(in:)` uses `MobileSnapshot.preview` (no network).
- `ActivityKit` also declares `Activity`: if you import it, write `CadenceKit.Activity`.
- New endpoint or field: add it to the model (one `public var` per line), capture a fixture
  (`scripts/capture_fixtures.py`), list it in `Fixtures/index.json`, add the decoder entry in
  `FixtureDecodingTests.swift`, run `scripts/check_fixtures.py --strict`.
- Before handing off: `SWIFT_BIN=… scripts/linux-test.sh` (build in Swift 5 and strict Swift 6 mode, tests,
  fixture check, parse of App/Widgets/Shared). CadenceKit must stay warning-free in both modes.
