import { useInfiniteQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import type { SyncLogEntry } from '@cadence/core/domain';
import { Calculator, ChevronRight, CloudDownload, HeartPulse, History, KeyRound, ListX, Send, TriangleAlert } from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, call } from '@/lib/api';
import { cn } from '@/lib/cn';
import { qk } from '@/lib/query';
import { spring, tween } from '@/motion/tokens';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Section } from '@/ui/Section';
import { Skeleton } from '@/ui/Skeleton';
import { InlineError, formatClock, formatStamp } from './common';

const route = getRouteApi('/_app/settings/sync');

const KIND: Record<SyncLogEntry['kind'], { icon: ReactNode; label: string }> = {
  pull_activities: { icon: <CloudDownload />, label: 'Pull' },
  pull_wellness: { icon: <HeartPulse />, label: 'Wellness' },
  push_workout: { icon: <Send />, label: 'Push' },
  backfill: { icon: <History />, label: 'Backfill' },
  auth: { icon: <KeyRound />, label: 'Account' },
  recompute: { icon: <Calculator />, label: 'Recompute' },
};

const FILTERS = [
  { value: undefined, label: 'All' },
  { value: 'ok', label: 'Succeeded' },
  { value: 'error', label: 'Errors' },
  { value: 'running', label: 'Running' },
] as const;

function StatusGlyph({ status }: { status: SyncLogEntry['status'] }) {
  if (status === 'ok')
    return (
      <svg viewBox="0 0 12 12" className="size-3 text-fg-3" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-label="Succeeded">
        <path d="M2.5 6.2 5 8.5l4.5-5" />
      </svg>
    );
  if (status === 'error') return <TriangleAlert className="size-3.5 text-fg-1" aria-label="Error" />;
  return <span className="size-2 rounded-full border border-fg-2" aria-label="Running" />;
}

const dayKey = (iso: string) => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const dayLabel = (iso: string) => new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso));

