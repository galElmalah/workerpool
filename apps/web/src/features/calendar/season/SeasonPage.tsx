/**
 * Season — /season (product.md §2.2 SHOULD, §3.7 phases). One long strip of the year's weeks:
 * each bar sized by load (done = solid accent, planned = dashed outline, phase-target projection =
 * hatched), phase bands across the top (create / edit inline), A/B/C event flags, the projected
 * Fitness line over the season and a weekly target editor. Click a week → the calendar week.
 */
import { PHASE_TYPES, type Event, type IsoWeek, type LocalDate, type Phase, type WeekSummary } from '@cadence/core/domain';
import { addDays, isoWeekOf, isoWeekStart, weekStart } from '@cadence/core/time';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Flag, Plus, RotateCw, Trash2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api, call } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatIsoWeekRange, formatLoad, monthShort } from '@/lib/format';
import { qk } from '@/lib/query';
import { PageItem } from '@/motion/PageTransition';
import { spring, tween } from '@/motion/tokens';
import { links } from '@/shell/links';
import { Banner, Button, Card, IconButton, Input, NumberField, Page, PageHeader, Section, Select, Skeleton, toast } from '@/ui';
import { NewEventForm } from '../day/furniture';
import { hm, useEvents, useFitnessTrend, usePhaseMutations, usePhases, useTodayData, useWeeklyTrend } from '../day/kit';

const PHASE_STYLE: Record<Phase['type'], string> = {
  transition: 'border border-dashed border-line-3 text-fg-2',
  base: 'bg-surface-3 text-fg-1',
  build: 'bg-gray-6 text-fg-1',
  peak: 'bg-gray-8 text-fg-1',
  taper: 'bg-dots-fg border border-line-3 text-fg-1',
  race: 'bg-fg-1 text-canvas',
  recovery: 'bg-hatch-faint border border-line-3 text-fg-2',
};
const PHASE_LABEL: Record<Phase['type'], string> = { base: 'Base', build: 'Build', peak: 'Peak', taper: 'Taper', race: 'Race', recovery: 'Recovery', transition: 'Transition' };

export function SeasonPage() {
  const todayQ = useTodayData();
  const today = todayQ.data?.date;
  const [yearSel, setYear] = useState<number | null>(null);
  const year = yearSel ?? (today ? Number(today.slice(0, 4)) : null);
  return (
    <Page
      width="page"
      header={
        <PageHeader
          title={year ? `Season ${year}` : 'Season'}
          eyebrow="Phases · events · weekly load"
          actions={
            year && (
              <div className="flex items-center gap-1">
                <IconButton size="sm" label="Previous year" icon={<ChevronLeft />} onClick={() => setYear(year - 1)} />
                <IconButton size="sm" label="Next year" icon={<ChevronRight />} onClick={() => setYear(year + 1)} />
              </div>
            )
          }
        />
      }
    >
      {todayQ.isError && !today ? (
        <Section>
          <Banner tone="error" title="Couldn't load the season" action={<Button size="sm" icon={<RotateCw />} onClick={() => todayQ.refetch()}>Retry</Button>} />
        </Section>
      ) : !year || !today ? (
        <Skeleton className="h-80 rounded-lg" />
      ) : (
        <SeasonBody key={year} year={year} today={today} />
      )}
    </Page>
  );
}

