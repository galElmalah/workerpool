/**
 * /week/$isoWeek — the weekly review ritual (product.md §7): plan vs actual, the 7-day strip, key
 * sessions, highlights, intensity, Fitness/Form at week end, wellness, reflection and plan-next-week.
 */
import { SPORT_META, type LocalDate, type Phase, type Sport, type WeekSummary } from '@cadence/core';
import { addDays, addWeeks, isoWeekStart } from '@cadence/core/time';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { CalendarDays, ChevronLeft, ChevronRight, Copy, Flag, Medal, Star, Timer, TriangleAlert } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ProgressRing, SplitBar } from '@/charts';
import { cn } from '@/lib/cn';
import {
  distanceParts,
  formatDayMonth,
  formatDuration,
  formatIsoWeekRange,
  formatNumber,
  formatPercent,
  formatSigned,
  weekdayShort,
} from '@/lib/format';
import { dayCards } from '@/lib/queries/training';
import { distanceUnit, useUnits } from '@/lib/units';
import { Ticker } from '@/motion/Ticker';
import { spring } from '@/motion/tokens';
import { links } from '@/shell/links';
import {
  Button,
  ButtonLink,
  Chip,
  ComplianceGlyph,
  DeltaBadge,
  EmptyState,
  FormZoneLabel,
  IconButton,
  Meter,
  NumberField,
  Page,
  PageHeader,
  SaveIndicator,
  Section,
  Skeleton,
  Slider,
  SportGlyph,
  Textarea,
  WorkoutCard,
  complianceLabel,
  toast,
  type SaveStatus,
} from '@/ui';
import { deleteWorkouts, useApiToday, useCopyWeek, usePhases, useSaveWeekNote, useWeek, useWeekNote, useWeekWellness, type WeekBundle } from './data';

const route = getRouteApi('/_app/week/$isoWeek');

const fmtH = (sec: number) => formatDuration(sec, 'clock');
const fmtInt = (v: number) => formatNumber(v, 0);
const pct = (a: number, b: number | null | undefined) => (b && b > 0 ? a / b - 1 : null);

type Mode = 'past' | 'current' | 'future';

export function WeekPage() {
  const { isoWeek } = route.useParams();
  const today = useApiToday();
  const q = useWeek(isoWeek);
  const start = isoWeekStart(isoWeek);
  const end = addDays(start, 6);
  const mode: Mode = !today ? 'past' : today > end ? 'past' : today < start ? 'future' : 'current';
  const phases = usePhases(start, end);
  const phase = phases.data?.find((p) => p.startDate <= end && p.endDate >= start);
  const wkNo = Number(isoWeek.slice(6));
  const prev = addWeeks(isoWeek, -1);
  const next = addWeeks(isoWeek, 1);
  const navigate = useNavigate();

  return (
    <Page
      width="page"
      header={
        <PageHeader
          title={`Week ${wkNo}`}
          eyebrow={
            <span>
              {formatIsoWeekRange(isoWeek, true)}
              {phase && <> · {phaseLabel(phase, start)}</>}
            </span>
          }
          back={{ to: '/calendar' }}
          meta={<StatusChip mode={mode} reflected={!!q.data?.note?.body} />}
          actions={
            <>
              <IconButton label="Previous week" kbd="k" icon={<ChevronLeft />} size="sm" onClick={() => navigate(links.week(prev))} />
              <IconButton label="Next week" kbd="j" icon={<ChevronRight />} size="sm" onClick={() => navigate(links.week(next))} />
              <ButtonLink {...links.calendarWeek(isoWeek)} size="sm" variant="ghost" icon={<CalendarDays />} className="max-sm:hidden">
                Calendar
              </ButtonLink>
            </>
          }
        />
      }
    >
      <KeyNav prev={prev} next={next} />
      {q.isError && !q.data ? (
        <EmptyState icon={<TriangleAlert />} title="Couldn't load this week" action={<Button onClick={() => q.refetch()}>Retry</Button>}>
          Check your connection and try again.
        </EmptyState>
      ) : !q.data ? (
        <WeekSkeleton />
      ) : (
        <WeekBody key={isoWeek} data={q.data} mode={mode} today={today} phase={phase} />
      )}
    </Page>
  );
}

function KeyNav({ prev, next }: { prev: string; next: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest('input,textarea,[contenteditable],[role=slider]')) return;
      if (e.key === 'k' || e.key === 'ArrowLeft') void navigate(links.week(prev));
      if (e.key === 'j' || e.key === 'ArrowRight') void navigate(links.week(next));
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [prev, next, navigate]);
  return null;
}

function phaseLabel(p: Phase, start: LocalDate) {
  const total = Math.round((Date.parse(p.endDate) - Date.parse(p.startDate)) / 864e5 + 1) / 7;
  const idx = Math.floor((Date.parse(start) - Date.parse(p.startDate)) / (7 * 864e5)) + 1;
  return `${p.label} wk ${idx}/${Math.max(1, Math.round(total))}`;
}

function StatusChip({ mode, reflected }: { mode: Mode; reflected: boolean }) {
  if (mode === 'future') return <Chip tone="outline">Planned</Chip>;
  if (mode === 'current') return <Chip tone="signal">In progress</Chip>;
  return <Chip tone="neutral">{reflected ? 'Reviewed ✓' : 'Complete · not reviewed'}</Chip>;
}

function WeekSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-hidden>
      <div className="grid gap-3 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[148px] rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-[220px] rounded-xl" />
      <Skeleton className="h-[180px] rounded-xl" />
    </div>
  );
}

// ───────────────────────── body ─────────────────────────

function WeekBody({ data, mode, today, phase }: { data: WeekBundle; mode: Mode; today?: LocalDate; phase?: Phase }) {
  const s = data.summary as WeekSummary;
  const p = data.previous as WeekSummary | undefined;
  return (
    <>
      <Section title={mode === 'future' ? 'The plan' : mode === 'current' ? 'So far' : 'Plan vs actual'}>
        <Headline s={s} p={p} mode={mode} />
      </Section>
      <Section title="Day by day" actions={<span className="text-body-sm text-fg-3 max-sm:hidden">Click a session to open it</span>}>
        <DayStrip data={data} today={today} mode={mode} />
      </Section>
      {mode !== 'future' && (
        <div className="grid gap-8 lg:grid-cols-2">
          <Section title="Key sessions">
            <KeySessions data={data} />
          </Section>
          <Section title="Highlights">
            <Highlights data={data} />
          </Section>
        </div>
      )}
      <Section title="By sport">
        <BySport s={s} mode={mode} />
      </Section>
      {mode !== 'future' && (
        <Section title="Body & balance">
          <Balance data={data} />
        </Section>
      )}
      <Section title={mode === 'future' ? 'Intentions' : 'Reflection'} id="reflection">
        <Reflection data={data} mode={mode} />
      </Section>
      {mode !== 'future' && (
        <Section title={`Plan week ${Number(addWeeks(data.isoWeek, 1).slice(6))}`} id="plan-next">
          <PlanNext data={data} phase={phase} />
        </Section>
      )}
    </>
  );
}

// ───────────────────────── headline ─────────────────────────

