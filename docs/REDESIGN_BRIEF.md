# Brief for the v2 redesign engineers

Cadence v1 is feature-complete and tested. The owner looked at it and said: **"The UI feels a bit too
crowded, and the green is too vibrant. I don't like this color schema. Research proper design
principles and do it right."** You are redesigning one area so that it is calm, spacious and clearly
hierarchical, without removing any capability. This is a design job done in code: judgement and
iteration on screenshots matter more than line count.

## Read first (in this order)

1. `docs/DESIGN_V2.md` — **binding**. The five rules, colour budget, type, spacing, component rules, and
   the definition of done (§7).
2. `docs/research/design-principles.md` — the research behind it (principles with sources, exemplars, the
   v1 audit). Use it to make judgement calls DESIGN_V2 does not cover.
3. `apps/web/src/ui/README.md`, `apps/web/src/charts/README.md`, `apps/web/src/shell/README.md` — the
   kits you build with (their *visual* statements are superseded by DESIGN_V2; their APIs stand).
4. `docs/FEATURE_BRIEF.md` — "Rules" and "Running and verifying" still apply (ownership, no modals,
   states, responsive, units, how to run an isolated seeded server, Playwright screenshots).

## What already changed (do not redo)

- `src/styles/app.css` tokens: soft near-black canvas, off-white text, faintly cool neutrals; a calm
  accent driven by raw `--accent*` variables with three options (`<html data-accent="blue|green|rose">`,
  blue default); `accent-a*` and `z1..z7` are `color-mix()` of the accent; smaller title sizes;
  `text-micro` = label size without tracking; `text-mono*` are size-only tokens; hairline inset shadow
  removed; page container 1120px.
- A codemod removed every `uppercase` and `font-mono` class from `src/**` (except `Kbd`). Re-add
  `font-mono` only for the workout text-syntax editor and code-like values. Text written in capitals in
  source strings, `.toUpperCase()` calls and SVG `textTransform` still need fixing by the owner of each
  file.

## How to work

1. **Look before you cut.** Start your server, screenshot every page/state you own at 1440×900 and
   390×844, and write yourself a short audit per page: what is the one question this page answers, what
   is the hero, which elements are secondary, which can move behind hover/click, which are pure chrome
   (borders, labels, legends, captions, icons) that can go.
2. **Redesign top-down**: page layout and spacing → blocks → components → details. Prefer deleting and
   merging blocks over restyling them. Typical moves: 8 tiles → 3–4; three filter rows → one; a legend
   → direct labels; a caption → nothing; a bordered card → whitespace; nested cards → one surface;
   a row of five icons on a card → one; per-item detail → a hover card.
3. **Nothing is lost**: anything you remove from a view must remain reachable (hover card, tooltip,
   detail page, a "More" disclosure). Say where in your report.
4. **Keep it alive**: keep the route morphs, tickers, staggered entrances, `layout` animations and
   drag-and-drop working. Calm is about content, not about removing motion.
5. **Iterate on screenshots** until each page passes DESIGN_V2 §7 — squint test, accent count, no tracked
   caps / mono numbers / bordered cards / nested cards — in dark and light, with `data-accent` blue and
   one other. Compare your "before" and "after" side by side; if the after is not obviously calmer,
   keep going.

## Constraints

- Own only the paths in your task. Shared code is someone else's; other engineers are editing in
  parallel, so re-read a shared file right before any unavoidable minimal fix and list it in your report.
  Never change git state.
- Do not change routes, API calls, query keys, data shapes or exported component names/props that other
  folders use (add optional props if needed). Keep `aria-label`s, headings, link/button names and
  `data-*` hooks stable: `apps/web/e2e/smoke.spec.ts` and `apps/web/scripts/demo/tour.mjs` depend on
  them. If you must rename a visible string or remove an element those files use, grep both files and
  list the change in your report.
- Tokens only; timing only from `@/motion`.
- Before finishing: `npx tsc -p tsconfig.app.json` clean for your files, `npx vite build` succeeds, no
  console errors on your pages, your dev server is killed.

## Report (≤ 300 words)

Per page: what you removed/merged and where it lives now; anything unfinished; shared-code fixes;
renamed strings/selectors; the 4–6 screenshot paths that best show before → after.
