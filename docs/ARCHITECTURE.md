# Cadence — architecture & build contract

Cadence is a personal training platform for one self-coached multi-sport athlete: plan on a calendar,
push structured workouts to Garmin, pull completed activities back, and read trends at a glance.
Hosted on Cloudflare (one Worker + D1), tested locally with Miniflare.

This file is the contract every contributor (human or agent) builds against.

## Precedence when documents disagree

1. `packages/core/src/domain.ts` — types, field names, units. Always wins.
2. This file — structure, ownership, API surface, decisions.
3. `docs/research/design.md` — everything visual and motion (tokens, springs, component anatomy, the
   20-rule consistency contract in §9). It overrides any visual suggestion in product.md.
4. `docs/research/product.md` — features, page content, interactions, copy.
5. `docs/research/metrics.md`, `garmin.md`, `cloudflare.md` — domain references.

Resolved conflicts:
- **Accent is Signal Green** (`#34f47a` dark). Black, white, one green. No orange, no accent presets,
  no second hue anywhere (errors included). product.md's "Signal Orange" and accent picker are void.
- **What green means** (design.md rule 4): completed/compliant work, load, today/live/selection, key
  workouts, and the single primary action per page. Compliance *nuance* (short/long/missed/excused/
  unplanned) is encoded with fill, outline, hatch and glyph as in product.md §3.6.4.
- **No drop shadows** — product.md's "lift + shadow on hover" becomes a surface step + hairline.
- **Pages, not modals.** The command palette is the only overlay. Destructive actions are immediate
  with an undo toast.
- Naming in UI: Load, Fitness, Fatigue, Form, Ramp, Weighted Power, Intensity (never TSS/CTL/ATL/TSB).

## Repository layout

```
packages/core      @cadence/core    pure isomorphic TS (no platform APIs)
  src/domain.ts                     canonical zod schemas + types
  src/time.ts                       LocalDate / ISO-week helpers
  src/metrics/**                    load, power, pace, zones, fitness model, weekly summaries
  src/workout/**                    structure utils, estimates, text syntax, compliance, pairing
packages/garmin    @cadence/garmin  Garmin client (Personal API + Connect), FIT parsing, mapping,
  src/mock/**                       offline fake Garmin (tests + demo mode)
  src/synth/**                      deterministic synthetic athlete (history, FIT encoder)
apps/web           the deployable   Vite + @cloudflare/vite-plugin
  worker/**                         Hono API, D1 repositories, sync engine, cron, demo mode
  migrations/**                     D1 SQL migrations
  src/**                            React SPA (see below)
  test/**                           Worker tests in Miniflare (vitest-pool-workers)
  e2e/**                            Playwright journeys against the local dev server (demo mode)
docs/              research + this contract
```

### SPA layout (`apps/web/src`)

```
styles/     app.css (Tailwind v4 @theme tokens), view-transitions.css
motion/     tokens.ts (springs/durations — the only source of timing), helpers
ui/         design-system primitives (Button, Segmented, Tabs, Field, Toast, CommandPalette, …)
charts/     chart kit (SVG + d3 + Motion; canvas for 1 Hz streams)
lib/        api client, query hooks, formatters (units, durations, pace), stores
shell/      app shell: rail, top bar, mobile tab bar, command palette wiring, router
features/
  calendar/   month / week / day / agenda, weekly summary column, drag & drop, quick add
  workouts/   planned workout page + builder (visual ⇄ text), new workout
  activities/ activity list + analysis page
  trends/     overview + fitness / volume / intensity / peaks / wellness
  week/       weekly review + plan next week
  today/      daily cockpit
  library/    templates
  journal/    notes feed
  settings/   profile, zones, Garmin, sync log, appearance, data
  welcome/    first-run onboarding
```

Feature folders never import from each other; shared things move down into `ui/`, `charts/`, `lib/`.

## Runtime architecture

- **One Worker** serves the SPA (static assets, SPA fallback) and the JSON API under `/api/*` (Hono).
- **D1** holds everything, including activity streams as a gzip-compressed *columnar* JSON BLOB
  (one row per activity; a 3 h 1 Hz ride ≈ 135 KB gzipped, far below D1's 2 MB row limit — never
  store streams as row-per-sample or uncompressed JSON). No R2/Queues/Workflows are required, so
  the only resource to create is one D1 database. No interactive transactions — use `db.batch`.
  Max 100 bound parameters per statement: chunk multi-row inserts.
