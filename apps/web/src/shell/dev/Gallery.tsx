/**
 * /dev/gallery — every primitive and domain atom in all states + the motion lab.
 * It doubles as the visual regression page for the design system.
 */
import { INTENSITY_CLASSES, SPORTS, type IntensityClass, type Sport } from '@cadence/core';
import { Link } from '@tanstack/react-router';
import {
  ArrowRight,
  Bell,
  CalendarDays,
  Copy,
  Ellipsis,
  Flag,
  Inbox,
  Plus,
  RefreshCw,
  Search,
  Share,
  Shuffle,
  Sparkles,
  Star,
  Trash2,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { distanceParts, formatDayShort, formatDuration, formatLoad, formatPace, formatPercent, formatRelativeDay, formatIsoWeekLabel, formatSpeed, formatElevation, formatDelta, formatDateLong, formatMonthYear, NBSP } from '@/lib/format';
import { useUnits } from '@/lib/units';
import { setMotionPref, useMotionPref } from '@/motion/prefs';
import { Crossfade } from '@/motion/PageTransition';
import { onSpotlightMove } from '@/motion/pointer';
import { Odometer, Ticker } from '@/motion/Ticker';
import { useTheme } from '@/shell/theme';
import {
  Banner,
  Button,
  ButtonLink,
  Card,
  Checkbox,
  Chip,
  Combobox,
  ComplianceBar,
  ComplianceGlyph,
  ContextMenu,
  DatePicker,
  DeltaBadge,
  Divider,
  DurationField,
  EmptyState,
  Field,
  FormZoneLabel,
  GarminStateIcon,
  IconButton,
  InlineEdit,
  Input,
  IntensityPicker,
  IntensityPips,
  KeyStar,
  Kbd,
  Menu,
  Meter,
  MiniProfile,
  NumberField,
  PaceField,
  Page,
  PageHeader,
  palette,
  Popover,
  RpeSlider,
  SaveIndicator,
  Section,
  Segmented,
  Select,
  Skeleton,
  SkeletonText,
  Slider,
  SportGlyph,
  StatTile,
  Switch,
  SyncDot,
  Tab,
  Table,
  TabList,
  TabPanel,
  Tabs,
  TagInput,
  Textarea,
  toast,
  Tooltip,
  WorkoutCard,
  complianceLabel,
  ALL_COMPLIANCE,
  type Column,
} from '@/ui';
import { MonthGrid } from '@/ui/DatePicker';
import { DndDemo } from './DndDemo';
import { ACTIVITIES_TABLE, MOCK_WORKOUTS } from './mock';

const SECTIONS = [
  ['foundations', 'Foundations'],
  ['buttons', 'Buttons'],
  ['controls', 'Controls'],
  ['fields', 'Fields'],
  ['data', 'Data'],
  ['overlays', 'Overlays'],
  ['domain', 'Domain'],
  ['cards', 'Workout cards'],
  ['motion', 'Motion lab'],
  ['format', 'Formatting'],
] as const;

function Demo({ label, children, className }: { label?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)}>
      {label && <div className="text-micro text-fg-3">{label}</div>}
      {children}
    </div>
  );
}

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-lg border border-line-1 bg-surface-1 p-5', className)}>{children}</div>;
}

// ───────────────────────── foundations ─────────────────────────
function Swatch({ name, cls, text }: { name: string; cls: string; text?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className={cn('h-12 rounded-md border border-line-2', cls)} />
      <span className="text-mono-sm text-fg-2">{name}</span>
      {text && <span className="text-body-sm text-fg-3">{text}</span>}
    </div>
  );
}

