/** Calendar furniture: events, phases, day markers, day/week notes, wellness days. */
import type { DayMarker, DayNote, Event, IsoWeek, LocalDate, Phase, WeekNote, WellnessDay } from '@cadence/core/domain';
import { nowIso } from '../lib/ids';
import { all, bindValue, chunk, compact, first, placeholders, run } from './sql';

type Row = Record<string, unknown>;
const opt = <T>(v: unknown): T | undefined => (v === null || v === undefined ? undefined : (v as T));

// ───────────────────────────── row mappers ─────────────────────────────

export const eventFromRow = (r: Row): Event =>
  compact({
    id: r.id as string,
    date: r.date as string,
    name: r.name as string,
    priority: r.priority as Event['priority'],
    sport: opt<Event['sport']>(r.sport),
    distanceM: opt<number>(r.distance_m),
    goal: opt<string>(r.goal),
    location: opt<string>(r.location),
    note: opt<string>(r.note),
    resultActivityId: opt<string>(r.result_activity_id),
  }) as Event;

export const phaseFromRow = (r: Row): Phase =>
  compact({
    id: r.id as string,
    type: r.type as Phase['type'],
    label: r.label as string,
    startDate: r.start_date as string,
    endDate: r.end_date as string,
    weeklyLoadTarget: opt<number>(r.weekly_load_target),
  }) as Phase;

export const markerFromRow = (r: Row): DayMarker =>
  compact({
    id: r.id as string,
    type: r.type as DayMarker['type'],
    date: r.date as string,
    endDate: opt<string>(r.end_date),
    label: opt<string>(r.label),
  }) as DayMarker;

export const dayNoteFromRow = (r: Row): DayNote => ({ date: r.date as string, body: r.body as string, updatedAt: r.updated_at as string });

export const weekNoteFromRow = (r: Row): WeekNote =>
  compact({
    isoWeek: r.iso_week as string,
    body: (r.body as string) ?? '',
    targetHours: opt<number>(r.target_hours),
    targetLoad: opt<number>(r.target_load),
    updatedAt: r.updated_at as string,
  }) as WeekNote;

const WELLNESS_MAP = {
  hrv_ms: 'hrvMs',
  hrv_status: 'hrvStatus',
  resting_hr: 'restingHr',
  sleep_sec: 'sleepSec',
  sleep_score: 'sleepScore',
  weight_kg: 'weightKg',
  body_battery: 'bodyBattery',
  stress: 'stress',
  readiness: 'readiness',
  vo2max: 'vo2max',
  feel: 'feel',
  soreness: 'soreness',
  note: 'note',
} as const satisfies Record<string, keyof WellnessDay>;

const DEVICE_COLS = ['hrv_ms', 'hrv_status', 'resting_hr', 'sleep_sec', 'sleep_score', 'weight_kg', 'body_battery', 'stress', 'readiness', 'vo2max'] as const;

export const wellnessFromRow = (r: Row): WellnessDay => {
  const out: Record<string, unknown> = { date: r.date };
  for (const [col, key] of Object.entries(WELLNESS_MAP)) if (r[col] !== null && r[col] !== undefined) out[key] = r[col];
  return out as WellnessDay;
};

// ───────────────────────────── list (range) ─────────────────────────────

export async function listEvents(db: D1Database, q: { from: LocalDate; to: LocalDate }): Promise<Event[]> {
  return (await all(db, 'SELECT * FROM events WHERE date >= ? AND date <= ? ORDER BY date, id', q.from, q.to)).map(eventFromRow);
}

export async function listAllEvents(db: D1Database): Promise<Event[]> {
  return (await all(db, 'SELECT * FROM events ORDER BY date, id')).map(eventFromRow);
}

/** Phases overlapping [from, to]. */
export async function listPhases(db: D1Database, q: { from: LocalDate; to: LocalDate }): Promise<Phase[]> {
  return (await all(db, 'SELECT * FROM phases WHERE start_date <= ? AND end_date >= ? ORDER BY start_date, id', q.to, q.from)).map(
    phaseFromRow,
  );
}

