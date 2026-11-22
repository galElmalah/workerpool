import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Check, CloudDownload, Database, KeyRound, RefreshCw, Send, Unplug, Watch } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';
import { api, call } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateMedium, formatDayMonth, formatMonthYear, formatNumber } from '@/lib/format';
import { invalidateTraining, qk } from '@/lib/query';
import { useGarminStatus, useSettings, useSyncNow } from '@/lib/queries/shared';
import { Odometer } from '@/motion/Ticker';
import { spring } from '@/motion/tokens';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { SaveIndicator } from '@/ui/SaveIndicator';
import { Section } from '@/ui/Section';
import { Segmented } from '@/ui/Segmented';
import { Skeleton } from '@/ui/Skeleton';
import { toast } from '@/ui/toast';
import { cancelBackfill, resumeBackfill, startBackfill, useBackfill } from './backfill';
import { InlineError, Row, Rows, TwoStepButton, relativeTime, useApiToday, useSettingsSaver } from './common';
import { Disclosure, GarminConnectForm, KeyGuide, TokensGuide } from './garmin';

type Status = NonNullable<ReturnType<typeof useGarminStatus>['data']>;

function Cap({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <span className={cn('inline-flex h-6 items-center gap-1 rounded-sm border px-2 text-label', on ? 'border-transparent bg-accent-a2 text-accent-ink' : 'border-dashed border-line-3 text-fg-3')}>
      {on ? <Check className="size-3" strokeWidth={2.5} /> : <span aria-hidden>–</span>}
      {children}
      <span className="sr-only">{on ? 'available' : 'not available'}</span>
    </span>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-micro uppercase text-fg-3">{label}</span>
      <span className="truncate text-stat-sm text-fg-1">{children}</span>
    </div>
  );
}

export function SettingsGarminPage() {
  const status = useGarminStatus();
  const today = useApiToday();
  if (status.isPending)
    return (
      <Section title="Garmin">
        <Skeleton className="h-48 w-full" radius="lg" />
      </Section>
    );
  if (status.isError)
    return (
      <Section title="Garmin">
        <InlineError action={<Button size="sm" variant="ghost" onClick={() => void status.refetch()}>Retry</Button>}>Couldn't load the Garmin status.</InlineError>
      </Section>
    );
  const s = status.data;
  return s.connected ? <Connected s={s} today={today} /> : <Disconnected s={s} today={today} />;
}

function Disconnected({ s, today }: { s: Status; today?: string }) {
  return (
    <>
      <Section title="Garmin" description="Connect once; Cadence pulls activities, sleep and HRV, and can send planned workouts to your watch.">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
          <Card spotlight={false}>
            <GarminConnectForm demo={s.demo} today={today} showGuide={false} />
          </Card>
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-3">
              <h3 className="text-title-3 text-fg-1">Read access · Personal API key</h3>
              <KeyGuide />
            </div>
            <div className="flex flex-col gap-3">
              <h3 className="text-title-3 text-fg-1">Write access · token file (optional)</h3>
              <TokensGuide />
            </div>
          </div>
        </div>
      </Section>
      {s.lastError && (
        <Section title="Last error" variant="micro">
          <InlineError>{s.lastError}</InlineError>
        </Section>
      )}
    </>
  );
}

