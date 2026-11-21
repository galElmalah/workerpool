# Product Spec — Personal Training Platform (TrainingPeaks replacement, single athlete)

Status: v1 product spec, research-backed (as of 2026-11-21)
Audience: the build team (design, frontend, backend, sync)
Owner profile: one self-coached multi-sport athlete (bike, run, swim, row, strength, plus hike, yoga and other), on Garmin, self-hosted.

> North star: **open the app, and within 2 seconds know what to do today, how the week is going, and whether training is working.** Then plan the next session in under 30 seconds and see it on the watch.

---

## 0. Research summary: what the market loves, hates, and leaves open

### 0.1 Market context (late 2026)
- **Garmin acquired TrainingPeaks and TrainHeroic** (closed 2026-07-20, announced 2026-07-22). For now TP runs as a separate unit. Its long-term independence and its integrations with non-Garmin devices are uncertain. For a Garmin user this matters little day to day, but it reinforces the reason to own the data.
- **TP Premium pricing:** annual Premium rose to **$134.99/yr** in April 2025; monthly is about $19.95. Basic users hit Premium upsells for core planning actions. Forum users report that moving a workout to another day triggers the Premium pop-up.
- **intervals.icu** is the de facto free power-user alternative. The community view is: use intervals.icu unless your coach requires TP.

### 0.2 What people genuinely love (keep, then beat)
| Source | Loved thing | Our response |
|---|---|---|
| TP | Calendar plus a **weekly summary column** (totals, fitness, fatigue, form) beside each week | Make this the centerpiece, sticky and richer (per sport, WoW deltas) |
| TP | **Compliance colors** that tell you at a glance whether you did what was planned | Keep the exact semantics. Re-express them in monochrome (§3.6) |
| TP | **PMC** (Fitness/Fatigue/Form) with a **dotted projection** from planned workouts | MUST, with phase bands and event markers |
| TP | Copy and paste of a day or a multi-week range (shift-click day headers) | MUST, and keyboard-native |
| TP | Metrics entries (HRV, sleep, weight, soreness, notes) | MUST, auto-filled from Garmin and editable |
| TP | ATP: phases (Base/Build/Peak/Race/Transition), A/B/C races, weekly TSS targets, ramp-rate guardrails | SHOULD: a lighter "Season" page. Phases and events live on the calendar |
| intervals.icu | **Text workout builder** (`- 10m 60%`, `4x`, ramps, cadence) | MUST: a cleaner, documented grammar (§4.4) |
| intervals.icu | Fitness chart with **Form zones** (relative Form %) | MUST |
| intervals.icu | Weekly totals and weekly **targets** per sport | MUST |
| intervals.icu | Activity page: auto **interval detection**, power curve vs 42-day best, **decoupling**, time in zones, interval table | MUST (adapted per sport) |
| intervals.icu | **Compare** page: overlay traces, align intervals | SHOULD (v1 has "compare to previous similar" on the activity page) |
| intervals.icu | Free, fast, constantly improving | We are self-hosted and free. Speed is a feature |
| Strava Training Log | Weeks as rows, **bubble glyphs sized by time/distance**, sport filter: a training block at a glance | Borrow for the calendar's "zoomed-out" density and the /trends consistency view |
| Runalyze | Calendar summary lines with **intensity distribution**, heatmap, race prognosis | Intensity distribution per week is MUST. Prognosis is LATER |
| TrainerRoad | **Push or pull whole weeks**, annotations for time off, **recovery warning when two hard days are dragged adjacent** | MUST shift-week and time-off markers. SHOULD hard-day adjacency hint |
| Xert | **Freshness feedback** (Very Fresh / Fresh / Tired / Very Tired) as a same-day subjective input | MUST: the 1-tap morning "How do you feel?" check-in |
| Whoop / Oura | One daily readiness read with tiers, **deviation from personal baseline**, action-oriented | SHOULD: a readiness surface on /today showing baseline-relative HRV, RHR and sleep, not a black-box score |
| Notion Calendar / Cron | `?` shortcut sheet, `C` create, `T` today, type to jump ("8 weeks"), drag to create, minimal chrome | MUST: same interaction vocabulary |
| Linear | Optimistic UI, ⌘K with recents and shortcut hints, Esc closes every overlay, instant feel | MUST: the app's interaction baseline |

### 0.3 What people hate (never ship these)
| Pain | Where | Our rule |
|---|---|---|
| **Modal and pop-up heavy UX** ("pop-up windows are terrible UX"; workout Quick View modals stacked on the calendar) | TP | **Pages, not modals.** Every object has a URL. The only overlay is ⌘K (plus transient toasts and context menus) |
| **Dated, inconsistent look**, issues unfixed for a decade | TP | Design system first: one type scale, one accent, motion spec |
| **Paywall friction on basic actions** (moving a workout, repeated "decline Premium" taps) | TP | Single user: no tiers, no upsell, ever |
| **Price** ($134.99/yr) for a calendar plus charts | TP | Self-hosted |
| **Ramps built as steps**; a .zwo ramp imported as a "range" | TP builder | True ramps in the model. Export to Garmin as stepped ranges with a clear note |
| **Strength builder doesn't sync to the watch** (the TP help center says the new Strength Builder is phone-app only) | TP | Push strength workouts to Garmin (exercise, sets, reps, weight) |
| Structured **swim/strength not exportable to Garmin** via the partner Training API historically | TP / Garmin partner API | Use the Garmin Connect workout endpoints that support pool swim and strength. FIT export as a fallback |
| **Density and settings sprawl**; "past activities look too big"; layout options proliferating | intervals.icu | Opinionated defaults, 3 density levels, no per-widget fiddling in v1 |
| Weekly totals that **mix planned and completed** confusingly; a target silently overriding the sum of planned workouts | intervals.icu | Always show **Planned / Done / Target** as separate, labeled numbers |
| Swim pace targets rendering wrong on Garmin (min/km vs /100m) | intervals.icu to Garmin | A per-sport target-encoding test suite (§4.6) |
| No formal grammar for the text syntax; nested repeats are unclear | intervals.icu | Publish the grammar with examples, support 2-level nesting, give a live parse preview |
| A Form label of "Optimal" makes people chase a constant deficit | TP/intervals.icu (forum critique) | Name the zone **"Productive"** and explain it in a tooltip |
| Readiness scores that don't match how you feel | Whoop/Oura research | Always show subjective feel **next to** the objective numbers. Never hide one behind the other |

### 0.4 What a single-user, self-hosted app can do better
1. **Zero tenancy, zero upsell, zero coach chrome.** Every pixel serves one person. No "athlete selector", no Premium lock icons.
2. **Opinionated defaults** tuned to one athlete, with thresholds history that recomputes load retroactively.
3. **Local-first speed**: the full dataset fits in the browser (years of activities ≈ tens of MB of summaries), so filters and charts run client-side at 60fps.
4. **Direct Garmin Connect parity**: push swim and strength structured workouts, which partner platforms historically couldn't.
5. **The text syntax as a first-class authoring surface**, with templates, because the user is the coach.
6. **Weekly review ritual** built in. A coach would do this. Here, the app prompts the athlete to do it.

---

## 1. Feature inventory

Legend: **MUST** = v1 (ships before daily use), **SHOULD** = v1.1 (within about 6 weeks of v1), **LATER** = backlog.

