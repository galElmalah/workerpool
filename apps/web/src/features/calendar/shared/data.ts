/**
 * Calendar data windowing: the infinite month view fetches whole 12-week pages aligned to a fixed
 * epoch and merges them into per-day / per-week view-models with STABLE identities (a day object
 * is reused while the underlying workout/activity/note objects are the same references), so
 * memoized rows and cells only re-render when their own data changes.
 */
import { useQueries } from '@tanstack/react-query';
import { useMemo, useRef } from 'react';
import type { CalendarResponse, DayMarker, DayNote, Event, LocalDate, Phase, WeekSummary, WellnessDay, Activity, PlannedWorkout } from '@cadence/core/domain';
import { addDays, diffDays, isoWeekOf, weekStart } from '@cadence/core/time';
import { calendarQuery, dayCards, type CalendarCard } from '@/lib/queries/training';

export const EPOCH = '2000-01-03'; // a Monday
export const PAGE_WEEKS = 12;

export const weekIndexOf = (d: LocalDate) => Math.floor(diffDays(EPOCH, weekStart(d)) / 7);
export const weekStartOf = (i: number): LocalDate => addDays(EPOCH, i * 7);
export const pageOfWeek = (i: number) => Math.floor(i / PAGE_WEEKS);
export const pageRange = (p: number) => {
  const from = weekStartOf(p * PAGE_WEEKS);
  return { from, to: addDays(from, PAGE_WEEKS * 7 - 1) };
};

export interface DayData {
  date: LocalDate;
  cards: CalendarCard[];
  events: Event[];
  markers: DayMarker[];
  note?: DayNote;
  wellness?: WellnessDay;
  loaded: boolean;
}

export interface PhaseInfo {
  phase: Phase;
  /** 1-based week within the phase. */
  index: number;
  count: number;
  isFirst: boolean;
  isLast: boolean;
}

export interface WeekData {
  start: LocalDate;
  isoWeek: string;
  days: DayData[];
  summary?: WeekSummary;
  phase?: PhaseInfo;
  loaded: boolean;
}

interface Index {
  workouts: Map<LocalDate, PlannedWorkout[]>;
  activities: Map<LocalDate, Activity[]>;
  events: Map<LocalDate, Event[]>;
  markers: Map<LocalDate, DayMarker[]>;
  notes: Map<LocalDate, DayNote>;
  wellness: Map<LocalDate, WellnessDay>;
  weeks: Map<string, WeekSummary>;
  phases: Phase[];
  loadedFrom: Array<[LocalDate, LocalDate]>;
  today: LocalDate | null;
  all: { workouts: Map<string, PlannedWorkout>; activities: Map<string, Activity> };
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
}

export function buildIndex(pages: (CalendarResponse | undefined)[]): Index {
  const wById = new Map<string, PlannedWorkout>();
  const aById = new Map<string, Activity>();
  const evById = new Map<string, Event>();
  const mkById = new Map<string, DayMarker>();
  const phById = new Map<string, Phase>();
  const notes = new Map<LocalDate, DayNote>();
  const wellness = new Map<LocalDate, WellnessDay>();
  const weeks = new Map<string, WeekSummary>();
  const loadedFrom: Array<[LocalDate, LocalDate]> = [];
  let today: LocalDate | null = null;
  for (const p of pages) {
    if (!p) continue;
    today = p.today;
    loadedFrom.push([p.from, p.to]);
    for (const w of p.workouts) wById.set(w.id, w);
    for (const a of p.activities) aById.set(a.id, a);
    for (const e of p.events) evById.set(e.id, e);
    for (const m of p.markers) mkById.set(m.id, m);
    for (const ph of p.phases) phById.set(ph.id, ph);
    for (const n of p.dayNotes) notes.set(n.date, n);
    for (const w of p.wellness) wellness.set(w.date, w);
    for (const s of p.weeks) if (s.startDate >= p.from && s.endDate <= p.to) weeks.set(s.isoWeek, s);
  }
  const workouts = new Map<LocalDate, PlannedWorkout[]>();
  const activities = new Map<LocalDate, Activity[]>();
  const events = new Map<LocalDate, Event[]>();
  const markers = new Map<LocalDate, DayMarker[]>();
  for (const w of wById.values()) push(workouts, w.date, w);
  for (const a of aById.values()) push(activities, a.localDate, a);
  for (const e of evById.values()) push(events, e.date, e);
  for (const m of mkById.values()) {
    const end = m.endDate ?? m.date;
    for (let d = m.date, n = 0; d <= end && n < 120; d = addDays(d, 1), n++) push(markers, d, m);
  }
  const prio = { A: 0, B: 1, C: 2 } as const;
  for (const list of events.values()) list.sort((a, b) => prio[a.priority] - prio[b.priority]);
  return {
    workouts,
    activities,
    events,
    markers,
    notes,
    wellness,
    weeks,
    phases: [...phById.values()],
    loadedFrom,
    today,
    all: { workouts: wById, activities: aById },
  };
}

