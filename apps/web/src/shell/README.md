# App shell & route contract

`src/shell/router.tsx` owns the route tree. Each feature owns exactly one module,
`src/features/<feature>/pages.tsx`, and **replaces it wholesale** — keep every export name below (named
exports, no default). Pages are lazy (one chunk per feature module). Feature folders never import each
other; link with `links.*` from `@/shell/links`.

Layouts: `/_app` (rail / mobile bar chrome) wraps everything except `/_bare` (`/welcome`, `/login`, no
chrome). Route ids are `/_app<path>` — read params/search with `getRouteApi('/_app/calendar/day/$date')`
(`.useParams()`, `.useSearch()`, `.useNavigate()`), or `useParams({ strict: false })`.

| Path | Module → export | Params | Search (all optional, zod, invalid values dropped) |
|---|---|---|---|
| `/` | redirect → `/calendar` (≥ 768px) or `/today` | | |
| `/today` | today → `TodayPage` | | |
| `/calendar` | calendar → `CalendarPage` | | `date: LocalDate` (anchor) |
| `/calendar/month/$month` | calendar → `CalendarMonthPage` | `month: YYYY-MM` | |
| `/calendar/week/$isoWeek` | calendar → `CalendarWeekPage` | `isoWeek: YYYY-Www` | |
| `/calendar/day/$date` | calendar → `CalendarDayPage` | `date: LocalDate` | |
| `/calendar/agenda` | calendar → `AgendaPage` | | `date` |
| `/season` | calendar → `SeasonPage` | | |
| `/events/$id` | calendar → `EventPage` | `id` | |
| `/workouts/new` | workouts → `WorkoutNewPage` | | `date`, `sport: Sport`, `from` (tpl_/wk_ id), `text` (quick-add) |
| `/workouts/$id` | workouts → `WorkoutPage` | `id` | |
| `/workouts/$id/edit` | workouts → `WorkoutEditPage` | `id` | |
| `/activities` | activities → `ActivitiesPage` | | `sport`, `q`, `tag`, `from`, `to`, `key: boolean`, `intensity` |
| `/activities/$id` | activities → `ActivityPage` | `id` | |
| `/activities/$id/compare` | activities → `ActivityComparePage` | `id` | `with` (comma-separated ids) |
| `/library` | library → `LibraryPage` | | `q`, `sport`, `folder`, `intensity` |
| `/library/$templateId` | library → `TemplatePage` | `templateId` | |
| `/library/blocks/$blockId` | library → `BlockPage` | `blockId` | |
| `/trends` | trends → `TrendsPage` | | `range: 6w\|12w\|3m\|6m\|1y\|all`, `sport`, `metric: hours\|load\|distance`, `compare: prev\|year\|avg` |
| `/trends/fitness` · `/volume` · `/intensity` · `/peaks` · `/wellness` | trends → `TrendsFitnessPage` · `TrendsVolumePage` · `TrendsIntensityPage` · `TrendsPeaksPage` · `TrendsWellnessPage` | | same as `/trends` |
| `/trends/sport/$sport` | trends → `TrendsSportPage` | `sport: Sport` | same |
| `/week/$isoWeek` | week → `WeekPage` | `isoWeek` | |
| `/journal` | journal → `JournalPage` | | `type: day\|workout\|week`, `q`, `tag` |
| `/settings` | settings → `SettingsLayout` (must render `<Outlet/>`); `/settings` redirects to `/settings/profile` | | |
| `/settings/profile` · `zones` · `sports` · `garmin` · `sync` · `appearance` · `data` · `shortcuts` | settings → `SettingsProfilePage` · `SettingsZonesPage` · `SettingsSportsPage` · `SettingsGarminPage` · `SettingsSyncPage` · `SettingsAppearancePage` · `SettingsDataPage` · `SettingsShortcutsPage` | | sync: `status: ok\|error\|running` |
| `/welcome` | welcome → `WelcomePage` (bare) | | |
| `/login` | welcome → `LoginPage` (bare) | | `redirect` |
| `/dev/gallery`, `/dev/morph`, `/dev/morph/$id` | `shell/dev/pages` | | |
| `/dev/charts` | `@/charts/Gallery` (default export) | | |

Param parsing rejects malformed params (redirect to `/calendar`). Search schemas live in `shell/search.ts`
(`calendarSearch`, `newWorkoutSearch`, …) with inferred types (`NewWorkoutSearch`, …).
No auth guard yet: the data layer adds `beforeLoad` checks (e.g. on `/_app`) when the API exists.

## Typed links (`@/shell/links`)

```tsx
<Link {...links.workout(id)}>…</Link>            navigate(links.calendarDay('2026-11-24'))
links.newWorkout({ date, sport: 'run', from: 'tpl_1' })   links.calendarWeek('2026-W48')
links.trends({ range: '6m' })   links.activity(id)   links.week(isoWeek)   links.template(id)   links.settingsZones()
```
Plain `<Link to="/calendar/day/$date" params={{ date }}>` is fully typed too.

## View transitions

`defaultViewTransition: { types: vtTypes }` (`src/motion/vt-types.ts`) types every navigation:
`forward` / `back` (path depth, and any history POP is `back`), `lateral` (rail hops and siblings),
calendar `zoom-in` / `zoom-out` (month → week → day by path level) and `page-next` / `page-prev` (same level,
later/earlier anchor — param or `?date=`), `morph` (a workout card is in flight), `reduced`. Search-only
changes on non-calendar pages return `false` (animate in-page with Motion). CSS lives in
`src/styles/view-transitions.css`. To force types for one link: `<Link viewTransition={{ types: ['zoom-in'] }}>`
— never call `startViewTransition` yourself.

## Shell services

- **Shortcuts** (`@/shell/shortcuts`): `useShortcut('nav.calendar', fn)` or raw keys `useShortcut('m', fn)`;
  specs: `mod+k`, `g c` (sequence), `shift+w`; last mounted handler wins; ignored while typing unless the combo
  has mod/ctrl/alt. Add feature shortcuts to the central list with `defineShortcuts([...])` at module load so
  `/settings/shortcuts` lists them (calendar keys are already defined; attach handlers in the calendar).
  Global: ⌘K / `/` palette, `?` shortcuts page, `n` new workout, `[` rail, `g t/c/r/a/l/j/s`, ⌘Z undo,
  ⇧T theme.
- **Theme** (`@/shell/theme`): `useTheme()`, `setTheme('dark'|'light'|'system')`, `toggleTheme()`.
- **Motion pref** (`@/motion/prefs`): `useMotionPref()`, `setMotionPref('system'|'full'|'reduced')`.
- **Units** (`@/lib/units`): `useUnits()`, `setUnits({ system, swim })` (per device until Settings syncs it).
- **Sync dot** (`@/shell/sync`): `setSyncStatus({ state: 'idle'|'syncing'|'error'|'offline', lastSyncAt })`.
- **Focus**: after each path change the shell focuses `main [data-page-title]` (PageHeader's h1); on Back it
  returns focus to the element with `data-morph-id` = the last morph target.
- **CSS vars**: `--rail-w` (0 / 64 / 232), `--bottom-bar-h` (64 on mobile), `--header-h` (52).
