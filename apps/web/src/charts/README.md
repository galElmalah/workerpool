# Chart kit (`@/charts`)

Hand-rolled SVG + d3 math + Motion, Canvas 2D for 1 Hz streams. Black, white and **one** accent
(Signal Green). Every chart: typed domain props, responsive (ResizeObserver), loading skeleton,
empty state, keyboard navigation, an sr-only summary + data table, reduced-motion support.

Import everything from the barrel: `import { FitnessChart, WeeklyBars, … } from '@/charts';`
Live catalogue: `/dev/charts` (or `/charts-gallery.html` standalone). Mock data: `@/charts/mock`.

## Rules you get for free (don't re-implement)

- Colours are tokens only (`T.*` = `var(--color-…)`), so charts follow `data-theme` with zero JS.
  Canvas reads the same tokens via `useCanvasTokens()` and redraws on theme change.
- Accent means load / completed / live / selection only. Series are told apart by weight, dash and
  fill (Fitness = accent area + 2px line, Fatigue = fg-1 1.5px, Form = fg-2 dashed, projection =
  dashed `2 4` @ 60% + hatched area, comparison = fg-3 1px dashed).
- Sports in stacks use the monochrome ramp `SPORT_RAMP` (bike gray-12 … strength gray-7 + hatch,
  other gray-6 + dots). Deltas: arrow + sign + weight (`DeltaBadge`), never red/green.
- Direct end-of-line labels instead of legends (collision-avoided, ≥ 14px); legends only for > 3
  series (WeeklyBars sport legend). Under 480px end labels move into a row above the plot.
- Ticks: `mono-sm`, `fg-3`, outside the plot, U+2212 minus (`fmtNum`, `fmtSigned`, `fmtPct`).
- Motion: timing comes from `src/motion/tokens.ts` (re-exported by `charts/motion.ts`). Lines draw
  in with a clip reveal, areas fade 80 ms later, bars grow with a 12 ms stagger, range/metric
  changes morph (domain springs or `d3-interpolate-path`). Reduced motion → 120 ms fades / jumps.
- Hover never calls `setState` per frame on the chart: hover lives in a `HoverSync` store (only the
  overlay re-renders) or, for streams, in a `MotionValue` (no React at all).

**Set `--chart-bg` on the card a chart sits on** (`style={{ '--chart-bg': 'var(--color-surface-1)' }}`)
so crosshair-dot rings and line halos match the surface. Defaults to `--color-canvas`.

## Catalogue

