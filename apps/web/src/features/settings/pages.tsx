/**
 * Settings: one layout with a sub-nav (left rail on desktop, horizontal scroller on mobile) and a
 * page per section. Fields autosave (Saved tick); batches (passphrase) have a button.
 */
import './settings.css';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useLocation } from '@tanstack/react-router';
import type { Threshold } from '@cadence/core/domain';
import { Database, Gauge, Keyboard, Layers, LogOut, Monitor, Moon, Palette, RefreshCw, Search, Sun, User, Watch } from 'lucide-react';
import { LayoutGroup, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, api, call } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateMedium } from '@/lib/format';
import { qk } from '@/lib/query';
import { useLogout, useSettings } from '@/lib/queries/shared';
import { setUnits, useUnits } from '@/lib/units';
import { setMotionPref, useMotionPref, type MotionPref } from '@/motion/prefs';
import { spring } from '@/motion/tokens';
import { listShortcuts } from '@/shell/shortcuts';
import { ACCENT_OPTIONS, setTheme, useAccent, useTheme, type AccentPref, type ThemePref } from '@/shell/theme';
import { Button } from '@/ui/Button';
import { Combobox } from '@/ui/Combobox';
import { Field, Input } from '@/ui/Field';
import { Kbd } from '@/ui/Kbd';
import { NumberField } from '@/ui/NumberField';
import { Page, PageHeader } from '@/ui/PageHeader';
import { SaveIndicator } from '@/ui/SaveIndicator';
import { Section } from '@/ui/Section';
import { Segmented } from '@/ui/Segmented';
import { Skeleton } from '@/ui/Skeleton';
import { SportGlyph } from '@/ui/domain';
import { toast } from '@/ui/toast';
import { InlineError, Row, Rows, useApiToday, useSettingsSaver } from './common';
import { BigThresholdInput, PassphraseInput, SourceChip, StrengthMeter, THRESHOLD_META, passphraseStrength } from './kit';

export { SettingsGarminPage } from './garmin-page';
export { SettingsZonesPage } from './zones';
export { SettingsSyncPage } from './sync';
export { SettingsDataPage } from './data';

// ───────────────────────────── layout ─────────────────────────────

const NAV = [
  { to: '/settings/profile', label: 'Profile', icon: <User /> },
  { to: '/settings/zones', label: 'Zones & thresholds', icon: <Gauge /> },
  { to: '/settings/sports', label: 'Sports', icon: <Layers /> },
  { to: '/settings/garmin', label: 'Garmin', icon: <Watch /> },
  { to: '/settings/sync', label: 'Sync log', icon: <RefreshCw /> },
  { to: '/settings/appearance', label: 'Appearance', icon: <Palette /> },
  { to: '/settings/data', label: 'Data', icon: <Database /> },
  { to: '/settings/shortcuts', label: 'Shortcuts', icon: <Keyboard /> },
] as const;

