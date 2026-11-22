# Design System and Motion Spec

Status: v1, 2026-11-21. Audience: the three frontend agents building the SPA (React 19.3 + Vite 8 + TypeScript, served from a Cloudflare Worker, Tailwind CSS v4).
This document is normative. Where it says MUST, a deviation is a bug. Claims I could not verify against a primary source are marked **UNVERIFIED**.

How things were verified (Nov 2026): package versions from the npm registry (`npm view`); APIs by reading the published package sources/types (`react@19.3.1`, `motion@14.14.0`/`framer-motion@14.14.0`/`motion-dom@14.14.0`, `@tanstack/react-router@1.170.46` + `@tanstack/router-core@1.171.39`, `react-router@8.5.2` bundled docs, `@base-ui/react@1.9.0` bundled docs, `lucide-react@1.77.0`, `@fontsource-variable/geist@5.3.0` font tables); colors and contrast computed with `culori@4.0.2`; spring curves generated with `motion-dom`'s own `spring().toString()`. Browser-support facts come from web search (sources at the end). react.dev and tanstack.com could not be fetched from this environment, so I read those libraries' published source and types instead.

---

## 0. Pinned stack (versions current on 2026-11-21)

| Concern | Package | Version | Import |
|---|---|---|---|
| UI runtime | `react`, `react-dom` | 19.3.1 | — |
| Router | `@tanstack/react-router` | 1.170.46 | `@tanstack/react-router` |
| Animation | `motion` | 14.14.0 | `motion/react` |
| Headless primitives | `@base-ui/react` | 1.9.0 | `@base-ui/react/<part>` |
| Styling | `tailwindcss` + `@tailwindcss/vite` | 4.3.5 | `@import "tailwindcss";` |
| Fonts | `@fontsource-variable/geist`, `@fontsource-variable/geist-mono` | 5.3.0 | `import "@fontsource-variable/geist";` |
| Icons | `lucide-react` | 1.77.0 | `lucide-react` |
| Drag and drop | `@dnd-kit/core` | 6.3.1 | `@dnd-kit/core` |
| Virtualization | `@tanstack/react-virtual` | 3.14.26 | `@tanstack/react-virtual` |
| Charts math | `d3-scale` 4.0.3, `d3-shape` 3.2.1, `d3-array` 3.2.5, `d3-interpolate-path` 2.3.0 | — | — |
| Dates | `date-fns` | 4.4.0 | (also Base UI's optional peer) |
| Build | `vite` 8.3.8, `@vitejs/plugin-react` 6.3.0, `@cloudflare/vite-plugin` 1.70.1, `typescript` 7.0.2 | — | — |

Notes:
- **Base UI was renamed.** `@base-ui-components/react` stopped at `1.0.0-rc.0`. The current package is `@base-ui/react` (1.0.0 shipped 2025-12-11; 1.9.0 shipped 2026-10-09). Use only `@base-ui/react`.
- `motion` 13.0.0 shipped 2026-08-05 and 14.0.0 shipped 2026-10-02. Motion's migration page says v14 has no breaking changes for React. I did not verify whether v13 had any (**UNVERIFIED**). Old Framer Motion code from blog posts works if you change the import to `motion/react`.
- No `cmdk`, `sonner`, `recharts`, `visx` or `uplot`. Section 6 and section 7 explain why.

---

## 1. Visual direction

**What makes the references feel premium.** Linear: a near-black canvas, 1px low-alpha hairlines, dense but calm type, and motion that never waits for you. Vercel/Geist: ruthless monochrome, the Geist type family, and numbers set like typography. Arc and Raycast: frosted surfaces, a single command surface, and springy, interruptible transitions. Family: physical, morphing shared-element transitions where every element knows where it came from. Amie and Notion Calendar: a calendar that feels like an object you zoom into, not a table you page through. Things 3: generous whitespace and one satisfying micro-interaction per action. Teenage Engineering: instrument-panel honesty, monospaced numerals, micro-caps labels and a single signal color. Whoop and Oura: a black canvas, one or two huge numbers, and color used only to mean something. Strava's newer charts and Apple Fitness: direct labels at line ends, charts that draw in, and rings or progress you can read at a glance.

**Our direction: "Instrument".** The product is a precision instrument for one athlete. It uses a true-black canvas with surfaces lifted by single-step luminance changes and 1px hairlines. The typography is set like a stopwatch: one neo-grotesk (Geist) with tabular numerals everywhere and a mono companion for dense data. There is exactly one hue, Signal Green, and it means "done / load / live". Nothing else is green. Every view change is a continuous physical movement: a card becomes the page, a month folds into a week, a number rolls to its new value. Ornament is zero. Delight comes from motion, density and finish, never from decoration.

**Rules (MUST):**
1. **True-black canvas** in dark theme (`#000`). Surfaces step up in luminance: canvas `gray-1` → surface-1 `gray-2` → surface-2 `gray-3` → surface-3 `gray-4`. Never more than three surface levels on screen.
2. **Hairlines, not boxes.** Borders are 1px at 6/10/16% alpha of white (dark) or black (light). Never a 2px border except focus rings and selected states.
3. **No drop shadows.** Depth comes from luminance steps, a 1px inset top highlight, and backdrop blur for floating layers. Tailwind's shadow tokens are deleted in `@theme` (section 4), so drop shadows cannot be applied by accident.
4. **The accent is a signal, not a theme.** Signal Green appears only for: completed/compliant work, training load (fitness/CTL area, TSS), live/current state (today, the active recording, the selected range), the single primary CTA per page, and key workouts. Anything that is decoration is gray.
5. **Numbers are the hero.** Key stats use the `stat-*` sizes (20–72px) with tabular numerals and tight negative tracking. Units are set in `fg-3` at 50–60% of the number's size, baseline-aligned.
6. **Micro-caps for metadata.** Labels like `TSS`, `IF`, `ZONE 4` use `text-micro` (11px, 600 weight, +0.06em tracking, uppercase, `fg-3`).
7. **Generous, concentric radii.** Inner radius = outer radius − padding. Chips use 6px, controls 10px, cards 14px, page panels 20px, the palette 28px.
8. **Morph, don't cut.** Any element that exists before and after a change MUST move continuously, through a View Transition shared name or a Motion `layout`/`layoutId`. Fades are only for things that truly appear or disappear.
9. **Pages, not modals.** Workout detail, the builder, activity analysis and settings are full routes. The command palette is the only overlay. Popovers are allowed only for small pickers (date, sport, intensity, time) under 320px wide.
10. **Monochrome encodings first.** Every distinction in data (sport, intensity, compliance, series, delta direction) MUST be readable in grayscale through glyph, label, fill density, pattern, dash or weight (section 2.4). Color only reinforces.

---

## 2. Color

### 2.1 Accent choice: Signal Green

| Criterion | Green | Blue | Pink |
|---|---|---|---|
| Semantic fit for "completed / positive load" | Native. TrainingPeaks compliance, Apple's "move" ring and "go" all prime it | Neutral. Reads as "info/link", not "done" | Reads as "alert/brand", fights "completed" |
| Luminance headroom on black | Huge: green has the highest luminance per chroma, so 14.4:1 at full saturation | 7.9:1 at L 0.70; out of sRGB gamut at higher chroma | 7.7:1; gets washed out as luminance rises |
| Usable as a chart fill at 7 opacity steps on black | Yes, steps stay distinguishable down to 14% | Low steps sink into black | Low steps look muddy |
| Light-theme story | Needs a darker variant (we define one) | Same issue | Same issue |
| Risk | Colliding with "success" semantics: that is intended, and we do not use red, so no red/green-blind pairing issue | — | — |

**Pick: green, hue 150 (a cool, slightly minty green, not lime and not emerald).** Green maximizes legibility of the opacity ladder on black, which is how we encode intensity without hues, and its meaning matches "completed / load".

### 2.2 Accent tokens (exact values; hex is the sRGB-clamped equivalent of the OKLCH)

**Dark theme (default)**

| Token | OKLCH | Hex | vs `#000` | vs `#fff` | Use |
|---|---|---|---|---|---|
| `accent` | `oklch(0.850 0.221 150)` | `#34f47a` | **14.37:1** | 1.46 | fills, lines, text, glyphs |
| `accent-hover` | `oklch(0.900 0.182 150)` | `#78ff9b` | 16.58 | — | hover on accent fills |
| `accent-press` | `oklch(0.790 0.210 150)` | `#22de6c` | 11.73 | — | pressed accent fills |
| `accent-ink` | `oklch(0.850 0.221 150)` | `#34f47a` | 14.37 | — | accent text (same as accent in dark) |
| `on-accent` | `#000000` | `#000000` | — | — | text/icons on accent fills (14.37:1) |
| `accent-a1`…`a7` | `oklch(0.850 0.221 150 / α)` with α = .06 .10 .16 .24 .40 .64 .85 | — | — | — | tints, selection, hover washes |

`accent` on surface-2 (`#151515`) = 12.49:1.

**Light theme**

| Token | OKLCH | Hex | vs `#fff` | vs `#000` | Use |
|---|---|---|---|---|---|
| `accent` | `oklch(0.640 0.175 150)` | `#06a84e` | **3.13:1** (meets the 3:1 non-text bar) | 6.72 | fills, chart marks, glyphs |
| `accent-hover` | `oklch(0.600 0.165 150)` | `#019a46` | 3.68 | 5.71 | |
| `accent-press` | `oklch(0.559 0.154 150)` | `#008c3f` | 4.35 | 4.82 | |
| `accent-ink` | `oklch(0.501 0.138 150)` | `#007835` | **5.62:1** (meets AA for text) | — | any accent-colored **text** |
| `on-accent` | `#000000` | | — | 6.72 on `accent` | black text on accent in both themes |
| `accent-a1`…`a7` | `oklch(0.640 0.175 150 / α)`, same α ladder | | | | |

Rules: in light theme, accent-colored text MUST use `accent-ink`. Never place the dark-theme accent on white: it is 1.46:1. `on-accent` is black in both themes, so it never flips.

### 2.3 Neutral ramps (12 steps, chroma 0: pure black and white)

Semantic roles (Radix-style): 1 canvas, 2 surface-1, 3 surface-2, 4 surface-3/hover, 5 active/pressed, 6 subtle border (solid), 7 border (solid), 8 strong border / disabled fg, 9 non-text graphics, 10 tertiary text, 11 secondary text, 12 primary text.

| Step | Dark OKLCH | Dark hex | Contrast vs `#000` | Light OKLCH | Light hex | Contrast vs `#fff` |
|---|---|---|---|---|---|---|
| 1 | `oklch(0 0 0)` | `#000000` | 1.00 | `oklch(1 0 0)` | `#ffffff` | 1.00 |
| 2 | `oklch(0.164 0 0)` | `#0e0e0e` | 1.09 | `oklch(0.985 0 0)` | `#fafafa` | 1.04 |
| 3 | `oklch(0.196 0 0)` | `#151515` | 1.15 | `oklch(0.967 0 0)` | `#f4f4f4` | 1.10 |
| 4 | `oklch(0.226 0 0)` | `#1c1c1c` | 1.23 | `oklch(0.949 0 0)` | `#eeeeee` | 1.16 |
| 5 | `oklch(0.256 0 0)` | `#232323` | 1.34 | `oklch(0.928 0 0)` | `#e7e7e7` | 1.24 |
| 6 | `oklch(0.285 0 0)` | `#2a2a2a` | 1.46 | `oklch(0.907 0 0)` | `#e0e0e0` | 1.32 |
| 7 | `oklch(0.325 0 0)` | `#343434` | 1.69 | `oklch(0.876 0 0)` | `#d6d6d6` | 1.45 |
| 8 | `oklch(0.402 0 0)` | `#484848` | 2.30 | `oklch(0.802 0 0)` | `#bebebe` | 1.86 |
| 9 | `oklch(0.549 0 0)` | `#717171` | 4.30 (non-text only) | `oklch(0.640 0 0)` | `#8c8c8c` | 3.36 (non-text only) |
| 10 | `oklch(0.600 0 0)` | `#808080` | **5.32** | `oklch(0.556 0 0)` | `#737373` | **4.74** |
| 11 | `oklch(0.741 0 0)` | `#ababab` | **9.14** | `oklch(0.500 0 0)` | `#636363` | **6.01** |
| 12 | `oklch(0.940 0 0)` | `#ebebeb` | **17.62** | `oklch(0.209 0 0)` | `#181818` | **17.76** |

Text tokens: `fg-1` = 12, `fg-2` = 11, `fg-3` = 10, `fg-4` = 9 (disabled text, icons, chart ticks only; never for meaningful text). `fg-3` passes AA only on canvas and surface-1 (dark: 4.62:1 on gray-3, 4.32:1 on gray-4). On surface-2 and above, meaningful text MUST use `fg-2`.

Hairlines (alpha, so they work on any surface): dark `line-1` = `rgb(255 255 255 / 0.06)`, `line-2` = `/0.10`, `line-3` = `/0.16`. Light: the same alphas of `rgb(0 0 0 / …)`.

### 2.4 Encoding categories without hue (the mapping table)

All patterns referenced below are defined once in a shared `<ChartDefs/>` SVG (`#hatch-accent`, `#hatch-fg`, `#dots-fg`) and as CSS utilities (`.bg-hatch-accent`, etc.; section 4).

**Sport types: glyph + 3–5 letter label. Never color.**

| Sport | Glyph (24px grid, stroke 1.75, round caps/joins) | Lucide name (exists in 1.77.0?) | Label |
|---|---|---|---|
| Run | Footprints | `Footprints` ✓ | RUN |
| Ride | Bike | `Bike` ✓ | RIDE |
| Swim | Waves | `Waves` ✓ (alt: `WavesLadder` ✓) | SWIM |
| Row | Crossed oars | none (`Kayak` ✓ is paddling, not rowing), so **custom** | ROW |
| Strength | Dumbbell | `Dumbbell` ✓ | STR |
| Hike | Mountain | `Mountain` ✓ | HIKE |
| Yoga / mobility | Lotus | `Flower2` ✓ (reads as a lotus at 16px; acceptable) | YOGA |
| Other | Pulse line | `Activity` ✓ | OTHER |

Lucide has no running, rowing or yoga *figure*, so we standardize on object metaphors for all eight. Custom ROW glyph (drop into `src/ui/glyphs/Row.tsx`, Lucide attributes):
```tsx
export const RowGlyph = (p: LucideProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={p.strokeWidth ?? 1.75}
       strokeLinecap="round" strokeLinejoin="round" width={p.size ?? 16} height={p.size ?? 16} {...p}>
    <path d="M4 20 15.5 8.5" /><path d="M20 20 8.5 8.5" />
    <path d="M15.5 8.5 18 4.5l1.5 1.5-4 2.5Z" /><path d="M8.5 8.5 6 4.5 4.5 6l4 2.5Z" />
    <path d="M3 14h18" opacity=".5" />
  </svg>
);
```
All sport glyphs go through one `<SportGlyph sport="run" size={16|20|24|32} />` component. Lucide's `Sparkles` and similar icons MUST NOT be used as sport glyphs.

**Intensity (7 zones). Fill density, and in profiles also height, plus a `Z1–Z7` label.**

| Zone | Name | Fill (`accent` at α) | Token | Bar-count glyph (for 12px chips) |
|---|---|---|---|---|
| Z1 | Recovery | 14% | `--color-z1` | ▮▯▯▯▯ (1 of 5 bars, 3px wide, 2px gap) |
| Z2 | Endurance | 26% | `--color-z2` | ▮▮▯▯▯ |
| Z3 | Tempo | 40% | `--color-z3` | ▮▮▮▯▯ |
| Z4 | Threshold | 55% | `--color-z4` | ▮▮▮▮▯ |
| Z5 | VO2max | 70% | `--color-z5` | ▮▮▮▮▮ |
| Z6 | Anaerobic | 85% | `--color-z6` | ▮▮▮▮▮ + 1px outline |
| Z7 | Neuromuscular | 100% + `#hatch-fg` overlay (on-accent stripes at 20%) | `--color-z7` | ▮▮▮▮▮ hatched |

The workout-level intensity selector (RPE / "easy-moderate-hard") uses 5 steps: Z1, Z2, Z3, Z5, Z7 fills.

**Compliance (planned vs completed): fill, outline, hatch, dim.**

| State | Card fill | Left rail (3px) | Border | Glyph / text | Example |
|---|---|---|---|---|---|
| Planned (future) | transparent | none | 1px `line-3` **dashed** (4/3) | `fg-2` | tomorrow's run |
| Completed, compliant (80–120% of plan) | `surface-2` | `accent` solid | 1px `line-2` | check `accent` | done as planned |
| Completed, partial (50–79% or 121–150%) | `surface-2` | `accent` **hatched** (`.bg-hatch-accent`) | 1px `line-2` | `≈` `fg-1` | cut short |
| Completed, off-plan (<50% or >150%) | `surface-2` | `fg-3` **dotted** | 1px `line-2` | `!` `fg-1` | way off |
| Missed (past, not done) | transparent | none | 1px `line-2` dashed | whole card 40% opacity, duration struck through | skipped |
| Unplanned activity | `surface-2` | `fg-1` solid | 1px `line-2` | `UNPLANNED` micro label | spontaneous ride |
| Key workout (any state) | as above | as above | as above | filled star `accent`, 12px, top-right | race-pace session |

**Multi-series charts: weight, dash and fill instead of hue.**

| Series | Mark | Stroke | Fill | End label |
|---|---|---|---|---|
| Fitness (CTL) | area + line | `accent`, 2px | linear gradient `accent` α .28 → 0 | `CTL 84` in `accent-ink` |
| Fatigue (ATL) | line | `fg-1`, 1.5px | none | `ATL 97` in `fg-1` |
| Form (TSB) | line (own lower panel, zero baseline) | `fg-3`, 1.5px, **dashed 4 3** | `fg-1` at 6% between line and 0 when < −30 (risk zone), with `#hatch-fg` | `TSB −13` in `fg-2` |
| Any projection (future) | same series | same stroke, **dashed 2 4**, 60% opacity | area becomes `#hatch-accent` at 40% | label suffixed `proj.` |
| Comparison period (e.g. last year) | line | `fg-3`, 1px, dashed 1 3 | none | `’25` |
| Rolling average | line | `fg-1`, 1.5px, solid | none | `4-wk avg` |

**Positive vs negative deltas: arrow, sign and weight. Never red/green.**

| Delta | Glyph | Sign | Weight / color | Example |
|---|---|---|---|---|
| Increase (≥ +1%) | `ArrowUpRight` 12px | `+` | 600, `fg-1` | ↗ +12% |
| Decrease (≤ −1%) | `ArrowDownRight` 12px | `−` (U+2212, never hyphen) | 400, `fg-2` | ↘ −8% |
| Flat (\|Δ\| < 1%) | `ArrowRight` 12px | `±` | 400, `fg-3` | → ±0% |
| Goal reached / good direction for load | any of the above | | adds `accent` to the **arrow only** | ↗ (green arrow) +12% |
| Warning (ramp rate > +10% WoW, TSB < −30) | `TriangleAlert` 12px | | 600, `fg-1`, value underlined with `#hatch-fg` | ⚠ +18% |

---

## 3. Typography

**Pick: Geist (UI sans) + Geist Mono (dense data), self-hosted via `@fontsource-variable/geist` and `@fontsource-variable/geist-mono` 5.3.0.** Geist is the Vercel/Linear-grade neo-grotesk, a variable font (weights 100–900), and I confirmed from the woff2 GSUB table that the Fontsource Latin subset includes `tnum`, `pnum`, `frac`, `numr`, `dnom`. Geist Mono is inherently tabular. The Fontsource build does not expose stylistic sets (`ss01`, `zero`), so don't use them. No Google Fonts CDN.

```ts
// src/main.tsx (first lines)
import "@fontsource-variable/geist";       // 'Geist Variable', normal, 100–900
import "@fontsource-variable/geist-mono";  // 'Geist Mono Variable'
```
Preload the Latin normal woff2 for both in `index.html`: Vite fingerprints the URLs, so use `?url` imports, or let the CSS discover them (acceptable: `font-display: swap`).

**Rules:**
- All numerals render with `font-variant-numeric: tabular-nums` (Tailwind `tabular-nums`). Body text sets it globally (section 4 base layer).
- Numbers 20px and up (stats, page metrics) use **Geist** sans with tnum. Numbers below 20px in data contexts (table numeric cells, chart ticks, durations in calendar chips, timestamps, kbd hints) use **Geist Mono**.
- Use the ratio slash `/` and the minus sign `−` (U+2212). Show units with a thin space: `4:05 /km`, `245 W`, `62 bpm`.

**Type scale (token → px / line-height / weight / letter-spacing / family):**

| Token (Tailwind `text-*`) | Size | Line height | Weight | Tracking | Family | Use |
|---|---|---|---|---|---|---|
| `stat-xl` | 72 | 72 (1.0) | 560 | −0.045em | sans tnum | dashboard hero number (fitness) |
| `stat-lg` | 48 | 48 (1.0) | 560 | −0.04em | sans tnum | page hero stats (activity TSS, distance) |
| `stat-md` | 32 | 36 | 560 | −0.03em | sans tnum | StatTile value |
| `stat-sm` | 20 | 24 | 560 | −0.015em | sans tnum | inline stat, week summary totals |
| `title-1` | 32 | 40 | 620 | −0.025em | sans | page title (h1) |
| `title-2` | 24 | 32 | 600 | −0.02em | sans | section heading (h2) |
| `title-3` | 18 | 26 | 600 | −0.012em | sans | card heading (h3) |
| `body-lg` | 16 | 24 | 420 | −0.006em | sans | long text, descriptions |
| `body` | 14 | 20 | 420 | −0.003em | sans | **UI default** |
| `body-sm` | 13 | 18 | 420 | 0 | sans | secondary UI, chip titles |
| `label` | 12 | 16 | 520 | 0.005em | sans | form labels, tab labels, buttons-sm |
| `micro` | 11 | 14 | 600 | 0.06em, UPPERCASE | sans | metadata caps (`TSS`, `ZONE 4`) |
| `mono` | 13 | 18 | 450 | 0 | mono | table numbers, durations |
| `mono-sm` | 11 | 14 | 450 | 0.01em | mono | chart ticks, kbd, timestamps |

Units next to stats: same family, `fg-3`, weight 450, size = 0.5× the number for `stat-xl` and `stat-lg`, 0.6× for `stat-md` and `stat-sm`.

---

## 4. Layout and spacing tokens (Tailwind v4)

### 4.1 Scales

- **Spacing:** base `--spacing: 0.25rem` (4px). The allowed steps are `0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24` (2–96px). Anything else is a lint failure.
- **Radii:** `xs` 4, `sm` 6 (chips, calendar items, kbd), `md` 10 (buttons, inputs, segmented controls), `lg` 14 (cards, tiles), `xl` 20 (page panels, the detail-page header card), `2xl` 28 (command palette), `full`.
- **Borders:** `line-1` 6% (dividers inside cards), `line-2` 10% (card and control borders), `line-3` 16% (inputs, dashed planned items, hover borders).
- **Elevation:** level 0 canvas; level 1 `surface-1` + `line-2`; level 2 `surface-2` + `line-2` + `inset-shadow-hairline`; floating = `glass` background + `backdrop-blur-glass` + `line-3` + `inset-shadow-hairline`. That's the whole elevation system.
- **Z-index** (plain CSS vars; use as `z-(--z-toast)`): `--z-sticky: 10`, `--z-rail: 20`, `--z-drag: 40`, `--z-popover: 50`, `--z-toast: 60`, `--z-palette: 70`.
- **Breakpoints:** `sm` 640, `md` 768, `lg` 1024, `xl` 1280, `2xl` 1536.

### 4.2 App shell

- **≥ 1280px (`xl`):** left rail, 232px expanded, collapsible to 64px (the state persists in `localStorage`; animate width with the `smooth` spring through Motion `layout` on the rail; labels fade at 140ms). Main area is fluid.
- **768–1279px:** rail collapsed to 64px (icons + tooltip labels), expandable as an overlay (glass), not pushing content.
- **< 768px:** a 64px bottom bar plus `env(safe-area-inset-bottom)`, glass background, 4 destinations (Calendar, Library, Trends, More). There is no rail. Page titles go in a sticky top header (48px) that compacts on scroll (scroll-driven animation, section 5.6).
- **Rail anatomy:** the wordmark at top (product name in Geist 600, 15px, −0.02em, `fg-1`, lowercase, no mark or icon); nav items 36px tall with radius `md`, a 16px icon and a `body` label; the `New workout` primary button (accent); a `⌘K` search trigger; Settings pinned at the bottom.
- **Page containers:** `max-w-page` (1200px) with `px-4 md:px-6 xl:px-10` for analysis/detail/trends; forms use `max-w-prose` (720px). The **calendar is full-bleed** (no max width). Detail pages use a 12-column grid: content `col-span-8`, aside `col-span-4` at `xl`, stacked below.

### 4.3 Calendar density

| View | Grid | Day cell | Item |
|---|---|---|---|
| Month (infinite vertical scroll by week) | 7 day columns + 1 week-summary column (`minmax(184px, 0.9fr)` at `xl`, hidden below `lg` and shown as a row under each week) | min-height 132px, padding 6px, 1px `line-1` grid lines (drawn by `gap-px` over a `line-1` background, not borders), date numeral `mono-sm` top-left, today = `accent` 20px circle with `on-accent` numeral | **chip**: 28px, radius `sm`, glyph 14px + title `body-sm` (truncate) + duration `mono-sm` right; compliance per 2.4 |
| Week | 7 columns, full height, sticky day headers | column padding 8px | **card**: min 72px, radius `md`, glyph 16, title `body`, duration/TSS row `mono`, mini intensity profile (24px high) |
| Day | single column, `max-w-prose` centered, plus a right aside with the day's metrics | — | **card** at full anatomy, intensity profile 48px |

Week-summary cell: total duration `stat-sm`, TSS `stat-sm`, a sparkline (section 6), and a compliance meter (completed/planned TSS as an accent bar on `surface-3`).

### 4.4 The `@theme` block (paste into `src/styles/app.css`)

```css
@import "tailwindcss";

/* Dark is the default. Light overrides live on <html data-theme="light">.
   data-theme MUST be on <html> because the semantic aliases below resolve on :root. */
@custom-variant light (&:where([data-theme=light], [data-theme=light] *));
@custom-variant dark  (&:where(:root:not([data-theme=light]), :root:not([data-theme=light]) *));

@theme static {
  /* Wipe Tailwind defaults so ad-hoc colors, shadows, radii, sizes and eases cannot be used. */
  --color-*: initial;
  --shadow-*: initial;
  --drop-shadow-*: initial;
  --radius-*: initial;
  --text-*: initial;
  --ease-*: initial;

  /* Absolute */
  --color-black: #000000;
  --color-white: #ffffff;
  --color-transparent: transparent;
  --color-current: currentColor;

  /* Neutral ramp (dark) */
  --color-gray-1: oklch(0 0 0);
  --color-gray-2: oklch(0.164 0 0);
  --color-gray-3: oklch(0.196 0 0);
  --color-gray-4: oklch(0.226 0 0);
  --color-gray-5: oklch(0.256 0 0);
  --color-gray-6: oklch(0.285 0 0);
  --color-gray-7: oklch(0.325 0 0);
  --color-gray-8: oklch(0.402 0 0);
  --color-gray-9: oklch(0.549 0 0);
  --color-gray-10: oklch(0.600 0 0);
  --color-gray-11: oklch(0.741 0 0);
  --color-gray-12: oklch(0.940 0 0);

  /* Semantic neutrals */
  --color-canvas: var(--color-gray-1);
  --color-surface-1: var(--color-gray-2);
  --color-surface-2: var(--color-gray-3);
  --color-surface-3: var(--color-gray-4);
  --color-surface-active: var(--color-gray-5);
  --color-fg-1: var(--color-gray-12);
  --color-fg-2: var(--color-gray-11);
  --color-fg-3: var(--color-gray-10);
  --color-fg-4: var(--color-gray-9);
  --color-line-1: rgb(255 255 255 / 0.06);
  --color-line-2: rgb(255 255 255 / 0.10);
  --color-line-3: rgb(255 255 255 / 0.16);
  --color-glass: rgb(14 14 14 / 0.72);
  --color-scrim: rgb(0 0 0 / 0.60);
  --color-focus: var(--color-gray-12);

  /* Accent: Signal Green (dark) */
  --color-accent: oklch(0.850 0.221 150);
  --color-accent-hover: oklch(0.900 0.182 150);
  --color-accent-press: oklch(0.790 0.210 150);
  --color-accent-ink: oklch(0.850 0.221 150);
  --color-on-accent: #000000;
  --color-accent-a1: oklch(0.850 0.221 150 / 0.06);
  --color-accent-a2: oklch(0.850 0.221 150 / 0.10);
  --color-accent-a3: oklch(0.850 0.221 150 / 0.16);
  --color-accent-a4: oklch(0.850 0.221 150 / 0.24);
  --color-accent-a5: oklch(0.850 0.221 150 / 0.40);
  --color-accent-a6: oklch(0.850 0.221 150 / 0.64);
  --color-accent-a7: oklch(0.850 0.221 150 / 0.85);

  /* Intensity zones = accent opacity ladder */
  --color-z1: oklch(0.850 0.221 150 / 0.14);
  --color-z2: oklch(0.850 0.221 150 / 0.26);
  --color-z3: oklch(0.850 0.221 150 / 0.40);
  --color-z4: oklch(0.850 0.221 150 / 0.55);
  --color-z5: oklch(0.850 0.221 150 / 0.70);
  --color-z6: oklch(0.850 0.221 150 / 0.85);
  --color-z7: oklch(0.850 0.221 150 / 1);

  /* Type */
  --font-sans: "Geist Variable", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "Geist Mono Variable", ui-monospace, "SF Mono", Menlo, monospace;

  --text-stat-xl: 4.5rem;   --text-stat-xl--line-height: 1;      --text-stat-xl--letter-spacing: -0.045em; --text-stat-xl--font-weight: 560;
  --text-stat-lg: 3rem;     --text-stat-lg--line-height: 1;      --text-stat-lg--letter-spacing: -0.04em;  --text-stat-lg--font-weight: 560;
  --text-stat-md: 2rem;     --text-stat-md--line-height: 2.25rem;--text-stat-md--letter-spacing: -0.03em;  --text-stat-md--font-weight: 560;
  --text-stat-sm: 1.25rem;  --text-stat-sm--line-height: 1.5rem; --text-stat-sm--letter-spacing: -0.015em; --text-stat-sm--font-weight: 560;
  --text-title-1: 2rem;     --text-title-1--line-height: 2.5rem; --text-title-1--letter-spacing: -0.025em; --text-title-1--font-weight: 620;
  --text-title-2: 1.5rem;   --text-title-2--line-height: 2rem;   --text-title-2--letter-spacing: -0.02em;  --text-title-2--font-weight: 600;
  --text-title-3: 1.125rem; --text-title-3--line-height: 1.625rem;--text-title-3--letter-spacing: -0.012em;--text-title-3--font-weight: 600;
  --text-body-lg: 1rem;     --text-body-lg--line-height: 1.5rem; --text-body-lg--letter-spacing: -0.006em;
  --text-body: 0.875rem;    --text-body--line-height: 1.25rem;   --text-body--letter-spacing: -0.003em;
  --text-body-sm: 0.8125rem;--text-body-sm--line-height: 1.125rem;
  --text-label: 0.75rem;    --text-label--line-height: 1rem;     --text-label--letter-spacing: 0.005em;    --text-label--font-weight: 520;
  --text-micro: 0.6875rem;  --text-micro--line-height: 0.875rem; --text-micro--letter-spacing: 0.06em;     --text-micro--font-weight: 600;
  --text-mono: 0.8125rem;   --text-mono--line-height: 1.125rem;
  --text-mono-sm: 0.6875rem;--text-mono-sm--line-height: 0.875rem;--text-mono-sm--letter-spacing: 0.01em;

  /* Spacing / radius / containers / breakpoints */
  --spacing: 0.25rem;
  --radius-xs: 4px; --radius-sm: 6px; --radius-md: 10px; --radius-lg: 14px;
  --radius-xl: 20px; --radius-2xl: 28px; --radius-full: 9999px;
  --container-prose: 45rem;   /* 720 */
  --container-palette: 40rem; /* 640 */
  --container-page: 75rem;    /* 1200 */
  --breakpoint-sm: 40rem; --breakpoint-md: 48rem; --breakpoint-lg: 64rem;
  --breakpoint-xl: 80rem; --breakpoint-2xl: 96rem;

  /* Depth (inset only; no drop shadows) */
  --inset-shadow-hairline: inset 0 1px 0 0 rgb(255 255 255 / 0.04);
  --blur-glass: 20px;

  /* Easing: cubic-bezier + springs as linear() generated by motion-dom 14.14 */
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-in: cubic-bezier(0.55, 0, 1, 0.45);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --ease-spring-snappy: linear(0, 0.2531, 0.5773, 0.7868, 0.8991, 0.9541, 0.9797, 0.9912, 0.9963, 0.9984, 0.9993, 1, 1);
  --ease-spring-smooth: linear(0, 0.0958, 0.2832, 0.4752, 0.6371, 0.7605, 0.8484, 0.9078, 0.9463, 0.9702, 0.9845, 0.9926, 0.997, 0.9992, 1.0002, 1, 1);
  --ease-spring-gentle: linear(0, 0.0426, 0.1386, 0.255, 0.3732, 0.4831, 0.5803, 0.6633, 0.7326, 0.7894, 0.8352, 0.8718, 0.9008, 0.9236, 0.9413, 0.9551, 0.9658, 0.974, 0.9803, 0.9851, 0.9887, 0.9915, 0.9936, 0.9952, 0.9964, 0.9973, 0.998, 0.9985, 0.9989, 1);
  --ease-spring-bouncy: linear(0, 0.0707, 0.2291, 0.4151, 0.5925, 0.7422, 0.8576, 0.9392, 0.9919, 1.0218, 1.0354, 1.0384, 1.035, 1.0287, 1.0215, 1.0148, 1.0092, 1.005, 1.002, 1.0001, 0.9991, 1, 1);

  --animate-sheen: sheen 1.8s linear infinite;
  @keyframes sheen { from { background-position: -200% 0; } to { background-position: 200% 0; } }
}

/* Durations (not a Tailwind namespace; use `duration-(--dur-fast)`). Spring durations pair with the linear() curves above. */
:root {
  --dur-fast: 140ms; --dur-base: 240ms; --dur-slow: 420ms;
  --dur-spring-snappy: 400ms; --dur-spring-smooth: 500ms; --dur-spring-gentle: 900ms; --dur-spring-bouncy: 700ms;
  --z-sticky: 10; --z-rail: 20; --z-drag: 40; --z-popover: 50; --z-toast: 60; --z-palette: 70;
  color-scheme: dark;
  interpolate-size: allow-keywords; /* Chromium-only progressive enhancement */
}

/* Light theme */
:root[data-theme="light"] {
  color-scheme: light;
  --color-gray-1: oklch(1 0 0);       --color-gray-2: oklch(0.985 0 0);  --color-gray-3: oklch(0.967 0 0);
  --color-gray-4: oklch(0.949 0 0);   --color-gray-5: oklch(0.928 0 0);  --color-gray-6: oklch(0.907 0 0);
  --color-gray-7: oklch(0.876 0 0);   --color-gray-8: oklch(0.802 0 0);  --color-gray-9: oklch(0.640 0 0);
  --color-gray-10: oklch(0.556 0 0);  --color-gray-11: oklch(0.500 0 0); --color-gray-12: oklch(0.209 0 0);
  --color-surface-1: var(--color-gray-1);  /* light: cards are white on a gray-2 canvas */
  --color-canvas: var(--color-gray-2);
  --color-line-1: rgb(0 0 0 / 0.06); --color-line-2: rgb(0 0 0 / 0.10); --color-line-3: rgb(0 0 0 / 0.16);
  --color-glass: rgb(255 255 255 / 0.72);
  --color-scrim: rgb(0 0 0 / 0.24);
  --color-accent: oklch(0.640 0.175 150);
  --color-accent-hover: oklch(0.600 0.165 150);
  --color-accent-press: oklch(0.559 0.154 150);
  --color-accent-ink: oklch(0.501 0.138 150);
  --color-accent-a1: oklch(0.640 0.175 150 / 0.06); --color-accent-a2: oklch(0.640 0.175 150 / 0.10);
  --color-accent-a3: oklch(0.640 0.175 150 / 0.16); --color-accent-a4: oklch(0.640 0.175 150 / 0.24);
  --color-accent-a5: oklch(0.640 0.175 150 / 0.40); --color-accent-a6: oklch(0.640 0.175 150 / 0.64);
  --color-accent-a7: oklch(0.640 0.175 150 / 0.85);
  --color-z1: oklch(0.640 0.175 150 / 0.14); --color-z2: oklch(0.640 0.175 150 / 0.26);
  --color-z3: oklch(0.640 0.175 150 / 0.40); --color-z4: oklch(0.640 0.175 150 / 0.55);
  --color-z5: oklch(0.640 0.175 150 / 0.70); --color-z6: oklch(0.640 0.175 150 / 0.85);
  --color-z7: oklch(0.640 0.175 150 / 1);
  --inset-shadow-hairline: inset 0 1px 0 0 rgb(255 255 255 / 0.6);
}

@layer base {
  html { background: var(--color-canvas); color: var(--color-fg-1); font-family: var(--font-sans);
         font-size: 100%; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
  body { font-size: var(--text-body); line-height: var(--text-body--line-height); font-variant-numeric: tabular-nums; }
  :focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; border-radius: inherit; }
  ::selection { background: var(--color-accent-a5); color: var(--color-fg-1); }
}

@utility bg-hatch-accent { background-image: repeating-linear-gradient(135deg, var(--color-accent) 0 1.5px, transparent 1.5px 5px); }
@utility bg-hatch-fg     { background-image: repeating-linear-gradient(135deg, var(--color-fg-3) 0 1px, transparent 1px 5px); }
@utility glass { background: var(--color-glass); backdrop-filter: blur(var(--blur-glass)) saturate(1.4); }
@utility num { font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1; }
```
Notes: Theme switching sets `document.documentElement.dataset.theme = 'light' | 'dark'` from the user setting (default dark; a "system" setting follows `matchMedia('(prefers-color-scheme: light)')`). Light theme keeps the same structure, with cards in white on a `gray-2` canvas. `@theme static` makes Tailwind emit every variable even if it's unused, which canvas charts need (they read tokens with `getComputedStyle`). I'm confident in the `--text-*--font-weight` sub-token and `@theme static`, but I did not test them against 4.3.5. If either fails, set `font-weight` in a component class (**UNVERIFIED for 4.3.5**).

---

## 5. Motion system

### 5.1 Stack decision

| Layer | Tool | Why |
|---|---|---|
| **Route-level morphs** (page ↔ page, calendar zoom, date paging, card → page) | **Native same-document View Transitions** started by **TanStack Router's `defaultViewTransition`** with **types**, and `view-transition-name` on shared elements | It's Baseline: Chrome 111+, Safari 18+, Firefox 144+ (Oct 2025). It snapshots the old DOM, so the old route can unmount. TanStack applies `defaultViewTransition` to **every** load including Back/Forward (verified in `router-core` source: `this.shouldViewTransition ?? this.options.defaultViewTransition`), so the "and back" morph works. |
| **In-page** layout, shared elements, gestures, presence, numbers, charts | **Motion 14** (`motion/react`): `layout`, `layoutId`, `LayoutGroup`, `AnimatePresence`, `useScroll`, `useSpring`/`useFollowValue`, `useTransform`, `animate()` | Interruptible springs, velocity handoff, and layout projection that works under React state changes |
| **Primitive enter/exit** (popover, tooltip, palette, toast) | **Base UI data attributes** (`data-starting-style` / `data-ending-style`) + CSS transitions using our `linear()` spring tokens | Base UI detects and awaits the CSS transition; it's cancellable; no JS |
| **Scroll-linked chrome** (compacting header, progress hairline) | **CSS scroll-driven animations** (`animation-timeline: scroll()`) | Baseline as of Firefox 159 (2026-10-27, per MDN/web.dev); runs off the main thread. Wrap in `@supports (animation-timeline: scroll())`. |
| Small non-Base-UI enters (inline confirm, new chip) | `@starting-style` + `transition-behavior: allow-discrete` | Baseline 2024 |
| Height to `auto` | Motion `animate={{ height: "auto" }}` or Base UI Collapsible's `--collapsible-panel-height` | `interpolate-size` / `calc-size()` are still Chromium-only (Safari/Firefox unsupported per caniuse), so they're an enhancement only |

**What we deliberately don't use:**
- **React 19.3's stable `<ViewTransition>`.** React 19.3 (2026-09-09) made `<ViewTransition>` and `addTransitionType` stable; both are exported from `react@19.3.1`. React Router 8.5 now recommends it and deprecates its own `viewTransition` prop. But React skips view transitions for synchronous `popstate` updates (stated in the React Router 8.5 docs), so **Back would not morph**. TanStack Router's state flows through `@tanstack/react-store`, and I have not verified that React's `<ViewTransition>` activates for TanStack navigations (**UNVERIFIED**). Do **not** mix the two: React's component plus the router option would call `startViewTransition` twice and interrupt each other.
- **Motion's `AnimateView`** (`motion/react-animate-view`, a JS-spring wrapper over React `<ViewTransition>`; it requires React 19.3). It's tied to React `<ViewTransition>`, so it's excluded for the same reason. Revisit it if TanStack confirms support.
- `LazyMotion` / `m`: we import `motion` everywhere. Consistency beats about 20 KB.

**Hard rule on the seam:** a View Transition owns the screen while it runs, and only the *new* snapshot is live. Motion animations MUST NOT target elements that carry a `view-transition-name` during a route transition. In-page Motion entrance choreography (5.4 g) is allowed *inside* the new page, because `::view-transition-new` is a live rendering.

### 5.2 Router recipe (TanStack Router 1.170)

`ViewTransitionOptions` is verified in `router-core@1.171.39`: `{ types: string[] | ((info: { fromLocation?, toLocation, pathChanged, hrefChanged, hashChanged }) => string[] | false) }`. Returning `false` skips the transition. If the browser lacks `:active-view-transition-type()`, TanStack falls back to a plain `startViewTransition(fn)`, so the CSS default MUST look fine without types.

```ts
// src/router.ts
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { vtTypes } from "./motion/vt-types";

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  scrollRestoration: true,
  defaultViewTransition: { types: vtTypes },
});
declare module "@tanstack/react-router" { interface Register { router: typeof router } }
```

```ts
// src/motion/vt-types.ts
import type { ParsedLocation } from "@tanstack/react-router";
import { morph } from "./morph";
const VIEWS = ["month", "week", "day"] as const;
const depth = (p: string) => p.split("/").filter(Boolean).length;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function vtTypes({ fromLocation: f, toLocation: t, pathChanged }:
  { fromLocation?: ParsedLocation; toLocation: ParsedLocation; pathChanged: boolean }): string[] | false {
  if (!f) return false;                                   // initial load
  if (reduced()) return ["reduced"];
  const fs = f.search as { view?: string; d?: string }, ts = t.search as { view?: string; d?: string };
  if (!pathChanged && t.pathname.startsWith("/calendar")) {
    const a = VIEWS.indexOf((fs.view ?? "month") as never), b = VIEWS.indexOf((ts.view ?? "month") as never);
    if (a !== b) return [b > a ? "zoom-in" : "zoom-out"];
    if (fs.d !== ts.d) return [(ts.d ?? "") > (fs.d ?? "") ? "page-next" : "page-prev"];
    return false;                                         // filters etc.: Motion handles in-page
  }
  if (!pathChanged) return false;
  if (!/^\/(calendar|workouts\/)/.test(t.pathname)) morph.clear();
  return [depth(t.pathname) > depth(f.pathname) ? "forward" : depth(t.pathname) < depth(f.pathname) ? "back" : "lateral"];
}
```

```css
/* src/styles/view-transitions.css */
@layer base {
  main[data-vt-main] { view-transition-name: main; }  /* rail and bottom bar stay static */
  ::view-transition-group(*) { animation-duration: var(--dur-spring-smooth); animation-timing-function: var(--ease-spring-smooth); }
  ::view-transition-old(main) { animation: vt-fade-out 160ms var(--ease-in) both; }
  ::view-transition-new(main) { animation: vt-fade-in 240ms var(--ease-out) 40ms both; }
  html:active-view-transition-type(forward) { &::view-transition-old(main) { animation-name: vt-out-left; } &::view-transition-new(main) { animation-name: vt-in-right; } }
  html:active-view-transition-type(back)    { &::view-transition-old(main) { animation-name: vt-out-right; } &::view-transition-new(main) { animation-name: vt-in-left; } }
  html:active-view-transition-type(page-next) { &::view-transition-old(main) { animation-name: vt-out-up; } &::view-transition-new(main) { animation-name: vt-in-up; } }
  html:active-view-transition-type(page-prev) { &::view-transition-old(main) { animation-name: vt-out-down; } &::view-transition-new(main) { animation-name: vt-in-down; } }
  html:active-view-transition-type(reduced) { &::view-transition-group(*) { animation-duration: 0s; } &::view-transition-old(*), &::view-transition-new(*) { animation: vt-fade-in 120ms linear both; } }
}
@keyframes vt-fade-out { to { opacity: 0; } }
@keyframes vt-fade-in  { from { opacity: 0; } }
@keyframes vt-out-left  { to   { opacity: 0; transform: translateX(-24px); } }
@keyframes vt-in-right  { from { opacity: 0; transform: translateX(24px); } }
@keyframes vt-out-right { to   { opacity: 0; transform: translateX(24px); } }
@keyframes vt-in-left   { from { opacity: 0; transform: translateX(-24px); } }
@keyframes vt-out-up    { to   { opacity: 0; transform: translateY(-32px); } }
@keyframes vt-in-up     { from { opacity: 0; transform: translateY(32px); } }
@keyframes vt-out-down  { to   { opacity: 0; transform: translateY(32px); } }
@keyframes vt-in-down   { from { opacity: 0; transform: translateY(-32px); } }
@media (prefers-reduced-motion: reduce) { ::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) { animation-duration: 120ms !important; animation-name: vt-fade-in; } }
```
Support notes: view transition **types** are in Chrome 125+ and Firefox 147+ (Jan 2026; one Mozilla bug shows a backout, so treat Firefox as **UNVERIFIED**). Safari's version is **UNVERIFIED** (believed 18.2). `view-transition-class` is optional sugar: use it, but the global `::view-transition-group(*)` default already gives every shared element the `smooth` spring.

### 5.3 Motion tokens (`src/motion/tokens.ts`, the only source of timing)

```ts
import type { Transition } from "motion/react";
export const spring = {
  snappy: { type: "spring", visualDuration: 0.18, bounce: 0 },    // ≈ stiffness 846, damping 58.2, mass 1; settles 400ms
  smooth: { type: "spring", visualDuration: 0.32, bounce: 0.08 }, // ≈ stiffness 268, damping 30.1; settles 500ms
  gentle: { type: "spring", visualDuration: 0.5,  bounce: 0 },    // ≈ stiffness 110, damping 20.9; settles 900ms
  bouncy: { type: "spring", visualDuration: 0.4,  bounce: 0.28 }, // ≈ stiffness 171, damping 18.8; settles 700ms, 3.8% overshoot
} as const satisfies Record<string, Transition>;
export const dur = { fast: 0.14, base: 0.24, slow: 0.42 } as const;
export const ease = { out: [0.22, 1, 0.36, 1], in: [0.55, 0, 1, 0.45], inOut: [0.65, 0, 0.35, 1] } as const;
export const stagger = { step: 0.035, max: 0.24 } as const;          // delay(i) = min(i * step, max)
export const tween = (d: keyof typeof dur, e: keyof typeof ease = "out"): Transition => ({ duration: dur[d], ease: ease[e] as any });
```
The stiffness/damping equivalents were computed with `motion-dom`'s `getSpringOptions`. The CSS `--ease-spring-*` + `--dur-spring-*` pairs are the same curves, so CSS and JS motion match exactly.

| Token | Use for | Never for |
|---|---|---|
| `snappy` | press/release scale, toggles, switch thumbs, hover lifts, segmented/tab indicator under 200px of travel, checkbox ticks | anything larger than a control |
| `smooth` (**default**; set on `<MotionConfig transition={spring.smooth}>`) | layout reflow, `layoutId` morphs in-page, list reorder, nav pill, rail expand, card → page View Transition groups, chart range morphs | — |
| `gentle` | large-surface movement: calendar zoom groups, chart draw-in, PMC domain changes, number tickers above 3 digits | small controls (it feels laggy) |
| `bouncy` | **only**: drag-drop settle, key-workout star, "workout completed" check | layout, navigation, anything repeated often |
| `dur.fast` + `ease.out` | color, opacity, border, hover bg (CSS `duration-(--dur-fast)`) | movement |
| `dur.base` + `ease.out` | fades of entering content, skeleton → content crossfade, tooltip | |
| `dur.slow` + `ease.inOut` | page-level fades in View Transitions | |
| exits | `ease.in` at ≤ 0.7× the enter duration | |

**Stagger:** only for *entering* collections; `step` 35ms; cap total delay at 240ms (items past the 7th share the max). Never stagger exits, re-sorts or calendar chips while scrolling.

**Reduced motion policy:**
- Root: `<MotionConfig reducedMotion="user" transition={spring.smooth}>`. Motion then disables transform and layout animations but keeps opacity.
- View Transitions: the `reduced` type plus the media query give a 120ms crossfade with no movement.
- Number tickers jump to the final value. Chart draw-ins become a 120ms opacity fade. No bounces, bursts or sheen (skeletons go static `surface-2`). Drag still follows the pointer (functional), but drop settles instantly.
- Use `useReducedMotion()` for any custom `animate()` call.

**Performance rules:**
1. Animate only `transform`, `opacity`, `clip-path` and (in charts) the SVG `d` attribute of at most 6 paths. Never `width`, `height`, `top` or `left` directly; use `layout` (projection is transform-based).
2. `filter: blur()` animations are allowed only on the command palette and View Transition pseudo-elements, with a maximum of 2 simultaneously. At most 3 `backdrop-filter` layers on screen.
3. `will-change: transform` only while an interaction is active (drag overlay, palette open), removed after. Motion handles its own.
4. Calendar: `layout` is **off** for chips by default. It's enabled only for chips in days affected by a DnD or edit (`layout={affected ? "position" : false}`), and `layoutDependency={dayVersion}` limits measurement. Wrap each day's list in `<LayoutGroup id={dayKey}>`.
5. Infinite month scroll: virtualize **week rows** with `@tanstack/react-virtual` (`estimateSize: () => 132`, `overscan: 4`, `measureElement` for variable heights). Put `layoutScroll` on the scroll container so Motion corrects for scroll offset. Virtualizer row transforms MUST NOT trigger chip layout animations, which `layoutDependency` guarantees. View Transition names are assigned only to rows that are mounted (they always are in the viewport).
6. `content-visibility: auto; contain-intrinsic-size: auto 480px;` on non-virtualized long sections (trend page sections, activity laps table). Never on virtualized rows or anything carrying a `view-transition-name`.
7. Pointer-tracking effects (spotlight, magnetic, crosshair) write CSS variables or MotionValues. They **never** call `setState` per frame.
8. Budget: 60 fps, ≤ 8ms of scripting per frame during gestures and transitions. Verify with the Performance panel on a 4× CPU throttle with a 6-week month of 4 chips per day.

### 5.4 Signature moments (recipes)

#### (a) Workout card → full page morph (and back)
Shared names: `wk-card` (container), `wk-glyph`, `wk-title`. Only **one** element per page may carry each name, so on the calendar only the clicked or last-opened chip gets them.
```tsx
// src/motion/morph.ts (tiny external store)
import { useSyncExternalStore } from "react";
let target: string | null = null; const subs = new Set<() => void>();
export const morph = {
  set(id: string) { target = id; subs.forEach((f) => f()); },
  clear() { target = null; subs.forEach((f) => f()); },
};
export const useIsMorphTarget = (id: string) =>
  useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => target === id);
export const vt = (on: boolean, n: "card" | "glyph" | "title") => (on ? { viewTransitionName: `wk-${n}` } : undefined);

// Calendar chip
function WorkoutChip({ w }: { w: Workout }) {
  const on = useIsMorphTarget(w.id);
  return (
    <Link to="/workouts/$id" params={{ id: w.id }} viewTransition={{ types: ["open"] }}
      onClickCapture={() => morph.set(w.id)}   /* runs before Link's own onClick → names exist at snapshot */
      style={vt(on, "card")} className="flex h-7 items-center gap-1.5 rounded-sm bg-surface-2 px-2">
      <SportGlyph sport={w.sport} size={14} style={vt(on, "glyph")} />
      <span className="truncate text-body-sm" style={vt(on, "title")}>{w.title}</span>
    </Link>
  );
}
// Detail page header: ALWAYS carries the three names (style={{viewTransitionName:"wk-card"}} etc.)
```
`morph.set` synchronously re-renders the chip with names, and TanStack calls `startViewTransition` only after loaders resolve, so the old snapshot includes them. On Back, the calendar's chip still matches `target` and renders with names in the new state, so the morph reverses. `vtTypes` clears the target when leaving the calendar ↔ workout pair.
```css
html:active-view-transition-type(open, back) {
  &::view-transition-group(wk-card) { animation-timing-function: var(--ease-spring-smooth); animation-duration: var(--dur-spring-smooth); }
  &::view-transition-image-pair(wk-card) { overflow: hidden; border-radius: var(--radius-xl); }
  &::view-transition-old(wk-card) { animation: vt-fade-out 120ms var(--ease-in) both; height: 100%; object-fit: none; object-position: 0 0; }
  &::view-transition-new(wk-card) { animation: vt-fade-in 200ms var(--ease-out) 60ms both; height: 100%; object-fit: none; object-position: 0 0; }
}
```
(The exact `object-fit` / clip tuning for very different aspect ratios needs a visual pass: **UNVERIFIED**.)

#### (b) Calendar month ↔ week ↔ day zoom
URL: `/calendar?view=month|week|day&d=YYYY-MM-DD` (typed search via `validateSearch`). The `vtTypes` function emits `zoom-in` / `zoom-out`.
- In **month** view, the week row containing `d` gets `view-transition-name: cal-focus`, and each chip **in that week only** gets `view-transition-name: w-<id>` + `view-transition-class: cal-item`.
- In **week** view, the week grid gets `cal-focus` and each card `w-<id>`. Day ↔ week works the same way with the day column as `cal-focus`.
- The rest of the calendar is `main` (fades and scales).
```css
html:active-view-transition-type(zoom-in) {
  &::view-transition-old(main) { animation: vt-zoom-out-old 240ms var(--ease-in) both; }
  &::view-transition-new(main) { animation: vt-fade-in 320ms var(--ease-out) 80ms both; }
  &::view-transition-group(cal-focus), &::view-transition-group(.cal-item) {
    animation-duration: var(--dur-spring-gentle); animation-timing-function: var(--ease-spring-gentle); }
}
html:active-view-transition-type(zoom-out) {
  &::view-transition-old(main) { animation: vt-fade-out 200ms var(--ease-in) both; }
  &::view-transition-new(main) { animation: vt-zoom-in-new 360ms var(--ease-out) both; }
  &::view-transition-group(cal-focus), &::view-transition-group(.cal-item) {
    animation-duration: var(--dur-spring-gentle); animation-timing-function: var(--ease-spring-gentle); }
}
@keyframes vt-zoom-out-old { to { opacity: 0; transform: scale(1.06); filter: blur(4px); } }
@keyframes vt-zoom-in-new  { from { opacity: 0; transform: scale(1.06); filter: blur(4px); } }
```
```tsx
const name = (on: boolean, n: string) => (on ? ({ viewTransitionName: n } as const) : undefined);
<WeekRow style={name(isFocusWeek, "cal-focus")}>
  {days.map((day) => day.items.map((w) => (
    <Chip key={w.id} w={w} style={isFocusWeek ? { viewTransitionName: `w-${w.id}`, viewTransitionClass: "cal-item" } : undefined} />
  )))}
</WeekRow>
```
Keyboard: `m` / `w` / `d` switch view and `t` goes to today, all through `navigate({ search })`, so they get the same morph.

#### (c) Drag and drop between days
**Pick: `@dnd-kit/core` 6.3.1 + Motion layout. No `@dnd-kit/sortable`.**
- Pragmatic DnD uses the native HTML5 drag image, which can't be spring-animated or settled.
- Plain Motion `drag` has no collision detection, auto-scroll or keyboard DnD.
- `@dnd-kit/react` (0.5.3) is still pre-1.0.
- `@dnd-kit/core` is frozen since Dec 2024 but stable and accepts React ≥16.8 peers. Its `DragOverlay` lets Motion own all motion.
```tsx
const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
                           useSensor(KeyboardSensor, { coordinateGetter: calendarKeyboardCoordinates }));
<DndContext sensors={sensors} collisionDetection={pointerWithin}
  onDragStart={({ active }) => setActiveId(String(active.id))}
  onDragOver={({ active, over }) => over && optimisticMove(String(active.id), String(over.id))} // neighbors reflow
  onDragEnd={({ over }) => { setActiveId(null); over ? commitMove() : revertMove(); }}
  onDragCancel={() => { setActiveId(null); revertMove(); }}>
  {days.map((d) => (
    <DayDrop key={d.key} id={d.key}>
      <LayoutGroup id={d.key}>
        {d.items.map((w) => (
          <motion.div key={w.id} layoutId={`drag-${w.id}`} layout={affected.has(d.key) ? "position" : false}
            transition={w.id === lastDroppedId ? spring.bouncy : spring.smooth}>
            {w.id === activeId ? <ChipGhost /> /* hatched outline placeholder, same size */ : <DraggableChip w={w} />}
          </motion.div>
        ))}
      </LayoutGroup>
    </DayDrop>
  ))}
  <DragOverlay dropAnimation={null} zIndex={40}>
    {activeId && <motion.div initial={{ scale: 1 }} animate={{ scale: 1.04, rotate: -1.5 }} transition={spring.snappy}
                    className="glass rounded-sm"><Chip w={byId(activeId)} /></motion.div>}
  </DragOverlay>
</DndContext>
```
Behavior:
- **Drag start:** the source becomes `ChipGhost` (dashed `line-3`, `bg-hatch-fg` at 30%).
- **Lift:** scale 1.04 and rotate −1.5° with `snappy`.
- **Over another day:** `optimisticMove` moves the item in state, so the ghost appears in the target day and neighbors in both days spring with `smooth`. The target day gets an `accent-a2` wash plus a 1px `accent-a5` inset ring.
- **Drop:** the overlay unmounts and the real chip mounts with the same `layoutId`, so it flies from the overlay rect to its slot with `bouncy`.

Keyboard DnD uses arrow keys to move by day and Space/Enter to drop, with live-region announcements ("Moved Threshold Intervals to Thursday 20 Nov"). Because the `layoutId` handoff from a portaled, transformed `DragOverlay` hasn't been tested end to end (**UNVERIFIED**), prototype it first. The fallback is `dropAnimation={{ duration: 500, easing: "var(--ease-spring-bouncy)" }}`, which dnd-kit accepts as keyframe easing (**UNVERIFIED** with a CSS var; use the literal `linear()` string if not).

#### (d) Number tickers and odometer
Use `<Ticker>` for values that change in place (StatTile, week totals) and `<Odometer>` for hero numbers (`stat-lg` and up). Neither re-renders React per frame.
```tsx
const fmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
export function Ticker({ value, format = (n: number) => fmt.format(Math.round(n)) }: { value: number; format?: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null); const prev = useRef(value); const reduce = useReducedMotion();
  useEffect(() => {
    const from = prev.current; prev.current = value;
    if (reduce || from === value) { ref.current!.textContent = format(value); return; }
    const c = animate(from, value, { ...(Math.abs(value) >= 1000 ? spring.gentle : spring.smooth),
      onUpdate: (v) => { ref.current!.textContent = format(v); } });
    return () => c.stop();
  }, [value]);
  return <span ref={ref} className="num">{format(value)}</span>;
}
// Odometer: one column per digit; each column is 0–9 stacked, height 1em, overflow clip.
function Digit({ d }: { d: number }) {
  return (<span className="relative inline-block h-[1em] w-[1ch] overflow-hidden align-baseline">
    <motion.span className="absolute inset-x-0 top-0 flex flex-col" animate={{ y: `${-d * 10}%` }} transition={spring.smooth}>
      {Array.from({ length: 10 }, (_, i) => <span key={i} className="h-[1em] leading-none">{i}</span>)}
    </motion.span></span>);
}
```
Odometer details:
- Digits are keyed from the right (ones, tens, …), so adding a digit doesn't shift columns.
- New leading digits enter with `AnimatePresence` (opacity plus width via `layout`).
- The delta pill next to a stat uses the 2.4 delta encoding. It appears with `y: 4 → 0, opacity 0 → 1` (`smooth`, 120ms after the number settles starts) and the arrow rotates in from 0°.
- Use `aria-live="polite"` on the wrapper and `aria-label` with the final formatted value. Hide the digit columns from assistive tech.

#### (e) Charts drawing in and morphing
- **Lines:** reveal left to right with an animated `clipPath` rect, not `pathLength`, because `pathLength` breaks dashed strokes.
- **Areas:** fade opacity 0 → 1 over 240ms, starting 80ms after the line.
- **Bars:** `scaleY` from 0 at the baseline (`transformOrigin: bottom` via `style={{ originY: 1 }}`), staggered 12ms, capped at 240ms.
- **Range or metric morph:** resample both series to the same N (≥ 2× the pixel width ÷ 4) and interpolate `d` with `d3-interpolate-path` through a MotionValue.
```tsx
function MorphLine({ d, className }: { d: string; className?: string }) {
  const interp = useRef<(t: number) => string>(() => d);
  const progress = useMotionValue(1);
  const dMV = useTransform(progress, (t) => interp.current(t));
  useEffect(() => {
    const from = dMV.get();                        // current on-screen path → interruptible mid-morph
    if (from === d) return;
    interp.current = interpolatePath(from, d);     // d3-interpolate-path
    progress.jump(0);
    const c = animate(progress, 1, spring.gentle);
    return () => c.stop();
  }, [d]);
  return <motion.path d={dMV} className={className} fill="none" vectorEffect="non-scaling-stroke" />;
}
function Reveal({ width, height, children, id }: { width: number; height: number; id: string; children: React.ReactNode }) {
  return (<>
    <clipPath id={id}><motion.rect height={height} initial={{ width: 0 }} animate={{ width }} transition={spring.gentle} /></clipPath>
    <g clipPath={`url(#${id})`}>{children}</g></>);
}
```
When the x-domain changes (for example 6W → 1Y), animate the scale domain endpoints with `useSpring` (gentle) and recompute paths from them in `useTransform`. Ticks crossfade (`AnimatePresence`, keyed by tick value, `dur.fast`).

#### (f) Nav active pill
- **Rail (route change):** the active item renders `<span aria-hidden style={{ viewTransitionName: "nav-pill" }} className="absolute inset-0 rounded-md bg-surface-3" />`. Because navigation is a View Transition and the rail is outside `main`, the pill group morphs between items with the global `smooth` spring.
- **Hover preview:** a second Motion `layoutId="nav-hover"` pill (`bg-surface-2`, `snappy`) follows the hovered item. It's hidden when the hovered item is the active one.
- **In-page tabs and segmented controls** (no navigation): a Motion `layoutId` indicator.
```tsx
<ToggleGroup value={[range]} onValueChange={([v]) => v && setRange(v)} className="relative flex rounded-md bg-surface-2 p-0.5">
  {RANGES.map((r) => (
    <Toggle key={r} value={r} className="relative z-0 h-7 px-3 text-label text-fg-2 data-[pressed]:text-fg-1">
      {range === r && <motion.span layoutId={`seg-${id}`} transition={spring.snappy}
        className="absolute inset-0 -z-10 rounded-[8px] bg-surface-active inset-shadow-hairline" />}
      {r}
    </Toggle>))}
</ToggleGroup>
```

#### (g) Page enter choreography and skeleton → content
The View Transition crossfades `main`. Inside the new page, `<PageStagger>` reveals top-level sections only (header, stat row, charts, lists) with `y: 8 → 0, opacity 0 → 1`, `smooth`, step 35ms, max 6 children. Charts start their draw-in when their section finishes entering (`onAnimationComplete`), or immediately if already visible.
```tsx
const container = { hidden: {}, show: { transition: { staggerChildren: stagger.step, delayChildren: 0.04 } } };
const item = { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: spring.smooth } };
export const PageStagger = ({ children }: { children: React.ReactNode }) =>
  <motion.div variants={container} initial="hidden" animate="show" className="contents">{children}</motion.div>;