| Component | Data | Key props |
|---|---|---|
| `FitnessChart` | `FitnessDay[]` (incl. `projected` days) | `today?`, `range? / defaultRange? / onRangeChange?` (`'6w'·'12w'·'6m'·'1y'·'all'`), `events?: ChartEvent[]`, `phases?: ChartPhase[]`, `showLoad=true`, `showRamp=false`, `projectionDays=42`, `height=220`, `formHeight=96`, `formBands?`, `sync?: HoverSync<LocalDate>`, `onDayClick?(date)`, `onSelect?(FitnessSelection \| null)` |
| `WeeklyBars` | `WeekSummary[]` | `metric? / defaultMetric='hours' / onMetricChange?` (`'hours'·'load'·'distance'`), `stack='sport' \| 'total'`, `showPlanned`, `showRollingAvg`, `showWow`, `showTargets`, `cautionAbove=0.15`, `height=240`, `sync?: HoverSync<IsoWeek>`, `onWeekClick?(isoWeek)` |
| `WowDeltaBars` | `WowItem[]` (`wowItems(weeks, metric)`) | `cautionAbove=0.15`, `maxAbs=0.6`, `height=150`, `onItemClick?`, `sync?` |
| `compareWeeks(weeks, 'week' \| '4v4')` | `WeekSummary[]` | → `CompareTile[]` for the 6 WoW tiles (hours, load, fitness, form, key, compliance) |
| `IntensityDistribution` | `IntensitySplit[]` (`weeksToSplits(weeks)`) | `target={easy:.8,moderate:.05,hard:.15} \| null`, `height=160`, `onItemClick?`; header shows `classifyIntensity()` |
| `ZoneBars` | `ZoneTime[]` | `targetPct?: (number\|null)[]`, `unit?`, `formatRange?`, `compact?` |
| `PowerCurve` / `PaceCurve` / `EffortCurve` | `CurveSeries[]` = `{ id, label, points: PeakPoint[], variant: 'primary'\|'secondary'\|'comparison' }` | Power: `weightKg?` (W/kg), `model?: {cp, wPrime}`, `markers=[5,60,300,1200,3600]`. Pace: points are **speed m/s**, `per=1000\|100\|500`; `effortsToPoints(BestEffort[])` converts. `sync?: HoverSync<number>` (seconds), `focusSec=1200` |
| `StreamChart` | `ActivityStreams` (+ `Lap[]`) | `tracks?` (`power·hr·speed·cadence·altitude`), `sport` (run/swim/row → pace), `ftp?` (enables Zones shading), `xAxis/smoothing/zoneShading` (controlled or `default*`), `cursor?: MotionValue<number>`, `selection? / onSelect?({startSec,endSec} \| null)`, `trackHeight=72`, `showControls` |
| `streamStats(streams, startSec, endSec)` | `ActivityStreams` | → duration, distance, avg/max/weighted power, avg/max HR, speed, cadence, gain |
| `RouteMap` | `ActivityStreams` (`t`, `lat`, `lng`, `altitude?`, `distance?`) | `cursor?: MotionValue<number> \| number \| null`, `selection?`, `onHoverSec?`, `elevationShading`, `kmMarkers=true`, `height=340` |
| `IntensityProfile` | `ProfileBlock[]` = `{ id, startSec, durationSec, intensity (1 = 100 % threshold), intensityEnd?, level?, role, label? }` | `repeats?: {id,startSec,endSec,count}[]`, `variant='full'\|'compact'`, `height` (24 card / 48 detail / 160 builder), `selectedId? / onSelect?`, `hoveredId? / onHover?`, `maxIntensity=1.5` |
| `ConsistencyHeatmap` | `HeatDay[]` = `{ date, load, sessions?, key?, missed? }` | `today`, `weeks=52`, `onDayClick?`, `showStreaks`, `sync?`; `computeStreaks()` exported |
| `WellnessChart` | `WellnessDay[]` | `metrics=['hrv','rhr','sleep','weight']`, `loads?: {date,load}[]`, `baselineDays=60`, `rollingDays=7`, `panelHeight=84`, `sync?` |
| `Sparkline` | `(number\|null)[]` | `width=64`, `height=20`, `tone='accent'\|'fg'`, `endDot`, `showValue`, `baseline?` |
| `SparkBars` | `number[]` (e.g. `week.dailyLoad`) | `planned?: number[]` (remainder drawn as outline), `todayIndex?`, `barWidth=4`, `gap=2`, `height=20` |
| `MiniArea` | `(number\|null)[]` | `width?` (omit = fill parent), `height=32`, `tone` |
| `SportMixBar` / `SplitBar` | `{sport,value}[]` / `{easy,moderate,hard}` | 100 % bars for the week-summary column |
| `FormDial` | `value`, `zone?` | `min=-45`, `max=35`, `size=200`, `caption?` |
| `Gauge` | `value` | `min=0`, `max=100`, `label`, `unit?`, `size=160` |
| `ProgressRing` | `done`, `planned` | `size=44`, `stroke=4`, `label?` (null hides) — overshoot draws an inner fg-1 arc |
| `CompareBars` | `{label, current, previous, format?, unit?, accent?}[]` | `currentLabel`, `previousLabel` |

Common: every chart takes `loading?` and `className?`; empty input renders the empty state.

### Snippets