function Headline({ s, p, mode }: { s: WeekSummary; p?: WeekSummary; mode: Mode }) {
  const units = useUnits();
  const du = distanceUnit('run', units);
  const done = mode === 'future' ? 0 : 1;
  const cards = [
    { label: 'Hours', done: s.doneSec / 3600, planned: s.plannedSec / 3600, proj: s.projectedSec / 3600, target: s.targetHours, prev: p ? p.doneSec / 3600 : null, fmt: (h: number) => fmtH(h * 3600), unit: 'h', signal: false },
    { label: 'Load', done: s.doneLoad, planned: s.plannedLoad, proj: s.projectedLoad, target: s.targetLoad, prev: p?.doneLoad ?? null, fmt: fmtInt, unit: '', signal: true },
    { label: 'Distance', done: s.doneDistanceM / du.mPer, planned: s.plannedDistanceM / du.mPer, proj: Math.max(s.doneDistanceM, s.plannedDistanceM) / du.mPer, target: undefined, prev: p ? p.doneDistanceM / du.mPer : null, fmt: fmtInt, unit: du.unit, signal: false },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-3">
        {cards.map((c, i) => {
          const value = done ? c.done : c.planned;
          return (
            <motion.div key={c.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.smooth, delay: i * 0.035 }} className="flex min-w-0 items-center gap-4 rounded-xl border border-line-1 bg-surface-1 p-4 md:p-5">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="text-micro uppercase text-fg-3">{c.label}{mode === 'current' ? ' · so far' : mode === 'future' ? ' · planned' : ''}</span>
                <span className={cn('flex items-baseline gap-1 text-stat-lg', c.signal && done ? 'text-accent-ink' : 'text-fg-1')}>
                  <Ticker value={value} format={c.fmt} from={0} />
                  {c.unit && <span className="text-[1.25rem] font-[450] tracking-normal text-fg-3">{c.unit}</span>}
                </span>
                {done ? (
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-mono-sm text-fg-3">
                    <span>
                      of <span className="text-fg-1">{c.fmt(c.planned)}</span> planned
                    </span>
                    {c.target ? (
                      <span>
                        · target <span className="text-fg-1">{c.fmt(c.target)}</span>
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span className="font-mono text-mono-sm text-fg-3">{c.target ? `target ${c.fmt(c.target)}` : 'no target set'}</span>
                )}
                {mode !== 'future' && (
                  <span className="flex items-center gap-1.5">
                    <DeltaBadge value={pct(c.done, c.prev)} good={c.signal && (pct(c.done, c.prev) ?? 0) > 0 && (pct(c.done, c.prev) ?? 0) <= 0.15} warning={c.signal && (pct(c.done, c.prev) ?? 0) > 0.15 && mode === 'past'} />
                    <span className="text-body-sm text-fg-3">vs last week ({c.prev == null ? '—' : c.fmt(c.prev)})</span>
                  </span>
                )}
                {mode === 'current' && c.proj > c.done && (
                  <Meter value={c.done} max={c.proj} ghost={c.proj} target={c.target} size="xs" className="mt-1" aria-label={`${c.label} so far vs plan`} />
                )}
              </div>
              {mode !== 'future' && <ProgressRing done={c.done} planned={c.planned} size={64} stroke={5} />}
            </motion.div>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MiniStat label="Compliance" value={s.compliancePct == null ? '—' : `${Math.round(s.compliancePct)}%`} sub={p?.compliancePct != null && s.compliancePct != null ? <DeltaBadge value={(s.compliancePct ?? 0) - p.compliancePct} kind="number" suffix="pts" size="sm" /> : null} />
        <MiniStat
          label="Key sessions"
          value={
            <span>
              {s.keyDone}
              <span className="text-fg-3"> / {s.keyPlanned}</span>
            </span>
          }
          sub={<KeyPips done={s.keyDone} planned={s.keyPlanned} />}
        />
        <MiniStat
          label={`Fitness ${mode === 'past' ? 'at week end' : 'projected'}`}
          value={<span className="text-accent-ink">{fmtInt(s.fitness)}</span>}
          sub={
            <span className="flex items-center gap-1.5">
              <DeltaBadge value={s.fitnessDelta} kind="number" decimals={1} good={s.fitnessDelta > 0} size="sm" />
              <span className="text-body-sm text-fg-3">ramp</span>
            </span>
          }
        />
        <MiniStat
          label="Form at week end"
          value={formatSigned(Math.round(s.form))}
          sub={
            <span className="flex items-center gap-2">
              <FormZoneLabel zone={s.formZone} />
              {p && <span className="font-mono text-mono-sm text-fg-3">was {formatSigned(Math.round(p.form))}</span>}
            </span>
          }
        />
      </div>
    </div>
  );
}

function KeyPips({ done, planned }: { done: number; planned: number }) {
  if (!planned) return <span className="text-body-sm text-fg-3">None planned</span>;
  return (
    <span className="flex items-center gap-1" aria-label={`${done} of ${planned} key sessions done`}>
      {Array.from({ length: planned }, (_, i) => (
        <Star key={i} className={cn('size-3.5', i < done ? 'fill-accent text-accent-ink' : 'text-fg-4')} strokeWidth={1.75} />
      ))}
    </span>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-line-1 bg-surface-1 p-4">
      <span className="truncate text-micro uppercase text-fg-3">{label}</span>
      <span className="text-stat-sm text-fg-1">{value}</span>
      <span className="min-h-5">{sub}</span>
    </div>
  );
}

// ───────────────────────── day strip ─────────────────────────

const MARKER_LABEL: Record<string, string> = { rest: 'Rest', sick: 'Sick', injured: 'Injured', travel: 'Travel', vacation: 'Vacation', altitude: 'Altitude' };

function DayStrip({ data, today, mode }: { data: WeekBundle; today?: LocalDate; mode: Mode }) {
  const s = data.summary as WeekSummary;
  const plannedDaily = data.days.map((d) => d.workouts.filter((w) => w.status !== 'skipped').reduce((a, w) => a + (w.plannedLoad ?? 0), 0));
  const max = Math.max(1, ...s.dailyLoad, ...plannedDaily);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col divide-y divide-line-1 overflow-hidden rounded-xl border border-line-1 bg-surface-1">
        {data.days.map((d, i) => {
          const cards = dayCards({ workouts: d.workouts, activities: d.activities }, d.date);
          const isToday = d.date === today;
          const load = s.dailyLoad[i];
          const plan = plannedDaily[i];
          return (
            <motion.div
              key={d.date}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...spring.smooth, delay: Math.min(i * 0.03, 0.24) }}
              className={cn('relative grid min-w-0 grid-cols-[56px_1fr] items-start gap-x-3 gap-y-2 px-3 py-3 md:grid-cols-[72px_1fr_200px] md:px-4', isToday && 'bg-surface-2')}
            >
              {isToday && <span className="absolute inset-y-0 left-0 w-0.5 bg-accent" aria-hidden />}
              <Link {...links.calendarDay(d.date)} aria-label={`Open ${weekdayShort(d.date)} ${formatDayMonth(d.date)}`} className="group/day flex flex-col self-start rounded-xs pt-1 outline-none focus-visible:outline-2 focus-visible:outline-focus">
                <span className={cn('text-micro uppercase', isToday ? 'text-accent-ink' : 'text-fg-3')}>{isToday ? 'Today' : weekdayShort(d.date)}</span>
                <span className="font-mono text-mono-sm text-fg-2 group-hover/day:text-fg-1 group-hover/day:underline">{formatDayMonth(d.date)}</span>
              </Link>
              <div className="flex min-w-0 flex-wrap gap-2">
                {d.markers.map((m) => (
                  <Chip key={m.id} tone="outline" className="self-center">
                    {MARKER_LABEL[m.type] ?? m.type}
                    {m.label ? ` · ${m.label}` : ''}
                  </Chip>
                ))}
                {cards.length === 0 && !d.markers.length && <span className="py-1.5 text-body-sm text-fg-4">Rest day</span>}
                {cards.map((c) => (
                  <WorkoutCard
                    key={c.key}
                    model={c.model}
                    density="full"
                    className="w-full sm:w-[244px]"
                    link={c.target.type === 'activity' ? links.activity(c.target.id) : links.workout(c.target.id)}
                  />
                ))}
              </div>
              <div className="col-span-2 flex items-center gap-2 md:col-span-1 md:pt-1.5">
                <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
                  {plan > load && <span className="absolute inset-y-0 left-0 rounded-full border border-dashed border-line-3 bg-hatch-faint" style={{ width: `${(plan / max) * 100}%` }} />}
                  <motion.span className="absolute inset-y-0 left-0 origin-left rounded-full bg-accent" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ ...spring.gentle, delay: Math.min(i * 0.012, 0.24) }} style={{ width: `${(load / max) * 100}%` }} />
                </div>
                <span className="w-24 text-right font-mono text-mono-sm text-fg-2">
                  {d.activities.length > 0 && <span className="text-fg-3">{fmtH(d.activities.reduce((a, x) => a + (x.movingSec || x.durationSec), 0))} · </span>}
                  {load ? fmtInt(load) : '—'}
                  {plan > 0 && mode !== 'past' ? <span className="text-fg-4"> /{fmtInt(plan)}</span> : null}
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>
      <p className="text-body-sm text-fg-3">Right: Load per day — green done, dashed planned. Missed sessions are dimmed and struck through.</p>
    </div>
  );
}

// ───────────────────────── key sessions ─────────────────────────

function KeySessions({ data }: { data: WeekBundle }) {
  if (!data.keySessions.length) return <EmptyState size="sm" icon={<Star />} title="No key sessions this week">Mark a workout as key to track it here.</EmptyState>;
  return (
    <ul className="flex flex-col divide-y divide-line-1 rounded-xl border border-line-1 bg-surface-1">
      {data.keySessions.map((k) => {
        const w = k.workout;
        const a = 'activity' in k ? k.activity : undefined;
        const st = k.compliance?.state ?? 'planned';
        const missed = st === 'missed' || st === 'excused';
        return (
          <li key={w.id}>
            <Link {...(a ? links.activity(a.id) : links.workout(w.id))} className={cn('flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2', missed && 'opacity-70')}>
              <SportGlyph sport={w.sport} subSport={w.subSport} size={20} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className={cn('truncate text-body text-fg-1', missed && 'line-through decoration-fg-3')}>{w.title}</span>
                <span className="font-mono text-mono-sm text-fg-3">
                  {weekdayShort(w.date)} · {a ? `${fmtH(a.movingSec || a.durationSec)} · Load ${fmtInt(a.load)}` : `${w.plannedDurationSec ? fmtH(w.plannedDurationSec) : '—'} planned`}
                  {w.plannedLoad ? ` / ${fmtInt(w.plannedLoad)} planned` : ''}
                </span>
              </div>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-body-sm text-fg-2 max-sm:hidden">{complianceLabel(st, w.skipReason)}</span>
                {k.compliance?.ratio && !missed ? <span className="font-mono text-mono-sm text-fg-1">{Math.round(k.compliance.ratio * 100)}%</span> : null}
                <ComplianceGlyph state={st} size={14} />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// ───────────────────────── highlights ─────────────────────────

const DUR_LABEL: Record<number, string> = { 5: '5 s', 60: '1 min', 300: '5 min', 1200: '20 min', 3600: '60 min' };

function Highlights({ data }: { data: WeekBundle }) {
  const units = useUnits();
  const h = data.highlights;
  const items: { icon: ReactNode; label: string; title: string; value: string; link?: ReturnType<typeof links.activity> }[] = [];
  if (h.longest) items.push({ icon: <Timer />, label: 'Longest', title: h.longest.title, value: fmtH(h.longest.movingSec || h.longest.durationSec), link: links.activity(h.longest.id) });
  if (h.biggestLoad) items.push({ icon: <Flag />, label: 'Biggest Load', title: h.biggestLoad.title, value: fmtInt(h.biggestLoad.load), link: links.activity(h.biggestLoad.id) });
  if (h.biggestLoadDay) items.push({ icon: <CalendarDays />, label: 'Biggest day', title: `${weekdayShort(h.biggestLoadDay.date)} ${formatDayMonth(h.biggestLoadDay.date)}`, value: fmtInt(h.biggestLoadDay.load) });
  for (const b of h.newBests.slice(0, 4)) {
    const what = b.kind === 'power' ? `${DUR_LABEL[b.durationSec ?? 0] ?? `${b.durationSec}s`} power` : `${(() => { const d = distanceParts(b.distanceM, b.sport, units); return `${d.value} ${d.unit}`; })()}`;
    const val = b.kind === 'power' ? `${fmtInt(b.value)} W` : formatDuration(b.value, 'hms');
    const prevV = b.previous == null ? '' : b.kind === 'power' ? ` (was ${fmtInt(b.previous)})` : ` (was ${formatDuration(b.previous, 'hms')})`;
    items.push({ icon: <Medal />, label: `New best · ${SPORT_META[b.sport].label}`, title: what + prevV, value: val, link: links.activity(b.activityId) });
  }
  if (!items.length) return <EmptyState size="sm" icon={<Medal />} title="Nothing recorded yet">Highlights appear as sessions are completed.</EmptyState>;
  return (
    <ul className="flex flex-col divide-y divide-line-1 rounded-xl border border-line-1 bg-surface-1">
      {items.map((it, i) => {
        const inner = (
          <>
            <span className={cn('grid size-8 shrink-0 place-items-center rounded-md bg-surface-2 text-fg-2 [&_svg]:size-4', it.label.startsWith('New best') && 'bg-accent-a2 text-accent-ink')}>{it.icon}</span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-micro uppercase text-fg-3">{it.label}</span>
              <span className="truncate text-body text-fg-1">{it.title}</span>
            </span>
            <span className="font-mono text-mono text-fg-1">{it.value}</span>
          </>
        );
        return (
          <li key={i}>
            {it.link ? (
              <Link {...it.link} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2">
                {inner}
              </Link>
            ) : (
              <div className="flex items-center gap-3 px-4 py-3">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ───────────────────────── by sport ─────────────────────────

function BySport({ s, mode }: { s: WeekSummary; mode: Mode }) {
  const units = useUnits();
  const rows = [...s.bySport].filter((r) => r.doneSec > 0 || r.plannedSec > 0).sort((a, b) => b.doneSec + b.plannedSec - (a.doneSec + a.plannedSec));
  if (!rows.length) return <EmptyState size="sm" icon={<CalendarDays />} title="Nothing planned or done">Plan this week on the calendar.</EmptyState>;
  const totalDone = rows.reduce((a, r) => a + r.doneSec, 0) || 1;
  const dist = (m: number, sp: Sport) => {
    if (!SPORT_META[sp].hasDistance || !m) return '—';
    const d = distanceParts(m, sp, units);
    return `${d.value} ${d.unit}`;
  };
  const future = mode === 'future';
  return (
    <div className="overflow-x-auto rounded-xl border border-line-1 bg-surface-1">
      <table className="w-full min-w-[560px] text-left">
        <thead>
          <tr className="border-b border-line-1 text-micro uppercase text-fg-3">
            <th className="px-4 py-2.5 font-[600]">Sport</th>
            <th className="px-3 py-2.5 text-right font-[600]">Sessions</th>
            <th className="px-3 py-2.5 text-right font-[600]">Time{future ? '' : ' done / plan'}</th>
            <th className="px-3 py-2.5 text-right font-[600]">Distance</th>
            <th className="px-3 py-2.5 text-right font-[600]">Load</th>
            {!future && <th className="w-[22%] px-4 py-2.5 font-[600]">Share of time</th>}
          </tr>
        </thead>
        <tbody className="font-mono text-mono">
          {rows.map((r) => (
            <tr key={r.sport} className="border-b border-line-1 last:border-0">
              <td className="px-4 py-2.5">
                <span className="inline-flex items-center gap-2 font-sans text-body text-fg-1">
                  <SportGlyph sport={r.sport} size={16} />
                  {SPORT_META[r.sport].label}
                </span>
              </td>
              <td className="px-3 py-2.5 text-right text-fg-1">{future ? r.plannedCount : <>{r.doneCount}<span className="text-fg-3">/{r.plannedCount}</span></>}</td>
              <td className="px-3 py-2.5 text-right text-fg-1">{future ? fmtH(r.plannedSec) : <>{fmtH(r.doneSec)}<span className="text-fg-3"> / {fmtH(r.plannedSec)}</span></>}</td>
              <td className="px-3 py-2.5 text-right text-fg-1">{dist(future ? r.plannedDistanceM : r.doneDistanceM, r.sport)}</td>
              <td className="px-3 py-2.5 text-right text-fg-1">{fmtInt(future ? r.plannedLoad : r.doneLoad)}</td>
              {!future && (
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                      <motion.span className="block h-full origin-left rounded-full bg-fg-2" initial={{ scaleX: 0 }} animate={{ scaleX: r.doneSec / totalDone }} transition={spring.gentle} />
                    </span>
                    <span className="w-9 text-right text-mono-sm text-fg-3">{Math.round((r.doneSec / totalDone) * 100)}%</span>
                  </span>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ───────────────────────── intensity + wellness ─────────────────────────

function Balance({ data }: { data: WeekBundle }) {
  const s = data.summary as WeekSummary;
  const p = data.previous as WeekSummary | undefined;
  const start = isoWeekStart(data.isoWeek);
  const well = useWeekWellness(addDays(start, -7), addDays(start, 6));
  const avg = (from: LocalDate, to: LocalDate, f: (d: NonNullable<typeof well.data>['days'][number]) => number | undefined) => {
    const v = (well.data?.days ?? []).filter((d) => d.date >= from && d.date <= to).map(f).filter((x): x is number => typeof x === 'number');
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const end = addDays(start, 6);
  const ps = addDays(start, -7);
  const pe = addDays(start, -1);
  const rows = [
    { label: 'HRV', unit: 'ms', cur: avg(start, end, (d) => d.hrvMs), prev: avg(ps, pe, (d) => d.hrvMs), fmt: (v: number) => fmtInt(v), higherGood: true },
    { label: 'Resting HR', unit: 'bpm', cur: avg(start, end, (d) => d.restingHr), prev: avg(ps, pe, (d) => d.restingHr), fmt: (v: number) => fmtInt(v), higherGood: false },
    { label: 'Sleep', unit: '/night', cur: avg(start, end, (d) => d.sleepSec), prev: avg(ps, pe, (d) => d.sleepSec), fmt: (v: number) => fmtH(v), higherGood: true },
  ];
  const t = s.intensitySec.easy + s.intensitySec.moderate + s.intensitySec.hard;
  const pt = p ? p.intensitySec.easy + p.intensitySec.moderate + p.intensitySec.hard : 0;
  const w = data.wellness;
  const sentence =
    w.hrvVsBaselinePct != null
      ? `HRV averaged ${Math.abs(w.hrvVsBaselinePct)}% ${w.hrvVsBaselinePct >= 0 ? 'above' : 'below'} baseline${w.avgSleepSec ? `; sleep ${fmtH(w.avgSleepSec)} a night` : ''}.`
      : null;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="flex flex-col gap-4 rounded-xl border border-line-1 bg-surface-1 p-4 md:p-5">
        <div className="flex items-baseline justify-between">
          <span className="text-micro uppercase text-fg-3">Intensity split</span>
          <span className="font-mono text-mono-sm text-fg-3">by time in zone</span>
        </div>
        {t > 0 ? (
          <>
            <SplitRow label="This week" split={s.intensitySec} total={t} />
            {p && pt > 0 && <SplitRow label="Last week" split={p.intensitySec} total={pt} dim />}
            <p className="text-body-sm text-fg-3">Target ≈ 80 % easy · 5 % moderate · 15 % hard.</p>
          </>
        ) : (
          <span className="text-body-sm text-fg-3">No completed time yet.</span>
        )}
      </div>
      <div className="flex flex-col gap-4 rounded-xl border border-line-1 bg-surface-1 p-4 md:p-5">
        <div className="flex items-baseline justify-between">
          <span className="text-micro uppercase text-fg-3">Wellness · weekly average</span>
          <span className="font-mono text-mono-sm text-fg-3">vs prior week</span>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {rows.map((r) => (
            <div key={r.label} className="flex min-w-0 flex-col gap-1">
              <span className="text-micro uppercase text-fg-3">{r.label}</span>
              <span className="flex items-baseline gap-1 text-stat-sm text-fg-1">
                {r.cur == null ? '—' : r.fmt(r.cur)}
                <span className="text-body-sm text-fg-3">{r.unit}</span>
              </span>
              <DeltaBadge value={r.cur != null && r.prev ? r.cur / r.prev - 1 : null} size="sm" good={r.cur != null && r.prev != null && (r.higherGood ? r.cur > r.prev : r.cur < r.prev)} />
            </div>
          ))}
        </div>
        {sentence && <p className="text-body-sm text-fg-2">{sentence}</p>}
      </div>
    </div>
  );
}

function SplitRow({ label, split, total, dim }: { label: string; split: { easy: number; moderate: number; hard: number }; total: number; dim?: boolean }) {
  const pc = (v: number) => `${Math.round((v / total) * 100)}%`;
  return (
    <div className={cn('flex flex-col gap-1.5', dim && 'opacity-60')}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-label text-fg-1">{label}</span>
        <span className="font-mono text-mono-sm text-fg-2">
          easy {pc(split.easy)} · mod {pc(split.moderate)} · hard {pc(split.hard)}
        </span>
      </div>
      <SplitBar {...split} height={10} />
    </div>
  );
}

// ───────────────────────── reflection ─────────────────────────

function Reflection({ data, mode }: { data: WeekBundle; mode: Mode }) {
  const save = useSaveWeekNote();
  const [body, setBody] = useState(data.note?.body ?? '');
  const status = useAutosaveChanges(body, (v) => save.mutateAsync({ isoWeek: data.isoWeek, body: v }), { delay: 700 });
  const prompts = mode === 'future' ? ['Focus for the week', 'What must not slip?', 'Life constraints'] : ['What went well?', "What didn't?", 'Focus for next week'];
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line-1 bg-surface-1 p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {prompts.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setBody((b) => (b.trim() ? `${b.trimEnd()}\n\n${p}\n` : `${p}\n`))}
              className="h-6 rounded-sm border border-dashed border-line-3 px-2 text-label text-fg-2 transition-colors hover:border-line-3 hover:text-fg-1"
            >
              + {p}
            </button>
          ))}
        </div>
        <SaveIndicator status={status} />
      </div>
      <Textarea
        aria-label="Weekly reflection"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        minRows={6}
        maxRows={24}
        placeholder={mode === 'future' ? 'What is this week for?' : 'What went well? What would you change? One line is enough.'}
        className="!border-0 !bg-transparent !px-0 text-body-lg"
      />
      <p className="text-body-sm text-fg-4">Autosaves · appears in your journal and on the calendar week.</p>
    </div>
  );
}

// ───────────────────────── plan next week ─────────────────────────

function suggestion(s: WeekSummary, phase?: Phase): { pct: number; why: string } {
  if (phase && (phase.type === 'build' || phase.type === 'base')) {
    const total = Math.round((Date.parse(phase.endDate) - Date.parse(phase.startDate)) / (7 * 864e5));
    const idx = Math.floor((Date.parse(s.startDate) - Date.parse(phase.startDate)) / (7 * 864e5)) + 1;
    if (total >= 3 && idx === total) return { pct: -35, why: `Week ${idx} of ${total} in ${phase.label}: a recovery week is suggested.` };
  }
  const c = s.compliancePct ?? 0;
  const f = s.formPct ?? 0;
  if (c >= 90 && f >= -30) return { pct: 5, why: `Compliance ${Math.round(c)}% and Form ${formatSigned(Math.round(f))}%: ready to progress.` };
  if (c >= 70 && f >= -30) return { pct: 0, why: `Compliance ${Math.round(c)}%: repeat the load before adding more.` };
  return { pct: -10, why: f < -30 ? `Form ${Math.round(f)}% is deep: back off a little.` : `Compliance ${Math.round(c)}%: make next week more doable.` };
}

function PlanNext({ data, phase }: { data: WeekBundle; phase?: Phase }) {
  const s = data.summary as WeekSummary;
  const n = data.next.summary as WeekSummary | undefined;
  const nextWeek = addWeeks(data.isoWeek, 1);
  const sug = useMemo(() => suggestion(s, phase), [s, phase]);
  const [p, setP] = useState(sug.pct);
  const copy = useCopyWeek();
  const navigate = useNavigate();
  const factor = 1 + p / 100;
  const addSec = s.plannedSec * factor;
  const addLoad = s.plannedLoad * factor;
  const haveSec = n?.plannedSec ?? 0;
  const haveLoad = n?.plannedLoad ?? 0;
  const count = data.days.reduce((a, d) => a + d.workouts.length, 0);
  // Fitness after a week of constant daily load L/7 (42-day EWMA): Δ ≈ (L/7 − F)·(1 − e^(−7/42)).
  const ramp = ((addLoad + haveLoad) / 7 - s.fitness) * (1 - Math.exp(-7 / 42));

  const apply = async () => {
    try {
      const created = await copy.mutateAsync({ fromWeek: data.isoWeek, toWeek: nextWeek, progressionPct: p });
      const ids = created.map((w) => w.id);
      const totSec = created.reduce((a, w) => a + (w.plannedDurationSec ?? 0), 0);
      const totLoad = created.reduce((a, w) => a + (w.plannedLoad ?? 0), 0);
      toast.undo(
        <>
          Planned <b>W{Number(nextWeek.slice(6))}</b>: {created.length} workouts · {fmtH(totSec)} h · {fmtInt(totLoad)} Load
        </>,
        () => void deleteWorkouts(ids).then(() => toast('Copy undone')),
        {
          description: (
            <button type="button" className="text-label text-fg-1 underline underline-offset-3" onClick={() => navigate(links.calendarWeek(nextWeek))}>
              Open calendar
            </button>
          ),
        },
      );
    } catch (e) {
      toast.error(`Couldn't copy the week: ${(e as Error).message}`);
    }
  };

  return (
    <div className="grid gap-3 lg:grid-cols-5">
      <div className="flex flex-col gap-4 rounded-xl border border-line-1 bg-surface-1 p-4 md:p-5 lg:col-span-2">
        <span className="text-micro uppercase text-fg-3">Already planned for W{Number(nextWeek.slice(6))}</span>
        {n && n.plannedSec > 0 ? (
          <>
            <div className="flex items-baseline gap-6">
              <span className="flex items-baseline gap-1 text-stat-md text-fg-1">{fmtH(n.plannedSec)}<span className="text-body text-fg-3">h</span></span>
              <span className="flex items-baseline gap-1 text-stat-md text-fg-1">{fmtInt(n.plannedLoad)}<span className="text-body text-fg-3">Load</span></span>
            </div>
            <span className="font-mono text-mono-sm text-fg-3">
              {data.next.workoutCount} workouts · {data.next.keyCount} key · {formatPercent(pct(n.plannedLoad, s.plannedLoad) ?? 0, { signed: true })} Load vs this week's plan
            </span>
            <span className="flex flex-wrap gap-1.5">
              {n.bySport.filter((x) => x.plannedSec > 0).map((x) => (
                <Chip key={x.sport} size="sm" icon={<SportGlyph sport={x.sport} size={14} />}>
                  {fmtH(x.plannedSec)}
                </Chip>
              ))}
            </span>
          </>
        ) : (
          <p className="text-body text-fg-2">Nothing planned yet. Copy this week forward to start from what worked.</p>
        )}
        <TargetFields isoWeek={nextWeek} suggestHours={(s.plannedSec / 3600) * (1 + sug.pct / 100)} suggestLoad={s.plannedLoad * (1 + sug.pct / 100)} />
        <ButtonLink {...links.calendarWeek(nextWeek)} variant="outline" size="sm" icon={<CalendarDays />} className="self-start">
          Open W{Number(nextWeek.slice(6))} in the calendar
        </ButtonLink>
      </div>
      <div className="flex flex-col gap-4 rounded-xl border border-line-1 bg-surface-1 p-4 md:p-5 lg:col-span-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-micro uppercase text-fg-3">Copy this week forward</span>
          <span className="text-body-sm text-fg-3">{count} workouts from W{Number(data.isoWeek.slice(6))}</span>
        </div>
        <p className="text-body text-fg-2">
          Suggested <span className="font-mono text-fg-1">{formatSigned(sug.pct)}%</span> · {sug.why}
        </p>
        <Slider
          label="Progression"
          value={p}
          onValueChange={setP}
          min={-40}
          max={20}
          step={5}
          ticks
          valueLabel={<span className="font-mono text-mono text-fg-1">{formatSigned(p)}%</span>}
        />
        <div className="grid grid-cols-2 gap-4 border-t border-line-1 pt-4 sm:grid-cols-3">
          <PreviewStat label="Copied hours ≈" value={addSec / 3600} fmt={(v) => fmtH(v * 3600)} sub={`from ${fmtH(s.plannedSec)}`} />
          <PreviewStat label="Copied Load ≈" value={addLoad} fmt={fmtInt} sub={`from ${fmtInt(s.plannedLoad)}`} accent />
          {haveSec > 0 ? (
            <PreviewStat label={`W${Number(nextWeek.slice(6))} total after`} value={(addSec + haveSec) / 3600} fmt={(v) => fmtH(v * 3600)} sub={`${fmtInt(addLoad + haveLoad)} Load · adds to the existing plan`} />
          ) : (
            <PreviewStat label="Fitness ramp ≈" value={ramp} fmt={(v) => formatSigned(v, 1)} sub="per week" />
          )}
        </div>
        <AnimatePresence initial={false}>
          {haveSec > 0 && (
            <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="flex items-center gap-2 text-body-sm text-fg-2">
              <TriangleAlert className="size-3.5 shrink-0" /> W{Number(nextWeek.slice(6))} already has a plan. Copying adds these workouts on top; undo removes only the copies.
            </motion.p>
          )}
        </AnimatePresence>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" icon={<Copy />} loading={copy.isPending} onClick={apply} disabled={!count}>
            Copy to W{Number(nextWeek.slice(6))} at {formatSigned(p)}%
          </Button>
          {p !== sug.pct && (
            <Button variant="ghost" size="sm" onClick={() => setP(sug.pct)}>
              Reset to suggestion
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function PreviewStat({ label, value, fmt, sub, accent }: { label: string; value: number; fmt: (v: number) => string; sub: string; accent?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="truncate text-micro uppercase text-fg-3">{label}</span>
      <span className={cn('text-stat-sm', accent ? 'text-accent-ink' : 'text-fg-1')}>
        <Ticker value={value} format={fmt} />
      </span>
      <span className="truncate font-mono text-mono-sm text-fg-3">{sub}</span>
    </div>
  );
}

function TargetFields({ isoWeek, suggestHours, suggestLoad }: { isoWeek: string; suggestHours: number; suggestLoad: number }) {
  const save = useSaveWeekNote();
  const noteQ = useNoteFor(isoWeek);
  const [h, setH] = useState<number | null>(null);
  const [l, setL] = useState<number | null>(null);
  useEffect(() => {
    if (noteQ.isSuccess) {
      setH(noteQ.data?.targetHours ?? null);
      setL(noteQ.data?.targetLoad ?? null);
    }
  }, [noteQ.isSuccess, noteQ.data]);
  const val = useMemo(() => ({ h, l }), [h, l]);
  const status = useAutosaveChanges(val, (v) => save.mutateAsync({ isoWeek, body: noteQ.data?.body ?? '', targetHours: v.h, targetLoad: v.l }), { delay: 700, baselineKey: noteQ.isSuccess ? JSON.stringify({ h: noteQ.data?.targetHours ?? null, l: noteQ.data?.targetLoad ?? null }) : null });
  return (
    <div className="flex flex-col gap-2 border-t border-line-1 pt-4">
      <div className="flex items-center justify-between">
        <span className="text-micro uppercase text-fg-3">Targets for W{Number(isoWeek.slice(6))}</span>
        <SaveIndicator status={status} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Hours" value={h} onValueChange={setH} min={0} max={40} step={0.5} unit="h" />
        <NumberField label="Load" value={l} onValueChange={setL} min={0} max={3000} step={10} />
      </div>
      {h == null && l == null && (
        <button type="button" className="self-start text-label text-fg-2 underline decoration-line-3 underline-offset-3 hover:text-fg-1" onClick={() => { setH(Math.round(suggestHours * 2) / 2); setL(Math.round(suggestLoad / 10) * 10); }}>
          Use suggestion: {fmtH(suggestHours * 3600)} h · {fmtInt(suggestLoad)} Load
        </button>
      )}
    </div>
  );
}

const useNoteFor = useWeekNote;

/**
 * Autosave that only fires for real edits: compares against the last saved (or server) value, so
 * mounting, StrictMode re-runs and server refreshes never write or flash "Saved".
 */
function useAutosaveChanges<T>(value: T, save: (v: T) => Promise<unknown>, opts: { delay?: number; baselineKey?: string | null }): SaveStatus {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const key = JSON.stringify(value);
  const [base, setBase] = useState<string | null>(opts.baselineKey === undefined ? key : null);
  useEffect(() => {
    if (opts.baselineKey != null && base == null) setBase(opts.baselineKey);
  }, [opts.baselineKey, base]);
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (base == null || key === base) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setStatus('saving');
      try {
        await saveRef.current(JSON.parse(key) as T);
        if (cancelled) return;
        setBase(key);
        setStatus('saved');
      } catch {
        if (!cancelled) setStatus('error');
      }
    }, opts.delay ?? 600);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [key, base, opts.delay]);
  useEffect(() => {
    if (status !== 'saved') return;
    const t = setTimeout(() => setStatus('idle'), 2400);
    return () => clearTimeout(t);
  }, [status]);
  return status;
}
