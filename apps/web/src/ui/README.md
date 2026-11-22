# Cadence UI kit — catalogue for feature agents

Everything below is live at **`/dev/gallery`** (all states, dark/light, all three accents, motion lab) and
`/dev/morph` (card → page morph). **`docs/DESIGN_V2.md` is binding**; this file is the practical summary.
Import from the barrel: `import { Button, Page, PageHeader, toast } from '@/ui'`.

## The v2 look in ten rules (read these first)

1. **No coloured edge stripes. Ever.** No accent (or any colour) left/right rails, top or bottom lines on
   cards, rows, cells, chips, tiles, banners, toasts or columns. State = a surface step, text
   colour/weight, a small glyph or a dot. Only neutral hairline dividers and the neutral tab pill remain.
2. **Accent means only**: the page's ONE primary action, today/now, the current selection (where a surface
   step is not enough), the focus ring, and inside charts the hero series + the `z1..z7` intensity ramp.
   **Never** "done", Load/Fitness or any stat number (those are `fg-1`), key-session stars (neutral), large
   fills, glows or decoration. Aim for ≤ 5 accent marks per viewport. The rail's New workout is neutral.
3. **Space groups, borders don't.** A card is a `surface-1` fill, no border, radius `lg`, padding 24 (20
   mobile) — and only when the group acts as a unit. Otherwise a `<Section>` on the canvas. Never a card in a
   card (use `<Card level={2}>`, a quiet well, for the rare nested group). Borders exist only on inputs
   (`line-2`), table row rules and dividers (`line-1`).
4. **Words look like words.** Sentence case everywhere; no `uppercase`, no tracking, no `font-mono`
   except `Kbd`, the workout text editor and code-like values (IDs, keys). Numbers use the sans with
   tabular figures (`num` utility, on by default in `body`).
5. **Closed type scale, weights 400/500/600 only** (`font-normal|medium|semibold`, never `font-[560]`):
   `title-1` 28 page h1 · `title-2` 20 · `title-3` 16 semibold section/card titles · `body-lg` 16 · `body` 14
   · `body-sm` 13 · `label` 12 medium · `stat-sm` 16 · `stat-md` 20 · `stat-lg` 28 · `stat-xl` 44 (one per
   page). Hierarchy by colour and weight first: value `fg-1`, label `fg-3`, supporting text `fg-2`.
   ≤ 3 text sizes per card. Units `fg-3`, one step smaller.
6. **Stat = label, value, ONE context line** (≤ 1 hero number + 2 supporting figures per tile). Tiles sit on
   the canvas in a row (`<StatRow>`) or share one surface (`<StatRow card>`) — not a box per tile. 3–4 tiles
   per row, never 8. A sparkline only when the trend is the point (neutral, small). Each fact once per view.
7. **Spacing recipe** (4 · 8 · 12 · 16 · 24 · 32 · 48 · 64): `<Page>` already puts 48/56/64px between its
   top-level children and gives the title block 32–40 above / 32 below; a `<Section>` title sits 16–20px
   above its content; sibling cards in a grid `gap-4`–`gap-6`; card padding comes from `<Card>`. Don't add
   wrappers with their own `gap-8`/dividers between sections.
8. **One control row per page header** (`toolbar` + `actions` in the bar). Secondary filters go in one
   "Filter" popover or a second row that appears only while a filter is active.
9. **Show less, disclose more.** ≤ ~7 blocks per 1440×900 viewport; tables ≤ 6 columns; details move to a
   hover card / tooltip / the next page. Empty space is fine.
10. **Status without colour:** done = solid neutral mark, planned = hollow/quiet, missed = struck + `fg-4`.
    Errors and warnings = `TriangleAlert` + `fg-1` text. No red/amber/green semantics.

## How to build a page (recipe)