function Foundations() {
  return (
    <Section id="foundations" title="Foundations" description="True-black canvas, three surfaces, hairlines, one hue.">
      <div className="flex flex-col gap-8">
        <Demo label="Surfaces & lines">
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6 lg:grid-cols-9">
            <Swatch name="canvas" cls="bg-canvas" />
            <Swatch name="surface-1" cls="bg-surface-1" />
            <Swatch name="surface-2" cls="bg-surface-2" />
            <Swatch name="surface-3" cls="bg-surface-3" />
            <Swatch name="active" cls="bg-surface-active" />
            <Swatch name="line-1" cls="bg-line-1" />
            <Swatch name="line-2" cls="bg-line-2" />
            <Swatch name="line-3" cls="bg-line-3" />
            <Swatch name="glass" cls="glass" />
          </div>
        </Demo>
        <Demo label="Text">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ['fg-1', 'text-fg-1'],
                ['fg-2', 'text-fg-2'],
                ['fg-3', 'text-fg-3'],
                ['fg-4', 'text-fg-4'],
              ] as const
            ).map(([t, cls]) => (
              <div key={t} className="rounded-md border border-line-1 px-3 py-2.5">
                <div className={cn('text-body-lg', cls)}>Threshold 4×8′</div>
                <div className="text-mono-sm text-fg-3">{t}</div>
              </div>
            ))}
          </div>
        </Demo>
        <Demo label="Signal Green — accent ladder a1–a7 and zones z1–z7">
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-8 gap-1.5">
              {['bg-accent-a1', 'bg-accent-a2', 'bg-accent-a3', 'bg-accent-a4', 'bg-accent-a5', 'bg-accent-a6', 'bg-accent-a7', 'bg-accent'].map((c) => (
                <div key={c} className={cn('h-10 rounded-sm', c)} title={c} />
              ))}
            </div>
            <div className="grid grid-cols-8 gap-1.5">
              {['bg-z1', 'bg-z2', 'bg-z3', 'bg-z4', 'bg-z5', 'bg-z6', 'bg-z7'].map((c, i) => (
                <div key={c} className={cn('flex h-10 items-end rounded-sm p-1.5 text-mono-sm', c, i > 3 ? 'text-on-accent' : 'text-fg-1')}>
                  Z{i + 1}
                </div>
              ))}
              <div className="flex h-10 items-end rounded-sm bg-accent bg-hatch-fg p-1.5 text-mono-sm text-on-accent">hatch</div>
            </div>
            <div className="flex flex-wrap items-center gap-4 pt-2 text-body">
              <span className="text-accent-ink">accent-ink text</span>
              <span className="rounded-sm bg-accent px-2 py-0.5 text-on-accent">on-accent</span>
              <span className="h-4 w-24 rounded-xs bg-hatch-accent" />
              <span className="h-4 w-24 rounded-xs bg-hatch-fg" />
              <span className="h-4 w-24 rounded-xs bg-dots-fg" />
            </div>
          </div>
        </Demo>
        <Demo label="Type scale — Geist + Geist Mono, tabular numerals everywhere">
          <div className="flex flex-col divide-y divide-line-1 rounded-lg border border-line-1">
            {(
              [
                ['stat-xl', 'text-stat-xl', '84'],
                ['stat-lg', 'text-stat-lg', '12,480'],
                ['stat-md', 'text-stat-md', '9:40'],
                ['stat-sm', 'text-stat-sm', '612 / 720'],
                ['title-1', 'text-title-1', 'Threshold 4×8′'],
                ['title-2', 'text-title-2', 'Weekly volume'],
                ['title-3', 'text-title-3', 'Key sessions'],
                ['body-lg', 'text-body-lg', 'Ride steady to the climb, then build.'],
                ['body', 'text-body', 'Ride steady to the climb, then build.'],
                ['body-sm', 'text-body-sm', 'Ride steady to the climb, then build.'],
                ['label', 'text-label', 'Duration'],
                ['micro', 'text-micro ', 'Zone 4 · Load'],
                ['mono', 'text-mono', '1:15:30  4:05 /km  245 W'],
                ['mono-sm', 'text-mono-sm', '07:30  W47  ±0%'],
              ] as const
            ).map(([name, cls, sample]) => (
              <div key={name} className="flex items-baseline gap-6 overflow-hidden px-4 py-3">
                <span className="w-20 shrink-0 text-mono-sm text-fg-3">{name}</span>
                <span className={cn('min-w-0 truncate text-fg-1', cls)}>{sample}</span>
              </div>
            ))}
          </div>
        </Demo>
        <Demo label="Radii — xs 4 · sm 6 · md 10 · lg 14 · xl 20 · 2xl 28">
          <div className="flex flex-wrap gap-3">
            {['rounded-xs', 'rounded-sm', 'rounded-md', 'rounded-lg', 'rounded-xl', 'rounded-2xl'].map((r) => (
              <div key={r} className={cn('flex size-16 items-end border border-line-3 bg-surface-2 p-1.5 text-mono-sm text-fg-3', r)}>
                {r.replace('rounded-', '')}
              </div>
            ))}
          </div>
        </Demo>
      </div>
    </Section>
  );
}

// ───────────────────────── buttons ─────────────────────────
function Buttons() {
  const [loading, setLoading] = useState(false);
  const [pressed, setPressed] = useState(false);
  return (
    <Section id="buttons" title="Buttons" description="One primary per page. Press = 0.97 snappy; hover changes the surface only.">
      <Panel className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" icon={<Plus />} kbd="n">
            New workout
          </Button>
          <Button>Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Delete week</Button>
          <Button disabled>Disabled</Button>
          <Button
            variant="secondary"
            loading={loading}
            onClick={() => {
              setLoading(true);
              setTimeout(() => setLoading(false), 1600);
            }}
          >
            Push to Garmin
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="primary">
            Small
          </Button>
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
          <Button iconRight={<ArrowRight />} variant="ghost">
            Open week
          </Button>
          <ButtonLink to="/dev/morph" variant="outline" iconRight={<ArrowRight />}>
            ButtonLink
          </ButtonLink>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <IconButton label="Search" icon={<Search />} kbd="mod+k" />
          <IconButton label="Share" icon={<Share />} variant="secondary" />
          <IconButton label="Duplicate" icon={<Copy />} size="sm" />
          <IconButton label="Notifications" icon={<Bell />} pressed={pressed} onClick={() => setPressed((p) => !p)} />
          <IconButton label="Add" icon={<Plus />} variant="primary" />
          <IconButton label="Large" icon={<CalendarDays />} size="lg" variant="outline" />
        </div>
      </Panel>
    </Section>
  );
}

