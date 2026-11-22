/**
 * Event / race page — /events/$id (product.md §2.2, §3.7). Edit everything in place (priority
 * segmented, date, sport, distance, goal, location), a countdown, Fitness / Form projected for race
 * day, the taper weeks leading in, and — once the day has passed — the linked result activity
 * (picked from that day's activities) with a race report. Delete is immediate with undo.
 */
import { SPORTS, SPORT_META, type Event, type LocalDate, type Sport } from '@cadence/core/domain';
import { addDays, diffDays, isoWeekOf } from '@cadence/core/time';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { Flag, RotateCw, Trash2, Trophy } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import { formatDateLong, formatDuration, formatIsoWeekRange, formatLoad, formatSigned } from '@/lib/format';
import { useCalendar } from '@/lib/queries/training';
import { Odometer } from '@/motion/Ticker';
import { PageItem } from '@/motion/PageTransition';
import { spring } from '@/motion/tokens';
import { links } from '@/shell/links';
import {
  Banner,
  Button,
  DatePicker,
  EmptyState,
  FormZoneLabel,
  Input,
  InlineEdit,
  NumberField,
  Page,
  PageHeader,
  SaveIndicator,
  Section,
  Segmented,
  Select,
  Skeleton,
  SportGlyph,
  Textarea,
  toast,
} from '@/ui';
import { hm, SessionStats, useChangeAutosave, useEventMutations, useEvents, useFitnessTrend, useTodayData, useWeeklyTrend } from '../day/kit';

const eventApi = getRouteApi('/_app/events/$id');

export function EventPage() {
  const { id } = eventApi.useParams();
  const q = useEvents();
  const ev = q.data?.find((e) => e.id === id);
  if (q.isError && !q.data)
    return (
      <Page header={<PageHeader title="Event" back={{ to: '/season' }} />}>
        <Section>
          <Banner tone="error" title="Couldn't load the event" action={<Button size="sm" icon={<RotateCw />} onClick={() => q.refetch()}>Retry</Button>} />
        </Section>
      </Page>
    );
  if (!q.data)
    return (
      <Page header={<PageHeader title={<Skeleton className="h-10 w-80" />} titleText="Event" back={{ to: '/season' }} />}>
        <Skeleton className="h-48 rounded-lg" />
      </Page>
    );
  if (!ev)
    return (
      <Page header={<PageHeader title="Event" back={{ to: '/season' }} />}>
        <EmptyState icon={<Flag />} title="This event doesn't exist any more" action={<Link {...links.season()} className="text-label text-fg-1 underline underline-offset-4">Open the season</Link>}>
          It may have been deleted.
        </EmptyState>
      </Page>
    );
  return <EventView key={ev.id} ev={ev} />;
}

const SPORT_OPTS = SPORTS.map((s) => ({ value: s, label: SPORT_META[s].label, icon: <SportGlyph sport={s} size={14} /> }));

