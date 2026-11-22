/**
 * Today — the daily cockpit and the mobile home (product.md §2.2 /today, §8.9–8.10).
 * Hero status line + form dial, readiness strip with the morning check-in, today's sessions
 * (large cards that morph into their pages), "Log how it went", this week, up next, the day note
 * and quick-add. "Today" always comes from the API (`data.date`).
 */
import type { LocalDate } from '@cadence/core/domain';
import { addDays, isoWeekOf } from '@cadence/core/time';
import { Link } from '@tanstack/react-router';
import { Flag, Moon, Plus, RotateCw, Star } from 'lucide-react';
import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { FormDial, ProgressRing } from '@/charts';
import { cn } from '@/lib/cn';
import { formatCountdown, formatDateMedium, formatDuration, formatIsoWeek, formatLoad, formatSigned, weekdayLong, weekdayShort } from '@/lib/format';
import { dayCards, useCalendar } from '@/lib/queries/training';
import { Ticker } from '@/motion/Ticker';
import { PageItem } from '@/motion/PageTransition';
import { spring } from '@/motion/tokens';
import { links } from '@/shell/links';
import {
  Banner,
  Button,
  ButtonLink,
  Card,
  Chip,
  ComplianceGlyph,
  DeltaBadge,
  FORM_ZONE_META,
  Page,
  PageHeader,
  Section,
  Skeleton,
  WorkoutCard,
} from '@/ui';
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

export function TodayPage() {
  const q = useTodayData();
  const d = q.data;
  const today = d?.date;
  const zone = d?.fitness.formZone ? FORM_ZONE_META[d.fitness.formZone].label : null;
  const ev = d?.nextEvent;
  const status = d
    ? [zone, `form ${formatSigned(Math.round(d.fitness.form))}`, ev ? (ev.daysUntil === 0 ? `${ev.event.name} today` : `${ev.event.name} in ${formatCountdown(ev.event.date, d.date)}`) : null]
        .filter(Boolean)
        .join(' · ')
    : null;

  return (
    <Page
      width="page"
      header={
        <PageHeader
          title="Today"
          eyebrow={today ? `${weekdayLong(today)} · ${formatDateMedium(today).slice(4)} · ${formatIsoWeek(isoWeekOf(today))}` : ' '}
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
        <TodayBody d={d} />
      )}
    </Page>
  );
}

function TodayBody({ d }: { d: TodayData }) {
  const today = d.date;
  const cards = useMemo(() => dayCards({ workouts: d.workouts, activities: d.activities } as never, today), [d.workouts, d.activities, today]);
  // Keep logger cards on screen for this visit even after the server stops listing them.
  const [logIds] = useState(() => new Set<string>());
  d.pendingLogs.forEach((a) => logIds.add(a.id));
  const pendingToday = new Set(d.pendingLogs.filter((a) => a.localDate === today).map((a) => a.id));
  const otherPending = d.pendingLogs.filter((a) => a.localDate !== today);
  const restMarker = d.markers.find((m) => m.type === 'rest');
  const otherMarkers = d.markers.filter((m) => m.type !== 'rest');

  return (
    <>
      <PageItem className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <FormCard d={d} />
        <ReadinessCard d={d} />
      </PageItem>

      <PageItem className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6">
        <div className="flex min-w-0 flex-col gap-8">
          <Section
            stagger={false}
            title="Sessions"
            description={otherMarkers.length ? otherMarkers.map((m) => `${m.type[0]!.toUpperCase()}${m.type.slice(1)}${m.label ? ` · ${m.label}` : ''}`).join(' · ') : undefined}
          >
            {cards.length === 0 ? (
              <RestDay today={today} planned={!!restMarker} />
            ) : (
              <div className="flex flex-col gap-3">
                {cards.map((c) => (
                  <SessionCard key={c.key} card={c} showLog={!!c.activity && (pendingToday.has(c.activity.id) || logIds.has(c.activity.id))} />
                ))}
              </div>
            )}
          </Section>

          {otherPending.length > 0 && (
            <Section stagger={false} title="Log how it went" description="Two taps: how hard, how it felt. Saved as you go.">
              <div className="flex flex-col gap-3">
                {otherPending.map((a) => (
                  <Card key={a.id} eyebrow={`${weekdayShort(a.localDate)} · ${formatDuration(a.movingSec || a.durationSec, 'clock')} · ${formatLoad(a.load)} load`} title={<Link {...links.activity(a.id)} className="hover:underline">{a.title}</Link>} spotlight={false}>
                    <ActivityLogger activity={a} />
                  </Card>
                ))}
              </div>
            </Section>
          )}

          <Section stagger={false} title="Note" description="A line about today. It ends up in your journal.">
            <div className="flex flex-col gap-4">
              <DayNoteEditor key={today} date={today} initial={d.dayNote?.body ?? ''} />
              <QuickAdd date={today} />
            </div>
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <WeekCard d={d} />
          <UpNext d={d} />
        </div>
      </PageItem>
    </>
  );
}

