# Cadence design v2 — "quiet"

**Status: binding.** Where this document and `docs/research/design-principles.md` differ (the month
chip keeps a neutral key star and a hard-session dot; the page container is 1120px), this document wins.
It overrides `docs/research/design.md`, `apps/web/src/ui/README.md` and
`docs/FEATURE_BRIEF.md` wherever they disagree. The reasoning and sources are in
`docs/research/design-principles.md`.

The owner's verdict on v1: *"The UI feels a bit too crowded, and the green is too vibrant. I don't like
this color schema."* v1 was pure black + neon green, tracked uppercase mono labels everywhere, a bordered
card around every block, and it showed every number it had. v2 keeps the structure, the routes, the data
and the motion, and changes what is on screen: **less at once, softer colour, more air.**

## 1. The six rules everything else follows

1. **One thing per view is the hero.** Each page answers one question first (Today: *what do I do today
   and am I fresh?* Calendar: *what is my week/month?* Trends: *am I progressing?*). That answer gets
   size and space. Everything else is secondary (smaller, `fg-2/3`) or one click/hover away.
2. **Show less, disclose more.** A number is on screen only if the athlete acts on it at that zoom level.
   Details live in the next level down: hover card → week/day page → workout/activity page.
3. **Space groups, borders don't.** Grouping is done with whitespace and, when needed, one surface step.
   No borders around cards, no cards inside cards, no divider where a gap works.
4. **Colour is rationed.** Neutrals carry the interface. The accent means only: the one primary action of
   a page, "today/now", the current selection, and — inside data — the hero series of a chart and the
   intensity ramp. Never "done", never Load or other body numbers, never key-session stars (neutral),
   never a large filled area, never decoration. Aim for ≤ 5 accent marks per viewport outside charts
   and the calendar's hard-session dots.
5. **No coloured edge stripes. Ever.** No accent (or any coloured) left/right rails, top lines or
   bottom lines on cards, cells, chips, tiles, rows, banners, toasts or the today column. State and
   emphasis are shown by a surface step, text colour/weight, a small glyph or a dot — never by a stripe
   along an edge. (The owner called this out by name: it reads as generic AI-generated UI.) The only
   lines allowed are neutral hairline dividers and a neutral tab/segment indicator.
6. **Words look like words.** Labels are sentence case in the UI sans. No tracked uppercase, no
   monospace for labels or numbers. Numbers use the sans with tabular figures.

## 2. Colour

Tokens keep their names (`canvas`, `surface-1..3`, `surface-active`, `fg-1..4`, `line-1..3`, `accent*`,
`z1..z7`, `ramp-*`); only values change, in `apps/web/src/styles/app.css`. Use tokens only.

