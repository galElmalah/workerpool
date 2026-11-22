/**
 * First run (/welcome) and sign-in (/login) — bare routes, no app chrome.
 *
 * /welcome: passphrase → you → Garmin (+ live history backfill) → thresholds → calendar.
 * The step lives in sessionStorage so a reload resumes; once the instance is configured, a signed-out
 * visitor is sent to /login and an onboarded one to the app.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import type { Threshold, ThresholdKind } from '@cadence/core/domain';
import { ArrowLeft, ArrowRight, Check, Database, Lock, ShieldCheck, TriangleAlert, Watch } from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion, useAnimate } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, api, call } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateMedium, formatNumber, paceParts } from '@/lib/format';
import { qk } from '@/lib/query';
import { authQuery, settingsQuery, useAuthStatus, useGarminStatus, useLogin, useSetupPassphrase, useUpdateSettings } from '@/lib/queries/shared';
import { setUnits, useUnits, type UnitPrefs } from '@/lib/units';
import { Odometer } from '@/motion/Ticker';
import { useReducedMotionPref } from '@/motion/prefs';
import { dur, spring, tween } from '@/motion/tokens';
import { Button } from '@/ui/Button';
import { Combobox } from '@/ui/Combobox';
import { Field, Input } from '@/ui/Field';
import { Segmented } from '@/ui/Segmented';
import { useBackfill, resumeBackfill, startBackfill, cancelBackfill } from './backfill';
import { GarminConnectForm } from './garmin';
import { BigThresholdInput, PassphraseInput, SourceChip, StrengthMeter, THRESHOLD_META, Wordmark, passphraseStrength, thresholdUnit } from './kit';

// ───────────────────────────── frame ─────────────────────────────

function BareFrame({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between px-5 md:px-8">
        <Wordmark />
        {right}
      </header>
      <div className="flex flex-1 flex-col">{children}</div>
      <footer className="flex h-12 shrink-0 items-center justify-center px-5 text-micro uppercase text-fg-4">Single athlete · self-hosted · your data</footer>
    </div>
  );
}

function Splash() {
  return (
    <BareFrame>
      <div className="flex flex-1 items-center justify-center">
        <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tween('base')} className="flex gap-1" aria-label="Loading">
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-1.5 rounded-full bg-fg-3 animate-dot-pulse" style={{ animationDelay: `${i * 120}ms` }} />
          ))}
        </motion.span>
      </div>
    </BareFrame>
  );
}

// ───────────────────────────── step indicator ─────────────────────────────

const STEPS = [
  { id: 'pass', label: 'Passphrase' },
  { id: 'you', label: 'You' },
  { id: 'garmin', label: 'Garmin' },
  { id: 'zones', label: 'Thresholds' },
] as const;

function StepIndicator({ step, done }: { step: number; done: boolean }) {
  return (
    <LayoutGroup id="welcome-steps">
      <ol className="relative grid grid-cols-4 gap-1" aria-label="Setup progress">
        {STEPS.map((s, i) => {
          const active = i === step && !done;
          const complete = i < step || done;
          return (
            <li key={s.id} className="relative flex flex-col gap-2" aria-current={active ? 'step' : undefined}>
              <span className="relative h-1 overflow-hidden rounded-full bg-surface-3">
                <motion.span
                  className={cn('absolute inset-0 origin-left rounded-full', complete ? 'bg-accent' : 'bg-fg-1')}
                  initial={false}
                  animate={{ scaleX: complete || active ? 1 : 0, opacity: active ? 0.9 : 1 }}
                  transition={spring.smooth}
                />
              </span>
              <span className="relative flex h-7 items-center gap-1.5 px-2">
                {active && (
                  <motion.span layoutId="welcome-step-pill" transition={spring.smooth} className="absolute inset-0 -z-0 rounded-sm border border-line-2 bg-surface-2" aria-hidden />
                )}
                <span className="relative flex size-4 items-center justify-center">
                  <AnimatePresence initial={false} mode="popLayout">
                    {complete ? (
                      <motion.span key="c" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={spring.snappy}>
                        <Check className="size-3.5 text-accent-ink" strokeWidth={2.5} />
                      </motion.span>
                    ) : (
                      <motion.span key="n" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={spring.snappy} className={cn('font-mono text-mono-sm', active ? 'text-fg-1' : 'text-fg-4')}>
                        {i + 1}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </span>
                <span className={cn('relative truncate text-label', active ? 'text-fg-1' : complete ? 'text-fg-2' : 'text-fg-3')}>{s.label}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </LayoutGroup>
  );
}

// ───────────────────────────── welcome ─────────────────────────────

const STEP_KEY = 'cadence.welcome.step';
const readStep = () => {
  try {
    return Number(sessionStorage.getItem(STEP_KEY) ?? '1') || 1;
  } catch {
    return 1;
  }
};

export function WelcomePage() {
  const auth = useAuthStatus();
  const navigate = useNavigate();
  const authed = !!auth.data?.authenticated;
  const settings = useQuery({ ...settingsQuery, enabled: authed });
  const finishing = useRef(false);
  const [step, setStepRaw] = useState<number | null>(null);
  const [dir, setDir] = useState(1);
  const [done, setDone] = useState(false);

  // gate + initial step
  useEffect(() => {
    if (!auth.data || finishing.current) return;
    if (!auth.data.configured) {
      if (step === null) setStepRaw(0);
      return;
    }
    if (!auth.data.authenticated) {
      void navigate({ to: '/login', replace: true });
      return;
    }
    if (!settings.data) return;
    if (settings.data.onboarded) {
      void navigate({ to: settings.data.homeRoute === 'today' ? '/today' : '/calendar', replace: true });
      return;
    }
    if (step === null) setStepRaw(Math.min(3, Math.max(1, readStep())));
  }, [auth.data, settings.data, step, navigate]);

  useEffect(() => {
    document.title = 'Welcome · cadence';
  }, []);

  const go = (next: number) => {
    setDir(next > (step ?? 0) ? 1 : -1);
    setStepRaw(next);
    try {
      sessionStorage.setItem(STEP_KEY, String(next));
    } catch {
      /* ignore */
    }
  };

  const finish = (home: 'today' | 'calendar') => {
    finishing.current = true;
    setDone(true);
    try {
      sessionStorage.removeItem(STEP_KEY);
    } catch {
      /* ignore */
    }
    setTimeout(() => void navigate({ to: home === 'today' ? '/today' : '/calendar' }), 1100);
  };

  if (step === null) return <Splash />;

  return (
    <BareFrame right={auth.data?.demo ? <span className="rounded-xs border border-dashed border-line-3 px-1.5 py-0.5 text-micro uppercase text-fg-3">Demo mode</span> : undefined}>
      <div className="mx-auto grid w-full max-w-[1120px] flex-1 grid-cols-1 gap-10 px-5 pb-10 pt-4 md:px-8 lg:grid-cols-[minmax(0,500px)_minmax(0,1fr)] lg:gap-16 lg:pt-10">
        <div className="flex min-w-0 flex-col gap-8">
          <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={spring.smooth} className="max-w-[30rem] text-body-lg text-fg-2">
            Your training calendar, Garmin sync and progress — one quiet instrument for one athlete.
          </motion.p>
          <StepIndicator step={step} done={done} />
          <div className="relative min-h-[420px]">
            <AnimatePresence mode="wait" custom={dir} initial={false}>
              {done ? (
                <Finale key="done" />
              ) : (
                <motion.div
                  key={step}
                  custom={dir}
                  variants={{
                    enter: (d: number) => ({ opacity: 0, x: d * 28 }),
                    center: { opacity: 1, x: 0, transition: spring.smooth },
                    exit: (d: number) => ({ opacity: 0, x: d * -20, transition: tween('fast', 'in') }),
                  }}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  className="flex flex-col gap-6"
                >
                  {step === 0 && <StepPassphrase onNext={() => go(1)} />}
                  {step === 1 && <StepYou onNext={() => go(2)} />}
                  {step === 2 && <StepGarmin demo={!!auth.data?.demo} onBack={() => go(1)} onNext={() => go(3)} />}
                  {step === 3 && <StepThresholds onBack={() => go(2)} onFinish={finish} />}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
        <aside className="hidden min-w-0 lg:block" aria-hidden>
          <div className="sticky top-10">
            <Preview step={done ? 4 : step} />
          </div>
        </aside>
      </div>
    </BareFrame>
  );
}

function StepHead({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-micro uppercase text-fg-3">{eyebrow}</span>
      <h1 data-page-title tabIndex={-1} className="text-title-1 text-fg-1 outline-none">
        {title}
      </h1>
      {children && <p className="text-body-lg text-fg-2">{children}</p>}
    </div>
  );
}

function InlineError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-md border border-dashed border-line-3 px-3 py-2 text-body-sm text-fg-1">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
      {children}
    </p>
  );
}