// ───────────────────────── hero: form ─────────────────────────

function FormCard({ d }: { d: TodayData }) {
  const f = d.fitness;
  return (
    <Card className="flex flex-col" style={{ '--chart-bg': 'var(--color-surface-1)' } as React.CSSProperties}>
      <div className="flex items-center gap-5 lg:flex-col lg:gap-3">
        <FormDial value={f.form} zone={f.formZone} size={176} className="shrink-0 max-sm:scale-90" caption={f.formPct != null ? `${formatSigned(Math.round(f.formPct))}% of fitness` : undefined} />
        <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3 lg:w-full lg:border-t lg:border-line-1 lg:pt-3">
          <Num label="Fitness" value={f.fitness} accent />
          <Num label="Fatigue" value={f.fatigue} />
          <Num label="Ramp" value={f.ramp ?? 0} signed suffix="/wk" />
        </div>
      </div>
    </Card>
  );
}

function Num({ label, value, accent, signed, suffix }: { label: string; value: number; accent?: boolean; signed?: boolean; suffix?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 lg:items-center">
      <span className="text-micro uppercase text-fg-3">{label}</span>
      <span className={cn('flex items-baseline gap-1 text-stat-sm', accent ? 'text-accent-ink' : 'text-fg-1')}>
        <Ticker value={value} from={0} format={(v) => (signed ? formatSigned(Math.round(v * 10) / 10, 1) : String(Math.round(v)))} />
        {suffix && <span className="text-label text-fg-3">{suffix}</span>}
      </span>
    </div>
  );
}

// ───────────────────────── readiness strip + check-in ─────────────────────────

const READY_COPY: Record<string, { title: string; bars: number }> = {
  green: { title: 'Ready to train', bars: 3 },
  amber: { title: 'Go by feel', bars: 2 },
  red: { title: 'Consider easing off', bars: 1 },
};

