# Cadence widgets, controls and App Intents

Widget extension `CadenceWidgets` (this folder) plus the App Intents in `Shared/Intents/` (compiled
into the app **and** the extension; `Shared/Intents/AppOnly/` is app-only). All logic — what each
family shows, wording, refresh timing, relevance — is pure Swift in
`CadenceKit/Sources/CadenceKit/WidgetSupport/` and `CadenceKit/Sources/CadenceKit/Widgets/WidgetModels.swift`, covered by
`CadenceKitTests/WidgetSupport/WidgetSupportTests.swift` and `WidgetModelTests.swift`. Views only lay
out those models.

## Catalogue

| Widget (kind) | Family | Shows | Tap opens |
|---|---|---|---|
| Today (`CadenceToday`) | small | sport glyph (sport colour), session title, duration/distance, state mark (done ✓ green, missed ✗ red, planned ○); "Rest day"; when done or resting, "Tomorrow · Run 1:30"; "Updated 3 h ago" when stale | the featured session (`cadence://workout/…` or `…/activity/…`), else `cadence://today` |
| | medium | "Today · Sat 21 Nov", up to two rows (filled with tomorrow's when today is done), "+1 more", the Form line ("Form −2 · Neutral") | each row → its workout/activity; elsewhere → today |
| | Lock Screen rectangular | glyph + title / "09:00 · 1:30 · Load 69" or "Done · 2:06 · 57.8 km" or "Rest day / Tomorrow · Run 1:30" | featured session |
| | Lock Screen inline | "Run 45m easy · Form −2", "Done · Ride 2:06 · Form −2", "Rest day · Form −2" | featured session |
| Week (`CadenceWeek`, configurable: lead with hours or Load) | small | "W47 · Run base", "7:48 of 9:45" (or "Load 464 of 539"), thin progress bar (accent) | `cadence://week/2026-W47` |
| | medium | + key count, the other metric, neutral bar, seven-day strip (initial over ✓ / ◐ / ○ / ⊘ / –, status colours; today = bold initial on a surface step, accent ink) | week |
| | large | + this week's sessions (up to 6, window keeps today in view, "+N more") from the week's calendar; offline before the first calendar fetch: today and tomorrow only | each row → workout/activity |
| | Lock Screen circular | capacity gauge of the week (centre "7.8", label "W47") | week |
| Form (`CadenceForm`) | small | "Form", "−2 Neutral", "Fitness 66 · Fatigue 72", 42-day Fitness sparkline (`DataColor.fitness`) | `cadence://trends` |
| Next race (`CadenceRace`) | small | "36 days to go" ("Tomorrow"/"Today"), race name, date | `cadence://event/…` (no race: calendar) |
| | medium | + priority, this week's line "W47 · 7:48 of 9:45 · Load 464" | event |
| Morning check-in (`CadenceCheckIn`, interactive) | medium | "How do you feel this morning?" + five buttons (1 Very tired … 5 Very fresh); afterwards "Logged · Fresh" (or "Fresh · not synced yet") and the chosen button marked with ✓ + surface step | buttons run `LogFeelIntent`; elsewhere `cadence://checkin/<date>` |
| Add workout control (`CadenceQuickAddControl`, iOS 18) | Control Center / Lock Screen / Action button | "Add workout" | `cadence://new` via `OpenURLIntent` |

Every widget has: a sample-data placeholder (`MobileSnapshot.preview`, no network), a gallery
snapshot, `containerBackground` (canvas on the Home Screen, clear on the Lock Screen), "Connect in
the app" when the phone has no device token, and "Nothing to show yet" when connected but nothing is
cached. Session titles are `.privacySensitive()` (redacted on a locked device when the user hides
widget data). In tinted (accented) and vibrant (Lock Screen / StandBy night) rendering every data
colour falls back to the primary style; marks stay distinguishable by symbol, and `widgetAccentable()`
is set on glyphs, marks, bars, the gauge and the today marker. System content margins are kept
everywhere except the check-in widget (`contentMarginsDisabled()`, 12 pt own padding: five buttons need
the width).

## Data flow and refresh

1. `SnapshotLoader.timeline` reads the App Group `SnapshotCache` (instant entries, offline).
2. If the cache is older than **15 min** (`WidgetRefresh.maxCacheAge`) and a device token is in the
   shared keychain, it fetches `GET /api/mobile/snapshot` with `APIClient` (15 s timeout) and writes it
   back. 401 → token and cache cleared → "Connect in the app". Offline → keep the cache.
3. Large Week: also `GET /api/calendar?from=Mon&to=Sun` (cached in `WidgetResponses/` in the App Group
   for offline use). Check-in widget: sends a pending check-in, and after a fresh fetch reads
   `GET /api/wellness/<today>` to pick up a check-in made on the web.
4. `WidgetRefresh.plan` → entries at **now**, when "Updated … ago" appears (fetch + 2 h) and **local
   midnight** (the roll-over renders tomorrow's sessions from the same snapshot, offline —
   `ResolvedDay`). Reload policy `.after(…)`:
   - every **20 min** from an hour before a planned session until 90 min after its planned end (it
     may get done and synced from Garmin); wake at the start of the next such window;
   - otherwise every **60 min**; always **00:05** after midnight;
   - **15 min** retries without data or with a days-old snapshot; **6 h** while signed out (the app
     reloads every timeline when it connects).
   That is about 25–35 reloads a day per widget, inside WidgetKit's budget. The app also reloads all
   timelines after any write (`AppModel.refresh`) and the intents do the same.
5. Each entry carries `TimelineEntryRelevance` from `WidgetModels.relevance` (Smart Stack): Today
   peaks from an hour before a planned session, Check-in in the morning until logged, Race in the
   final week, Week on Sunday evening / Monday morning, Form a little in the morning.

## How the interactive check-in authenticates

`Button(intent: LogFeelIntent(feel:))` runs `perform()` **in the widget extension** (no app launch).
The intent reads the device credentials (server URL + `cad_…` token) from the **shared keychain
access group** (`KeychainTokenStore(accessGroup: CadenceKeychainGroup)`, accessible after first
unlock, this device only) — the same item the app wrote when it connected. It:
1. saves `{date, feel, synced: false}` in the App Group (`CheckInStore`) so the widget shows the answer
   immediately,
2. sends `PUT /api/wellness/<local date> {"feel": n}` with `Authorization: Bearer <token>`,
3. marks it synced, refreshes `SnapshotCache` and calls `WidgetCenter.reloadAllTimelines()`.
Offline: the record stays "not synced yet" and the next timeline reload retries it (today's or
yesterday's only). Other errors clear the local record and are reported. No token → the widget shows
"Connect in the app" (the buttons are not drawn).

## Siri / Shortcuts (`Shared/Intents`)

| Intent | Phrase (examples) | Does |
|---|---|---|
| `TodayWorkoutIntent` | "What's my workout today in Cadence" | dialog ("Today you have a run, Easy 45, 45 minutes at 07:30. Form is minus 2, neutral.") + snippet |
| `LogFeelIntent` | "Log how I feel in Cadence", "Log feeling fresh in Cadence" | morning check-in 1–5 |
| `QuickAddWorkoutIntent` | "Add a workout in Cadence" → "run 45m easy tomorrow" | date phrase lifted out (`QuickAddPhrase`: today, tomorrow, weekdays, "dec 24", "+2d", "in 3 days"), rest sent to `POST /api/workouts/quick` |
| `SyncGarminIntent` | "Sync Garmin in Cadence" | `POST /api/garmin/sync`, says the summary |
| `OpenCadenceIntent` | "Open today / the calendar / trends in Cadence" | opens the app; the link is handed over through `IntentNavigator.shared.pendingLink` |
| `WeekWidgetConfigurationIntent` | — | Week widget: lead with hours or Load |
| `OpenQuickAddIntent` (iOS 18) | — | Control Center button → `cadence://new` |

**App hookup (done, `App/Core/CadenceApp.swift`):** iOS 17 has no `OpenURLIntent`, so the app forwards
`IntentNavigator.shared.pendingLink` to `AppModel.open(_:)` with `.onReceive(IntentNavigator.shared.$pendingLink.compactMap { $0 })`
next to `.onOpenURL`. `cadence://new` opens New workout (calendar tab), `cadence://checkin/<date>` opens
Today scrolled to the check-in (works on a cold launch too). `OpenQuickAddIntent` (iOS 18 control) both
hands the link to `IntentNavigator` (when the system runs it in the app) and returns
`OpenURLIntent(cadence://new)` (when it runs in the extension); opening twice is harmless.

## First run on a device — manual checklist

- [ ] `xcodegen`, set the team in `Config/Cadence.xcconfig`; both targets list the App Group and the
      keychain group (Signing & Capabilities). Build the **Cadence** scheme on a device.
- [ ] Before connecting: add each widget → "Connect in the app" (Today, Week, Form, Race, Check-in);
      Lock Screen rectangular/inline/circular show the connect text/icon.
- [ ] Connect in the app → within seconds every widget shows data (the app reloads timelines).
- [ ] Gallery shows sample data for every widget/family; long-press → Edit Widget on Week offers
      "Show: Hours / Load" and the hero switches.
- [ ] Today small/medium: tap a row → opens that workout/activity; tap elsewhere → Today.
      On a done day: green check + "Tomorrow · …"; on a rest day: "Rest day".
- [ ] Week medium: today's initial is marked, missed day shows ⊘ in red, done ✓ in green; large lists
      this week's sessions (turn on Airplane mode → still renders from cache).
- [ ] Form: number + word, Fitness/Fatigue, sparkline drawn; Race: countdown and date correct.
- [ ] Check-in: tap "Fresh" → the button shows ✓ at once, status "Logged · Fresh"; the web Today page
      shows the check-in. Airplane mode → "Fresh · not synced yet"; back online → becomes "Logged" on the
      next reload. Check-in on the web first → widget shows it after its next refresh.
- [ ] Midnight roll-over offline: leave the phone in Airplane mode over midnight → Today shows the new
      day's sessions (from yesterday's snapshot) and no headline/Form line.
- [ ] Revoke the device in the web app → next refresh shows "Connect in the app".
- [ ] Appearance: dark/light, accents blue/green/rose (Settings → Appearance, then reopen the app);
      iOS 18 tinted Home Screen; StandBy (small widgets, night mode turns red); Lock Screen vibrant.
      Nothing relies on colour alone; nothing clips at the largest Dynamic Type sizes.
- [ ] VoiceOver reads each widget as one sentence ("Today, Sat 21 Nov. Run, Easy 45, planned, …").
- [ ] Siri: "What's my workout today in Cadence", "Log how I feel in Cadence" (asks for the value),
      "Add a workout in Cadence" → "run 45 minutes easy tomorrow", "Sync Garmin in Cadence",
      "Open trends in Cadence" (opens the Trends tab). Shortcuts app lists all of them.
- [ ] iOS 18: Control Center → add "Add workout" → opens quick add.
- [ ] Smart Stack: Today rises an hour before a planned session; Check-in in the morning.