```tsx
// src/features/trends/pages.tsx
import { getRouteApi } from '@tanstack/react-router';
import { Page, PageHeader, Section, StatRow, StatTile, Segmented, Card, EmptyState, Button } from '@/ui';
import { Crossfade } from '@/motion';

const route = getRouteApi('/_app/trends');           // typed params/search (see src/shell/README.md)

export function TrendsPage() {
  const { range = '12w' } = route.useSearch();
  const navigate = route.useNavigate();
  return (
    <Page width="page" header={
      <PageHeader title="Trends" eyebrow="Last 12 weeks"
        toolbar={<Segmented aria-label="Range" value={range} onValueChange={(r) => navigate({ search: { range: r } })}
                   options={[{ value: '6w', label: '6W' }, { value: '12w', label: '12W' }]} />}
        actions={<Button size="sm">Export</Button>} />          {/* secondary by default; ≤ 1 primary per page */}
    }>
      <Section title="This week">            {/* top-level sections stagger in, 48–64px apart */}
        <StatRow card>                       {/* one surface for the row, no box per tile */}
          <Crossfade loading={isPending} skeleton={<StatTile.Skeleton />}>
            <StatTile label="Fitness" value={84} delta={0.06} good deltaSuffix="vs last week" />
          </Crossfade>
          <StatTile label="Time" value={28080} format={(s) => formatDuration(s, 'clock')} unit="h" hint="of 9:45" />
        </StatRow>
      </Section>
      <Section title="Fitness">
        <Card>{/* one chart, direct labels, tooltip for the precise numbers */}</Card>
      </Section>
    </Page>
  );
}
```

Mechanics that matter:
- **Frame**: every route renders `<Page header={<PageHeader …/>}>`. Widths: `page` (1120 column, gutters
  16/24/48), `prose` (720, forms/notes), `full` (calendar). PageHeader `variant="compact"` = title in the 52px
  bar only (full-bleed tools). Eyebrow/breadcrumb are sentence case `fg-3`. The h1 gets focus after
  navigation — don't steal focus on mount.
- **Pages, not modals.** Create/edit = a route. The command palette is the only overlay; `Popover` only for
  pickers ≤ 320px; `Menu`/`ContextMenu` for actions.
- **No confirms.** Destructive actions run immediately, then `toast.undo('Deleted …', restore)`. ⌘Z runs the
  latest pending undo automatically.
- **Loading**: router shows `PageSkeleton` after 150ms for lazy pages. For data, render skeletons with the exact
  final size and swap with `<Crossfade>`. **Empty**: `<EmptyState icon title action>` with product copy.
- **Tokens only** (no hex/rgb, no ad-hoc durations or weights). Colors: `bg-canvas|surface-1|surface-2|
  surface-3|surface-active`, `text-fg-1..4`, `border-line-1..3`, `bg-accent` / `text-on-accent` (primary
  button, today disc), `text-accent-ink` (accent TEXT, rare), `bg-accent-a1..a7` (washes, rare), `bg-z1..z7`
  (opaque intensity ramp — data only, always with a label/height/position). Use `light:` for light-only
  tweaks. Radii `rounded-xs|sm|md|lg|xl|2xl`. Z: `z-(--z-sticky|rail|drag|popover|toast|palette)`. Sticky
  offsets: `top-(--header-h)`; bottom padding on mobile: `pb-[calc(var(--bottom-bar-h)+…)]`.
- **Accent option**: `<html data-accent="blue|green|rose">` (see `src/shell/README.md`). Never hard-code a
  hue: everything accent-coloured must come from the tokens so all three options work.
- `cn()` is a joiner (no tailwind-merge): pass non-conflicting overrides or use `!`.

## Primitives (`@/ui`)