// ───────────────────────── controls ─────────────────────────
function Controls() {
  const [range, setRange] = useState<'6w' | '3m' | '6m' | '1y' | 'all'>('3m');
  const [metric, setMetric] = useState<'hours' | 'load' | 'distance'>('hours');
  const [sw, setSw] = useState(true);
  const [sw2, setSw2] = useState(false);
  const [cb, setCb] = useState(true);
  const [cb2, setCb2] = useState(false);
  const [vol, setVol] = useState(40);
  const [rpe, setRpe] = useState<number | null>(6);
  return (
    <Section id="controls" title="Controls" description="Sliding indicators use Motion layoutId; thumbs and checks spring.">
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="flex flex-col gap-6">
          <Demo label="Segmented">
            <Segmented
              aria-label="Range"
              value={range}
              onValueChange={setRange}
              options={[
                { value: '6w', label: '6W' },
                { value: '3m', label: '3M' },
                { value: '6m', label: '6M' },
                { value: '1y', label: '1Y' },
                { value: 'all', label: 'All' },
              ]}
            />
            <Segmented
              aria-label="Metric"
              size="sm"
              value={metric}
              onValueChange={setMetric}
              options={[
                { value: 'hours', label: 'Hours' },
                { value: 'load', label: 'Load' },
                { value: 'distance', label: 'Distance' },
              ]}
            />
          </Demo>
          <Demo label="Tabs">
            <Tabs defaultValue="summary">
              <TabList aria-label="Activity sections">
                <Tab value="summary">Summary</Tab>
                <Tab value="laps" count={12}>
                  Laps
                </Tab>
                <Tab value="zones">Zones</Tab>
                <Tab value="notes">Notes</Tab>
              </TabList>
              {['summary', 'laps', 'zones', 'notes'].map((t) => (
                <TabPanel key={t} value={t} className="pt-3 text-body text-fg-2">
                  {t[0]!.toUpperCase() + t.slice(1)} panel — arrow keys move between tabs.
                </TabPanel>
              ))}
            </Tabs>
          </Demo>
        </Panel>
        <Panel className="flex flex-col gap-6">
          <Demo label="Switch & checkbox">
            <Switch checked={sw} onCheckedChange={setSw} label="Auto-push to Garmin" description="Planned workouts up to 7 days ahead." />
            <Switch checked={sw2} onCheckedChange={setSw2} label="Include planned in projection" />
            <div className="flex flex-wrap gap-5">
              <Checkbox checked={cb} onCheckedChange={setCb} label="Key workout" />
              <Checkbox checked={cb2} onCheckedChange={setCb2} label="Include notes" />
              <Checkbox checked={false} onCheckedChange={() => {}} indeterminate label="Some days" />
              <Checkbox checked={false} onCheckedChange={() => {}} disabled label="Disabled" />
            </div>
          </Demo>
          <Demo label="Slider">
            <Slider label="Progression" valueLabel={`${vol - 40 >= 0 ? '+' : '−'}${Math.abs(vol - 40)}%`} value={vol} onValueChange={setVol} min={0} max={60} step={5} ticks bubble={(v) => `${v - 40 >= 0 ? '+' : '−'}${Math.abs(v - 40)}%`} />
            <RpeSlider value={rpe} onValueChange={setRpe} />
          </Demo>
        </Panel>
      </div>
    </Section>
  );
}