export function SettingsSyncPage() {
  const { status } = route.useSearch();
  const navigate = route.useNavigate();
  const q = useInfiniteQuery({
    queryKey: qk.garmin.log({ limit: 50 }),
    queryFn: ({ pageParam }) => call(api.sync.log.$get({ query: { limit: '50', ...(pageParam ? { cursor: pageParam } : {}) } })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: 15_000,
  });
  const all = useMemo(() => q.data?.pages.flatMap((p) => p.entries) ?? [], [q.data]);
  const entries = status ? all.filter((e) => e.status === status) : all;
  const groups = useMemo(() => {
    const out: { key: string; label: string; items: SyncLogEntry[] }[] = [];
    for (const e of entries) {
      const k = dayKey(e.at);
      const g = out.at(-1);
      if (g?.key === k) g.items.push(e);
      else out.push({ key: k, label: dayLabel(e.at), items: [e] });
    }
    return out;
  }, [entries]);
  const [open, setOpen] = useState<string | null>(null);

  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => {
      if (es[0]?.isIntersecting && q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
    }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [q.hasNextPage, q.isFetchingNextPage, q.fetchNextPage, entries.length]);

  return (
    <Section title="Sync log" description="Every pull from and push to Garmin, newest first.">
      <div className="flex flex-col gap-4">
        <LayoutGroup id="sync-filter">
          <div role="radiogroup" aria-label="Status" className="-mx-1 flex w-fit gap-1">
            {FILTERS.map((f) => {
              const on = status === f.value;
              return (
                <button
                  key={f.label}
                  role="radio"
                  aria-checked={on}
                  onClick={() => void navigate({ search: f.value ? { status: f.value } : {}, replace: true })}
                  className={cn('relative h-8 rounded-md px-3 text-body-sm transition-colors duration-(--dur-fast)', on ? 'text-fg-1' : 'text-fg-3 hover:text-fg-1')}
                >
                  {on && <motion.span layoutId="pill" transition={spring.snappy} className="absolute inset-0 rounded-md bg-surface-2" />}
                  <span className="relative">{f.label}</span>
                </button>
              );
            })}
          </div>
        </LayoutGroup>

        {q.isPending ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : q.isError ? (
          <InlineError action={<Button size="sm" variant="ghost" onClick={() => void q.refetch()}>Retry</Button>}>Couldn't load the sync log.</InlineError>
        ) : entries.length === 0 && !q.hasNextPage ? (
          <div>
            <EmptyState icon={<ListX />} title={status ? 'Nothing with this status' : 'No syncs yet'} action={status ? <Button onClick={() => void navigate({ search: {} })}>Show everything</Button> : undefined}>
              {status ? 'Try another filter.' : 'Connect Garmin and the first pull shows up here.'}
            </EmptyState>
          </div>
        ) : (
          <div className="flex flex-col">
            {groups.map((g) => (
              <section key={g.key} className="flex flex-col">
                <h3 className="sticky top-(--header-h) z-(--z-sticky) -mx-1 mt-6 bg-canvas/90 px-1 py-2 text-label text-fg-3 backdrop-blur-sm first:mt-0">{g.label}</h3>
                <ul className="flex flex-col">
                  {g.items.map((e) => {
                    const k = KIND[e.kind];
                    const isOpen = open === e.id;
                    return (
                      <li key={e.id} className="border-b border-line-1 last:border-b-0">
                        <button
                          aria-expanded={isOpen}
                          onClick={() => setOpen(isOpen ? null : e.id)}
                          className="-mx-2 flex h-11 w-[calc(100%+1rem)] items-center gap-3 rounded-md px-2 text-left transition-colors duration-(--dur-fast) hover:bg-surface-1"
                        >
                          <span className="num w-11 shrink-0 text-body-sm text-fg-3">{formatClock(e.at)}</span>
                          <span className="flex w-4 shrink-0 justify-center">
                            <StatusGlyph status={e.status} />
                          </span>
                          <span className="flex shrink-0 text-fg-4 [&_svg]:size-3.5 max-sm:hidden" title={k.label}>
                            {k.icon}
                          </span>
                          <span className={cn('min-w-0 flex-1 truncate text-body', e.status === 'error' ? 'text-fg-1' : 'text-fg-1')}>{e.summary}</span>
                          <span className="num hidden w-16 text-right text-body-sm text-fg-3 sm:block">{e.durationMs != null ? `${(e.durationMs / 1000).toFixed(1)} s` : ''}</span>
                          <motion.span animate={{ rotate: isOpen ? 90 : 0 }} transition={spring.snappy} className="flex text-fg-4">
                            <ChevronRight className="size-3.5" />
                          </motion.span>
                        </button>
                        <AnimatePresence initial={false}>
                          {isOpen && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1, transition: spring.smooth }} exit={{ height: 0, opacity: 0, transition: tween('fast', 'in') }} className="overflow-hidden">
                              <dl className="mb-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md bg-surface-1 px-4 py-3 text-body-sm">
                                <dt className="text-fg-3">Kind</dt>
                                <dd className="text-fg-1">{k.label}</dd>
                                <dt className="text-fg-3">Status</dt>
                                <dd className="text-fg-1">{e.status === 'ok' ? 'Succeeded' : e.status === 'error' ? 'Error' : 'Running'}</dd>
                                <dt className="text-fg-3">At</dt>
                                <dd className="num text-fg-1">{formatStamp(e.at)}</dd>
                                {e.durationMs != null && (
                                  <>
                                    <dt className="text-fg-3">Took</dt>
                                    <dd className="num text-fg-1">{e.durationMs} ms</dd>
                                  </>
                                )}
                                <dt className="text-fg-3">Detail</dt>
                                <dd className="whitespace-pre-wrap break-words font-mono text-label font-normal text-fg-2">{e.detail || '—'}</dd>
                              </dl>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            <div ref={sentinel} className="flex h-12 items-center justify-center text-body-sm text-fg-3">
              {q.isFetchingNextPage ? 'Loading more…' : q.hasNextPage ? '' : entries.length > 12 ? 'That is everything.' : ''}
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}