/** Markers overlapping [from, to] (single-day markers have no end_date). */
export async function listMarkers(db: D1Database, q: { from: LocalDate; to: LocalDate }): Promise<DayMarker[]> {
  return (
    await all(db, 'SELECT * FROM day_markers WHERE date <= ? AND coalesce(end_date, date) >= ? ORDER BY date, id', q.to, q.from)
  ).map(markerFromRow);
}

export async function listDayNotes(db: D1Database, q: { from: LocalDate; to: LocalDate }): Promise<DayNote[]> {
  return (await all(db, 'SELECT * FROM day_notes WHERE date >= ? AND date <= ? ORDER BY date', q.from, q.to)).map(dayNoteFromRow);
}

export async function listWeekNotes(db: D1Database, q: { from: IsoWeek; to: IsoWeek }): Promise<WeekNote[]> {
  return (await all(db, 'SELECT * FROM week_notes WHERE iso_week >= ? AND iso_week <= ? ORDER BY iso_week', q.from, q.to)).map(
    weekNoteFromRow,
  );
}

export async function listWellness(db: D1Database, q: { from: LocalDate; to: LocalDate }): Promise<WellnessDay[]> {
  return (await all(db, 'SELECT * FROM wellness_days WHERE date >= ? AND date <= ? ORDER BY date', q.from, q.to)).map(wellnessFromRow);
}

// ───────────────────────────── single rows ─────────────────────────────

export async function getEvent(db: D1Database, id: string): Promise<Event | null> {
  const r = await first(db, 'SELECT * FROM events WHERE id = ?', id);
  return r ? eventFromRow(r) : null;
}
export async function getPhase(db: D1Database, id: string): Promise<Phase | null> {
  const r = await first(db, 'SELECT * FROM phases WHERE id = ?', id);
  return r ? phaseFromRow(r) : null;
}
export async function getMarker(db: D1Database, id: string): Promise<DayMarker | null> {
  const r = await first(db, 'SELECT * FROM day_markers WHERE id = ?', id);
  return r ? markerFromRow(r) : null;
}
export async function getDayNote(db: D1Database, date: LocalDate): Promise<DayNote | null> {
  const r = await first(db, 'SELECT * FROM day_notes WHERE date = ?', date);
  return r ? dayNoteFromRow(r) : null;
}
export async function getWeekNote(db: D1Database, isoWeek: IsoWeek): Promise<WeekNote | null> {
  const r = await first(db, 'SELECT * FROM week_notes WHERE iso_week = ?', isoWeek);
  return r ? weekNoteFromRow(r) : null;
}
export async function getWellness(db: D1Database, date: LocalDate): Promise<WellnessDay | null> {
  const r = await first(db, 'SELECT * FROM wellness_days WHERE date = ?', date);
  return r ? wellnessFromRow(r) : null;
}

export async function deleteById(db: D1Database, table: 'events' | 'phases' | 'day_markers', id: string): Promise<void> {
  await run(db, `DELETE FROM ${table} WHERE id = ?`, id);
}

// ───────────────────────────── writes ─────────────────────────────

async function insertRows(db: D1Database, table: string, cols: readonly string[], rows: unknown[][]): Promise<void> {
  const perStmt = Math.max(1, Math.floor(100 / cols.length));
  const stmts = chunk(rows, perStmt).map((part) =>
    db
      .prepare(
        `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES ${part.map(() => `(${placeholders(cols.length)})`).join(', ')}`,
      )
      .bind(...part.flat().map(bindValue)),
  );
  for (const b of chunk(stmts, 50)) if (b.length) await db.batch(b);
}