// ── step 1: passphrase ──
function StepPassphrase({ onNext }: { onNext: () => void }) {
  const [value, setValue] = useState('');
  const setup = useSetupPassphrase();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const ok = passphraseStrength(value).score >= 2;
  const submit = () => {
    if (!ok || setup.isPending) return;
    setup.mutate(value, {
      onSuccess: () => {
        const prev = qc.getQueryData(authQuery.queryKey);
        qc.setQueryData(authQuery.queryKey, { configured: true, authenticated: true, demo: prev?.demo ?? false });
        onNext();
      },
      onError: (e) => {
        if (e instanceof ApiError && e.code === 'already_configured') void navigate({ to: '/login', replace: true });
      },
    });
  };
  return (
    <>
      <StepHead eyebrow="Step 1 of 4" title="Create your passphrase">
        Cadence has one user: you. This passphrase unlocks it on every device.
      </StepHead>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor="pp" className="sr-only">
          Passphrase
        </label>
        <PassphraseInput id="pp" value={value} onChange={setValue} autoComplete="new-password" autoFocus placeholder="A few words you will remember" aria-describedby="pp-strength" />
        <StrengthMeter value={value} id="pp-strength" />
        {setup.isError && !(setup.error instanceof ApiError && setup.error.code === 'already_configured') && <InlineError>{setup.error.message}</InlineError>}
        <div className="flex items-center justify-between gap-3 pt-2">
          <span className="flex items-center gap-1.5 text-body-sm text-fg-3">
            <Lock className="size-3.5" /> Stored only as a salted hash
          </span>
          <Button type="submit" variant="primary" size="lg" iconRight={<ArrowRight />} loading={setup.isPending} disabled={!ok}>
            Continue
          </Button>
        </div>
      </form>
    </>
  );
}