export const PageSection = (p: React.ComponentProps<typeof motion.section>) => <motion.section variants={item} {...p} />;

// Skeleton → content: skeleton has the exact final box size; crossfade in place.
<div className="grid [&>*]:[grid-area:1/1]">
  <AnimatePresence initial={false}>
    {isPending ? <motion.div key="sk" exit={{ opacity: 0, transition: tween("fast", "in") }}><StatSkeleton /></motion.div>
               : <motion.div key="ct" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: tween("base") }}><StatTile {...data} /></motion.div>}
  </AnimatePresence>
</div>
```
Use route loaders + `defaultPreload: "intent"` so most navigations land with data and no skeleton. Show skeletons only after 150ms (`defaultPendingMs: 150`, `defaultPendingMinMs: 300`).

#### (h) Buttons, toggles, segmented controls, magnetic
- **All pressables:** `whileTap={{ scale: 0.97 }}` with `snappy`. Hover changes background only (`dur.fast`), never translateY.
- **Switch:** the thumb moves with `layout` + `snappy`. On toggle-on, the track fills `accent` (CSS `transition: background-color var(--dur-fast)`).
- **Magnetic:** allowed only on the rail's `New workout` button and the `⌘K` trigger. Max 3px pull, via `useSpring(x, spring.snappy)` set from pointer offset × 0.15 and reset on leave.
```tsx
export function PressButton({ variant = "secondary", ...p }: ButtonProps) {
  return <motion.button whileTap={{ scale: 0.97 }} transition={spring.snappy}
    className={cn("inline-flex h-9 items-center gap-2 rounded-md px-3.5 text-label transition-colors duration-(--dur-fast)",
      variant === "primary" && "bg-accent text-on-accent hover:bg-accent-hover active:bg-accent-press",
      variant === "secondary" && "bg-surface-2 text-fg-1 inset-shadow-hairline border border-line-2 hover:bg-surface-3",
      variant === "ghost" && "text-fg-2 hover:bg-surface-2 hover:text-fg-1")} {...p} />;
}
```

#### (i) Toast with undo
Use Base UI Toast (`Toast.Provider`, `Toast.Viewport`, `useToastManager().add({ title, description, timeout: 6000, actionProps: { children: "Undo", onClick } })`), positioned bottom-center on mobile and bottom-left of `main` on desktop, with a max of 3 stacked.
- **Surface:** `glass`, `line-3`, radius `lg`, `inset-shadow-hairline`, min-width 320.
- **Enter:** CSS on `[data-starting-style]` → `translateY(16px) scale(.98); opacity 0`, with `transition: transform var(--dur-spring-smooth) var(--ease-spring-smooth), opacity var(--dur-base) var(--ease-out)`.
- **Exit:** `[data-ending-style]` → `opacity 0; translateY(8px)` over 160ms `ease-in`.
- **Stacking** uses Base UI's `--toast-index` / `--toast-offset-y` vars (`transform: translateY(calc(var(--toast-offset-y) * -1)) scale(calc(1 - var(--toast-index) * .04))`).
- **Countdown:** a 1px `accent` hairline at the bottom, `scaleX(1 → 0)` linear over the timeout, paused on hover (`animation-play-state`).
- **Undo** is an `accent-ink` text button. Clicking it reverts optimistically, and the reverted calendar chip springs back via layout (`smooth`).
- **All destructive actions** (delete workout, clear week) execute immediately with an undo toast. There are no confirm dialogs.

#### (j) Command palette (the one overlay)
Base UI's documented pattern: `Dialog` + `Autocomplete` (`open`, `inline`, `autoHighlight="always"`, `keepHighlight`) + `ScrollArea`.
- **Size and placement:** `max-w-palette` (640px), radius `2xl`, `glass`, `line-3`, top offset 14vh.
- **Scrim:** `bg-scrim`, fades over `dur.base`.
- **Popup enter (CSS on data attributes):** `[data-starting-style] { opacity:0; transform: translateY(-8px) scale(.96); filter: blur(4px) }`, transitioning `transform var(--dur-spring-smooth) var(--ease-spring-smooth), opacity var(--dur-base) var(--ease-out), filter var(--dur-base) var(--ease-out)`.
- **Popup exit:** the reverse at 140ms `ease-in`.
- **Highlight:** the highlighted row's background is a Motion `layoutId="cmdk-hl"` pill (`bg-surface-3`, `snappy`) so it glides between rows. Groups are labeled with `micro` caps. Right side shows `kbd` hints in `mono-sm` on a `surface-3` key (radius `xs`).
- **Opens with** `⌘K` / `Ctrl+K` and `/`. Results: navigation, actions ("New run on Thursday"), workouts by title, dates ("next tuesday" parsed with date-fns).

#### (k) Intensity selector and key-workout star
- **Intensity selector:** 5 vertical bars (heights 6/9/12/15/18px, 4px wide, 3px gap), using Base UI `RadioGroup`. Bars up to and including the selected one fill with their zone color (`z1, z2, z3, z5, z7`); the rest are `surface-3`. On select, filled bars animate `scaleY 0.6 → 1` staggered 20ms with `snappy`. Arrow keys change it, and the label (`EASY…MAX`) ticks under it.
- **Key-workout star:** a Base UI `Toggle`. Turning it on scales the star `1 → 1.25 → 1` (`bouncy`), the fill goes outline → `accent`, and 6 particles burst (accent dots, 3px, radiating 10px at 60° steps, `opacity 1 → 0`, 360ms `ease.out`). No burst on turn-off, under reduced motion, or for repeat toggles within 1s.
```tsx
function StarBurst({ fire }: { fire: number /* increment to fire */ }) {
  const reduce = useReducedMotion(); if (reduce || !fire) return null;
  return (<span key={fire} aria-hidden className="pointer-events-none absolute inset-0">
    {Array.from({ length: 6 }, (_, i) => { const a = (i * Math.PI) / 3;
      return <motion.span key={i} className="absolute left-1/2 top-1/2 size-[3px] rounded-full bg-accent"
        initial={{ x: 0, y: 0, opacity: 1 }} animate={{ x: Math.cos(a) * 10, y: Math.sin(a) * 10, opacity: 0 }}
        transition={{ duration: 0.36, ease: ease.out }} />; })}
  </span>);
}
```

#### (l) Hover and focus spotlight on cards
Cards (`Card`, `StatTile`, calendar week cards; *not* chips) get a pointer-tracked radial highlight on the **border** plus a faint inner wash. Pointer position is written to CSS vars without React state.
```css
.spotlight { position: relative; isolation: isolate; }
.spotlight::before { /* border glow */
  content: ""; position: absolute; inset: 0; border-radius: inherit; padding: 1px; pointer-events: none;
  background: radial-gradient(240px circle at var(--mx, 50%) var(--my, -100%), var(--color-line-3), transparent 70%);
  mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
  opacity: 0; transition: opacity var(--dur-base) var(--ease-out); }
