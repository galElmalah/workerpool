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
    <span className={cn('inline-flex items-center gap-1.5 text-body-sm', on ? 'text-fg-2' : 'text-fg-4 line-through')}>
      {on ? <Check className="size-3.5 text-fg-3" strokeWidth={2.25} /> : <span aria-hidden>–</span>}
      {children}
      <span className="sr-only">{on ? 'available' : 'not available'}</span>
    </span>
  );
}

/** One quiet line of facts: "443 activities · since Dec 2025 · 11 on your watch". */
function Facts({ items }: { items: (ReactNode | false | null | undefined)[] }) {
  const shown = items.filter(Boolean);
  return (
    <p className="num flex flex-wrap items-baseline gap-x-2 gap-y-1 text-body text-fg-2">
      {shown.map((x, i) => (
        <span key={i} className="flex items-baseline gap-2">
          {i > 0 && <span className="text-fg-4">·</span>}
          <span>{x}</span>
        </span>
      ))}
    </p>
  );
}
const B = ({ children }: { children: ReactNode }) => <span className="font-medium text-fg-1">{children}</span>;

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
        <div className="flex flex-col gap-12">
          <div>
            <GarminConnectForm demo={s.demo} today={today} showGuide={false} />
          </div>
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
        <Section title="Last error">
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
        <div className="flex flex-col gap-6">
          <div className="flex min-w-0 items-center gap-4">
            <span className="relative flex size-11 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-fg-2">
              <Watch className="size-5" />
              <span className={cn('absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-canvas', s.state === 'error' ? 'bg-fg-1' : 'bg-fg-3')} aria-hidden />
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-title-3 text-fg-1">{s.displayName ?? 'Garmin account'}</span>
              <span className="text-body-sm text-fg-3">
                {s.state === 'error' ? 'Needs attention' : 'Connected'} · last sync {relativeTime(s.lastSyncAt)}
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Facts
              items={[
                <>
                  <B>
                    <Odometer value={s.counts.activities} />
                  </B>{' '}
                  activities
                </>,
                s.counts.oldestGarminDate && <>back to {formatMonthYear(s.counts.oldestGarminDate)}</>,
                <>
                  <B>{formatNumber(s.counts.workoutsSynced)}</B> workouts on your watch
                </>,
                (s.counts.workoutsPending > 0 || s.counts.workoutsError > 0) && (
                  <>
                    {formatNumber(s.counts.workoutsPending)} waiting · {formatNumber(s.counts.workoutsError)} failed
                  </>
                ),
              ]}
            />
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              <Cap on={s.capabilities.read}>Read activities & wellness</Cap>
              <Cap on={s.capabilities.write}>Send workouts</Cap>
            </div>
          </div>
          {(s.lastError || expiresSoon) && (
            <div className="flex flex-col gap-2">
              {s.lastError && <InlineError>{s.lastError}</InlineError>}
              {expiresSoon && <InlineError>Your Personal API key expires on {formatDateMedium(s.credentials.keyExpiresOn!, true)}. Create a new one in Garmin Connect and paste it below.</InlineError>}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
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
              variant="ghost"
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
            <Link to="/settings/sync" className="text-body-sm text-fg-2 underline decoration-line-3 underline-offset-3 hover:text-fg-1">
              Sync log
            </Link>
          </div>
          <AnimatePresence initial={false}>
            {report && (
              <motion.div key={report.durationMs} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring.smooth} className="flex flex-col gap-1 rounded-lg bg-surface-1 px-4 py-3" aria-live="polite">
                <div className="flex items-center gap-2 text-body text-fg-1">
                  <Check className="size-4 text-fg-3" /> {report.summary || 'Up to date'}
                  <span className="num text-body-sm text-fg-3">{(report.durationMs / 1000).toFixed(1)} s</span>
                </div>
                <span className="num text-body-sm text-fg-3">
                  {report.activities.created} new · {report.activities.updated} updated · {report.wellnessDays} wellness days · {report.push.pushed} workouts sent
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Section>

      <Section title="History import" description="Pull older activities. It runs in steps; leave this page whenever you like.">
        <BackfillCard s={s} />
      </Section>

      <Section title="Sending workouts" actions={<SaveIndicator status={saver.status} />}>
        <div>
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
        </div>
      </Section>

      <Section title="Credentials">
        <div className="flex flex-col gap-4">
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
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
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
    <div className="flex flex-col gap-6">
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
              <span className="text-body-sm text-fg-3">
                {PHASE[p.phase] ?? p.phase}
                {p.phase === 'done' && p.finishedAt ? ` ${relativeTime(p.finishedAt)}` : ''} · since {formatDateMedium(p.sinceDate, true)}
              </span>
              <span className="num text-body font-medium text-fg-1">{total ? `${formatNumber(p.done)} / ${formatNumber(total)}` : ''}</span>
            </div>
            <div className="relative h-1 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)}>
              <motion.div className="absolute inset-0 origin-left rounded-full bg-fg-2" initial={false} animate={{ scaleX: frac }} transition={spring.gentle} />
              {running && <div className="skeleton absolute inset-0 opacity-60" />}
            </div>
            <Facts
              items={[
                <>
                  <B>
                    <Odometer value={p.created + p.updated} />
                  </B>{' '}
                  imported
                </>,
                p.oldestDate && <>back to {formatDayMonth(p.oldestDate) + ' ' + p.oldestDate.slice(0, 4)}</>,
                <>{formatNumber(p.wellnessDays)} wellness days</>,
                p.failed > 0 && <>{formatNumber(p.failed)} failed</>,
              ]}
            />
            {(bf.error || p.lastError) && <InlineError>{bf.error ?? p.lastError}</InlineError>}
          </div>
        ) : (
          <p className="flex items-center gap-2 text-body-sm text-fg-3">
            <Database className="size-3.5" /> No import has run yet. Fitness needs about six weeks of history.
          </p>
        )}
    </div>
  );
}