const sameRefs = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Day/week view-model factory with structural sharing across index rebuilds. */
export function useCalendarModel(pages: (CalendarResponse | undefined)[]) {
  const index = useMemo(() => buildIndex(pages), [pages]);
  const dayCache = useRef(new Map<LocalDate, { sig: unknown[]; data: DayData }>());
  const weekCache = useRef(new Map<LocalDate, { sig: unknown[]; data: WeekData }>());

  return useMemo(() => {
    const isLoaded = (d: LocalDate) => index.loadedFrom.some(([f, t]) => d >= f && d <= t);
    const getDay = (date: LocalDate): DayData => {
      const ws = index.workouts.get(date) ?? [];
      const as = index.activities.get(date) ?? [];
      const ev = index.events.get(date) ?? [];
      const mk = index.markers.get(date) ?? [];
      const note = index.notes.get(date);
      const well = index.wellness.get(date);
      const loaded = isLoaded(date);
      const sig = [loaded, note, well, ...ws, 0, ...as, 0, ...ev, 0, ...mk];
      const prev = dayCache.current.get(date);
      if (prev && sameRefs(prev.sig, sig)) return prev.data;
      const data: DayData = {
        date,
        cards: ws.length || as.length ? dayCards({ workouts: ws, activities: as }, date) : [],
        events: ev,
        markers: mk,
        note,
        wellness: well,
        loaded,
      };
      dayCache.current.set(date, { sig, data });
      return data;
    };
    const phaseFor = (start: LocalDate): PhaseInfo | undefined => {
      const ph = index.phases.find((p) => p.startDate <= start && p.endDate >= start);
      if (!ph) return undefined;
      const count = Math.max(1, Math.round((diffDays(ph.startDate, ph.endDate) + 1) / 7));
      const idx = Math.floor(diffDays(ph.startDate, start) / 7) + 1;
      return { phase: ph, index: idx, count, isFirst: idx === 1, isLast: idx >= count };
    };
    const getWeek = (start: LocalDate): WeekData => {
      const days = Array.from({ length: 7 }, (_, i) => getDay(addDays(start, i)));
      const iso = isoWeekOf(start);
      const summary = index.weeks.get(iso);
      const phase = phaseFor(start);
      const sig = [...days, summary, phase?.phase, phase?.index];
      const prev = weekCache.current.get(start);
      if (prev && sameRefs(prev.sig, sig)) return prev.data;
      const data: WeekData = { start, isoWeek: iso, days, summary, phase, loaded: days[0]!.loaded };
      weekCache.current.set(start, { sig, data });
      return data;
    };
    const findCard = (key: string): { card: CalendarCard; date: LocalDate } | null => {
      const w = index.all.workouts.get(key);
      const date = w?.date ?? index.all.activities.get(key)?.localDate;
      if (!date) return null;
      const card = getDay(date).cards.find((c) => c.key === key);
      return card ? { card, date } : null;
    };
    return { index, getDay, getWeek, findCard, today: index.today };
  }, [index]);
}

export type CalendarModel = ReturnType<typeof useCalendarModel>;

/** Fetch the 12-week pages covering week indices [first, last]. */
export function useCalendarPages(first: number, last: number, enabled = true) {
  const pages: number[] = [];
  for (let p = pageOfWeek(first); p <= pageOfWeek(last); p++) pages.push(p);
  const results = useQueries({
    queries: pages.map((p) => {
      const { from, to } = pageRange(p);
      return { ...calendarQuery(from, to), enabled };
    }),
  });
  const datas = results.map((r) => r.data);
  const key = datas.map((d, i) => (d ? `${pages[i]}:${d.from}` : `${pages[i]}:-`)).join('|');
  // stable array identity while the underlying data objects are unchanged
  const ref = useRef<{ arr: (CalendarResponse | undefined)[] }>({ arr: [] });
  if (!sameRefs(ref.current.arr, datas)) ref.current = { arr: datas };
  return {
    data: ref.current.arr,
    key,
    error: results.find((r) => r.error)?.error ?? null,
    refetch: () => results.forEach((r) => r.error && r.refetch()),
    anyLoading: results.some((r) => r.isPending),
  };
}
