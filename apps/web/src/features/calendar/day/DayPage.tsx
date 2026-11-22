/**
 * Day page — /calendar/day/$date (product.md §2.2, §3.7; design.md §4.3 "Day").
 * The day's sessions are the hero (full detail: stats + plan vs actual), with events above and a
 * quiet row of day-marker / event actions below; then the note and the day's body data. ‹ › day
 * paging (← → keys). A quiet aside: Form with its word, Fitness / Fatigue / Load, and the week
 * (hours done-of-plan with one thin bar, load, a link to the week page for everything else). The main panel carries `cal-focus` so the
 * calendar's day zoom lands here.
 */
import type { LocalDate } from '@cadence/core/domain';
import { addDays, diffDays, isoWeekOf, weekEnd, weekStart } from '@cadence/core/time';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Flag, Plus, RotateCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Sparkline, StatBar } from '@/charts';
import { formatDateLong, formatIsoWeek, formatIsoWeekLabel, formatIsoWeekRange, formatLoad, formatRelativeDay, formatSigned, formatWeight } from '@/lib/format';
import { dayCards, useCalendar } from '@/lib/queries/training';
import { useUnits } from '@/lib/units';
import { vtName } from '@/motion/morph';
import { PageItem } from '@/motion/PageTransition';
import { links } from '@/shell/links';
import { useShortcut } from '@/shell/shortcuts';
import { Banner, Button, ButtonLink, FORM_ZONE_META, IconButton, NumberField, Page, PageHeader, SaveIndicator, Section, Skeleton, Tooltip } from '@/ui';
import { EventBanner, MarkerEditor, NewEventForm } from './furniture';
import { CHECKIN_FEEL, DayNoteEditor, DotScale, hm, QuickAdd, SessionCard, SessionCardSkeleton, SORENESS, useChangeAutosave, useFitnessTrend, useSaveWellness } from './kit';

const dayApi = getRouteApi('/_app/calendar/day/$date');

export function CalendarDayPage() {
  const { date } = dayApi.useParams();
  const navigate = useNavigate();
  const cal = useCalendar(weekStart(date), weekEnd(date));
  const today = cal.data?.today;
  const go = (d: LocalDate) => void navigate(links.calendarDay(d));
  useShortcut('left', () => go(addDays(date, -1)));
  useShortcut('right', () => go(addDays(date, 1)));
  useShortcut('t', () => today && go(today));

  const rel = today ? formatRelativeDay(date, today) : '';
  return (
    <Page
      width="page"
      header={
        <PageHeader
          title={formatDateLong(date)}
          titleText={formatDateLong(date, true)}
          eyebrow={`${rel ? `${rel} · ` : ''}${formatIsoWeekLabel(isoWeekOf(date))} · ${date.slice(0, 4)}`}
          back={{ to: '/calendar', search: { date } }}
          breadcrumb={[{ label: 'Calendar', link: links.calendar(date) }, { label: isoWeekOf(date).slice(5), link: links.calendarWeek(isoWeekOf(date)) }]}
          actions={
            <div className="flex items-center gap-1">
              {today && today !== date && (
                <Button size="sm" variant="ghost" onClick={() => go(today)} className="max-sm:hidden">
                  Today
                </Button>
              )}
              <IconButton label="Previous day" kbd="left" icon={<ChevronLeft />} size="sm" onClick={() => go(addDays(date, -1))} />
              <IconButton label="Next day" kbd="right" icon={<ChevronRight />} size="sm" onClick={() => go(addDays(date, 1))} />
            </div>
          }
        />
      }
    >
      {cal.isError && !cal.data ? (
        <Section>
          <Banner tone="error" title="Couldn't load this day" action={<Button size="sm" icon={<RotateCw />} onClick={() => cal.refetch()}>Retry</Button>}>
            {cal.error instanceof Error ? cal.error.message : ''}
          </Banner>
        </Section>
      ) : (
        <DayBody date={date} />
      )}
    </Page>
  );
}

