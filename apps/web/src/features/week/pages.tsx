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
import { SplitBar } from '@/charts';
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
  IconButton,
  NumberField,
  Page,
  PageHeader,
  SaveIndicator,
  Section,
  Skeleton,
  StatRow,
  StatTile,
  Slider,
  TableScroll,
  SportGlyph,
  sportColor,
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
  const text = mode === 'future' ? 'Planned' : mode === 'current' ? 'In progress' : reflected ? 'Reviewed' : 'Complete, not reviewed yet';
  return <span className="text-body-sm text-fg-3">{text}</span>;
}

function WeekSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-hidden>
      <Skeleton className="h-7 w-3/4" />
      <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[84px]" />
        ))}
      </div>
      <Skeleton className="h-[220px] rounded-xl" />
      <Skeleton className="h-[180px] rounded-xl" />
    </div>
  );
}

// ───────────────────────── body ─────────────────────────

/**
 * A calm narrative, top to bottom: headline sentence + four figures → planned vs done (day by day,
 * key sessions, highlights) → by sport → intensity and recovery → reflection → plan next week.
 */
function WeekBody({ data, mode, today, phase }: { data: WeekBundle; mode: Mode; today?: LocalDate; phase?: Phase }) {
  const s = data.summary as WeekSummary;
  const p = data.previous as WeekSummary | undefined;
  return (
    <>
      <Section>
        <Headline s={s} p={p} mode={mode} />
      </Section>
      <Section title={mode === 'future' ? 'The plan, day by day' : 'Planned vs done'} description={mode === 'future' ? undefined : 'Each day’s sessions, with completed Load against the plan. Click a session to open it.'}>
        <DayStrip data={data} today={today} mode={mode} />
      </Section>
      {mode !== 'future' && (
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
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
        <Section title="Intensity and recovery">
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

/** One plain sentence that answers "how did the week go?", then four figures with one line of context each. */
function headlineSentence(s: WeekSummary, mode: Mode): string {
  const keys = s.keyPlanned ? `${s.keyDone === s.keyPlanned ? `all ${s.keyPlanned}` : `${s.keyDone} of ${s.keyPlanned}`} key session${s.keyPlanned === 1 ? '' : 's'}` : null;
  if (mode === 'future') return `${fmtH(s.plannedSec)} h and ${fmtInt(s.plannedLoad)} Load planned${s.keyPlanned ? `, with ${s.keyPlanned} key session${s.keyPlanned === 1 ? '' : 's'}` : ''}.`;
  const share = s.plannedSec > 0 ? Math.round((s.doneSec / s.plannedSec) * 100) : null;
  if (mode === 'current') return `${fmtH(s.doneSec)} of ${fmtH(s.plannedSec)} h done so far${keys ? `, ${keys} done` : ''}.`;
  return `${share != null ? `You completed ${share}% of the planned time` : `You trained ${fmtH(s.doneSec)} h`}${keys ? ` and ${keys}` : ''}${s.compliancePct != null ? `; compliance ${Math.round(s.compliancePct)}%` : ''}.`;
}

function Headline({ s, p, mode }: { s: WeekSummary; p?: WeekSummary; mode: Mode }) {
  const future = mode === 'future';
  const loadDelta = pct(s.doneLoad, p?.doneLoad);
  return (
    <div className="flex flex-col gap-8">
      <p className="max-w-[48ch] text-title-2 font-medium text-fg-1">{headlineSentence(s, mode)}</p>
      <StatRow columns={4}>
        <StatTile
          label={future ? 'Hours planned' : mode === 'current' ? 'Hours so far' : 'Hours'}
          value={future ? s.plannedSec / 3600 : s.doneSec / 3600}
          format={(h) => fmtH(h * 3600)}
          unit="h"
          hint={future ? (s.targetHours ? `target ${fmtH(s.targetHours * 3600)}` : undefined) : `of ${fmtH(s.plannedSec)} planned`}
        />
        <StatTile
          label={future ? 'Load planned' : 'Load'}
          value={future ? s.plannedLoad : s.doneLoad}
          format={fmtInt}
          hint={future ? (s.targetLoad ? `target ${fmtInt(s.targetLoad)}` : undefined) : `of ${fmtInt(s.plannedLoad)} planned`}
        />
        <StatTile label={mode === 'past' ? 'Fitness at week end' : 'Fitness, projected'} value={s.fitness} format={fmtInt} delta={s.fitnessDelta} deltaKind="number" good={s.fitnessDelta > 0} hint="ramp this week" />
        <StatTile
          label="Form at week end"
          value={s.form}
          format={(v) => formatSigned(Math.round(v))}
          delta={p ? s.form - p.form : undefined}
          deltaKind="number"
          hint={s.formZone ? s.formZone[0].toUpperCase() + s.formZone.slice(1) : undefined}
        />
      </StatRow>
      {!future && p && <WowLine s={s} p={p} mode={mode} caution={(loadDelta ?? 0) > 0.15 && mode === 'past'} />}
    </div>
  );
}

/** Week over week in one line: "Against last week: hours −28 % (10:51), load −28 % (648), distance −13 % (144 km)." */
function WowLine({ s, p, mode, caution }: { s: WeekSummary; p: WeekSummary; mode: Mode; caution: boolean }) {
  const units = useUnits();
  const du = distanceUnit('run', units);
  const items = [
    { name: 'hours', d: pct(s.doneSec, p.doneSec), was: fmtH(p.doneSec) },
    { name: 'load', d: pct(s.doneLoad, p.doneLoad), was: fmtInt(p.doneLoad) },
    { name: 'distance', d: pct(s.doneDistanceM, p.doneDistanceM), was: `${fmtInt(p.doneDistanceM / du.mPer)} ${du.unit}` },
  ];
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body text-fg-2">
      <span>{mode === 'current' ? 'So far against last week:' : 'Against last week:'}</span>
      {items.map((it, i) => (
        <span key={it.name} className="inline-flex items-center gap-1.5">
          {it.name}
          <DeltaBadge value={it.d} size="sm" />
          <span className="text-fg-3">({it.was}){i < items.length - 1 ? ',' : '.'}</span>
        </span>
      ))}
      {caution && (
        <span className="inline-flex items-center gap-1.5 text-fg-1">
          <TriangleAlert className="size-3.5 text-warn" aria-hidden /> Load rose more than 15 %.
        </span>
      )}
    </p>
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
      <div className="flex flex-col divide-y divide-line-1">
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
              className={cn('relative -mx-3 grid min-w-0 grid-cols-[56px_1fr] items-start gap-x-3 gap-y-2 rounded-md px-3 py-3 md:grid-cols-[72px_1fr_200px] md:gap-x-4', isToday && 'bg-surface-1')}
            >
              <Link {...links.calendarDay(d.date)} aria-label={`Open ${weekdayShort(d.date)} ${formatDayMonth(d.date)}`} className="group/day flex flex-col self-start rounded-xs pt-1 outline-none focus-visible:outline-2 focus-visible:outline-focus">
                <span className={cn('text-body-sm', isToday ? 'font-medium text-fg-1' : 'text-fg-3')}>{isToday ? 'Today' : weekdayShort(d.date)}</span>
                <span className="text-body-sm text-fg-2 group-hover/day:text-fg-1 group-hover/day:underline">{formatDayMonth(d.date)}</span>
              </Link>
              <div className="flex min-w-0 flex-wrap gap-2">
                {d.markers.map((m) => (
                  <Chip key={m.id} tone="neutral" className="self-center">
                    {MARKER_LABEL[m.type] ?? m.type}
                    {m.label ? ` · ${m.label}` : ''}
                  </Chip>
                ))}
                {cards.length === 0 && !d.markers.length && <span className="py-1.5 text-body-sm text-fg-3">Rest day</span>}
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
                <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-surface-2" title={`Load ${fmtInt(load)}${plan ? ` of ${fmtInt(plan)} planned` : ''}`}>
                  {plan > load && <span className="absolute inset-y-0 left-0 rounded-full bg-surface-3" style={{ width: `${(plan / max) * 100}%` }} />}
                  <motion.span className="absolute inset-y-0 left-0 origin-left rounded-full bg-fg-2" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ ...spring.gentle, delay: Math.min(i * 0.012, 0.24) }} style={{ width: `${(load / max) * 100}%` }} />
                </div>
                <span className="w-24 text-right text-body-sm text-fg-1">
                  {d.activities.length > 0 && <span className="text-fg-3">{fmtH(d.activities.reduce((a, x) => a + (x.movingSec || x.durationSec), 0))} · </span>}
                  {load ? fmtInt(load) : '—'}
                  {plan > 0 && mode !== 'past' ? <span className="text-fg-4"> /{fmtInt(plan)}</span> : null}
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ───────────────────────── key sessions ─────────────────────────

function KeySessions({ data }: { data: WeekBundle }) {
  if (!data.keySessions.length) return <EmptyState size="sm" icon={<Star />} title="No key sessions this week">Mark a workout as key to track it here.</EmptyState>;
  return (
    <ul className="flex flex-col divide-y divide-line-1">
      {data.keySessions.map((k) => {
        const w = k.workout;
        const a = 'activity' in k ? k.activity : undefined;
        const st = k.compliance?.state ?? 'planned';
        const missed = st === 'missed' || st === 'excused';
        return (
          <li key={w.id}>
            <Link {...(a ? links.activity(a.id) : links.workout(w.id))} className="-mx-3 flex items-center gap-3 rounded-md px-3 py-3 transition-colors hover:bg-surface-2">
              <SportGlyph sport={w.sport} subSport={w.subSport} size={20} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className={cn('truncate text-body', missed ? 'text-fg-4 line-through decoration-fg-4' : 'text-fg-1')}>{w.title}</span>
                <span className="text-body-sm text-fg-3">
                  {weekdayShort(w.date)} · {a ? `${fmtH(a.movingSec || a.durationSec)} · Load ${fmtInt(a.load)}` : `${w.plannedDurationSec ? fmtH(w.plannedDurationSec) : '—'} planned`}
                  {w.plannedLoad ? ` / ${fmtInt(w.plannedLoad)} planned` : ''}
                </span>
              </div>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-body-sm text-fg-2 max-sm:hidden">{complianceLabel(st, w.skipReason)}</span>
                {k.compliance?.ratio && !missed ? <span className="text-body-sm text-fg-1">{Math.round(k.compliance.ratio * 100)}%</span> : null}
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
  if (h.biggestLoad) items.push({ icon: <Flag />, label: 'Biggest load', title: h.biggestLoad.title, value: fmtInt(h.biggestLoad.load), link: links.activity(h.biggestLoad.id) });
  if (h.biggestLoadDay) items.push({ icon: <CalendarDays />, label: 'Biggest day', title: `${weekdayShort(h.biggestLoadDay.date)} ${formatDayMonth(h.biggestLoadDay.date)}`, value: fmtInt(h.biggestLoadDay.load) });
  for (const b of h.newBests.slice(0, 4)) {
    const what = b.kind === 'power' ? `${DUR_LABEL[b.durationSec ?? 0] ?? `${b.durationSec}s`} power` : `${(() => { const d = distanceParts(b.distanceM, b.sport, units); return `${d.value} ${d.unit}`; })()}`;
    const val = b.kind === 'power' ? `${fmtInt(b.value)} W` : formatDuration(b.value, 'hms');
    const prevV = b.previous == null ? '' : b.kind === 'power' ? ` (was ${fmtInt(b.previous)})` : ` (was ${formatDuration(b.previous, 'hms')})`;
    items.push({ icon: <Medal />, label: `New best · ${SPORT_META[b.sport].label}`, title: what + prevV, value: val, link: links.activity(b.activityId) });
  }
  if (!items.length) return <EmptyState size="sm" icon={<Medal />} title="Nothing recorded yet">Highlights appear as sessions are completed.</EmptyState>;
  return (
    <ul className="flex flex-col divide-y divide-line-1">
      {items.map((it, i) => {
        const inner = (
          <>
            <span className="shrink-0 text-fg-3 [&_svg]:size-4">{it.icon}</span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-body-sm text-fg-3">{it.label}</span>
              <span className="truncate text-body text-fg-1">{it.title}</span>
            </span>
            <span className="text-body text-fg-1">{it.value}</span>
          </>
        );
        return (
          <li key={i}>
            {it.link ? (
              <Link {...it.link} className="-mx-3 flex items-center gap-3 rounded-md px-3 py-3 transition-colors hover:bg-surface-2">
                {inner}
              </Link>
            ) : (
              <div className="flex items-center gap-3 py-3">{inner}</div>
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
    <TableScroll bleed label="Time by sport">
      <table className="w-full min-w-[560px] text-left">
        <thead>
          <tr className="border-b border-line-1 text-label text-fg-3">
            <th className="h-9 pr-3 font-medium">Sport</th>
            <th className="h-9 px-3 text-right font-medium">Sessions</th>
            <th className="h-9 px-3 text-right font-medium">Time{future ? '' : ', done of planned'}</th>
            <th className="h-9 px-3 text-right font-medium">Distance</th>
            <th className="h-9 px-3 text-right font-medium">Load</th>
            {!future && <th className="h-9 w-[22%] pl-6 font-medium">Share of time</th>}
          </tr>
        </thead>
        <tbody className="num text-body">
          {rows.map((r) => (
            <tr key={r.sport} className="h-11 border-b border-line-1 last:border-0">
              <td className="pr-3">
                <span className="inline-flex items-center gap-2 text-body text-fg-1">
                  <SportGlyph sport={r.sport} size={16} />
                  {SPORT_META[r.sport].label}
                </span>
              </td>
              <td className="px-3 text-right text-fg-1">{future ? r.plannedCount : <>{r.doneCount}<span className="text-fg-3">/{r.plannedCount}</span></>}</td>
              <td className="px-3 text-right text-fg-1">{future ? fmtH(r.plannedSec) : <>{fmtH(r.doneSec)}<span className="text-fg-3"> / {fmtH(r.plannedSec)}</span></>}</td>
              <td className="px-3 text-right text-fg-1">{dist(future ? r.plannedDistanceM : r.doneDistanceM, r.sport)}</td>
              <td className="px-3 text-right text-fg-1">{fmtInt(future ? r.plannedLoad : r.doneLoad)}</td>
              {!future && (
                <td className="pl-6">
                  <span className="flex items-center gap-2">
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
                      <motion.span className="block h-full origin-left rounded-full" style={{ backgroundColor: sportColor(r.sport) }} initial={{ scaleX: 0 }} animate={{ scaleX: r.doneSec / totalDone }} transition={spring.gentle} />
                    </span>
                    <span className="w-9 text-right text-body-sm text-fg-3">{Math.round((r.doneSec / totalDone) * 100)}%</span>
                  </span>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
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
  const share = (v: number) => Math.round((v / (t || 1)) * 100);
  const intensityLine =
    t > 0
      ? `${share(s.intensitySec.easy)}% easy, ${share(s.intensitySec.moderate)}% moderate, ${share(s.intensitySec.hard)}% hard${share(s.intensitySec.moderate) > 10 ? ': more grey-zone time than the 80 / 5 / 15 target' : share(s.intensitySec.easy) >= 75 ? ': close to the 80 / 5 / 15 target' : ''}.`
      : 'No completed time yet.';
  return (
    <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
      <div className="flex flex-col gap-5">
        <p className="text-body text-fg-2">{intensityLine}</p>
        {t > 0 && (
          <>
            <SplitRow label="This week" split={s.intensitySec} total={t} />
            {p && pt > 0 && <SplitRow label="Last week" split={p.intensitySec} total={pt} dim />}
          </>
        )}
      </div>
      <div className="flex flex-col gap-5">
        <p className="text-body text-fg-2">{sentence ?? 'Weekly averages against the week before.'}</p>
        <div className="grid grid-cols-3 gap-6">
          {rows.map((r) => (
            <div key={r.label} className="flex min-w-0 flex-col gap-1">
              <span className="text-body-sm text-fg-3">{r.label}</span>
              <span className="flex items-baseline gap-1 text-stat-sm text-fg-1">
                {r.cur == null ? '—' : r.fmt(r.cur)}
                <span className="text-body-sm text-fg-3">{r.unit}</span>
              </span>
              <DeltaBadge
                value={r.cur != null && r.prev ? r.cur / r.prev - 1 : null}
                size="sm"
                good={r.cur != null && r.prev != null && (r.higherGood ? r.cur > r.prev : r.cur < r.prev)}
                bad={r.cur != null && r.prev != null && (r.higherGood ? r.cur < r.prev : r.cur > r.prev)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SplitRow({ label, split, total, dim }: { label: string; split: { easy: number; moderate: number; hard: number }; total: number; dim?: boolean }) {
  const pc = (v: number) => `${Math.round((v / total) * 100)}%`;
  return (
    <div className={cn('flex flex-col gap-2', dim && 'opacity-60')}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-body-sm text-fg-1">{label}</span>
        <span className="text-body-sm text-fg-3">
          {pc(split.easy)} · {pc(split.moderate)} · {pc(split.hard)}
        </span>
      </div>
      <SplitBar {...split} height={6} />
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
    <div className="flex flex-col gap-3 rounded-lg bg-surface-1 p-5 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="-ml-2 flex flex-wrap gap-1">
          {prompts.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setBody((b) => (b.trim() ? `${b.trimEnd()}\n\n${p}\n` : `${p}\n`))}
              className="h-7 rounded-md px-2 text-body-sm text-fg-3 transition-colors hover:bg-surface-2 hover:text-fg-1"
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
      <p className="text-body-sm text-fg-3">Autosaves. Appears in your journal and on the calendar week.</p>
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
    <div className="grid gap-12 lg:grid-cols-5 lg:gap-10">
      <div className="flex flex-col gap-4 lg:col-span-2">
        <span className="text-body-sm text-fg-3">Already planned for W{Number(nextWeek.slice(6))}</span>
        {n && n.plannedSec > 0 ? (
          <>
            <div className="flex items-baseline gap-6">
              <span className="flex items-baseline gap-1 text-stat-md text-fg-1">{fmtH(n.plannedSec)}<span className="text-body text-fg-3">h</span></span>
              <span className="flex items-baseline gap-1 text-stat-md text-fg-1">{fmtInt(n.plannedLoad)}<span className="text-body text-fg-3">load</span></span>
            </div>
            <span className="text-body-sm text-fg-3">
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
        <ButtonLink {...links.calendarWeek(nextWeek)} variant="ghost" size="sm" icon={<CalendarDays />} className="-ml-2.5 self-start">
          Open W{Number(nextWeek.slice(6))} in the calendar
        </ButtonLink>
      </div>
      <div className="flex flex-col gap-5 rounded-lg bg-surface-1 p-5 md:p-6 lg:col-span-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-title-3 text-fg-1">Copy this week forward</span>
          <span className="text-body-sm text-fg-3">{count} workouts from W{Number(data.isoWeek.slice(6))}</span>
        </div>
        <p className="text-body text-fg-2">
          Suggested <span className="text-fg-1">{formatSigned(sug.pct)}%</span> · {sug.why}
        </p>
        <Slider
          label="Progression"
          value={p}
          onValueChange={setP}
          min={-40}
          max={20}
          step={5}
          ticks
          valueLabel={<span className="text-body text-fg-1">{formatSigned(p)}%</span>}
        />
        <div className="grid grid-cols-2 gap-6 pt-1 sm:grid-cols-3">
          <PreviewStat label="Copied hours ≈" value={addSec / 3600} fmt={(v) => fmtH(v * 3600)} sub={`from ${fmtH(s.plannedSec)}`} />
          <PreviewStat label="Copied load ≈" value={addLoad} fmt={fmtInt} sub={`from ${fmtInt(s.plannedLoad)}`} />
          {haveSec > 0 ? (
            <PreviewStat label={`W${Number(nextWeek.slice(6))} total after`} value={(addSec + haveSec) / 3600} fmt={(v) => fmtH(v * 3600)} sub={`${fmtInt(addLoad + haveLoad)} load, on top of the plan`} />
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

function PreviewStat({ label, value, fmt, sub }: { label: string; value: number; fmt: (v: number) => string; sub: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="truncate text-body-sm text-fg-3">{label}</span>
      <span className="text-stat-sm text-fg-1">
        <Ticker value={value} format={fmt} />
      </span>
      <span className="truncate text-body-sm text-fg-3">{sub}</span>
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
    <div className="flex flex-col gap-3 pt-4">
      <div className="flex items-center justify-between">
        <span className="text-body-sm text-fg-3">Targets for W{Number(isoWeek.slice(6))}</span>
        <SaveIndicator status={status} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Hours" value={h} onValueChange={setH} min={0} max={40} step={0.5} unit="h" />
        <NumberField label="Load" value={l} onValueChange={setL} min={0} max={3000} step={10} />
      </div>
      {h == null && l == null && (
        <button type="button" className="self-start text-label text-fg-2 underline decoration-line-3 underline-offset-3 hover:text-fg-1" onClick={() => { setH(Math.round(suggestHours * 2) / 2); setL(Math.round(suggestLoad / 10) * 10); }}>
          Use suggestion: {fmtH(suggestHours * 3600)} h · {fmtInt(suggestLoad)} load
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