function Connected({ s, today }: { s: Status; today?: string }) {
  const qc = useQueryClient();
  const sync = useSyncNow();
  const [report, setReport] = useState<Awaited<ReturnType<typeof sync.mutateAsync>> | null>(null);
  const push = useMutation({ mutationFn: () => call(api.garmin['push-upcoming'].$post()), onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: qk.garmin.status }), invalidateTraining()]) });
  const disconnect = useMutation({
    mutationFn: () => call(api.garmin.connect.$delete()),
    onSuccess: (r) => {
      qc.setQueryData(qk.garmin.status, r);
      toast('Disconnected from Garmin. Stored credentials deleted.');
    },
  });
  const settings = useSettings().data;
  const saver = useSettingsSaver();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const expiresSoon = s.credentials.keyExpiresOn && today && s.credentials.keyExpiresOn <= addDaysIso(today, 14);

  return (
    <>
      <Section title="Garmin" description="Your Garmin Connect account and what Cadence may do with it.">
        <Card spotlight={false} padding="none">
          <div className="flex flex-col gap-5 p-5 md:flex-row md:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-4">
              <span className="relative flex size-12 shrink-0 items-center justify-center rounded-lg bg-accent-a2 text-accent-ink">
                <Watch className="size-5" />
                <span className={cn('absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-surface-1', s.state === 'error' ? 'bg-fg-1' : 'bg-accent')} />
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-title-3 text-fg-1">{s.displayName ?? 'Garmin account'}</span>
                <span className="text-body-sm text-fg-3">
                  {s.state === 'error' ? 'Needs attention' : 'Connected'} · last sync {relativeTime(s.lastSyncAt)}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Cap on={s.capabilities.read}>Read activities & wellness</Cap>
              <Cap on={s.capabilities.write}>Send workouts</Cap>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 border-t border-line-1 p-5 sm:grid-cols-4">
            <Stat label="Activities">
              <Odometer value={s.counts.activities} />
            </Stat>
            <Stat label="History back to">{s.counts.oldestGarminDate ? formatMonthYear(s.counts.oldestGarminDate) : '—'}</Stat>
            <Stat label="Workouts on watch">{formatNumber(s.counts.workoutsSynced)}</Stat>
            <Stat label="Waiting / failed">
              {formatNumber(s.counts.workoutsPending)} / {formatNumber(s.counts.workoutsError)}
            </Stat>
          </div>
          {(s.lastError || expiresSoon) && (
            <div className="flex flex-col gap-2 border-t border-line-1 p-5">
              {s.lastError && <InlineError>{s.lastError}</InlineError>}
              {expiresSoon && <InlineError>Your Personal API key expires on {formatDateMedium(s.credentials.keyExpiresOn!, true)}. Create a new one in Garmin Connect and paste it below.</InlineError>}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 border-t border-line-1 p-4">
            <Button
              variant="primary"
              icon={<RefreshCw className={sync.isPending ? 'animate-spin' : undefined} />}
              disabled={sync.isPending}
              onClick={() =>
                sync.mutate(undefined, {
                  onSuccess: (r) => setReport(r),
                  onError: (e) => toast.error(e.message),
                })
              }
            >
              {sync.isPending ? 'Syncing…' : 'Sync now'}
            </Button>
            <Button
              variant="secondary"
              icon={<Send />}
              loading={push.isPending}
              disabled={!s.capabilities.write}
              onClick={() =>
                push.mutate(undefined, {
                  onSuccess: (r) =>
                    toast.success(
                      r.pushed || r.removed
                        ? `Sent ${r.pushed} workout${r.pushed === 1 ? '' : 's'} to Garmin${r.removed ? `, removed ${r.removed}` : ''}${r.failed ? ` · ${r.failed} failed` : ''}`
                        : r.failed
                          ? `${r.failed} workout${r.failed === 1 ? '' : 's'} failed to send`
                          : 'Everything upcoming is already on your watch',
                    ),
                  onError: (e) => toast.error(e.message),
                })
              }
            >
              Send upcoming workouts now
            </Button>
            <span className="flex-1" />
            <Link to="/settings/sync" className="text-label text-fg-2 underline decoration-line-3 underline-offset-3 hover:text-fg-1">
              Sync log
            </Link>
          </div>
          <AnimatePresence initial={false}>
            {report && (
              <motion.div key={report.durationMs} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring.smooth} className="border-t border-line-1 p-5" aria-live="polite">
                <div className="mb-3 flex items-center gap-2 text-body text-fg-1">
                  <Check className="size-4 text-accent-ink" /> {report.summary || 'Up to date'}
                  <span className="font-mono text-mono-sm text-fg-3">{(report.durationMs / 1000).toFixed(1)} s</span>
                </div>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Stat label="New activities">{report.activities.created}</Stat>
                  <Stat label="Updated">{report.activities.updated}</Stat>
                  <Stat label="Wellness days">{report.wellnessDays}</Stat>
                  <Stat label="Workouts sent">{report.push.pushed}</Stat>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      </Section>

      <Section title="History import" description="Pull older activities. It runs in steps; leave this page whenever you like.">
        <BackfillCard s={s} />
      </Section>

      <Section title="Sending workouts" actions={<SaveIndicator status={saver.status} />}>
        <Card spotlight={false}>
          <Rows>
            <Row title="Auto-send window" description="Planned workouts this many days ahead are sent to your Garmin calendar on every sync. Needs write access.">
              <Segmented
                aria-label="Auto-send window"
                value={String(settings?.garminAutoPushDays ?? 7)}
                onValueChange={(v) => void saver.save({ garminAutoPushDays: Number(v) })}
                options={[
                  { value: '0', label: 'Off' },
                  { value: '3', label: '3 d' },
                  { value: '7', label: '7 d' },
                  { value: '14', label: '14 d' },
                  ...(settings && ![0, 3, 7, 14].includes(settings.garminAutoPushDays) ? [{ value: String(settings.garminAutoPushDays), label: `${settings.garminAutoPushDays} d` }] : []),
                ]}
              />
            </Row>
          </Rows>
        </Card>
      </Section>

      <Section title="Credentials">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-body-sm text-fg-3">
            <span className="flex items-center gap-1.5">
              <KeyRound className="size-3.5" /> Personal API key: <span className="text-fg-1">{s.credentials.personalApiKey ? `stored${s.credentials.keyExpiresOn ? `, expires ${formatDateMedium(s.credentials.keyExpiresOn, true)}` : ''}` : 'not set'}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <Watch className="size-3.5" /> Token file: <span className="text-fg-1">{s.credentials.connectToken ? 'stored' : 'not set'}</span>
            </span>
          </div>
          <Disclosure title="Update or add credentials" icon={<KeyRound />}>
            <GarminConnectForm demo={s.demo} today={today} primary={false} submitLabel="Save credentials" onConnected={() => toast.success('Garmin credentials updated')} />
          </Disclosure>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed border-line-2 px-4 py-3">
            <div className="flex flex-col">
              <span className="text-body text-fg-1">Disconnect</span>
              <span className="text-body-sm text-fg-3">Deletes the stored key and tokens. Your activities stay.</span>
            </div>
            <TwoStepButton label="Disconnect" confirmLabel="Confirm disconnect" icon={<Unplug />} loading={disconnect.isPending} onConfirm={() => disconnect.mutate()} />
          </div>
        </div>
      </Section>
    </>
  );
}

function addDaysIso(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

const MONTHS = [
  { value: '1', label: '1 mo' },
  { value: '3', label: '3 mo' },
  { value: '6', label: '6 mo' },
  { value: '12', label: '1 yr' },
  { value: '24', label: '2 yr' },
] as const;

const PHASE: Record<string, string> = {
  list: 'Finding activities',
  activities: 'Importing activities',
  wellness: 'Importing sleep & HRV',
  done: 'Finished',
  cancelled: 'Stopped',
  error: 'Stopped with an error',
};

function BackfillCard({ s }: { s: Status }) {
  const bf = useBackfill();
  const [months, setMonths] = useState<(typeof MONTHS)[number]['value']>('12');
  const server = s.backfillProgress;
  useEffect(() => {
    if (server?.running && !bf.looping) resumeBackfill(server);
  }, [server, bf.looping]);
  const p = bf.progress ?? server ?? null;
  const running = bf.looping || !!p?.running;
  const total = p?.total ?? null;
  const frac = p ? (p.phase === 'done' ? 1 : total ? Math.min(1, p.done / Math.max(1, total)) : 0.03) : 0;
  return (
    <Card spotlight={false}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented aria-label="How far back" value={months} onValueChange={setMonths} options={MONTHS} />
          {running ? (
            <Button variant="secondary" onClick={() => void cancelBackfill()}>
              Stop
            </Button>
          ) : (
            <Button variant="secondary" icon={<CloudDownload />} onClick={() => void startBackfill(Number(months))}>
              Import {MONTHS.find((m) => m.value === months)!.label}
            </Button>
          )}
        </div>
        {p ? (
          <div className="flex flex-col gap-3" aria-live="polite">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-label text-fg-2">
                {PHASE[p.phase] ?? p.phase}
                {p.phase === 'done' && p.finishedAt ? ` ${relativeTime(p.finishedAt)}` : ''} · since {formatDateMedium(p.sinceDate, true)}
              </span>
              <span className="font-mono text-mono text-fg-2">{total ? `${formatNumber(p.done)} / ${formatNumber(total)}` : ''}</span>
            </div>
            <div className="relative h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)}>
              <motion.div className="absolute inset-0 origin-left rounded-full bg-accent" initial={false} animate={{ scaleX: frac }} transition={spring.gentle} />
              {running && <div className="skeleton absolute inset-0 opacity-60" />}
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Imported">
                <Odometer value={p.created + p.updated} />
              </Stat>
              <Stat label="Oldest reached">{p.oldestDate ? formatDayMonth(p.oldestDate) + ' ' + p.oldestDate.slice(0, 4) : '—'}</Stat>
              <Stat label="Wellness days">{formatNumber(p.wellnessDays)}</Stat>
              <Stat label="Failed">{formatNumber(p.failed)}</Stat>
            </div>
            {(bf.error || p.lastError) && <InlineError>{bf.error ?? p.lastError}</InlineError>}
          </div>
        ) : (
          <p className="flex items-center gap-2 text-body-sm text-fg-3">
            <Database className="size-3.5" /> No import has run yet. Fitness needs about six weeks of history.
          </p>
        )}
      </div>
    </Card>
  );
}
