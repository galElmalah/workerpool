/**
 * View-transition typing for every router navigation — design.md §5.2, adapted to the path-based
 * calendar routes of product.md §2.2:
 *   /calendar, /calendar/month/:m  → level 0 (month)
 *   /calendar/week/:isoWeek       → level 1
 *   /calendar/day/:date           → level 2
 *   /calendar/agenda              → lateral
 * Same calendar level with a different anchor (param or ?date=) pages next/prev.
 * History POPs (Back/Forward) are detected through TanStack's history index so "back" always
 * slides the right way, whatever the path depth.
 */
import type { ParsedLocation } from '@tanstack/react-router';
import { morph } from './morph';
import { isReducedMotion } from './prefs';

type Info = { fromLocation?: ParsedLocation; toLocation: ParsedLocation; pathChanged: boolean; hrefChanged: boolean };

const depth = (p: string) => p.split('/').filter(Boolean).length;

function calendarLevel(path: string): { level: number; anchor: string } | null {
  const m = /^\/calendar(?:\/(month|week|day|agenda)(?:\/([^/]+))?)?\/?$/.exec(path);
  if (!m) return null;
  const kind = m[1] ?? 'month';
  if (kind === 'agenda') return { level: -1, anchor: '' };
  return { level: kind === 'month' ? 0 : kind === 'week' ? 1 : 2, anchor: m[2] ?? '' };
}

/** Normalize anchors so month '2026-11', week '2026-W47' and day '2026-11-21' compare by time. */
function anchorKey(a: string, search: unknown): string {
  const d = (search as { date?: string } | undefined)?.date;
  return a || d || '';
}

const histIndex = (l?: ParsedLocation): number | undefined => {
  const s = l?.state as { __TSR_index?: number } | undefined;
  return typeof s?.__TSR_index === 'number' ? s.__TSR_index : undefined;
};

/** Routes between which a workout card may morph (list → detail). */
const MORPH_PAIR = /^\/(calendar|today|workouts|activities|library|week|journal|dev\/morph)(\/|$)/;

export function vtTypes({ fromLocation: f, toLocation: t, pathChanged, hrefChanged }: Info): string[] | false {
  if (!f) return false; // initial load
  if (!hrefChanged) return false;
  if (isReducedMotion()) return ['reduced'];

  const types: string[] = [];
  const fc = calendarLevel(f.pathname);
  const tc = calendarLevel(t.pathname);

  if (fc && tc && fc.level >= 0 && tc.level >= 0) {
    if (fc.level !== tc.level) return [tc.level > fc.level ? 'zoom-in' : 'zoom-out'];
    const a = anchorKey(fc.anchor, f.search);
    const b = anchorKey(tc.anchor, t.search);
    if (a !== b) return [b > a ? 'page-next' : 'page-prev'];
    return false; // filters etc.: Motion handles in-page
  }
  if (!pathChanged) return false; // search-only changes on other pages animate in-page

  if (!MORPH_PAIR.test(t.pathname)) morph.clear();
  if (morph.target) types.push('morph');

  const fi = histIndex(f);
  const ti = histIndex(t);
  if (fi !== undefined && ti !== undefined && ti < fi) types.push('back');
  else {
    const df = depth(f.pathname);
    const dt = depth(t.pathname);
    types.push(dt > df ? 'forward' : dt < df ? 'back' : 'lateral');
  }
  return types;
}