- **Cron Trigger** runs the Garmin sync (incremental pull, wellness, auto-push of upcoming planned
  workouts, one backfill step). Backfill is a resumable cursor stored in D1, advanced by cron and by
  an explicit "continue" API call, so it works on the free plan (no Queues required).
- **Auth**: single user. First visit sets a passphrase (PBKDF2 hash in D1); login issues an
  HMAC-signed, HttpOnly session cookie. All `/api/*` except `/api/auth/*` and `/api/health` require it
  (or, for native clients, an `Authorization: Bearer cad_…` device token — `docs/MOBILE_API.md`;
  `GET/DELETE auth/devices…` are protected too).
- **Secrets**: `SESSION_SECRET`, `ENCRYPTION_KEY` (AES-GCM for Garmin credentials at rest).
  PBKDF2 is capped at 100 000 iterations in production Workers (local workerd does not enforce it).
- **Plan note**: parsing a 3 h FIT file costs 20–55 ms CPU; the Workers Free plan allows 10 ms per
  request, so the $5 Workers Paid plan is the supported target.
- **Demo mode** (`DEMO_MODE=1` var): the Garmin base URLs point at the in-process mock
  (`@cadence/garmin/mock` serving `@cadence/garmin` synth data), and `POST /api/demo/seed` loads the
  synthetic athlete's plan/notes/events and runs the *real* sync pipeline against the mock. E2E tests
  and the product demo run this way; nothing demo-specific leaks into the production code paths.

### Ingest pipeline (same for Garmin, FIT upload, demo)

```
Garmin summary ─┐
FIT bytes ──────┼─▶ parse (garmin/fit) ─▶ normalize ─▶ metrics (core/metrics.computeActivityMetrics,
manual entry ───┘                                       thresholds effective on the activity date)
   ─▶ upsert activity + streams ─▶ auto-pair with planned (core/workout.pairActivities)
   ─▶ invalidate nothing: fitness/weekly aggregates are computed on read from per-day loads
```

Fitness/Fatigue/Form and week summaries are derived on read (a few hundred rows) — never stored.
Changing a threshold triggers a recompute of affected activities' metrics from stored streams.

## API surface (`/api`, JSON, camelCase, zod-validated; errors `{ error: { code, message } }`)

Exported as a typed Hono app (`AppType`) so the SPA uses `hc<AppType>` end-to-end types.
Module ownership and cross-module function signatures: `apps/web/worker/CONTRACT.md`.

| Area | Endpoints |
|---|---|
| auth | `GET auth/status` → `{ configured, authenticated, demo }` (cookie or bearer) · `POST auth/setup` · `POST auth/login` · `POST auth/logout` · `POST auth/change {current,next}` (revokes all sessions and device tokens) |
| devices | `POST auth/devices {passphrase,name,platform}` → `201 { token, device }` (open; login throttle) · `GET auth/devices` → `{ devices }` · `DELETE auth/devices/:id` · `DELETE auth/devices/current` — native-client bearer tokens, see `docs/MOBILE_API.md` |
| mobile | `GET mobile/snapshot` → `MobileSnapshot` (widgets / app first paint; see `docs/MOBILE_API.md`) |
| calendar | `GET calendar?from&to` → `CalendarResponse` (weeks fully covering the range, one extra prior week computed for WoW) |
| workouts | `GET workouts?from&to` · `POST workouts` · `GET/PATCH/DELETE workouts/:id` · `POST workouts/:id/duplicate {date}` · `POST workouts/:id/repeat {weeks}` · `POST workouts/:id/skip {reason}` · `POST workouts/:id/pair {activityId}` · `DELETE workouts/:id/pair` · `POST workouts/quick {date,text}` (quick-add grammar) · `POST workouts/estimate {sport,structure}` (planned totals preview) |
| bulk | `POST calendar/copy-week {from,to,progressionPct}` · `POST calendar/shift {fromDate,days}` · `POST calendar/restore {workouts}` (undo support: re-insert deleted items verbatim) |
| activities | `GET activities?from&to&sport&q&limit&cursor` · `GET activities/:id` → `ActivityDetail` · `GET activities/:id/streams` → `ActivityStreams` · `PATCH activities/:id` (`ActivityPatch`) · `DELETE activities/:id` · `POST activities/manual` · `POST activities/upload` (FIT body) |
| templates | `GET/POST templates` · `GET/PATCH/DELETE templates/:id` · `POST templates/:id/schedule {date}` · `POST templates/from-workout/:id` |
| furniture | CRUD for `events`, `phases`, `markers` · `PUT/DELETE day-notes/:date` · `GET/PUT week-notes/:isoWeek` · `GET/PUT wellness/:date` (manual check-in fields) |
| trends | `GET trends/fitness?from&to` → `FitnessDay[]` (+ per-sport variants via `&sport`) · `GET trends/weekly?weeks&end` → `WeekSummary[]` · `GET trends/peaks?sport&ranges` → power curve / best efforts per range · `GET trends/intensity?weeks` · `GET trends/wellness?from&to` (days + HRV baseline band) · `GET trends/consistency?days` (per-day load/duration heatmap) · `GET trends/thresholds` (history) |
| week | `GET weeks/:isoWeek` → summary, items, key sessions, compliance, notes, next-week preview |
| today | `GET today` → today's planned/done, readiness, form, week strip, next event |
| journal | `GET journal?cursor&type&q` → unified feed of day notes, workout notes, week reflections |
| search | `GET search?q` → workouts, activities, templates, dates (command palette) |
| settings | `GET/PATCH settings` · `GET/POST thresholds` · `DELETE thresholds/:id` · `GET zones?date` (computed zone tables per sport) |
| garmin | `GET garmin/status` · `POST garmin/connect {apiKey?, tokensJson?}` · `DELETE garmin/connect` · `POST garmin/sync` · `POST garmin/backfill {months}` · `POST/DELETE garmin/push/:workoutId` · `GET sync/log` |
| data | `GET export/json` · `GET activities/:id/export.csv` |
| demo | `POST demo/seed` · `POST demo/reset` (only when `DEMO_MODE=1`) |