.spotlight::after { /* inner wash */
  content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; z-index: -1;
  background: radial-gradient(320px circle at var(--mx) var(--my), rgb(255 255 255 / 0.025), transparent 60%);
  opacity: 0; transition: opacity var(--dur-base) var(--ease-out); }
.spotlight:hover::before, .spotlight:hover::after, .spotlight:focus-visible::before { opacity: 1; }
:root[data-theme=light] .spotlight::after { background: radial-gradient(320px circle at var(--mx) var(--my), rgb(0 0 0 / 0.025), transparent 60%); }
```
```ts
export const onSpotlightMove = (e: React.PointerEvent<HTMLElement>) => {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
};
```
Key-workout and "today" cards may use `accent-a5` instead of `line-3` in the border glow. That's the only accent spotlight. On keyboard focus, set `--mx: 50%; --my: 0%` so the glow sits on the top edge.

### 5.5 Gestures
- **Horizontal swipe** on the calendar (touch) pages week/month: Motion `drag="x"` on the grid with `dragElastic: 0.15`, `dragConstraints={{ left: 0, right: 0 }}`. Past 80px or a velocity of 400px/s, it navigates (`page-next` / `page-prev` View Transition). Otherwise it springs back (`smooth`).
- **Pinch** on the calendar (trackpad `ctrl+wheel` / touch) zooms month ↔ week. Threshold: `scale` 1.15 / 0.87. **UNVERIFIED** on Safari trackpads.

### 5.6 Scroll-driven chrome
```css
@supports (animation-timeline: scroll()) {
  .page-header-title { animation: header-compact linear both; animation-timeline: scroll(nearest block); animation-range: 0 96px; }
  @keyframes header-compact { to { transform: scale(0.5625); translate: 0 -12px; } } /* 32px → 18px, origin left */
  .page-header { animation: header-glass linear both; animation-timeline: scroll(nearest block); animation-range: 40px 96px; }
  @keyframes header-glass { from { background: transparent; border-color: transparent; } to { background: var(--color-glass); border-color: var(--color-line-1); } }
}
```
`backdrop-filter` is applied statically to the sticky header (it's cheap when the background is transparent). Use `transform-origin: left center` on the title.

---

## 6. Charts

**Pick: hand-rolled SVG with `d3-scale` / `d3-shape` / `d3-array` + Motion for every chart, plus a Canvas 2D layer for 1 Hz activity streams (with an SVG overlay for axes, crosshair and brush). All of it lives in one shared `src/charts/` kit.**
- Recharts and visx impose their own animation and markup and fight View Transitions and `layoutId`. We need monochrome patterns, end labels, morphs and exact tokens, which we would have to override almost entirely anyway.
- uPlot (1.6.32, last release Mar 2025) is fast, but its axes, cursor and tooltip would look like a different product.
- SVG is fine up to about 2–3k points per chart. Activity streams (10k–30k points × 5 tracks) go to canvas. Downsample with **LTTB** to `2 × plotWidthPx` points per track, recomputed on zoom. Hand-roll the ~40-line LTTB on `Float64Array`s in `src/charts/lttb.ts`; the `downsample@1.4.0` npm package is an acceptable alternative.
- Use canvas whenever a single series exceeds 3k rendered points or more than 4 synced series hover-update together.

### 6.1 Styling rules (all charts)
- **Grid:** horizontal lines only, 1px `line-1`, 3–5 ticks (`scale.ticks(4)`), no vertical grid except the "Today" rule.
- **Axes:** no axis lines. Tick labels are `mono-sm` `fg-3`, placed outside the plot. Y labels are right-aligned at the left edge, or at the right edge for PMC. X ticks are date-fns formatted (`MMM d`, `EEE`), with the first tick of a new month in `fg-2`.
- **Line widths:** primary 2px, secondary 1.5px, comparison 1px. Use `vector-effect: non-scaling-stroke`, `stroke-linecap: round`, and `curveMonotoneX` for continuous series (`curveStepAfter` for weekly bars and plans).
- **End-of-line labels instead of legends:** at the last data point, show `● value` + a `micro` series name, collision-avoided by nudging vertically (minimum 14px apart). A legend is allowed only when there are more than 3 series, and then it's inline above the plot as micro-caps with the stroke sample.
- **Crosshair:** a 1px `fg-3` vertical rule spanning all synced panels, snapping to the nearest datum (d3 `bisector`). Points on each series are 6px dots with a 2px canvas-colored ring.
- **Tooltip:** `glass`, radius `md`, `line-3`, padding 8/10. Title `label` + rows of `mono` values (series name left, value right). It sits on the side of the crosshair opposite the pointer's half and moves with `snappy` (Motion `animate={{ x }}`). It never covers the crosshair.
- **Selection brush:** drag on the plot. Selection fill `accent-a2` with 1px `accent-a6` edges and 8px-wide handles (`grip` dots). Selection stats appear in the aside (via Ticker). Double-click or `Esc` clears. Committing a zoom animates the domain with `gentle`.
- **Annotations:** vertical 1px dashed `fg-4` rules with a `micro` label at the top (races, FTP tests, notes). The "Today" rule is solid `fg-3` with a `TODAY` micro label.
- **Empty and partial data:** gaps are real gaps (`line.defined`). Missing days are not interpolated.
- **Responsive:** charts use `ResizeObserver` and never scale text. Under 480px, hide every second tick and move end labels into a row above the plot.

### 6.2 Chart catalog

| Chart | Encoding | Interaction / motion |
|---|---|---|
| **PMC (fitness/fatigue/form)** | Top panel (220px): CTL accent area + 2px line, ATL `fg-1` 1.5px line; lower panel (72px): TSB `fg-3` dashed line around a 0 baseline, risk band below −30 hatched (`#hatch-fg`), "fresh" band +5…+25 as `accent-a1`. Future projection after Today: same series dashed `2 4`, area → `#hatch-accent` 40%. Optional daily TSS as 2px `fg-4` lollipops at the bottom of the top panel. | Range segmented control (6W / 3M / 6M / 1Y / All) morphs paths (`MorphLine`) + domain (`gentle`); synced crosshair across both panels; end labels CTL/ATL/TSB |
| **Weekly volume** (stacked bars + rolling avg) | Bar per week: completed = solid `accent`, remaining planned = `line-3` outline + `bg-hatch-fg` on top of the stack; current week bar has a `TODAY` cap. 4-week rolling average = `fg-1` 1.5px step line with end label. Metric toggle: hours / TSS / distance. Per-sport split = **small multiples** (one 48px row per sport, glyph label), never color stacks. | Bars grow with stagger; metric switch → bars `scaleY` morph via layout (keyed by week) |
| **WoW delta bars** | Diverging from 0: increase = solid `fg-1`, decrease = 1px `fg-2` outline bar (transparent), ramp > +10% = `bg-hatch-fg` + ⚠ annotation; value label at bar end in `mono-sm` with sign | Ticker on values; bars spring from 0 |
| **Time in zone** | 7 horizontal rows Z1–Z7: label `micro` left, bar fill `--color-zN` on a `surface-2` track (radius `xs`), right: `mono` duration + `%` in `fg-3`. Planned target as a 1px `fg-1` tick on each track. | Bars `scaleX` from 0 staggered 20ms |
| **Power / pace curve** | Log x (`scaleLog`, 1s → 5h, ticks 1s 5s 15s 1m 5m 20m 1h 2h 5h), current period `accent` 2px, comparison (90d / all-time / last year) `fg-3` 1px dashed, PB markers = 4px accent dots with `micro` labels on 5s/1m/5m/20m/60m | Crosshair snaps to durations; period switch morphs paths |
| **Activity streams** (synced multi-track) | Canvas tracks, 72px each (power, HR, pace inverted, cadence, elevation), 8px gap; power = `accent` 1.25px line + `accent-a2` fill; HR = `fg-1` line; pace = `fg-2`; cadence = `fg-3` 1px; elevation = `surface-3` filled silhouette with `fg-4` top line. Lap boundaries = `line-2` verticals. Overview mini-map (32px) at the bottom with a brush. | One shared `cursorX` MotionValue drives all tracks' crosshair & per-track value dots (no React renders). Brush → zoom with `gentle` domain spring; LTTB recompute per zoom. Map hover sync via the same MotionValue. |
| **Intensity profile** (structured workout) | Blocks: width ∝ duration, height ∝ % threshold (0–150%, ticks 50/75/100/120), fill `--color-zN`, radius 2 top corners, 1px gaps; ramps as trapezoid paths; repeats get a bracket below with `4×` micro label; FTP 100% line `fg-4` dashed. Sizes: 24px (week card), 48px (day/detail), 160px (builder). | Builder: blocks are `motion.rect` with `layout` → adding/removing/reordering steps reflows with `smooth`; hover dims others to 40% |
| **Consistency heatmap** | 7 rows × N weeks, 12px squares, 3px gap, radius 3; empty day = `surface-2`; trained day = `accent` at quantile alpha (5 buckets: a3, a4, a5, a6, solid) by TSS; planned-missed = `line-3` dashed outline; today = 1px `fg-1` ring | Cells fade in column by column (stagger by week, 8ms, cap 240ms) |
| **Week-summary sparkline** (calendar) | 7 bars, 4px wide, 2px gap, max height 20px: completed TSS = `accent`, remaining planned = `line-3` outline; or a 64×20 line variant for CTL trend | No animation on scroll; animate only on data change |