function EventView({ ev }: { ev: Event }) {
  const { patch, remove, create } = useEventMutations();
  const navigate = useNavigate();
  const todayQ = useTodayData();
  const today = todayQ.data?.date;
  const days = today ? diffDays(today, ev.date) : null;
  const past = days != null && days < 0;
  const set = (p: Record<string, unknown>) => patch.mutate({ id: ev.id, patch: p });

  const del = () =>
    remove.mutate(ev.id, {
      onSuccess: (gone) => {
        void navigate(links.season());
        const { id: _id, ...rest } = gone;
        toast.undo(<>Deleted <b>{gone.name}</b></>, () => create.mutate(rest, { onSuccess: (e) => void navigate(links.event(e.id)) }));
      },
    });

  return (
    <Page
      width="page"
      header={
        <PageHeader
          title={<InlineEdit aria-label="Event name" value={ev.name} variant="title" className="w-[min(calc(100vw-var(--rail-w)-7rem),56rem)]" onSave={(v) => patch.mutateAsync({ id: ev.id, patch: { name: v } })} />}
          titleText={ev.name}
          eyebrow={`${ev.priority} race · ${formatDateLong(ev.date, true)}${ev.location ? ` · ${ev.location}` : ''}`}
          glyph={<Flag className={cn('size-6', ev.priority === 'A' ? 'fill-fg-1 text-fg-1' : 'text-fg-3')} />}
          back={{ to: '/season' }}
          breadcrumb={[{ label: 'Season', link: links.season() }]}
          actions={
            <Button size="sm" variant="danger" icon={<Trash2 />} onClick={del}>
              Delete
            </Button>
          }
        />
      }
    >
      <PageItem className="grid items-start gap-12 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:gap-16">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-1">
            <span className="text-label text-fg-3">{past ? 'Raced' : days === 0 ? 'Race day' : 'Countdown'}</span>
            {days == null ? (
              <Skeleton className="h-14 w-40" />
            ) : (
              <span className="flex items-baseline gap-2">
                <span className="text-stat-xl text-fg-1 num">
                  <Odometer value={Math.abs(days)} />
                </span>
                <span className="text-title-3 font-medium text-fg-3">{days === 0 ? 'today' : `day${Math.abs(days) === 1 ? '' : 's'}${past ? ' ago' : ''}`}</span>
              </span>
            )}
            {!past && days != null && days > 6 && (
              <span className="text-body-sm text-fg-3 num">
                {Math.floor(days / 7)} {Math.floor(days / 7) === 1 ? 'week' : 'weeks'}
                {days % 7 ? ` ${days % 7} ${days % 7 === 1 ? 'day' : 'days'}` : ''}
              </span>
            )}
          </div>
          {ev.goal && (
            <div className="flex flex-col gap-0.5">
              <span className="text-label text-fg-3">Goal</span>
              <span className="text-title-2 text-fg-1">{ev.goal}</span>
            </div>
          )}
        </div>
        <RaceDayProjection ev={ev} today={today} />
      </PageItem>

      <Section title="Details">
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-label text-fg-2">Priority</span>
            <Segmented
              aria-label="Priority"
              value={ev.priority}
              onValueChange={(p) => set({ priority: p })}
              options={[
                { value: 'A', label: 'A · main goal' },
                { value: 'B', label: 'B · important' },
                { value: 'C', label: 'C · training' },
              ]}
            />
          </label>
          <DatePicker label="Date" value={ev.date} onValueChange={(d) => set({ date: d })} />
          <Select<Sport> label="Sport" value={ev.sport ?? null} placeholder="Multisport / not set" options={SPORT_OPTS} onValueChange={(s) => set({ sport: s })} />
          <NumberField
            label="Distance"
            unit="km"
            value={ev.distanceM != null ? Math.round(ev.distanceM / 10) / 100 : null}
            min={0}
            step={0.1}
            format={{ maximumFractionDigits: 2 }}
            onValueChange={(v) => set({ distanceM: v == null ? null : Math.round(v * 1000) })}
          />
          <AutoText label="Goal" value={ev.goal ?? ''} placeholder="Sub 1:30, even splits" onSave={(v) => patch.mutateAsync({ id: ev.id, patch: { goal: v || null } })} />
          <AutoText label="Location" value={ev.location ?? ''} placeholder="Where" onSave={(v) => patch.mutateAsync({ id: ev.id, patch: { location: v || null } })} />
        </div>
      </Section>

      <TaperWeeks ev={ev} today={today} />

      {past ? <Result ev={ev} /> : <NotesCard ev={ev} label="Plan & notes" />}
    </Page>
  );
}