// ── step 2: you ──
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

function StepYou({ onNext }: { onNext: () => void }) {
  const { data: s } = useQuery(settingsQuery);
  const update = useUpdateSettings();
  const [name, setName] = useState(s?.name ?? '');
  const [units, setU] = useState<'metric' | 'imperial'>(s?.units ?? 'metric');
  const [weekStart, setWeekStart] = useState<'monday' | 'sunday'>(s?.weekStart ?? 'monday');
  const [tz, setTz] = useState<string>(s?.timezone && s.timezone !== 'UTC' ? s.timezone : detectedTz);
  useEffect(() => setUnits({ system: units }), [units]);
  const submit = () =>
    update.mutate({ name: name.trim(), units, weekStart, timezone: tz }, { onSuccess: onNext });
  return (
    <>
      <StepHead eyebrow="Step 2 of 4" title="A little about you">
        So dates, distances and paces read the way you think about them.
      </StepHead>
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Name" hint="Shown in greetings. Optional.">
          <Input value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="Your first name" autoComplete="given-name" size="lg" autoFocus />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <span className="text-label text-fg-2">Units</span>
            <Segmented
              block
              aria-label="Units"
              value={units}
              onValueChange={setU}
              options={[
                { value: 'metric', label: 'Metric · km' },
                { value: 'imperial', label: 'Imperial · mi' },
              ]}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-label text-fg-2">Week starts on</span>
            <Segmented
              block
              aria-label="Week start"
              value={weekStart}
              onValueChange={setWeekStart}
              options={[
                { value: 'monday', label: 'Monday' },
                { value: 'sunday', label: 'Sunday' },
              ]}
            />
          </div>
        </div>
        <Combobox
          label="Timezone"
          hint={tz === detectedTz ? 'Detected from this device. Decides when your day rolls over.' : 'Decides when your day rolls over.'}
          items={ZONES}
          value={tz}
          onValueChange={(v) => v && setTz(v)}
          itemToLabel={(z) => z.replaceAll('_', ' ')}
          itemToKey={(z) => z}
          placeholder="Search timezones"
        />
        {update.isError && <InlineError>{update.error.message}</InlineError>}
        <div className="flex justify-end pt-2">
          <Button type="submit" variant="primary" size="lg" iconRight={<ArrowRight />} loading={update.isPending}>
            Continue
          </Button>
        </div>
      </form>
    </>
  );
}

// ── step 3: Garmin ──
const MONTHS = [
  { value: '1', label: '1 mo' },
  { value: '3', label: '3 mo' },
  { value: '12', label: '1 yr' },
  { value: '24', label: '2 yr' },
] as const;

function StepGarmin({ demo, onBack, onNext }: { demo: boolean; onBack: () => void; onNext: () => void }) {
  const status = useGarminStatus();
  const bf = useBackfill();
  const connected = !!status.data?.connected;
  const today = useQuery({ queryKey: qk.thresholds.current, queryFn: () => call(api.thresholds.current.$get()) }).data?.date;

  useEffect(() => {
    const p = status.data?.backfillProgress;
    if (p?.running && !bf.looping) resumeBackfill(p);
  }, [status.data?.backfillProgress, bf.looping]);
  // keep counts live while the first sync and the import run
  const refetch = status.refetch;
  useEffect(() => {
    if (!connected) return;
    const t = setInterval(() => void refetch(), 3000);
    return () => clearInterval(t);
  }, [connected, refetch]);

  return (
    <>
      <StepHead eyebrow="Step 3 of 4" title={connected ? `Connected${status.data?.displayName ? ` as ${status.data.displayName}` : ''}` : 'Connect Garmin'}>
        {connected
          ? 'Now bring in your history. It runs in the background — carry on whenever you like.'
          : 'Cadence pulls your activities, sleep and HRV, and can send planned workouts to your watch.'}
      </StepHead>
      <AnimatePresence mode="wait" initial={false}>
        {connected ? (
          <motion.div key="on" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring.smooth} className="flex flex-col gap-5">
            <ConnectionSummary status={status.data!} />
            <BackfillPanel defaultMonths="12" />
          </motion.div>
        ) : (
          <motion.div key="off" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8, transition: tween('fast', 'in') }} transition={spring.smooth}>
            <GarminConnectForm demo={demo} today={today} />
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex items-center justify-between gap-3 pt-2">
        <Button variant="ghost" icon={<ArrowLeft />} onClick={onBack}>
          Back
        </Button>
        {connected ? (
          <Button variant="primary" size="lg" iconRight={<ArrowRight />} onClick={onNext}>
            {bf.looping ? 'Continue while it imports' : 'Continue'}
          </Button>
        ) : (
          <Button variant="ghost" onClick={onNext}>
            Skip for now
          </Button>
        )}
      </div>
    </>
  );
}