---

## 7. Components

**Headless primitives: `@base-ui/react` 1.9.0.** It's from the Radix/Floating UI/MUI team, React 19 compatible (peer `^17 || ^18 || ^19`), and actively released (1.0 in Dec 2025, 1.9 in Oct 2026). It ships exactly the parts we need: NumberField, Slider, ToggleGroup, Tabs with an `Indicator` (exposes `--active-tab-left/width`), Toast with an undo action, Autocomplete with a documented command palette recipe, Meter, ScrollArea. It documents Motion integration (`render` prop + `keepMounted`) and data-attribute CSS transitions.
- Radix is in maintenance mode by comparison.
- React Aria is excellent but heavier, with its own styling and animation idioms.
- Ark/Zag would add a state-machine layer we don't need.

**Icons: `lucide-react` 1.77.0.** It's ISC-licensed, has 2,393 icons, and is updated weekly. Set globally with `<LucideProvider size={16} strokeWidth={1.75} absoluteStrokeWidth={false}>` (the provider exists in 1.77). Sizes are 14 (in chips), 16 (default), 20 (rail and page header actions) and 24 (empty states only). Icons inherit `currentColor`. Sport glyphs: see 2.4.

General component rules:
- Every interactive component has states: `default`, `hover` (`@media (hover:hover)` only), `active/pressed`, `focus-visible`, `disabled` (40% opacity, `cursor-not-allowed`), and where relevant `selected`, `invalid` and `loading`.
- Heights: 28 (sm), 36 (md, default), 44 (lg, and minimum on `pointer-coarse`).