```tsx
// Trends overview
<FitnessChart days={fitness} today={today} events={events} phases={phases} showRamp
  range={search.range} onRangeChange={(range) => navigate({ search: { range } })} />
<WeeklyBars weeks={weeks} onWeekClick={(w) => navigate({ to: '/week/$isoWeek', params: { isoWeek: w } })} />
<IntensityDistribution items={weeksToSplits(weeks)} />
<WowDeltaBars items={wowItems(weeks, 'load')} />
<ConsistencyHeatmap days={heat} today={today} onDayClick={openDay} />

// Calendar week-summary column (static, cheap)
<SparkBars values={week.dailyLoad} planned={plannedDaily} todayIndex={isCurrent ? dow : undefined} />
<SportMixBar segments={week.bySport.map((s) => ({ sport: s.sport, value: s.doneSec }))} />
<SplitBar {...week.intensitySec} height={4} />
<DeltaBadge value={week.wowLoad} flat={0.03} caution={(week.wowLoad ?? 0) > 0.15} />

// Workout card / builder
<IntensityProfile variant="compact" blocks={blocks} height={24} />
<IntensityProfile blocks={blocks} repeats={repeats} selectedId={sel} onSelect={setSel} height={160} />
```

## Composing synced charts

**Date charts** (FitnessChart, WellnessChart, ConsistencyHeatmap): share one `HoverSync<LocalDate>`.

```tsx
const daySync = useMemo(() => createHoverSync<LocalDate>(), []);
<FitnessChart days={fitness} sync={daySync} />
<WellnessChart days={wellness} sync={daySync} />   // crosshairs move together
const hovered = useHoverValue(daySync);              // read it anywhere (re-renders only you)
```
WeeklyBars / WowDeltaBars / IntensityDistribution share `HoverSync<IsoWeek | string>` keyed by isoWeek.

**Activity page** (StreamChart ↔ RouteMap ↔ laps table): one `MotionValue<number>` cursor in seconds
(NaN = none) and one selection in state.

```tsx
const cursor = useStreamCursor();
const [sel, setSel] = useState<StreamSelection | null>(null);
<StreamChart streams={s} laps={laps} ftp={ftp} cursor={cursor} selection={sel} onSelect={setSel} />
<RouteMap streams={s} cursor={cursor} selection={sel} />
// lap row click → setSel({ startSec: lap.startSec, endSec: lap.startSec + lap.durationSec })
// selection panel → streamStats(s, sel.startSec, sel.endSec)
```
Subscribe imperatively for anything per-frame: `useEffect(() => cursor.on('change', (sec) => …), [cursor])`.

StreamChart gestures: drag = select · ⌘/Ctrl + wheel or pinch = zoom · Shift + wheel / drag the
overview window = pan · double-click = reset · keys ←/→ (Shift ×10) cursor, `+`/`−` zoom, `Z` zoom to
selection, `0` reset, `Esc` clear.

## Building a bespoke chart

Use the core: `useChartSize` (ResizeObserver), `ChartFrame` (a11y + skeleton + empty), `ChartDefs`
+ `useChartDefs()` (per-instance `hatchAccent`, `hatchFg`, `hatchFgDense`, `hatchOnAccent`, `dotsFg`,
`dashesFg`, `fadeAccent`, `fadeFg`), `AxisX/AxisY/Grid` + `linearTicks/dateTicks/thinTicks`,
`EndLabels` (+ `avoidCollisions`), `EventFlags/PhaseBands/TodayRule`, `ChartTooltip` +
`TooltipBody` + `CrosshairRule/CrosshairDot`, `useChartPointer` (pointer, touch, arrow keys, live
region), `useBrushX` + `mergeHandlers`, `MorphPath`, `Reveal`, `Ticker`, `lttbIndices` (gap-aware
LTTB on Float64Array windows), `fitCanvas` (DPR) and `useCanvasTokens`.

## Performance (measured in the gallery, Chromium, 1440px)

- StreamChart, 9 000 × 5 tracks: scripted 240-step scrub median/p95 frame 16.7/16.7 ms (60 fps),
  pointer handler 0.03 ms; zoom animation 60 fps. LTTB 5 tracks → 2 200 pts: 0.45 ms (9k) / 0.69 ms (18k).
- FitnessChart range morph recomputes ≤ 10 paths per frame from spring-animated domain values
  (~400 points each) — 60 fps on desktop.