type Status = NonNullable<ReturnType<typeof useGarminStatus>['data']>;

function ConnectionSummary({ status }: { status: Status }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line-2 bg-surface-1 p-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-accent-a2 text-accent-ink">
        <Watch className="size-5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body text-fg-1">{status.displayName ?? 'Garmin account'}</span>
        <span className="text-body-sm text-fg-3">
          {status.counts.garminActivities > 0 ? `${formatNumber(status.counts.garminActivities)} activities so far` : 'Fetching your latest activities…'}
        </span>
      </div>
      <div className="flex gap-1.5">
        <CapChip on={status.capabilities.read}>Read</CapChip>
        <CapChip on={status.capabilities.write}>Write</CapChip>
      </div>
    </div>
  );
}

function CapChip({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <span className={cn('inline-flex h-6 items-center gap-1 rounded-sm border px-2 text-label', on ? 'border-transparent bg-accent-a2 text-accent-ink' : 'border-dashed border-line-3 text-fg-3')}>
      {on ? <Check className="size-3" strokeWidth={2.5} /> : <span className="text-fg-4">–</span>}
      {children}
    </span>
  );
}

const PHASE_LABEL: Record<string, string> = {
  list: 'Finding activities',
  activities: 'Importing activities',
  wellness: 'Importing sleep & HRV',
  done: 'History imported',
  cancelled: 'Stopped',
  error: 'Stopped with an error',
};

function BackfillPanel({ defaultMonths }: { defaultMonths: (typeof MONTHS)[number]['value'] }) {
  const bf = useBackfill();
  const [months, setMonths] = useState<(typeof MONTHS)[number]['value']>(defaultMonths);
  const p = bf.progress;
  const started = !!p || bf.looping;
  const total = p?.total ?? null;
  const frac = p ? (p.phase === 'done' ? 1 : total ? Math.min(1, p.done / Math.max(1, total)) : 0.04) : 0;
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-line-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-body text-fg-1">History</span>
          <span className="text-body-sm text-fg-3">Fitness needs about six weeks of data to mean something.</span>
        </div>
        {!started && <Segmented aria-label="How far back" size="sm" value={months} onValueChange={setMonths} options={MONTHS} />}
      </div>
      {started ? (
        <div className="flex flex-col gap-3" aria-live="polite">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-label text-fg-2">{p ? PHASE_LABEL[p.phase] ?? p.phase : 'Waiting for the first sync to finish…'}</span>
            <span className="font-mono text-mono text-fg-2">
              {p && total ? `${formatNumber(p.done)} / ${formatNumber(total)}` : p?.phase === 'done' ? '' : '…'}
            </span>
          </div>
          <div className="relative h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)}>
            <motion.div className="absolute inset-0 origin-left rounded-full bg-accent" initial={{ scaleX: 0 }} animate={{ scaleX: frac }} transition={spring.gentle} />
            {bf.looping && <div className="skeleton absolute inset-0 opacity-60" />}
          </div>
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="flex flex-col gap-0.5">
              <span className="text-micro uppercase text-fg-3">Activities imported</span>
              <span className="text-stat-sm text-fg-1">
                <Odometer value={p ? p.created + p.updated : 0} />
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-micro uppercase text-fg-3">Oldest reached</span>
              <span className="text-stat-sm text-fg-1">{p?.oldestDate ? formatDateMedium(p.oldestDate, true) : '—'}</span>
            </div>
          </div>
          {bf.error && <InlineError>{bf.error}</InlineError>}
          {bf.looping && (
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => void cancelBackfill()}>
                Stop import
              </Button>
            </div>
          )}
        </div>
      ) : (
        <Button variant="secondary" icon={<Database />} onClick={() => void startBackfill(Number(months))}>
          Import {MONTHS.find((m) => m.value === months)?.label.replace('mo', 'months').replace('yr', months === '12' ? 'year' : 'years')} of history
        </Button>
      )}
    </div>
  );
}

