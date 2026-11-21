# Cadence UI kit — catalogue for feature agents

Everything below is live at **`/dev/gallery`** (all states, both themes, motion lab) and
`/dev/morph` (card → page morph). Read `docs/research/design.md` §9 once; this file is the
practical summary. Import from the barrel: `import { Button, Page, PageHeader, toast } from '@/ui'`.

## How to build a page (recipe)

```tsx
// src/features/trends/pages.tsx
import { getRouteApi } from '@tanstack/react-router';
import { Page, PageHeader, Section, StatTile, Segmented, Card, EmptyState, Button, toast } from '@/ui';
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
        actions={<Button size="sm">Export</Button>} />
    }>
      <Section title="This week">            {/* top-level sections stagger in automatically */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Crossfade loading={isPending} skeleton={<StatTile.Skeleton />}>
            <StatTile label="Fitness" value={84} delta={0.06} good signal />
          </Crossfade>
        </div>
      </Section>
    </Page>
  );
}
```

Rules that matter most:
- **Frame**: every route renders `<Page header={<PageHeader …/>}>`. Widths: `page` (1200, analysis/detail),
  `prose` (720, forms/notes), `full` (calendar). PageHeader `variant="compact"` = title in the 52px bar only
  (full-bleed tools). The h1 gets focus after navigation — don't steal focus on mount.
- **Pages, not modals.** Create/edit = a route. The command palette is the only overlay; `Popover` only for
  pickers ≤ 320px; `Menu`/`ContextMenu` for actions.
- **No confirms.** Destructive actions run immediately, then `toast.undo('Deleted …', restore)`. ⌘Z runs the
  latest pending undo automatically.
- **Loading**: router shows `PageSkeleton` after 150ms for lazy pages. For data, render skeletons with the exact
  final size and swap with `<Crossfade>`. **Empty**: `<EmptyState icon title action>` with product copy.
- **Tokens only** (no hex/rgb, no ad-hoc durations). Type: `text-stat-{xl,lg,md,sm}`, `text-title-{1,2,3}`,
  `text-body-lg|body|body-sm`, `text-label`, `text-micro uppercase`, `font-mono text-mono|mono-sm` (numbers < 20px).
  Colors: `bg-canvas|surface-1|surface-2|surface-3|surface-active`, `text-fg-1..4`, `border-line-1..3`,
  `bg-accent`, `text-accent-ink` (accent TEXT), `text-on-accent`, `bg-accent-a1..a7`, `bg-z1..z7`.
  Patterns: `bg-hatch-accent`, `bg-hatch-fg`, `bg-hatch-faint`, `bg-dots-fg`; `glass`, `inset-shadow-hairline`.
  Radii `rounded-xs|sm|md|lg|xl|2xl`. Z: `z-(--z-sticky|rail|drag|popover|toast|palette)`. Sticky offsets:
  `top-(--header-h)`; bottom padding on mobile: `pb-[calc(var(--bottom-bar-h)+…)]`.
- **Green means**: done/compliant, load, today/live/selection, key workouts, the page's ONE primary button.
  Nothing else. No red/amber/blue anywhere — errors are `TriangleAlert` + fg-1 + dashed border.
- `cn()` is a joiner (no tailwind-merge): pass non-conflicting overrides or use `!`.

## Primitives (`@/ui`)

