import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FastForward, FileJson, FileSpreadsheet, FlaskConical, RotateCcw, Sprout, Upload } from 'lucide-react';
import { motion } from 'motion/react';
import { useRef, useState } from 'react';
import { api, call, raw } from '@/lib/api';
import { formatDateMedium, formatNumber } from '@/lib/format';
import { qk } from '@/lib/query';
import { useAuthStatus } from '@/lib/queries/shared';
import { spring } from '@/motion/tokens';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Section } from '@/ui/Section';
import { toast } from '@/ui/toast';
import { InlineError, Row, Rows, TwoStepButton } from './common';

async function download(path: string, fallback: string) {
  const res = await raw(path);
  const blob = await res.blob();
  const name = /filename="?([^";]+)"?/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallback;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

export function SettingsDataPage() {
  const auth = useAuthStatus();
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const run = async (id: string, fn: () => Promise<string>) => {
    setBusy(id);
    try {
      const name = await fn();
      toast.success(<>Saved <b>{name}</b></>);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const importBackup = async (f: File) => {
    setImportError(null);
    setBusy('import');
    try {
      const json = JSON.parse(await f.text()) as unknown;
      const r = await call(api.import.json.$post({ json: json as never }));
      const n = Object.values((r as { imported: Record<string, number> }).imported).reduce((a, b) => a + b, 0);
      toast.success(`Imported ${formatNumber(n)} rows`);
      await qc.invalidateQueries();
    } catch (e) {
      setImportError(e instanceof SyntaxError ? 'That file is not valid JSON.' : (e as Error).message);
    } finally {
      setBusy(null);
      if (file.current) file.current.value = '';
    }
  };

  return (
    <>
      <Section title="Export" description="Your data, whole, in open formats.">
        <Card spotlight={false}>
          <Rows>
            <Row title="Full backup" description="Every plan, activity summary, note, threshold and setting as JSON. Restores into an empty Cadence.">
              <Button icon={<FileJson />} loading={busy === 'json'} onClick={() => void run('json', () => download('/export/json', 'cadence-backup.json'))}>
                Download JSON
              </Button>
            </Row>
            <Row title="Planned workouts" description="One row per planned workout with date, sport, duration, load and its text structure.">
              <Button icon={<FileSpreadsheet />} loading={busy === 'csv'} onClick={() => void run('csv', () => download('/export/workouts.csv', 'cadence-workouts.csv'))}>
                Download CSV
              </Button>
            </Row>
          </Rows>
        </Card>
      </Section>

      <Section title="Import">
        <Card spotlight={false}>
          <Rows>
            <Row title="Restore a backup" description="Cadence JSON backups only. The instance must be empty of training data: import never merges or overwrites.">
              <input ref={file} type="file" accept="application/json,.json" className="sr-only" onChange={(e) => e.currentTarget.files?.[0] && void importBackup(e.currentTarget.files[0])} aria-label="Backup file" />
              <Button icon={<Upload />} loading={busy === 'import'} onClick={() => file.current?.click()}>
                Choose file…
              </Button>
            </Row>
          </Rows>
          {importError && (
            <div className="pt-3">
              <InlineError>{importError}</InlineError>
            </div>
          )}
        </Card>
      </Section>

      {auth.data?.demo && <DemoCard />}
    </>
  );
}

function DemoCard() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['demo', 'status'], queryFn: () => call(api.demo.status.$get()), refetchInterval: (q) => (q.state.data?.job && !q.state.data.job.finished ? 2000 : false) });
  const [seeding, setSeeding] = useState(false);
  const refreshAll = () => qc.invalidateQueries();
  const reset = useMutation({ mutationFn: () => call(api.demo.reset.$post()), onSuccess: () => (toast('Demo data cleared. Your passphrase is kept.'), refreshAll()) });
  const advance = useMutation({
    mutationFn: async () => {
      const r = await call(api.demo.advance.$post({ json: { days: 1 } }));
      const s = await call(api.garmin.sync.$post()).catch(() => null);
      return { r, s };
    },
    onSuccess: ({ r, s }) => {
      toast.success(<>Now <b>{formatDateMedium(r.today, true)}</b>{s ? ` · ${s.summary || 'synced'}` : ''}</>);
      void refreshAll();
    },
    onError: (e) => toast.error(e.message),
  });
  const reseed = async () => {
    setSeeding(true);
    try {
      let p = await call(api.demo.seed.$post({ json: {} } as never));
      void status.refetch();
      for (let i = 0; i < 2000 && !p.finished; i++) {
        p = await call(api.demo.seed.step.$post({ json: {} } as never));
        qc.setQueryData(['demo', 'status'], (prev: typeof status.data) => (prev ? { ...prev, job: p } : prev));
      }
      toast.success('Demo athlete reseeded');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSeeding(false);
      void refreshAll();
    }
  };
  const d = status.data;
  const job = d?.job;
  const frac = job ? (job.finished ? 1 : job.total ? job.done / job.total : 0.03) : 0;
  return (
    <Section title="Demo data" description="Demo mode is on: Garmin is simulated in-process and nothing leaves this machine.">
      <Card spotlight={false}>
        <div className="flex flex-col gap-5">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-dashed border-line-3 text-fg-2">
              <FlaskConical className="size-4" />
            </span>
            <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                ['Activities', d?.counts.activities],
                ['Planned', d?.counts.workouts],
                ['Wellness days', d?.counts.wellness],
                ['Demo today', d?.today ? formatDateMedium(d.today) : undefined],
              ].map(([l, v]) => (
                <div key={l as string} className="flex flex-col gap-0.5">
                  <span className="text-micro uppercase text-fg-3">{l}</span>
                  <span className="text-stat-sm text-fg-1">{v == null ? '—' : typeof v === 'number' ? formatNumber(v) : v}</span>
                </div>
              ))}
            </div>
          </div>
          {(seeding || (job && !job.finished)) && job && (
            <div className="flex flex-col gap-2" aria-live="polite">
              <div className="flex justify-between text-label text-fg-2">
                <span>Seeding · {job.phase}</span>
                <span className="font-mono text-mono">
                  {formatNumber(job.done)} / {formatNumber(job.total)}
                </span>
              </div>
              <div className="relative h-1.5 overflow-hidden rounded-full bg-surface-3">
                <motion.div className="absolute inset-0 origin-left rounded-full bg-accent" initial={false} animate={{ scaleX: frac }} transition={spring.gentle} />
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 border-t border-line-1 pt-4">
            <Button icon={<FastForward />} loading={advance.isPending} disabled={seeding} onClick={() => advance.mutate()}>
              Advance one day
            </Button>
            <span className="text-body-sm text-fg-3">Moves the demo clock forward and syncs, so a new activity arrives.</span>
            <span className="flex-1" />
            <TwoStepButton label="Reseed" confirmLabel="Confirm reseed" icon={<Sprout />} loading={seeding} onConfirm={() => void reseed()} />
            <TwoStepButton label="Reset" confirmLabel="Erase all data" icon={<RotateCcw />} loading={reset.isPending} disabled={seeding} onConfirm={() => reset.mutate()} />
          </div>
        </div>
      </Card>
      <p className="mt-3 flex items-center gap-1.5 text-body-sm text-fg-3">
        <Download className="size-3.5" /> Export a backup first if you want to keep what you changed.
      </p>
    </Section>
  );
}