// ── step 4: thresholds ──
const ONBOARD_KINDS: ThresholdKind[] = ['ftp', 'run_threshold', 'swim_css', 'row_threshold', 'lthr', 'hr_max'];
type Src = 'manual' | 'garmin' | 'estimated' | 'default';

function latest(history: Threshold[], kind: ThresholdKind, today: string): Threshold | undefined {
  return history
    .filter((t) => t.kind === kind && t.effectiveFrom <= today)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || (a.sport === 'all' ? -1 : 1))[0];
}

function StepThresholds({ onBack, onFinish }: { onBack: () => void; onFinish: (home: 'today' | 'calendar') => void }) {
  const units = useUnits();
  const history = useQuery({ queryKey: qk.thresholds.history, queryFn: () => call(api.thresholds.$get()), staleTime: 0 });
  const est = useQuery({ queryKey: qk.trends.of('thresholds'), queryFn: () => call(api.trends.thresholds.$get()), staleTime: 0 });
  const status = useGarminStatus();
  const update = useUpdateSettings();
  const qc = useQueryClient();
  const today = est.data?.today;
  const [values, setValues] = useState<Partial<Record<ThresholdKind, number | null>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initial = useMemo(() => {
    const out = {} as Record<ThresholdKind, { value: number | null; source: Src; basis?: string; existing?: Threshold }>;
    if (!history.data || !today) return null;
    for (const k of ONBOARD_KINDS) {
      const ex = latest(history.data, k, today);
      const sug = est.data?.suggestions.find((s) => s.kind === k);
      if (ex) out[k] = { value: ex.value, source: ex.source, existing: ex };
      else if (sug) out[k] = { value: sug.value, source: 'estimated', basis: sug.basis };
      else out[k] = { value: null, source: 'default' };
    }
    return out;
  }, [history.data, est.data, today]);

  const valueOf = (k: ThresholdKind) => (k in values ? values[k] ?? null : initial?.[k].value ?? null);

  const finish = async (skip: boolean) => {
    if (!initial || !today) return;
    setSaving(true);
    setError(null);
    try {
      if (!skip) {
        const from = status.data?.backfillProgress?.sinceDate ?? status.data?.counts.oldestGarminDate ?? today;
        const effectiveFrom = from > today ? today : from;
        const writes = ONBOARD_KINDS.flatMap((k) => {
          const v = valueOf(k);
          const init = initial[k];
          if (v == null) return [];
          const same = init.value != null && Math.abs(init.value - v) < 1e-6;
          // Garmin values land dated "today"; re-date them so the imported history uses them too.
          if (same && init.existing && init.existing.effectiveFrom <= effectiveFrom) return [];
          const source = same ? (init.existing?.source ?? 'estimated') : 'manual';
          const sport = init.existing?.sport ?? THRESHOLD_META[k].sport;
          return [call(api.thresholds.$post({ json: { kind: k, sport, value: v, effectiveFrom, source } }))];
        });
        await Promise.all(writes);
        void qc.invalidateQueries({ queryKey: qk.thresholds.all });
      }
      const s = await update.mutateAsync({ onboarded: true });
      onFinish(s.homeRoute);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <>
      <StepHead eyebrow="Step 4 of 4" title="Your thresholds">
        They turn every session into load and zones. Prefilled from Garmin or your recent bests where we could.
      </StepHead>
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
        {ONBOARD_KINDS.map((k, i) => {
          const meta = THRESHOLD_META[k];
          const init = initial?.[k];
          const v = valueOf(k);
          const edited = k in values && values[k] !== init?.value;
          const src: Src = edited ? 'manual' : init?.source ?? 'default';
          return (
            <motion.div key={k} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.smooth, delay: Math.min(i * 0.035, 0.24) }} className="flex flex-col gap-1">
              {initial ? (
                <BigThresholdInput
                  meta={meta}
                  units={units}
                  value={v}
                  onCommit={(nv) => setValues((s) => ({ ...s, [k]: nv }))}
                  label={meta.label}
                  aside={v != null ? <SourceChip source={src} /> : <SourceChip source="default" />}
                />
              ) : (
                <div className="flex flex-col gap-2">
                  <span className="h-3.5 w-24 rounded-xs bg-surface-2" />
                  <span className="h-9 w-32 rounded-sm bg-surface-2" />
                </div>
              )}
              <span className="text-body-sm text-fg-3">
                {initial && v == null ? `${meta.explain.split('.')[0]}. Skipped: ${meta.fallback.charAt(0).toLowerCase() + meta.fallback.slice(1)}.` : init?.basis && !edited ? `Estimated from your ${init.basis}.` : init?.source === 'garmin' && !edited ? `${meta.explain} From your Garmin profile.` : meta.explain}
              </span>
            </motion.div>
          );
        })}
      </div>
      <p className="text-body-sm text-fg-3">Applied to your whole history. Add dated changes any time in Settings → Zones.</p>
      {error && <InlineError>{error}</InlineError>}
      <div className="flex items-center justify-between gap-3 pt-2">
        <Button variant="ghost" icon={<ArrowLeft />} onClick={onBack} disabled={saving}>
          Back
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => void finish(true)} disabled={saving || !initial}>
            Use defaults
          </Button>
          <Button variant="primary" size="lg" iconRight={<ArrowRight />} loading={saving} disabled={!initial} onClick={() => void finish(false)}>
            Finish
          </Button>
        </div>
      </div>
    </>
  );
}

