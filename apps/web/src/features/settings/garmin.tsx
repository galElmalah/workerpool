/**
 * Garmin connect form + "how to get this" guide (packages/garmin/README.md, condensed).
 * Shared by onboarding and Settings → Garmin (an identical copy lives in each feature folder).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { addDays } from '@cadence/core/time';
import { Check, ChevronDown, Copy, ExternalLink, KeyRound, TriangleAlert, Watch } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { api, call } from '@/lib/api';
import { cn } from '@/lib/cn';
import { localToday } from '@/lib/hooks';
import { qk } from '@/lib/query';
import { spring, tween } from '@/motion/tokens';
import { Button } from '@/ui/Button';
import { Field, Input, Textarea } from '@/ui/Field';
import { Segmented } from '@/ui/Segmented';

export const GARMIN_TOKEN_URL = 'https://connect.garmin.com/app/settings/personalApiToken';

export const TOKENS_SNIPPET = `python3 -m venv gc && . gc/bin/activate
pip install "garminconnect>=0.3.20" curl_cffi
python3 - <<'EOF'
from getpass import getpass
from garminconnect import Garmin
g = Garmin(input("email: "), getpass("password: "),
           prompt_mfa=lambda: input("MFA code: "))
g.login("./gc_tokens")
print(open("./gc_tokens/garmin_tokens.json").read())
EOF`;

const connect = (json: { apiKey?: string; keyExpiresOn?: string; tokensJson?: string; demo?: boolean }) => call(api.garmin.connect.$post({ json }));
export type ConnectResponse = Awaited<ReturnType<typeof connect>>;

export function useConnectGarmin(onConnected?: (r: ConnectResponse) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: connect,
    onSuccess: (r) => {
      qc.setQueryData(qk.garmin.status, r);
      void qc.invalidateQueries({ queryKey: qk.garmin.log() });
      onConnected?.(r);
    },
  });
}

/** Collapsible disclosure with a rotating chevron and a height-free reveal (opacity + y). */
export function Disclosure({ title, icon, children, defaultOpen = false, className }: { title: ReactNode; icon?: ReactNode; children: ReactNode; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cn('rounded-md border border-line-2', className)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 rounded-md px-3.5 py-2.5 text-left text-body text-fg-1 transition-colors duration-(--dur-fast) hover:bg-surface-2"
      >
        {icon && <span className="flex text-fg-3 [&_svg]:size-4">{icon}</span>}
        <span className="flex-1">{title}</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={spring.snappy} className="flex text-fg-3">
          <ChevronDown className="size-4" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto', transition: spring.smooth }}
            exit={{ opacity: 0, height: 0, transition: tween('fast', 'in') }}
            className="overflow-hidden"
          >
            <div className="border-t border-line-1 px-3.5 pb-3.5 pt-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        });
      }}
      className="absolute right-2 top-2 inline-flex h-7 items-center gap-1.5 rounded-sm border border-line-2 bg-surface-2 px-2 text-label text-fg-2 hover:text-fg-1"
    >
      {done ? <Check className="size-3.5 text-accent-ink" /> : <Copy className="size-3.5" />}
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

