/**
 * PLACEHOLDER (partly functional) — the settings agent replaces this file. Contract
 * (src/shell/README.md): named exports SettingsLayout (renders <Outlet/>), SettingsProfilePage,
 * SettingsZonesPage, SettingsSportsPage, SettingsGarminPage, SettingsSyncPage,
 * SettingsAppearancePage, SettingsDataPage, SettingsShortcutsPage.
 * Appearance and Shortcuts are already wired to the shell stores (theme, motion, units, shortcut
 * registry) — keep that wiring when replacing.
 */
import { Outlet } from '@tanstack/react-router';
import { Database, Gauge, Layers, RefreshCw, User, Watch } from 'lucide-react';
import type { ReactNode } from 'react';
import { setUnits, useUnits } from '@/lib/units';
import { setMotionPref, useMotionPref, type MotionPref } from '@/motion/prefs';
import { listShortcuts } from '@/shell/shortcuts';
import { useTheme, type ThemePref } from '@/shell/theme';
import { Card } from '@/ui/Card';
import { EmptyState } from '@/ui/EmptyState';
import { Kbd } from '@/ui/Kbd';
import { Page, PageHeader } from '@/ui/PageHeader';
import { Section } from '@/ui/Section';
import { Segmented } from '@/ui/Segmented';
import { NavTabs } from '@/ui/Tabs';

const TABS = [
  { to: '/settings/profile', label: 'Profile' },
  { to: '/settings/zones', label: 'Zones' },
  { to: '/settings/sports', label: 'Sports' },
  { to: '/settings/garmin', label: 'Garmin' },
  { to: '/settings/sync', label: 'Sync log' },
  { to: '/settings/appearance', label: 'Appearance' },
  { to: '/settings/data', label: 'Data' },
  { to: '/settings/shortcuts', label: 'Shortcuts' },
];

export function SettingsLayout() {
  return (
    <Page width="page" header={<PageHeader title="Settings" />}>
      <NavTabs aria-label="Settings sections" items={TABS} />
      <Outlet />
    </Page>
  );
}

function Soon({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line-2">
      <EmptyState icon={icon} title={title} size="sm">
        {children}
      </EmptyState>
    </div>
  );
}

export const SettingsProfilePage = () => (
  <Soon icon={<User />} title="Profile">
    Name, birth year, sex, weight, units, week start and timezone.
  </Soon>
);
export const SettingsZonesPage = () => (
  <Soon icon={<Gauge />} title="Zones & thresholds">
    FTP, threshold pace, CSS, row threshold, LTHR and HR max with effective dates and history.
  </Soon>
);
export const SettingsSportsPage = () => (
  <Soon icon={<Layers />} title="Sports">
    Sub-sports, load source precedence and the default compliance metric.
  </Soon>
);
export const SettingsGarminPage = () => (
  <Soon icon={<Watch />} title="Garmin">
    Connection, auto-push horizon, backfill range and devices.
  </Soon>
);
export const SettingsSyncPage = () => (
  <Soon icon={<RefreshCw />} title="Sync log">
    Every pull and push with status, payload summary and retry.
  </Soon>
);
export const SettingsDataPage = () => (
  <Soon icon={<Database />} title="Data">
    JSON backup, FIT archive and CSV exports; imports.
  </Soon>
);

function Row({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-0.5">
        <span className="text-body text-fg-1">{title}</span>
        {description && <span className="text-body-sm text-fg-3">{description}</span>}
      </div>
      {children}
    </div>
  );
}

export function SettingsAppearancePage() {
  const { pref, setTheme } = useTheme();
  const motionPref = useMotionPref();
  const units = useUnits();
  return (
    <Section title="Appearance" description="Stored on this device.">
      <Card spotlight={false}>
        <div className="divide-y divide-line-1">
          <Row title="Theme" description="Dark is the default. Light is equally finished.">
            <Segmented<ThemePref>
              aria-label="Theme"
              value={pref}
              onValueChange={setTheme}
              options={[
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' },
                { value: 'system', label: 'System' },
              ]}
            />
          </Row>
          <Row title="Motion" description="Reduced motion replaces morphs with short crossfades.">
            <Segmented<MotionPref>
              aria-label="Motion"
              value={motionPref}
              onValueChange={setMotionPref}
              options={[
                { value: 'system', label: 'System' },
                { value: 'full', label: 'Full' },
                { value: 'reduced', label: 'Reduced' },
              ]}
            />
          </Row>
          <Row title="Units" description="Distances, paces, elevation and weight.">
            <Segmented
              aria-label="Units"
              value={units.system}
              onValueChange={(v) => setUnits({ system: v })}
              options={[
                { value: 'metric', label: 'Metric' },
                { value: 'imperial', label: 'Imperial' },
              ]}
            />
          </Row>
          <Row title="Pool length unit">
            <Segmented
              aria-label="Pool unit"
              value={units.swim}
              onValueChange={(v) => setUnits({ swim: v })}
              options={[
                { value: 'm', label: 'Meters' },
                { value: 'yd', label: 'Yards' },
              ]}
            />
          </Row>
        </div>
      </Card>
    </Section>
  );
}

export function SettingsShortcutsPage() {
  const groups = listShortcuts();
  return (
    <Section title="Keyboard shortcuts" description="Press ? anywhere to come back here. ⌘K opens everything else.">
      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((g) => (
          <Card key={g.group} title={g.group} spotlight={false} className={g.group === 'Calendar' ? 'lg:row-span-2' : undefined}>
            <dl className="flex flex-col">
              {g.items.map((it) => (
                <div key={it.id} className="flex h-9 items-center justify-between gap-4 border-b border-line-1 last:border-b-0">
                  <dt className="text-body text-fg-2">{it.label}</dt>
                  <dd>
                    {/* "g c" is a sequence; "1 2 3 4 5" / "left right up down" are alternatives */}
                    {it.keys.includes(' ') && !it.keys.startsWith('g ') ? (
                      <span className="flex gap-1">
                        {it.keys.split(' ').map((k) => (
                          <Kbd key={k} keys={k} />
                        ))}
                      </span>
                    ) : (
                      <Kbd keys={it.keys} />
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        ))}
      </div>
    </Section>
  );
}