// ───────────────────────── fields ─────────────────────────
function Fields() {
  const [title, setTitle] = useState('Threshold 4×8′');
  const [ftp, setFtp] = useState<number | null>(287);
  const [dur, setDur] = useState<number | null>(4500);
  const [pace, setPace] = useState<number | null>(1000 / 245);
  const [sport, setSport] = useState<Sport>('bike');
  const [tpl, setTpl] = useState<{ id: string; title: string; sport: Sport } | null>(null);
  const [date, setDate] = useState<string | null>('2026-11-24');
  const [tags, setTags] = useState(['intervals', 'indoor']);
  const units = useUnits();
  return (
    <Section id="fields" title="Fields" description="Labels above, hints below, errors with an icon and a dashed border — never red.">
      <Panel>
        <div className="grid gap-x-6 gap-y-5 md:grid-cols-2 xl:grid-cols-3">
          <Field label="Title" hint="Shown on the calendar card">
            <Input value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
          </Field>
          <Field label="Search" aside="⌘K for everything">
            <Input leading={<Search />} placeholder="Search activities…" />
          </Field>
          <Field label="Email" error="That doesn't look like an address">
            <Input defaultValue="me@" aria-invalid />
          </Field>
          <NumberField label="FTP" value={ftp} onValueChange={setFtp} unit="W" min={50} max={600} />
          <DurationField label="Duration" value={dur} onValueChange={setDur} hint={dur ? `${formatDuration(dur, 'short')} · type 65m, 1h5 or 1:05:00` : undefined} />
          <PaceField label="Threshold pace" sport="run" value={pace} onValueChange={setPace} hint={pace ? formatPace(pace, 'run', units) : undefined} />
          <Select
            label="Sport"
            value={sport}
            onValueChange={setSport}
            options={SPORTS.map((s) => ({ value: s, label: s[0]!.toUpperCase() + s.slice(1), icon: <SportGlyph sport={s} /> }))}
          />
          <Combobox
            label="From template"
            items={MOCK_WORKOUTS.map((w) => ({ id: w.id, title: w.title, sport: w.sport }))}
            value={tpl}
            onValueChange={setTpl}
            itemToLabel={(t) => t.title}
            itemToKey={(t) => t.id}
            renderItem={(t) => (
              <span className="flex items-center gap-2">
                <SportGlyph sport={t.sport} />
                {t.title}
              </span>
            )}
          />
          <DatePicker label="Date" value={date} onValueChange={setDate} />
          <Field label="Pre-workout note" className="md:col-span-2">
            <Textarea placeholder="Cues, fueling, purpose… (grows as you type)" minRows={2} />
          </Field>
          <Field label="Tags">
            <TagInput value={tags} onValueChange={setTags} suggestions={['race-pace', 'hills', 'brick']} />
          </Field>
        </div>
      </Panel>
    </Section>
  );
}