export function KeyGuide() {
  return (
    <ol className="flex flex-col gap-2.5 text-body text-fg-2">
      {[
        <>
          Open Garmin Connect →{' '}
          <a href={GARMIN_TOKEN_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-fg-1 underline decoration-line-3 underline-offset-3 hover:decoration-fg-1">
            Settings → Personal API Token <ExternalLink className="size-3" />
          </a>
        </>,
        <>Create a key and pick its lifetime (30–365 days). It is shown once — copy it.</>,
        <>Paste it here. Cadence reads your activities, sleep, HRV and weight with it — nothing else.</>,
      ].map((step, i) => (
        <li key={i} className="flex gap-3">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-line-3 font-mono text-mono-sm text-fg-2">{i + 1}</span>
          <span>{step}</span>
        </li>
      ))}
    </ol>
  );
}

export function TokensGuide() {
  return (
    <div className="flex flex-col gap-2.5 text-body-sm text-fg-2">
      <p>
        Garmin only lets workouts be <span className="text-fg-1">sent to your watch</span> through its unofficial Connect API, and it blocks sign-ins from servers.
        Sign in once on your own computer and paste the token file it prints:
      </p>
      <div className="relative">
        <pre className="overflow-x-auto rounded-md border border-line-2 bg-surface-1 p-3 pr-20 font-mono text-mono-sm leading-5 text-fg-2">{TOKENS_SNIPPET}</pre>
        <CopyButton text={TOKENS_SNIPPET} />
      </div>
      <p>The tokens are encrypted at rest and refreshed automatically. Disconnecting deletes them.</p>
    </div>
  );
}

const LIFETIMES = [
  { value: '30', label: '30 d' },
  { value: '90', label: '90 d' },
  { value: '180', label: '180 d' },
  { value: '365', label: '1 yr' },
] as const;

/** Personal API key (+ optional tokens JSON) form. `demo` adds the one-click demo account. */
export function GarminConnectForm({
  demo,
  onConnected,
  today,
  submitLabel = 'Connect Garmin',
  primary = true,
  showGuide = true,
}: {
  demo: boolean;
  onConnected?: (r: ConnectResponse) => void;
  today?: string;
  submitLabel?: string;
  primary?: boolean;
  showGuide?: boolean;
}) {
  const [apiKey, setApiKey] = useState('');
  const [lifetime, setLifetime] = useState<(typeof LIFETIMES)[number]['value']>('365');
  const [tokens, setTokens] = useState('');
  const m = useConnectGarmin(onConnected);
  const pending = m.isPending;
  const submit = () => {
    if (!apiKey.trim() && !tokens.trim()) return;
    const base = today ?? localToday();
    m.mutate({
      ...(apiKey.trim() ? { apiKey: apiKey.trim(), keyExpiresOn: addDays(base, Number(lifetime)) } : {}),
      ...(tokens.trim() ? { tokensJson: tokens.trim() } : {}),
    });
  };
  return (
    <div className="flex flex-col gap-4">
      {demo && (
        <div className="flex flex-col gap-3 rounded-lg border border-line-2 bg-surface-1 p-4">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent-a2 text-accent-ink">
              <Watch className="size-4.5" />
            </span>
            <div className="flex flex-col gap-0.5">
              <span className="text-body text-fg-1">Demo mode is on</span>
              <span className="text-body-sm text-fg-3">A simulated Garmin account with a year of a triathlete's training. Nothing leaves this machine.</span>
            </div>
          </div>
          <Button variant={primary ? 'primary' : 'secondary'} size="lg" loading={pending && !!m.variables?.demo} disabled={pending} onClick={() => m.mutate({ demo: true })}>
            Use the demo Garmin account
          </Button>
        </div>
      )}
      {demo && (
        <div role="separator" className="flex items-center gap-3 text-micro uppercase text-fg-4">
          <span className="h-px flex-1 bg-line-1" />
          or connect your own
          <span className="h-px flex-1 bg-line-1" />
        </div>
      )}
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Personal API key" aside={<span className="text-fg-4">read access</span>}>
          <Input
            value={apiKey}
            onChange={(e) => setApiKey(e.currentTarget.value)}
            placeholder="Paste the key from Garmin Connect"
            autoComplete="off"
            spellCheck={false}
            leading={<KeyRound />}
            className="font-mono text-mono"
          />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-label text-fg-2">Key lifetime you chose</span>
          <Segmented aria-label="Key lifetime" size="sm" value={lifetime} onValueChange={setLifetime} options={LIFETIMES} />
        </div>
        {showGuide && (
          <Disclosure title="How do I get a key?" icon={<KeyRound />}>
            <KeyGuide />
          </Disclosure>
        )}
        <Disclosure title="Also send workouts to my watch (optional)" icon={<Watch />}>
          <div className="flex flex-col gap-3">
            <TokensGuide />
            <Field label="garmin_tokens.json">
              <Textarea
                value={tokens}
                onChange={(e) => setTokens(e.currentTarget.value)}
                placeholder='{"di_token": "…", "di_refresh_token": "…", "di_client_id": "…"}'
                minRows={3}
                maxRows={8}
                spellCheck={false}
                className="font-mono text-mono-sm"
              />
            </Field>
          </div>
        </Disclosure>
        <AnimatePresence initial={false}>
          {m.isError && (
            <motion.p
              key="err"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-start gap-2 rounded-md border border-dashed border-line-3 px-3 py-2 text-body-sm text-fg-1"
              role="alert"
            >
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              {(m.error as Error).message}
            </motion.p>
          )}
        </AnimatePresence>
        <Button
          type="submit"
          variant={primary && !demo ? 'primary' : 'secondary'}
          size={demo ? 'md' : 'lg'}
          loading={pending && !m.variables?.demo}
          disabled={pending || (!apiKey.trim() && !tokens.trim())}
        >
          {submitLabel}
        </Button>
      </form>
    </div>
  );
}