function Finale() {
  const { data: s } = useQuery(settingsQuery);
  return (
    <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={spring.smooth} className="flex flex-col items-start gap-5 pt-6">
      <span className="flex size-14 items-center justify-center rounded-full bg-accent text-on-accent">
        <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <motion.path d="M5 12.5 10 17l9-10" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ ...spring.smooth, delay: 0.1 }} />
        </svg>
      </span>
      <h1 data-page-title tabIndex={-1} className="text-title-1 text-fg-1 outline-none">
        You're set{s?.name ? `, ${s.name}` : ''}.
      </h1>
      <p className="text-body-lg text-fg-2">Opening your calendar…</p>
    </motion.div>
  );
}

// ───────────────────────────── live preview (desktop) ─────────────────────────────

function Preview({ step }: { step: number }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line-2 bg-surface-1">
      <div className="absolute inset-0 bg-dots-fg opacity-[0.18]" />
      <div className="relative min-h-[460px] p-8">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={Math.min(step, 4)} initial={{ opacity: 0, y: 10, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, transition: tween('fast', 'in') }} transition={spring.smooth}>
            {step === 0 && <PreviewPrivacy />}
            {step === 1 && <PreviewWeek />}
            {step === 2 && <PreviewGarmin />}
            {step >= 3 && <PreviewZones />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function PreviewTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-8 flex flex-col gap-1.5">
      <span className="text-micro uppercase text-fg-3">{eyebrow}</span>
      <span className="text-title-2 text-fg-1">{title}</span>
    </div>
  );
}

function PreviewPrivacy() {
  const rows = [
    { icon: <Lock />, t: 'One athlete, one passphrase', d: 'No accounts, no sign-up, no one else.' },
    { icon: <Database />, t: 'Your database', d: 'Everything lives in your own Cloudflare D1. Export it whole, any time.' },
    { icon: <ShieldCheck />, t: 'Encrypted credentials', d: 'Garmin keys are sealed with AES-GCM before they touch the disk.' },
  ];
  return (
    <>
      <PreviewTitle eyebrow="Private by design" title="Built for exactly one person." />
      <ul className="flex flex-col gap-6">
        {rows.map((r, i) => (
          <motion.li key={r.t} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ ...spring.smooth, delay: 0.08 + i * 0.05 }} className="flex gap-4">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-line-2 bg-surface-2 text-fg-2 [&_svg]:size-4">{r.icon}</span>
            <div className="flex flex-col gap-0.5">
              <span className="text-body text-fg-1">{r.t}</span>
              <span className="text-body-sm text-fg-3">{r.d}</span>
            </div>
          </motion.li>
        ))}
      </ul>
    </>
  );
}

const WEEK = [
  { sport: 'Swim', title: 'CSS repeats', min: 50, m: 2800, load: 52 },
  { sport: 'Ride', title: 'Threshold 3×12', min: 75, m: 38000, load: 96 },
  { sport: 'Run', title: 'Easy aerobic', min: 45, m: 8600, load: 41 },
  { sport: 'Rest', title: '', min: 0, m: 0, load: 0 },
  { sport: 'Run', title: 'Tempo 2×20', min: 60, m: 12400, load: 78 },
  { sport: 'Ride', title: 'Long endurance', min: 180, m: 86000, load: 152 },
  { sport: 'Run', title: 'Long run', min: 95, m: 18000, load: 104 },
];

function PreviewWeek() {
  const { data: s } = useQuery(settingsQuery);
  const units = useUnits();
  const sunday = s?.weekStart === 'sunday';
  const days = sunday ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const items = sunday ? [WEEK[6], ...WEEK.slice(0, 6)] : WEEK;
  const dist = (m: number, sport: string) => {
    if (sport === 'Swim') return units.system === 'imperial' ? `${formatNumber(m / 0.9144)} yd` : `${formatNumber(m)} m`;
    return units.system === 'imperial' ? `${(m / 1609.344).toFixed(1)} mi` : `${(m / 1000).toFixed(1)} km`;
  };
  return (
    <>
      <PreviewTitle eyebrow="This is how a week reads" title={s?.name ? `${s.name}'s week` : 'Your week'} />
      <LayoutGroup>
        <ul className="flex flex-col">
          {items.map((w, i) => (
            <motion.li layout transition={spring.smooth} key={w.sport + w.title + i} className="flex h-12 items-center gap-4 border-b border-line-1 last:border-b-0">
              <span className="w-10 font-mono text-mono text-fg-3">{days[i]}</span>
              {w.load ? (
                <>
                  <span className="w-12 text-micro uppercase text-fg-3">{w.sport}</span>
                  <span className="min-w-0 flex-1 truncate text-body text-fg-1">{w.title}</span>
                  <span className="w-20 text-right font-mono text-mono text-fg-2">{dist(w.m, w.sport)}</span>
                  <span className="w-10 text-right font-mono text-mono text-accent-ink">{w.load}</span>
                </>
              ) : (
                <span className="text-body-sm text-fg-4">Rest day</span>
              )}
            </motion.li>
          ))}
        </ul>
      </LayoutGroup>
      <div className="mt-6 flex items-baseline gap-2 text-body-sm text-fg-3">
        Threshold pace example:
        <span className="font-mono text-mono text-fg-1">
          {paceParts(1000 / 270, 'run', units).value} {paceParts(1000 / 270, 'run', units).unit}
        </span>
      </div>
    </>
  );
}