function AutoText({ label, value, placeholder, onSave }: { label: string; value: string; placeholder?: string; onSave: (v: string) => Promise<unknown> }) {
  const [v, setV] = useState(value);
  const status = useChangeAutosave(v, (x) => onSave(x.trim()), 700);
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center justify-between text-label text-fg-2">
        {label}
        <SaveIndicator status={status} />
      </span>
      <Input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

function NotesCard({ ev, label }: { ev: Event; label: string }) {
  const { patch } = useEventMutations();
  const [v, setV] = useState(ev.note ?? '');
  const status = useChangeAutosave(v, (x) => patch.mutateAsync({ id: ev.id, patch: { note: x.trim() ? x : null } }), 800);
  return (
    <Section title={label} actions={<SaveIndicator status={status} />}>
      <Textarea aria-label={label} value={v} onChange={(e) => setV(e.target.value)} minRows={5} maxRows={30} placeholder="Course, pacing plan, fuelling, kit list…" />
    </Section>
  );
}

function RaceDayProjection({ ev, today }: { ev: Event; today?: LocalDate }) {
  const past = today ? ev.date < today : false;
  const q = useFitnessTrend(today ? (past ? addDays(ev.date, -1) : today) : undefined, today ? (past ? ev.date : ev.date) : undefined);
  const d = q.data?.days.find((x) => x.date === ev.date);
  const now = q.data?.days.find((x) => x.date === today);
  return (
    <section className="flex flex-col gap-4" aria-label={past ? 'On race day' : 'Projected for race day'}>
      <div className="flex flex-col gap-0.5">
        <h2 className="text-title-3 text-fg-1">{past ? 'On race day' : 'Race day, if you train as planned'}</h2>
      </div>
      {q.isPending ? (
        <Skeleton className="h-20 w-full" />
      ) : !d ? (
        <p className="text-body text-fg-3">Projection starts 8 weeks out. Keep planning — the numbers appear as race day nears.</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-6">
            <Proj label="Form" value={d.form} delta={now && !past ? d.form - now.form : null} signed />
            <Proj label="Fitness" value={d.fitness} delta={now && !past ? d.fitness - now.fitness : null} />
            <Proj label="Fatigue" value={d.fatigue} delta={now && !past ? d.fatigue - now.fatigue : null} />
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-fg-2">
            <FormZoneLabel zone={d.formZone} />
            <span className="text-fg-3">
              {d.formZone === 'fresh' ? 'Right where you want to be.' : d.formZone === 'productive' || d.formZone === 'overreaching' ? 'Still carrying fatigue — a deeper taper would freshen you up.' : d.formZone === 'transition' ? 'Very fresh — maybe too much rest.' : 'Balanced.'}
            </span>
          </p>
        </>
      )}
    </section>
  );
}

function Proj({ label, value, delta, signed }: { label: string; value: number; delta: number | null; signed?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-label text-fg-3">{label}</span>
      <span className="text-stat-md text-fg-1 num">{signed ? formatSigned(Math.round(value)) : Math.round(value)}</span>
      {delta != null && <span className="text-body-sm text-fg-3 num">{formatSigned(Math.round(delta))} from today</span>}
    </div>
  );
}

function TaperWeeks({ ev, today }: { ev: Event; today?: LocalDate }) {
  const q = useWeeklyTrend(4, ev.date);
  const weeks = q.data ?? [];
  const max = Math.max(1, ...weeks.map((w) => Math.max(w.plannedLoad, w.doneLoad, w.targetLoad ?? 0)));
  return (
    <Section title="Into race day" description="The last four weeks: load done against plan.">
      <div className="flex flex-col">
        {q.isPending
          ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="my-2 h-10" />)
          : weeks.map((w, i) => {
              const raceWeek = w.isoWeek === isoWeekOf(ev.date);
              const cur = today ? w.startDate <= today && today <= w.endDate : false;
              return (
                <Link
                  key={w.isoWeek}
                  {...links.calendarWeek(w.isoWeek)}
                  aria-label={`W${Number(w.isoWeek.slice(6))}: ${formatLoad(w.doneLoad)} done of ${formatLoad(w.plannedLoad)} planned load`}
                  className={cn('-mx-3 grid min-h-11 grid-cols-[96px_minmax(0,1fr)_auto] items-center gap-4 rounded-md px-3 py-2.5 outline-none transition-colors duration-(--dur-fast) hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus sm:grid-cols-[140px_minmax(0,1fr)_auto]', i > 0 && 'border-t border-line-1')}
                >
                  <span className="flex flex-col">
                    <span className={cn('text-body font-medium', cur ? 'text-accent-ink' : 'text-fg-1')}>
                      W{Number(w.isoWeek.slice(6))}
                      {raceWeek && <span className="font-normal text-fg-3"> · race week</span>}
                    </span>
                    <span className="text-body-sm text-fg-3">{formatIsoWeekRange(w.isoWeek)}</span>
                  </span>
                  <span className="relative h-1 rounded-full bg-surface-3" aria-hidden>
                    <span className="absolute inset-y-0 left-0 rounded-full bg-gray-7 light:bg-gray-6" style={{ width: `${(w.plannedLoad / max) * 100}%` }} />
                    <motion.span className="absolute inset-y-0 left-0 w-full origin-left rounded-full bg-fg-2" initial={{ scaleX: 0 }} animate={{ scaleX: w.doneLoad / max }} transition={{ ...spring.smooth, delay: i * 0.04 }} />
                    {w.targetLoad != null && <span className="absolute -inset-y-1 w-px bg-fg-3" style={{ left: `${(w.targetLoad / max) * 100}%` }} />}
                  </span>
                  <span className="flex items-baseline gap-3 text-body-sm text-fg-3 num">
                    <span className="max-sm:hidden">{hm(w.doneSec || w.plannedSec)} h</span>
                    <span className="w-28 text-right">
                      {w.doneLoad > 0 ? (
                        <>
                          <span className="text-fg-1">{formatLoad(w.doneLoad)}</span> of {formatLoad(w.plannedLoad)}
                        </>
                      ) : (
                        <>
                          <span className="text-fg-1">{formatLoad(w.plannedLoad)}</span> planned
                        </>
                      )}
                    </span>
                  </span>
                </Link>
              );
            })}
      </div>
    </Section>
  );
}

