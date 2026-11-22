import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Threshold, ThresholdKind } from '@cadence/core/domain';
import { HeartPulse, Trash2, Wand2 } from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { api, call } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateMedium, paceParts } from '@/lib/format';
import { invalidateTraining, qk } from '@/lib/query';
import { useUnits, type UnitPrefs } from '@/lib/units';
import { spring, tween } from '@/motion/tokens';
import { Button, IconButton } from '@/ui/Button';
import { DatePicker } from '@/ui/DatePicker';
import { SaveIndicator, type SaveStatus } from '@/ui/SaveIndicator';
import { Section } from '@/ui/Section';
import { Skeleton } from '@/ui/Skeleton';
import { SportGlyph } from '@/ui/domain';
import { toast } from '@/ui/toast';
import { InlineError, useApiToday } from './common';
import { BigThresholdInput, SourceChip, THRESHOLD_META, thresholdText, thresholdUnit } from './kit';


type ZoneSport = 'bike' | 'run' | 'swim' | 'row' | 'other';
type Entry = { kind: ThresholdKind; sport: Threshold['sport'] };
const TABS: { id: ZoneSport; label: string; entries: Entry[]; glyph?: 'bike' | 'run' | 'swim' | 'row' }[] = [
  { id: 'bike', label: 'Bike', glyph: 'bike', entries: [{ kind: 'ftp', sport: 'bike' }, { kind: 'lthr', sport: 'bike' }] },
  { id: 'run', label: 'Run', glyph: 'run', entries: [{ kind: 'run_threshold', sport: 'run' }, { kind: 'lthr', sport: 'run' }] },
  { id: 'swim', label: 'Swim', glyph: 'swim', entries: [{ kind: 'swim_css', sport: 'swim' }] },
  { id: 'row', label: 'Row', glyph: 'row', entries: [{ kind: 'row_threshold', sport: 'row' }] },
  {
    id: 'other',
    label: 'Heart rate',
    entries: [
      { kind: 'lthr', sport: 'all' },
      { kind: 'hr_max', sport: 'all' },
      { kind: 'hr_rest', sport: 'all' },
    ],
  },
];

const historyQuery = { queryKey: qk.thresholds.history, queryFn: () => call(api.thresholds.$get()) };

/** Latest entry ≤ date for (kind, sport), falling back to sport 'all' for per-sport HR kinds. */
function resolve(list: Threshold[], e: Entry, date: string): Threshold | undefined {
  const pick = (sport: Threshold['sport']) =>
    list.filter((t) => t.kind === e.kind && t.sport === sport && t.effectiveFrom <= date).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  return pick(e.sport) ?? (e.sport !== 'all' ? pick('all') : undefined);
}