| Component | Anatomy | States and specifics | Primitive |
|---|---|---|---|
| **Button** | [icon 16] label (`label` text) [kbd] | variants: `primary` (accent fill, on-accent text; **max one per page**), `secondary` (surface-2 + line-2 + inset hairline), `ghost`, `danger-ghost` (fg-1 text + `TriangleAlert`; no red). Loading: label crossfades to a 3-dot pulse, width locked. Press = 0.97 snappy | `@base-ui/react/button` |
| **IconButton** | square 28/36, icon 16, radius md | ghost by default; tooltip label required (aria-label); `aria-pressed` for toggles | Button + Tooltip |
| **Segmented control** | track surface-2 p-0.5 radius md; items h-7 `label`; thumb `layoutId` surface-active + inset hairline | 2–5 options; thumb snappy; keyboard arrows | `ToggleGroup` + `Toggle` |
| **Tabs** | text tabs `label` fg-2 → fg-1 selected; 2px `fg-1` underline indicator | indicator = Base UI `Tabs.Indicator`, styled `position:absolute; left:0; transform: translateX(var(--active-tab-left)); width: var(--active-tab-width); transition: transform var(--dur-spring-snappy) var(--ease-spring-snappy), width var(--dur-spring-snappy) var(--ease-spring-snappy)` (animating width is the one allowed exception: single 2px element) | `Tabs` |
| **Input / Textarea** | label (`label`, fg-2) above; field h-9, surface-2, 1px line-3, radius md, px-3, `body`; hint/error below (`body-sm`) | hover line → gray-8; focus 2px `focus` ring (offset 0 inside field: `outline-offset:-1px`); invalid: `TriangleAlert` + message, border `fg-1` dashed; never red | `Field`, `Input` |
| **NumberField with units** | [−] value (mono, right-aligned, tnum) unit suffix (fg-3) [+]; scrub area on label (drag to change) | units: `min`, `km`, `mi`, `W`, `%FTP`, `bpm`, `/km`; duration fields parse `1:05:00`, `65m`; step buttons appear on hover/focus; scrub with `ew-resize` cursor | `NumberField` (has ScrubArea) |
| **Select / Combobox** | trigger like input + `ChevronsUpDown`; popup glass radius lg, items h-8, highlight `layoutId` pill | sport picker shows glyph + label; combobox for workout library search | `Select`, `Combobox` |
| **Toggle (switch)** | track 32×20 radius full surface-3 → accent; thumb 16 white (dark) / white (light) | thumb `layout` snappy; on-state track accent | `Switch` |
| **Slider (RPE 1–10)** | track 4px surface-3; range fill accent α by value (z-ladder); thumb 16 fg-1 with 2px canvas ring; 10 detent ticks; value bubble `stat-sm` above while dragging | thumb scale 1.15 while dragging (snappy); keyboard 1 step, PageUp 2; labels `EASY / MODERATE / HARD / MAX` | `Slider` |
| **Chip / Tag** | h-6 radius sm px-2 `label`; optional glyph; removable `X` 12 | `neutral` (surface-2 line-2), `selected` (fg-1 text, line-3, surface-3), `signal` (accent-a2 bg, accent-ink text). Enter via `@starting-style` scale .9 → 1 | — |
| **Card** | surface-1, line-2, radius lg, p-4 (p-5 at xl), `spotlight`; header row (title-3 + actions), body, optional footer divider line-1 | hover spotlight; selected = 1px `fg-1` border (inset ring); link-cards use the morph pattern | — |
| **StatTile** | micro label (fg-3) · value `stat-md` Ticker + unit · delta pill (2.4) · optional 24px sparkline | loading = skeleton of exact size; value change = Ticker; delta pill re-enters | — |
| **Table** | header `micro` fg-3, sticky, line-1 bottom; rows h-10 `body`, numeric cols `mono` right-aligned; row hover surface-2; zebra never | sortable headers with `ArrowUpDown` → animated chevron; row reorder via `layout` smooth; selection = accent 2px left rail | — |
| **Tooltip** | glass, radius sm, px-2 py-1, `body-sm`, optional kbd; no arrow | delay 400ms open / 0 when moving between triggers; `data-starting-style` opacity 0 + scale .96; dur.fast | `Tooltip` |
| **Popover** (small pickers only) | glass, line-3, radius lg, p-2, max-w 320 | origin-aware scale .96 → 1 via `--transform-origin`, smooth spring CSS; Esc/outside closes | `Popover` |
| **Toast** | see 5.4(i) | | `Toast` |
| **CommandPalette** | see 5.4(j) | | `Dialog` + `Autocomplete` + `ScrollArea` |
| **PageHeader** | back IconButton (`ArrowLeft`) + breadcrumb micro · title `title-1` (carries `wk-title` VT name on workout pages) · meta row (glyph, date, micro tags) · actions right | sticky; compacts with scroll timeline; back uses `router.history.back()` when history exists (so the morph reverses), else navigate to parent | — |
| **EmptyState** | 24px icon fg-3 in 48px surface-2 rounded-lg tile · `title-3` · `body` fg-2 (≤ 2 lines) · one secondary button | appears with PageStagger; no illustrations | — |
| **Skeleton** | surface-2 blocks with exact final dimensions, radius matching target; sheen = `linear-gradient(90deg, transparent, rgb(255 255 255/.04), transparent)` 200% size `animate-sheen` | reduced motion → static; minimum display 300ms when shown | — |

