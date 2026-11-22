/**
 * Agenda — /calendar/agenda (product.md §3.8; the default calendar on phones).
 * A continuous list grouped by day with sticky day headers. Past days collapse to one summary
 * line (expand with a height spring); today and upcoming days are open with full cards. Week
 * dividers carry that week's totals + WoW. Loads 4-week windows in both directions as you scroll
 * (native scroll anchoring keeps your place when weeks are prepended), starts at today, and
 * offers quick RPE / feel logging for recent unlogged sessions. On phones a swipeable week strip
 * sits on top.
 */
import type { CalendarResponse, LocalDate, WeekSummary } from '@cadence/core/domain';
import { addDays, diffDays, eachDay, isoWeekOf, weekStart } from '@cadence/core/time';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { ChevronDown, Flag, Moon, Pilcrow, Plus } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { qk } from '@/lib/query';
import { cn } from '@/lib/cn';
import { formatDayMonth, formatDuration, formatIsoWeekRange, formatLoad, formatRelativeDay, weekdayLong, weekdayShort } from '@/lib/format';
import { localToday } from '@/lib/hooks/useToday';
import { dayCards, useCalendar, type CalendarCard } from '@/lib/queries/training';
import { spring, tween } from '@/motion/tokens';
import { links } from '@/shell/links';
import { useShortcut } from '@/shell/shortcuts';
import { Button, ButtonLink, ComplianceGlyph, DeltaBadge, Page, PageHeader, Skeleton, SportGlyph, Tooltip, WorkoutCard } from '@/ui';
import { MARKER_META } from '../day/furniture';
import { ActivityLogger, hm } from '../day/kit';

const agendaApi = getRouteApi('/_app/calendar/agenda');
const WINDOW_WEEKS = 4;

export function AgendaPage() {
  const { date: anchorParam } = agendaApi.useSearch();
  const anchor = anchorParam ?? localToday();
  const first = addDays(weekStart(anchor), -7 * 2);
  const [windows, setWindows] = useState<LocalDate[]>([first]);
  useEffect(() => setWindows([addDays(weekStart(anchor), -14)]), [anchor]);
  const top = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState(0);
  const qc = useQueryClient();
  const probe = useCalendar(windows[0]!, addDays(windows[0]!, WINDOW_WEEKS * 7 - 1));
  const today = probe.data?.today;
  const scrollTarget = anchorParam ?? today;
  const navigate = useNavigate();

  // Start at today (or ?date=) once the first window has rendered.
  const scrolled = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!scrollTarget || scrolled.current === scrollTarget || !probe.data) return;
    const el = document.getElementById(`agenda-${scrollTarget}`) ?? document.getElementById(`agenda-week-${isoWeekOf(scrollTarget)}`);
    if (!el) return;
    scrolled.current = scrollTarget;
    const y = el.getBoundingClientRect().top + window.scrollY - stickyTop(el);
    window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior });
    setReady(true);
  });

  // Infinite loading both ways.
  useEffect(() => {
    if (!ready) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          setWindows((ws) => {
            const edge = e.target === top.current ? ws[0]! : ws[ws.length - 1]!;
            // One window at a time: only extend once the edge window has loaded.
            if (qc.getQueryState(qk.calendar.range(edge, addDays(edge, WINDOW_WEEKS * 7 - 1)))?.status !== 'success') return ws;
            return e.target === top.current ? [addDays(ws[0]!, -WINDOW_WEEKS * 7), ...ws] : [...ws, addDays(ws[ws.length - 1]!, WINDOW_WEEKS * 7)];
          });
        }
      },
      { rootMargin: '600px 0px' },
    );
    if (top.current) io.observe(top.current);
    if (bottom.current) io.observe(bottom.current);
    return () => io.disconnect();
  }, [ready, windows.length, tick]);

  const jump = (d: LocalDate) => {
    const el = document.getElementById(`agenda-${d}`);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - stickyTop(el), behavior: 'smooth' });
    else void navigate({ to: '/calendar/agenda', search: { date: d }, replace: true });
  };
  useShortcut('t', () => today && jump(today));

  return (
    <Page
      width="prose"
      header={
        <PageHeader
          title="Agenda"
          variant="compact"
          breadcrumb={[{ label: 'Calendar', link: links.calendar() }]}
          actions={
            <>
              <Button size="sm" variant="ghost" kbd="t" onClick={() => today && jump(today)}>
                Today
              </Button>
              <ButtonLink {...links.newWorkout(today ? { date: today } : {})} size="sm" variant="secondary" icon={<Plus />} className="max-sm:hidden">
                New
              </ButtonLink>
            </>
          }
        />
      }
      className="!gap-0"
    >
      {today && <WeekStrip today={today} onPick={jump} />}
      <div ref={top} aria-hidden className="h-px" />
      {windows.map((from) => (
        <AgendaWindow key={from} from={from} onLoaded={() => setTick((t) => t + 1)} />
      ))}
      <div ref={bottom} className="flex justify-center py-8" aria-hidden>
        <span className="text-body-sm text-fg-4">Loading later weeks…</span>
      </div>
    </Page>
  );
}