function DayBody({ date }: { date: LocalDate }) {
  const cal = useCalendar(weekStart(date), weekEnd(date));
  const data = cal.data && date >= cal.data.from && date <= cal.data.to ? cal.data : undefined;
  const today = data?.today;
  const cards = useMemo(() => (data ? dayCards(data, date) : []), [data, date]);
  const events = data?.events.filter((e) => e.date === date) ?? [];
  const note = data?.dayNotes.find((n) => n.date === date);
  const week = data?.weeks.find((w) => w.isoWeek === isoWeekOf(date));
  const [addingEvent, setAddingEvent] = useState(false);
  const future = today ? date > today : false;
  const recent = today ? diffDays(date, today) <= 7 && date <= today : false;

  return (
    <PageItem className="grid items-start gap-14 lg:grid-cols-[minmax(0,1fr)_272px] lg:gap-12 xl:gap-16">
      <div className="flex min-w-0 flex-col gap-14 rounded-xl lg:gap-16" style={vtName('cal-focus')}>
        <section className="flex flex-col gap-4" aria-label="Sessions and day markers">
          {events.length > 0 && (
            <div className="flex flex-col gap-2">
              {events.map((e) => (
                <EventBanner key={e.id} event={e} />
              ))}
            </div>
          )}
          <div className="flex items-end justify-between gap-4">
            <h2 className="text-title-3 text-fg-1">Sessions</h2>
            <ButtonLink {...links.newWorkout({ date })} size="sm" variant="ghost" icon={<Plus />}>
              New workout
            </ButtonLink>
          </div>
          {!data ? (
            <SessionCardSkeleton />
          ) : cards.length === 0 ? (
            <div className="flex flex-col items-start gap-4 rounded-lg bg-surface-1 p-6 md:p-8">
              <div className="flex flex-col gap-1">
                <h3 className="text-title-2 text-fg-1">{future || date === today ? 'Nothing planned.' : 'No training logged.'}</h3>
                <p className="text-body text-fg-2">{future || date === today ? 'Type a session below, or build one in the workout builder.' : 'A quiet day. Rest counts too.'}</p>
              </div>
              <QuickAdd date={date} className="w-full max-w-lg" />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {cards.map((c) => (
                <div key={c.key} style={vtName(`w-${c.key}`, 'cal-item')}>
                  <SessionCard card={c} detail showLog={!!c.activity && recent && (c.activity.rpe == null || c.activity.feel == null)} showSend={future || date === today} />
                </div>
              ))}
              <QuickAdd date={date} className="mt-2" />
            </div>
          )}
          <div className="flex flex-col gap-3 pt-2">
            {data ? (
              <MarkerEditor
                date={date}
                markers={data.markers}
                extra={
                  !addingEvent && (
                    <Button size="sm" variant="ghost" icon={<Flag />} onClick={() => setAddingEvent(true)}>
                      Add a race or event
                    </Button>
                  )
                }
              />
            ) : (
              <Skeleton className="h-8 w-48" />
            )}
            {addingEvent && <NewEventForm date={date} onDone={() => setAddingEvent(false)} />}
          </div>
        </section>

        <Section stagger={false} title="Note">
          {data ? <DayNoteEditor key={date} date={date} initial={note?.body ?? ''} minRows={4} /> : <Skeleton className="h-24 w-full rounded-md" />}
        </Section>

        {!future && (
          <Section stagger={false} title="Body">
            {data ? <WellnessPanel key={date} date={date} day={data.wellness.find((w) => w.date === date)} editable={!future} /> : <Skeleton className="h-28 w-full rounded-lg" />}
          </Section>
        )}
      </div>

      <aside
        className="flex min-w-0 flex-col gap-12 lg:sticky lg:top-[calc(var(--header-h)+2rem)] lg:max-h-[calc(100dvh-var(--header-h)-4rem)] lg:overflow-y-auto lg:overscroll-contain lg:[scrollbar-width:thin]"
        aria-label="Fitness and week"
      >
        <FitnessAside date={date} />
        {week && (
          <section className="flex flex-col gap-4" aria-label="Week">
            <h2 className="flex items-baseline justify-between gap-2">
              <Link {...links.calendarWeek(week.isoWeek)} className="text-title-3 text-fg-1 hover:underline">
                {formatIsoWeek(week.isoWeek)}
              </Link>
              <span className="text-label font-normal text-fg-3">{formatIsoWeekRange(week.isoWeek)}</span>
            </h2>
            <StatBar
              label="Hours"
              value={week.doneSec}
              max={Math.max(week.plannedSec, week.doneSec, 1)}
              format={hm}
              size="md"
              caption={`of ${hm(week.plannedSec)} planned`}
            />
            <p className="text-body-sm text-fg-2 num">
              Load {formatLoad(week.doneLoad)} of {formatLoad(week.plannedLoad)}
              {week.formZone ? ` · ${FORM_ZONE_META[week.formZone].label.toLowerCase()} at week end` : ''}
            </p>
            <Link {...links.week(week.isoWeek)} className="text-body-sm text-fg-3 underline decoration-line-3 underline-offset-4 hover:text-fg-1">
              Week details
            </Link>
          </section>
        )}
      </aside>
    </PageItem>
  );
}

