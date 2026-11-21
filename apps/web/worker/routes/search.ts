import { Hono } from 'hono';
import { z } from 'zod';
import { SPORT_META, type Event, type LocalDate, type Sport } from '@cadence/core/domain';
import { addDays, isoWeekOf, isoWeekStart, isoWeekday, parseDate } from '@cadence/core/time';
import { fmtHMM } from '@cadence/core/workout';
import type { AppEnv } from '../env';
import { all } from '../db/sql';
import { eventFromRow } from '../db/furniture';
import { getToday, validate } from '../services/context';

export type SearchItemType = 'date' | 'week' | 'month' | 'workout' | 'activity' | 'template' | 'event';

export interface SearchItem {
  type: SearchItemType;
  id: string;
  title: string;
  subtitle?: string;
  date?: LocalDate;
  href: string;
}

export interface SearchGroup {
  type: 'jump' | 'workouts' | 'activities' | 'templates' | 'events';
  label: string;
  items: SearchItem[];
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DOW_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const monthIndex = (w: string): number => (w.length >= 3 ? MONTHS.findIndex((m) => w.startsWith(m) && m.startsWith(w.slice(0, 3))) : -1);
const pad = (n: number) => String(n).padStart(2, '0');

function validDate(y: number, m: number, d: number): LocalDate | null {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const s = `${String(y).padStart(4, '0')}-${pad(m)}-${pad(d)}`;
  return new Date(parseDate(s)).getUTCDate() === d ? s : null;
}

/** Month/day without a year → the occurrence closest to today. */
function nearestYear(m: number, d: number, today: LocalDate): LocalDate | null {
  const y = Number(today.slice(0, 4));
  const cands = [y - 1, y, y + 1].map((yy) => validDate(yy, m, d)).filter((x): x is LocalDate => !!x);
  if (!cands.length) return null;
  const t = parseDate(today);
  return cands.sort((a, b) => Math.abs(parseDate(a) - t) - Math.abs(parseDate(b) - t))[0];
}

function longDate(d: LocalDate): string {
  return `${DOW_LONG[isoWeekday(d) - 1]} ${Number(d.slice(8, 10))} ${MONTH_LONG[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
}

const dateItem = (d: LocalDate, title?: string): SearchItem => ({
  type: 'date',
  id: d,
  title: title ?? longDate(d),
  subtitle: title ? longDate(d) : `Week ${Number(isoWeekOf(d).slice(6))}`,
  date: d,
  href: `/calendar/day/${d}`,
});

const weekItem = (w: string): SearchItem => {
  const start = isoWeekStart(w);
  return {
    type: 'week',
    id: w,
    title: `Week ${Number(w.slice(6))}, ${w.slice(0, 4)}`,
    subtitle: `${longDate(start).split(' ').slice(1, 3).join(' ')} – ${longDate(addDays(start, 6)).split(' ').slice(1, 3).join(' ')}`,
    date: start,
    href: `/calendar/week/${w}`,
  };
};

/** Date / week / month jump targets from free text ("dec 24", "w52", "+8w", "next race", "tomorrow", "fri"). */
export function parseJumpTargets(raw: string, today: LocalDate, events: Event[]): SearchItem[] {
  const q = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return [];
  const out: SearchItem[] = [];
  let m: RegExpMatchArray | null;

  if (q === 'today' || q === 'now') out.push(dateItem(today, 'Today'));
  else if (q === 'tomorrow' || q === 'tmr') out.push(dateItem(addDays(today, 1), 'Tomorrow'));
  else if (q === 'yesterday') out.push(dateItem(addDays(today, -1), 'Yesterday'));
  else if (q === 'this week') out.push(weekItem(isoWeekOf(today)));
  else if (q === 'next week') out.push(weekItem(isoWeekOf(addDays(today, 7))));
  else if (q === 'last week') out.push(weekItem(isoWeekOf(addDays(today, -7))));

  if ((m = q.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    const d = validDate(+m[1], +m[2], +m[3]);
    if (d) out.push(dateItem(d));
  }
  // "dec 24", "december 24 2027", "24 dec", "24 december 2027"
  if ((m = q.match(/^([a-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,?(?: (\d{4}))?$/)) || (m = q.match(/^(\d{1,2})(?:st|nd|rd|th)? ([a-z]{3,9})\.?(?: (\d{4}))?$/))) {
    const [a, b] = /^\d/.test(m[1]) ? [m[2], m[1]] : [m[1], m[2]];
    const mi = monthIndex(a);
    if (mi >= 0) {
      const d = m[3] ? validDate(+m[3], mi + 1, +b) : nearestYear(mi + 1, +b, today);
      if (d) out.push(dateItem(d));
    }
  }
  // "dec", "december 2026" → month
  if ((m = q.match(/^([a-z]{3,9})(?: (\d{4}))?$/))) {
    const mi = monthIndex(m[1]);
    if (mi >= 0) {
      let y = m[2] ? +m[2] : Number(today.slice(0, 4));
      if (!m[2]) {
        const near = nearestYear(mi + 1, 15, today);
        if (near) y = Number(near.slice(0, 4));
      }
      out.push({
        type: 'month',
        id: `${y}-${pad(mi + 1)}`,
        title: `${MONTH_LONG[mi]} ${y}`,
        date: `${y}-${pad(mi + 1)}-01`,
        href: `/calendar/month/${y}-${pad(mi + 1)}`,
      });
    }
  }
  // "w52", "week 52", "2026-w52", "w52 2027"
  if ((m = q.match(/^(?:(\d{4})-?)?w(?:eek)? ?(\d{1,2})(?: (\d{4}))?$/))) {
    const wk = +m[2];
    const year = m[1] ? +m[1] : m[3] ? +m[3] : null;
    if (wk >= 1 && wk <= 53) {
      let y = year ?? Number(isoWeekOf(today).slice(0, 4));
      if (year === null) {
        // nearest occurrence of that week number
        const cands = [y - 1, y, y + 1].map((yy) => `${yy}-W${pad(wk)}`).filter((w) => isoWeekOf(isoWeekStart(w)) === w);
        const t = parseDate(today);
        cands.sort((a, b) => Math.abs(parseDate(isoWeekStart(a)) - t) - Math.abs(parseDate(isoWeekStart(b)) - t));
        if (cands[0]) y = Number(cands[0].slice(0, 4));
      }
      const w = `${y}-W${pad(wk)}`;
      if (isoWeekOf(isoWeekStart(w)) === w) out.push(weekItem(w));
    }
  }
  // "+8w", "-3d", "+2m", "+1y", "in 3 weeks"
  if ((m = q.match(/^([+-])\s?(\d{1,3}) ?(d|w|m|y)[a-z]*$/)) || (m = q.match(/^(in) (\d{1,3}) (d|w|m|y)[a-z]*$/))) {
    const n = (m[1] === '-' ? -1 : 1) * +m[2];
    const unit = m[3];
    if (unit === 'd') out.push(dateItem(addDays(today, n), `${n >= 0 ? '+' : ''}${n} day${Math.abs(n) === 1 ? '' : 's'}`));
    else if (unit === 'w') out.push({ ...weekItem(isoWeekOf(addDays(today, 7 * n))), subtitle: `${n >= 0 ? '+' : ''}${n} weeks from today` });
    else {
      const months = unit === 'm' ? n : 12 * n;
      const y0 = Number(today.slice(0, 4));
      const m0 = Number(today.slice(5, 7)) - 1 + months;
      const y = y0 + Math.floor(m0 / 12);
      const mo = ((m0 % 12) + 12) % 12;
      const day = Math.min(Number(today.slice(8, 10)), new Date(Date.UTC(y, mo + 1, 0)).getUTCDate());
      out.push(dateItem(`${y}-${pad(mo + 1)}-${pad(day)}`, `${n >= 0 ? '+' : ''}${n} ${unit === 'm' ? 'month' : 'year'}${Math.abs(n) === 1 ? '' : 's'}`));
    }
  }
  // weekday names: "fri", "next tue", "last mon"
  if ((m = q.match(/^(?:(next|last|this) )?([a-z]{3,9})$/))) {
    const wd = WEEKDAYS.findIndex((d) => m![2].startsWith(d) && DOW_LONG[WEEKDAYS.indexOf(d)].toLowerCase().startsWith(m![2]));
    if (wd >= 0) {
      const cur = isoWeekday(today) - 1;
      let delta = wd - cur;
      if (m[1] === 'last') delta = delta >= 0 ? delta - 7 : delta;
      else if (m[1] === 'next') delta = delta <= 0 ? delta + 7 : delta;
      else if (m[1] !== 'this' && delta < 0) delta += 7;
      out.push(dateItem(addDays(today, delta)));
    }
  }
  // "next race" / "next event" / "next a race"
  if ((m = q.match(/^next ?(a |b |c )?(race|event)s?$/))) {
    const prio = m[1]?.trim().toUpperCase();
    const next = events.find((e) => e.date >= today && (!prio || e.priority === prio));
    if (next)
      out.push({
        type: 'event',
        id: next.id,
        title: next.name,
        subtitle: `${prio ? `${prio} race` : 'Next event'} · ${longDate(next.date)} · in ${Math.round((parseDate(next.date) - parseDate(today)) / 86_400_000)} days`,
        date: next.date,
        href: `/events/${next.id}`,
      });
  }
  const seen = new Set<string>();
  return out.filter((i) => (seen.has(`${i.type}:${i.id}`) ? false : (seen.add(`${i.type}:${i.id}`), true)));
}

/** Every word must match one of `cols` (or, with `sport`, name the row's sport: "ride" → bike). */
function likeAll(words: string[], cols: string[], sport = false): { sql: string; params: string[] } {
  if (!words.length) return { sql: '0', params: [] };
  const parts: string[] = [];
  const params: string[] = [];
  for (const w of words) {
    const ors = cols.map((c) => `lower(coalesce(${c}, '')) LIKE ?`);
    for (let i = 0; i < cols.length; i++) params.push(`%${w}%`);
    const sports = sport ? sportAliases([w]) : [];
    if (sports.length) {
      ors.push(`sport IN (${sports.map(() => '?').join(', ')})`);
      params.push(...sports);
    }
    parts.push(`(${ors.join(' OR ')})`);
  }
  return { sql: parts.join(' AND '), params };
}

/** Sport words ("ride", "running") → sport ids so "ride" finds bike workouts. */
function sportAliases(words: string[]): string[] {
  const out: string[] = [];
  for (const w of words) {
    for (const [s, meta] of Object.entries(SPORT_META)) {
      if (w.length >= 3 && (meta.label.toLowerCase().startsWith(w) || s.startsWith(w))) out.push(s);
    }
    if (['cycling', 'cycle', 'ride'].some((x) => x.startsWith(w) && w.length >= 3)) out.push('bike');
    if (['running'].some((x) => x.startsWith(w) && w.length >= 3)) out.push('run');
  }
  return [...new Set(out)];
}

const sportLabel = (s: string) => SPORT_META[s as Sport]?.label ?? s;
const LIMIT = 8;

/** Mounted at /api — define full paths here (see docs/ARCHITECTURE.md → API surface). */
export const searchRoutes = new Hono<AppEnv>().get('/search', validate('query', z.object({ q: z.string().max(200).default('') })), async (c) => {
  const q = c.req.valid('query').q.trim();
  const today = await getToday(c.env);
  const db = c.env.DB;
  const events = (await all(db, 'SELECT * FROM events WHERE date >= ? ORDER BY date, id LIMIT 50', addDays(today, -1))).map(eventFromRow);
  const groups: SearchGroup[] = [];
  const jump = parseJumpTargets(q, today, events);
  if (jump.length) groups.push({ type: 'jump', label: 'Go to', items: jump });
  // words: drop tokens shorter than 2 chars, cap at 5
  const words = q
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[%_]/g, ''))
    .filter((w) => w.length >= 2)
    .slice(0, 5);
  if (!words.length) return c.json({ q, groups });

  const wl = likeAll(words, ['title', 'tags', 'description'], true);
  const [workouts, activities, templates, evts] = await Promise.all([
    all<{ id: string; date: string; title: string; sport: string; planned_duration_sec: number | null; status: string }>(
      db,
      `SELECT id, date, title, sport, planned_duration_sec, status FROM workouts WHERE ${wl.sql}
       ORDER BY abs(julianday(date) - julianday(?)), date DESC LIMIT ${LIMIT}`,
      ...wl.params,
      today,
    ),
    (() => {
      const l = likeAll(words, ['title', 'tags', 'post_note'], true);
      return all<{ id: string; local_date: string; title: string; sport: string; duration_sec: number; distance_m: number | null }>(
        db,
        `SELECT id, local_date, title, sport, duration_sec, distance_m FROM activities
         WHERE deleted_at IS NULL AND ${l.sql} ORDER BY started_at DESC LIMIT ${LIMIT}`,
        ...l.params,
      );
    })(),
    (() => {
      const l = likeAll(words, ['title', 'tags', 'folder', 'description'], true);
      return all<{ id: string; title: string; sport: string; planned_duration_sec: number | null; folder: string | null }>(
        db,
        `SELECT id, title, sport, planned_duration_sec, folder FROM templates WHERE ${l.sql}
         ORDER BY usage_count DESC, title LIMIT ${LIMIT}`,
        ...l.params,
      );
    })(),
    (() => {
      const l = likeAll(words, ['name', 'location', 'goal', 'note']);
      return all(db, `SELECT * FROM events WHERE ${l.sql} ORDER BY abs(julianday(date) - julianday(?)) LIMIT ${LIMIT}`, ...l.params, today);
    })(),
  ]);

  if (workouts.length)
    groups.push({
      type: 'workouts',
      label: 'Planned workouts',
      items: workouts.map((w) => ({
        type: 'workout',
        id: w.id,
        title: w.title,
        subtitle: [longDate(w.date), sportLabel(w.sport), w.planned_duration_sec ? fmtHMM(w.planned_duration_sec) : null, w.status === 'skipped' ? 'skipped' : null]
          .filter(Boolean)
          .join(' · '),
        date: w.date,
        href: `/workouts/${w.id}`,
      })),
    });
  if (activities.length)
    groups.push({
      type: 'activities',
      label: 'Activities',
      items: activities.map((a) => ({
        type: 'activity',
        id: a.id,
        title: a.title,
        subtitle: [longDate(a.local_date), sportLabel(a.sport), fmtHMM(a.duration_sec), a.distance_m ? `${(a.distance_m / 1000).toFixed(1)} km` : null]
          .filter(Boolean)
          .join(' · '),
        date: a.local_date,
        href: `/activities/${a.id}`,
      })),
    });
  if (templates.length)
    groups.push({
      type: 'templates',
      label: 'Library',
      items: templates.map((t) => ({
        type: 'template',
        id: t.id,
        title: t.title,
        subtitle: [sportLabel(t.sport), t.planned_duration_sec ? fmtHMM(t.planned_duration_sec) : null, t.folder].filter(Boolean).join(' · '),
        href: `/library/${t.id}`,
      })),
    });
  if (evts.length)
    groups.push({
      type: 'events',
      label: 'Events',
      items: evts.map(eventFromRow).map((e) => ({
        type: 'event',
        id: e.id,
        title: e.name,
        subtitle: [`${e.priority} race`, longDate(e.date), e.location].filter(Boolean).join(' · '),
        date: e.date,
        href: `/events/${e.id}`,
      })),
    });
  return c.json({ q, groups });
});