/** Where the day's sticky header pins (bar, + week strip on phones). */
function stickyTop(el: HTMLElement): number {
  const head = el.firstElementChild as HTMLElement | null;
  return (head ? parseFloat(getComputedStyle(head).top) : 52) || 52;
}

// ───────────────────────── mobile week strip ─────────────────────────

function WeekStrip({ today, onPick }: { today: LocalDate; onPick: (d: LocalDate) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const weeks = useMemo(() => Array.from({ length: 9 }, (_, i) => addDays(weekStart(today), (i - 4) * 7)), [today]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.scrollLeft = el.clientWidth * 4;
  }, []);
  return (
    <div className="sticky top-(--header-h) z-(--z-sticky) -mx-4 mb-2 bg-canvas/90 backdrop-blur-md sm:hidden">
      <div ref={ref} className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]" aria-label="Weeks — swipe to change">
        {weeks.map((ws) => (
          <div key={ws} className="grid w-full shrink-0 snap-center grid-cols-7 gap-1 px-3 py-2">
            {eachDay(ws, addDays(ws, 6)).map((d) => {
              const isToday = d === today;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => onPick(d)}
                  className={cn(
                    'relative flex h-12 flex-col items-center justify-center gap-0.5 rounded-md outline-none focus-visible:outline-2 focus-visible:outline-focus',
                    isToday ? 'text-on-accent' : d < today ? 'text-fg-3' : 'text-fg-1',
                  )}
                  aria-label={weekdayLong(d)}
                >
                  {isToday && <span className="absolute inset-x-1 inset-y-0.5 rounded-md bg-accent" aria-hidden />}
                  <span className="relative text-label font-normal">{weekdayShort(d).slice(0, 2)}</span>
                  <span className="relative text-body-sm num">{Number(d.slice(8))}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ───────────────────────── a 4-week window ─────────────────────────

function AgendaWindow({ from, onLoaded }: { from: LocalDate; onLoaded: () => void }) {
  const to = addDays(from, WINDOW_WEEKS * 7 - 1);
  const q = useCalendar(from, to);
  const data = q.data && q.data.from <= from && q.data.to >= to ? q.data : undefined;
  const loaded = !!data;
  useEffect(() => {
    if (loaded) onLoaded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);
  if (!data)
    return (
      <div className="flex flex-col gap-3 py-4" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className={cn('w-full rounded-md', i % 3 === 0 ? 'h-10' : 'h-16')} />
        ))}
      </div>
    );
  const weeks = Array.from({ length: WINDOW_WEEKS }, (_, i) => addDays(from, i * 7));
  return (
    <>
      {weeks.map((ws) => (
        <AgendaWeek key={ws} start={ws} data={data} week={data.weeks.find((w) => w.startDate === ws)} />
      ))}
    </>
  );
}

function AgendaWeek({ start, data, week }: { start: LocalDate; data: CalendarResponse; week?: WeekSummary }) {
  const today = data.today;
  const days = eachDay(start, addDays(start, 6));
  const shown = days.filter((d) => d >= today || hasContent(data, d));
  const iso = isoWeekOf(start);
  return (
    <section id={`agenda-week-${iso}`} className="flex flex-col">
      <WeekDivider iso={iso} week={week} current={start <= today && today <= addDays(start, 6)} />
      {shown.length === 0 && <p className="py-3 pl-1 text-body-sm text-fg-4">No training this week.</p>}
      {shown.map((d) => (
        <AgendaDay key={d} date={d} data={data} />
      ))}
    </section>
  );
}

const hasContent = (cal: CalendarResponse, d: LocalDate) =>
  cal.workouts.some((w) => w.date === d) ||
  cal.activities.some((a) => a.localDate === d) ||
  cal.events.some((e) => e.date === d) ||
  cal.dayNotes.some((n) => n.date === d) ||
  cal.markers.some((m) => m.date <= d && (m.endDate ?? m.date) >= d);

function WeekDivider({ iso, week, current }: { iso: string; week?: WeekSummary; current: boolean }) {
  return (
    <Link
      {...links.calendarWeek(iso)}
      className="group/wd mt-12 mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line-1 pb-3 outline-none focus-visible:outline-2 focus-visible:outline-focus"
    >
      <span className="text-title-3 text-fg-1 group-hover/wd:underline">
        W{Number(iso.slice(6))}
        <span className="ml-2 text-body-sm font-normal text-fg-3">
          {formatIsoWeekRange(iso)}
          {current ? ' · this week' : ''}
        </span>
      </span>
      {week && (
        <span className="ml-auto flex items-baseline gap-3 text-body-sm text-fg-2 num">
          <span>
            {hm(week.doneSec)}
            {week.plannedSec > week.doneSec && <span className="text-fg-3"> of {hm(week.plannedSec)}</span>}
          </span>
          <Tooltip content={!week.isProjected || week.doneLoad > 0 ? <DeltaBadge value={week.wowLoad} size="sm" suffix="load vs last week" /> : null}>
            <span tabIndex={0} className="outline-none">
              {formatLoad(week.doneLoad)}
              {week.plannedLoad > week.doneLoad && <span className="text-fg-3"> of {formatLoad(week.plannedLoad)}</span>}
              <span className="text-fg-3"> load</span>
            </span>
          </Tooltip>
        </span>
      )}
    </Link>
  );
}

// ───────────────────────── a day ─────────────────────────

function AgendaDay({ date, data }: { date: LocalDate; data: CalendarResponse }) {
  const today = data.today;
  const past = date < today;
  const isToday = date === today;
  const cards = useMemo(() => dayCards(data, date), [data, date]);
  const events = data.events.filter((e) => e.date === date);
  const note = data.dayNotes.find((n) => n.date === date);
  const markers = data.markers.filter((m) => m.date <= date && (m.endDate ?? m.date) >= date);
  const recent = past && date >= addDays(today, -3);
  const unlogged = cards.filter((c) => c.activity && (c.activity.rpe == null || c.activity.feel == null));
  const [open, setOpen] = useState(!past || (recent && unlogged.length > 0));
  const rel = formatRelativeDay(date, today);

  return (
    <div id={`agenda-${date}`} className="scroll-mt-28">
      <div
        className={cn(
          'sticky top-(--header-h) z-[1] -mx-4 flex h-11 items-center gap-2 bg-canvas/85 px-4 backdrop-blur-md max-sm:top-[calc(var(--header-h)+4rem)] md:-mx-6 md:px-6',
        )}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left outline-none focus-visible:outline-2 focus-visible:outline-focus"
        >
          <span className={cn('grid size-7 shrink-0 place-items-center rounded-full text-body-sm num', isToday ? 'bg-accent text-on-accent' : past ? 'text-fg-3' : 'text-fg-1')}>
            {Number(date.slice(8))}
          </span>
          <span className={cn('text-body-sm font-medium', past ? 'text-fg-2' : 'text-fg-1')}>{weekdayLong(date)}</span>
          {Math.abs(diffDays(today, date)) <= 1 && <span className="text-body-sm text-fg-3">{rel}</span>}
          {!open && <CollapsedSummary cards={cards} />}
          {note && <Pilcrow className="size-3 shrink-0 text-fg-3" aria-label="Has a note" />}
          <motion.span initial={false} animate={{ rotate: open ? 0 : -90 }} transition={spring.snappy} className="ml-auto shrink-0 text-fg-3">
            <ChevronDown className="size-4" />
          </motion.span>
        </button>
        <Link {...links.calendarDay(date)} className="shrink-0 rounded-sm px-1.5 text-label font-normal text-fg-3 outline-none hover:text-fg-1 focus-visible:outline-2 focus-visible:outline-focus">
          Day
        </Link>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0, transition: tween('fast', 'in') }}
            transition={spring.smooth}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-2 pt-1 pb-4 pl-9">
              {events.map((e) => (
                <Link key={e.id} {...links.event(e.id)} className="flex items-center gap-2 rounded-lg bg-surface-1 px-3 py-2.5 text-body font-semibold text-fg-1 outline-none transition-colors duration-(--dur-fast) hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-focus">
                  <Flag className={cn('size-3.5', e.priority === 'A' ? 'fill-fg-1' : 'text-fg-3')} />
                  {e.name}
                  <span className="ml-auto text-body-sm font-normal text-fg-3">{e.priority} race</span>
                </Link>
              ))}
              {markers.map((m) => (
                <span key={m.id} className="inline-flex items-center gap-2 text-body-sm text-fg-2 [&_svg]:size-3.5">
                  {MARKER_META[m.type].icon}
                  {MARKER_META[m.type].label}
                  {m.label && <span className="text-fg-3">· {m.label}</span>}
                  {m.endDate && <span className="text-fg-3">until {formatDayMonth(m.endDate)}</span>}
                </span>
              ))}
              {cards.map((c) => (
                <AgendaCard key={c.key} card={c} log={recent || isToday} />
              ))}
              {cards.length === 0 && !events.length && (
                <span className="flex items-center gap-2 py-1 text-body-sm text-fg-3">
                  <Moon className="size-3.5" /> {past ? 'Nothing logged' : 'Rest day. Nothing planned.'}
                  {!past && (
                    <Link {...links.newWorkout({ date })} className="ml-1 text-fg-2 underline decoration-line-3 underline-offset-4 hover:text-fg-1">
                      Add
                    </Link>
                  )}
                </span>
              )}
              {note && (
                <p className="flex items-start gap-2 px-3 text-body-sm text-fg-2">
                  <Pilcrow className="mt-0.5 size-3 shrink-0 text-fg-3" aria-hidden />
                  <span className="line-clamp-2">{note.body}</span>
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CollapsedSummary({ cards }: { cards: CalendarCard[] }) {
  if (!cards.length) return null;
  return (
    <span className="flex min-w-0 items-center gap-3 overflow-hidden text-body-sm text-fg-2">
      {cards.slice(0, 3).map((c) => (
        <span key={c.key} className="inline-flex shrink-0 items-center gap-1">
          <SportGlyph sport={c.model.sport} size={14} className="text-fg-2" />
          <span className="num">{formatDuration(c.model.durationSec, 'prime')}</span>
          <ComplianceGlyph state={c.model.compliance?.state ?? 'planned'} size={10} />
        </span>
      ))}
      {cards.length > 3 && <span className="text-fg-3">+{cards.length - 3}</span>}
    </span>
  );
}

function AgendaCard({ card, log }: { card: CalendarCard; log: boolean }) {
  const a = card.activity;
  const needsLog = log && a && (a.rpe == null || a.feel == null);
  const [logging, setLogging] = useState(false);
  return (
    <div className="flex flex-col">
      <WorkoutCard model={card.model} density="full" link={card.target.type === 'activity' ? links.activity(card.target.id) : links.workout(card.target.id)} morphId={`ag-${card.key}`} />
      {needsLog && !logging && (
        <button type="button" onClick={() => setLogging(true)} className="mt-1 ml-2 self-start rounded-sm px-1 py-1 text-label text-fg-2 underline decoration-line-3 underline-offset-4 outline-none hover:text-fg-1 focus-visible:outline-2 focus-visible:outline-focus pointer-coarse:py-2">
          Log how it went
        </button>
      )}
      <AnimatePresence initial={false}>
        {needsLog && logging && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring.smooth} className="overflow-hidden">
            <div className="mt-2 rounded-lg bg-surface-1 p-4">
              <ActivityLogger activity={a!} compact />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