function FitnessAside({ date }: { date: LocalDate }) {
  const q = useFitnessTrend(addDays(date, -27), date);
  const days = q.data?.days ?? [];
  const d = days.find((x) => x.date === date);
  if (q.isPending) return <Skeleton className="h-24 rounded-lg" />;
  if (!d)
    return (
      <section className="flex flex-col gap-2" aria-label="Form">
        <h2 className="text-label text-fg-3">Form</h2>
        <p className="text-body-sm text-fg-3">Too far ahead to project. Fitness projects about 8 weeks out.</p>
      </section>
    );
  const zone = d.formZone ? FORM_ZONE_META[d.formZone] : null;
  return (
    <section className="flex flex-col gap-2" aria-label="Form">
      <h2 className="text-label text-fg-3">{d.projected ? 'Form · projected' : 'Form'}</h2>
      <Tooltip content={`${zone?.tip ?? ''}${d.formPct != null ? ` Form is ${formatSigned(Math.round(d.formPct))}% of fitness.` : ''}`}>
        <p className="flex items-baseline gap-2.5 outline-none" tabIndex={0}>
          <span className="text-stat-lg text-fg-1 num">{formatSigned(Math.round(d.form))}</span>
          {zone && <span className="text-title-3 font-medium text-fg-2">{zone.label.toLowerCase()}</span>}
        </p>
      </Tooltip>
      <p className="flex flex-wrap gap-x-4 text-body-sm text-fg-3 num">
        <span>
          Fitness <span className="text-fg-1">{Math.round(d.fitness)}</span>
        </span>
        <span>
          Fatigue <span className="text-fg-1">{Math.round(d.fatigue)}</span>
        </span>
        <span>
          Load <span className="text-fg-1">{Math.round(d.projected ? d.plannedLoad : d.load)}</span>
        </span>
      </p>
      <Tooltip content="Fitness over the last four weeks">
        <div className="mt-2 outline-none" tabIndex={0}>
          <Sparkline values={days.map((x) => x.fitness)} width={200} height={24} />
        </div>
      </Tooltip>
    </section>
  );
}

function WellnessPanel({ date, day, editable }: { date: LocalDate; day?: import('@cadence/core/domain').WellnessDay; editable: boolean }) {
  const units = useUnits();
  const save = useSaveWellness();
  const [feel, setFeel] = useState<number | null>(day?.feel ?? null);
  const [sore, setSore] = useState<number | null>(day?.soreness ?? null);
  const [weight, setWeight] = useState<number | null>(day?.weightKg ?? null);
  const put = (input: Parameters<typeof save.mutate>[0]['input']) => save.mutate({ date, input });
  const weightStatus = useChangeAutosave(weight, (v) => save.mutateAsync({ date, input: { weightKg: v } }), 900);
  const metrics = [
    { label: 'HRV', value: day?.hrvMs != null ? `${Math.round(day.hrvMs)}` : null, unit: 'ms' },
    { label: 'Resting HR', value: day?.restingHr != null ? `${day.restingHr}` : null, unit: 'bpm' },
    { label: 'Sleep', value: day?.sleepSec != null ? hm(day.sleepSec) : null, unit: 'h' },
  ];
  return (
    <div className="flex flex-col gap-8">
      <div className="grid max-w-md grid-cols-3 gap-6">
        {metrics.map((m) => (
          <div key={m.label} className="flex flex-col gap-0.5">
            <span className="text-label text-fg-3">{m.label}</span>
            <span className="flex items-baseline gap-1 text-stat-sm text-fg-1 num">
              {m.value ?? <span className="text-fg-4">—</span>}
              {m.value && m.unit && <span className="text-label font-normal text-fg-3">{m.unit}</span>}
            </span>
          </div>
        ))}
      </div>
      {editable && (
        <div className="flex flex-col gap-6 sm:flex-row sm:flex-wrap sm:items-start sm:gap-10">
          <div className="flex flex-col gap-1">
            <span className="text-body-sm text-fg-2">Feel</span>
            <DotScale label="Feel that morning" labels={CHECKIN_FEEL} value={feel} size="sm" onChange={(v) => (setFeel(v), put({ feel: v }))} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-body-sm text-fg-2">Soreness</span>
            <DotScale label="Soreness" labels={SORENESS} value={sore} size="sm" onChange={(v) => (setSore(v), put({ soreness: v }))} />
          </div>
          <div className="flex w-40 flex-col gap-1">
            <NumberField label="Weight" value={weight} unit="kg" min={30} max={250} step={0.1} format={{ maximumFractionDigits: 1 }} onValueChange={(v) => setWeight(v)} />
            <SaveIndicator status={weightStatus} />
          </div>
        </div>
      )}
      {!editable && day?.weightKg != null && <span className="text-body-sm text-fg-3">Weight {formatWeight(day.weightKg, units)}</span>}
    </div>
  );
}