| Component | Props (summary) | Notes |
|---|---|---|
| `Button` | `variant: primary\|secondary\|outline\|ghost\|danger`, `size: sm\|md\|lg`, `icon`, `iconRight`, `kbd`, `loading` | secondary (default) = surface-2 fill, no border; ghost = text; outline = line-2 hairline (rare); primary = accent, ONE per page; danger = secondary + TriangleAlert. `buttonStyles({variant,size})` for other elements. |
| `IconButton` | `label` (required, tooltip + aria), `icon`, `size`, `variant`, `kbd`, `pressed` | |
| `ButtonLink` | Button look + TanStack link props: `<ButtonLink {...links.newWorkout({date})} variant="primary">` | |
| `Segmented` | `value`, `onValueChange`, `options[{value,label,icon?}]`, `size`, `block`, `aria-label` | borderless track, neutral raised thumb (layoutId) |
| `Tabs/TabList/Tab/TabPanel` | `value|defaultValue`, `onValueChange`; `Tab count` | quiet surface-2 pill slides to the active tab; no underline rule |
| `NavTabs` | `items[{to,label,exact?}]`, `aria-label` | route-linked tabs (sub-pages), same pill look |
| `Field` | `label`, `hint`, `error`, `aside`, `hideLabel` + child control | wraps Base UI Field |
| `Input` | `size`, `leading`, `trailing` | `Textarea` autosizes (`minRows`, `maxRows`) |
| `NumberField` | `value: number\|null`, `onValueChange`, `unit`, `min/max/step`, `label` (drag label to scrub) | |
| `DurationField` | seconds; parses `1:05:00`, `65m`, `1h5`, `90s`; `display: hms\|clock`, `twoPart: h:mm\|m:ss` | ↑/↓ steps (Shift ×5) |
| `PaceField` | m/s; `sport` picks `/km|/mi`, `/100m|/100yd`, `/500m` | |
| `Select` | `value`, `onValueChange`, `options[{value,label,icon?,hint?}]`, `label` | |
| `Combobox` | `items`, `value`, `itemToLabel`, `itemToKey`, `renderItem`, `onInputChange`+`filter={false}` for async | |
| `DatePicker` / `MonthGrid` | LocalDate `value`, `onValueChange`, `min/max` | keyboard grid |
| `Switch`, `Checkbox` | `checked`, `onCheckedChange`, `label`, `description` | |
| `Slider`, `RpeSlider` | `value`, `onValueChange`, `ticks`, `bubble`; RPE 1–10 with copy | |
| `Chip`/`Tag`, `TagInput` | `tone: neutral\|selected\|signal\|outline`, `icon`, `onRemove`, `onClick`, `selected` | no borders; toggle chips are transparent until selected (surface-active, fg-1). `signal` (accent wash) only for today/now — not for done/load/key |
| `Card` | `title`, `eyebrow`, `actions`, `footer`, `spotlight`, `selected`, `interactive`, `padding: md(24)\|sm(16)\|none`, `level` | surface-1, no border, flat. `interactive` → hover step + neutral spotlight (default only then); `selected` → surface-3; `level={2}` → nested surface-2 well. `spotlight='accent'` renders neutral |
| `StatTile` (+`.Skeleton`) | `label`, `value`, `format`, `unit`, `delta`, `deltaKind`, `deltaSuffix`, `good`, `warning`, `hint`, `sparkline`, `size: sm\|md\|lg\|xl`, `variant: plain\|card` | plain by default (no box); value always fg-1 (`signal` ignored); ONE context line = delta + hint; sizes 20/28/44/44 |
| `StatRow` | `card`, `columns: 2\|3\|4` | a row of tiles on the canvas, or sharing one surface-1 card (`card`) |
| `Table` | `rows`, `columns[{key,header,cell,numeric,sortValue,width,hideBelow}]`, `rowKey`, `onRowClick`, `selectedKey`, `defaultSort`, `totals`, `surface`, `maxHeight`, `minWidth`, `stickyFirstColumn` | own `overflow-x:auto` box (never widens the page), header sticky inside it, numeric cells nowrap; `maxHeight` = internal vertical scroll for secondary tables; 44px rows, line-1 rules; ≤ 6 columns |
| `TableScroll` | `maxHeight`, `label`, `surface`, `bleed` | the same scroll box for hand-written `<table>`s (sticky `thead th`) |
| `Meter`/`ProgressBar` | `value`, `max`, `target` (tick), `ghost` (done+remaining), `label`, `valueLabel`, `tone: fg\|accent` | neutral fill by default (progress/done is never accent) |
| `Tooltip` | `content`, `kbd`, `side` — child must accept ref | supplementary only |
| `Popover` | `trigger`, `children \| (close) => …`, `title` | pickers ≤ 320px |
| `Menu`, `ContextMenu` | `items: MenuEntry[]` (`item`, `separator`, `label`, `submenu`) | |
| `toast` | `toast(t)`, `.success`, `.error`, `.loading`, `.undo(t, onUndo)`, `.promise(p,{loading,success,error})`, `.update`, `.dismiss` | titles accept JSX (`<b>` bolds) |
| `palette`, `usePaletteSource` | see "Command palette" below | |
| `Page`, `PageHeader`, `HeaderPortal` | PageHeader: `title`, `titleText`, `eyebrow`, `breadcrumb[{label,link}]`, `back` (`true` or link), `glyph`, `meta`, `actions`, `toolbar`, `aside`, `variant`, `morph` | `HeaderPortal` sends controls into the bar from deep children |
| `Section`, `Divider` | `title`, `description`, `actions`, `variant: title\|micro`, `id` | `title-3` heading 16–20px above content; prefer gaps over `Divider` |
| `EmptyState` | `icon`, `title`, children (≤2 lines), `action` | no box around it; icon on a small surface-2 disc |
| `Skeleton`, `SkeletonText`, `PageSkeleton` | exact sizes; sheen off under reduced motion | |
| `Kbd` | `keys="mod+k"` / `"g c"` or children | ⌘ vs Ctrl automatic |
| `InlineEdit` | `value`, `onSave` (may return a promise), `variant: title\|heading\|body`, `multiline` | autosave tick |
| `SaveIndicator`, `useAutosave(value, save)` | `status: idle\|saving\|saved\|error` | |
| `Banner` | `tone: info\|error\|success`, `title`, `action`, `onDismiss` | inline, never modal; surface fill + icon, no border/edge |