export function SettingsZonesPage() {
  const today = useApiToday();
  const [tab, setTab] = useState<ZoneSport>('bike');
  const [from, setFrom] = useState<string | null>(null);
  const units = useUnits();
  const qc = useQueryClient();
  const history = useQuery(historyQuery);
  const effective = from ?? today ?? '';
  const zones = useQuery({ queryKey: qk.thresholds.zones(today), queryFn: () => call(api.zones.$get({ query: today ? { date: today } : {} })), enabled: !!today });
  const est = useQuery({ queryKey: qk.trends.of('thresholds'), queryFn: () => call(api.trends.thresholds.$get()) });
  const [status, setStatus] = useState<SaveStatus>('idle');

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: qk.thresholds.all }), qc.invalidateQueries({ queryKey: qk.trends.of('thresholds') })]).then(() => invalidateTraining());

  const add = useMutation({
    mutationFn: (t: Omit<Threshold, 'id'>) => call(api.thresholds.$post({ json: t })),
    onMutate: async (t) => {
      setStatus('saving');
      await qc.cancelQueries({ queryKey: qk.thresholds.history });
      const prev = qc.getQueryData<Threshold[]>(qk.thresholds.history);
      if (prev) qc.setQueryData<Threshold[]>(qk.thresholds.history, [...prev, { ...t, id: `tmp_${Date.now()}` }]);
      return { prev };
    },
    onError: (e, _t, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.thresholds.history, ctx.prev);
      setStatus('error');
      toast.error(e.message);
    },
    onSuccess: () => {
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2400);
    },
    onSettled: refresh,
  });
  const del = useMutation({
    mutationFn: (id: string) => call(api.thresholds[':id'].$delete({ param: { id } })),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.thresholds.history });
      const prev = qc.getQueryData<Threshold[]>(qk.thresholds.history);
      if (prev) qc.setQueryData<Threshold[]>(qk.thresholds.history, prev.filter((t) => t.id !== id));
      return { prev };
    },
    onError: (e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.thresholds.history, ctx.prev);
      toast.error(e.message);
    },
    onSettled: refresh,
  });

  const def = TABS.find((t) => t.id === tab)!;
  const list = history.data ?? [];
  const save = (e: Entry, v: number | null) => {
    if (v == null || !effective) return;
    const cur = resolve(list, e, effective);
    if (cur && Math.abs(cur.value - v) < 1e-6) return;
    add.mutate({ kind: e.kind, sport: e.sport, value: v, effectiveFrom: effective, source: 'manual' }, {
      onSuccess: () => toast(<>
        <b>{THRESHOLD_META[e.kind].label}</b> {thresholdText(THRESHOLD_META[e.kind], v, units)} {thresholdUnit(THRESHOLD_META[e.kind], units)} from {formatDateMedium(effective)}. Recomputing history from that date.
      </>),
    });
  };
  const remove = (t: Threshold) => {
    del.mutate(t.id);
    const meta = THRESHOLD_META[t.kind];
    toast.undo(
      <>
        Deleted <b>{meta.label}</b> from {formatDateMedium(t.effectiveFrom, true)}
      </>,
      () => add.mutate({ kind: t.kind, sport: t.sport, value: t.value, effectiveFrom: t.effectiveFrom, source: t.source, ...(t.note ? { note: t.note } : {}) }),
    );
  };

  const tabHistory = list
    .filter((t) => def.entries.some((e) => e.kind === t.kind && (e.sport === t.sport || (tab === 'other' && t.sport === 'all'))))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || a.kind.localeCompare(b.kind));
  const suggestions = (est.data?.suggestions ?? []).filter((sg) => def.entries.some((e) => e.kind === sg.kind && (sg.sport === e.sport || sg.sport === 'all' || e.sport === 'all')) && (!sg.current || Math.abs(sg.current - sg.value) / sg.current > 0.01));
  const z = zones.data?.sports[tab];

  return (
    <>
      <Section title="Zones & thresholds" description="Thresholds are dated. A new value applies from its date onward, and every activity after it is rescored." actions={<SaveIndicator status={status} />}>
        <div className="flex flex-col gap-8">
          <SportTabs value={tab} onChange={setTab} />
          <div>
            <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
              <div className={cn('grid flex-1 gap-x-8 gap-y-6', def.entries.length > 2 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
                {history.isPending || !today
                  ? def.entries.map((e) => <Skeleton key={e.kind + e.sport} className="h-[76px] w-40" />)
                  : def.entries.map((e) => {
                      const meta = THRESHOLD_META[e.kind];
                      const cur = resolve(list, e, effective);
                      const inherited = cur && cur.sport !== e.sport;
                      return (
                        <div key={`${tab}-${e.kind}-${e.sport}`} className="flex min-w-0 flex-col gap-1">
                          <BigThresholdInput
                            meta={meta}
                            units={units}
                            size="lg"
                            value={cur?.value ?? null}
                            onCommit={(v) => save(e, v)}
                            label={e.kind === 'lthr' && e.sport !== 'all' ? `${def.label} threshold HR` : meta.label}
                            aside={cur ? <SourceChip source={cur.source} /> : <SourceChip source="default" />}
                          />
                          <span className="max-w-[34ch] text-body-sm text-fg-3">{cur ? (inherited ? 'Using your general threshold HR. Type to set one for this sport.' : `Since ${formatDateMedium(cur.effectiveFrom, true)}. ${meta.explain}`) : `${meta.explain} Not set: ${meta.fallback.charAt(0).toLowerCase() + meta.fallback.slice(1)}.`}</span>
                        </div>
                      );
                    })}
              </div>
              <div className="w-full shrink-0 lg:w-56">
                <DatePicker label="Effective from" value={effective || null} onValueChange={setFrom} max={today} hint={effective === today ? 'Today. Pick an earlier date to rescore past sessions.' : 'Activities from this date are rescored.'} />
              </div>
            </div>
            <AnimatePresence initial={false}>
              {suggestions.length > 0 && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-8 flex flex-col gap-1">
                  <span className="mb-1 text-body-sm text-fg-3">Suggested from your recent bests</span>
                  {suggestions.map((sg) => {
                    const meta = THRESHOLD_META[sg.kind];
                    return (
                      <div key={sg.kind + sg.sport} className="-mx-3 flex flex-wrap items-center justify-between gap-3 rounded-md bg-surface-1 px-3 py-2">
                        <span className="flex flex-wrap items-center gap-2 text-body text-fg-1">
                          <Wand2 className="size-4 text-fg-3" />
                          {meta.label}
                          <span className="num font-medium">
                            {thresholdText(meta, sg.value, units)} {thresholdUnit(meta, units)}
                          </span>
                          <span className="text-body-sm text-fg-3">
                            from {sg.basis.replace(/\s*\(UNVERIFIED[^)]*\)/i, '')}
                            {sg.current ? ` · now ${thresholdText(meta, sg.current, units)}` : ''}
                          </span>
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => add.mutate({ kind: sg.kind, sport: sg.sport === 'all' ? 'all' : sg.sport, value: sg.value, effectiveFrom: today ?? effective, source: 'estimated', note: sg.basis })}
                        >
                          Apply
                        </Button>
                      </div>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </Section>

      <Section title="Zones" description={z?.defaulted.length ? 'Some values are defaults until you set them.' : undefined}>
        {zones.isPending ? (
          <Skeleton className="h-72 w-full" radius="lg" />
        ) : zones.isError ? (
          <InlineError action={<Button size="sm" variant="ghost" onClick={() => void zones.refetch()}>Retry</Button>}>Couldn't load zones.</InlineError>
        ) : (
          <div className="grid gap-12">
            {z?.power && <ZoneTable title={tab === 'row' ? 'Erg power' : 'Power'} t={z.power} units={units} sport={tab} />}
            {z?.pace && <ZoneTable title={tab === 'swim' ? 'Swim pace' : 'Pace'} t={z.pace} units={units} sport={tab} />}
            {z?.hr && <ZoneTable title="Heart rate" t={z.hr} units={units} sport={tab} />}
            {!z?.power && !z?.pace && !z?.hr && <p className="text-body text-fg-3">Set a threshold above to see zones.</p>}
          </div>
        )}
      </Section>

      <Section title="History">
        {history.isPending ? (
          <Skeleton className="h-40 w-full" radius="lg" />
        ) : tabHistory.length === 0 ? (
          <p className="text-body text-fg-3">No dated values yet for {def.label.toLowerCase()}. Type one above.</p>
        ) : (
          <div>
            <LayoutGroup>
              <ol className="relative">
                <AnimatePresence initial={false}>
                  {tabHistory.map((t, i) => {
                    const meta = THRESHOLD_META[t.kind];
                    return (
                      <motion.li
                        key={t.id}
                        layout
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, transition: tween('fast', 'in') }}
                        transition={spring.smooth}
                        className="group relative flex min-h-11 items-center gap-4 border-b border-line-1 last:border-b-0"
                      >
                        <span className={cn('size-1.5 shrink-0 rounded-full', i === 0 ? 'bg-fg-1' : 'bg-fg-4')} aria-hidden />
                        <span className="num w-36 shrink-0 whitespace-nowrap text-body text-fg-2">{formatDateMedium(t.effectiveFrom, true)}</span>
                        <span className="min-w-0 flex-1 truncate text-body text-fg-1">
                          {meta.label}
                          {t.sport !== 'all' && t.kind === 'lthr' ? ` · ${t.sport}` : ''}
                        </span>
                        <span className="num text-body font-medium text-fg-1">
                          {thresholdText(meta, t.value, units)} <span className="text-fg-3">{thresholdUnit(meta, units)}</span>
                        </span>
                        <span className="hidden w-24 justify-end sm:flex">
                          <SourceChip source={t.source} />
                        </span>
                        <IconButton label="Delete" size="sm" icon={<Trash2 />} onClick={() => remove(t)} className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100" />
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ol>
            </LayoutGroup>
          </div>
        )}
      </Section>
    </>
  );
}

function SportTabs({ value, onChange }: { value: ZoneSport; onChange: (v: ZoneSport) => void }) {
  return (
    <div role="tablist" aria-label="Sport" className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none]">
      {TABS.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={cn('relative flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 text-body-sm transition-colors duration-(--dur-fast)', on ? 'text-fg-1' : 'text-fg-3 hover:text-fg-1')}
          >
            {on && <motion.span layoutId="zones-tab" transition={spring.snappy} className="absolute inset-0 rounded-md bg-surface-2" />}
            <span className="relative flex items-center gap-2">
              {t.glyph ? <SportGlyph sport={t.glyph} size={16} /> : <HeartPulse className="size-4" />}
              {t.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

type Table = NonNullable<NonNullable<Awaited<ReturnType<typeof fetchZones>>['sports']['bike']['hr']>>;
const fetchZones = () => call(api.zones.$get({ query: {} }));

function ZoneTable({ title, t, units, sport }: { title: string; t: Table; units: UnitPrefs; sport: ZoneSport }) {
  const isPace = t.unit === 'mps';
  const ps = sport === 'swim' ? 'swim' : 'run';
  const fmt = (v: number) => (isPace ? paceParts(v, ps, units).value : String(Math.round(v)));
  const unit = isPace ? paceParts(t.threshold, ps, units).unit : t.unit;
  const range = (lo: number | null, hi: number | null) => {
    if (isPace) {
      if (lo == null && hi != null) return `slower than ${fmt(hi)}`;
      if (hi == null && lo != null) return `faster than ${fmt(lo)}`;
      return `${fmt(hi!)}–${fmt(lo!)}`;
    }
    if (lo == null) return `< ${fmt((hi ?? 0) + 1)}`;
    if (hi == null) return `${fmt(lo)}+`;
    return `${fmt(lo)}–${fmt(hi)}`;
  };
  const pct = (v: number | null) => (v == null ? null : Math.round((v / t.threshold) * 100));
  const maxPct = 1.5;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 pb-3">
        <h3 className="text-title-3 text-fg-1">{title}</h3>
        <span className="flex items-center gap-2 text-body-sm text-fg-3">
          threshold
          <motion.span key={fmt(t.threshold)} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={spring.snappy} className="num text-fg-1">
            {fmt(t.threshold)} {unit}
          </motion.span>
          {t.defaulted && <SourceChip source="default" />}
        </span>
      </div>
      <table className="w-full">
        <thead>
          <tr className="border-b border-line-1 text-label text-fg-3">
            <th className="py-2 text-left font-medium">Zone</th>
            <th className="py-2 text-right font-medium">{unit}</th>
            <th className="hidden py-2 text-right font-medium sm:table-cell">% thr</th>
          </tr>
        </thead>
        <tbody>
          {t.zones.map((zn, i) => {
            const lo = pct(zn.low) ?? 0;
            const hi = pct(zn.high);
                        const hiF = Math.min(maxPct, zn.high == null ? maxPct : zn.high / t.threshold);
            const fill = Math.min(7, Math.round(((i + 1) / t.zones.length) * 7));
            return (
              <tr key={zn.label} className="border-b border-line-1 last:border-b-0">
                <td className="h-11 py-2">
                  <div className="flex items-center gap-3">
                    <span className="num w-7 text-body-sm text-fg-3">{zn.label}</span>
                    <span className="relative hidden h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-surface-2 sm:block" aria-hidden>
                      <span className={cn('absolute inset-y-0 left-0 rounded-full', `bg-z${fill}`)} style={{ width: `${Math.max(6, (hiF / maxPct) * 100)}%` }} />
                    </span>
                    <span className="truncate text-body text-fg-1">{zn.name}</span>
                  </div>
                </td>
                <td className="num whitespace-nowrap py-2 pl-3 text-right text-body text-fg-1">
                  <motion.span key={range(zn.low, zn.high)} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.snappy, delay: i * 0.02 }} className="inline-block">
                    {range(zn.low, zn.high)}
                  </motion.span>
                </td>
                <td className="num hidden whitespace-nowrap py-2 pl-3 text-right text-body-sm text-fg-3 sm:table-cell">
                  {zn.low == null ? `< ${hi}` : hi == null ? `${lo}+` : `${lo}–${hi}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