## Toolchain (verified in this sandbox — see docs/research/cloudflare.md)

- wrangler 4.166 · vite 8.3 + `@cloudflare/vite-plugin` 1.70 (API runs in workerd inside `vite dev`)
  · vitest 5.1 + `@cloudflare/vitest-plugin` 1.9 (tests run in workerd; `cloudflare:test`,
  `cloudflare:workers` `exports.default.fetch`) · TypeScript 7 in `apps/web` · React 19.3 ·
  Tailwind 4.3 · Hono 4.13 · zod 4.6 · Playwright 1.65 (`PW_CHROMIUM_PATH=/opt/pw-browsers/chromium`).
- `compatibility_date` stays at `2026-11-15` (the vite plugin's workerd is slightly older than wrangler's).
- Always export `WRANGLER_SEND_METRICS=false CI=1` when running wrangler/vite/vitest here.
- From `apps/web`: `pnpm test` (Worker tests) · `pnpm typecheck` · `pnpm dev` · `pnpm e2e`.
- Running several dev servers at once (parallel agents): give each its own port, D1 state and
  optimizer cache, and apply migrations to that state first:
  `wrangler d1 migrations apply DB --local --persist-to .wrangler/<name>` then
  `CF_PERSIST_TO=.wrangler/<name> VITE_CACHE_DIR=node_modules/.vite-<name> vite dev --port <port> --strictPort`.
  Stop it with `pgrep -f "vite.js dev --port <port>" | xargs -r kill` (never leave servers running).
- Outbound Garmin calls are never mocked with msw: the Garmin client takes an injected `fetch`, and
  tests/demo inject `@cadence/garmin/mock`.

## UI decisions that settle differences between the research docs

- Navigation: desktop rail = Today, Calendar, Trends, Activities, Library, Journal; Settings and the
  sync status dot pinned at the bottom. Mobile bottom bar = Today · Calendar · ＋ · Trends · More.
- Month calendar cells use the richer card anatomy and density levels of product.md §3.3–3.4
  (full / compact / chip by cell width), drawn with design.md tokens; design.md's 28 px chip is the
  "chip" density only.
- Wordmark: the word `cadence` in Geist 600, lowercase. No logo mark.

## Conventions

- TypeScript strict everywhere. No `any` in exported signatures.
- Dates are `LocalDate` strings; never serialize `Date`. "Today" comes from the user's timezone setting.
- IDs: prefixed random (`wk_`, `act_`, `tpl_`, `evt_`, `ph_`, `mk_`, `thr_`, `log_`) generated server-side.
- Optimistic UI with TanStack Query; every destructive mutation offers undo.
- Tests: pure logic in `packages/*` with vitest (node); Worker routes and sync in Miniflare via
  `@cloudflare/vitest-pool-workers`; journeys with Playwright against the dev server in demo mode.
- Each agent edits only the paths it owns and never changes git state; the orchestrator commits.