function SeasonBody({ year, today }: { year: number; today: LocalDate }) {
  const end = `${year}-12-31`;
  const firstWeek = weekStart(`${year}-01-04`); // ISO week 1
  const weeksQ = useWeeklyTrend(53, end);
  const phasesQ = usePhases();
  const eventsQ = useEvents();
  const fitQ = useFitnessTrend(firstWeek, end);
  const weeks = useMemo(() => (weeksQ.data ?? []).filter((w) => w.startDate >= firstWeek && w.isoWeek.startsWith(String(year))), [weeksQ.data, firstWeek, year]);
  const phases = (phasesQ.data ?? []).filter((p) => p.endDate >= firstWeek && p.startDate <= end);
  const events = (eventsQ.data ?? []).filter((e) => e.date >= firstWeek && e.date <= end);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [addingEvent, setAddingEvent] = useState(false);
  const yearDone = weeks.reduce((s, w) => s + w.doneLoad, 0);
  const yearSec = weeks.reduce((s, w) => s + w.doneSec, 0);

  return (
    <>
      <PageItem>
        <Card padding="none" className="overflow-hidden" style={{ '--chart-bg': 'var(--color-surface-1)' } as React.CSSProperties}>
          <div className="flex flex-wrap items-baseline justify-between gap-3 px-4 pt-4 xl:px-5">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <span className="text-micro text-fg-3">Year so far</span>
              <span className="text-stat-sm text-accent-ink">{formatLoad(yearDone)} <span className="text-label text-fg-3">load</span></span>
              <span className="text-stat-sm text-fg-1">{Math.round(yearSec / 3600)} <span className="text-label text-fg-3">h</span></span>
            </div>
            <Legend />
          </div>
          {weeksQ.isPending ? (
            <Skeleton className="m-4 h-72" />
          ) : (
            <SeasonStrip weeks={weeks} phases={phases} events={events} today={today} fitness={fitQ.data?.days ?? []} onPhase={(id) => setEditing(id)} />
          )}
        </Card>
      </PageItem>

      <Section
        title="Phases"
        description="Blocks of the season. Each sets a weekly load target."
        actions={
          <Button size="sm" variant="secondary" icon={<Plus />} onClick={() => setEditing('new')}>
            Phase
          </Button>
        }
      >
        <AnimatePresence initial={false}>
          {editing && (
            <motion.div key={editing} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0, transition: tween('fast', 'in') }} transition={spring.smooth} className="overflow-hidden">
              <PhaseEditor phase={phases.find((p) => p.id === editing)} weeks={weeks} today={today} onDone={() => setEditing(null)} />
            </motion.div>
          )}
        </AnimatePresence>
        <div className="mt-3 flex flex-col overflow-hidden rounded-lg border border-line-2 bg-surface-1">
          {phases.length === 0 && <p className="p-4 text-body text-fg-3">No phases this year. Add a base block to start.</p>}
          {phases.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setEditing(p.id)}
              className={cn('grid grid-cols-[96px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 text-left outline-none transition-colors duration-(--dur-fast) hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus', i > 0 && 'border-t border-line-1', editing === p.id && 'bg-surface-2')}
            >
              <span className={cn('rounded-xs px-1.5 py-0.5 text-center text-micro ', PHASE_STYLE[p.type])}>{PHASE_LABEL[p.type]}</span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-body text-fg-1">{p.label}</span>
                <span className="text-mono-sm text-fg-3">
                  W{Number(isoWeekOf(p.startDate).slice(6))}–W{Number(isoWeekOf(p.endDate).slice(6))} · {formatIsoWeekRange(isoWeekOf(p.startDate))} → {formatIsoWeekRange(isoWeekOf(p.endDate))}
                </span>
              </span>
              <span className="text-mono-sm text-fg-2">{p.weeklyLoadTarget != null ? `${formatLoad(p.weeklyLoadTarget)} /wk` : '—'}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section
        title="Events"
        actions={
          <Button size="sm" variant="secondary" icon={<Flag />} onClick={() => setAddingEvent((v) => !v)}>
            Event
          </Button>
        }
      >
        {addingEvent && <NewEventForm date={today} onDone={() => setAddingEvent(false)} className="mb-3" />}
        <div className="grid gap-2 sm:grid-cols-2">
          {events.length === 0 && <p className="text-body text-fg-3">No races this year yet.</p>}
          {events.map((e) => (
            <Link key={e.id} {...links.event(e.id)} className={cn('flex items-center gap-3 rounded-md border p-3 outline-none transition-colors duration-(--dur-fast) hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-focus', e.priority === 'A' ? 'border-accent-a6' : 'border-line-2', e.date < today && 'opacity-70')}>
              <span className={cn('grid size-8 place-items-center rounded-sm text-label font-[600]', e.priority === 'A' ? 'bg-accent text-on-accent' : e.priority === 'B' ? 'border border-accent-a6 text-accent-ink' : 'border border-line-3 text-fg-2')}>{e.priority}</span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-body font-[560] text-fg-1">{e.name}</span>
                <span className="text-mono-sm text-fg-3">{e.date}{e.goal ? ` · ${e.goal}` : ''}</span>
              </span>
            </Link>
          ))}
        </div>
      </Section>

      <Section title="Weekly target" description="Override the phase target for a single week (e.g. a recovery week).">
        <WeekTargetEditor weeks={weeks} phases={phases} today={today} />
      </Section>
    </>
  );
}