function SettingsNav() {
  const { pathname } = useLocation();
  const activeRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [pathname]);
  return (
    <nav
      aria-label="Settings sections"
      style={{ viewTransitionName: 'settings-nav' }}
      className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:-mx-6 md:px-6 lg:sticky lg:top-[calc(var(--header-h)+1rem)] lg:mx-0 lg:flex-col lg:self-start lg:overflow-visible lg:px-0"
    >
      {NAV.map((n) => {
        const on = pathname.startsWith(n.to);
        return (
          <Link
            key={n.to}
            to={n.to}
            ref={on ? activeRef : undefined}
            aria-current={on ? 'page' : undefined}
            className={cn(
              'relative flex h-9 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-md px-3 text-body transition-colors duration-(--dur-fast) [&_svg]:size-4',
              on ? 'text-fg-1' : 'text-fg-3 hover:bg-surface-1 hover:text-fg-1',
            )}
          >
            {on && <span aria-hidden style={{ viewTransitionName: 'settings-pill' }} className="absolute inset-0 rounded-md bg-surface-2" />}
            <span className={cn('relative flex', on ? 'text-fg-1' : 'text-fg-3')}>{n.icon}</span>
            <span className="relative">{n.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function SettingsLayout() {
  return (
    <Page width="page" header={<PageHeader title="Settings" />}>
      <div className="grid gap-8 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-16">
        <SettingsNav />
        <div className="flex min-w-0 max-w-[45rem] flex-col gap-14 md:gap-16">
          <Outlet />
        </div>
      </div>
    </Page>
  );
}

// ───────────────────────────── profile ─────────────────────────────

const detectedTz = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
})();
const ZONES: string[] = (() => {
  try {
    const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
    return all.includes('UTC') ? all : ['UTC', ...all];
  } catch {
    return ['UTC'];
  }
})();

export function SettingsProfilePage() {
  const { data: s, isPending, isError, refetch } = useSettings();
  const saver = useSettingsSaver();
  if (isPending)
    return (
      <Section title="Profile">
        <Skeleton className="h-80 w-full" radius="lg" />
      </Section>
    );
  if (isError || !s)
    return (
      <Section title="Profile">
        <InlineError action={<Button size="sm" variant="ghost" onClick={() => void refetch()}>Retry</Button>}>Couldn't load your settings.</InlineError>
      </Section>
    );
  return (
    <>
      <Section title="Profile" description="Who you are, as far as the numbers care." actions={<SaveIndicator status={saver.status} />}>
        <div>
          <Rows>
            <NameRow initial={s.name} save={(name) => saver.save({ name })} />
            <Row title="Sex" description="Picks default heart-rate assumptions when no thresholds are set.">
              <Segmented
                aria-label="Sex"
                value={s.sex}
                onValueChange={(sex) => void saver.save({ sex })}
                options={[
                  { value: 'female', label: 'Female' },
                  { value: 'male', label: 'Male' },
                  { value: 'unspecified', label: 'Not set' },
                ]}
              />
            </Row>
            <Row title="Birth year" description="Estimates max heart rate until you set one.">
              <NumberField
                className="w-36"
                hideLabel
                label="Birth year"
                value={s.birthYear ?? null}
                min={1920}
                max={2020}
                format={{ useGrouping: false }}
                onValueChange={(v) => v != null && v >= 1920 && v <= 2020 && void saver.save({ birthYear: Math.round(v) })}
              />
            </Row>
            <WeightRow />
          </Rows>
        </div>
      </Section>

      <Section title="Preferences">
        <div>
          <Rows>
            <Row title="Units" description="Distances, paces, elevation and weight.">
              <Segmented
                aria-label="Units"
                value={s.units}
                onValueChange={(units) => {
                  setUnits({ system: units });
                  void saver.save({ units });
                }}
                options={[
                  { value: 'metric', label: 'Metric' },
                  { value: 'imperial', label: 'Imperial' },
                ]}
              />
            </Row>
            <Row title="Week starts on">
              <Segmented
                aria-label="Week start"
                value={s.weekStart}
                onValueChange={(weekStart) => void saver.save({ weekStart })}
                options={[
                  { value: 'monday', label: 'Monday' },
                  { value: 'sunday', label: 'Sunday' },
                ]}
              />
            </Row>
            <Row title="Timezone" description={s.timezone !== detectedTz ? `This device is on ${detectedTz.replaceAll('_', ' ')}.` : 'Decides when your day rolls over.'}>
              <Combobox
                className="w-64"
                hideLabel
                label="Timezone"
                items={ZONES}
                value={s.timezone}
                onValueChange={(tz) => tz && void saver.save({ timezone: tz })}
                itemToLabel={(z) => z.replaceAll('_', ' ')}
                itemToKey={(z) => z}
              />
            </Row>
            <Row title="Home page" description="Where Cadence opens on a wide screen.">
              <Segmented
                aria-label="Home page"
                value={s.homeRoute}
                onValueChange={(homeRoute) => void saver.save({ homeRoute })}
                options={[
                  { value: 'calendar', label: 'Calendar' },
                  { value: 'today', label: 'Today' },
                ]}
              />
            </Row>
          </Rows>
        </div>
      </Section>

      <Section title="Security">
        <SecurityCard />
      </Section>
    </>
  );
}

function NameRow({ initial, save }: { initial: string; save: (v: string) => Promise<void> }) {
  const [name, setName] = useState(initial);
  const saved = useRef(initial);
  useEffect(() => {
    if (name.trim() === saved.current.trim()) return;
    const t = setTimeout(() => {
      saved.current = name;
      void save(name.trim());
    }, 700);
    return () => clearTimeout(t);
  }, [name, save]);
  return (
    <Row title="Name" description="Shown in greetings.">
      <Input className="w-64" value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="Your first name" aria-label="Name" />
    </Row>
  );
}

function WeightRow() {
  const units = useUnits();
  const today = useApiToday();
  const qc = useQueryClient();
  const history = useQuery({ queryKey: qk.thresholds.history, queryFn: () => call(api.thresholds.$get()) });
  const cur = (history.data ?? []).filter((t) => t.kind === 'weight').sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  const add = useMutation({
    mutationFn: (value: number) => call(api.thresholds.$post({ json: { kind: 'weight', sport: 'all', value, effectiveFrom: today!, source: 'manual' } })),
    onSuccess: (t) => {
      qc.setQueryData<Threshold[]>(qk.thresholds.history, (prev) => [...(prev ?? []), t]);
      void qc.invalidateQueries({ queryKey: qk.thresholds.all });
      toast.success(`Weight saved from ${formatDateMedium(t.effectiveFrom)}`);
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Row title="Weight" description={cur ? `Since ${formatDateMedium(cur.effectiveFrom, true)}. A new value is dated today; history keeps the old one.` : 'For W/kg. Dated, so your history keeps its context.'}>
      <div className="flex items-center gap-3">
        {cur && <SourceChip source={cur.source} />}
        <BigThresholdInput meta={THRESHOLD_META.weight} units={units} value={cur?.value ?? null} onCommit={(v) => v != null && today && (!cur || Math.abs(cur.value - v) > 0.01) && add.mutate(v)} />
      </div>
    </Row>
  );
}

function SecurityCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const logout = useLogout();
  const change = useMutation({
    mutationFn: () => call(api.auth.change.$post({ json: { current, next } })),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      setError(null);
      toast.success('Passphrase changed. Other devices are signed out.');
    },
    onError: (e) => setError(e instanceof ApiError && e.status === 401 ? 'Your current passphrase is not right.' : e.message),
  });
  const ok = current.length > 0 && passphraseStrength(next).score >= 2;
  return (
    <div>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) change.mutate();
        }}
      >
        <div className="flex flex-col gap-0.5">
          <span className="text-body text-fg-1">Change passphrase</span>
          <span className="text-body-sm text-fg-3">Signs out every other device.</span>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pp-cur" className="text-label text-fg-2">
              Current
            </label>
            <PassphraseInput id="pp-cur" value={current} onChange={setCurrent} autoComplete="current-password" placeholder="" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pp-new" className="text-label text-fg-2">
              New
            </label>
            <PassphraseInput id="pp-new" value={next} onChange={setNext} autoComplete="new-password" placeholder="" />
            {next && <StrengthMeter value={next} />}
          </div>
        </div>
        {error && <InlineError>{error}</InlineError>}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <Button variant="ghost" icon={<LogOut />} loading={logout.isPending} onClick={() => logout.mutate()}>
            Sign out
          </Button>
          <Button type="submit" variant="secondary" disabled={!ok} loading={change.isPending}>
            Change passphrase
          </Button>
        </div>
      </form>
    </div>
  );
}

// ───────────────────────────── sports ─────────────────────────────

const LOAD_SOURCES: { sport: 'bike' | 'run' | 'swim' | 'row' | 'strength'; label: string; order: string[] }[] = [
  { sport: 'bike', label: 'Ride', order: ['Power vs FTP', 'Heart rate', 'RPE'] },
  { sport: 'run', label: 'Run', order: ['Pace vs threshold', 'Heart rate', 'RPE'] },
  { sport: 'swim', label: 'Swim', order: ['Pace vs CSS', 'Heart rate', 'RPE'] },
  { sport: 'row', label: 'Row', order: ['Erg power', 'Heart rate', 'RPE'] },
  { sport: 'strength', label: 'Strength & other', order: ['RPE × duration', 'Heart rate', 'Intensity default'] },
];

export function SettingsSportsPage() {
  const { data: s } = useSettings();
  const saver = useSettingsSaver();
  return (
    <>
      <Section title="Sports" description="How each sport is scored. Thresholds live under Zones.">
        <div>
          <ul className="divide-y divide-line-1">
            {LOAD_SOURCES.map((l) => (
              <li key={l.sport} className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-3">
                <span className="flex w-44 items-center gap-2.5 text-body text-fg-1">
                  <SportGlyph sport={l.sport} size={16} className="text-fg-3" />
                  {l.label}
                </span>
                <ol className="flex flex-1 flex-wrap items-center gap-1.5">
                  {l.order.map((o, i) => (
                    <li key={o} className="flex items-center gap-1.5">
                      {i > 0 && <span className="text-fg-4">→</span>}
                      <span className={cn('text-body-sm', i === 0 ? 'text-fg-1' : 'text-fg-3')}>{o}</span>
                    </li>
                  ))}
                </ol>
                {l.sport !== 'strength' && (
                  <Link to="/settings/zones" className="text-label text-fg-2 underline decoration-line-3 underline-offset-3 hover:text-fg-1">
                    Thresholds
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-5 text-body-sm text-fg-3">Load uses the first source an activity has data for. One hour at threshold = 100.</p>
      </Section>

      <Section title="Compliance" description="How a completed session is compared with its plan.">
        <div>
          <div className="grid gap-6 sm:grid-cols-3">
            {[
              ['1', 'Load', 'when the plan has a load and the activity has one'],
              ['2', 'Duration', 'otherwise'],
              ['3', 'Distance', 'when only distance was planned'],
            ].map(([n, t, d]) => (
              <div key={n} className="flex gap-3">
                <span className="num w-4 shrink-0 text-body text-fg-3">{n}</span>
                <div className="flex flex-col">
                  <span className="text-body text-fg-1">{t}</span>
                  <span className="text-body-sm text-fg-3">{d}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-6 text-body-sm text-fg-3">80–120 % of plan is compliant, 50–79 % or 121–150 % partial, beyond that off-plan.</p>
        </div>
      </Section>

      <Section title="Garmin" actions={<SaveIndicator status={saver.status} />}>
        <div>
          <Rows>
            <Row title="Auto-send window" description="Planned workouts this many days ahead are sent to your Garmin calendar on every sync.">
              <Segmented
                aria-label="Auto-send window"
                value={String(s?.garminAutoPushDays ?? 7)}
                onValueChange={(v) => void saver.save({ garminAutoPushDays: Number(v) })}
                options={[
                  { value: '0', label: 'Off' },
                  { value: '3', label: '3 d' },
                  { value: '7', label: '7 d' },
                  { value: '14', label: '14 d' },
                ]}
              />
            </Row>
          </Rows>
        </div>
      </Section>
    </>
  );
}

// ───────────────────────────── appearance ─────────────────────────────

function ThemeTile({ kind, on, onSelect }: { kind: ThemePref; on: boolean; onSelect: () => void }) {
  const { resolved } = useTheme();
  // Draw the "other" theme by inverting tokens: fg-1 becomes the canvas, canvas the ink.
  const inverted = (k: 'dark' | 'light') => k !== resolved;
  const Mock = ({ k, className }: { k: 'dark' | 'light'; className?: string }) => {
    const inv = inverted(k);
    return (
      <div className={cn('flex h-full gap-1.5 p-2', inv ? 'bg-fg-1' : 'bg-canvas', className)}>
        <div className={cn('flex w-5 flex-col gap-1 rounded-xs p-1', inv ? 'bg-fg-2' : 'bg-surface-2')}>
          {[0, 1, 2].map((i) => (
            <span key={i} className={cn('h-1 rounded-full', inv ? 'bg-canvas/40' : 'bg-fg-4')} />
          ))}
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <span className={cn('h-1.5 w-1/2 rounded-full', inv ? 'bg-canvas' : 'bg-fg-1')} />
          <div className="grid flex-1 grid-cols-4 gap-1">
            {Array.from({ length: 8 }, (_, i) => (
              <span key={i} className={cn('rounded-xs', i === 5 ? 'bg-accent' : inv ? 'bg-canvas/15' : 'bg-surface-3')} />
            ))}
          </div>
        </div>
      </div>
    );
  };
  const label = kind === 'dark' ? 'Dark' : kind === 'light' ? 'Light' : 'System';
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onSelect} className="group flex flex-col gap-2.5 rounded-lg text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus">
      <span className="relative block h-20 rounded-lg">
        <span className="absolute inset-0 overflow-hidden rounded-lg bg-surface-2 transition-transform duration-(--dur-fast) group-hover:scale-[1.015]">
          {kind === 'system' ? (
            <span className="flex h-full">
              <Mock k="dark" className="w-1/2 overflow-hidden" />
              <Mock k="light" className="w-1/2 overflow-hidden" />
            </span>
          ) : (
            <Mock k={kind} />
          )}
        </span>
        {on && <motion.span layoutId="theme-ring" transition={spring.smooth} className="absolute -inset-1 rounded-[calc(var(--radius-lg)+4px)] ring-2 ring-accent" aria-hidden />}
      </span>
      <span className={cn('flex items-center gap-1.5 text-body-sm [&_svg]:size-3.5', on ? 'text-fg-1' : 'text-fg-3')}>
        {kind === 'dark' ? <Moon /> : kind === 'light' ? <Sun /> : <Monitor />}
        {label}
      </span>
    </button>
  );
}

/** The three accent options as they look in each theme (mirrors the --accent values in app.css:
 *  a picker has to preview the options it is not using, so these cannot come from the live token). */
const SWATCH: Record<'dark' | 'light', Record<AccentPref, string>> = {
  dark: { blue: 'oklch(0.72 0.12 252)', green: 'oklch(0.76 0.11 160)', rose: 'oklch(0.76 0.10 8)' },
  light: { blue: 'oklch(0.53 0.14 252)', green: 'oklch(0.50 0.10 160)', rose: 'oklch(0.54 0.14 8)' },
};

function AccentPicker({ onPick }: { onPick: (a: AccentPref) => void }) {
  const { accent } = useAccent();
  const { resolved } = useTheme();
  return (
    <LayoutGroup id="accent">
      <div role="radiogroup" aria-label="Accent" className="flex gap-6">
        {ACCENT_OPTIONS.map((o) => {
          const on = accent === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onPick(o.value)}
              className="group flex flex-col items-center gap-2.5 rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
            >
              <span className="relative flex size-10 items-center justify-center">
                {on && <motion.span layoutId="accent-ring" transition={spring.bouncy} className="absolute -inset-1 rounded-full ring-2 ring-fg-2" aria-hidden />}
                <motion.span
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.92 }}
                  transition={spring.snappy}
                  className="flex size-10 items-center justify-center rounded-full"
                  style={{ background: SWATCH[resolved][o.value] }}
                >
                  {on && (
                    <svg viewBox="0 0 12 12" className="size-4 text-on-accent" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <motion.path d="M2.5 6.2 5 8.5l4.5-5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ ...spring.snappy, delay: 0.05 }} />
                    </svg>
                  )}
                </motion.span>
              </span>
              <span className={cn('text-body-sm transition-colors duration-(--dur-fast)', on ? 'text-fg-1' : 'text-fg-3 group-hover:text-fg-2')}>{o.label}</span>
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}

export function SettingsAppearancePage() {
  const { pref } = useTheme();
  const motionPref = useMotionPref();
  const { data: s } = useSettings();
  const saver = useSettingsSaver();
  const { setAccent } = useAccent();
  const density = s?.density ?? 'comfortable';
  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);
  return (
    <>
      <Section title="Appearance" description="Quiet neutrals and one accent colour. Changes apply instantly." actions={<SaveIndicator status={saver.status} />}>
        <div className="flex flex-col gap-10">
          <div className="flex flex-col gap-4">
            <span className="text-body text-fg-1">Theme</span>
            <LayoutGroup id="theme">
              <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-4 sm:gap-6">
                {(['dark', 'light', 'system'] as const).map((k) => (
                  <ThemeTile
                    key={k}
                    kind={k}
                    on={pref === k}
                    onSelect={() => {
                      setTheme(k);
                      void saver.save({ theme: k });
                    }}
                  />
                ))}
              </div>
            </LayoutGroup>
          </div>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-body text-fg-1">Accent</span>
              <span className="text-body-sm text-fg-3">Marks today, the current selection and each page’s main action.</span>
            </div>
            <AccentPicker
              onPick={(a) => {
                setAccent(a);
                void saver.save({ accent: a });
              }}
            />
          </div>
        </div>
      </Section>
      <Section title="Layout and motion">
        <Rows>
          <Row title="Density" description="Compact fits more weeks and rows on screen.">
            <Segmented
              aria-label="Density"
              value={density}
              onValueChange={(d) => void saver.save({ density: d })}
              options={[
                { value: 'comfortable', label: 'Comfortable' },
                { value: 'compact', label: 'Compact' },
              ]}
            />
          </Row>
          <Row title="Motion" description="Reduced replaces morphs and slides with short crossfades. System follows your device.">
            <Segmented<MotionPref>
              aria-label="Motion"
              value={motionPref}
              onValueChange={(m) => {
                setMotionPref(m);
                void saver.save({ reducedMotion: m === 'reduced' });
              }}
              options={[
                { value: 'full', label: 'Full' },
                { value: 'reduced', label: 'Reduced' },
                { value: 'system', label: 'System' },
              ]}
            />
          </Row>
        </Rows>
      </Section>
    </>
  );
}

// ───────────────────────────── shortcuts ─────────────────────────────

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-xs bg-surface-active text-fg-1">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

function Keys({ keys }: { keys: string }): ReactNode {
  // "g c" is a sequence; "1 2 3 4 5" / "left right up down" are alternatives
  if (keys.includes(' ') && !keys.startsWith('g '))
    return (
      <span className="flex gap-1">
        {keys.split(' ').map((k) => (
          <Kbd key={k} keys={k} />
        ))}
      </span>
    );
  return <Kbd keys={keys} />;
}

export function SettingsShortcutsPage() {
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return listShortcuts()
      .map((g) => ({ ...g, items: g.items.filter((it) => !needle || it.label.toLowerCase().includes(needle) || it.keys.toLowerCase().includes(needle) || g.group.toLowerCase().includes(needle)) }))
      .filter((g) => g.items.length);
  }, [q]);
  return (
    <Section title="Keyboard shortcuts" description="Press ? anywhere to come back here. ⌘K opens everything else.">
      <div className="flex flex-col gap-5">
        <Field label="Filter shortcuts" hideLabel>
          <Input leading={<Search />} value={q} onChange={(e) => setQ(e.currentTarget.value)} placeholder="Filter: “week”, “undo”, “g”…" />
        </Field>
        {groups.length === 0 ? (
          <p className="py-6 text-body text-fg-3">No shortcut matches “{q}”.</p>
        ) : (
          <div className="columns-1 gap-12 md:columns-2">
            {groups.map((g) => (
              <motion.div key={g.group} layout="position" transition={spring.smooth} className="mb-10 break-inside-avoid">
                <h3 className="mb-2 text-title-3 text-fg-1">{g.group}</h3>
                <div>
                  <dl className="flex flex-col">
                    {g.items.map((it) => (
                      <div key={it.id} className="flex min-h-9 items-center justify-between gap-4 border-b border-line-1 py-1 last:border-b-0">
                        <dt className="text-body text-fg-2">
                          <Highlight text={it.label} q={q.trim()} />
                        </dt>
                        <dd className="shrink-0">
                          <Keys keys={it.keys} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}
