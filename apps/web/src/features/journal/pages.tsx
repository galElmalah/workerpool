/**
 * /journal — everything the athlete wrote, newest first: day notes, pre-workout intentions,
 * post-workout reflections and weekly reflections. Month groups with sticky headers, type chips
 * with a sliding indicator, search-as-you-type with highlighted matches, #tags, infinite scroll and
 * a composer for today's day note (autosave).
 */
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, getRouteApi } from '@tanstack/react-router';
import type { Sport } from '@cadence/core/domain';
import { ArrowUpRight, CalendarDays, NotebookPen, Search, X } from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, call } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateLong, formatDayShort, formatIsoWeekRange, formatMonthYearLong } from '@/lib/format';
import { qk } from '@/lib/query';
import { listContainer, listItem } from '@/motion/PageTransition';
import { spring, tween } from '@/motion/tokens';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Textarea } from '@/ui/Field';
import { Page, PageHeader } from '@/ui/PageHeader';
import { SaveIndicator, type SaveStatus } from '@/ui/SaveIndicator';
import { Section } from '@/ui/Section';
import { Skeleton } from '@/ui/Skeleton';
import { SportGlyph } from '@/ui/domain';
import { PageItem } from '@/motion/PageTransition';

const route = getRouteApi('/_app/journal');

type Filter = 'day' | 'workout' | 'week' | undefined;
const FILTERS: { value: Filter; label: string }[] = [
  { value: undefined, label: 'Everything' },
  { value: 'day', label: 'Day notes' },
  { value: 'workout', label: 'Workouts' },
  { value: 'week', label: 'Weekly' },
];
const TYPE_PARAM: Record<NonNullable<Filter>, string> = { day: 'day', workout: 'workout_pre,activity_post', week: 'week' };

const fetchPage = (params: { type?: string; q?: string; cursor?: string }) =>
  call(api.journal.$get({ query: { limit: '30', ...(params.type ? { type: params.type } : {}), ...(params.q ? { q: params.q } : {}), ...(params.cursor ? { cursor: params.cursor } : {}) } }));
type Item = Awaited<ReturnType<typeof fetchPage>>['items'][number];

const FEEL = ['Awful', 'Bad', 'Okay', 'Good', 'Great'];
const KIND_LABEL: Record<Item['type'], string> = { day: 'Day note', workout_pre: 'Intention', activity_post: 'Reflection', week: 'Weekly reflection' };

// ───────────── text helpers ─────────────
function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function Body({ text, words, onTag }: { text: string; words: string[]; onTag: (t: string) => void }) {
  const parts = useMemo(() => {
    const pattern = [`#[\\p{L}\\p{N}_-]+`, ...words.map(escapeRe)].join('|');
    const re = new RegExp(`(${pattern})`, 'giu');
    return text.split(re);
  }, [text, words]);
  return (
    <p className="whitespace-pre-wrap break-words text-body-lg text-fg-1">
      {parts.map((p, i) => {
        if (!p) return null;
        if (p.startsWith('#') && p.length > 1)
          return (
            <button key={i} onClick={(e) => (e.preventDefault(), e.stopPropagation(), onTag(p.slice(1)))} className="rounded-xs text-fg-2 underline decoration-line-3 underline-offset-3 hover:text-fg-1">
              {p}
            </button>
          );
        if (words.some((w) => w.toLowerCase() === p.toLowerCase()))
          return (
            <mark key={i} className="rounded-xs bg-accent-a3 px-0.5 text-fg-1">
              {p}
            </mark>
          );
        return <span key={i}>{p}</span>;
      })}
    </p>
  );
}

function Dots({ value }: { value: number }) {
  return (
    <span className="flex items-center gap-0.5" aria-label={`Feel ${FEEL[value - 1] ?? value}`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={cn('size-1.5 rounded-full', i <= value ? 'bg-fg-1' : 'bg-surface-3')} />
      ))}
    </span>
  );
}

