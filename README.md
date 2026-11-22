# cadence

A personal training platform for one self-coached, multi-sport athlete. Plan on a calendar, send
structured workouts to your Garmin, pull completed activities back, and read your progress at a
glance. Built to replace TrainingPeaks for a single user, hosted on your own Cloudflare account.

- **Calendar** — infinite month view with a weekly summary column (done vs planned, load,
  fitness/fatigue/form, week-over-week change), week, day and agenda views, drag and drop, inline
  quick-add (`run 45m easy`, `bike 4x8m 95-100% @key`), copy week with progression, undo everywhere.
- **Workouts** — a visual builder and a fast text syntax kept in sync, for cycling, running,
  swimming, rowing and strength; key-session flag, intensity, notes; a template library; one click
  to send to your watch.
- **Activities** — synced from Garmin (or FIT upload / manual entry): per-sport metrics, route,
  synchronized power / heart-rate / pace / cadence / elevation charts with range selection, laps,
  time in zones, peaks, plan vs actual, RPE, feel and notes.
- **Trends** — Load, Fitness, Fatigue and Form with a projection from your plan, weekly volume by
  sport, week-over-week progression, intensity distribution, power and pace curves, wellness, a
  weekly review page and a season planner.
- Quiet by design: soft near-black or light, one rationed accent (calm blue by default; green and rose in
  Settings → Appearance), no clutter. Pages instead of modals. Everything animates. The rules are in
  `docs/DESIGN_V2.md`.
- **iOS app with widgets** (`apps/ios`) that signs in to the same server with a revocable device token.

## Repository

```
packages/core     domain types, metrics engine (load, zones, fitness model), workout logic
packages/garmin   Garmin client (Personal API + Connect), FIT parsing, mock Garmin, synthetic athlete
apps/web          the deployable: Cloudflare Worker (Hono API + D1) and the React app
apps/ios          the native iOS app and widgets (SwiftUI + WidgetKit; see apps/ios/README.md)
docs/             architecture contract and the research behind the design
```

`docs/ARCHITECTURE.md` is the map; start there.

## Run it locally

Requires Node 22+ and pnpm 10.

```bash
pnpm install
cd apps/web
cp .dev.vars.example .dev.vars            # dev secrets; DEMO_MODE=1 gives you a synthetic Garmin account
pnpm db:migrate:local
pnpm dev                                  # http://localhost:5173
```

On first visit you set a passphrase, then connect Garmin. In demo mode the "Use the demo Garmin
account" button connects to a built-in fake Garmin serving a realistic 12-month season, synced
through the real pipeline (list → FIT download → parse → metrics). To load the whole season plus the
athlete's plan, notes and races in one go:

```bash
node scripts/seed-demo.mjs --base http://localhost:5173      # passphrase: cadence-demo
```

## Tests

```bash
pnpm -r test          # 613 library tests + 214 Worker tests running in workerd (Miniflare)
cd apps/web && pnpm typecheck
PW_CHROMIUM_PATH=/path/to/chromium pnpm e2e   # Playwright smoke suite against a seeded dev server
```

Worker tests run inside the Workers runtime with a real local D1; Garmin is never mocked at the
network layer — the client takes an injected `fetch`, and tests inject the fake Garmin.

## Deploy to Cloudflare

Cadence is one Worker with static assets and one D1 database. The Workers Paid plan ($5/month) is
the supported target: parsing a multi-hour FIT file needs more CPU time than the free plan allows.

```bash
cd apps/web
npx wrangler login
npx wrangler d1 create cadence            # paste the printed database_id into wrangler.jsonc
npx wrangler d1 migrations apply DB --remote
npx wrangler secret put SESSION_SECRET    # openssl rand -base64 32
npx wrangler secret put ENCRYPTION_KEY    # openssl rand -base64 32  (encrypts Garmin credentials at rest)
pnpm deploy
```

Keep `DEMO_MODE` at `"0"` in `wrangler.jsonc` for your real instance. A cron trigger syncs Garmin
every 30 minutes; put Cloudflare Access in front of the Worker if you want a second lock on the door.

## Connecting your Garmin

Cadence uses two credentials (details in `packages/garmin/README.md`):

1. **Reading your data** — a Garmin *Personal API* key, created in Garmin Connect under
   Settings → Personal API Token. Official, read-only, yours.
2. **Sending workouts to the watch** — optional. Garmin's Personal API cannot write, so this uses
   the same private API the Garmin apps use, with a token file you generate once on your own
   computer and paste into Settings → Garmin. It is unofficial and may break if Garmin changes it;
   everything else keeps working without it.

Without Garmin at all you can still upload FIT files or log sessions by hand.

## Status and honest limits

- The Garmin integration is built from library source code and recorded fixtures and is tested
  against the fake Garmin. It has not yet been exercised against a live Garmin account — expect to
  shake out details on first connection (the checklist is at the end of `packages/garmin/README.md`).
- Rowing, hiking and skiing have no native Garmin workout type; they are sent as cardio with the
  targets in the step notes.
- Single user by design: no coach accounts, sharing or social features.