---

## 8. Accessibility and quality bar

- **Focus:** a 2px `--color-focus` (`fg-1`) outline at 2px offset on everything focusable. Inside dense grids (calendar cells, table rows) use `outline-offset: -2px`. Never remove outlines. Focus must survive morphs: after a route View Transition, focus moves to the page's `h1` (`tabIndex={-1}`), and on Back it returns to the originating chip (store the id in `morph`).
- **Calendar keyboard model** (`role="grid"`, rows `role="row"`, cells `role="gridcell"`, roving `tabIndex`): only one cell is tabbable.

  | Key | Action |
  |---|---|
  | Arrow keys | ±1 day / ±1 week |
  | Home / End | week start / end |
  | PageUp / PageDown | ±1 month (Shift: ±1 year) |
  | Enter | opens the day |
  | `Tab` | enters the day's items |
  | `n` | new workout on the focused day |
  | `m` / `w` / `d` / `t` | change view / go to today |
  | Space on a chip | picks it up for keyboard DnD |

  Each cell has `aria-label` (e.g. "Tuesday 18 November, 2 workouts, 1 completed, 86 TSS"), and the focused date persists in the URL `d=`.
- **Color independence:** every encoding in 2.4 has a non-color channel (glyph, label, pattern, dash, weight). Check every screen in grayscale (DevTools "achromatopsia" emulation) before merge.
- **Contrast:** text ≥ 4.5:1 (`fg-1`/`fg-2` anywhere; `fg-3` only on canvas/surface-1; `accent-ink` for accent text in light). Graphics ≥ 3:1 (accent passes in both themes; `fg-4` is decoration only). **Known deviation:** input borders (`line-3`) are below 3:1. Fields are identified by their fill plus a visible label. If strict 1.4.11 compliance is required, change the input rest border to `gray-9`.
- **Hit targets:** ≥ 24×24 everywhere (WCAG 2.2 AA), ≥ 36px for primary controls, ≥ 44px on `pointer-coarse` (Tailwind `pointer-coarse:` variant). Calendar chips are 28px tall but full-width, which is acceptable.
- **Motion:** honor `prefers-reduced-motion` (5.3), with no parallax and no autoplaying loops except the skeleton sheen (disabled under reduced motion). Nothing flashes more than 3 times per second.
- **Live regions:** toast viewport (polite), DnD announcements, Ticker final values.
- **Charts:** each chart has an `aria-label` summary ("Fitness 84, up 6 over 6 weeks") plus a visually hidden data table toggle ("View as table" ghost button that swaps the chart for a `Table`).
- **Performance:** 60 fps budget (5.3). LCP < 1.5s on a cold cache through the Worker (fonts preloaded, route code-split). Interaction to Next Paint < 100ms for calendar actions.