function ReadinessCard({ d }: { d: TodayData }) {
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
  const rd = READY_COPY[w.readiness.state] ?? READY_COPY.green!;
  const save = useSaveWellness();
  const feel = w.today?.feel ?? null;
  const soreness = w.today?.soreness ?? null;
  const hrvCopy = w.hrv.status === 'normal' ? 'In your normal range' : w.hrv.status === 'suppressed' ? 'Below your normal range' : w.hrv.status === 'elevated' ? 'Above your normal range' : 'Building a baseline';

  return (
    <Card padding="none" className="flex flex-col" style={{ '--chart-bg': 'var(--color-surface-1)' } as React.CSSProperties}>
      <div className="grid grid-cols-2 md:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))]">
        <div className="col-span-2 flex flex-col gap-2 border-b border-line-1 p-4 md:col-span-1 md:border-r md:border-b-0 xl:p-5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-micro uppercase text-fg-3">HRV · 7-day</span>
            <span className="text-body-sm text-fg-3">{hrvCopy}</span>
          </div>
          <div className="flex items-end gap-4">
            <span className="flex items-baseline gap-1 text-stat-md text-fg-1">
              {w.hrv.b7Ms != null ? <Ticker value={w.hrv.b7Ms} from={0} /> : '—'}
              <span className="text-label text-fg-3">ms</span>
            </span>
            <HrvMini points={points} className="mb-1 min-w-0 flex-1" />
          </div>
          <span className="font-mono text-mono-sm text-fg-3">
            {lastHrv != null ? `last night ${Math.round(lastHrv)} · ` : ''}normal {w.hrv.lowMs ?? '—'}–{w.hrv.highMs ?? '—'}
          </span>
        </div>
        <Metric label="Resting HR" value={w.restingHr.today ?? w.restingHr.rhr7} unit="bpm" note={w.restingHr.rhr60 != null ? `60-day ${Math.round(w.restingHr.rhr60)}${w.restingHr.elevated ? ' · elevated' : ''}` : undefined} className="border-r border-line-1" />
        <Metric
          label="Sleep"
          value={w.sleep.lastHours}
          format={(h) => hm(h * 3600)}
          unit="h"
          note={w.sleep.mean3Hours != null ? `3-night ${hm(w.sleep.mean3Hours * 3600)}${w.sleep.short ? ' · short' : ''}` : undefined}
          className="md:border-r md:border-line-1"
        />
        <div className="col-span-2 flex flex-col gap-1.5 border-t border-line-1 p-4 md:col-span-1 md:border-t-0 xl:p-5">
          <span className="text-micro uppercase text-fg-3">Readiness</span>
          <span className="flex items-center gap-2 text-title-3 text-fg-1">
            <span className="flex items-end gap-0.5" aria-hidden>
              {[1, 2, 3].map((i) => (
                <span key={i} className={cn('w-1 rounded-[1px]', i <= rd.bars ? 'bg-fg-1' : 'bg-gray-7')} style={{ height: 6 + i * 3 }} />
              ))}
            </span>
            {rd.title}
          </span>
          <span className="text-body-sm text-fg-3">{w.readiness.reasons.length ? w.readiness.reasons.join(' · ') : 'Nothing flagged'}</span>
          <span className="mt-auto text-micro uppercase text-fg-4" title={w.readiness.label}>
            Heuristic · not a medical score
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-4 border-t border-line-1 p-4 sm:flex-row sm:items-start sm:gap-10 xl:px-5">
        <div className="flex flex-col gap-1.5">
          <span className="text-label text-fg-1">How do you feel this morning?</span>
          <DotScale label="Morning feel" labels={CHECKIN_FEEL} value={feel} onChange={(v) => save.mutate({ date: today, input: { feel: v } })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-label text-fg-2">Soreness</span>
          <DotScale label="Soreness" labels={SORENESS} value={soreness} size="sm" onChange={(v) => save.mutate({ date: today, input: { soreness: v } })} />
        </div>
      </div>
    </Card>
  );
}

function Metric({ label, value, unit, note, format, className }: { label: string; value: number | null | undefined; unit?: string; note?: string; format?: (v: number) => string; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5 p-4 xl:p-5', className)}>
      <span className="text-micro uppercase text-fg-3">{label}</span>
      <span className="flex items-baseline gap-1 text-stat-md text-fg-1">
        {value != null ? <Ticker value={value} from={0} format={format} /> : <span className="text-fg-4">—</span>}
        {unit && <span className="text-label text-fg-3">{unit}</span>}
      </span>
      {note && <span className="font-mono text-mono-sm text-fg-3">{note}</span>}
    </div>
  );
}

// ───────────────────────── rest day ─────────────────────────

function RestDay({ today, planned }: { today: LocalDate; planned: boolean }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="flex flex-col items-start gap-4 rounded-lg border border-dashed border-line-3 p-6 md:p-8">
      <span className="grid size-12 place-items-center rounded-lg border border-line-2 bg-surface-2 text-fg-2">
        <Moon className="size-5" />
      </span>
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

// ───────────────────────── this week ─────────────────────────

function WeekCard({ d }: { d: TodayData }) {
  const wk = d.week;
  return (
    <Card
      eyebrow={`This week · ${formatIsoWeek(wk.isoWeek)}`}
      title={<Link {...links.week(wk.isoWeek)} className="hover:underline">Week so far</Link>}
      actions={
        wk.keyPlanned > 0 ? (
          <Chip tone={wk.keyDone >= wk.keyPlanned ? 'signal' : 'neutral'} icon={<Star />}>
            {wk.keyDone}/{wk.keyPlanned} key
          </Chip>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-7 gap-1">
          {d.weekStrip.map((day, i) => (
            <Link
              key={day.date}
              {...links.calendarDay(day.date)}
              className={cn(
                'relative flex flex-col items-center gap-1.5 rounded-md py-2 outline-none transition-colors duration-(--dur-fast) hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-focus',
                day.isToday && 'bg-surface-2',
              )}
              aria-label={`${weekdayLong(day.date)}: ${day.doneCount} done of ${day.plannedCount} planned`}
            >
              {day.isToday && <motion.span layoutId="today-week-pill" transition={spring.smooth} className="absolute inset-0 rounded-md ring-1 ring-accent-a6 ring-inset" />}
              <span className={cn('text-micro uppercase', day.isToday ? 'text-accent-ink' : 'text-fg-3')}>{weekdayShort(day.date).slice(0, 2)}</span>
              <span className={cn('font-mono text-mono', day.isToday ? 'text-fg-1' : 'text-fg-2')}>{Number(day.date.slice(8))}</span>
              <span className="flex min-h-3 flex-wrap justify-center gap-0.5">
                {day.states.length ? day.states.slice(0, 3).map((s, k) => <ComplianceGlyph key={k} state={s} size={10} />) : <span className="text-micro text-fg-4">·</span>}
              </span>
              {day.hasKey && <Star className="size-2.5 fill-accent text-accent" aria-label="Key session" style={{ animationDelay: `${i}ms` }} />}
            </Link>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4 border-t border-line-1 pt-4">
          <RingStat label="Hours" done={wk.doneSec} planned={wk.plannedSec} fmt={hm} wow={wk.wowSec} />
          <RingStat label="Load" done={wk.doneLoad} planned={wk.plannedLoad} fmt={(v) => formatLoad(v)} wow={wk.wowLoad} />
        </div>
      </div>
    </Card>
  );
}

function RingStat({ label, done, planned, fmt, wow }: { label: string; done: number; planned: number; fmt: (v: number) => string; wow: number | null }) {
  return (
    <div className="flex items-center gap-3">
      <ProgressRing done={done} planned={planned} size={52} stroke={4} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-micro uppercase text-fg-3">{label}</span>
        <span className="font-mono text-mono text-fg-1">
          {fmt(done)}
          <span className="text-fg-3"> / {fmt(planned)}</span>
        </span>
        <DeltaBadge value={wow} size="sm" suffix="WoW" good={(wow ?? 0) > 0 && (wow ?? 0) <= 0.15} warning={(wow ?? 0) > 0.15} />
      </div>
    </div>
  );
}

// ───────────────────────── up next ─────────────────────────

function UpNext({ d }: { d: TodayData }) {
  const tomorrow = addDays(d.date, 1);
  const cal = useCalendar(d.date, tomorrow);
  const cards = cal.data ? dayCards(cal.data, tomorrow) : [];
  const ev = d.nextEvent;
  const evA = d.nextAEvent && d.nextAEvent.event.id !== ev?.event.id ? d.nextAEvent : null;
  return (
    <Card eyebrow="Up next" title={<Link {...links.calendarDay(tomorrow)} className="hover:underline">Tomorrow · {formatDateMedium(tomorrow)}</Link>}>
      <div className="flex flex-col gap-4">
        {cal.isPending ? (
          <Skeleton className="h-16 w-full rounded-md" />
        ) : cards.length ? (
          <div className="flex flex-col gap-2">
            {cards.map((c) => (
              <WorkoutCard key={c.key} model={c.model} density="full" link={c.target.type === 'activity' ? links.activity(c.target.id) : links.workout(c.target.id)} morphId={`next-${c.key}`} />
            ))}
          </div>
        ) : (
          <p className="text-body text-fg-3">Nothing planned. A free day.</p>
        )}
        {[ev, evA].filter(Boolean).map((e) => (
          <Link
            key={e!.event.id}
            {...links.event(e!.event.id)}
            className={cn(
              'group/ev flex items-center gap-4 rounded-md border p-3 outline-none transition-colors duration-(--dur-fast) hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-focus',
              e!.event.priority === 'A' ? 'border-accent-a6' : e!.event.priority === 'B' ? 'border-line-3' : 'border-dashed border-line-3',
            )}
          >
            <div className="flex min-w-14 flex-col items-center">
              <span className="text-stat-md text-fg-1">
                <Ticker value={e!.daysUntil} from={0} />
              </span>
              <span className="text-micro uppercase text-fg-3">{e!.daysUntil === 1 ? 'day' : 'days'}</span>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-center gap-1.5 text-micro uppercase text-fg-3">
                <Flag className={cn('size-3', e!.event.priority === 'A' && 'fill-accent text-accent')} />
                {e!.event.priority}-race · {formatDateMedium(e!.event.date)}
              </span>
              <span className="truncate text-body font-[560] text-fg-1">{e!.event.name}</span>
              {e!.event.goal && <span className="truncate text-body-sm text-fg-3">{e!.event.goal}</span>}
            </div>
          </Link>
        ))}
      </div>
    </Card>
  );
}

// ───────────────────────── skeleton ─────────────────────────

function TodaySkeleton() {
  return (
    <>
      <PageItem className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <Skeleton className="h-64 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </PageItem>
      <PageItem className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-7 w-32" />
          <SessionCardSkeleton />
        </div>
        <Skeleton className="h-80 rounded-lg" />
      </PageItem>
    </>
  );
}