| # | Feature | TrainingPeaks | intervals.icu | Our take | Pri | Rationale |
|---|---|---|---|---|---|---|
| 1 | Calendar month view | Weeks as rows, weekly summary column on the right, quick-view modal | Weeks as rows, weekly totals, fitness inline, many layout toggles | Infinite vertical scroll, sticky summary column, page navigation instead of modals | MUST | The centerpiece. The owner's #1 ask |
| 2 | Calendar week view | Limited | Exists | 7 columns with full cards and step profiles | MUST | Planning a week needs detail |
| 3 | Agenda / list view | – | Activities list | Chronological list (best on mobile) | MUST | The default calendar on phones |
| 4 | Day view | Day in quick view | – | /calendar/day/:date page with all items, metrics, notes | MUST | Pages, not modals |
| 5 | Drag to move/copy workouts | Yes | Yes | Move = drag, copy = ⌥-drag, multi-select drag | MUST | Table stakes |
| 6 | Copy/paste day or week range | Yes (shift-click headers) | Partial | ⌘C/⌘V plus "Copy week to…" with progression % | MUST | Weekly planning speed |
| 7 | Shift week(s) forward/back | – | – | "Push plan +1 day / +1 week from here" | MUST | Life happens (TR proves the value) |
| 8 | Planned↔completed pairing | Auto + manual | Auto + manual | Auto with scoring, manual drag-to-pair, unpair | MUST | Basis for compliance |
| 9 | Compliance states | Green/yellow/orange/red/grey by duration, distance or TSS | Less prominent | Same bands, monochrome encoding, plus an "Excused" state | MUST | Owner wants plan-vs-actual at a glance |
| 10 | Weekly summary column | Totals + CTL/ATL/TSB | Totals, targets | Per-sport planned/done/target, form, WoW deltas, key-session count | MUST | "Very easy access to WoW progression" |
| 11 | Weekly targets | ATP weekly TSS | Per-sport weekly targets | Weekly target hours and load (total and per sport), set on /week or /season | MUST | Plan-vs-target is the third number |
| 12 | Structured workout builder (visual) | Block builder; ramps as steps | Text-first with chart | Step/repeat editor with a live profile graph, synced bidirectionally with text | MUST | Owner: "create workouts" |
| 13 | Text workout syntax | – | Yes, informal | Documented grammar, live parse, errors inline | MUST | The fastest authoring path for a self-coach |
| 14 | Swim builder | Exists; Garmin sync historically limited | Text; pace target bugs | Sets × reps on interval, stroke, drill, equipment; pushes to Garmin pool swim | MUST | Multi-sport parity |
| 15 | Rowing builder | Generic | Generic | Distance/time pieces at split and stroke rate | MUST | Explicit owner sport |
| 16 | Strength builder | New builder, phone logging, no device sync | Minimal | Exercises × sets × reps × load/RPE, supersets, push to Garmin, log actuals | MUST | Explicit owner sport, TP's weak spot |
| 17 | Push planned workouts to Garmin | Yes (Premium nuances) | Yes | Auto-push next 7 days, status per workout, retry, unschedule on delete | MUST | Owner: "sync them to the watch" |
| 18 | Pull activities from Garmin | Yes | Yes | Incremental sync every 10 min plus manual, FIT archive, 5-year backfill | MUST | Core data |
| 19 | Wellness from Garmin (HRV, RHR, sleep, weight, Body Battery) | Via partners / manual metrics | Yes | Auto-import daily, editable, manual entries | MUST | Readiness and trends |
| 20 | Workout library | Yes, folders | Yes, folders | Library with folders, tags, search, usage count, last-done | MUST | Self-coach reuses sessions |
| 21 | Plans (multi-week templates) | Marketplace + private plans | Plans | Save a date range as a "Block template", apply with a start date | SHOULD | Big value, but copy-week covers v1 |
| 22 | Annual plan (ATP) | Full ATP w/ phases, A/B/C, weekly TSS, ramp | ATP builder | /season: phases, events, weekly load targets, projected CTL | SHOULD | Phases and events are on the calendar in v1. The full page follows |
| 23 | Events / races A/B/C | Yes | Yes | Event entity w/ priority, distance, goal, result link, countdown | MUST | Anchors all planning |
| 24 | Phases/blocks as bands | ATP only | Partial | Calendar left-gutter bands (Base/Build/Peak/Taper/Race/Recovery/Transition) | MUST | Context in the calendar |
| 25 | Day markers (sick, injured, travel, rest) | Day notes only | Notes | Typed markers w/ glyphs, multi-day ranges, excuse missed workouts | MUST | Honest compliance |
| 26 | Notes on days | Yes (notes) | Notes | Day notes, markdown, pinned to day | MUST | Owner ask |
| 27 | Workout notes / comments | Pre/post comments | Description + chat | Pre-notes (intent), post-notes (reflection), separate fields | MUST | Owner ask |
| 28 | Journal page | – | – | /journal: all notes chronologically, searchable, filter by tag | MUST | Notes need a home |
| 29 | RPE + feel post-workout | RPE + feel | RPE + feel | 1–10 RPE + 5-point feel, one-tap mobile entry, push prompt | MUST | Owner logs on phone |
| 30 | Key workout flag | – (coach colors/tags) | Tags | `isKey` flag, accent marker, "key sessions hit" stat | MUST | Owner ask ("main" workouts) |
| 31 | Intensity classification | Via IF/TSS only | Via zones | 5-level intensity + Race, planned and auto-derived when done | MUST | Owner ask |
| 32 | Training load calc | TSS/hrTSS/rTSS/sTSS | Load (TSS-like), HRSS, TRIMP | Unified "Load" (TSS scale) with source precedence per sport | MUST | One currency across sports |
| 33 | Fitness/Fatigue/Form (PMC) | Premium | Free | /trends/fitness + calendar column + /today tile, projection | MUST | Over-time metrics ask |
| 34 | Form zones | Performance Insights labels | Form % zones | Relative Form % zones with our names | MUST | Interpretability |
| 35 | Ramp rate | ATP guardrails | Shown | Weekly CTL delta with guardrail band (≤7/wk) | MUST | Injury prevention |
| 36 | WoW / period comparisons | Dashboard charts (manual) | Charts (manual) | First-class compare: this vs last week, 4 vs prior 4, YoY | MUST | Owner ask |
| 37 | Volume by sport charts | Dashboard | Charts | Stacked weekly hours/load by sport + 4-wk rolling avg | MUST | Trends ask |
| 38 | Intensity distribution | Time in zones charts | Weekly zones | Weekly 3-zone stacked % (Easy/Mod/Hard) | MUST | Polarization check |
| 39 | Consistency heatmap/streaks | – | – | 52-week heatmap like GitHub, plus streaks | MUST | Cheap, motivating |
| 40 | Peak power/pace curves | Peak performances (Premium) | Power curves, season compare | Curves by season vs all-time; peaks per sport | MUST | Progression proof |
| 41 | Personal records / peak badges | Peak performance notifications | Best efforts | "Season best 20-min" badges on activity + journal | SHOULD | Delight |
| 42 | Threshold history | Settings | Settings w/ dates | Dated thresholds; chart; prompt on detected change | MUST (data) / SHOULD (detection) | Load accuracy |
| 43 | Activity page: summary grid | Yes | Yes | Per-sport stat grid | MUST | — |
| 44 | Activity page: map | Yes | Yes | Monochrome map w/ accent track, hover-synced | MUST | — |
| 45 | Synced time-series charts + selection stats | Yes | Yes | Stacked synced charts, brush-select → stats panel | MUST | Analysis core |
| 46 | Laps/intervals table | Yes | Auto-detected intervals | Device laps + detected intervals + planned-step alignment | MUST | — |
| 47 | Time in zones | Yes | Yes | Power, HR, pace zones per sport | MUST | — |
| 48 | Decoupling (Pw:HR / Pa:HR) | Yes | Yes | For steady efforts ≥ 45 min | MUST | Aerobic durability signal |
| 49 | Swim per-length / SWOLF | Limited | Partial | Per-length table, stroke, SWOLF, rest | MUST | Swim is a primary sport |
| 50 | Strength sets table & volume | Logged reps/weight, est 1RM | Minimal | Sets table, tonnage, est 1RM, history per exercise | MUST | — |
| 51 | Compare to planned | Compliance + overlay | Partial | Planned profile overlaid on actual, step-by-step hit table | MUST | Plan-vs-actual at activity level |
| 52 | Compare to previous similar | – | Compare page | Auto-pick last session with same template/tag; deltas | MUST | Progression at session level |
| 53 | Multi-activity compare page | – | Yes | /compare?ids= overlay & align | SHOULD | Power-user |
| 54 | Custom charts builder | Dashboard chart config | Custom charts | Not in v1. Ship a curated set of excellent charts | LATER | Avoid intervals.icu-style sprawl |
| 55 | Weekly review page | Weekly email/snapshot | – | /week/:isoWeek review + plan-next flow | MUST | Owner asks WoW + ritual |
| 56 | Command palette | – | – | ⌘K: navigate, create, jump to date, run actions | MUST | The one overlay |
| 57 | Keyboard shortcuts | Few | Few | Full set + `?` sheet | MUST | Polish |
| 58 | Undo toasts | Confirm dialogs | Confirm dialogs | Undo for every destructive action (10 s) | MUST | No confirm dialogs |
| 59 | Mobile PWA | Native app | Web + third-party apps | Installable PWA, bottom nav, push prompts for RPE | MUST | Logging after sessions |
| 60 | Offline tolerance | App caches | – | Read cache + queued writes | SHOULD | Pools and gyms have bad signal |
| 61 | Export (CSV/FIT/JSON) | Some | Yes | Activities FIT/CSV, workouts FIT/ZWO/text, full JSON backup | MUST (JSON/FIT) / SHOULD (CSV/ZWO) | Data ownership |
| 62 | Import from TP / intervals.icu | – | Imports | One-time import of historical workouts, notes, metrics (CSV/FIT) | SHOULD | Migration with history intact |
| 63 | Weather on calendar | – | Yes | Forecast on next 7 days of outdoor workouts | LATER | Nice, not core |
| 64 | Gear tracking | Yes (shoes, bikes) | Yes | Gear list, auto-assign by sport, distance totals, retire alerts | SHOULD | Useful, small |
| 65 | Fueling/nutrition | Fueling insights (new) | – | — | LATER | Out of v1 focus |
| 66 | Race predictor / marathon shape | – | – | Runalyze-like prognosis | LATER | Nice, model risk |
| 67 | AI plan generation / adaptive plans | – | – | — | LATER | Self-coached: user authors |
| 68 | Coach/athlete, sharing, social | Core of TP | Coaches, follows | — | Non-goal | Single user |
| 69 | Zwift/TrainerRoad/.zwo export | Integrations | Yes | .zwo export for indoor bike | SHOULD | Indoor trainer use |
| 70 | Hard-day adjacency hint | – | – | Subtle hint when two Hard sessions land within 24h | SHOULD | TR-proven coaching nudge |
| 71 | Readiness surface | Athlete Home metrics | Wellness | /today tile: HRV vs baseline band, RHR, sleep, feel | SHOULD | Whoop/Oura lesson, honest version |

---

## 2. Information architecture

### 2.1 Principles
- **Every object is a page with a URL.** Planned workout, activity, week, day, event, template, note. Back/forward work. Deep links can be shared to yourself.
- **Overlays allowed:** ⌘K command palette; toast notifications (with Undo); context menus (right-click / long-press); inline popovers ≤ 1 field (e.g., RPE picker on a card). **No modal dialogs.** "Are you sure?" is replaced by undo.
- **Edit in place on the page.** `/workouts/:id` is view and edit in one page. Fields are inline-editable, and autosave shows a "Saved" tick. The builder is a section of the page, not a separate route. A dedicated `/workouts/:id/edit` deep-links to the builder focused.
- **Transitions:** page-to-page uses shared-element morphs (calendar card → workout page header) via the View Transitions API. 200–280 ms, ease-out-quint. Respect `prefers-reduced-motion` (crossfade only).

### 2.2 Route map