- **Canvas is a soft near-black, not `#000`** (`oklch(0.165 0.006 h)`); text is off-white (L 0.93), not
  `#fff`. Neutrals carry a trace of the accent hue (`--hue`) so the UI feels of a piece. No colour on
  screen has chroma above 0.13 (v1's green was 0.22).
- **Surfaces step lighter with depth** (canvas → surface-1 → surface-2). A card is a `surface-1` fill with
  no border. `line-1` is for the rare divider and table row rules; `line-2` for inputs and outlined
  controls; `line-3` for hover/focus of those. Nothing else gets a border.
- **Accent** is a calm, medium-chroma hue (see app.css; three options ship — blue, green, rose — selected in
  Settings → Appearance via `<html data-accent>`). Budget: ≤ ~5% of the pixels of any screen.
  - Allowed: primary button (max one per page; the rail's "New workout" is neutral), today marker,
    the current selection where a surface step is not enough, focus ring, the hero chart series (line +
    a ≤ 12% alpha area fill), and the zone ramp `z1..z7` (now an **opaque** one-hue lightness ramp; pair
    it with a label, height or position — never colour alone).
  - Not allowed: Load / Fitness / any stat numbers (they are `fg-1`), "done" states (neutral, see §5),
    coloured rails/stripes on any edge (rule 5), decorative sparklines in tiles, borders, large filled
    blocks, glows.
- **Status without colour:** done = solid neutral mark, planned = hollow/quiet, missed = struck + dimmed.
  Warnings use an icon + `fg-1` text. No red/amber.

## 3. Typography

Two families remain installed, but **Geist Mono is only for**: the workout text-syntax editor, keyboard
hints (`Kbd`), and code-like values (API keys, IDs). Everything else — including every number — is Geist
with `tabular-nums`.

- **Closed scale: 12 / 13 / 14 / 16 / 20 / 28 px plus one display size, 44 px. Weights 400 / 500 / 600
  only** (no arbitrary `font-[520]`-style weights). Tokens: `title-1` 28 page titles · `title-2` 20 ·
  `title-3` 16 semibold section and card titles · `body-lg` 16 · `body` 14 (default) · `body-sm` 13 ·
  `label` 12 medium · `stat-sm` 16 · `stat-md` 20 · `stat-lg` 28 · `stat-xl` 44 (one per page at most). `text-micro` is now an alias of `label` (12px, no tracking);
  **remove the `uppercase` class wherever it is paired with labels, eyebrows, column headers, legends,
  axis text and chips.** `text-mono` / `text-mono-sm` resolve to the sans sizes `body-sm` / `label`; drop
  `font-mono` except for the three allowed uses.
- Hierarchy comes from **colour and weight before size**: value `fg-1` 560, label `fg-3` 420, supporting
  text `fg-2`. At most three text sizes inside one card.
- A stat is `label` above, value below, optional one-line context under it. Never label + value + unit +
  delta + sparkline + progress bar + caption in one tile; pick value + **one** piece of context.
- Units are `fg-3`, same size as the value or one step down, separated by a thin space.

## 4. Space and layout

4px base; use these steps: 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64.

- Page: max content width 1120px (`max-w-page`), side gutters 24 (mobile 16, ≥1280: 48). Page title block
  has 32–40px above and 32px below.
- **Between sections: 56–64px.** Between a section title and its content: 16–20px. Between sibling cards
  in a grid: 16–24px.
- Card padding 24 (20 on mobile). Card radius `lg` (14px). No border, no inset hairline, no spotlight
  glow on static cards (spotlight only on cards that are links).
- One control row per page header. Secondary filters go in a single "Filter" popover or a second row that
  appears only when a filter is active. No stacked rows of segmented controls + chips.
- Tables: row height 44, no zebra, `line-1` row rules only, header labels `label fg-3` sentence case, max
  6 columns at 1440 (others move to the detail page).
- Prefer fewer, larger blocks: 3–4 tiles in a row, not 8; one chart per section, not a chart plus three
  inline legends and a caption. Target: no more than ~7 distinct blocks visible in one 1440×900 viewport.

## 5. Component rules

- **Workout chip (month view): exactly one line, 28px.** `sport glyph · title (truncated) · duration`.
  A key session has a semibold `fg-1` title and a small **neutral** star before the duration. No border. Done → `surface-2` fill, `fg-1` text, a small solid neutral check/dot is
  implied by the fill. Planned (future) → transparent, `fg-2` text. Missed → `fg-4`, struck through.
  Intensity → only hard sessions (threshold and above, and races) carry one small dot (6px) before the
  duration, toned from the upper zone ramp; easy and moderate sessions show nothing. This is the only
  tint a chip carries. **No edge bar.** No pips, no sparkline, no compliance bar, no note/Garmin icons, no load, no distance at this zoom.
  Everything removed is shown in a **hover card** (and on the week/day views).
- **Workout card (week view / lists):** two lines — title; then `duration · distance or load` in `fg-3`.
  Intensity dot (as on the chip), star at right, a compliance mark only when it deviates (partial /
  missed / over). No left rail. Step-profile sparkline only on the workout's own page and the Today page.
- **Week summary (calendar right column): three lines.** Week label + phase name (`W47 · Run base`);
  hours done as the hero with `of 9:45` in `fg-3` and one thin progress bar; then `Load 464 · Form −6`
  in `fg-2`. One WoW delta badge at most. Everything else (per-sport distance, key count, fitness,
  fatigue, distribution) is on the week page the summary links to.
- **Stat tile:** label, value, one context line (at most: 1 hero number + 2 supporting figures). Each
  fact appears once per view — do not repeat a number in a subtitle, a gauge and a tile. No border; either sits directly on the canvas in a row
  separated by whitespace, or the whole row shares one `surface-1` card.
- **Buttons:** one accent primary per page at most. Everything else is `secondary` (surface fill) or
  `ghost`. Rail "New workout" = neutral secondary.
- **Gauges, dials and rings** are chartjunk for a single number: prefer the number plus a thin bar. Keep
  at most one ring/dial in the whole product where it earns its place.
- **Charts:** at most 3 horizontal gridlines (`line-1`), no vertical gridlines, no axis lines, axis text
  `label fg-3` sans, direct labels instead of legends where possible, one accent series; comparison
  series neutral (`fg-3`/`fg-4`). No uppercase annotations. Generous inner padding. Tooltips on hover carry
  the precise numbers.
- **Rail:** wordmark, search, New workout (neutral), six nav items, sync status, settings. Active item =
  `surface-2` pill + `fg-1`; inactive = `fg-3`. No borders.
- **Empty/quiet areas are fine.** Do not fill space because it is available.

## 6. Motion

Unchanged: tokens from `@/motion`, View Transitions between routes, `layout`/`layoutId` in pages, reduced
motion respected. Calmer look ≠ less motion; keep the morphs, tickers and staggered entrances. Remove
only decorative effects that add noise (pulsing "live" dots outside the sync indicator, spotlight glows on
non-interactive cards).

## 7. What "done" looks like for a redesigned page

1. Squint/blur test at 1440×900: one focal point, clear groups, ≥ 30% of the viewport is empty canvas;
   under an 8px blur only the title, ≤ 3 hero numbers and the primary action stay identifiable. Count
   the numbers above the fold: Today ≤ 12, a tile ≤ 3, a month-view week summary ≤ 3.
2. Count the accent: a handful of small marks plus at most one button and one chart series.
3. No tracked uppercase, no mono numbers, no bordered card, no card in a card, **no coloured stripe on
   any edge of anything**.
4. Nothing was deleted from the product: every removed datum is reachable by hover or one click.
5. Works at 1440×900, 1024×768, 390×844, dark and light, all three accents. Keyboard and screen-reader
   names unchanged (keep `aria-label`s, headings and link names stable — the e2e suite and the demo
   recording script rely on them; list any visible string you had to rename in your report).