function Result({ ev }: { ev: Event }) {
  const { patch } = useEventMutations();
  const cal = useCalendar(ev.date, ev.date);
  const acts = cal.data?.activities.filter((a) => a.localDate === ev.date) ?? [];
  const linked = acts.find((a) => a.id === ev.resultActivityId);
  return (
    <>
      <Section title="Result" description={linked ? undefined : 'Pick the activity that was the race.'}>
        {cal.isPending ? (
          <Skeleton className="h-24 rounded-lg" />
        ) : acts.length === 0 ? (
          <p className="text-body text-fg-3">No activities on {formatDateLong(ev.date)}. Sync or upload the race, then link it here.</p>
        ) : (
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Result activity">
            {acts.map((a) => {
              const on = a.id === ev.resultActivityId;
              return (
                <div key={a.id} className={cn('flex flex-col gap-3 rounded-lg p-4 transition-colors duration-(--dur-fast) sm:flex-row sm:items-center', on ? 'bg-surface-2' : 'bg-surface-1')}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => patch.mutate({ id: ev.id, patch: { resultActivityId: on ? null : a.id } })}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-sm text-left outline-none focus-visible:outline-2 focus-visible:outline-focus"
                  >
                    <span className={cn('grid size-9 shrink-0 place-items-center rounded-full', on ? 'bg-surface-active text-fg-1' : 'bg-surface-2 text-fg-3')}>
                      {on ? <Trophy className="size-4" /> : <SportGlyph sport={a.sport} size={16} />}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-body font-medium text-fg-1">{a.title}</span>
                      <span className="text-body-sm text-fg-3 num">
                        {formatDuration(a.durationSec, 'clock')} · {formatLoad(a.load)} load {on ? '· linked result' : '· tap to link'}
                      </span>
                    </span>
                  </button>
                  {on && <SessionStats durationSec={a.durationSec} distanceM={a.distanceM} load={a.load} sport={a.sport} />}
                  <Link {...links.activity(a.id)} className="text-label text-fg-2 underline decoration-line-3 underline-offset-4 hover:text-fg-1">
                    Analysis
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </Section>
      <NotesCard ev={ev} label="Race report" />
    </>
  );
}