function Legend() {
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-micro text-fg-3" aria-hidden>
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2 rounded-[2px] bg-accent" />Done</span>
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2 rounded-[2px] border border-dashed border-fg-3" />Planned</span>
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2 rounded-[2px] bg-hatch-fg" />Target</span>
      <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-accent" />Fitness</span>
    </span>
  );
}

// ───────────────────────── the strip ─────────────────────────

const H = 220;

function SeasonStrip({ weeks, phases, events, today, fitness, onPhase }: { weeks: WeekSummary[]; phases: Phase[]; events: Event[]; today: LocalDate; fitness: { date: string; fitness: number; projected: boolean }[]; onPhase: (id: string) => void }) {
  const n = weeks.length;
  const idxOf = (d: LocalDate) => weeks.findIndex((w) => w.startDate <= d && d <= w.endDate);
  const targetOf = (w: WeekSummary) => w.targetLoad ?? phases.find((p) => p.startDate <= w.startDate && w.startDate <= p.endDate)?.weeklyLoadTarget ?? null;
  const max = Math.max(1, ...weeks.map((w) => Math.max(w.doneLoad, w.plannedLoad, targetOf(w) ?? 0)));
  const fitMax = Math.max(1, ...fitness.map((f) => f.fitness));
  const first = weeks[0]?.startDate;
  const xOfDate = (d: string) => {
    if (!first) return 0;
    const days = (Date.parse(d) - Date.parse(first)) / 864e5;
    return (days / 7 / n) * 100;
  };
  const toPts = (arr: typeof fitness) => arr.map((f) => `${xOfDate(f.date).toFixed(2)},${(100 - (f.fitness / fitMax) * 88).toFixed(2)}`).join(' ');
  const done = fitness.filter((f) => !f.projected);
  const proj = fitness.filter((f, i) => f.projected || (fitness[i + 1]?.projected ?? false));
  const curIdx = idxOf(today);
  const monthOf = (w: WeekSummary) => w.endDate.slice(5, 7);
  const months = weeks.map((w, i) => ({ i, first: i === 0 || monthOf(weeks[i - 1]!) !== monthOf(w) })).filter((x) => x.first);

  return (
    <div
      ref={(el) => {
        // Phones: start with the current week in view.
        if (el && curIdx >= 0 && el.scrollWidth > el.clientWidth && el.scrollLeft === 0) el.scrollLeft = Math.max(0, ((curIdx + 4) / n) * el.scrollWidth - el.clientWidth);
      }}
      className="overflow-x-auto px-4 pt-3 pb-4 xl:px-5 [scrollbar-width:thin]"
    >
      <div className="relative min-w-[720px]">
        {/* phase bands */}
        <div className="relative mb-1 h-6">
          {phases.map((p) => {
            const a = Math.max(0, idxOf(p.startDate) === -1 ? 0 : idxOf(p.startDate));
            const bRaw = idxOf(p.endDate);
            const b = bRaw === -1 ? n - 1 : bRaw;
            if (b < a) return null;
            return (
              <button
                key={p.id}
                type="button"
                title={`${p.label}${p.weeklyLoadTarget ? ` · ${p.weeklyLoadTarget}/wk` : ''}`}
                onClick={() => onPhase(p.id)}
                aria-label={p.label}
                className={cn('absolute inset-y-0 overflow-hidden rounded-xs px-1.5 text-left text-micro whitespace-nowrap outline-none focus-visible:outline-2 focus-visible:outline-focus', PHASE_STYLE[p.type])}
                style={{ left: `calc(${(a / n) * 100}% + 1px)`, width: `calc(${((b - a + 1) / n) * 100}% - 2px)` }}
              >
                <FitLabel full={p.label} short={shortPhaseLabel(p)} />
              </button>
            );
          })}
        </div>
        {/* events */}
        <div className="relative h-6">
          {events.map((e) => {
            const i = idxOf(e.date);
            if (i < 0) return null;
            return (
              <Link key={e.id} {...links.event(e.id)} title={e.name} className="absolute top-0 flex -translate-x-1/2 items-center gap-0.5 rounded-xs px-1 text-micro outline-none hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-focus" style={{ left: `${((i + 0.5) / n) * 100}%` }}>
                <Flag className={cn('size-3', e.priority === 'A' ? 'fill-accent text-accent' : e.priority === 'B' ? 'text-accent-ink' : 'text-fg-3')} />
                <span className={e.priority === 'A' ? 'text-accent-ink' : 'text-fg-2'}>{e.priority}</span>
              </Link>
            );
          })}
        </div>
        {/* bars */}
        <div className="relative flex items-end gap-px border-b border-line-2" style={{ height: H }}>
          {weeks.map((w, i) => {
            const t = targetOf(w);
            const future = w.startDate > today;
            const plannedH = (Math.max(w.plannedLoad, w.doneLoad) / max) * 100;
            const doneH = (w.doneLoad / max) * 100;
            const targetH = t ? (t / max) * 100 : 0;
            const projected = future && w.plannedLoad === 0 && t;
            return (
              <Link
                key={w.isoWeek}
                {...links.calendarWeek(w.isoWeek)}
                className={cn('group/bar relative h-full flex-1 rounded-t-[3px] outline-none focus-visible:outline-2 focus-visible:outline-focus', i === curIdx && 'bg-accent-a1')}
                aria-label={`W${Number(w.isoWeek.slice(6))}: ${formatLoad(w.doneLoad)} done of ${formatLoad(w.plannedLoad)} planned load${t ? `, target ${t}` : ''}`}
                title={`W${Number(w.isoWeek.slice(6))} · ${formatIsoWeekRange(w.isoWeek)}\n${formatLoad(w.doneLoad)} done / ${formatLoad(w.plannedLoad)} planned${t ? ` · target ${t}` : ''}\n${hm(w.doneSec)} h`}
              >
                <span className="absolute inset-0 rounded-t-[3px] transition-colors duration-(--dur-fast) group-hover/bar:bg-surface-2" />
                {projected ? (
                  <span className="absolute inset-x-0.5 bottom-0 rounded-t-[2px] bg-hatch-fg opacity-60" style={{ height: `${targetH}%` }} />
                ) : (
                  w.plannedLoad > w.doneLoad && <span className="absolute inset-x-0.5 bottom-0 rounded-t-[2px] border border-b-0 border-dashed border-fg-3" style={{ height: `${plannedH}%` }} />
                )}
                <motion.span className="absolute inset-x-0.5 bottom-0 origin-bottom rounded-t-[2px] bg-accent" style={{ height: `${doneH}%` }} initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ ...spring.gentle, delay: Math.min(i * 0.008, 0.24) }} />
                {t && !projected ? <span className="absolute inset-x-0 h-px bg-fg-2" style={{ bottom: `${targetH}%` }} /> : null}
              </Link>
            );
          })}
          {curIdx >= 0 && <span className="pointer-events-none absolute -top-1 bottom-0 w-px bg-fg-3" style={{ left: `${((curIdx + 0.5) / n) * 100}%` }} aria-hidden />}
          {/* fitness line */}
          <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            {done.length > 1 && <motion.polyline points={toPts(done)} fill="none" stroke="var(--color-accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ ...spring.gentle, delay: 0.2 }} />}
            {proj.length > 1 && <polyline points={toPts(proj)} fill="none" stroke="var(--color-accent)" strokeOpacity={0.6} strokeWidth={2} strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />}
          </svg>
        </div>
        {/* months */}
        <div className="relative mt-1.5 h-4">
          {months.map(({ i }) => (
            <span key={i} className="absolute text-mono-sm text-fg-3" style={{ left: `${(i / n) * 100}%` }}>
              {monthShort(weeks[i]!.endDate)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── phase editor ─────────────────────────

function PhaseEditor({ phase, weeks, today, onDone }: { phase?: Phase; weeks: WeekSummary[]; today: LocalDate; onDone: () => void }) {
  const { create, patch, remove } = usePhaseMutations();
  const defStart = weekStart(today);
  const [type, setType] = useState<Phase['type']>(phase?.type ?? 'build');
  const [label, setLabel] = useState(phase?.label ?? '');
  const [start, setStart] = useState<IsoWeek>(isoWeekOf(phase?.startDate ?? defStart));
  const [endW, setEnd] = useState<IsoWeek>(isoWeekOf(phase?.endDate ?? addDays(defStart, 27)));
  const [target, setTarget] = useState<number | null>(phase?.weeklyLoadTarget ?? null);
  const opts = weeks.map((w) => ({ value: w.isoWeek, label: `W${Number(w.isoWeek.slice(6))} · ${formatIsoWeekRange(w.isoWeek)}` }));
  const input = { type, label: label.trim() || PHASE_LABEL[type], startDate: isoWeekStart(start), endDate: addDays(isoWeekStart(endW), 6) };
  const save = () => {
    if (input.endDate < input.startDate) return toast.error('The phase ends before it starts');
    if (phase)
      patch.mutate({ id: phase.id, patch: { ...input, weeklyLoadTarget: target } }, { onSuccess: () => (toast.success('Phase saved'), onDone()) });
    else create.mutate({ ...input, ...(target != null ? { weeklyLoadTarget: target } : {}) }, { onSuccess: () => (toast.success(`Added ${input.label}`), onDone()) });
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="flex flex-col gap-4 rounded-lg border border-line-3 bg-surface-1 p-4"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Select label="Type" value={type} onValueChange={setType} options={PHASE_TYPES.map((t) => ({ value: t, label: PHASE_LABEL[t] }))} />
        <label className="flex flex-col gap-1.5">
          <span className="text-label text-fg-2">Label</span>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={PHASE_LABEL[type]} />
        </label>
        <Select label="Starts" value={start} onValueChange={setStart} options={opts} />
        <Select label="Ends" value={endW} onValueChange={setEnd} options={opts} />
        <NumberField label="Weekly load target" value={target} min={0} max={3000} step={10} onValueChange={setTarget} />
      </div>
      <div className="flex items-center justify-between gap-2">
        {phase ? (
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 />}
            onClick={() =>
              remove.mutate(phase.id, {
                onSuccess: (gone) => {
                  onDone();
                  const { id: _id, ...rest } = gone;
                  toast.undo(<>Deleted <b>{gone.label}</b></>, () => create.mutate(rest));
                },
              })
            }
          >
            Delete
          </Button>
        ) : (
          <span />
        )}
        <span className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button size="sm" type="submit" variant="primary" loading={create.isPending || patch.isPending}>
            {phase ? 'Save phase' : 'Add phase'}
          </Button>
        </span>
      </div>
    </form>
  );
}

// ───────────────────────── week target editor ─────────────────────────

function WeekTargetEditor({ weeks, phases, today }: { weeks: WeekSummary[]; phases: Phase[]; today: LocalDate }) {
  const qc = useQueryClient();
  const cur = isoWeekOf(today);
  const [wk, setWk] = useState<IsoWeek>(weeks.some((w) => w.isoWeek === cur) ? addWeekIso(cur, 1) : (weeks[0]?.isoWeek ?? cur));
  const w = weeks.find((x) => x.isoWeek === wk);
  const phaseT = phases.find((p) => w && p.startDate <= w.startDate && w.startDate <= p.endDate)?.weeklyLoadTarget ?? null;
  const [val, setVal] = useState<number | null>(null);
  const shown = val ?? w?.targetLoad ?? null;
  const m = useMutation({
    mutationFn: async (targetLoad: number | null) => {
      // Keep the week's reflection: PUT replaces the body, so send the current one back.
      const note = await call(api['week-notes'][':isoWeek'].$get({ param: { isoWeek: wk } }));
      return call(api['week-notes'][':isoWeek'].$put({ param: { isoWeek: wk }, json: { body: (note as { body?: string } | null)?.body ?? '', targetLoad } }));
    },
    onSuccess: () => {
      toast.success(`Target saved for W${Number(wk.slice(6))}`);
      setVal(null);
      void qc.invalidateQueries({ queryKey: qk.trends.all });
      void qc.invalidateQueries({ queryKey: qk.calendar.all });
    },
    onError: (e) => toast.error("Couldn't save the target", { description: e instanceof Error ? e.message : undefined }),
  });
  const opts = weeks.map((x) => ({ value: x.isoWeek, label: `W${Number(x.isoWeek.slice(6))} · ${formatIsoWeekRange(x.isoWeek)}` }));
  return (
    <Card>
      <form
        className="flex flex-wrap items-end gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate(shown);
        }}
      >
        <Select label="Week" value={wk} onValueChange={(v) => (setWk(v), setVal(null))} options={opts} className="w-56" />
        <NumberField label="Target load" value={shown} min={0} max={3000} step={10} onValueChange={setVal} className="w-44" />
        <Button type="submit" variant="secondary" loading={m.isPending}>
          Save target
        </Button>
        <span className="pb-2 text-body-sm text-fg-3">
          {w ? `Planned ${formatLoad(w.plannedLoad)} · done ${formatLoad(w.doneLoad)}` : ''}
          {phaseT != null ? ` · phase target ${formatLoad(phaseT)}` : ''}
        </span>
      </form>
    </Card>
  );
}

function addWeekIso(w: IsoWeek, n: number): IsoWeek {
  return isoWeekOf(addDays(isoWeekStart(w), n * 7));
}

/** Short form for a phase band too narrow for its label: word initials ("General Prep" → "GP"), else the type initial. */
function shortPhaseLabel(p: Phase): string {
  const words = p.label.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return words.slice(0, 3).map((w) => w[0]!.toUpperCase()).join('');
  return (words[0]?.[0] ?? PHASE_LABEL[p.type][0]!).toUpperCase();
}

/** Shows `full` only when it fits its (padded) parent; otherwise `short` (the parent carries the full label as tooltip). */
function FitLabel({ full, short }: { full: string; short: string }) {
  const measure = useRef<HTMLSpanElement>(null);
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const m = measure.current;
    const host = m?.parentElement;
    if (!m || !host) return;
    const check = () => {
      const cs = getComputedStyle(host);
      const room = host.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      setFits(m.offsetWidth <= room + 0.5);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(host);
    return () => ro.disconnect();
  }, [full]);
  return (
    <>
      <span ref={measure} className="invisible absolute leading-6" aria-hidden>
        {full}
      </span>
      <span className="leading-6">{fits ? full : short}</span>
    </>
  );
}