---

## 9. Consistency contract (every frontend agent MUST follow)

1. **Tokens only.** No hex, `rgb()` or `oklch()` literals in components. Use `bg-surface-2`, `text-fg-2`, `border-line-2`, `text-accent-ink`, and so on. Tailwind's default palette is deleted, so if you need a color that doesn't exist, raise it; don't invent one.
2. **One hue.** Signal Green appears only for completed/compliant, load (CTL/TSS), live/today/selection, key workouts and the page's single primary CTA. Red, amber and blue appear nowhere, including errors (which use the icon + `fg-1` + dashed border).
3. **No drop shadows, ever.** Depth = surface step + `line-*` hairline + `inset-shadow-hairline` + `glass` for floating layers.
4. **Numerals are always tabular** (global `tabular-nums`). Use Geist for numbers 20px and up, Geist Mono for data under 20px. Use U+2212 for minus.
5. **Fonts:** Geist Variable + Geist Mono Variable via `@fontsource-variable`. No other families, no italics for emphasis (use weight), no script or decorative faces.
6. **Type sizes come from the scale only** (`text-stat-*`, `text-title-*`, `text-body*`, `text-label`, `text-micro`, `text-mono*`).
7. **Spacing from the allowed steps only**, radii from `xs…2xl` only, and inner radius = outer − padding.
8. **Timing from `src/motion/tokens.ts` / `--ease-spring-*` only.** No inline `duration: 0.3` or ad-hoc cubic-beziers. `smooth` is the default. `bouncy` is only for drop settle, star and completion check.
9. **Route changes are View Transitions** through TanStack `defaultViewTransition` + `vtTypes`. Never pass `viewTransition` ad hoc except `{ types: [...] }` overrides, never use React `<ViewTransition>`, and never call `document.startViewTransition` yourself.
10. **Shared-element names are a registry:** `main`, `nav-pill`, `wk-card`, `wk-glyph`, `wk-title`, `cal-focus`, `w-<id>` (class `cal-item`), `settings-nav`, `settings-pill`. Add new names to this list in this doc. Every name must be unique on the page.
11. **In-page morphs use Motion** `layout` / `layoutId`, never on an element that has a `view-transition-name`.
12. **No modals.** The command palette is the only overlay. Popovers are only for pickers ≤ 320px. Destructive actions = immediate + undo toast. Creating or editing anything = a full page.
13. **Animate transform/opacity/clip-path only.** No per-frame `setState`. Pointer effects write CSS vars or MotionValues.
14. **Calendar chips do not have `layout` on by default.** Enable it per affected day with `layoutDependency`. Week rows are virtualized.
15. **Every category is encoded without color first** (glyph/label/pattern/dash/weight per 2.4), and every screen must pass a grayscale check.
16. **Sport glyphs only through `<SportGlyph>`** (mapping in 2.4). Icons only from `lucide-react` with the global provider (16px, stroke 1.75).
17. **Headless behavior only from `@base-ui/react`**, styled with Tailwind and data attributes (`data-[pressed]`, `data-[highlighted]`, `data-starting-style`, `data-ending-style`). No other component libraries.
18. **Charts only from the shared `src/charts/` kit** (SVG + d3 + Motion; canvas for streams). End labels instead of legends, the crosshair/tooltip spec in 6.1, and the `ChartDefs` patterns.
19. **Reduced motion is part of the definition of done.** `MotionConfig reducedMotion="user"` at the root, plus the CSS rules, plus no bursts, sheen or bounces.
20. **Focus is visible and managed.** Use the 2px `focus` outline; focus moves to `h1` after navigation and returns to the origin chip on Back; the calendar uses a roving tabindex grid.

