/**
 * Today — the daily cockpit and the mobile home (product.md §2.2 /today, §8.9–8.10).
 * Answers "what do I do today, and am I fresh?": a one-sentence status under the title, today's
 * session(s) as the hero, and a quiet aside — freshness (Form with its word, Fitness, Fatigue),
 * last night's wellness with the morning check-in, the week so far and what's up next. Below the
 * hero: "Log how it went" for recent unlogged sessions, then the day note and quick-add.
 * Details that used to sit here (HRV trend and range, 60-day resting HR, 3-night sleep, ramp rate,
 * WoW deltas, key count) live in tooltips and one click away on the week / trends pages.
 * "Today" always comes from the API (`data.date`).
 */
import type { LocalDate } from '@cadence/core/domain';
import { addDays, isoWeekOf } from '@cadence/core/time';
import { Link } from '@tanstack/react-router';
import { Flag, Moon, Plus, RotateCw, TriangleAlert } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState, type ReactNode } from 'react';
import { StatBar } from '@/charts';
import { cn } from '@/lib/cn';
import { formatDateLong, formatDateMedium, formatDuration, formatIsoWeek, formatLoad, formatSigned, NBSP, weekdayLong, weekdayShort } from '@/lib/format';
import { dayCards, useCalendar, type CalendarCard } from '@/lib/queries/training';
import { Ticker } from '@/motion/Ticker';
import { PageItem } from '@/motion/PageTransition';
import { spring, tween } from '@/motion/tokens';
import { links } from '@/shell/links';
import { Banner, Button, ButtonLink, ComplianceGlyph, FORM_ZONE_META, KeyStar, Page, PageHeader, Section, Skeleton, SportGlyph, Tooltip } from '@/ui';
import {
  ActivityLogger,
  CHECKIN_FEEL,
  DayNoteEditor,
  DotScale,
  HrvMini,
  hm,
  QuickAdd,
  SessionCard,
  SessionCardSkeleton,
  SORENESS,
  SyncNowButton,
  useSaveWellness,
  useTodayData,
  useWellnessTrend,
  type TodayData,
} from './kit';

const READY: Record<string, string> = {
  green: 'You’re ready to train.',
  amber: 'Go by feel today.',
  red: 'Consider easing off today.',
};
const MARKER_LABEL: Record<string, string> = { sick: 'Sick', injured: 'Injured', travel: 'Travel', vacation: 'Vacation', rest: 'Rest', altitude: 'Altitude' };

/** "Long ride done." / "Tempo 3×15′ today." / "Nothing planned today." */
function sessionSentence(cards: CalendarCard[], restDay: boolean): string {
  if (!cards.length) return restDay ? 'A planned rest day.' : 'Nothing planned today.';
  const done = cards.filter((c) => c.activity);
  const open = cards.filter((c) => !c.activity && c.workout?.status !== 'skipped' && c.model.compliance?.state !== 'missed');
  if (!open.length) return done.length === 1 ? `${done[0]!.model.title} done.` : `All ${done.length} sessions done.`;
  if (!done.length) return open.length === 1 ? `${open[0]!.model.title} today.` : `${open.length} sessions today.`;
  return `${done.length} done, ${open.length === 1 ? open[0]!.model.title : `${open.length} sessions`} still to go.`;
}

export function TodayPage() {
  const q = useTodayData();
  const d = q.data;
  const today = d?.date;
  const cards = useMemo(() => (d ? dayCards({ workouts: d.workouts, activities: d.activities } as never, d.date) : []), [d]);
  const status = d ? (
    <>
      {sessionSentence(cards, d.markers.some((m) => m.type === 'rest'))}{' '}
      <span title={d.wellness.readiness.label}>{READY[d.wellness.readiness.state] ?? READY.green}</span>
    </>
  ) : null;

  return (
    <Page
      width="page"
      header={
        <PageHeader
          title="Today"
          eyebrow={today ? `${formatDateLong(today)} · ${formatIsoWeek(isoWeekOf(today))}` : ' '}
          meta={status ? <span className="text-body-lg text-fg-2">{status}</span> : <Skeleton className="h-6 w-80" />}
          actions={
            <>
              <SyncNowButton />
              <ButtonLink {...links.newWorkout(today ? { date: today } : {})} size="sm" variant="secondary" icon={<Plus />} className="max-sm:hidden">
                New workout
              </ButtonLink>
            </>
          }
        />
      }
    >
      {q.isError && !d ? (
        <Section>
          <Banner tone="error" title="Couldn't load today" action={<Button size="sm" icon={<RotateCw />} onClick={() => q.refetch()}>Retry</Button>}>
            {q.error instanceof Error ? q.error.message : 'Something went wrong.'}
          </Banner>
        </Section>
      ) : !d ? (
        <TodaySkeleton />
      ) : (
        <TodayBody d={d} cards={cards} />
      )}
    </Page>
  );
}

