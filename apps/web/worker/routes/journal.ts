import { Hono } from 'hono';
import { z } from 'zod';
import type { LocalDate, Sport } from '@cadence/core/domain';
import { isoWeekStart, addDays } from '@cadence/core/time';
import type { AppEnv } from '../env';
import { badRequest } from '../lib/http';
import { b64uDecode, b64uEncode } from '../lib/crypto';
import { all } from '../db/sql';
import { validate } from '../services/context';

export const JOURNAL_TYPES = ['week', 'day', 'workout_pre', 'activity_post'] as const;
export type JournalType = (typeof JOURNAL_TYPES)[number];

export interface JournalItem {
  type: JournalType;
  date: LocalDate;
  title: string;
  body: string;
  /** day → date, workout_pre → workout id, activity_post → activity id, week → ISO week. */
  ref: string;
  sport?: Sport;
  rpe?: number;
  feel?: number;
}

/** Order within a day: week reflection (dated on its Sunday), day note, workout pre-notes, activity post-notes. */
const RANK: Record<JournalType, number> = { week: 0, day: 1, workout_pre: 2, activity_post: 3 };

type Cursor = [date: string, rank: number, ref: string];

const enc = new TextEncoder();
const dec = new TextDecoder();
const encodeCursor = (c: Cursor) => b64uEncode(enc.encode(JSON.stringify(c)));
function decodeCursor(s: string): Cursor {
  try {
    const v = JSON.parse(dec.decode(b64uDecode(s))) as unknown;
    if (Array.isArray(v) && v.length === 3 && typeof v[0] === 'string' && typeof v[1] === 'number' && typeof v[2] === 'string') return v as Cursor;
  } catch {
    /* fall through */
  }
  throw badRequest('Bad cursor', 'validation');
}

/** Is (date, rank, ref) strictly after the cursor in feed order? */
function after(it: JournalItem, c: Cursor | null): boolean {
  if (!c) return true;
  if (it.date !== c[0]) return it.date < c[0];
  const r = RANK[it.type];
  if (r !== c[1]) return r > c[1];
  return it.ref < c[2];
}

/** SQL keyset predicate for a source with constant rank `rank` (dateCol/refCol are column expressions). */
function keyset(c: Cursor | null, rank: number, dateCol: string, refCol: string): { sql: string; params: unknown[] } {
  if (!c) return { sql: '1', params: [] };
  if (rank > c[1]) return { sql: `${dateCol} <= ?`, params: [c[0]] };
  if (rank < c[1]) return { sql: `${dateCol} < ?`, params: [c[0]] };
  return { sql: `(${dateCol} < ? OR (${dateCol} = ? AND ${refCol} < ?))`, params: [c[0], c[0], c[2]] };
}

function likeClause(words: string[], cols: string[]): { sql: string; params: unknown[] } {
  if (!words.length) return { sql: '1', params: [] };
  const parts: string[] = [];
  const params: unknown[] = [];
  for (const w of words) {
    parts.push(`(${cols.map((col) => `lower(coalesce(${col}, '')) LIKE ?`).join(' OR ')})`);
    for (let i = 0; i < cols.length; i++) params.push(`%${w}%`);
  }
  return { sql: parts.join(' AND '), params };
}

/** Mounted at /api — define full paths here (see docs/ARCHITECTURE.md → API surface). */
export const journalRoutes = new Hono<AppEnv>().get(
  '/journal',
  validate(
    'query',
    z.object({
      cursor: z.string().max(500).optional(),
      type: z.string().max(100).optional(),
      q: z.string().max(200).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
  ),
  async (c) => {
    const { cursor: rawCursor, type, q, limit: rawLimit } = c.req.valid('query');
    const limit = rawLimit ?? 30;
    const cursor = rawCursor ? decodeCursor(rawCursor) : null;
    const types = new Set<JournalType>(
      type
        ? type.split(',').map((t) => {
            const v = t.trim() as JournalType;
            if (!JOURNAL_TYPES.includes(v)) throw badRequest(`Unknown journal type ${t}`, 'validation');
            return v;
          })
        : JOURNAL_TYPES,
    );
    const words = (q ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5);
    const db = c.env.DB;
    const take = limit + 1;
    const items: JournalItem[] = [];

    if (types.has('day')) {
      const k = keyset(cursor, RANK.day, 'date', 'date');
      const l = likeClause(words, ['body']);
      const rows = await all<{ date: string; body: string }>(
        db,
        `SELECT date, body FROM day_notes WHERE trim(body) != '' AND ${k.sql} AND ${l.sql} ORDER BY date DESC LIMIT ?`,
        ...k.params,
        ...l.params,
        take,
      );
      for (const r of rows) items.push({ type: 'day', date: r.date, title: 'Day note', body: r.body, ref: r.date });
    }
    if (types.has('workout_pre')) {
      const k = keyset(cursor, RANK.workout_pre, 'date', 'id');
      const l = likeClause(words, ['pre_note', 'title']);
      const rows = await all<{ date: string; id: string; title: string; pre_note: string; sport: Sport }>(
        db,
        `SELECT date, id, title, pre_note, sport FROM workouts
         WHERE pre_note IS NOT NULL AND trim(pre_note) != '' AND ${k.sql} AND ${l.sql}
         ORDER BY date DESC, id DESC LIMIT ?`,
        ...k.params,
        ...l.params,
        take,
      );
      for (const r of rows) items.push({ type: 'workout_pre', date: r.date, title: r.title, body: r.pre_note, ref: r.id, sport: r.sport });
    }
    if (types.has('activity_post')) {
      const k = keyset(cursor, RANK.activity_post, 'local_date', 'id');
      const l = likeClause(words, ['post_note', 'title']);
      const rows = await all<{ local_date: string; id: string; title: string; post_note: string; sport: Sport; rpe: number | null; feel: number | null }>(
        db,
        `SELECT local_date, id, title, post_note, sport, rpe, feel FROM activities
         WHERE deleted_at IS NULL AND post_note IS NOT NULL AND trim(post_note) != '' AND ${k.sql} AND ${l.sql}
         ORDER BY local_date DESC, id DESC LIMIT ?`,
        ...k.params,
        ...l.params,
        take,
      );
      for (const r of rows)
        items.push({
          type: 'activity_post',
          date: r.local_date,
          title: r.title,
          body: r.post_note,
          ref: r.id,
          sport: r.sport,
          ...(r.rpe != null ? { rpe: r.rpe } : {}),
          ...(r.feel != null ? { feel: r.feel } : {}),
        });
    }
    if (types.has('week')) {
      const l = likeClause(words, ['body']);
      const rows = await all<{ iso_week: string; body: string }>(
        db,
        `SELECT iso_week, body FROM week_notes WHERE trim(body) != '' AND ${l.sql} ORDER BY iso_week DESC`,
        ...l.params,
      );
      for (const r of rows) {
        const it: JournalItem = {
          type: 'week',
          date: addDays(isoWeekStart(r.iso_week), 6),
          title: `Week ${Number(r.iso_week.slice(6))} reflection`,
          body: r.body,
          ref: r.iso_week,
        };
        if (after(it, cursor)) items.push(it);
      }
    }

    items.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : RANK[a.type] - RANK[b.type] || (a.ref < b.ref ? 1 : a.ref > b.ref ? -1 : 0)));
    const page = items.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor = items.length > limit && last ? encodeCursor([last.date, RANK[last.type], last.ref]) : null;
    return c.json({ items: page, nextCursor });
  },
);