function PreviewGarmin() {
  const bf = useBackfill();
  const status = useGarminStatus().data;
  const p = bf.progress;
  const matrix: [string, boolean, boolean][] = [
    ['Activities & FIT files', true, true],
    ['Sleep, HRV, resting HR', true, true],
    ['FTP, LTHR from Garmin', false, true],
    ['Send workouts to watch', false, true],
  ];
  return (
    <>
      <PreviewTitle eyebrow="Garmin" title={p ? (p.running ? 'Importing your history' : 'History imported') : status?.connected ? 'Your training, arriving.' : 'Two keys, two powers.'} />
      {p || status?.connected ? (
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-1">
            <span className="text-micro uppercase text-fg-3">Activities in Cadence</span>
            <span className="text-stat-xl text-fg-1">
              <Odometer value={Math.max(status?.counts.activities ?? 0, p ? p.created + p.updated : 0)} />
            </span>
          </div>
          {p?.oldestDate && (
            <div className="flex flex-col gap-1">
              <span className="text-micro uppercase text-fg-3">Back to</span>
              <span className="text-stat-md text-fg-1">{formatDateMedium(p.oldestDate, true)}</span>
            </div>
          )}
        </div>
      ) : (
        <table className="w-full text-body">
          <thead>
            <tr className="text-micro uppercase text-fg-3">
              <th className="pb-3 text-left font-[600]" />
              <th className="pb-3 text-center font-[600]">API key</th>
              <th className="pb-3 text-center font-[600]">Tokens</th>
            </tr>
          </thead>
          <tbody>
            {matrix.map(([label, a, b]) => (
              <tr key={label} className="border-t border-line-1">
                <td className="py-3 text-fg-2">{label}</td>
                {[a, b].map((v, i) => (
                  <td key={i} className="py-3 text-center">
                    {v ? <Check className="mx-auto size-4 text-accent-ink" strokeWidth={2.25} /> : <span className="text-fg-4">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

const COGGAN = [
  { z: 'Z1', name: 'Recovery', lo: 0, hi: 0.55 },
  { z: 'Z2', name: 'Endurance', lo: 0.55, hi: 0.75 },
  { z: 'Z3', name: 'Tempo', lo: 0.75, hi: 0.9 },
  { z: 'Z4', name: 'Threshold', lo: 0.9, hi: 1.05 },
  { z: 'Z5', name: 'VO2max', lo: 1.05, hi: 1.2 },
  { z: 'Z6', name: 'Anaerobic', lo: 1.2, hi: 1.5 },
];

function PreviewZones() {
  const { data } = useQuery({ queryKey: qk.thresholds.history, queryFn: () => call(api.thresholds.$get()) });
  const ftp = data?.filter((t) => t.kind === 'ftp').sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]?.value ?? 250;
  const units: UnitPrefs = useUnits();
  return (
    <>
      <PreviewTitle eyebrow="Zones follow your thresholds" title="Every session, scored the same way." />
      <div className="flex flex-col gap-2.5">
        {COGGAN.map((z, i) => (
          <div key={z.z} className="flex items-center gap-3">
            <span className="w-7 font-mono text-mono text-fg-3">{z.z}</span>
            <div className="relative h-6 flex-1 overflow-hidden rounded-xs bg-surface-2">
              <motion.div
                className={cn('absolute inset-y-0 left-0 origin-left rounded-xs', `bg-z${i + 1}`)}
                style={{ width: `${(z.hi / 1.5) * 100}%` }}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ ...spring.gentle, delay: 0.05 + i * 0.035 }}
              />
              <span className="absolute inset-y-0 left-2 flex items-center text-label text-fg-1">{z.name}</span>
            </div>
            <span className="w-24 text-right font-mono text-mono text-fg-2">
              {i === COGGAN.length - 1 ? `${Math.round(ftp * z.lo)}+` : `${Math.round(ftp * z.lo)}–${Math.round(ftp * z.hi) - 1}`} {thresholdUnit(THRESHOLD_META.ftp, units)}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

// ───────────────────────────── login ─────────────────────────────

const loginRoute = getRouteApi('/_bare/login');

function safeRedirect(r: string | undefined): string | null {
  if (!r) return null;
  try {
    const u = new URL(r, window.location.origin);
    if (u.origin !== window.location.origin || u.pathname.startsWith('/login') || u.pathname.startsWith('/welcome')) return null;
    return u.pathname + u.search + u.hash;
  } catch {
    return null;
  }
}

export function LoginPage() {
  const { redirect } = loginRoute.useSearch();
  const auth = useAuthStatus();
  const login = useLogin();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const reduce = useReducedMotionPref();
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [wrong, setWrong] = useState(false);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [leaving, setLeaving] = useState(false);

  const target = safeRedirect(redirect);
  const goIn = () => {
    setLeaving(true);
    if (target) void navigate({ href: target, replace: true });
    else void navigate({ to: '/', replace: true });
  };

  useEffect(() => {
    document.title = 'Sign in · cadence';
  }, []);
  useEffect(() => {
    if (!auth.data || leaving) return;
    if (!auth.data.configured) void navigate({ to: '/welcome', replace: true });
    else if (auth.data.authenticated) goIn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.data]);
  useEffect(() => {
    if (lockedUntil <= Date.now()) return;
    const t = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= lockedUntil) clearInterval(t);
    }, 250);
    return () => clearInterval(t);
  }, [lockedUntil]);

  const secondsLeft = Math.max(0, Math.ceil((lockedUntil - now) / 1000));
  const locked = secondsLeft > 0;

  const submit = () => {
    if (!value || login.isPending || locked) return;
    setWrong(false);
    login.mutate(value, {
      onSuccess: () => {
        const prev = qc.getQueryData(authQuery.queryKey);
        qc.setQueryData(authQuery.queryKey, { configured: true, authenticated: true, demo: prev?.demo ?? false });
        goIn();
      },
      onError: (e) => {
        if (e instanceof ApiError && e.status === 429) {
          const s = Number(/(\d+)\s*s/.exec(e.message)?.[1] ?? 30);
          setLockedUntil(Date.now() + s * 1000);
          setNow(Date.now());
          return;
        }
        if (e instanceof ApiError && e.status === 401) {
          setWrong(true);
          setValue('');
          if (!reduce && scope.current) void animate(scope.current, { x: [0, -10, 9, -6, 4, -2, 0] }, { duration: dur.slow, ease: 'easeOut' });
          requestAnimationFrame(() => inputRef.current?.focus());
        }
      },
    });
  };

  if (!auth.data || auth.data.authenticated || !auth.data.configured) return <Splash />;

  return (
    <BareFrame right={auth.data.demo ? <span className="font-mono text-mono-sm text-fg-4">demo · cadence-demo</span> : undefined}>
      <div className="flex flex-1 items-center justify-center px-5 pb-16">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring.smooth} className="flex w-full max-w-[22rem] flex-col gap-8">
          <div className="flex flex-col gap-2">
            <span className="text-micro uppercase text-fg-3">Welcome back</span>
            <h1 data-page-title tabIndex={-1} className="text-title-1 text-fg-1 outline-none">
              Unlock Cadence
            </h1>
          </div>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <label htmlFor="login-pp" className="text-label text-fg-2">
              Passphrase
            </label>
            <div ref={scope}>
              <PassphraseInput id="login-pp" inputRef={inputRef} value={value} onChange={(v) => (setValue(v), setWrong(false))} autoComplete="current-password" autoFocus invalid={wrong} disabled={locked} aria-describedby="login-msg" />
            </div>
            <div id="login-msg" className="min-h-5 text-body-sm" aria-live="polite">
              <AnimatePresence mode="wait" initial={false}>
                {locked ? (
                  <motion.span key="lock" initial={{ opacity: 0, y: -3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-1.5 text-fg-1">
                    <Lock className="size-3.5" /> Too many attempts. Try again in <span className="font-mono text-mono tabular-nums">{secondsLeft}s</span>
                  </motion.span>
                ) : wrong ? (
                  <motion.span key="wrong" initial={{ opacity: 0, y: -3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-1.5 text-fg-1">
                    <TriangleAlert className="size-3.5" /> That's not it. Try again.
                  </motion.span>
                ) : login.isError && !(login.error instanceof ApiError && [401, 429].includes(login.error.status)) ? (
                  <motion.span key="err" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-fg-1">
                    {login.error.message}
                  </motion.span>
                ) : null}
              </AnimatePresence>
            </div>
            <Button type="submit" variant="primary" size="lg" loading={login.isPending || leaving} disabled={!value || locked} iconRight={<ArrowRight />}>
              Continue
            </Button>
          </form>
        </motion.div>
      </div>
    </BareFrame>
  );
}