function TodayBody({ d, cards }: { d: TodayData; cards: CalendarCard[] }) {
  const today = d.date;
  // Keep logger cards on screen for this visit even after the server stops listing them.
  const [logIds] = useState(() => new Set<string>());
  d.pendingLogs.forEach((a) => logIds.add(a.id));
  const pendingToday = new Set(d.pendingLogs.filter((a) => a.localDate === today).map((a) => a.id));
  const otherPending = d.pendingLogs.filter((a) => a.localDate !== today);
  const restMarker = d.markers.find((m) => m.type === 'rest');
  const otherMarkers = d.markers.filter((m) => m.type !== 'rest');

  return (
    <PageItem className="grid gap-14 lg:grid-cols-[minmax(0,1fr)_288px] lg:gap-12 xl:gap-16">
      {/* main: the hero, then the day's writing */}
      <div className="flex min-w-0 flex-col gap-14 lg:gap-16">
        <Section
          stagger={false}
          title="Sessions"
          description={otherMarkers.length ? otherMarkers.map((m) => `${MARKER_LABEL[m.type] ?? m.type}${m.label ? ` · ${m.label}` : ''}`).join(' · ') : undefined}
        >
          {cards.length === 0 ? (
            <RestDay today={today} planned={!!restMarker} />
          ) : (
            <div className="flex flex-col gap-4">
              {cards.map((c) => (
                <SessionCard key={c.key} card={c} showLog={!!c.activity && (pendingToday.has(c.activity.id) || logIds.has(c.activity.id))} />
              ))}
            </div>
          )}
        </Section>

        {otherPending.length > 0 && (
          <Section stagger={false} title="Log how it went" description="How hard, how it felt. Saved as you go.">
            <div className="flex flex-col gap-12">
              {otherPending.map((a) => (
                <div key={a.id} className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <Link {...links.activity(a.id)} className="text-body font-medium text-fg-1 hover:underline">
                      {a.title}
                    </Link>
                    <span className="text-body-sm text-fg-3 num">
                      {weekdayLong(a.localDate)} · {formatDuration(a.movingSec || a.durationSec, 'clock')}
                    </span>
                  </div>
                  <ActivityLogger activity={a} />
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section stagger={false} title="Note">
          <div className="flex flex-col gap-4">
            <DayNoteEditor key={today} date={today} initial={d.dayNote?.body ?? ''} />
            <QuickAdd date={today} />
          </div>
        </Section>
      </div>

      {/* aside: am I fresh, the week, what's next */}
      <aside className="flex min-w-0 flex-col gap-12 lg:gap-14" aria-label="Freshness and week">
        <Freshness d={d} />
        <Wellness d={d} />
        <WeekSoFar d={d} />
        <UpNext d={d} />
      </aside>
    </PageItem>
  );
}

// ───────────────────────── freshness: Form · Fitness · Fatigue, each once ─────────────────────────

function Freshness({ d }: { d: TodayData }) {
  const f = d.fitness;
  const zone = f.formZone ? FORM_ZONE_META[f.formZone] : null;
  return (
    <section className="flex flex-col gap-2" aria-label="Freshness">
      <h2 className="text-label text-fg-3">Form</h2>
      <Tooltip content={`${zone?.tip ?? ''}${f.formPct != null ? ` Form is ${formatSigned(Math.round(f.formPct))}% of fitness.` : ''}`}>
        <p className="flex items-baseline gap-2.5 outline-none" tabIndex={0}>
          <span className="text-stat-lg text-fg-1 num">
            <Ticker value={f.form} from={0} format={(v) => formatSigned(Math.round(v))} />
          </span>
          {zone && <span className="text-title-3 font-medium text-fg-2">{zone.label.toLowerCase()}</span>}
        </p>
      </Tooltip>
      <p className="flex flex-wrap gap-x-4 text-body-sm text-fg-3 num">
        <Tooltip content={f.ramp != null ? `Ramp ${formatSigned(Math.round(f.ramp * 10) / 10, 1)} a week` : 'Fitness: 42-day load'}>
          <span tabIndex={0} className="outline-none">
            Fitness{NBSP}
            <span className="text-fg-1">
              <Ticker value={f.fitness} from={0} format={(v) => String(Math.round(v))} />
            </span>
          </span>
        </Tooltip>
        <span>
          Fatigue{NBSP}
          <span className="text-fg-1">
            <Ticker value={f.fatigue} from={0} format={(v) => String(Math.round(v))} />
          </span>
        </span>
      </p>
    </section>
  );
}

// ───────────────────────── wellness: a quiet row + the morning check-in ─────────────────────────

function Wellness({ d }: { d: TodayData }) {
  const today = d.date;
  const w = d.wellness;
  const trend = useWellnessTrend(addDays(today, -20), today);
  const points = useMemo(
    () =>
      (trend.data?.days ?? []).map((x) => ({
        date: x.date,
        hrv: x.hrvMs ?? null,
        mean: x.hrvBaseline?.b7Ms ?? null,
        lo: x.hrvBaseline?.lowMs ?? null,
        hi: x.hrvBaseline?.highMs ?? null,
      })),
    [trend.data],
  );
  const lastHrv = w.today?.hrvMs ?? [...points].reverse().find((p) => p.hrv != null)?.hrv ?? null;
  const hrvCopy = w.hrv.status === 'normal' ? 'In your normal range' : w.hrv.status === 'suppressed' ? 'Below your normal range' : w.hrv.status === 'elevated' ? 'Above your normal range' : 'Building a baseline';
  const save = useSaveWellness();
  const feel = w.today?.feel ?? null;
  const soreness = w.today?.soreness ?? null;
  const reasons = w.readiness.reasons;

  return (
    <section className="flex flex-col gap-6" aria-label="Wellness">
      <div className="grid grid-cols-3 gap-4">
        <Metric
          label="HRV"
          value={w.hrv.b7Ms}
          unit="ms"
          tip={
            <span className="flex w-56 flex-col gap-2 py-1">
              <span>
                7-day average · {hrvCopy.toLowerCase()}
                {lastHrv != null ? ` · last night ${Math.round(lastHrv)}` : ''} · normal {w.hrv.lowMs ?? '—'}–{w.hrv.highMs ?? '—'}
              </span>
              {points.length > 1 && <HrvMini points={points} height={36} />}
            </span>
          }
        />
        <Metric
          label="Resting HR"
          value={w.restingHr.today ?? w.restingHr.rhr7}
          unit="bpm"
          tip={w.restingHr.rhr60 != null ? `60-day average ${Math.round(w.restingHr.rhr60)}${w.restingHr.elevated ? ' · elevated' : ''}` : undefined}
        />
        <Metric
          label="Sleep"
          value={w.sleep.lastHours}
          format={(h) => hm(h * 3600)}
          unit="h"
          tip={w.sleep.mean3Hours != null ? `3-night average ${hm(w.sleep.mean3Hours * 3600)}${w.sleep.short ? ' · short' : ''}` : undefined}
        />
      </div>
      {reasons.length > 0 && (
        <p className="flex items-start gap-2 text-body-sm text-fg-1">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-fg-2" aria-hidden />
          {reasons.join(' · ')}
        </p>
      )}
      <CheckIn
        feel={feel}
        soreness={soreness}
        onFeel={(v) => save.mutate({ date: today, input: { feel: v } })}
        onSoreness={(v) => save.mutate({ date: today, input: { soreness: v } })}
      />
    </section>
  );
}

/** Morning check-in: one inline control (feel) until used; soreness unfolds once feel is in. */
function CheckIn({ feel, soreness, onFeel, onSoreness }: { feel: number | null; soreness: number | null; onFeel: (v: number | null) => void; onSoreness: (v: number | null) => void }) {
  const used = feel != null || soreness != null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-body-sm text-fg-2">How do you feel this morning?</span>
        <DotScale label="Morning feel" labels={CHECKIN_FEEL} value={feel} size="sm" onChange={onFeel} />
      </div>
      <AnimatePresence initial={false}>
        {used && (
          <motion.div
            key="sore"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0, transition: tween('fast', 'in') }}
            transition={spring.smooth}
            className="flex flex-col gap-1 overflow-hidden"
          >
            <span className="text-body-sm text-fg-2">Soreness</span>
            <DotScale label="Soreness" labels={SORENESS} value={soreness} size="sm" onChange={onSoreness} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Metric({ label, value, unit, tip, format }: { label: string; value: number | null | undefined; unit?: string; tip?: ReactNode; format?: (v: number) => string }) {
  return (
    <Tooltip content={tip}>
      <div className="flex min-w-0 flex-col gap-0.5 outline-none" tabIndex={tip ? 0 : undefined}>
        <span className="text-label text-fg-3">{label}</span>
        <span className="flex items-baseline gap-1 text-stat-sm text-fg-1 num">
          {value != null ? <Ticker value={value} from={0} format={format ?? ((v) => String(Math.round(v)))} /> : <span className="text-fg-4">—</span>}
          {unit && value != null && <span className="text-label font-normal text-fg-3">{unit}</span>}
        </span>
      </div>
    </Tooltip>
  );
}

// ───────────────────────── rest day ─────────────────────────

function RestDay({ today, planned }: { today: LocalDate; planned: boolean }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="flex flex-col items-start gap-4 rounded-lg bg-surface-1 p-6 md:p-8">
      <Moon className="size-5 text-fg-3" aria-hidden />
      <div className="flex flex-col gap-1">
        <h3 className="text-title-2 text-fg-1">Rest day. Nothing planned.</h3>
        <p className="text-body text-fg-2">{planned ? 'A planned rest day — recovery is where the training lands.' : 'Recovery is where the training lands. Easy walk, early night.'}</p>
      </div>
      {adding ? (
        <QuickAdd date={today} className="w-full max-w-md" autoFocus />
      ) : (
        <Button variant="ghost" size="sm" icon={<Plus />} onClick={() => setAdding(true)}>
          Add something anyway
        </Button>
      )}
    </div>
  );
}

// ───────────────────────── this week: seven days + hours done-of-plan ─────────────────────────

function WeekSoFar({ d }: { d: TodayData }) {
  const wk = d.week;
  return (
    <section className="flex flex-col gap-4" aria-label="This week">
      <h2 className="flex items-baseline justify-between gap-2">
        <Link {...links.week(wk.isoWeek)} className="text-title-3 text-fg-1 hover:underline">
          This week
        </Link>
        <span className="text-label font-normal text-fg-3">{formatIsoWeek(wk.isoWeek)}</span>
      </h2>
      <div className="-mx-1 grid grid-cols-7">
        {d.weekStrip.map((day) => (
          <Link
            key={day.date}
            {...links.calendarDay(day.date)}
            className="relative flex flex-col items-center gap-1.5 rounded-md py-2 outline-none transition-colors duration-(--dur-fast) hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-focus"
            aria-label={`${weekdayLong(day.date)}: ${day.doneCount} done of ${day.plannedCount} planned${day.hasKey ? ', key session' : ''}`}
          >
            {day.isToday && <motion.span layoutId="today-week-pill" transition={spring.smooth} className="absolute inset-0 rounded-md bg-surface-2" aria-hidden />}
            <span className={cn('relative text-label', day.isToday ? 'text-accent-ink' : 'font-normal text-fg-3')}>{weekdayShort(day.date).slice(0, 2)}</span>
            <span className="relative flex h-3 items-center justify-center gap-0.5">
              {day.states.length ? day.states.slice(0, 2).map((s, k) => <ComplianceGlyph key={k} state={s} size={10} />) : <span className="size-1 rounded-full bg-fg-4" />}
            </span>
            <span className="relative flex h-2.5 items-center">{day.hasKey && <KeyStar pressed readOnly size="xs" />}</span>
          </Link>
        ))}
      </div>
      <StatBar
        label="Hours"
        value={wk.doneSec}
        max={Math.max(wk.plannedSec, wk.doneSec, 1)}
        format={hm}
        size="md"
        caption={`of ${hm(wk.plannedSec)} · load ${formatLoad(wk.doneLoad)} of ${formatLoad(wk.plannedLoad)}`}
        ariaLabel={`This week: ${hm(wk.doneSec)} of ${hm(wk.plannedSec)} hours, load ${formatLoad(wk.doneLoad)} of ${formatLoad(wk.plannedLoad)}`}
      />
    </section>
  );
}

// ───────────────────────── up next: plain lines ─────────────────────────

function UpNext({ d }: { d: TodayData }) {
  const tomorrow = addDays(d.date, 1);
  const cal = useCalendar(d.date, tomorrow);
  const cards = cal.data ? dayCards(cal.data, tomorrow) : [];
  const ev = d.nextEvent;
  const evA = d.nextAEvent && d.nextAEvent.event.id !== ev?.event.id ? d.nextAEvent : null;
  const row = 'group/un -mx-2 flex items-start gap-3 rounded-md px-2 py-2 outline-none transition-colors duration-(--dur-fast) hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-focus';
  return (
    <section className="flex flex-col gap-3" aria-label="Up next">
      <h2 className="text-title-3 text-fg-1">Up next</h2>
      <div className="flex flex-col gap-1">
        {cal.isPending ? (
          <Skeleton className="h-10 w-full rounded-md" />
        ) : cards.length ? (
          cards.map((c) => (
            <Link key={c.key} {...(c.target.type === 'activity' ? links.activity(c.target.id) : links.workout(c.target.id))} className={row}>
              <SportGlyph sport={c.model.sport} subSport={c.model.subSport ?? undefined} size={16} className="mt-0.5 shrink-0 text-fg-3" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cn('truncate text-body text-fg-1', c.model.isKey ? 'font-semibold' : 'font-medium')}>{c.model.title}</span>
                <span className="text-body-sm text-fg-3 num">Tomorrow · {formatDuration(c.model.durationSec, 'clock')}</span>
              </span>
              {c.model.isKey && <KeyStar pressed readOnly size="sm" className="mt-1" />}
            </Link>
          ))
        ) : (
          <Link {...links.calendarDay(tomorrow)} className={cn(row, 'text-body text-fg-3')}>
            Tomorrow · nothing planned
          </Link>
        )}
        {[ev, evA].filter(Boolean).map((e) => (
          <Link key={e!.event.id} {...links.event(e!.event.id)} className={row}>
            <Flag className={cn('mt-1 size-4 shrink-0', e!.event.priority === 'A' ? 'fill-fg-2 text-fg-2' : 'text-fg-3')} aria-hidden />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-body font-medium text-fg-1">{e!.event.name}</span>
              <span className="text-body-sm text-fg-3 num">
                {e!.daysUntil === 0 ? (
                  'Race day'
                ) : (
                  <>
                    In <Ticker value={e!.daysUntil} from={0} /> {e!.daysUntil === 1 ? 'day' : 'days'} · {e!.event.priority} race · {formatDateMedium(e!.event.date)}
                  </>
                )}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

// ───────────────────────── skeleton ─────────────────────────

function TodaySkeleton() {
  return (
    <PageItem className="grid gap-14 lg:grid-cols-[minmax(0,1fr)_288px] lg:gap-12 xl:gap-16">
      <div className="flex flex-col gap-4">
        <Skeleton className="h-6 w-24" />
        <SessionCardSkeleton />
      </div>
      <div className="flex flex-col gap-12">
        <Skeleton className="h-20 w-48" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    </PageItem>
  );
}
