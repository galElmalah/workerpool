/**
 * Default palette commands (Navigate / Create / Actions) + a natural date source
 * ("dec 24", "next tue", "w48", "+2w", "2026-12-24"). Features add their own sources with
 * `usePaletteSource` (see src/ui/palette/registry.ts).
 */
import { addDays, isoWeekOf, isoWeekStart, isoWeekday } from '@cadence/core/time';
import { SPORT_META, type Sport } from '@cadence/core';
import type { AnyRouter } from '@tanstack/react-router';
import {
  BookCopy,
  CalendarDays,
  CalendarRange,
  ChartSpline,
  Gauge,
  History,
  Keyboard,
  LayoutGrid,
  Moon,
  NotebookPen,
  PanelLeft,
  Plus,
  RefreshCw,
  Settings,
  Sparkle,
  Sunrise,
} from 'lucide-react';
import { formatDateMedium, formatIsoWeekRange } from '@/lib/format';
import { localToday } from '@/lib/hooks/useToday';
import { setMotionPref, isReducedMotion } from '@/motion/prefs';
import { SportGlyph } from '@/ui/domain/SportGlyph';
import { registerPaletteSource, type PaletteCommand } from '@/ui/palette/registry';
import { toggleTheme } from './theme';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** Parses a natural date query relative to today. Returns a LocalDate, an IsoWeek, or null. */
export function parseDateQuery(q: string, today: string): { date?: string; week?: string } | null {
  const t = q.trim().toLowerCase();
  if (!t) return null;
  if (t === 'today' || t === 'tod') return { date: today };
  if (t === 'tomorrow' || t === 'tmr' || t === 'tom') return { date: addDays(today, 1) };
  if (t === 'yesterday') return { date: addDays(today, -1) };
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return { date: t };
  m = /^([+-])(\d{1,3})\s*([dw])$/.exec(t);
  if (m) {
    const n = Number(m[2]) * (m[3] === 'w' ? 7 : 1) * (m[1] === '-' ? -1 : 1);
    return m[3] === 'w' ? { week: isoWeekOf(addDays(today, n)) } : { date: addDays(today, n) };
  }
  m = /^(?:w|wk|week)\s*(\d{1,2})$/.exec(t);
  if (m) {
    const n = Number(m[1]);
    if (n < 1 || n > 53) return null;
    const year = Number(isoWeekOf(today).slice(0, 4));
    return { week: `${year}-W${String(n).padStart(2, '0')}` };
  }
  m = /^(?:(next|this)\s+)?(mon|tue|wed|thu|fri|sat|sun)[a-z]*$/.exec(t);
  if (m) {
    const target = DAYS.indexOf(m[2]!) + 1;
    // The next upcoming occurrence ("tue" and "next tue" both mean the coming Tuesday).
    let delta = (target - isoWeekday(today) + 7) % 7;
    if (delta === 0 && m[1] !== 'this') delta = 7;
    return { date: addDays(today, delta) };
  }
  m = /^(\d{1,2})\s+([a-z]{3})[a-z]*$/.exec(t) ?? null;
  const m2 = /^([a-z]{3})[a-z]*\s+(\d{1,2})$/.exec(t);
  const day = m ? Number(m[1]) : m2 ? Number(m2[2]) : NaN;
  const mon = m ? MONTHS.indexOf(m[2]!) : m2 ? MONTHS.indexOf(m2[1]!) : -1;
  if (mon >= 0 && day >= 1 && day <= 31) {
    let year = Number(today.slice(0, 4));
    let d = `${year}-${String(mon + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    // choose the nearest occurrence (within ±6 months)
    if (d < addDays(today, -183)) d = `${++year}${d.slice(4)}`;
    else if (d > addDays(today, 183)) d = `${--year}${d.slice(4)}`;
    return { date: d };
  }
  return null;
}

let installed = false;

export function installDefaultCommands(router: AnyRouter, opts: { toggleRail: () => void }) {
  if (installed) return;
  installed = true;
  const go = (to: string, search?: Record<string, unknown>) => () => void router.navigate({ to, search } as never);

  const nav: PaletteCommand[] = [
    { id: 'nav.today', group: 'Navigate', title: 'Today', icon: <Sunrise />, kbd: 'g t', perform: go('/today') },
    { id: 'nav.calendar', group: 'Navigate', title: 'Calendar', icon: <CalendarDays />, kbd: 'g c', perform: go('/calendar') },
    { id: 'nav.agenda', group: 'Navigate', title: 'Agenda', icon: <CalendarRange />, perform: go('/calendar/agenda') },
    { id: 'nav.thisweek', group: 'Navigate', title: 'This week', subtitle: 'Weekly review', icon: <CalendarRange />, keywords: ['review', 'week'], perform: () => void router.navigate({ to: '/week/$isoWeek', params: { isoWeek: isoWeekOf(localToday()) } } as never) },
    { id: 'nav.trends', group: 'Navigate', title: 'Trends', icon: <ChartSpline />, kbd: 'g r', perform: go('/trends') },
    { id: 'nav.fitness', group: 'Navigate', title: 'Fitness, Fatigue & Form', subtitle: 'Trends', icon: <Gauge />, keywords: ['pmc', 'ctl', 'form'], perform: go('/trends/fitness') },
    { id: 'nav.volume', group: 'Navigate', title: 'Volume & load', subtitle: 'Trends', icon: <ChartSpline />, perform: go('/trends/volume') },
    { id: 'nav.intensity', group: 'Navigate', title: 'Intensity distribution', subtitle: 'Trends', icon: <ChartSpline />, perform: go('/trends/intensity') },
    { id: 'nav.peaks', group: 'Navigate', title: 'Peaks & bests', subtitle: 'Trends', icon: <ChartSpline />, keywords: ['power curve', 'records', 'pr'], perform: go('/trends/peaks') },
    { id: 'nav.wellness', group: 'Navigate', title: 'Wellness', subtitle: 'Trends', icon: <ChartSpline />, keywords: ['hrv', 'sleep', 'weight'], perform: go('/trends/wellness') },
    { id: 'nav.activities', group: 'Navigate', title: 'Activities', icon: <History />, kbd: 'g a', perform: go('/activities') },
    { id: 'nav.library', group: 'Navigate', title: 'Library', icon: <BookCopy />, kbd: 'g l', keywords: ['templates'], perform: go('/library') },
    { id: 'nav.journal', group: 'Navigate', title: 'Journal', icon: <NotebookPen />, kbd: 'g j', keywords: ['notes'], perform: go('/journal') },
    { id: 'nav.settings', group: 'Navigate', title: 'Settings', icon: <Settings />, kbd: 'g s', perform: go('/settings/profile') },
    { id: 'nav.zones', group: 'Navigate', title: 'Zones & thresholds', subtitle: 'Settings', icon: <Settings />, keywords: ['ftp', 'lthr', 'css'], perform: go('/settings/zones') },
    { id: 'nav.garmin', group: 'Navigate', title: 'Garmin connection', subtitle: 'Settings', icon: <RefreshCw />, perform: go('/settings/garmin') },
    { id: 'nav.synclog', group: 'Navigate', title: 'Sync log', subtitle: 'Settings', icon: <RefreshCw />, perform: go('/settings/sync') },
    { id: 'nav.appearance', group: 'Navigate', title: 'Appearance', subtitle: 'Settings', icon: <Settings />, keywords: ['theme', 'dark', 'light'], perform: go('/settings/appearance') },
  ];

  const sports: Sport[] = ['run', 'bike', 'swim', 'row', 'strength'];
  const create: PaletteCommand[] = [
    { id: 'create.workout', group: 'Create', title: 'New workout', icon: <Plus />, kbd: 'n', perform: go('/workouts/new') },
    ...sports.map<PaletteCommand>((sp) => ({
      id: `create.${sp}`,
      group: 'Create',
      title: `New ${SPORT_META[sp].label.toLowerCase()}`,
      icon: <SportGlyph sport={sp} />,
      keywords: [sp],
      perform: go('/workouts/new', { sport: sp }),
    })),
  ];

  const actions: PaletteCommand[] = [
    { id: 'act.theme', group: 'Actions', title: 'Toggle light / dark', icon: <Moon />, kbd: 'shift+t', keywords: ['theme', 'dark mode'], perform: toggleTheme, keepOpen: true },
    { id: 'act.rail', group: 'Actions', title: 'Toggle sidebar', icon: <PanelLeft />, kbd: '[', perform: opts.toggleRail },
    { id: 'act.motion', group: 'Actions', title: 'Toggle reduced motion', icon: <Sparkle />, keywords: ['animation', 'accessibility'], perform: () => setMotionPref(isReducedMotion() ? 'full' : 'reduced'), keepOpen: true },
    { id: 'act.shortcuts', group: 'Actions', title: 'Keyboard shortcuts', icon: <Keyboard />, kbd: '?', perform: go('/settings/shortcuts') },
    { id: 'act.gallery', group: 'Actions', title: 'Design system gallery', subtitle: '/dev/gallery', icon: <LayoutGrid />, keywords: ['components', 'ui'], perform: go('/dev/gallery') },
  ];

  registerPaletteSource({ id: 'shell.static', commands: [...nav, ...create, ...actions] });

  registerPaletteSource({
    id: 'shell.dates',
    group: 'Jump to date',
    minQuery: 2,
    search: (q) => {
      const today = localToday();
      const r = parseDateQuery(q, today);
      if (!r) return [];
      if (r.week) {
        const start = isoWeekStart(r.week);
        return [
          { id: `date.week.${r.week}`, group: 'Jump to date', title: `Week ${Number(r.week.slice(6))}`, subtitle: formatIsoWeekRange(r.week, true), icon: <CalendarRange />, perform: () => void router.navigate({ to: '/calendar/week/$isoWeek', params: { isoWeek: r.week } } as never) },
          { id: `date.review.${r.week}`, group: 'Jump to date', title: `Review week ${Number(r.week.slice(6))}`, subtitle: formatDateMedium(start), icon: <CalendarRange />, perform: () => void router.navigate({ to: '/week/$isoWeek', params: { isoWeek: r.week } } as never) },
        ];
      }
      const d = r.date!;
      return [
        { id: `date.day.${d}`, group: 'Jump to date', title: formatDateMedium(d, true), subtitle: 'Open day', icon: <CalendarDays />, perform: () => void router.navigate({ to: '/calendar/day/$date', params: { date: d } } as never) },
        { id: `date.new.${d}`, group: 'Jump to date', title: `New workout on ${formatDateMedium(d)}`, icon: <Plus />, perform: go('/workouts/new', { date: d }) },
      ];
    },
  });
}