| Component | Props (summary) | Notes |
|---|---|---|
| `Button` | `variant: primary\|secondary\|outline\|ghost\|danger`, `size: sm\|md\|lg`, `icon`, `iconRight`, `kbd`, `loading` | danger is monochrome (+TriangleAlert). `buttonStyles({variant,size})` for other elements. |
| `IconButton` | `label` (required, tooltip + aria), `icon`, `size`, `variant`, `kbd`, `pressed` | |
| `ButtonLink` | Button look + TanStack link props: `<ButtonLink {...links.newWorkout({date})} variant="primary">` | |
| `Segmented` | `value`, `onValueChange`, `options[{value,label,icon?}]`, `size`, `block`, `aria-label` | layoutId thumb |
| `Tabs/TabList/Tab/TabPanel` | `value|defaultValue`, `onValueChange`; `Tab count` | sliding underline |
| `NavTabs` | `items[{to,label,exact?}]`, `aria-label` | route-linked tabs (sub-pages) |
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
| `Chip`/`Tag`, `TagInput` | `tone: neutral\|selected\|signal\|outline`, `icon`, `onRemove`, `onClick` | |
| `Card` | `title`, `eyebrow`, `actions`, `footer`, `spotlight` (`true\|'accent'\|false`), `selected`, `interactive`, `padding`, `level` | no shadows; spotlight border glow |
| `StatTile` (+`.Skeleton`) | `label`, `value`, `format`, `unit`, `delta`, `deltaKind`, `good`, `warning`, `sparkline`, `size: md\|lg\|xl`, `signal` | Ticker inside |
| `Table` | `rows`, `columns[{key,header,cell,numeric,sortValue,width,hideBelow}]`, `rowKey`, `onRowClick`, `selectedKey`, `defaultSort`, `totals`, `surface` | sticky header under the bar |
| `Meter`/`ProgressBar` | `value`, `max`, `target` (tick), `ghost` (done+remaining), `label`, `valueLabel`, `tone` | |
| `Tooltip` | `content`, `kbd`, `side` — child must accept ref | supplementary only |
| `Popover` | `trigger`, `children \| (close) => …`, `title` | pickers ≤ 320px |
| `Menu`, `ContextMenu` | `items: MenuEntry[]` (`item`, `separator`, `label`, `submenu`) | |
| `toast` | `toast(t)`, `.success`, `.error`, `.loading`, `.undo(t, onUndo)`, `.promise(p,{loading,success,error})`, `.update`, `.dismiss` | titles accept JSX (`<b>` bolds) |
| `palette`, `usePaletteSource` | see "Command palette" below | |
| `Page`, `PageHeader`, `HeaderPortal` | PageHeader: `title`, `titleText`, `eyebrow`, `breadcrumb[{label,link}]`, `back` (`true` or link), `glyph`, `meta`, `actions`, `toolbar`, `aside`, `variant`, `morph` | `HeaderPortal` sends controls into the bar from deep children |
| `Section`, `Divider` | `title`, `description`, `actions`, `variant: title\|micro`, `id` | |
| `EmptyState` | `icon`, `title`, children (≤2 lines), `action` | |
| `Skeleton`, `SkeletonText`, `PageSkeleton` | exact sizes; sheen off under reduced motion | |
| `Kbd` | `keys="mod+k"` / `"g c"` or children | ⌘ vs Ctrl automatic |
| `InlineEdit` | `value`, `onSave` (may return a promise), `variant: title\|heading\|body`, `multiline` | autosave tick |
| `SaveIndicator`, `useAutosave(value, save)` | `status: idle\|saving\|saved\|error` | |
| `Banner` | `tone: info\|error\|success`, `title`, `action`, `onDismiss` | inline, never modal |

## Domain atoms (`@/ui` or `@/ui/domain`)

| Atom | Use |
|---|---|
| `SportGlyph sport subSport size(14/16/20/24/32) withLabel` | THE only way to draw a sport. Indoor sub-sports get a corner dot. |
| `IntensityPips intensity size` / `IntensityPicker value onValueChange` | 5 bars on the zone ladder; race = flag. |
| `KeyStar pressed onPressedChange` / `readOnly` | burst on turn-on (bouncy), static 12px marker on cards. |
| `ComplianceGlyph state` · `complianceStyles(state)` · `complianceLabel(state, reason)` · `ComplianceBar ratio state` | product.md §3.6.4 encodings: ○ ● ◐ ◔ ◕ ⊘ ◌ ▪; card fill/border/rail/title classes. |
| `MiniProfile values height tone(zone\|accent\|fg)` | step-profile / effort sparkline (≤ 48 bars). |
| `WorkoutCard model density(full\|compact\|chip) link onClick ghost selected morphId` | `densityForWidth(px)` picks density. Model: `WorkoutCardModel` (id, kind, sport, subSport, title, durationSec, distanceM, load, isKey, intensity, compliance{state,ratio}, hasNote, garminState, sparkline, startTime, skipReason). |
| `DeltaBadge value kind good warning suffix` | ↗ +12% / ↘ −8% / → ±0%; accent arrow only when `good`. |
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
aborted on the next keystroke). Recents are remembered. Shell already registers Navigate / Create / Actions
and a date parser ("dec 24", "next tue", "w48", "+2w").

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