| Route | Purpose | Key content blocks | Primary actions |
|---|---|---|---|
| `/` | Redirect: desktop → `/calendar`, mobile → `/today` (user-configurable) | — | — |
| `/today` | Daily cockpit | Readiness strip (HRV vs baseline, RHR, sleep, feel check-in); Today's workouts (large cards with step profile, Garmin sync state); "Log how it went" for today's completed; This-week mini strip (7 day pills w/ compliance glyphs); Form gauge + next event countdown; Day note | Check in feel (1 tap), open workout, log RPE, add note, quick-add workout |
| `/calendar` | The centerpiece (see §3). Default view = month (desktop) / agenda (mobile) | Week rows, sticky weekly summary column, month headers, phase bands, events | Create, drag, copy, shift, pair, mark key, navigate |
| `/calendar/month/:yyyy-mm` | Month variant anchored to a month (infinite scroll continues both ways) | | |
| `/calendar/week/:isoWeek` | Week variant (e.g., `/calendar/week/2026-W47`) | 7 columns, full cards with step profiles, day metrics row, week summary header | Plan in detail, reorder within day |
| `/calendar/day/:date` | Day page | All workouts (planned + completed) full width, day markers, metrics entry, day note, events | Add workout, edit metrics, add note, mark sick/travel |
| `/calendar/agenda` | List variant | Day groups, past collapsed to summary lines, upcoming expanded | Scroll, quick log |
| `/workouts/new` | Create planned workout (query: `?date=2026-11-24&sport=bike&from=tpl_123`) | Sport picker (big glyph grid), title, date, Builder (visual ⇄ text), metadata (intensity, key, tags, indoor/outdoor, gear), pre-notes | Save (⌘↵), Save to library, Schedule & push to Garmin |
| `/workouts/:id` | Planned workout page | Header (sport, title, date, key toggle, intensity, Garmin status); Profile graph; Steps list; Planned totals (duration, distance, load, IF); Pre-notes; If paired: compliance panel + link to activity; History of this template | Edit inline, move date, duplicate, repeat weekly, push/unpush Garmin, convert to template, delete (undo) |
| `/workouts/:id/edit` | Same page, builder focused (cursor in text editor or first step) | | |
| `/activities` | Searchable activity table | Filters (sport, date, tag, key, intensity, has-notes), columns configurable, totals row | Open, bulk tag, export CSV |
| `/activities/:id` | Completed activity analysis (§5) | Summary grid, map, synced charts, selection stats, laps/intervals, zones, peaks, decoupling, plan comparison, previous-similar comparison, RPE/feel/notes | Edit title/notes/RPE, pair/unpair, set intensity override, mark key, export FIT/CSV, split/merge (LATER) |
| `/activities/:id/compare` | Compare with `?with=:id2,:id3` | Overlaid traces, aligned intervals, delta table | Align by interval/distance/time |
| `/library` | Workout templates | Folder tree (by sport by default), search, filter by intensity/duration, cards with profile thumbnails, usage stats | New template, drag template onto mini-calendar (right rail) to schedule, duplicate, archive |
| `/library/:templateId` | Template page | Same anatomy as planned workout + "Scheduled instances" list + "Performance history" (all paired activities' compliance & key metrics) | Edit, schedule on date(s), duplicate |
| `/library/blocks/:blockId` | (SHOULD) Multi-week block template | Mini calendar of the block | Apply from date |
| `/trends` | Overview dashboard (§6) | WoW tiles row, Fitness/Form chart, weekly volume by sport, intensity distribution, consistency heatmap | Change range, compare mode, filter sport |
| `/trends/fitness` | Fitness/Fatigue/Form deep page | PMC with projection, form zones, ramp rate chart, events/phases overlays | Range, "what-if" toggle (include planned) |
| `/trends/volume` | Volume & load | Weekly/monthly stacked by sport, rolling averages, per-sport totals table, YoY overlay | Metric toggle (hours/load/distance), period toggle |
| `/trends/intensity` | Intensity distribution | Weekly 3-zone %, time-in-zone per sport, key sessions per week | Sport filter |
| `/trends/peaks` | Power/pace/swim/row curves | Curves by season vs all-time vs last 90d, PR table, threshold history | Choose sport, seasons |
| `/trends/wellness` | HRV, RHR, sleep, weight, feel | Baseline bands, 7-day rolling, correlation with load (simple overlay) | Range |
| `/trends/sport/:sport` | Per-sport page | Sport-specific volume, peaks, efficiency (EF, decoupling trend, pace@HR) | — |
| `/week/:isoWeek` | Weekly review + plan next (§7) | Plan vs actual, key sessions, load vs target, form at end, notes, highlights; "Plan next week" panel | Write reflection, set next week target, copy with progression |
| `/season` | (SHOULD) Season planner | Year grid of weeks, phase bands, events, weekly load targets, projected CTL | Add phase, set targets, add event |
| `/events/:id` | Event/race page | Priority, date, sport, distance, goal, countdown, taper plan link, result (linked activity), race report note | Edit, link result |
| `/journal` | All notes | Chronological feed of day notes, workout pre/post notes, weekly reflections; filter by type/tag; full-text search | New note, filter |
| `/settings/profile` | Name, birth year, sex (for HR defaults), weight, units, week start, timezone | | |
| `/settings/zones` | Thresholds & zones per sport with **effective dates** | FTP, run threshold pace, CSS, row threshold split/power, LTHR per sport, HRmax, RHR; zone model per sport; history table | Add new threshold (dated), recompute history |
| `/settings/sports` | Sport list, sub-sports, default gear, load source precedence, default compliance metric | | |
| `/settings/garmin` | Connection, auth status, sync options (auto-push horizon, backfill range), device list | | Connect, reconnect, run backfill, push now |
| `/settings/sync` | Sync log | Timestamped log of pulls/pushes with status, payload summary, errors, retry | Retry, view raw |
| `/settings/appearance` | Theme (dark default/light/system), accent color (5 presets), density (comfortable/compact), motion (full/reduced) | | |
| `/settings/data` | Export (JSON backup, FIT zip, CSV), import (TP/intervals CSV, FIT folder), danger zone | | Export, import |
| `/settings/shortcuts` | Full shortcut reference (same as `?` sheet) | | |
| `/welcome` | First-run onboarding (§8.10) | 4 steps | |

### 2.3 Navigation model

**Desktop (≥ 1024px):**
- **Left rail**, 64px collapsed / 208px expanded (toggle `[`): Today, Calendar, Trends, Library, Journal, (Season). Bottom: sync status dot (idle/syncing/error), Settings.
- **Top bar** (per page, 52px): page title or breadcrumb, contextual controls (calendar: view switcher Month/Week/Agenda, date range label, Today button, ‹ ›), right: ⌘K search button with hint, "+ New" button (accent).
- **Right rail (calendar only, optional, `]`):** Library drawer for drag-to-schedule. This is a docked panel, not an overlay.

**Tablet (640–1023px):** rail collapsed to icons; calendar month view drops weekly column into a row below each week (summary strip).

**Mobile (< 640px):**
- **Bottom tab bar** (5): Today · Calendar · **＋** (center, accent: create workout / log activity / add note / check-in) · Trends · More (Library, Journal, Season, Settings).
- Calendar defaults to **Agenda** with a horizontally swipeable week strip at the top. Month view is available as a "density" zoom (pinch).
- Large tap targets (≥ 44px), bottom-sheet *pages* (full-height routes that slide up) for create/log. These are still routes, so back closes them.

---

## 3. Calendar deep-dive (the centerpiece)

### 3.1 Layout (month view, desktop)

```
┌ rail ┬───────────────────────────────────────────────────────────────────────────────┬─────────────────────┐
│      │ NOVEMBER 2026                                  [Month|Week|Agenda]  ‹ Today ›  │                     │
│      ├─ph─┬─────────┬─────────┬─────────┬─────────┬─────────┬─────────┬─────────┬────┤  WEEK SUMMARY      │
│      │ B  │ Mon 16  │ Tue 17  │ Wed 18  │ Thu 19  │ Fri 20  │ Sat 21● │ Sun 22  │    │  (sticky column)   │
│      │ U  │ [card]  │ [card]  │ [card]  │ rest ☾  │ [card]  │ [card]  │ [card]  │    │  W47  Build 2 · 3/4│
│      │ I  │         │ [card]  │         │         │         │ [card]  │         │    │  9:40 / 11:30 h    │
│      │ L  │         │         │         │         │         │         │         │    │  612 / 720 load    │
│      │ D  │         │         │         │         │         │         │         │    │  ▲ +8% hrs WoW     │
│      │ 2  │         │         │         │         │         │         │         │    │  per-sport bars    │
│      │    │         │         │         │         │         │         │         │    │  Fit 74 Fat 92 Fm−18│
└──────┴────┴─────────┴─────────┴─────────┴─────────┴─────────┴─────────┴─────────┴────┴─────────────────────┘
```

- **Weeks are rows.** Week start = user preference (default **Monday**). The ISO week number is shown in the summary column.
- **Phase gutter** (24px) at the far left of each week row: a vertical band with a rotated label ("BUILD 2"). It spans contiguous weeks with the same phase and is drawn as one continuous shape across rows.
- **Weekly summary column** (240px, right side, sticky horizontally and aligned per row). On viewports < 1280px it collapses to 160px showing only Done/Planned hours + load + Form.
- **Month headers:** as rows scroll, a sticky month label ("NOVEMBER 2026") sits in the top bar and updates at the first week containing the 1st of the month. Inside the grid, the 1st of each month gets a bold day number with the month abbreviation ("1 DEC"). Days outside the "anchor" month are **not** dimmed, because the scroll is continuous.
- **Today:** the day cell gets a 1px accent top border and the accent day number pill. Past days have full-contrast text. Future cells have a slightly lower surface tone (planned territory).
- **Infinite vertical scroll** with virtualization: render ±8 weeks around the viewport and fetch in 12-week pages. On load, scroll to the current week, positioned as the 2nd row (one week of context above).
- **Row height:** auto, min 132px (comfortable) / 96px (compact). Row height = max over days of the stacked card heights, capped at 4 cards then "+N more".

### 3.2 Weekly summary column (exact content)

Top to bottom:
1. `W47 · Build 2 · wk 3/4` (ISO week, phase, position in block). Click → `/week/2026-W47`.
2. **Hours:** `9:40 / 11:30 h`, where the first number is **Done** and the second is **Planned**. Beneath is a thin progress line (Done/Planned) with a tick at the **Target** if set, and a small `T 12:00` label.
3. **Load:** `612 / 720`, same treatment.
4. **Distance per sport** (only sports with activity or plan this week), one line each: `[bike glyph] 182 / 210 km` · `[run glyph] 34 / 40 km` · `[swim glyph] 6.2 / 7.5 km` · `[row glyph] 12 km` · `[strength glyph] 2 / 2 sessions`. For strength, yoga and other we show sessions and time, not distance.
5. **Sport mix bar:** a single horizontal 100% stacked bar of done hours by sport, grayscale ramp (see §3.6.4).
6. **Key sessions:** `★ 2/3 key done` (the accent star).
7. **Intensity split** (done): `E 78 · M 9 · H 13 %`, shown as a tiny 3-segment bar.
8. **End-of-week form block:** `Fit 74 (+3)` · `Fat 92` · `Form −18 (−24%)` with the zone name `Productive`. Values are as of the week's last day. For future weeks they are projected, rendered in italic with a "proj." label.
9. **WoW deltas** for hours and load: `▲ 8%` / `▼ 12%` / `– 0%` (±3% counts as flat). Arrows are monochrome. A delta beyond +15% load WoW gets the accent outline as a ramp caution.
10. A **week note** indicator if a weekly reflection exists (`¶`).

Hover on any number → a tooltip with the per-sport breakdown. Click → `/week/:isoWeek`.

Rules:
- **Planned** = the sum of planned workouts (including those paired with completed). **Done** = the sum of completed activities (paired + unplanned). **Target** = an explicit weekly target (never silently replaces Planned). If no Target is set, the Target tick is hidden.
- In the current week, Planned includes remaining days, so the user sees "where I'll land if I do the plan" as a ghost segment on the progress line (Done + remaining planned).

### 3.3 Day cell content & density rules

Order inside a day cell (top to bottom):
1. **Day header line:** day number (+ month abbr on the 1st), day markers glyphs (sick ✚, injured ⨯-bandage, travel ✈, rest ☾), note indicator `¶`, readiness dot (filled = HRV within/above baseline, ring = below) for past days if wellness exists.
2. **Event banner(s)** (races/events): full-width, above workouts.
3. **Workout cards**, sorted by: planned start time if set → key first → by planned duration desc. A paired planned+completed renders as **one card** (merged), not two.
4. **Day note preview** (first line, 1 line clamp, muted) if space allows.

Density levels (auto by cell width, user can force compact):
| Cell width | Card mode | Shows |
|---|---|---|
| ≥ 170px | **Full** | glyph, title (2-line clamp), duration · distance · load, compliance glyph, key star, intensity pips, note & Garmin icons, mini step-profile sparkline (planned) |
| 120–169px | **Compact** | glyph, title (1 line), primary metric (duration), compliance glyph, key star, intensity pips |
| < 120px / zoomed-out | **Chip** | glyph + duration only, compliance by chip shape; Strava-like "bubble" option sized by duration |

Overflow: max **4** cards per cell in Full/Compact. Beyond that, "+2 more" (click → the day page). Multi-workout days (e.g., brick, AM swim + PM strength) are common, so 2–3 cards must fit without overflow at default row height.

### 3.4 Workout card anatomy

```
┌───────────────────────────────┐
│▌🚴 Threshold 4×8      ★  ◐ ¶ ⟳│   ▌ = key rail (accent, 2px) only when key
│  1:15 · 42 km · 88 load       │   ★ = key; ◐ = compliance glyph; ¶ = has notes; ⟳ = Garmin sync state
│  ▂▂▅▅▂▅▅▂▅▅▂▂   ▮▮▮▮▯        │   step-profile sparkline · intensity pips (4/5 = Threshold)
│  ━━━━━━━━━━━━━━━━━━━━┃━━━     │   compliance bar: actual/planned, tick at 100%
└───────────────────────────────┘
```

Elements:
- **Sport glyph** (16px, monochrome custom set): bike, run, swim, row, strength, hike, yoga, walk, ski, other. Sub-sport is shown only in the detail page (indoor bike = glyph with a small "i" corner dot).
- **Title**: user title, or an auto-title from the structure ("4×8′ @ 95–100%").
- **Metrics line**: for planned-only: planned duration · distance (if set) · planned load. For completed: actual values, with planned values on hover. Format: `1:15` (h:mm), `42 km`, `88`. The word "load" appears only in full mode.
- **Key marker**: 2px **accent** left rail + `★`. The accent is reserved for key/now/selected, which is why key sessions pop.
- **Intensity pips**: 5 small vertical bars (`▮▮▮▮▯`) = level 1–5. Race = a flag glyph instead of pips.
- **Compliance glyph + bar**: see §3.6.
- **Note indicator** `¶`: when pre-note or post-note exists.
- **Garmin state** (planned, future only): `⟳` pending push, `✓` on Garmin, `!` failed (with tooltip). Hidden for past items.
- **Step-profile sparkline**: planned structure as a micro bar chart (height = target intensity). For completed items, it shows the actual power/pace profile downsampled to 48 bars.

Card states on hover: lift 1px + shadow token, show the quick-actions row (Open, Duplicate, Mark key, Push to Garmin, Delete). Focus ring = 2px accent.

### 3.5 Interactions

**Pointer**
- **Click card** → navigates to `/workouts/:id` (planned) or `/activities/:id` (completed/merged opens the activity with the plan panel). Shared-element morph from the card to the page header.
- **Drag card** to another day → move (planned only. Completed activities cannot be moved, only re-paired). The drop shows a ghost preview with a live reflow of the target cell. On drop, an optimistic update plus a toast: "Moved **Threshold 4×8** to Thu 19. Undo".
- **⌥/Alt-drag** → copy. **Shift-drag** onto a planned card → pair or swap (for completed onto planned: pair).
- **Drag from the library rail** onto a day → schedule the template.
- **Click empty cell space** (or double-click) → **inline quick-add composer** in the cell: a single text field with a sport prefix autocomplete. Type `run 45m easy` or `bike 4x8m 95-100%` (text grammar §4.4) → ↵ creates. ⌘↵ creates and opens the full page. Esc cancels. The composer supports `@key` and `#tag` tokens.
- **Drag-select across days** (mouse down on an empty area and drag) → multi-day selection → actions bar appears at the bottom of the viewport (docked, not modal): Copy, Cut, Delete, Shift ±, Mark as travel/sick, Add note, Set phase.
- **Click day number** → `/calendar/day/:date`. **Click week label** → `/week/:isoWeek`.
- **Right-click / long-press** card → context menu: Open, Duplicate, Copy, Move to…, Mark key, Set intensity ▸, Push to Garmin, Unpair, Save to library, Delete.
- **Resize?** No. Duration is edited on the page, not by resizing in the month view (there is no time axis).

**Keyboard** (calendar focus model: a "cursor" on a day cell, and a sub-cursor on cards within the day)
| Key | Action |
|---|---|
| ← → ↑ ↓ | Move day cursor (↑↓ = ±1 week) |
| Tab / Shift-Tab | Cycle cards within the focused day |
| ↵ | Open the focused card / day |
| `C` or `N` | Quick-add on the focused day |
| `T` | Jump to today |
| `G` then type | "Go to" date/week: accepts `2026-12-24`, `dec 24`, `w52`, `+8w`, `next race` |
| `M` / `W` / `A` / `D` | Month / Week / Agenda / Day view |
| ⌘C / ⌘X / ⌘V | Copy / cut / paste the focused card(s) or day(s) at the cursor |
| ⌘D | Duplicate the focused card to the next day |
| Shift + arrows | Extend the day selection |
| `K` | Toggle key on the focused card |
| `1`–`5` | Set intensity level on the focused planned card |
| `S` | Shift: prompts inline "Shift from here by [+1d]" (arrow keys adjust, ↵ apply) |
| Delete / Backspace | Delete (undo toast) |
| ⌘Z / ⌘⇧Z | Undo / redo (session-wide stack, 50 deep) |
| `?` | Shortcut sheet (page `/settings/shortcuts`, or the palette section) |
| ⌘K | Command palette |

**Bulk operations**
- **Copy week:** select a week (click the week label with Shift, or `Shift+W` on the cursor) → ⌘C → move the cursor to the target week → ⌘V. The paste places items on the same weekday. Paste preview shows ghosts. A toast offers "Apply +5% progression?" (one tap).
- **Copy week to…** (summary column menu): target week picker + progression % (−40 … +20, default 0) + options (include notes, include key flags). This is the same flow as §7's plan-next.
- **Shift plan:** "Push everything from Wed 18 by +1 day" (or ±N days/weeks). Completed items never move. Events never move unless "include events" is checked. Shows a ghost preview before applying.
- **Repeat weekly:** on the workout page, "Repeat every [Tue] for [6] weeks" creates linked copies (a series id). Editing asks inline in the page: "Apply to this / this and following". This is an inline choice, not a modal.

**Zoom & transitions**
- View switcher morphs: **Month → Week**: the selected week row expands vertically while other rows collapse up/down (FLIP animation, 280 ms). Cards morph from compact to full (shared element ids). **Week → Day**: the day column expands to full width. Reverse morph on the way back.
- Pinch (trackpad/mobile) zoom: chip ↔ compact ↔ full density, and further out a **"Year strip"** (LATER): 52 weeks as thin rows, each with a load bar, phase band and event flags.
- **Today jump**: a smooth scroll with an ease-out spring, max 600 ms regardless of distance (it teleports to ±4 weeks then animates).

### 3.6 Planned ↔ completed pairing & compliance

#### 3.6.1 Pairing rules (automatic)
On each new completed activity:
1. Candidates = planned workouts on the **same local date**, not yet paired, with a **compatible sport** (same sport; bike↔indoor bike; run↔trail/treadmill; swim pool↔open water; "other" matches nothing automatically).
2. Score each candidate: `score = 0.5·durationSimilarity + 0.3·startTimeProximity + 0.2·(template/tag match)`, where `durationSimilarity = 1 − min(|a−p|/p, 1)`. If no planned start time, startTimeProximity = 0.5.
3. Pair the highest score if `score ≥ 0.35`. Otherwise leave as **Unplanned**.
4. **One-to-one** in v1. Two activities for one plan (e.g., a ride split by a café stop): the user can "Merge activities" (SHOULD) or pair one of them and leave the other unplanned.
5. Manual: drag an activity onto a planned card (Shift-drag), or use "Pair with…" on either page, with any date allowed. Unpair is available anywhere. Manual pairings are never overridden by auto-pairing.

#### 3.6.2 TrainingPeaks compliance thresholds (reference, documented)
TP computes compliance as **completed ÷ planned** on **duration, distance or TSS** (selectable in calendar settings), with these bands:
| TP color | Rule |
|---|---|
| **Green** | Completed within **±20%** of planned (80–120%) |
| **Yellow** | **50–79%** or **121–150%** of planned |
| **Orange** | **< 50%** or **> 150%** of planned |
| **Red** | Planned workout **not completed** (date passed) |
| **Grey** | **Unplanned** completed workout (no planned values) |
(Some older TP help text calls >±50% "red". Final Surge uses red for <50%/>150%. Current TP guidance uses orange for that band and red for missed.)

#### 3.6.3 Our compliance computation
- **Metric precedence** (default; overridable per sport in settings): **Load** if planned load > 0 and the activity has load → else **Duration** → else **Distance**.
- `ratio = actual / planned`, rounded to whole %.
- States:
| State id | Rule | Label (copy) |
|---|---|---|
| `planned` | Future (or today, not yet done) | "Planned" |
| `on_target` | 80% ≤ ratio ≤ 120% | "On plan" |
| `partial_short` | 50% ≤ ratio < 80% | "Short" |
| `partial_long` | 120% < ratio ≤ 150% | "Long" |
| `off_short` | ratio < 50% | "Way short" |
| `off_long` | ratio > 150% | "Way over" |
| `missed` | Planned date < today (local), unpaired, not excused | "Missed" |
| `excused` | Missed, but the day has a sick/injury/travel marker or the user tapped "Skip (reason)" | "Skipped · sick" |
| `unplanned` | Completed, no planned pair | "Unplanned" |
- "Missed" is assigned at local midnight following the planned date. Today's unpaired planned workouts stay `planned` all day.
- Compliance % for a week = mean of per-workout clamped ratios (cap 1.0) over `planned` items whose date has passed, excluding `excused`. It is shown on /week.

#### 3.6.4 Expressing compliance in black/white + ONE accent
The accent is **not** used for compliance (it means "key / today / selected"). Compliance is encoded with **fill, outline, pattern and glyph**, so it works for color-blind users and in print:

| State | Card surface | Border | Pattern/text | Glyph | Bar |
|---|---|---|---|---|---|
| Planned (future) | Transparent | 1px **dashed** neutral-500 | — | ○ hollow ring | none |
| On plan | **Solid surface** (neutral-850 on dark / white on light) | 1px solid neutral-600 | — | ● filled disc | full-tone bar to the ratio, tick at 100% |
| Short / Long | Solid surface | 1px solid | — | ◐ half disc (left half for short, right half for long) | bar shows under/overshoot past the tick |
| Way short / Way over | Solid surface | **2px** solid neutral-300 (higher contrast = "look at me") | — | ◔ / ◕ quarter-disc | bar, with the over portion drawn hatched |
| Missed | Transparent | 1px dashed neutral-600 | **45° hatch** at 8% opacity + title **struck through**, text at 55% | ⊘ | none |
| Excused | Transparent | 1px dotted | Title normal, muted 55%; reason chip "sick" | ◌ dotted ring | none |
| Unplanned | Solid surface | none (borderless) | — | small ▪ square | none |

Grayscale sport ramp (used in stacked charts and the mix bar; dark theme values):
`bike #F2F2F2 · run #BDBDBD · swim #8C8C8C · row #6B6B6B · strength #4A4A4A + diagonal hatch · other/hike/yoga #333333 + dot pattern`. Hover on a series lifts it to the **accent** and dims the others to 40%.

**Accent palette** (one active at a time, set in /settings/appearance). Default: **Signal Orange `#FF5A1F`** (AA on black and white for ≥ 14px bold). Presets: Volt `#C8FF2E` (dark-only recommended), Electric Blue `#3D7BFF`, Hot Magenta `#FF2E88`, Mint `#2EE6A6`. Neutral scale: 12 steps from `#000` to `#FFF` (dark-first: background `#0A0A0A`, surface `#141414`, raised `#1C1C1C`).

### 3.7 Multiple workouts per day, rest days, events, notes, markers, phases

- **Multiple per day:** a stacked list. Merged planned+completed cards count once. A brick (bike→run within 15 min) shows a thin connector line between the two cards and a "Brick" label in Full mode.
- **Rest day:** an explicit marker `☾ Rest` (planned rest) shows the muted label "Rest". An **empty past day** shows nothing (not "rest"). A planned rest day counts toward "plan compliance" as done if no activity has load > 30. Otherwise it gets the subtle annotation "Rest day used for training".
- **Events/races:** entity `Event { priority: 'A'|'B'|'C', sport, name, distance, goal, location, startTime }`. They render as a full-width banner at the top of the day:
  - **A**: solid **accent** fill banner with a flag glyph, white text. It also appears in the top-bar countdown ("Ironman 70.3 · 23 days") and as a vertical accent line on all Fitness charts.
  - **B**: accent **outline** banner.
  - **C**: neutral outline banner, small.
  - After the event, the linked activity's result (time, place) shows in the banner.
- **Notes on days:** `¶` indicator in the day header and a 1-line preview at the bottom of the cell. Click → day page with the note editor (markdown, autosave). Notes are also reachable in /journal.
- **Day markers (typed, multi-day ranges):** `sick`, `injured`, `travel`, `vacation`, `altitude`, `rest`.
  - Single day: glyph in the day header + a 6% hatch overlay for sick/injured.
  - Range (travel, vacation): a **thin horizontal band** (3px, neutral-400) along the top of the affected cells, continuous across days, with the label on the first day ("✈ Lisbon").
  - Planned workouts on sick/injured days that are not completed become `excused` automatically.
- **Phases/blocks:** `Phase { type: 'base'|'build'|'peak'|'taper'|'race'|'recovery'|'transition', label, startDate, endDate, weeklyLoadTarget? }`. They render in the **left phase gutter** as a continuous vertical band. Fill tone differs by type (neutral ramp: base lightest → peak darkest; taper and recovery use dot patterns). The label is rotated 90°, e.g. "BUILD 2 · wk 3/4". Create one by drag-selecting weeks → "Set phase". Click the band → /season (SHOULD) or an inline phase editor in the day page in v1.

### 3.8 Week view & agenda specifics
- **Week view:** 7 equal columns plus the summary header on top (the same content as the column, laid out horizontally). Cards are always Full, with a larger step-profile (64px tall). A day metrics row at the bottom of each column shows HRV, RHR, sleep h, weight and feel emoji-free glyphs (1–5 dots).
- **Agenda:** grouped by day, with sticky day headers. Past days are collapsed to one summary line ("Tue 17 · Run 45′ ● · Strength 40′ ●"). Today and the future are expanded. Pull-to-refresh triggers a Garmin sync on mobile.

---

## 4. Workout model

### 4.1 Entities (field names are canonical; snake_case in DB, camelCase in API)

```ts
type Sport = 'bike'|'run'|'swim'|'row'|'strength'|'hike'|'walk'|'yoga'|'ski'|'other';
type SubSport =
  | 'road'|'indoor'|'mtb'|'gravel'            // bike
  | 'road_run'|'trail'|'treadmill'|'track'    // run
  | 'pool'|'open_water'                       // swim
  | 'erg'|'on_water'                          // row
  | 'gym'|'bodyweight'|'mobility'             // strength
  | 'generic';

type IntensityLevel = 1|2|3|4|5;               // Recovery, Endurance, Tempo, Threshold, High
type IntensityClass = 'recovery'|'endurance'|'tempo'|'threshold'|'high'|'race';
type IntensityBucket = 'easy'|'moderate'|'hard'; // 1–2 easy, 3 moderate, 4–5 + race hard

interface PlannedWorkout {
  id: string;
  date: string;                 // local date 'YYYY-MM-DD'
  startTime?: string;           // 'HH:mm' optional (orders cards, scoring)
  sport: Sport; subSport?: SubSport;
  title: string;                // user or auto-generated
  description?: string;         // markdown: purpose / coaching cues (shown on watch as notes if supported)
  preNote?: string;             // intent for the day ("legs heavy, keep it honest")
  plannedDurationSec?: number;  // derived from steps if structured, else manual
  plannedDistanceM?: number;
  plannedLoad?: number;         // derived from steps + current thresholds, else manual
  plannedIF?: number;
  structure?: WorkoutStructure; // steps tree (null = unstructured)
  isKey: boolean;               // "Key session" (main workout of the week)
  intensity: IntensityClass;    // planned; auto-suggested from structure
  tags: string[];               // free, e.g. ['vo2','hills','brick']
  environment: 'indoor'|'outdoor'|'any';
  gearId?: string;
  templateId?: string;          // library origin
  seriesId?: string;            // repeat-weekly series
  eventId?: string;             // if this is the race itself
  pairedActivityId?: string;
  status: 'planned'|'skipped';  // explicit skip w/ reason
  skipReason?: 'sick'|'injury'|'travel'|'fatigue'|'life'|'weather'|'other';
  garmin: { workoutId?: string; scheduleId?: string; syncState: 'none'|'pending'|'synced'|'error'; lastPushedAt?: string; error?: string; };
  createdAt: string; updatedAt: string;
}

interface Activity {            // completed
  id: string; source: 'garmin'|'upload'|'manual';
  garminActivityId?: string; fitFileRef?: string;
  startedAt: string; timezone: string; localDate: string;
  sport: Sport; subSport?: SubSport; title: string;
  durationSec: number; movingSec: number; distanceM?: number; elevationGainM?: number;
  load: number; loadSource: 'power'|'pace'|'swim_pace'|'hr'|'rpe'|'manual';
  IF?: number; avgHr?: number; maxHr?: number; avgPower?: number; normalizedPower?: number;
  avgPaceSecPerKm?: number; avgCadence?: number; calories?: number;
  intensityAuto: IntensityClass; intensityOverride?: IntensityClass;
  isKey: boolean;               // inherited from the pair, can be set on unplanned
  rpe?: 1|2|3|4|5|6|7|8|9|10;
  feel?: 1|2|3|4|5;             // 1 awful … 5 great
  postNote?: string;            // reflection
  tags: string[]; gearId?: string;
  pairedPlannedId?: string;
  compliance?: { metric: 'load'|'duration'|'distance'; ratio: number; state: ComplianceState; };
  streams: StreamRef;           // time, distance, power, hr, cadence, speed, altitude, latlng, temp, strokes
  laps: Lap[]; intervals: DetectedInterval[]; swimLengths?: SwimLength[]; strengthSets?: StrengthSet[];
  peaks: PeakSet;               // computed best efforts
}
```

Supporting: `Template` (same as PlannedWorkout minus date/pairing, plus `folder`, `usageCount`, `lastUsedAt`), `Event`, `Phase`, `DayMarker {date, endDate?, type, label?}`, `DayNote {date, body}`, `WeekNote {isoWeek, body, targetHours?, targetLoad?, perSportTargets?}`, `WellnessDay {date, hrvMs, hrvStatus, rhr, sleepSec, sleepScore, weightKg, bodyBattery, feel, soreness 1–5, stress 1–5, note}`, `Threshold {sport, kind: 'ftp'|'thr_pace'|'css'|'row_thr_split'|'row_ftp'|'lthr'|'hrmax'|'rhr', value, effectiveFrom}`.

### 4.2 Structure model

```ts
interface WorkoutStructure { steps: Node[]; poolLengthM?: 25|50|22.86 /*25y*/; }
type Node = Step | Repeat;
interface Repeat { kind: 'repeat'; count: number; steps: Node[]; label?: string; } // max nesting depth 2
interface Step {
  kind: 'step';
  role: 'warmup'|'active'|'recovery'|'rest'|'cooldown'|'other';
  label?: string; cue?: string;               // shown on watch where supported
  isMainSet?: boolean;                         // marks "main set" for the profile highlight
  measure: { type: 'time'; sec: number } | { type: 'distance'; m: number } | { type: 'lap_button' } | { type: 'reps'; n: number };
  target?: Target; secondary?: Target;         // e.g. power + cadence, pace + HR cap
  swim?: { stroke: 'free'|'back'|'breast'|'fly'|'im'|'choice'; drill?: string; equipment?: ('pull_buoy'|'paddles'|'fins'|'kick_board'|'snorkel')[]; sendOffSec?: number; restSec?: number };
  row?: { strokeRate?: [number, number] };
  strength?: StrengthPrescription;
}
type Target =
  | { type: 'power_pct'; low: number; high: number }      // % FTP
  | { type: 'power_w'; low: number; high: number }
  | { type: 'hr_zone'; zone: 1|2|3|4|5 } | { type: 'hr_pct_lthr'; low: number; high: number } | { type: 'hr_bpm'; low: number; high: number }
  | { type: 'pace'; lowSecPerUnit: number; highSecPerUnit: number; unit: 'km'|'mi'|'100m'|'100y'|'500m' }
  | { type: 'pace_pct'; low: number; high: number }        // % threshold pace / CSS
  | { type: 'rpe'; low: number; high: number }
  | { type: 'cadence'; low: number; high: number }         // rpm / spm
  | { type: 'ramp'; from: Target; to: Target }             // true ramp in model
  | { type: 'open' };                                      // freeride / no target
interface StrengthPrescription {
  exerciseId: string;           // from exercise catalog (maps to Garmin exercise category/name)
  sets: number; reps?: number | [number, number]; durationSec?: number;
  load?: { type: 'kg'|'lb'|'pct_1rm'|'bodyweight'; value?: number };
  rpe?: number; tempo?: string; restSec?: number; supersetGroup?: string; // 'A','B'… exercises sharing a group alternate
}
```

### 4.3 Intensity classification (concrete)

**Scale** (planned and done), with the card pip count:
| Level | Class | Pips | Bucket | Typical | Bike (%FTP) | Run (%thr pace speed) | HR (%LTHR) | RPE |
|---|---|---|---|---|---|---|---|---|
| 1 | Recovery | ▮ | Easy | spin, shakeout | < 56% | < 78% | < 81% | 1–2 |
| 2 | Endurance | ▮▮ | Easy | Z2 long | 56–75% | 78–88% | 81–89% | 3–4 |
| 3 | Tempo | ▮▮▮ | Moderate | tempo, sweet spot | 76–90% | 88–95% | 90–94% | 5–6 |
| 4 | Threshold | ▮▮▮▮ | Hard | 2×20, cruise intervals | 91–105% | 95–102% | 95–100% | 7–8 |
| 5 | High | ▮▮▮▮▮ | Hard | VO2max, anaerobic, sprints | > 105% | > 102% | > 100% | 9–10 |
| — | Race | ⚑ | Hard | events | — | — | — | — |

**Auto-derivation**
- *Planned* (from structure): take the highest-level target among `active` steps whose cumulative time ≥ the minimum for that level: High ≥ 4 min, Threshold ≥ 10 min, Tempo ≥ 15 min. Otherwise Endurance if the total is ≥ 45 min above Recovery, else Recovery. Unstructured: from the planned IF, or manual. The user can override, and the override wins.
- *Completed* (from data): time in zone (power → pace → HR, in that order of availability), using the same minimum-time rules **over the whole activity**: `≥ 5 min (or ≥ 8% of moving time) in L5 → High; ≥ 10 min in L4 → Threshold; ≥ 15 min in L3 → Tempo; IF ≥ 0.60 or ≥ 60% time in L2 → Endurance; else Recovery`. With no zone data, use RPE (the table above). The derivation is shown as "Auto · Threshold (14′ in Z4)". The override shows "Set by you".
- *Event-linked* activity → Race.

### 4.4 Load model (one currency: "Load", TSS-scaled; 1 h at threshold = 100)

Source precedence per sport:
| Sport | 1st | 2nd | 3rd | 4th |
|---|---|---|---|---|
| Bike | Power: `h × IF² × 100`, IF = NP/FTP | HR | RPE | — |
| Run | Pace: NGP/threshold pace (rTSS-style) | Power (if run FTP set) | HR | RPE |
| Swim | `h × IF³ × 100`, IF = CSS speed-based | HR | RPE | — |
| Row | Power (erg) | Split pace vs threshold split | HR | RPE |
| Strength, yoga, hike, other | RPE (sRPE mapped) | HR | default by intensity class | — |

- **HR load:** zone-weighted per hour: Z1 30, Z2 55, Z3 75, Z4 100, Z5 130 (LTHR-based 5-zone model).
- **RPE load:** map RPE → IF-equivalent: 1:.50, 2:.55, 3:.65, 4:.70, 5:.75, 6:.82, 7:.88, 8:.95, 9:1.02, 10:1.10; `load = h × IFeq² × 100`. Strength missing RPE defaults to RPE 6 and is flagged "est.".
- **Fitness** = 42-day EWMA of daily load. **Fatigue** = 7-day EWMA. **Form** = yesterday's Fitness − yesterday's Fatigue (TP convention, so today's training doesn't change today's form). **Form %** = Form / Fitness.
- **Form zones** (relative, by Form %): `> +20% Transition` (detraining) · `+5…+20% Fresh` (race-ready) · `−10…+5% Neutral` · `−30…−10% Productive` · `< −30% Overreaching`. (Community-reported intervals.icu defaults: Fresh 5–20%, "Optimal" −10 to −30%, high risk below −30%. We rename "Optimal" to "Productive" to avoid encouraging a permanent deficit. TP coaches advise not exceeding about −30 absolute TSB.)
- **Ramp rate** = Fitness(today) − Fitness(7 days ago). Guidance band: **≤ 5/wk normal**, **5–8 aggressive**, **> 8 risky** (TP guidance: a safe 7-day CTL increase is about 4–8; at CTL ≤ 45, ≥ 7/wk is high risk).
- Threshold changes are **effective-dated**. Historical load is recomputed when thresholds before the latest date are edited (a background job shows progress in /settings/sync).

### 4.5 Builder UX (on `/workouts/new` and `/workouts/:id`)

Layout (desktop): left 60%: **profile graph** on top (full width, 160px high) + **step list** beneath. Right 40%: **text editor** (monospace) with a live parse. They are bidirectional: editing either updates the other within 50 ms. Mobile: tabs "Steps | Text", with the graph pinned on top.

**Profile graph**
- x = time (distance steps are converted using the target pace). y = intensity as % of threshold (or zone).
- Bars are filled in a neutral tone. **Main-set steps are in the accent.** Ramps are drawn as true slopes. Repeats get a bracket above with "4×".
- Hover a bar → highlight the step in the list and the text line. Drag a bar's top edge → change target (snaps to 1% / 5 W / 1 s pace). Drag its right edge → change duration (snaps to 15 s / 50 m).
- Totals ribbon under the graph: `1:15:00 · 88 load · IF 0.84 · 42 km est.`

**Step list**
- Rows: role chip, measure, target(s), cue. Inline editable. Drag to reorder.
- Toolbar: `+ Step`, `+ Repeat`, `+ Warmup`, `+ Cooldown`, `Wrap in repeat` (⌘G), `Mark as main set` (⌘M), `Duplicate` (⌘D).
- Repeats render as indented blocks with a count stepper. Nesting is capped at depth 2.
- The target type is chosen per workout (default per sport: bike %FTP, run pace, swim pace/100 m on CSS, row split/500 m, strength n/a) and can be changed per step.

**Per-sport specifics**
- **Bike:** %FTP / W / HR zone / RPE. Cadence secondary. "Open" (freeride) steps. ERG note: ramps export as ramps to .zwo and as stepped ranges to Garmin.
- **Run:** pace (min/km or min/mi) / % threshold pace / HR zone / RPE. Measures by time or distance. "Lap button" steps for track sessions ("until lap press").
- **Swim (set editor):** row format `reps × distance stroke @ target on send-off` with equipment chips and a drill picker. Example row: `8 × 100 m Free · CSS+3s · on 1:50 · [pull buoy]`. Rest is either "send-off" (interval clock) or "rest Xs". Pool length per workout (25 m / 50 m / 25 y). Totals show distance and est. time. The graph x-axis shows distance.
- **Row:** pieces by distance or time at a split (/500 m) and stroke-rate range (spm). Example: `4 × 2000 m @ 1:52/500 m · 24–26 spm · rest 5:00`. Power target is optional (W).
- **Strength:** an exercise table, not a step graph. Columns: `Exercise · Sets · Reps · Load (kg / %1RM / BW) · RPE · Rest · Tempo`. Superset groups via an `A1/A2` label column (drag one exercise onto another to group them). The exercise picker searches a catalog (≈ 400 exercises, mapped to Garmin exercise categories so the watch shows names and counts reps). It shows "last time: 3×6 @ 80 kg RPE 8" inline for progression. The graph is replaced by a **volume summary** (sets per muscle group, est. tonnage).
- **Hike/yoga/other:** a simple form: duration, distance (optional), intensity, RPE target, description.

### 4.6 Fast text syntax (spec)

Goal: anything typed in the calendar quick-add or the builder text pane parses deterministically. Unknown tokens become a warning, never silent loss.

**Grammar (EBNF-ish)**
```
workout     = [header] { line } ;
header      = sport-token [ subsport-token ] [ title ] ;          (quick-add only; e.g. "bike indoor Threshold 4x8")
line        = section | repeat-line | step | strength-line | comment ;
comment     = "//" text ;
section     = text ":" ;                                          (e.g. "Warmup:" "Main set:" — "Main set" marks isMainSet)
repeat-line = INT "x" [ text ] ;                                  (applies to following indented lines, 2 spaces / tab)
step        = "-" [ cue-text ] measure { target } { option } ;
inline-rep  = INT "x" measure target { "/" measure target } ;     (e.g. "6x 3m 110% / 3m 50%")
measure     = duration | distance | "lap" ;
duration    = ( INT "h" [ INT "m" ] ) | ( INT "m" [ INT "s" ] ) | ( INT "s" ) | ( INT "'" [ INT '"' ] ) ;
distance    = NUM ( "m" | "km" | "mi" | "y" ) ;                   ("m" after a number ≥ 25 with swim/row/run context = meters; "m" < 25 in time context = minutes; ambiguous → "min"/"mtr" accepted)
target      = power | hr | pace | rpe | zone | ramp | "open" ;
power       = NUM [ "-" NUM ] ( "%" | "w" ) ;                      (95%  88-94%  250w  240-260w)
hr          = ( NUM [ "-" NUM ] "bpm" ) | ( NUM [ "-" NUM ] "% hr" ) | ( "z" INT " hr" ) ;
pace        = PACE [ "-" PACE ] "/" ( "km" | "mi" | "100m" | "100y" | "500m" ) ;   (4:15/km  1:38-1:42/100m  1:52/500m)
pace-rel    = ( "css" | "thr" ) [ ( "+" | "-" ) INT "s" ] ;      (css+3s  thr-5s)
rpe         = "rpe" NUM [ "-" NUM ] ;
zone        = "z" INT [ "hr" | "pace" | "power" ] ;               (z2 → default target type for sport)
ramp        = "ramp" ( power | pace | hr ) ;                      (ramp 50-75%)
option      = cadence | rate | sendoff | rest | stroke | equip | drill | key ;
cadence     = NUM [ "-" NUM ] "rpm" ;      rate = NUM [ "-" NUM ] "spm" ;
sendoff     = "on" DURATION ;              rest = ( "r" | "rest" ) ( DURATION | distance ) ;
stroke      = "free"|"back"|"breast"|"fly"|"im"|"choice" ;
equip       = "+pull" | "+paddles" | "+fins" | "+kick" | "+snorkel" ;
drill       = "drill:" word ;
key         = "@key" ;  tag = "#" word ;
strength-line = exercise-name sets "x" reps [ "@" load ] [ "rpe" NUM ] [ rest ] [ "+" strength-line ] ;   ("+" = superset)
```

**Examples**
```
// Bike — threshold
Warmup:
- 15m ramp 50-75% 90rpm
- 3x 1m 110% / 1m 50%
Main set: 4x
  - 8m 95-100% 85-95rpm
  - 4m 55%
Cooldown:
- 10m 50%
```
```
// Run — track VO2
- 15m z2
6x
  - 800m 3:30/km
  - r 400m           // jog recovery, open target
- 10m z1
```
```
// Swim — CSS set (pool 25m)
- 400m free z2
- 4x 50m drill:catchup on 1:00
Main set: 8x
  - 100m free css+3s on 1:50 +pull
- 200m choice easy
```
```
// Row — erg pieces
- 10m rpe3 20spm
3x
  - 2000m 1:52/500m 24-26spm
  - r 5m
- 5m rpe2
```
```
// Strength
Back squat 4x6 @80kg rpe8 r2m
Romanian deadlift 3x8 @60kg r90s
Pull-up 3x8 @bw + Push-up 3x15 @bw r60s     // superset A1/A2
Plank 3x45s
```
**Quick-add one-liners** (calendar composer): `run 45m easy`, `bike 2h z2 #long`, `swim 2500m css @key`, `strength 40m`, `row 6x500m 1:45/500m r2m`, `yoga 30m`. A bare intensity word (`easy|endurance|tempo|threshold|vo2|hard|recovery`) sets the intensity class.

The editor shows parse errors inline (squiggle + message: "Expected a target after ‘8m’. Try 95% or z3"). It autocompletes `z`, `css`, `thr` and exercise names.

### 4.7 Library, templates, duplicate & repeat flows
- **Save to library** from any planned workout or completed activity ("Turn this ride into a template": structure is reconstructed from laps/detected intervals, with the user confirming the steps).
- Library folders default by sport with intensity sub-groups. Smart filters: "Key sessions", "≤ 45 min", "Used in last 90 d", "Never done".
- Template cards: profile thumbnail, duration, load, last done date, and **avg compliance across past uses**.
- **Schedule template:** drag from the library rail onto the calendar, or "Schedule…" on the template page (pick dates on an inline mini calendar, multi-select).
- **Duplicate:** ⌘D on a card (next day), or "Duplicate to…" on the page.
- **Repeat weekly:** on the workout page: `Repeat every [Mon,Thu] for [6] weeks, progression [+0%]/wk`. Creates a series. Edits ask inline "This only / This and following".
- **Edits to a template** don't change already-scheduled instances. A "N scheduled instances use an older version. Update them?" banner on the template page offers bulk update (with undo).

### 4.8 Garmin push rules
- Auto-push planned structured workouts dated **today … +7 days** (setting: 3/7/14). Unstructured workouts push as a simple timed/open workout only if "push unstructured" is on (default off).
- An edit re-pushes (delete + recreate on Garmin, since Garmin workouts are immutable-ish). Moving re-schedules. Deleting unschedules and deletes the Garmin workout.
- **Encoding rules:** ramps → stepped ranges (low–high) with the note "ramp" in the step name. Nested repeat depth ≤ 2 is supported, and deeper is unrolled. Warn if the unrolled step count is > 50 (older devices). Swim pace targets are encoded per Garmin's pool-swim expectations (regression test against a reference watch: target displays as /100 m). Strength uses Garmin exercise category/name codes, with sets, reps and weight.
- **Integration reality** (flag for engineering): Garmin's official Training API and Activity API require approved developer-program access, and the partner Training API historically did not support swim/strength. For a self-hosted single-user app the realistic path is Garmin Connect's own web endpoints with the user's session (community libraries exist), which support pool swim and strength workouts. This is unofficial and can break, so: an isolated adapter, a full sync log, graceful degradation, and **always-available FIT workout export** for manual side-loading.

---

## 5. Activity (completed) page — `/activities/:id`

### 5.1 Page anatomy (single scroll page, anchored sections, sticky section nav on the left on desktop)
1. **Header:** sport glyph, title (inline edit), date/time, location, device. Chips: intensity (Auto · Threshold), ★ Key toggle, compliance chip ("On plan · 97% load"). Actions: Export ▾ (FIT original, CSV streams, GPX), Pair/Unpair, Save as template, Delete (undo).
2. **How it went** (top on mobile, right column on desktop): **RPE** 1–10 segmented control, **Feel** 5-dot control, post-note textarea (autosave), tags. When empty after sync, the block is highlighted with the accent outline: "How did it feel?".
3. **Summary stat grid** (per sport, see 5.2). Each tile shows the value + delta vs the previous similar session (▲/▼ in neutral; the accent only for PB badges).
4. **Plan vs actual** (if paired): planned profile ghost-overlaid on actual (planned = dashed outline bars, actual = filled line). A step-by-step table: `Step · Target · Actual avg · Hit?` (hit = actual within target range ±3% power / ±5 s/km pace / ±2 bpm HR; shown as ●/◐/○). Overall compliance ratio and metric.
5. **Map** (outdoor): monochrome tiles (custom dark/light style), track in the accent, km markers, hover sync with charts, selection highlights the segment.
6. **Synchronized time-series charts:** stacked, shared x-axis (toggle time/distance), each 96–140px tall. Series per sport: power, HR, cadence, speed/pace, elevation, temperature, (row) stroke rate, (run) GCT/vertical osc if present. The crosshair is synced across all charts and the map. **Brush-select** a range → the **Selection panel** (docked under the charts) shows duration, distance, avg/max/normalized power, avg HR, avg pace, cadence, W/kg, Pw:HR decoupling for the range, and actions "Save as interval" / "Compare range…". Zoom with scroll+⌘ or pinch. Double-click resets. Smoothing toggle (0/5/30 s).
7. **Laps & intervals table:** tabs "Device laps" | "Detected intervals" | "Planned steps". Columns depend on sport. Rows link to a chart selection. Detected intervals = automatic effort detection (changes in power/pace sustained ≥ 30 s), editable (merge/split/rename). CSV copy.
8. **Time in zones:** horizontal bars for power, HR and pace zones (where available). The neutral ramp goes from light (Z1) to dark (Z5+). The 3-zone summary is shown as Easy/Mod/Hard %.
9. **Peaks:** for bike, a power curve (1 s–max) for this activity vs **last 90 days best** vs **all-time best** (accent = this activity). Rows for 5 s, 1, 5, 20, 60 min with season-best badges. For run, best efforts at 400 m, 1 k, 1 mi, 5 k, 10 k, HM and a pace curve. For row, 500 m, 1 k, 2 k, 5 k, 6 k.
10. **Aerobic decoupling** (steady activities ≥ 45 min with power or pace + HR): `Pw:HR 3.2%` with interpretation copy: `< 5% Good durability · 5–8% Some drift · > 8% Significant drift`. Mini chart of the first half vs the second half ratio. Efficiency factor (NP/avgHR or speed/HR).
11. **Previous similar session:** auto-selected (same template → same tags + sport + ±20% duration → same sport/subSport + intensity). Shows side-by-side key metrics and deltas ("Avg power on 4×8: 287 W vs 281 W (+2.1%) at −2 bpm HR"). Link to the compare page.
12. **Notes thread:** pre-note (from the plan), post-note, and the day note, shown in one column for context.
13. **Raw/meta:** device, firmware, file, sync times, load source + formula used (transparency).

### 5.2 Per-sport stat grids
| Sport | Tiles (in order) |
|---|---|
| Bike | Duration (moving), Distance, Load, IF, NP, Avg power, W/kg (NP), Avg HR, Elevation, Avg speed, Cadence, Work (kJ), Decoupling |
| Run | Duration, Distance, Load, Avg pace, NGP (GAP), Avg HR, Elevation, Cadence (spm), Stride length, Run power (if present), Decoupling (Pa:HR), Training effect (Garmin) |
| Swim (pool) | Distance, Moving time, Elapsed, Avg pace /100 m, Best 100 m, SWOLF avg, Strokes/length, Load (sTSS), Lengths, Avg HR (if present) |
| Swim (OW) | Distance, Time, Pace /100 m, Stroke rate, Load, map |
| Row | Distance, Time, Avg split /500 m, Avg power, Stroke rate (spm), Distance/stroke, Avg HR, Load, Watts/kg |
| Strength | Duration, Total sets, Total reps, Tonnage (kg), Est. 1RM changes, Avg HR, Load (sRPE), Exercises count |
| Hike/walk | Duration, Distance, Elevation gain, Avg HR, Load, Pace, map |
| Yoga/other | Duration, Avg HR, Load (RPE), RPE |

### 5.3 Swim-specific
- **Per-length table:** `# · Interval · Stroke · Time · Pace/100 · Strokes · SWOLF · Rest after`. Rows are grouped by interval (device laps) with interval subtotals. Drill lengths are marked. Rest rows are muted.
- **Interval summary:** `8×100 free · avg 1:41 · range 1:39–1:44 · avg SWOLF 38`. A consistency sparkline of rep times.
- **Edit lengths:** change stroke, merge/split mis-detected lengths (SHOULD).

### 5.4 Strength-specific
- **Sets table:** `Exercise · Set · Reps · Weight · RPE · Rest · e1RM (Epley)`. Planned values are shown as ghost text beside actual. Hit = reps ≥ planned at weight ≥ planned.
- **Volume:** tonnage by exercise and by muscle group (bar). Hard sets per muscle group.
- **Exercise history:** clicking an exercise → `/trends/sport/strength?exercise=back_squat` shows e1RM over time and top sets.
- Garmin strength sessions provide sets/reps (and weight if entered on watch). The page allows quick correction (Garmin rep counting is imperfect): inline editable cells.

---

## 6. Trends & progression — `/trends`

### 6.1 Overview page (default range: **last 12 weeks**, current week included as "so far")

Row 1: **Week-over-week tiles** (6 tiles). Each shows this week so far, last week's full value, and Δ%. A toggle at top: **"This week vs last" | "Last 4 vs prior 4" | "This year vs last (YTD)"**.
| Tile | Question answered |
|---|---|
| Hours | Am I training more or less than last week? |
| Load | Is stress trending up responsibly? |
| Fitness (CTL) + ramp/wk | Is fitness building, and how fast? |
| Form + zone | Am I fresh or buried right now? |
| Key sessions done / planned | Did I hit the sessions that matter? |
| Compliance % | Am I doing what I plan? |
(Same-weekday comparison option for the current week: "vs last week by Thursday".)

Row 2: **Fitness · Fatigue · Form** chart (full width, 320px). Fitness = solid line (foreground), Fatigue = thin line (neutral-500), Form = area around the zero line with zone bands as faint horizontal stripes. **Projection** from planned workouts as dotted lines (to the next A event or +6 weeks). Events = vertical lines (A in accent). Phases = background bands. Hover → a day readout with load that day.

Row 3: **Weekly volume by sport** (stacked bars: hours, toggle load/distance) + **4-week rolling average** line + the target as a dashed step line. Question: *how is my volume distributed and trending?*

Row 4 (two-up):
- **Intensity distribution per week** (100% stacked Easy/Moderate/Hard, by time in zone): *am I polarized/pyramidal, or drifting into the grey zone?* A reference band shows the target (default 80/5/15, editable).
- **Ramp rate** (weekly CTL Δ as bars) with guidance bands (≤5 normal, 5–8 aggressive, >8 risky): *am I building too fast?*

Row 5: **Consistency heatmap** (52 weeks × 7 days, cell tone = daily load quantile, an accent dot on key sessions) + **streaks**: "Weeks with ≥ 3 sessions: 14 in a row", "Days since last full rest: 9". Question: *am I consistent?*

### 6.2 Deep pages
| Page | Charts/tiles | Default range | Compare affordances |
|---|---|---|---|
| `/trends/fitness` | PMC with projection; Form % zones; ramp rate; load per day (bars); "time in each Form zone" summary | 6 months back + projection to next A event | Overlay same period last year (ghost lines) |
| `/trends/volume` | Weekly/monthly stacked by sport; per-sport table (hours, distance, sessions, load; Δ vs prior period); cumulative YTD lines per year | 12 weeks (weekly) / 24 months (monthly) | Period vs prior period; YoY cumulative |
| `/trends/intensity` | Weekly 3-zone %; per-sport time in zones (5-zone); key sessions per week; avg IF of key sessions | 12 weeks | Last 4 vs prior 4 |
| `/trends/peaks` | Power curve (bike), pace curve (run), swim pace curve, row split curve: **this season vs last season vs all-time**; PR table with dates; **threshold history** step chart (FTP, threshold pace, CSS, row 2k split) | Season = calendar year (configurable season start) | Season vs season, last 90 d vs prior 90 d |
| `/trends/wellness` | HRV (daily dots + 7-day mean + 60-day baseline band ±1 SD, Plews/Altini style), RHR with baseline band, sleep hours + score, weight with 7-day avg, feel (1–5) | 90 days | Overlay daily load as faint bars, to see load→HRV response |
| `/trends/sport/:sport` | Sport volume; efficiency trends (bike EF, run pace at fixed HR, swim SWOLF trend, row split at fixed power); decoupling trend for long sessions; strength e1RM per lift | 6 months | Season vs season |

### 6.3 Global affordances
- **Range picker** (inline segmented control): 4w · 12w · 6m · 1y · YTD · All · Custom. Persisted per page in the URL (`?range=12w&sport=run`).
- **Sport filter** chips (multi), persisted in the URL.
- **Compare toggle** on every chart: draws the prior equivalent period as a ghost series (40% opacity, dashed) and adds Δ labels.
- **Click a week bar → `/week/:isoWeek`**. Click a day in the heatmap → the day page. Every chart drills down to the calendar.
- All charts: crosshair readout, keyboard-accessible data table toggle (`⌥T`), PNG export (LATER).

---

## 7. Weekly review ritual — `/week/:isoWeek`

**Prompting:** every Sunday at 18:00 local (configurable), a push notification plus a /today banner: "Week 47 is done. Review it and plan next week (3 min)." The current week's page is always reachable from the summary column.

**Sections**
1. **Header:** `Week 47 · Nov 16–22 · Build 2 (wk 3/4)` · ‹ › week navigation · status chip (In progress / Reviewed ✓).
2. **Headline strip:** Hours `9:40 done / 11:30 planned / 12:00 target`, Load, Compliance %, Key sessions `2/3`, Form at week end (zone), Fitness Δ (+3.1), ramp. Each shows the WoW Δ.
3. **Day-by-day plan vs actual:** 7 rows. Each has planned cards (left), actual cards (right), and a compliance glyph between them. Missed and excused items are listed with their reasons.
4. **Key sessions:** each key session gets a mini card with its 2–3 headline metrics and the Δ vs the previous similar session ("4×8 @ 289 W avg, +2%, HR −2"). Missed key sessions are listed first with a "Reschedule to next week" button.
5. **By sport:** a table of planned/done hours, distance, load per sport, with the 4-week average column.
6. **Intensity split** for the week vs target (bar).
7. **Wellness summary:** avg HRV vs baseline, avg sleep, RHR trend, weight Δ, avg feel. One sentence of auto-copy: "HRV averaged 4% below baseline; sleep 6:52/night."
8. **Highlights:** auto-collected PBs, longest session, biggest load day.
9. **Reflection:** three prompted fields (markdown, autosave): *What went well? · What didn't? · Focus for next week.* Saved as a WeekNote. It appears in /journal and as `¶` in the summary column.
10. **Mark reviewed** (✓) → the status chip changes, and the review streak counter shows on /trends.

**Plan next week flow** (a section at the bottom of the same page, not a modal)
1. **Target:** next week's target hours/load, pre-filled with a suggestion:
   - Default suggestion: this week's planned load × **(1 + p)**, where `p = +5%` if this week's compliance ≥ 90% and form ≥ −30%; `0%` if compliance is 70–89%; `−10%` if < 70% or form < −30%.
   - **Recovery-week rule:** if the phase is Build/Base and this is week 3 of 3 or week 4 of 4 of the block (or 3 consecutive loading weeks), suggest **−35%** with the copy "Week 4 of block, a recovery week is suggested".
   - Guardrail: if the projected ramp is > 8 CTL/wk, show the warning "This target ramps fitness by ~9/wk, above the 8/wk caution line."
2. **Source:** "Copy this week's plan" | "Copy this week's actuals" | "Copy from template block" | "Start blank".
3. **Progression %:** slider −40…+20% (default = the suggestion). It applies to durations/distances of non-key steps proportionally, or to repeat counts for interval sets (option "progress intervals by +1 rep instead"). Key flags are carried over.
4. **Preview:** the next week renders in the calendar mini-preview with ghost cards. Edit before applying (drag, delete).
5. **Apply** → workouts are created, Garmin push is queued for those within the horizon, and a toast reads "Planned W48: 8 workouts · 12:20 h · 760 load. Undo".

---

## 8. Small delights (top-notch for one user)

1. **Command palette (⌘K)**, the one overlay. Sections: Recent, Navigate (pages, weeks: "w48", dates: "dec 24", events: "70.3"), Create ("new run", "new swim from template…"), Actions ("Sync Garmin now", "Push week to Garmin", "Shift plan from today +1d", "Toggle dark mode", "Set FTP…"), Search (activities by title/tag/note text). It shows the shortcut beside each item and opens with recents, before typing.
2. **Keyboard shortcuts:** the complete set in §3.5 plus global: `G T` today, `G C` calendar, `G R` trends, `G L` library, `G J` journal, `G S` settings, `/` search (palette), `[` `]` rails, `⌘↵` save. `?` shows the sheet.
3. **Undo toasts, not confirm dialogs:** every delete/move/bulk op gets a 10 s toast with **Undo** (`⌘Z` works too). Copy is consistent: "Deleted **Tempo 3×10**. Undo" / "Shifted 9 workouts by +1 day. Undo".
4. **Optimistic UI:** all mutations apply instantly with background sync. On failure, roll back with a toast "Couldn't save, retrying…" (3 retries, then "Saved locally, will retry").
5. **Offline-tolerant PWA (SHOULD):** IndexedDB cache of −12…+8 weeks, plus the library and 90 days of activity summaries. Writes queue offline. A sync dot in the rail shows the queue count.
6. **Exports:** a full JSON backup (all entities), FIT original zip, per-activity CSV streams, workouts as FIT / .zwo / text. A scheduled nightly backup to a local folder (self-hosted).
7. **Preferences:** units (metric/imperial, per-sport overrides like swim yards), week start (Mon/Sun/Sat), 24h/12h, timezone handling (activities keep their local time when travelling).
8. **Dark-first theming:** dark is the default. Light is equally finished (not an afterthought). Same accent. Charts are re-tokenized per theme.
9. **Mobile logging ergonomics:** after a Garmin sync of a new activity, a web push reads "Morning run synced · 10.2 km. How did it feel?" and deep-links to `/activities/:id#feel`. There, a full-width RPE control (1–10 large segments with labels: 1 "Very easy", 4 "Steady", 7 "Hard", 10 "Max") and a 5-dot Feel row are thumb-reachable at the bottom. A note field with dictation. **Two taps to done.**
10. **Morning check-in** on /today: "How do you feel?" with Very fresh / Fresh / Normal / Tired / Very tired (Xert-style), plus optional soreness. It feeds WellnessDay.feel and the readiness strip.
11. **Smart defaults:** new workout titles auto-generated from structure; the sport remembered per weekday ("Tuesdays you usually swim"); quick-add parses natural phrases.
12. **Motion system:** 120 ms micro (hover/press), 200 ms component (cards, toasts), 280 ms page/morph; ease-out-quint `cubic-bezier(0.22,1,0.36,1)`; springs for drag (stiffness 400, damping 32). All motion respects reduced-motion.
13. **Empty states with action** (copy):
    - Calendar, no workouts: "Nothing planned yet. Press **C** on any day, or type `run 45m easy`."
    - Library: "Your library is empty. Save any workout or activity as a template, or start with **8 starter sessions**." (ships with bike/run/swim/row/strength starters)
    - Trends before 6 weeks of data: "Fitness needs ~6 weeks of history to be meaningful. Backfill from Garmin to see it now." (button)
    - Journal: "Notes you write on days, workouts and weeks collect here."
14. **First-run onboarding** (`/welcome`, 4 steps, each a page):
    1. **Connect Garmin**: sign in, then a test fetch that shows the last activity as proof ("Found: Sat Ride · 2:14").
    2. **Backfill**: choose a range (default 2 years, up to 5) with a progress bar. It runs in the background so you can continue.
    3. **Set thresholds**: pre-filled from Garmin (FTP, LTHR, max HR, RHR, weight). Suggested threshold pace/CSS from the best recent efforts. Each value shows "Where this came from". Thresholds can be dated retroactively.
    4. **Preferences**: units, week start, accent color (live preview of a calendar row), first event (optional, "What are you training for?").
    Done → lands on the calendar scrolled to today, with a 3-tip coach-mark strip (dismissible inline, not modal): "Drag to move · C to create · ⌘K for everything".
15. **Sync transparency:** the /settings/sync log ("10:42 Pulled 1 activity (Morning Run). 10:42 Pushed 3 workouts (W48). 10:43 Garmin returned 429, retry in 5 min"). Every planned card shows its Garmin state.
16. **Threshold-change nudge (SHOULD):** "New 20-min best: 302 W (est. FTP 287 W, +9). Update FTP from Nov 18?" Shown on the activity page and /today, never as a modal.

---

## 9. Explicit non-goals for v1
- Multi-user: coach/athlete relationships, athlete switching, permissions, sharing links with auth, comments from others.
- Social: following, kudos, feeds, segments, leaderboards, public profiles.
- Marketplace: selling or buying plans, plan store.
- Native iOS/Android apps (PWA only). Apple Watch / Wear OS apps.
- Device integrations beyond Garmin (Wahoo, COROS, Polar, Suunto, Zwift sync). Manual FIT upload covers edge cases.
- AI auto-coaching, adaptive plan generation, chat assistant.
- Nutrition/fueling, body composition beyond weight.
- Custom chart builder and dashboard widget configuration.
- Route planning / course building.
- Video/media attachments on notes.
- Payments, billing, account systems beyond single-user auth.

---

## 10. Prioritized v1 scope (execute in this order)

1. **Data foundation:** schema for Activity, PlannedWorkout, Template, Event, Phase, DayMarker, DayNote, WeekNote, WellnessDay, Threshold (effective-dated). Single-user auth (passkey + password fallback). JSON backup/export.
2. **Garmin pull sync:** auth, incremental activity sync (10-min poll + manual), FIT archive, streams parse, 2-year backfill job, wellness daily import (HRV, RHR, sleep, weight). Sync log page.
3. **Metrics engine:** per-sport load with source precedence, Fitness/Fatigue/Form, Form %, ramp, intensity auto-classification, zones from thresholds, peaks (power/pace/swim/row), decoupling, detected intervals. Recompute on threshold change.
4. **Design system & app shell:** tokens (neutral scale, one accent, dark/light), type scale, sport glyph set, compliance glyphs, motion tokens, left rail / bottom nav, routing with View Transitions, ⌘K skeleton, toast + undo infrastructure, optimistic mutation layer.
5. **Calendar month view:** infinite virtualized week rows, sticky weekly summary column, day cell density rules, card anatomy, month headers, today, phase gutter, events, day markers, notes indicator.
6. **Calendar interactions:** drag move/copy, inline quick-add with the text grammar, keyboard cursor + shortcuts, multi-select, copy/paste days & weeks, shift plan, undo/redo.
7. **Pairing & compliance:** auto-pairing, manual pair/unpair, compliance states and monochrome encoding, excused/skip flow.
8. **Workout builder:** structure model, text parser (full grammar + errors), visual step editor + live profile graph (bidirectional), per-sport editors (bike, run, swim sets, row pieces, strength table with exercise catalog), planned load/IF/duration calc.
9. **Garmin push:** encode workouts per sport (incl. swim + strength), auto-push horizon, re-push on edit/move, unschedule on delete, per-card sync state, FIT workout export fallback.
10. **Planned workout page** (`/workouts/:id`) with inline edit, key flag, intensity, notes, Garmin state, repeat weekly, save to library.
11. **Activity page** (`/activities/:id`): stat grids per sport, map, synced charts + selection stats, laps/intervals/planned-steps tables, zones, peaks vs bests, decoupling, plan vs actual overlay, previous-similar comparison, RPE/feel/notes block. Swim lengths table. Strength sets table.
12. **Library** (`/library`, `/library/:id`): folders, search, filters, drag-to-schedule rail, starter templates.
13. **Week view and agenda view** + morph transitions between month/week/day. **Day page.**
14. **Trends overview** (`/trends`): WoW tiles with 3 compare modes, PMC with projection and zones, weekly volume by sport + rolling avg + target, intensity distribution, ramp, consistency heatmap.
15. **Weekly review** (`/week/:isoWeek`) + plan-next flow with progression and recovery-week suggestion + Sunday prompt.
16. **/today** cockpit: morning check-in, today's workouts, readiness strip (HRV/RHR/sleep vs baseline), week strip, form, event countdown.
17. **Journal** (`/journal`) + day notes editor + reflections aggregation + full-text search.
18. **Trends deep pages:** fitness, volume, peaks (with threshold history), wellness. (Intensity and per-sport pages can slip to SHOULD.)
19. **Mobile PWA polish:** bottom nav, agenda default, push notifications for post-workout RPE and the weekly review, two-tap logging.
20. **Onboarding** (`/welcome`), empty states, settings pages (profile, zones with history, sports, Garmin, appearance, data, shortcuts).

Immediately after (SHOULD, v1.1): /season planner, block templates, offline write queue, compare page, gear tracking, TP/intervals.icu import, .zwo export, threshold-change nudges, hard-day adjacency hint, peak badges.

---

## 11. "Definition of amazing" — calendar acceptance checklist

Performance
- [ ] Cold load of `/calendar` to interactive in **< 1.2 s** on a mid-range laptop (local server). The current week is visible in the first paint.
- [ ] Scrolling 2 years in either direction sustains **60 fps** (virtualized). No blank rows longer than 1 frame. Prefetch keeps 8 weeks ahead.
- [ ] Every interaction (drag drop, quick-add, toggle key) reflects in **< 100 ms** (optimistic). Server confirmation is invisible unless it fails.

Clarity at a glance
- [ ] From any week row, without hovering, I can read: done vs planned hours and load, per-sport distance, key sessions done, form at week end, WoW change.
- [ ] Compliance state of every card is distinguishable **in grayscale and for color-blind users** (verified by desaturating a screenshot): planned / on plan / short / long / way off / missed / excused / unplanned.
- [ ] Key sessions are identifiable from 2 m away (the accent rail is the only saturated element besides today and the A-race).
- [ ] Phases, A/B/C events, sick/travel ranges and day notes are visible without opening anything.
- [ ] Two workouts plus a note fit in a default-height day cell without "+more".

Interaction
- [ ] Create a structured workout from the calendar in **≤ 10 s** via quick-add text (`bike 4x8m 95-100% @key`), and see it pushed to Garmin within 1 min.
- [ ] Drag to move, ⌥-drag to copy, Shift-drag to pair. All are undoable with ⌘Z and a toast.
- [ ] Copy a full week to next week with +5% progression in **≤ 3 actions**.
- [ ] Shift the remaining plan by +1 day in **≤ 2 actions**. Completed items never move.
- [ ] Full keyboard operation: navigate days, open, create, copy/paste, mark key, set intensity, change view, jump to date, with zero mouse use.
- [ ] Month ⇄ week ⇄ day zoom uses a continuous **morph** (shared elements, no flash). Reduced-motion users get a crossfade.
- [ ] "Today" jump from 1 year away completes in ≤ 600 ms with no disorientation (lands with the current week as row 2).
- [ ] No modal dialog appears anywhere in calendar flows. No confirmation prompt ever. Undo instead.

Correctness
- [ ] Auto-pairing picks the right planned workout in ≥ 95% of same-day cases on the owner's last 6 months of data (backtest).
- [ ] Missed state flips exactly at local midnight after the planned date. Excused when a sick/injury marker covers the day.
- [ ] Weekly numbers always label Planned, Done and Target separately and never conflate them.
- [ ] Week start preference, units and timezone (travel) are respected everywhere, including the ISO week labels in the summary column.

Feel
- [ ] Dark and light themes are both pixel-polished, with one accent, consistent 4px spacing grid and type scale.
- [ ] Hover, press and drop states have tactile micro-motion (lift, settle spring). The drop target reflows smoothly.
- [ ] The mobile agenda supports thumb-only use: swipe the week strip, tap to log RPE in 2 taps, pull-to-sync.
- [ ] Empty, loading (skeleton rows matching the final layout) and error states are designed, not default.

---

## Appendix A. Copy deck (selected strings)
- Compliance chips: "On plan", "Short", "Long", "Way short", "Way over", "Missed", "Skipped · {reason}", "Unplanned".
- Form zones: "Transition", "Fresh", "Neutral", "Productive", "Overreaching". The tooltip for Productive: "Carrying fatigue that builds fitness. Fine for blocks, not forever."
- Ramp: "Fitness +6.2 this week, aggressive. Under 5/wk is sustainable for most."
- Garmin states: "On your watch", "Sending…", "Couldn't send: {reason}. Retry".
- Undo: "Moved {title} to {Day DD}. Undo" · "Deleted {title}. Undo" · "Pasted 7 workouts into W48. Undo".
- Review prompt: "Week {n} is done. Review it and plan the next one (3 min)."

## Appendix B. Research coverage & caveats
- Primary sources for TP compliance bands, ATP, metrics, strength builder limits, pricing and the Garmin acquisition came via search-result extracts of help.trainingpeaks.com, trainingpeaks.com, garmin.com newsroom, BikeRadar and Slowtwitch. intervals.icu syntax, form zones and weekly-targets behavior came from forum.intervals.icu threads and intervals.icu feature pages (community-reported values, not formal docs). Several hosts (forum.intervals.icu, help.trainingpeaks.com, forum.slowtwitch.com) could not be fetched directly from this environment, so details rely on search summaries.
- Today's Plan and JOIN yielded little verifiable 2026 detail (JOIN: plan-first; users report having to trigger re-plans manually). Neither changes the v1 spec.
- Garmin integration path (official program vs. Connect web endpoints) needs an engineering spike before step 2 of §10.

### Sources
- TrainingPeaks compliance: https://help.trainingpeaks.com/hc/en-us/articles/204861204 ; https://www.trainingpeaks.com/learn/trainingpeaks-athlete-user-guide/ ; Final Surge colors: https://support.finalsurge.com/hc/en-us/articles/360051246294-Colors-of-your-Training-Log
- TP pricing: https://help.trainingpeaks.com/hc/en-us/articles/12916774026765-TrainingPeaks-Annual-Premium-Subscription-Pricing-Update ; https://www.trainingpeaks.com/blog/trainingpeaks-pricing/
- TP UI complaints: https://forum.slowtwitch.com/t/intervals-icu-vs-trainingpeaks-premium/1281656 ; https://forum.slowtwitch.com/t/is-training-peaks-falling-apart/1300557 ; https://www.trainerroad.com/forum/t/who-has-taken-the-plunge-dropped-trainingpeaks-etc/5786?page=11 ; https://uk.trustpilot.com/review/www.trainingpeaks.com
- Garmin acquires TP: https://www.bikeradar.com/news/garmin-buys-trainingpeaks-and-trainheroic ; https://slowtwitch.com/industry/garmin-buys-trainingpeaks-and-trainheroic/
- TP Performance Insights / Athlete Home: https://help.trainingpeaks.com/hc/en-us/articles/41077784209165-Athlete-Home-Performance-Insights ; changelog https://www.trainingpeaks.com/changelog
- TP ramp/TSB guidance: https://www.trainingpeaks.com/coach-blog/a-coachs-guide-to-atl-ctl-tsb/ ; https://www.trainingpeaks.com/blog/understanding-trainingpeaks-ramp-rate-for-better-coaching/
- TP ATP: https://www.trainingpeaks.com/learn/articles/the-comprehensive-guide-to-creating-an-annual-training-plan/ ; https://www.intervals.icu/features/annual-training-plan/
- TP strength builder: https://help.trainingpeaks.com/hc/en-us/articles/21397126893581-Using-the-Strength-Workout-Builder ; https://help.trainingpeaks.com/hc/en-us/articles/23361947242381-Strength-Workout-Builder-FAQs
- TP builder ramps: https://peaksware.uservoice.com/forums/106657-trainingpeaks-customer-feedback/suggestions/50271165-fluent-ramp-up-in-cycling-workout-builder ; https://www.trainerroad.com/forum/t/workout-creator-custom-workouts/60771
- TP metrics/copy ranges: https://help.trainingpeaks.com/hc/en-us/articles/360025290131 ; https://www.trainingpeaks.com/coach-blog/time-saving-tips-for-trainingpeaks-coaches/
- intervals.icu builder syntax: https://forum.intervals.icu/t/workout-builder/1163/1 ; https://forum.intervals.icu/t/workout-builder-syntax-quick-guide/123701 ; https://forum.intervals.icu/t/intervals-icu-workout-markdown-format-rules/115629 ; swim: https://forum.intervals.icu/t/swim-workout-pace-values-in-min-km-rather-than-min-100m/44319
- intervals.icu form zones: https://forum.intervals.icu/t/zones-of-form-in-fitness-chart/3623
- intervals.icu calendar/weekly targets: https://forum.intervals.icu/t/calendar-and-week-info-update/109142 ; https://forum.intervals.icu/t/weekly-targets-for-sports/4602 ; https://www.intervals.icu/features/training-calendar/
- intervals.icu analysis/compare: https://www.intervals.icu/features/analyze/ ; https://www.intervals.icu/features/compare-activities/ ; https://www.intervals.icu/features/power-charts/
- Comparison: https://roadmancycling.com/compare/trainingpeaks-vs-intervals-icu
- Garmin Training API & swim/strength: https://developer.garmin.com/gc-developer-program/training-api ; https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-web/163824/why-are-swim-workouts-not-supported-in-the-api ; Garmin swim workouts manual https://www8.garmin.com/manuals/webhelp/garminswim2/EN-US/GUID-25FDD387-C59C-4102-8BCA-5F5291B12432.html
- Strava Training Log: https://support.strava.com/hc/en-us/articles/206535704-Training-Log
- Runalyze: https://runalyze.com/help/article/features ; https://runalyze.com/glossary/marathon-shape
- TrainerRoad calendar/Plan Builder: https://support.trainerroad.com/hc/en-us/articles/360037923191-Plan-Builder-Overview ; https://www.trainerroad.com/forum/t/announcing-the-new-and-improved-calendar/96041
- Xert freshness feedback: https://forum.xertonline.com/t/how-does-freshness-status-work-across-profiles-in-xert/48648 ; https://baronbiosys.zendesk.com/hc/en-us/sections/43620548757773-Training-Metrics
- Whoop/Oura: https://support.ouraring.com/hc/en-us/articles/360057791533 ; https://rouvy.com/blog/whoop-or-oura
- Final Surge / JOIN: https://www.runnerspicks.com/blog/trainingpeaks-vs-garmin-coach-vs-final-surge/ ; https://www.trainerroad.com/forum/t/join-cycling-app/62908/1433
- Notion Calendar shortcuts: https://www.notion.com/help/notion-calendar-keyboard-shortcuts ; https://blakecrosley.com/guides/design/notion-calendar
- Linear patterns: https://blakecrosley.com/guides/design/linear ; https://gunpowderlabs.com/2024/12/22/linear-delightful-patterns
