/**
 * Day page — /calendar/day/$date (product.md §2.2, §3.7; design.md §4.3 "Day").
 * Every planned + completed session at full width (paired = plan vs actual), ‹ › day paging
 * (page-next / page-prev transitions, ← → keys), events, day markers (inline, range-capable),
 * the day's wellness with manual entry, the autosaving day note, quick-add, and an aside with the
 * day's Fitness / Fatigue / Form and the week summary. The main panel carries `cal-focus` so the
 * calendar's day zoom lands here.
 */
import type { LocalDate } from '@cadence/core/domain';
import { addDays, diffDays, isoWeekOf, weekEnd, weekStart } from '@cadence/core/time';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Flag, Plus, RotateCw, Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import { FormDial, ProgressRing, Sparkline } from '@/charts';
import { cn } from '@/lib/cn';
import { formatDateLong, formatIsoWeekLabel, formatLoad, formatRelativeDay, formatSigned, formatWeight } from '@/lib/format';
import { dayCards, useCalendar } from '@/lib/queries/training';
import { useUnits } from '@/lib/units';
import { vtName } from '@/motion/morph';
import { PageItem } from '@/motion/PageTransition';
import { links } from '@/shell/links';
import { useShortcut } from '@/shell/shortcuts';
import { Banner, Button, ButtonLink, Card, Chip, DeltaBadge, FORM_ZONE_META, IconButton, NumberField, Page, PageHeader, SaveIndicator, Section, Skeleton } from '@/ui';
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
    <PageItem className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6">
      <div className="flex min-w-0 flex-col gap-8 rounded-xl" style={vtName('cal-focus')}>
        {events.length > 0 && (
          <div className="flex flex-col gap-2">
            {events.map((e) => (
              <EventBanner key={e.id} event={e} />
            ))}
          </div>
        )}

        <Section stagger={false} title="Markers & events" variant="micro">
          <div className="flex flex-col gap-3">
            {data ? <MarkerEditor date={date} markers={data.markers} /> : <Skeleton className="h-8 w-48" />}
            {addingEvent ? (
              <NewEventForm date={date} onDone={() => setAddingEvent(false)} />
            ) : (
              <div>
                <Button size="sm" variant="ghost" icon={<Flag />} onClick={() => setAddingEvent(true)}>
                  Add a race or event
                </Button>
              </div>
            )}
          </div>
        </Section>

        <Section stagger={false} title="Sessions" actions={<ButtonLink {...links.newWorkout({ date })} size="sm" variant="secondary" icon={<Plus />}>New workout</ButtonLink>}>
          {!data ? (
            <div className="flex flex-col gap-3">
              <SessionCardSkeleton />
            </div>
          ) : cards.length === 0 ? (
            <div className="flex flex-col items-start gap-4 rounded-lg border border-dashed border-line-3 p-6">
              <div className="flex flex-col gap-1">
                <h3 className="text-title-3 text-fg-1">{future || date === today ? 'Nothing planned.' : 'No training logged.'}</h3>
                <p className="text-body text-fg-2">{future || date === today ? 'Type a session below, or build one in the workout builder.' : 'A quiet day. Rest counts too.'}</p>
              </div>
              <QuickAdd date={date} className="w-full max-w-lg" />
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {cards.map((c) => (
                <div key={c.key} style={vtName(`w-${c.key}`, 'cal-item')}>
                  <SessionCard card={c} showLog={!!c.activity && recent && (c.activity.rpe == null || c.activity.feel == null)} showSend={future || date === today} />
                </div>
              ))}
              <QuickAdd date={date} className="mt-1" />
            </div>
          )}
        </Section>

        <Section stagger={false} title="Note" variant="micro">
          {data ? <DayNoteEditor key={date} date={date} initial={note?.body ?? ''} minRows={4} /> : <Skeleton className="h-24 w-full rounded-md" />}
        </Section>

        {!future && <Section stagger={false} title="Body" variant="micro">
          {data ? <WellnessPanel key={date} date={date} day={data.wellness.find((w) => w.date === date)} editable={!future} /> : <Skeleton className="h-28 w-full rounded-lg" />}
        </Section>}
      </div>

      <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-[calc(var(--header-h)+1rem)] lg:self-start">
        <FitnessAside date={date} />
        {week && (
          <Card eyebrow="Week" title={<Link {...links.week(week.isoWeek)} className="hover:underline">{formatIsoWeekLabel(week.isoWeek)}</Link>}>
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <Ring label="Hours" done={week.doneSec} planned={week.plannedSec} fmt={hm} wow={week.wowSec} />
                <Ring label="Load" done={week.doneLoad} planned={week.plannedLoad} fmt={formatLoad} wow={week.wowLoad} />
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-line-1 pt-3">
                {week.keyPlanned > 0 && (
                  <Chip tone={week.keyDone >= week.keyPlanned ? 'signal' : 'neutral'} icon={<Star />}>
                    {week.keyDone}/{week.keyPlanned} key
                  </Chip>
                )}
                {week.compliancePct != null && <Chip>{Math.round(week.compliancePct)}% compliance</Chip>}
                {week.formZone && <Chip>{FORM_ZONE_META[week.formZone].label} at week end</Chip>}
              </div>
              <Link {...links.calendarWeek(week.isoWeek)} className="text-label text-fg-2 underline decoration-line-3 underline-offset-4 hover:text-fg-1">
                Open the week
              </Link>
            </div>
          </Card>
        )}
      </aside>
    </PageItem>
  );
}