export async function insertEvents(db: D1Database, events: Event[]): Promise<void> {
  await insertRows(
    db,
    'events',
    ['id', 'date', 'name', 'priority', 'sport', 'distance_m', 'goal', 'location', 'note', 'result_activity_id'],
    events.map((e) => [e.id, e.date, e.name, e.priority, e.sport, e.distanceM, e.goal, e.location, e.note, e.resultActivityId]),
  );
}

export async function insertPhases(db: D1Database, phases: Phase[]): Promise<void> {
  await insertRows(
    db,
    'phases',
    ['id', 'type', 'label', 'start_date', 'end_date', 'weekly_load_target'],
    phases.map((p) => [p.id, p.type, p.label, p.startDate, p.endDate, p.weeklyLoadTarget]),
  );
}

export async function insertMarkers(db: D1Database, markers: DayMarker[]): Promise<void> {
  await insertRows(
    db,
    'day_markers',
    ['id', 'type', 'date', 'end_date', 'label'],
    markers.map((m) => [m.id, m.type, m.date, m.endDate, m.label]),
  );
}

export async function putDayNote(db: D1Database, date: LocalDate, body: string): Promise<void> {
  await run(
    db,
    `INSERT INTO day_notes (date, body, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
    date,
    body,
    nowIso(),
  );
}

export async function deleteDayNote(db: D1Database, date: LocalDate): Promise<void> {
  await run(db, 'DELETE FROM day_notes WHERE date = ?', date);
}

export async function putWeekNote(db: D1Database, w: Omit<WeekNote, 'updatedAt'>): Promise<void> {
  await run(
    db,
    `INSERT INTO week_notes (iso_week, body, target_hours, target_load, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(iso_week) DO UPDATE SET body = excluded.body, target_hours = excluded.target_hours,
       target_load = excluded.target_load, updated_at = excluded.updated_at`,
    w.isoWeek,
    w.body ?? '',
    w.targetHours ?? null,
    w.targetLoad ?? null,
    nowIso(),
  );
}

/**
 * Device wellness values (Garmin). Only device columns are written; a missing value keeps what
 * is stored. The manual check-in columns (feel, soreness, note) are never touched.
 */
export async function upsertWellnessDevice(db: D1Database, days: WellnessDay[]): Promise<void> {
  if (!days.length) return;
  const now = nowIso();
  const cols = ['date', ...DEVICE_COLS, 'updated_at'];
  const sql = `INSERT INTO wellness_days (${cols.join(', ')}) VALUES (${placeholders(cols.length)})
    ON CONFLICT(date) DO UPDATE SET ${DEVICE_COLS.map((c) => `${c} = coalesce(excluded.${c}, ${c})`).join(', ')},
    updated_at = excluded.updated_at`;
  const stmts = days.map((d) =>
    db.prepare(sql).bind(d.date, ...DEVICE_COLS.map((c) => bindValue(d[WELLNESS_MAP[c]])), now),
  );
  for (const b of chunk(stmts, 50)) await db.batch(b);
}

/** Manual morning check-in. `null` clears a field; `undefined` keeps it. */
export async function putWellnessManual(
  db: D1Database,
  date: LocalDate,
  patch: { feel?: number | null; soreness?: number | null; note?: string | null; weightKg?: number | null },
): Promise<void> {
  const cols = { feel: 'feel', soreness: 'soreness', note: 'note', weightKg: 'weight_kg' } as const;
  const set: string[] = [];
  const params: unknown[] = [];
  for (const [k, col] of Object.entries(cols) as [keyof typeof cols, string][]) {
    if (patch[k] === undefined) continue;
    set.push(col);
    params.push(patch[k]);
  }
  const now = nowIso();
  await run(
    db,
    `INSERT INTO wellness_days (date, ${[...set, 'updated_at'].join(', ')}) VALUES (?, ${placeholders(set.length + 1)})
     ON CONFLICT(date) DO UPDATE SET ${[...set, 'updated_at'].map((c) => `${c} = excluded.${c}`).join(', ')}`,
    date,
    ...params,
    now,
  );
}
