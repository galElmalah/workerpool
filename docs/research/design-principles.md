# Design principles for Cadence v2: calm density and one quiet accent

Normative for v2; overrides `design.md` §1–§4 where they conflict. Answers: *"too crowded; the green is too vibrant."* Contrast figures were computed (OKLCH→sRGB, WCAG 2.x, APCA 0.0.98G), not estimated. linear.app, radix-ui.com, stripe.com, material.io and trainingpeaks.com were not fetchable from this sandbox; claims about them come from search-indexed text of the linked pages.

## 0. Rules for v2 (testable)

1. **No pure black.** Dark canvas is `oklch(0.165 0.006 h)` (≈ `#0c0f11`). Primary text is no brighter than L 0.93, which gives 15.7:1 instead of v1's 17.6:1 ([Material dark theme](https://m2.material.io/design/color/dark-theme)).
2. **Accent chroma ≤ 0.13** in both themes. No colour on screen has C > 0.13. v1 used 0.221.
3. **Accent budget: ≤ 5 accent marks per 1440×900 viewport**, and ≤ 3% of pixels outside charts. The accent may only mean (a) the page's single primary action, (b) today/now, (c) current selection/focus, (d) the Fitness series and zone fills inside charts. It never means "done", load, key session, nav, or decoration.
4. **Completion state is neutral.** Done = solid `fg-2` glyph, planned = outline, missed = `fg-4` and struck through, key = semibold title. It is never shown with a coloured dot.
5. **One container level.** No bordered or filled card inside another card. A region gets a border *or* a surface fill, never both. Proximity is the default grouper.
6. **Spacing tokens only:** 4, 8, 12, 16, 24, 32, 48, 64 px. Internal padding ≤ external gap, and the gap between sections is at least 2× the gap within a group.
7. **Page rhythm:** sections are 48 px apart (64 px at ≥1280 px wide), groups 24 px, items 8–12 px. Tiles have 20–24 px padding, never less than 16 px.
8. **Type scale is closed:** 12 / 13 / 14 / 16 / 20 / 28 px, plus one display size, 44 px for hero stats. **Weights: 400, 500, 600 only.**
9. **No uppercase-tracked labels.** Labels are sentence case, 12–13 px, weight 400–500, `fg-3`, with 0 tracking. Unit abbreviations (TSS, HR, W) keep their natural case.
10. **Mono is for code, not data.** Geist Mono appears only in `kbd` hints, file names and IDs. Every number uses Geist with `tabular-nums`.
11. **Text contrast:** primary and value text ≥ 7:1 ([HIG](https://developer.apple.com/design/human-interface-guidelines/dark-mode)). Secondary text ≥ 4.5:1 on *every* surface it sits on. `fg-4` is for non-text only (≥ 3:1, [WCAG 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast)).
12. **Month cell:** ≤ 3 items plus a "+N" overflow. Each item is **one line**: glyph, title (truncated) and duration. No intensity bars, stars, dots or borders.
13. **Week summary in month view: ≤ 3 figures** (time done/plan, load done/plan, one 4 px progress bar). Everything else lives on the week page or behind hover.
14. **Tile anatomy:** 1 hero number + ≤ 2 supporting figures + ≤ 1 sparkline.
15. **Today above the fold: ≤ 12 numbers.** v1 shows ≈ 35.
16. **Charts:** ≤ 4 horizontal gridlines at `line-1`, no vertical gridlines, no frame, and direct end-labels instead of legends ([Tufte via EU DataViz guide](https://data.europa.eu/apps/data-visualisation-guide/chart-junk-and-data-ink-origins)).
17. **Zones** use an opaque, single-hue, lightness-monotonic 7-step ramp (§5.3). They always carry a "Z1–Z7" label or height, and never use an alpha ladder.
18. **Never colour alone.** Every colour-coded meaning has a shape, label or position twin ([WCAG 1.4.1](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color)).
19. **≤ 3 surface levels per view.** Elevation comes from lighter surfaces, not borders. The default border alpha is ≤ 0.10.
20. **One primary button per page.** Global "New workout" is a neutral button plus the `N` shortcut.
21. **Widths:** dashboards max 1200 px, forms and prose max 720 px, and text runs ≤ 75 characters ([Baymard](https://baymard.com/blog/line-length-readability)). The calendar stays full-bleed.
22. **Accent text** uses `accent-ink`. Text on accent fills uses `on-accent` (≥ 4.5:1).
23. **Each fact appears once per view.** No number is repeated in a subtitle, a gauge and a tile.
24. **Icons** are 16 px, `fg-3`, and only appear where they replace a word. A row holds at most one status glyph.
25. **Blur test:** with an 8 px Gaussian blur on a screenshot, only the page title, ≤ 3 hero numbers and the primary action remain identifiable.

## 1. Density and clutter

**Spacing first, boxes last.** Proximity groups nearby items ([NN/g](https://www.nngroup.com/articles/gestalt-proximity/)). Common region (border or fill) groups more strongly, but borders everywhere produce clutter ([NN/g](https://www.nngroup.com/articles/common-region/)). Refactoring UI: "use fewer borders"; separate with spacing or a background shift first ([Wathan & Schoger](https://medium.com/refactoring-ui/7-practical-tips-for-cheating-at-design-40c736799886)). Use a container only when the group acts as a unit (draggable workout, clickable tile); otherwise use spacing.

**Macro vs micro spacing.** 4 pt inside components, 8 pt rhythm between ([GitLab](https://design.gitlab.com/product-foundations/spacing)), internal ≤ external ([Cieden](https://cieden.com/book/sub-atomic/spacing/spacing-best-practices)), start with too much white space ([refactoringui.com](https://refactoringui.com/)). In v1, intra-group (8–12 px) and inter-tile (16 px) gaps are nearly equal, so nothing groups.

**Hierarchy by weight and colour, not size; labels are a last resort.** If the value is self-explanatory, drop the label ("49 bpm resting" needs no "RESTING HR"); otherwise de-emphasise it with colour ([Refactoring UI](https://www.refactoringui.com/previews/labels-are-a-last-resort)).

**Data-ink.** Erase non-data and redundant ink: frames, tick-heavy gauges, duplicate legends ([Tufte](https://data.europa.eu/apps/data-visualisation-guide/chart-junk-and-data-ink-origins); [NN/g](https://www.nngroup.com/articles/clutter-charts/)). Position and length are the preattentive encodings for quantity ([NN/g](https://www.nngroup.com/articles/dashboards-preattentive/)), so a bar beats a ring or gauge.

**Choices and memory.** Decision time grows with options (Hick); working memory holds a few chunks (Miller) ([Laws of UX](https://lawsofux.com/)). Disclose progressively ([NN/g](https://www.nngroup.com/articles/progressive-disclosure/)): month = what and how long; week = load and compliance; workout page = everything.

**Calendar cells.** Calendars cap visible events and add "+N" only on overflow ([GNOME Calendar](https://gitlab.gnome.org/GNOME/gnome-calendar/issues/211)); Fantastical's compact month shows dots with the list below ([Flexibits](https://flexibits.com/fantastical/help/calendar-views)). intervals.icu offers "compact"/"minimal" modes dropping intervals, names and flags; its users called the new weekly-summary column "unnecessarily wide" and preferred the shadowless cards as "easier to the eye" ([forum](https://forum.intervals.icu/t/calendar-and-week-info-update/109142)). TrainingPeaks' refresh moved compliance colour to one top strip and raised text contrast because old cards failed WCAG ([TrainingPeaks](https://www.trainingpeaks.com/coach-blog/trainingpeaks-calendar-refresh/)).

**Caps, tracking, mono.** All-caps forms uniform rectangles that cut readability; screen readers may spell it out ([Stanford](https://uit.stanford.edu/accessibility/learn-about/typography/all-caps)). Caps help only in very short, single-glance cases ([NN/g](https://www.nngroup.com/articles/glanceable-fonts/); [Google Fonts](https://fonts.google.com/knowledge/glossary/all_caps)). Tabular figures in a proportional face align columns without mono's width cost ([EU DataViz](https://data.europa.eu/apps/data-visualisation-guide/fonts-for-numbers)). Mono plus caps micro-labels is what produces v1's "terminal" feel.

## 2. Colour

**Not pure black; desaturate the accent.**
- Material recommends a dark grey canvas (#121212) over black, because saturated colours "produce optical vibrations against a dark background", and uses lighter, less saturated tones for dark-theme primaries ([Material](https://m2.material.io/design/color/dark-theme)). M3 maps dark primary to tone 80 and on-primary to tone 20 ([tone-based surfaces](https://material.io/blog/tone-based-surface-color-m3)). Our dark accents sit at L 0.72–0.76 with a dark on-accent (L 0.20), the same structure.
- Halation, where bright saturated marks bloom on black, is widely reported by readers with astigmatism. A less saturated version of the same hue reads comfortably ([APCA discussion #74](https://github.com/Myndex/SAPC-APCA/discussions/74)).
- True black also smears on OLED while scrolling ([Lookup](https://medium.com/lookup-design/designing-a-dark-theme-for-oled-iphones-e13cdfea7ffe)).

**Elevation = lighter surface.** Apple: dark base colours are dimmer so background UI recedes, and elevated colours are brighter so they advance ([HIG Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode)). The same page asks for ≥ 4.5:1, aiming for 7:1 for custom colours and small text. HIG also says "use colour sparingly" ([HIG Color](https://developer.apple.com/design/human-interface-guidelines/color)).

**Generated, perceptual scales.**
- Linear replaced 98 hand-set variables per theme with three inputs (base, accent, contrast), generated in LCH ([Linear](https://linear.app/now/how-we-redesigned-the-linear-ui)). Its 2026 refresh moved from a cool blue-grey to a *warmer, less saturated* grey, dimmed the sidebar, and adopted "Don't compete for attention you haven't earned" ([Linear refresh](https://linear.app/now/behind-the-latest-design-refresh)).
- Radix gives each of 12 steps a job: 1–2 backgrounds, 3–5 component fills, 6–8 borders, 9–10 solid colour, 11–12 text ([Radix](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)).
- Geist: background-100 default, background-200 "sparingly", gray 900/1000 for secondary/primary text ([Vercel](https://vercel.com/geist/colors)).
- Stripe built its palette in a perceptual space so contrast is predictable across hues ([Stripe](https://stripe.com/blog/accessible-color-systems)).

The tokens below follow the same approach: OKLCH, a fixed L per role, and only the hue changing.

**Accent budget.** The 60-30-10 heuristic gives 60% dominant, 30% secondary and 10% accent, for CTAs only ([freeCodeCamp](https://www.freecodecamp.org/news/the-60-30-10-rule-in-design/)). For a data UI on a dark canvas, use ≈ 85% canvas, 12% surfaces and text, and ≤ 3% accent. Whoop's own guidelines say colour should signal specific data sets, not decorate ([WHOOP brand guidelines](https://developer.whoop.com/assets/files/WHOOP%20-%20Brand%20&%20Design%20Guidelines-bdea3554e94b4ea09e68695b1e8dc8e7.pdf)). Apple's Activity rings use a fixed, meaning-bound colour on black and nowhere else ([HIG Activity rings](https://developer.apple.com/design/human-interface-guidelines/activity-rings)).

**Tinted neutrals.** A hue-matched tint of C 0.005–0.006 gives "warm/cool" coherence without visible colour (Linear refresh, above). It also stops neutrals and accent from looking like two systems.

**Contrast standards.**
- WCAG 2.2: text ≥ 4.5:1 ([1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum)). UI parts and graphics ≥ 3:1 against adjacent colours ([1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast)).
- APCA, which is perceptual and polarity-aware: Lc 75 body text, Lc 60 other content text, Lc 45 large or heavy text, Lc 30 floor ([APCA docs](https://www.github.com/Myndex/SAPC-APCA/blob/master/documentation/WhyAPCA.md)). APCA scores light-on-dark lower than WCAG does. Our dark `fg-2` reaches Lc 63 and `fg-3` Lc 43, so `fg-3` is for ≥ 13 px non-essential metadata only.

**Data colour.**
- Ordered data takes a single-hue sequential ramp whose lightness does the work ([ColorBrewer](https://colorbrewer2.org/learnmore/schemes_full.html)). With many classes, use strong lightness steps plus some chroma variation ([colorspace paper](https://arxiv.org/pdf/1903.06490)).
- Red/green pairs fail for deuteranopes. Blue/orange-type contrasts survive, and every encoding needs a redundant cue ([EU DataViz: accessible palettes](https://data.europa.eu/apps/data-visualisation-guide/accessible-colour-palettes)).
- Cadence has one hue, so colour-blind risk is low. Blue keeps its lightness ordering best under all three CVD types.

## 3. Typography

- **One family** for UI and numbers (Geist), with `tnum` on. Mono is reserved (Rule 10).
- **Six sizes plus one display.** Refactoring UI says to establish a hand-picked type scale rather than a modular one ([refactoringui.com](https://refactoringui.com/)). v1 defines 14 text tokens. v2:

| Token | px / line | Weight | Use |
|---|---|---|---|
| display | 44 / 48, −0.03em | 600 | ≤ 1 hero stat per region |
| title | 28 / 36, −0.02em | 600 | page h1 |
| heading | 20 / 28, −0.01em | 600 | section h2, tile values |
| body-lg | 16 / 24 | 400 | prose, workout descriptions |
| body | 14 / 20 | 400/500 | UI default, list titles (500) |
| small | 13 / 18 | 400 | labels, metadata, calendar items |
| caption | 12 / 16 | 400 | chart ticks, units, timestamps |

- **Hierarchy by weight and colour.** A value is `fg-1` at 500–600 and its label is `fg-3` at 400, with no case change. Units are `fg-3` at 0.6× size.
- **Never below 400 weight** for UI text (Refactoring UI). Never below 12 px.

## 4. Exemplars → transferable patterns

| Product | Pattern to copy |
|---|---|
| Linear | Generated LCH theme, dimmed chrome, warm low-chroma greys, accent only on focus and primary action ([refresh](https://linear.app/now/behind-the-latest-design-refresh)). |
| Fantastical / Notion Calendar | Month = map, not report. Compact titles or dots, details on selection ([Flexibits](https://flexibits.com/fantastical/help/calendar-views)). |
| intervals.icu | Card density modes (full / compact / minimal) and totals optionally on top. Lesson: users rejected shadows and wide summaries ([forum](https://forum.intervals.icu/t/calendar-and-week-info-update/109142)). |
| TrainingPeaks | What to avoid: compliance colour flooding whole cards and low-contrast multi-metric cards. Its own fix was one colour strip and higher text contrast ([TP refresh](https://www.trainingpeaks.com/coach-blog/trainingpeaks-calendar-refresh/)). |
| Whoop | A few hero scores, each with one meaning-bound colour. Everything else neutral ([guidelines](https://developer.whoop.com/assets/files/WHOOP%20-%20Brand%20&%20Design%20Guidelines-bdea3554e94b4ea09e68695b1e8dc8e7.pdf)). |
| Oura (2025 redesign) | Moved from separate boxes per biometric to integrated flow, with simplified components and semantic colour by state ([Instrument](https://instrument.com/work/oura-app); [9to5Google](https://9to5google.com/2025/10/20/oura-app-redesign/)). |
| Apple Fitness | Rings: fixed colour, black ground, three metrics max ([HIG](https://developer.apple.com/design/human-interface-guidelines/activity-rings)). |
| Things 3 | Restraint as a product value, with headings and whitespace doing the grouping ([Apple story](https://apps.apple.com/us/story/id1462498106); [MacStories](https://www.macstories.net/reviews/things-3-beauty-and-delight-in-a-task-manager/)). |
| Runna | Week-based plan list. Drag only within ±1 week, and a day accepts one run ([Runna help](https://support.runna.com/en/articles/10137793-how-to-use-and-manage-your-training-calendar)). |
| Stripe | Perceptual palette with predictable contrast steps ([Stripe](https://stripe.com/blog/accessible-color-systems)). |

**Resulting Cadence anatomy (v2):**

- **Month cell (≈ 180×120 px):**
  - Date numeral: 13 px, `fg-3`; today gets an accent 22 px disc.
  - Up to 3 items of 13 px text on 24 px rows: sport glyph 14 px in `fg-3`, title in `fg-1` (500 if key), duration in `fg-3`, right-aligned with tnum.
  - Status by glyph only: done = filled, planned = outline, missed = struck through in `fg-4`.
  - No item borders. Hover adds an `s2` fill.
- **Week summary:** "7:48 / 9:00" (heading 20), "464 / 539 load" (small), one 4 px bar in `fg-2` on `s3`. The training phase is a 12 px sentence-case caption in the week gutter, horizontal.
- **Today:**
  - One hero: Form, at display size.
  - Fitness and Fatigue as two heading-size figures.
  - Session summary as a list row, not a card.
  - Readiness as one line of text.

## 5. Palettes

### 5.1 Neutrals (identical L/C for every accent; `h` = accent hue: blue 252, green 160, rose 8)

| Role | Dark OKLCH | Dark hex (blue) | Light OKLCH | Light hex (blue) |
|---|---|---|---|---|
| canvas | `0.165 0.006 h` | `#0c0f11` | `0.990 0.003 h` | `#fafcfe` |
| surface-1 (tiles, raised) | `0.195 0.006 h` | `#131518` | `1 0 0` | `#ffffff` |
| surface-2 (hover, wells) | `0.225 0.006 h` | `#1a1c1f` | `0.968 0.006 h` | `#f2f5f8` |
| surface-3 (active, selected) | `0.260 0.006 h` | `#222427` | `0.940 0.006 h` | `#e8ebef` |
| line-1 / 2 / 3 | white α .06 / .10 / .16 | 1.14 / 1.28 / 1.57:1 on canvas | black α .07 / .11 / .17 | 1.17 / 1.28 / 1.49:1 |
| fg-1 | `0.930 0.004 h` | `#e6e8ea` | `0.220 0.009 h` | `#181b1f` |
| fg-2 | `0.780 0.006 h` | `#b5b8bb` | `0.430 0.009 h` | `#4c5055` |
| fg-3 | `0.660 0.006 h` | `#909296` | `0.520 0.009 h` | `#65696e` |
| fg-4 (non-text) | `0.500 0.006 h` | `#616367` | `0.660 0.006 h` | `#909296` |

Borders sit below 3:1 on purpose because they are decorative. Any border that *identifies a control* (inputs, checkboxes) uses `fg-4` (3.2:1 dark, 3.0:1 light).

### 5.2 Accents

| | Dark accent | hover | press | ink (text) | on-accent | Light accent | hover | press | ink | on-accent |
|---|---|---|---|---|---|---|---|---|---|---|
| **Calm blue** (h 252) | `0.72 0.12` `#6aa9ed` | `0.77 0.11` | `0.67 0.12` | `0.78 0.10` `#88bcf6` | `0.20 0.012` `#12161b` | `0.53 0.14` `#136dbf`* | `0.49 0.135` | `0.45 0.125` | `0.50 0.135` | `#ffffff` |
| **Calm green** (h 160) | `0.76 0.11` `#6dc799` | `0.81 0.10` | `0.71 0.11` | `0.80 0.10` `#82d2a8` | `0.20 0.010` `#121714` | `0.50 0.10` `#1f744f` | `0.46 0.095` | `0.42 0.09` | `0.48 0.10` | `#ffffff` |
| **Soft rose** (h 8) | `0.76 0.10` `#e896a5` | `0.81 0.09` | `0.71 0.10` | `0.80 0.085` `#eea7b3` | `0.20 0.010` `#1a1415` | `0.54 0.14` `#af455f` | `0.50 0.14` | `0.46 0.13` | `0.51 0.14` | `#ffffff` |

\*Light blue hex is approximate (rounded). All values are in sRGB gamut. Chroma is roughly half of v1's 0.221. Selection and active washes use the accent at α 0.14 (dark) or 0.10 (light).

**Computed contrast (WCAG ratio / APCA Lc):**

| Pair | Blue dark | Green dark | Rose dark | Blue light | Green light | Rose light |
|---|---|---|---|---|---|---|
| fg-1 / canvas | 15.68 / 92 | 15.68 / 93 | 15.68 / 92 | 16.82 / 102 | 16.80 / 102 | 16.85 / 102 |
| fg-2 / surface-3 | 7.76 / 61 | 7.76 / 61 | 7.76 / 61 | 6.80 / 76 | 6.79 / 76 | 6.81 / 76 |
| fg-3 / canvas | 6.20 / 43 | 6.20 / 43 | 6.18 / 43 | 5.35 / 76 | 5.34 / 76 | 5.37 / 76 |
| fg-3 / surface-3 | 5.00 / 41 | 5.00 / 41 | 4.99 / 41 | 4.62 / 66 | 4.61 / 66 | 4.63 / 66 |
| accent / canvas (non-text) | 7.79 | 9.39 | 8.59 | 5.15 | 5.54 | 5.30 |
| on-accent / accent | 7.32 / 54 | 8.81 / 63 | 8.08 / 59 | 5.30 / 81 | 5.70 / 83 | 5.46 / 82 |
| on-accent / press | 6.06 | 7.37 | 6.73 | 7.47 | 8.08 | 7.66 |
| accent-ink / canvas | 9.67 / 64 | 10.74 / 69 | 9.95 / 65 | 5.85 / 78 | 6.04 / 79 | 6.03 / 78 |

For comparison, v1: accent `#34f47a` on `#000` = 14.35:1, Lc 82. It is brighter than most of the body text, which is why it shouts.

### 5.3 Zone ramp (7 steps, opaque, single hue)

Formula, with t = (i−1)/6:
- dark: L = 0.34 + 0.50t
- light: L = 0.93 − 0.51t
- C = 0.03 + (Cmax − 0.03)·min(1, 1.4t), with Cmax 0.13 (blue) / 0.12 (green, rose), reduced in 0.005 steps until in gamut.

| | Z1 | Z2 | Z3 | Z4 | Z5 | Z6 | Z7 |
|---|---|---|---|---|---|---|---|
| Blue dark | `#2d3947` | `#38506a` | `#446890` | `#4f80b7` | `#5a9adf` | `#73b4fd` | `#a5cffe` |
| Green dark | `#2a3d33` | `#345744` | `#3d7257` | `#458e6a` | `#4dac7e` | `#63c796` | `#7fe3b0` |
| Rose dark | `#463235` | `#664248` | `#89535d` | `#ac6573` | `#d17789` | `#f18fa2` | `#feb2bf` |
| Blue light | `#daeafc` | `#b4cfef` | `#8eb5e1` | `#689ad3` | `#4180c4` | `#2066ac` | `#014e8e` |

- Dark Z1 is 1.64:1 against canvas, so it stays visible (v1's 14% alpha step sank into black). Each step to the next is 1.3–1.45:1. Adjacent zones are told apart by **position and height in the profile, plus a label**, not by colour alone (Rule 18).
- Opaque values keep the ramp stable on any surface. Alpha ladders shift with whatever is underneath.

### 5.4 Recommendation: **calm blue** (`oklch(0.72 0.12 252)` dark / `oklch(0.53 0.14 252)` light)

1. **No semantic collision.** Green reads as "success/done", which pulls it back onto every completed workout: v1's exact failure. Blue means "here, now, act", which is the narrow job Rule 3 gives the accent.
2. **CVD-robust.** Blue sits on the axis that deuteranopes and protanopes keep. Green is the hue they lose.
3. **Calm at equal contrast.** At the same text-safe contrast (7.8:1) blue reads quieter than green, because green carries the most luminance per unit of chroma.
4. **Neutral harmony.** A 252-tinted grey reads as "cool graphite", the Linear/Things register.

Calm green (`0.76 0.11 160`, a sage-mint) is the drop-in alternative if the owner wants continuity. Rose suits a warmer personality, but its light variant edges toward "error" next to warnings. Whichever hue wins, the hue is one token: only `h` changes.

## 6. v1 audit: the 15 most impactful violations

| # | Violation (seen in screenshots) | Principle | Fix |
|---|---|---|---|
| 1 | Neon accent C 0.221 on `#000` (14.4:1, Lc 82), brighter than body text | Material desaturation; halation | Calm accent C ≤ 0.12, L 0.72 (Rule 2) |
| 2 | Accent carries ≥ 9 meanings: CTA, done dots, load numbers, stars, card bars, rings, progress, Fitness, sync dot. ≈ 26 accent marks on Today, ≈ 200 on the month grid | 60-30-10; HIG "sparingly"; Linear "attention you haven't earned" | Accent only for CTA, today, selection, charts. ≤ 5 per viewport |
| 3 | Pure-black canvas plus `#ebebeb` text (17.6:1) | Material, HIG, OLED smear | Canvas L 0.165 tinted, fg-1 L 0.93 |
| 4 | Month cell holds 2–3 bordered cards × ~7 marks (2-line title, duration, glyph, signal bars, dot, star) ≈ 20 marks per cell | Hick, progressive disclosure, calendar overflow pattern | One-line items, ≤ 3 + "+N", no borders (Rule 12) |
| 5 | Week summary packs ≈ 16–18 figures per week in 11 px mono (hours, load, two WoW %, three sport distances, key count, zone counts, FIT/FAT/FORM) | Miller/chunking; intervals.icu "too wide" | 3 figures plus a bar. The rest goes to the week page |
| 6 | Uppercase tracked micro-labels everywhere ("HOURS · PLAN", "SATURDAY · 21 NOV · W47", "HEURISTIC · NOT A MEDICAL SCORE") | NN/g, Stanford on caps | Sentence case 12–13 px `fg-3`, or delete the label |
| 7 | Rotated vertical "RUN BASE 2/3" phase label in every row | Readability; non-data ink | Horizontal 12 px caption in the week gutter, shown once per phase change |
| 8 | Geist Mono for metadata and numbers ("60-day 48", "last night 60 · normal 58.8-64") gives a terminal feel | Tabular figures, not mono | Geist with tnum. Mono only for `kbd` |
| 9 | Cards in cards: the Readiness card split by 4 dividers; "Up next" card holding two bordered cards (one dashed); Session card with a bordered icon tile | Common region overuse | One container level, internal grouping by spacing (Rule 5) |
| 10 | Facts repeated: Form −2 appears in the subtitle, gauge, "Neutral" and "−3% of fitness"; week hours appear as ring 80 and as "7/9" | Data-ink (redundant ink) | Each fact once (Rule 23) |
| 11 | No hero: ≈ 35 numbers above the fold on Today, ten of them at 20–36 px semibold | Hierarchy by contrast; blur test | One display number per region, ≤ 12 numbers (Rules 14, 15, 25) |
| 12 | Decorative gauge with tick labels (−45, 35), and progress rings for hours/load | Position/length is preattentive for quantity; chartjunk | Plain number plus a 4 px bar or sparkline |
| 13 | Three "New workout" CTAs on one screen (rail, header, calendar "+ New"), the rail one a full neon slab | One primary per page | Neutral button plus `N`. The primary is reserved per page |
| 14 | Signal-bar intensity glyph, status dot, star and effort mini-histogram on every row (Activities table, calendar items) | Data-ink; icon noise | Intensity only on week and detail views. Status as glyph fill. The table keeps text columns |
| 15 | Trends: 8 tiles, each with sparkline, delta, "on track for", progress bar and caps label ≈ 5 elements × 8; zone ladder at 14–40% alpha sinks into black | Tile anatomy; sequential ramp | 4 tiles (hours, load, fitness, form), each a hero, a delta and a sparkline. Opaque zone ramp (§5.3) |

**Expected effect:** Applying Rules 3, 4, 12 and 13 alone removes roughly 80% of the coloured marks and about 70% of the text items on the calendar. That addresses both of the owner's complaints without losing information: it moves down one disclosure level.
