# Brief for feature-page engineers

You are building one area of **Cadence**, a personal training platform that replaces TrainingPeaks for
one self-coached multi-sport athlete. The owner's words: *smooth; no cursive fonts; no cheesy logos;
black, white and one accent; pages over modals; an amazing calendar; easy trends and week-over-week
progression; mark main workouts and intensity; leave notes; the UI must be animated, morphing and
absolutely stunning; a complete, top-notch product.* Your pages are what they will see when they
wake up. Build something you would be proud to demo.

## Read before writing code (in this order)

1. `docs/ARCHITECTURE.md` — precedence rules, SPA layout, toolchain, resolved UI decisions.
2. `apps/web/src/ui/README.md` — the design-system catalogue, motion rules, shared-element registry
   and the "how to build a page" recipe. **Use these primitives; do not re-implement them.**
3. `apps/web/src/charts/README.md` — the chart kit (every chart you need already exists).
4. `apps/web/src/shell/README.md` — route table: the exact export names your `pages.tsx` must keep,
   params/search schemas, typed `links`, shortcuts registry, palette sources.
5. `docs/research/design.md` §1, §2.4, §5.3–5.4, §9 (direction, encodings, motion tokens, signature
   moments, the 20-rule consistency contract) and the `docs/research/product.md` sections named in
   your task.
6. Data: `packages/core/src/domain.ts` (types), `apps/web/src/lib/api.ts` (typed client:
   `call(api.workouts[':id'].$get({ param: { id } }))`), `apps/web/src/lib/query.ts` (query keys,
   `invalidateTraining`), `apps/web/src/lib/queries/shared.ts` (auth, settings, thresholds, Garmin
   status) and `apps/web/src/lib/queries/training.ts` (calendar window, card view-models, optimistic
   workout/activity mutations). Read the Worker route files for the endpoints you call
   (`apps/web/worker/routes/*.ts`) — they are the source of truth for request/response shapes; the
   client is fully typed from them, so let the types guide you.
7. Logic you can call in the browser: `@cadence/core/workout` (structure editing, estimates, text
   syntax, titles), `@cadence/core/metrics` (zones, formatting-free math), `@cadence/core/time`.

## Rules

- **Ownership.** You own only `apps/web/src/features/<your features>/**`. Replace the placeholder
  `pages.tsx` wholesale but keep every export name. Feature folders never import each other. Shared
  code (`src/ui`, `src/charts`, `src/shell`, `src/lib`, `src/motion`, `worker/**`, `packages/**`) is
  not yours: if something is missing, build it inside your feature folder; if something shared is
  *broken*, you may make a minimal, backwards-compatible fix (re-read the file immediately before
  editing — other engineers are working in parallel — and never rename or remove exports) and list
  it in your report. Never change git state (no add/commit/stash/checkout).
- **Design contract.** Tokens only (no literal colours), one hue (Signal Green = done, load, today,
  key, the single primary action), no shadows, tabular numerals, type scale and spacing from the
  system, timing only from `@/motion/tokens`. No modals: the command palette is the only overlay;
  popovers only for small pickers; destructive actions are immediate with `toast.undo`. Every page
  uses `Page` + `PageHeader`. Encode sport/intensity/compliance without colour first.
- **Motion is part of done.** Pages choreograph in (stagger), numbers tick, lists reflow with
  `layout`, selected states slide with `layoutId`, cards morph into their detail page through the
  shared-element helpers, charts draw in and morph between ranges, and everything respects reduced
  motion. Smoothness beats flash: 60 fps, transform/opacity only, no layout thrash.
- **States.** Every data view has a skeleton (matching the final layout), an empty state with one
  clear action, and an inline error state with retry. Mutations are optimistic with rollback.
- **Responsive.** Works at 1440×900, 1024×768 and 390×844. Keyboard accessible; visible focus.
- **Units & dates.** SI in data; format with `@/lib/format` + `useUnits()`. Dates are `LocalDate`
  strings; "today" comes from API responses (`today` fields), not the browser clock.
- Register page shortcuts with `defineShortcuts`/`useShortcut` and palette commands with
  `usePaletteSource` where they add real value.

## Running and verifying (mandatory — iterate until it looks premium)

A seeded demo database (12 months of a realistic triathlete's training, synced through the real
pipeline) is prepared at `apps/web/.wrangler/seed-master`. Copy it for your own isolated server and
never write to the master. If it does not exist yet, write code first and check again every few
minutes; do not run the seed yourself.

```bash
cd /home/user/workerpool/apps/web
export WRANGLER_SEND_METRICS=false CI=1
rm -rf .wrangler/<name> && cp -r .wrangler/seed-master .wrangler/<name>
CF_PERSIST_TO=.wrangler/<name> VITE_CACHE_DIR=node_modules/.vite-<name> npx vite dev --port <port> --strictPort   # background
# … when finished:
pgrep -f "vite.js dev --port <port>" | xargs -r kill
```

Sign in with the passphrase `cadence-demo` (POST `/api/auth/login {"passphrase":"cadence-demo"}` or
through the login page; reuse the cookie in Playwright via `context.request` or by logging in
through the UI once). The demo "today" is 2026-11-21.

Drive the app with Playwright (pre-installed: `require('playwright')` from any directory,
`chromium.launch()` needs no options, never run `playwright install`). Take screenshots
(deviceScaleFactor 1) of every page and state you build at the three viewport sizes, in dark and
light themes, and **look at them** with the Read tool. Check hover/drag/keyboard interactions with
scripted input, check the browser console for errors, and fix what you see: spacing, alignment,
overflow, truncation, contrast, empty areas, anything that looks generic or unfinished. Compare
against the references in design.md §1. Keep your scripts and screenshots under
`/tmp/claude-0/-home-user-workerpool/95450b7c-aa38-58a3-92a7-f1020174cae7/scratchpad/<name>/`.

Typecheck with `npx tsc -p tsconfig.app.json` (clean for your files; ignore other engineers'
in-progress errors) and make sure `npx vite build` succeeds before you finish.

## Report (≤ 300 words)

What you built (pages, notable interactions), anything you could not finish, shared-code fixes you
made, API gaps or bugs you found in the Worker (exact endpoint + symptom), and the screenshot paths
that best show your work.