Suggested file ownership, so the three agents converge: `src/styles/app.css`, `src/styles/view-transitions.css`, `src/motion/*`, `src/ui/*` (primitives above) and `src/charts/*` are **shared foundations**. The first agent to need one creates it exactly as specified here, and the others import it without forking.

---

## Sources
- React 19.3 announcement, `<ViewTransition>` stable (2026-09-09): https://react.dev/blog/2026/09/09/react-19-3 (via search; confirmed `ViewTransition` and `addTransitionType` are exported from `react@19.3.1`)
- React Router 8.5 view transitions doc (bundled in `react-router@8.5.2/docs/how-to/view-transitions.md`): https://app.unpkg.com/react-router@8.5.1/files/docs/how-to/view-transitions.md
- Same-document View Transitions Baseline (Firefox 144): https://web.dev/blog/same-document-view-transitions-are-now-baseline-newly-available
- Firefox 147 (view transition types): https://developer.mozilla.org/en-US/Firefox/Releases/147 ; backout bug: https://bugzilla.mozilla.org/show_bug.cgi?id=2001878
- Firefox 159 (scroll-driven animations on by default): https://developer.mozilla.org/en-US/Firefox/Releases/159 ; https://web.dev/blog/web-platform-10-2026
- `interpolate-size` / `calc-size()` support: https://caniuse.com/mdn-css_properties_interpolate-size ; https://caniuse.com/wf-calc-size
- Motion upgrade notes (v14: no React breaking changes): https://motion.dev/docs/react-upgrade-guide ; https://motion.dev/docs/migration
- dnd-kit packages/README: https://github.com/clauderic/dnd-kit
- Package sources read locally: `@tanstack/router-core@1.171.39` (`ViewTransitionOptions`, `startViewTransition`), `@tanstack/react-router@1.170.46` (`Transitioner` uses `React.startTransition`), `framer-motion@14.14.0` (`AnimateView`, `useFollowValue`, `layoutAnchor`, `layoutCrossfade`), `motion-dom@14.14.0` (spring → `linear()`), `@base-ui/react@1.9.0` (docs: animation handbook, command palette, Tabs/Toast CSS vars), `lucide-react@1.77.0` (icon names, `LucideProvider`), `@fontsource-variable/geist@5.3.0` (GSUB features).