// ───────────────────────── data display ─────────────────────────
function DataDisplay() {
  const [seed, setSeed] = useState(0);
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState('Sweet-spot over-unders');
  const stats = [
    { label: 'Fitness', value: 84 + seed * 3, delta: 0.06 + seed * 0.01, good: true, signal: true, spark: [0.5, 0.52, 0.55, 0.6, 0.63, 0.7, 0.74, 0.8] },
    { label: 'Fatigue', value: 97 - seed * 4, delta: -0.08 + seed * 0.03, spark: [0.7, 0.6, 0.8, 0.75, 0.9, 0.85, 0.7, 0.95] },
    { label: 'Form', value: -13 + seed * 5, delta: 0 },
    { label: 'Load · week', value: 612 + seed * 41, delta: 0.18 + seed * 0.02, warning: true },
  ];
  const cols: Column<(typeof ACTIVITIES_TABLE)[number]>[] = [
    { key: 'date', header: 'Date', cell: (r) => <span className="text-fg-2">{formatDayShort(r.date)}</span>, sortValue: (r) => r.date, width: '7rem' },
    {
      key: 'title',
      header: 'Activity',
      cell: (r) => (
        <span className="flex items-center gap-2">
          <SportGlyph sport={r.sport} />
          {r.title}
        </span>
      ),
      sortValue: (r) => r.title,
    },
    { key: 'dur', header: 'Time', numeric: true, cell: (r) => formatDuration(r.dur, 'hms'), sortValue: (r) => r.dur },
    { key: 'dist', header: 'Distance', numeric: true, cell: (r) => `${distanceParts(r.dist, r.sport).value}${NBSP}${distanceParts(r.dist, r.sport).unit}`, sortValue: (r) => r.dist, hideBelow: 'sm' },
    { key: 'hr', header: 'Avg HR', numeric: true, cell: (r) => r.hr, sortValue: (r) => r.hr, hideBelow: 'md' },
    { key: 'load', header: 'Load', numeric: true, cell: (r) => formatLoad(r.load), sortValue: (r) => r.load },
  ];
  return (
    <Section
      id="data"
      title="Data display"
      description="Numbers are the hero: tabular, tickers that roll, deltas without red or green."
      actions={
        <Button size="sm" icon={<Shuffle />} onClick={() => setSeed((s) => (s + 1) % 4)}>
          Change values
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map((s) => (
            <StatTile key={s.label} label={s.label} value={s.value} delta={s.delta} good={s.good} warning={s.warning} signal={s.signal} sparkline={s.spark} deltaSuffix="vs last wk" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <Card title="Activities" eyebrow="Table" padding="none" spotlight={false} actions={<IconButton label="More" icon={<Ellipsis />} size="sm" />}>
            <Table surface="surface-1" rows={ACTIVITIES_TABLE} columns={cols} rowKey={(r) => r.id} selectedKey="a1" onRowClick={() => {}} stickyTop="0px" defaultSort={{ key: 'date', dir: 'desc' }} totals={{ date: 'Total', dur: formatDuration(ACTIVITIES_TABLE.reduce((a, r) => a + r.dur, 0), 'hms'), load: formatLoad(ACTIVITIES_TABLE.reduce((a, r) => a + r.load, 0)) }} />
          </Card>
          <div className="flex flex-col gap-4">
            <Card title="This week" eyebrow="Meters">
              <div className="flex flex-col gap-4">
                <Meter label="Hours" valueLabel={`${formatDuration(34800 + seed * 1800)} / 11:30`} value={9.66 + seed * 0.5} max={11.5} target={12} ghost={11.5} />
                <Meter label="Load" valueLabel={`${612 + seed * 41} / 720`} value={612 + seed * 41} max={720} target={700} />
                <Meter label="Key sessions" valueLabel="2 / 3" value={2} max={3} tone="fg" />
              </div>
            </Card>
            <Card title="Deltas" eyebrow="Encoding" spotlight={false}>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                <DeltaBadge value={0.12} />
                <DeltaBadge value={-0.08} />
                <DeltaBadge value={0.004} />
                <DeltaBadge value={0.06} good />
                <DeltaBadge value={0.18} warning />
                <DeltaBadge value={6.2} kind="number" decimals={1} good suffix="/wk" />
              </div>
            </Card>
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Edit in place" eyebrow="InlineEdit + SaveIndicator">
            <div className="flex flex-col gap-3">
              <InlineEdit value={title} aria-label="Title" variant="heading" onSave={(v) => new Promise((r) => setTimeout(() => (setTitle(v), r(null)), 500))} />
              <div className="flex flex-wrap gap-3">
                <SaveIndicator status="saving" />
                <SaveIndicator status="saved" />
                <SaveIndicator status="error" />
              </div>
            </div>
          </Card>
          <Card
            title="Skeleton → content"
            eyebrow="Crossfade"
            actions={
              <Button size="sm" variant="ghost" icon={<RefreshCw />} onClick={() => (setLoading(true), setTimeout(() => setLoading(false), 1400))}>
                Reload
              </Button>
            }
          >
            <Crossfade loading={loading} skeleton={<div className="flex flex-col gap-2"><Skeleton className="h-9 w-32" /><SkeletonText lines={2} /></div>}>
              <div className="flex flex-col gap-2">
                <div className="text-stat-md">
                  <Ticker value={612 + seed * 41} />
                </div>
                <p className="text-body text-fg-2">Load this week, 85% of plan with two days left.</p>
              </div>
            </Crossfade>
          </Card>
          <div className="flex flex-col gap-3">
            <Banner title="Fitness needs ~6 weeks of history">Backfill from Garmin to see it now.</Banner>
            <Banner tone="success" title="Pushed 3 workouts to Garmin" />
            <Banner tone="error" title="Couldn't reach Garmin" action={<Button size="sm">Retry</Button>}>
              429 Too Many Requests — retrying in 5 min.
            </Banner>
          </div>
        </div>
      </div>
    </Section>
  );
}

// ───────────────────────── overlays ─────────────────────────
function Overlays() {
  const [intensity, setIntensity] = useState<IntensityClass>('threshold');
  const [date, setDate] = useState<string>('2026-11-24');
  return (
    <Section id="overlays" title="Overlays" description="Tooltips, small pickers, menus and toasts. The command palette is the only modal surface.">
      <Panel className="flex flex-wrap items-center gap-3">
        <Tooltip content="Weighted Power" kbd="g r">
          <Button variant="ghost">Hover me</Button>
        </Tooltip>
        <Popover title="Intensity" trigger={<Button iconRight={<IntensityPips intensity={intensity} />}>Intensity</Button>}>
          <div className="p-1">
            <IntensityPicker value={intensity} onValueChange={setIntensity} />
          </div>
        </Popover>
        <Popover title="Move to" trigger={<Button icon={<CalendarDays />}>{formatDayShort(date)}</Button>}>
          {(close) => (
            <div className="p-1">
              {/* MonthGrid via DatePicker's popover content */}
              <DatePickerInline value={date} onSelect={(d) => (setDate(d), close())} />
            </div>
          )}
        </Popover>
        <Menu
          trigger={<Button iconRight={<Ellipsis />}>Menu</Button>}
          items={[
            { label: 'Open', icon: <ArrowRight />, kbd: 'enter', onSelect: () => {} },
            { label: 'Duplicate', icon: <Copy />, kbd: 'mod+d', onSelect: () => toast('Duplicated to Sun 22') },
            { type: 'submenu', label: 'Set intensity', icon: <Sparkles />, items: INTENSITY_CLASSES.map((c) => ({ label: c[0]!.toUpperCase() + c.slice(1), onSelect: () => setIntensity(c), checked: c === intensity })) },
            { label: 'Mark key', icon: <Star />, kbd: 'k', onSelect: () => {} },
            { type: 'separator' },
            { label: 'Delete', icon: <Trash2 />, kbd: 'backspace', destructive: true, onSelect: () => toast.undo(<>Deleted <b>Tempo 3×10</b></>, () => toast.success('Restored')) },
          ]}
        />
        <ContextMenu
          className="flex h-9 items-center rounded-md border border-dashed border-line-3 px-3 text-body-sm text-fg-3"
          items={[
            { type: 'label', label: 'Threshold 4×8′' },
            { label: 'Open', icon: <ArrowRight />, onSelect: () => {} },
            { label: 'Push to Garmin', icon: <RefreshCw />, onSelect: () => toast.success('On your watch') },
          ]}
        >
          Right-click here
        </ContextMenu>
        <Divider orientation="vertical" className="mx-1 h-6 self-center" />
        <Button onClick={() => toast('Synced 3 activities')}>Toast</Button>
        <Button onClick={() => toast.success('Pushed to Garmin', { description: 'Threshold 4×8′ · Tue 24' })}>Success</Button>
        <Button onClick={() => toast.error("Couldn't save", { description: 'Retrying in 5 s…' })}>Error</Button>
        <Button onClick={() => toast.undo(<>Moved <b>Threshold 4×8′</b> to Thu 19</>, () => toast('Move undone'))}>Undo toast</Button>
        <Button
          onClick={() =>
            void toast.promise(new Promise((r) => setTimeout(() => r(9), 1500)), {
              loading: 'Shifting plan…',
              success: (n) => <>Shifted <b>{String(n)} workouts</b> by +1 day</>,
              error: "Couldn't shift",
            })
          }
        >
          Promise toast
        </Button>
        <Button variant="outline" icon={<Search />} kbd="mod+k" onClick={() => palette.open()}>
          Command palette
        </Button>
      </Panel>
    </Section>
  );
}

function DatePickerInline({ value, onSelect }: { value: string; onSelect: (d: string) => void }) {
  return <MonthGrid value={value} onSelect={onSelect} today="2026-11-21" />;
}

// ───────────────────────── domain ─────────────────────────
function Domain() {
  const [key, setKey] = useState(false);
  const [intensity, setIntensity] = useState<IntensityClass>('tempo');
  return (
    <Section id="domain" title="Domain atoms" description="Sport, intensity, compliance and state — all readable in grayscale first.">
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="flex flex-col gap-6">
          <Demo label="SportGlyph — 14 / 16 / 20 / 24 · indoor dot">
            <div className="grid grid-cols-5 gap-x-4 gap-y-5">
              {SPORTS.map((s) => (
                <div key={s} className="flex flex-col items-center gap-2 text-fg-1">
                  <SportGlyph sport={s} size={24} />
                  <SportGlyph sport={s} size={16} withLabel className="text-fg-2" />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-5 text-fg-1">
              <SportGlyph sport="bike" size={14} />
              <SportGlyph sport="bike" size={16} />
              <SportGlyph sport="bike" size={20} />
              <SportGlyph sport="bike" size={24} />
              <SportGlyph sport="bike" subSport="indoor" size={16} withLabel />
              <SportGlyph sport="run" subSport="treadmill" size={20} />
              <SportGlyph sport="row" subSport="erg" size={24} />
            </div>
          </Demo>
          <Demo label="IntensityPips · IntensityPicker">
            <div className="flex flex-wrap items-center gap-5">
              {INTENSITY_CLASSES.map((c) => (
                <span key={c} className="flex items-center gap-2 text-body-sm text-fg-2">
                  <IntensityPips intensity={c} size="md" />
                  {c}
                </span>
              ))}
            </div>
            <IntensityPicker value={intensity} onValueChange={setIntensity} />
          </Demo>
          <Demo label="KeyStar (burst on) · SyncDot · Garmin · Form zone">
            <div className="flex flex-wrap items-center gap-5">
              <KeyStar pressed={key} onPressedChange={setKey} />
              <span className="flex items-center gap-2 text-body-sm text-fg-2">
                <SyncDot state="idle" /> synced
              </span>
              <span className="flex items-center gap-2 text-body-sm text-fg-2">
                <SyncDot state="syncing" /> syncing
              </span>
              <span className="flex items-center gap-2 text-body-sm text-fg-2">
                <SyncDot state="error" /> error
              </span>
              <span className="flex items-center gap-2 text-body-sm text-fg-2">
                <SyncDot state="offline" /> offline
              </span>
              <span className="flex items-center gap-2">
                <GarminStateIcon state="pending" />
                <GarminStateIcon state="synced" />
                <GarminStateIcon state="error" error="Step 3 has no target" />
              </span>
            </div>
            <div className="flex flex-wrap gap-4">
              {(['overreaching', 'productive', 'neutral', 'fresh', 'transition'] as const).map((z) => (
                <FormZoneLabel key={z} zone={z} />
              ))}
            </div>
          </Demo>
        </Panel>
        <Panel className="flex flex-col gap-6">
          <Demo label="Compliance — glyph · label · bar">
            <div className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
              {ALL_COMPLIANCE.map((s) => (
                <div key={s} className="flex items-center gap-2.5 text-body text-fg-1">
                  <ComplianceGlyph state={s} />
                  <span className="w-24">{complianceLabel(s, s === 'excused' ? 'sick' : undefined)}</span>
                  <span className="text-mono-sm text-fg-3">{s}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2.5 pt-1">
              <ComplianceBar ratio={0.97} state="on_target" showLabel />
              <ComplianceBar ratio={0.72} state="partial_short" showLabel />
              <ComplianceBar ratio={1.31} state="partial_long" showLabel />
              <ComplianceBar ratio={1.62} state="off_long" showLabel />
            </div>
          </Demo>
          <Demo label="MiniProfile — zone ladder · accent · fg">
            <div className="grid grid-cols-3 gap-4">
              <MiniProfile values={MOCK_WORKOUTS[0]!.sparkline!} height={28} />
              <MiniProfile values={[0.2, 0.4, 0.35, 0.6, 0.5, 0.8, 0.7, 0.9]} height={28} tone="accent" />
              <MiniProfile values={[0.6, 0.3, 0.8, 0.4, 0.5, 0.2, 0.7]} height={28} tone="fg" />
            </div>
          </Demo>
        </Panel>
      </div>
    </Section>
  );
}

function Cards() {
  return (
    <Section id="cards" title="Workout cards" description="Three densities; compliance by fill, outline, hatch and glyph. Click one in the motion lab to morph.">
      <div className="flex flex-col gap-6">
        <Demo label="full (≥ 170px cells)">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {MOCK_WORKOUTS.map((w) => (
              <WorkoutCard key={w.id} model={w} density="full" onClick={() => {}} />
            ))}
          </div>
        </Demo>
        <div className="grid gap-6 lg:grid-cols-2">
          <Demo label="compact (120–169px)">
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {MOCK_WORKOUTS.slice(0, 9).map((w) => (
                <WorkoutCard key={w.id} model={w} density="compact" onClick={() => {}} />
              ))}
            </div>
          </Demo>
          <Demo label="chip (< 120px)">
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {MOCK_WORKOUTS.map((w) => (
                <WorkoutCard key={w.id} model={w} density="chip" onClick={() => {}} />
              ))}
            </div>
          </Demo>
        </div>
      </div>
    </Section>
  );
}

// ───────────────────────── motion lab ─────────────────────────
function MotionLab() {
  const [n, setN] = useState(8420);
  const [fit, setFit] = useState(74);
  const mp = useMotionPref();
  return (
    <Section
      id="motion"
      title="Motion lab"
      description="Signature moments end to end. Toggle reduced motion to see every one fall back to a short crossfade."
      actions={
        <Segmented
          aria-label="Motion"
          size="sm"
          value={mp}
          onValueChange={setMotionPref}
          options={[
            { value: 'system', label: 'System' },
            { value: 'full', label: 'Full' },
            { value: 'reduced', label: 'Reduced' },
          ]}
        />
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Card → page morph" eyebrow="View Transition · wk-card/glyph/title">
            <p className="mb-4 text-body text-fg-2">Open a workout and press Back: the card becomes the page header and returns.</p>
            <ButtonLink to="/dev/morph" variant="secondary" iconRight={<ArrowRight />}>
              Open morph demo
            </ButtonLink>
          </Card>
          <Card title="Tickers" eyebrow="Ticker · Odometer" actions={<IconButton label="Randomize" icon={<Shuffle />} size="sm" onClick={() => (setN(Math.round(800 + Math.random() * 14000)), setFit(Math.round(40 + Math.random() * 80)))} />}>
            <div className="flex items-end justify-between gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-micro text-fg-3">Fitness</span>
                <span className="text-stat-lg text-accent-ink">
                  <Odometer value={fit} />
                </span>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="text-micro text-fg-3">Load · year</span>
                <span className="text-stat-md">
                  <Ticker value={n} />
                </span>
              </div>
            </div>
          </Card>
          <Card title="Nav pill" eyebrow="nav-pill · nav-hover">
            <p className="mb-4 text-body text-fg-2">Move between rail items: the active pill glides with the route transition; hover previews follow your pointer.</p>
            <div className="flex gap-2">
              <ButtonLink to="/today" size="sm">
                Today
              </ButtonLink>
              <ButtonLink to="/trends" size="sm">
                Trends
              </ButtonLink>
              <ButtonLink to="/library" size="sm">
                Library
              </ButtonLink>
            </div>
          </Card>
        </div>
        <Demo label="Spotlight cards — pointer-tracked border glow (accent only for key / today)">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {['Fitness', 'Fatigue', 'Form', 'Today'].map((t, i) => (
              <div
                key={t}
                onPointerMove={onSpotlightMove}
                className={cn('spotlight flex h-28 flex-col justify-between rounded-lg border border-line-2 bg-surface-1 p-4', i === 3 && 'spotlight-accent')}
              >
                <span className="text-micro text-fg-3">{t}</span>
                <span className="text-stat-sm">{[84, 97, '−13', 'Sat 21'][i]}</span>
              </div>
            ))}
          </div>
        </Demo>
        <Demo label="Drag & drop — lift, ghost, live reflow, bouncy settle, undo toast (keyboard: focus a card, Space, arrows, Space)">
          <DndDemo />
        </Demo>
        <Demo label="Empty state">
          <div className="rounded-xl border border-dashed border-line-2">
            <EmptyState icon={<Inbox />} title="Nothing planned yet" action={<Button icon={<Plus />}>Add workout</Button>}>
              Press <Kbd>C</Kbd> on any day, or type <span className="text-mono text-fg-1">run 45m easy</span>.
            </EmptyState>
          </div>
        </Demo>
      </div>
    </Section>
  );
}

function Formatting() {
  const units = useUnits();
  const rows: [string, string][] = [
    ['formatDuration(4500)', formatDuration(4500)],
    ["formatDuration(4530, 'hms')", formatDuration(4530, 'hms')],
    ["formatDuration(4500, 'short')", formatDuration(4500, 'short')],
    ["formatDuration(2700, 'prime')", formatDuration(2700, 'prime')],
    ["formatDistance(42195, 'run')", `${distanceParts(42195, 'run', units).value} ${distanceParts(42195, 'run', units).unit}`],
    ["formatDistance(2500, 'swim')", `${distanceParts(2500, 'swim', units).value} ${distanceParts(2500, 'swim', units).unit}`],
    ["formatPace(4.08, 'run')", formatPace(4.08, 'run', units)],
    ["formatPace(0.95, 'swim')", formatPace(0.95, 'swim', units)],
    ["formatPace(4.45, 'row')", formatPace(4.45, 'row', units)],
    ['formatSpeed(9)', formatSpeed(9, units)],
    ['formatElevation(420)', formatElevation(420, units)],
    ['formatPercent(-0.08, signed)', formatPercent(-0.08, { signed: true })],
    ['formatDelta(0.004)', formatDelta(0.004).text],
    ["formatDayShort('2026-11-21')", formatDayShort('2026-11-21')],
    ["formatDateLong('2026-11-18')", formatDateLong('2026-11-18')],
    ["formatMonthYear('2026-11')", formatMonthYear('2026-11')],
    ["formatRelativeDay('2026-11-24', today)", formatRelativeDay('2026-11-24', '2026-11-21')],
    ["formatIsoWeekLabel('2026-W49')", formatIsoWeekLabel('2026-W49')],
  ];
  return (
    <Section id="format" title="Formatting" description={`lib/format.ts — U+2212 minus, narrow no-break space before units. Units: ${units.system}.`}>
      <Panel className="grid gap-x-8 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex h-9 items-center justify-between gap-4 border-b border-line-1">
            <span className="truncate text-mono-sm text-fg-3">{k}</span>
            <span className="text-mono text-fg-1">{v}</span>
          </div>
        ))}
      </Panel>
    </Section>
  );
}

export function GalleryPage() {
  const { resolved, setTheme } = useTheme();
  return (
    <Page
      width="page"
      header={
        <PageHeader
          title="Design system"
          eyebrow="Cadence · Instrument"
          breadcrumb={[{ label: 'Dev' }]}
          meta={
            <span className="flex flex-wrap gap-1.5">
              {SECTIONS.map(([id, label]) => (
                <a key={id} href={`#${id}`} className="rounded-sm border border-line-2 px-2 py-0.5 text-label text-fg-2 transition-colors hover:border-line-3 hover:text-fg-1">
                  {label}
                </a>
              ))}
            </span>
          }
          actions={
            <Segmented
              aria-label="Theme"
              size="sm"
              value={resolved}
              onValueChange={setTheme}
              options={[
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' },
              ]}
            />
          }
        />
      }
    >
      <Foundations />
      <Buttons />
      <Controls />
      <Fields />
      <DataDisplay />
      <Overlays />
      <Domain />
      <Cards />
      <MotionLab />
      <Formatting />
      <div className="flex items-center gap-2 text-body-sm text-fg-3">
        <Flag className="size-3.5" /> Charts live at
        <Link to="/dev/charts" className="text-fg-1 underline decoration-line-3 underline-offset-4">
          /dev/charts
        </Link>
      </div>
    </Page>
  );
}