function Ring({ label, done, planned, fmt, wow }: { label: string; done: number; planned: number; fmt: (v: number) => string; wow: number | null }) {
  return (
    <div className="flex items-center gap-2.5">
      <ProgressRing done={done} planned={planned} size={44} />
      <div className="flex min-w-0 flex-col">
        <span className="text-micro uppercase text-fg-3">{label}</span>
        <span className="font-mono text-mono-sm text-fg-1">
          {fmt(done)}
          <span className="text-fg-3">/{fmt(planned)}</span>
        </span>
        <DeltaBadge value={wow} size="sm" />
      </div>
    </div>
  );
}

function FitnessAside({ date }: { date: LocalDate }) {
  const q = useFitnessTrend(addDays(date, -27), date);
  const days = q.data?.days ?? [];
  const d = days.find((x) => x.date === date);
  if (q.isPending) return <Skeleton className="h-64 rounded-lg" />;
  if (!d)
    return (
      <Card eyebrow="Fitness model">
        <p className="text-body text-fg-3">Too far ahead to project. Fitness projects about 8 weeks out.</p>
      </Card>
    );
  return (
    <Card eyebrow={d.projected ? 'Fitness model · projected' : 'Fitness model'} style={{ '--chart-bg': 'var(--color-surface-1)' } as React.CSSProperties}>
      <div className="flex flex-col items-center gap-3">
        <FormDial value={d.form} zone={d.formZone} size={168} caption={d.formPct != null ? `${formatSigned(Math.round(d.formPct))}% of fitness` : undefined} />
        <div className="grid w-full grid-cols-3 gap-2 border-t border-line-1 pt-3 text-center">
          <Mini label="Fitness" value={Math.round(d.fitness)} accent />
          <Mini label="Fatigue" value={Math.round(d.fatigue)} />
          <Mini label="Load" value={Math.round(d.projected ? d.plannedLoad : d.load)} />
        </div>
        <div className="flex w-full items-center justify-between gap-3 text-body-sm text-fg-3">
          <span>Fitness, 4 weeks</span>
          <Sparkline values={days.map((x) => x.fitness)} width={120} height={22} />
        </div>
      </div>
    </Card>
  );
}

function Mini({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-micro uppercase text-fg-3">{label}</span>
      <span className={cn('text-stat-sm', accent ? 'text-accent-ink' : 'text-fg-1')}>{value}</span>
    </div>
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
    { label: 'Weight', value: day?.weightKg != null ? formatWeight(day.weightKg, units) : null, unit: '' },
  ];
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-line-2 bg-surface-1">
      <div className="grid grid-cols-2 sm:grid-cols-4">
        {metrics.map((m, i) => (
          <div key={m.label} className={cn('flex flex-col gap-1 border-line-1 p-4', i % 2 === 0 && 'border-r', i < 2 && 'max-sm:border-b', i === 1 && 'sm:border-r')}>
            <span className="text-micro uppercase text-fg-3">{m.label}</span>
            <span className="flex items-baseline gap-1 text-stat-sm text-fg-1">
              {m.value ?? <span className="text-fg-4">—</span>}
              {m.value && m.unit && <span className="text-label text-fg-3">{m.unit}</span>}
            </span>
          </div>
        ))}
      </div>
      {editable && (
        <div className="flex flex-col gap-4 border-t border-line-1 p-4 sm:flex-row sm:flex-wrap sm:items-start sm:gap-8">
          <div className="flex flex-col gap-1.5">
            <span className="text-label text-fg-2">Feel</span>
            <DotScale label="Feel that morning" labels={CHECKIN_FEEL} value={feel} size="sm" onChange={(v) => (setFeel(v), put({ feel: v }))} />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-label text-fg-2">Soreness</span>
            <DotScale label="Soreness" labels={SORENESS} value={sore} size="sm" onChange={(v) => (setSore(v), put({ soreness: v }))} />
          </div>
          <div className="flex w-40 flex-col gap-1">
            <NumberField label="Weight" value={weight} unit="kg" min={30} max={250} step={0.1} format={{ maximumFractionDigits: 1 }} onValueChange={(v) => setWeight(v)} />
            <SaveIndicator status={weightStatus} />
          </div>
        </div>
      )}
    </div>
  );
}