// ───────────── page ─────────────
export function JournalPage() {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const [text, setText] = useState(search.q ?? '');
  useEffect(() => setText(search.q ?? ''), [search.q]);
  useEffect(() => {
    const t = setTimeout(() => {
      const q = text.trim() || undefined;
      if (q !== search.q) void navigate({ search: (s) => ({ ...s, q }), replace: true });
    }, 220);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = [search.q, search.tag ? `#${search.tag}` : undefined].filter(Boolean).join(' ') || undefined;
  const words = useMemo(() => (search.q ?? '').trim().split(/\s+/).filter((w) => w.length > 1), [search.q]);
  const filters = { type: search.type ? TYPE_PARAM[search.type] : undefined, q };
  const feed = useInfiniteQuery({
    queryKey: qk.journal.list(filters),
    queryFn: ({ pageParam }) => fetchPage({ ...filters, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: (prev) => prev,
  });
  const items = useMemo(() => feed.data?.pages.flatMap((p) => p.items) ?? [], [feed.data]);
  const months = useMemo(() => {
    const out: { key: string; items: Item[] }[] = [];
    for (const it of items) {
      const k = it.date.slice(0, 7);
      const last = out.at(-1);
      if (last?.key === k) last.items.push(it);
      else out.push({ key: k, items: [it] });
    }
    return out;
  }, [items]);

  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => {
      if (es[0]?.isIntersecting && feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
    }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [feed.hasNextPage, feed.isFetchingNextPage, feed.fetchNextPage, items.length]);

  const setTag = (tag: string | undefined) => void navigate({ search: (s) => ({ ...s, tag }) });
  const filtered = !!(search.type || search.q || search.tag);

  return (
    <Page width="prose" header={<PageHeader title="Journal" eyebrow="Notes" />}>
      <Composer />

      <PageItem className="sticky top-(--header-h) z-(--z-sticky) -mx-4 flex flex-col gap-3 bg-canvas/85 px-4 py-3 backdrop-blur-md md:-mx-6 md:px-6">
        <div className="relative flex items-center">
          <Search className="pointer-events-none absolute left-3 size-4 text-fg-3" />
          <input
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            placeholder="Search everything you wrote"
            aria-label="Search notes"
            className="h-10 w-full rounded-md border border-line-2 bg-surface-1 pl-9 pr-9 text-body text-fg-1 outline-none placeholder:text-fg-4 hover:border-line-3 focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-focus"
          />
          {text && (
            <button aria-label="Clear search" onClick={() => setText('')} className="absolute right-2 flex size-6 items-center justify-center rounded-sm text-fg-3 hover:bg-surface-3 hover:text-fg-1">
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none]">
          <LayoutGroup id="journal-type">
            <div role="radiogroup" aria-label="Type" className="flex shrink-0 gap-1">
              {FILTERS.map((f) => {
                const on = search.type === f.value;
                return (
                  <button
                    key={f.label}
                    role="radio"
                    aria-checked={on}
                    onClick={() => void navigate({ search: (s) => ({ ...s, type: f.value }) })}
                    className={cn('relative h-7 shrink-0 rounded-full px-3 text-label transition-colors duration-(--dur-fast)', on ? 'text-fg-1' : 'text-fg-3 hover:text-fg-1')}
                  >
                    {on && <motion.span layoutId="chip" transition={spring.snappy} className="absolute inset-0 rounded-full border border-line-3 bg-surface-3" />}
                    <span className="relative">{f.label}</span>
                  </button>
                );
              })}
            </div>
          </LayoutGroup>
          <AnimatePresence>
            {search.tag && (
              <motion.button
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={spring.snappy}
                onClick={() => setTag(undefined)}
                className="ml-auto flex h-7 shrink-0 items-center gap-1 rounded-full border border-dashed border-line-3 px-2.5 text-label text-fg-1"
              >
                #{search.tag} <X className="size-3" />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </PageItem>

      <PageItem className="-mt-4">
        {feed.isPending ? (
          <div className="flex flex-col gap-6 pt-2">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex flex-col gap-2">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-16 w-full" />
              </div>
            ))}
          </div>
        ) : feed.isError ? (
          <div className="rounded-lg border border-dashed border-line-3 p-6 text-body text-fg-1">
            Couldn't load your journal.{' '}
            <Button size="sm" variant="ghost" onClick={() => void feed.refetch()}>
              Retry
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line-2">
            {filtered ? (
              <EmptyState icon={<Search />} title="Nothing matches" action={<Button onClick={() => (setText(''), void navigate({ search: {} }))}>Clear filters</Button>}>
                Try fewer words or another type.
              </EmptyState>
            ) : (
              <EmptyState icon={<NotebookPen />} title="Your journal starts here">
                Notes you write on days, workouts and weeks collect here. Start with how today felt, above.
              </EmptyState>
            )}
          </div>
        ) : (
          <div className={cn('flex flex-col transition-opacity duration-(--dur-fast)', feed.isPlaceholderData && 'opacity-60')}>
            {months.map((m) => (
              <section key={m.key} aria-label={formatMonthYearLong(`${m.key}-01`)}>
                <h2 className="sticky top-[calc(var(--header-h)+6.5rem)] z-[1] -mx-1 bg-canvas/85 px-1 py-2 text-micro text-fg-3 backdrop-blur-sm">{formatMonthYearLong(`${m.key}-01`)}</h2>
                <motion.ol variants={listContainer} initial="hidden" animate="show" className="flex flex-col">
                  {m.items.map((it) => (
                    <motion.li key={`${it.type}-${it.ref}`} variants={listItem} layout="position" transition={spring.smooth}>
                      <Entry it={it} words={words} onTag={setTag} />
                    </motion.li>
                  ))}
                </motion.ol>
              </section>
            ))}
            <div ref={sentinel} className="flex h-16 items-center justify-center text-body-sm text-fg-3">
              {feed.isFetchingNextPage ? 'Loading older notes…' : !feed.hasNextPage && items.length > 8 ? 'The beginning.' : ''}
            </div>
          </div>
        )}
      </PageItem>
    </Page>
  );
}

function EntryLink({ it, children }: { it: Item; children: ReactNode }) {
  const cls = 'group block rounded-lg -mx-3 px-3 py-4 transition-colors duration-(--dur-fast) hover:bg-surface-1 focus-visible:outline-offset-0';
  if (it.type === 'activity_post') return <Link to="/activities/$id" params={{ id: it.ref }} className={cls}>{children}</Link>;
  if (it.type === 'workout_pre') return <Link to="/workouts/$id" params={{ id: it.ref }} className={cls}>{children}</Link>;
  if (it.type === 'week') return <Link to="/week/$isoWeek" params={{ isoWeek: it.ref }} className={cls}>{children}</Link>;
  return <Link to="/calendar/day/$date" params={{ date: it.ref }} className={cls}>{children}</Link>;
}

function Entry({ it, words, onTag }: { it: Item; words: string[]; onTag: (t: string) => void }) {
  return (
    <EntryLink it={it}>
      <div className="flex gap-4">
        <div className="flex w-14 shrink-0 flex-col items-start gap-1 pt-0.5">
          <span className="text-mono text-fg-2">{formatDayShort(it.date)}</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {it.sport ? <SportGlyph sport={it.sport as Sport} size={16} className="text-fg-2" /> : it.type === 'week' ? <CalendarDays className="size-4 text-fg-3" /> : <NotebookPen className="size-4 text-fg-3" />}
            <span className="text-micro text-fg-3">{KIND_LABEL[it.type]}</span>
            {it.type !== 'day' && <span className="min-w-0 truncate text-body text-fg-2">{it.type === 'week' ? `${it.title} · ${formatIsoWeekRange(it.ref)}` : it.title}</span>}
            {it.rpe != null && <span className="text-mono-sm text-fg-2">RPE {it.rpe}</span>}
            {it.feel != null && <Dots value={it.feel} />}
            <ArrowUpRight className="ml-auto size-3.5 text-fg-4 opacity-0 transition-opacity duration-(--dur-fast) group-hover:opacity-100" />
          </div>
          <div className={cn(it.type === 'week' && 'border-l-2 border-line-3 pl-3', it.type === 'workout_pre' && 'border-l-2 border-dashed border-line-3 pl-3')}>
            <Body text={it.body} words={words} onTag={onTag} />
          </div>
        </div>
      </div>
    </EntryLink>
  );
}

// ───────────── composer ─────────────
function Composer() {
  const qc = useQueryClient();
  const today = useQuery({ queryKey: qk.thresholds.current, queryFn: () => call(api.thresholds.current.$get()), staleTime: 60_000 }).data?.date;
  const note = useQuery({ queryKey: qk.furniture.dayNote(today ?? ''), queryFn: () => call(api['day-notes'][':date'].$get({ param: { date: today! } })), enabled: !!today });
  const [body, setBody] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const saved = useRef<string | null>(null);
  const loaded = note.data !== undefined;
  useEffect(() => {
    if (loaded && body === null) {
      const b = note.data?.body ?? '';
      setBody(b);
      saved.current = b;
    }
  }, [loaded, note.data, body]);
  useEffect(() => {
    if (body === null || !today || body === saved.current) return;
    const t = setTimeout(async () => {
      setStatus('saving');
      try {
        await call(api['day-notes'][':date'].$put({ param: { date: today }, json: { body } }));
        saved.current = body;
        setStatus('saved');
        void qc.invalidateQueries({ queryKey: qk.journal.all });
        void qc.invalidateQueries({ queryKey: qk.calendar.all });
        setTimeout(() => setStatus((s) => (s === 'saved' ? 'idle' : s)), 2400);
      } catch {
        setStatus('error');
      }
    }, 700);
    return () => clearTimeout(t);
  }, [body, today, qc]);

  return (
    <Section stagger>
      <div className="rounded-xl border border-line-2 bg-surface-1 p-4 transition-colors duration-(--dur-fast) focus-within:border-line-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-micro text-fg-3">{today ? `Today · ${formatDateLong(today)}` : 'Today'}</span>
          <SaveIndicator status={status} />
        </div>
        {body === null ? (
          <Skeleton className="h-[72px] w-full" />
        ) : (
          <Textarea
            value={body}
            onChange={(e) => setBody(e.currentTarget.value)}
            minRows={3}
            maxRows={14}
            placeholder="How did today feel? Sleep, legs, mood, anything worth remembering. Use #tags to find it later."
            aria-label="Today's note"
            className="!border-0 !bg-transparent !px-0 text-body-lg focus-visible:!outline-0"
          />
        )}
        <AnimatePresence>
          {body !== null && body.length > 0 && (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: tween('fast', 'in') }} className="mt-1 text-body-sm text-fg-4">
              Saves as you type. Clear it to remove the note.
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </Section>
  );
}