## Domain atoms (`@/ui` or `@/ui/domain`)

| Atom | Use |
|---|---|
| `SportGlyph sport subSport size(14/16/20/24/32) withLabel neutral` | THE only way to draw a sport. The glyph wears its sport colour (DESIGN_V2 §8.1; label stays ink); `neutral` for missed/skipped or filled controls. Indoor sub-sports get a corner dot. |
| `IntensityDot intensity hardOnly` | 6px dot in the zone colour of the class (recovery z1 … race z6), shown for every session with an intensity. |
| `IntensityPips intensity size tone` / `IntensityPicker value onValueChange` | 5 bars, lit ones in the class's zone colour (`tone="neutral"` for fg-3); race = flag. |
| `KeyStar pressed onPressedChange` / `readOnly` | burst on turn-on (bouncy), static 12px marker on cards. |
| `ComplianceGlyph state` · `complianceStyles(state)` · `complianceLabel(state, reason)` · `ComplianceBar ratio state` | product.md §3.6.4 shapes ○ ● ◐ ◔ ◕ ⊘ ◌ ▪, always with their status colour: on plan `good`, short/long/way off `warn`, missed `critical`, planned/skipped/unplanned neutral. |
| `MiniProfile values height tone(zone\|accent\|fg)` | step-profile / effort sparkline (≤ 48 bars). |
| `WorkoutCard model density(full\|compact\|chip) link onClick ghost selected morphId` | `densityForWidth(px)` picks density. Model: `WorkoutCardModel` (id, kind, sport, subSport, title, durationSec, distanceM, load, isKey, intensity, compliance{state,ratio}, hasNote, garminState, sparkline, startTime, skipReason). |
| `DeltaBadge value kind good bad warning suffix` | ↗ +12% / ↘ −8% / → ±0%; arrow, sign and weight; the arrow turns `good` / `warn` only when the caller passes `good` / `bad`; the number stays ink. |
| `ShareBar parts` · `Legend items` | part-of-a-whole bar (2px gaps, caller's fixed order) and a legend with coloured marks + ink text. |
| `dataColor.ts`: `sportColor`, `sportVars` (+ `bg-sport-tint*` utilities), `SPORT_STACK_ORDER`, `bySportOrder`, `intensityColor`, `zoneColor`, `complianceTone`, `STATUS_COLOR` | the only mapping from domain values to the §8 data colours. Completed cards: `bg-sport-tint` (12 % over surface-1) with `sportVars(sport)`. |
| `SyncDot state`, `GarminStateIcon state`, `FormZoneLabel zone` | status atoms. |

## Motion rules (`@/motion`)

- Timing ONLY from `spring.{snappy,smooth,gentle,bouncy}`, `tween('fast'|'base'|'slow', 'out'|'in'|'inOut')`,
  `staggerDelay(i)`; CSS: `duration-(--dur-fast)`, `ease-spring-smooth` + `duration-(--dur-spring-smooth)`.
  `smooth` is the default (MotionConfig). `bouncy` only for drop settle, key star, "completed" check.
- Route changes are View Transitions (automatic). Never call `document.startViewTransition` and never use
  React `<ViewTransition>`. In-page morphs = Motion `layout`/`layoutId`, never on an element that has a
  `view-transition-name`.
- Numbers that change: `<Ticker value format>`; hero numbers: `<Odometer value>`.
- Entrances: `Page` staggers its direct `Section`/`PageSection`/`PageItem` children; lists may use
  `listContainer`/`listItem` variants (enter only, never on re-sort/scroll).
- Pointer effects write CSS vars (`onSpotlightMove`, `.spotlight`) — never setState per frame.
  `useMagnetic` is reserved for the rail's New workout + ⌘K.
- Reduced motion: use `useReducedMotionPref()` (OS **or** in-app setting) for custom `animate()` calls.
- Animate transform/opacity/clip-path only.

## Shared-element name registry

| Name | Who carries it |
|---|---|
| `main` | `<main data-vt-main>` in the shell (automatic) |
| `nav-pill` | active rail / bottom-bar item (shell) |
| `wk-card`, `wk-glyph`, `wk-title` | the clicked `WorkoutCard` (just-in-time via `morph.set`) **and** the detail page hero (`<PageHeader morph glyph={…}>`) |
| `cal-focus`, `w-<id>` (class `cal-item`) | calendar zoom (calendar agent): focused week/day + its items, `vtName('cal-focus')`, `vtName(\`w-${id}\`, 'cal-item')` |
| `settings-nav` | the settings section nav (stays put while settings sub-pages cross-fade) |
| `settings-pill` | the active item's pill in the settings section nav (slides between sub-pages) |

Every name must be unique on screen: if a list renders the same workout twice, give the second a different
`morphId`. To morph from your own element: spread `morphSourceProps(id)` and style parts with `vt(useIsMorphTarget(id), 'card'|'glyph'|'title')`.
Programmatic open: `morph.set(id); navigate(links.workout(id))`.

## Command palette

```tsx
usePaletteSource({ id: 'calendar', commands: [
  { id: 'cal.today', group: 'Calendar', title: 'Jump to today', kbd: 't', icon: <CalendarDays/>, perform: goToday },
] }, [goToday]);
usePaletteSource({ id: 'search.workouts', group: 'Workouts', minQuery: 2,
  search: async (q, signal) => (await api.search(q, { signal })).map(toCommand) }, []);
palette.open('new run');
```
Static commands are fuzzy-filtered; `search` sources return already-filtered results (debounced 120ms,
aborted on the next keystroke). Recents are remembered. Shell already registers Navigate / Create / Actions,
a date parser ("dec 24", "next tue", "w48", "+2w") and **`shell.search` → `GET /api/search`** (planned
workouts, activities, library, events, "next race", months) — features don't need their own search source.

## Drag & drop (`@/ui/dnd`)

`useCalendarDnd({ onStart, onOver, onDrop, onCancel, describe, dayLabel })` → `{ contextProps, overlayProps,
activeId, affected }`; building blocks `DayDrop id`, `DragItem id dayId` (render prop `{dragging}` → pass
`ghost` to WorkoutCard), `Settle id layout={affected.has(day)}` (bouncy FLIP from the overlay), `DragLift`
for the `DragOverlay` content. Keyboard: Space picks up, arrows jump between droppables, Space drops; live
announcements included. See `src/shell/dev/DndDemo.tsx` for the full optimistic move + undo flow.

## Formatting (`@/lib/format`, units from `useUnits()`)

`formatDuration(sec, 'clock'|'hms'|'short'|'prime')`, `parseDuration`, `distanceParts/formatDistance(m, sport,
units)`, `paceParts/formatPace(mps, sport, units)`, `parsePace`, `formatSpeed`, `formatElevation`,
`formatWeight`, `formatPower`, `formatHr`, `formatLoad`, `formatIF`, `formatPercent(f, {signed})`,
`formatSigned`, `formatDelta`, `deltaDirection`, `formatDayShort` ("Sat 21"), `formatDayMonth`,
`formatDateMedium`, `formatDateLong`, `formatMonthYear` ("Nov 2026"), `formatRelativeDay(d, today)`,
`formatCountdown`, `formatIsoWeek` ("W47"), `formatIsoWeekRange`, `formatIsoWeekLabel`, `formatClockTime`,
`formatInstantTime`. Minus is U+2212; value and unit are joined with U+202F. `useToday()` gives the local
LocalDate and flips at midnight.
