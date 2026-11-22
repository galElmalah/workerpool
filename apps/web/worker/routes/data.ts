import { Hono } from 'hono';
import { z } from 'zod';
import { formatWorkoutText } from '@cadence/core/workout';
import type { AppEnv } from '../env';
import { ApiError, badRequest } from '../lib/http';
import { nowIso } from '../lib/ids';
import { all, chunk, first, placeholders } from '../db/sql';
import { listWorkouts } from '../db/workouts';
import { getToday, validate } from '../services/context';
import { MAX_IMPORT_BYTES, limitBody } from '../middleware/limits';

/** Bump when the backup layout changes; import accepts versions ≤ this. */
export const BACKUP_SCHEMA_VERSION = 1;
export const BACKUP_FORMAT = 'cadence-backup';

/**
 * Tables in a backup (rows verbatim, snake_case columns as in migrations). Excluded: `auth`
 * and `garmin_auth` (secrets), `activity_streams` / `activity_files` (blobs), `sync_state`
 * (connection cursors) and `sync_log` (noise).
 */
const BACKUP_TABLES = [
  'settings',
  'thresholds',
  'templates',
  'events',
  'phases',
  'day_markers',
  'day_notes',
  'week_notes',
  'wellness_days',
  'activities',
  'workouts',
] as const;
type BackupTable = (typeof BACKUP_TABLES)[number];

/** Tables that must be empty before an import (templates/settings are replaced instead). */
const MUST_BE_EMPTY: BackupTable[] = ['thresholds', 'events', 'phases', 'day_markers', 'day_notes', 'week_notes', 'wellness_days', 'activities', 'workouts'];

const ORDER_BY: Record<BackupTable, string> = {
  settings: 'id',
  thresholds: 'effective_from, id',
  templates: 'id',
  events: 'date, id',
  phases: 'start_date, id',
  day_markers: 'date, id',
  day_notes: 'date',
  week_notes: 'iso_week',
  wellness_days: 'date',
  activities: 'started_at, id',
  workouts: 'date, id',
};

const Backup = z.object({
  format: z.literal(BACKUP_FORMAT),
  schemaVersion: z.number().int().min(1).max(BACKUP_SCHEMA_VERSION),
  exportedAt: z.string().optional(),
  tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
});

async function tableColumns(db: D1Database, table: BackupTable): Promise<string[]> {
  const rows = await all<{ name: string }>(db, `PRAGMA table_info(${table})`);
  return rows.map((r) => r.name);
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function hms(sec: number | undefined): string {
  if (sec === undefined) return '';
  const s = Math.round(sec);
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Mounted at /api — define full paths here (see docs/ARCHITECTURE.md → API surface). */
export const dataRoutes = new Hono<AppEnv>()
  .get('/export/json', async (c) => {
    const db = c.env.DB;
    const tables: Record<string, Record<string, unknown>[]> = {};
    for (const t of BACKUP_TABLES) tables[t] = await all(db, `SELECT * FROM ${t} ORDER BY ${ORDER_BY[t]}`);
    const today = await getToday(c.env);
    c.header('content-disposition', `attachment; filename="cadence-backup-${today}.json"`);
    return c.json({
      format: BACKUP_FORMAT,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: nowIso(),
      notes: 'Activity streams, original files, credentials and sync cursors are not included.',
      counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])) as Record<string, number>,
      tables,
    });
  })
  .post('/import/json', limitBody(MAX_IMPORT_BYTES, 'Backup'), validate('json', Backup), async (c) => {
    const backup = c.req.valid('json');
    const db = c.env.DB;
    const unknownTables = Object.keys(backup.tables).filter((t) => !(BACKUP_TABLES as readonly string[]).includes(t));
    if (unknownTables.length) throw badRequest(`Unknown tables in backup: ${unknownTables.join(', ')}`, 'validation');
    for (const t of MUST_BE_EMPTY) {
      const n = (await first<{ n: number }>(db, `SELECT COUNT(*) AS n FROM ${t}`))?.n ?? 0;
      if (n > 0) throw new ApiError(409, 'not_empty', `Import needs an empty database (${t} has ${n} rows)`);
    }
    const imported: Record<string, number> = {};
    for (const t of BACKUP_TABLES) {
      const rows = backup.tables[t];
      if (!rows?.length) continue;
      const cols = await tableColumns(db, t);
      const colSet = new Set(cols);
      const stray = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => !colSet.has(k));
      if (stray.length) throw badRequest(`Unknown columns for ${t}: ${stray.slice(0, 5).join(', ')}`, 'validation');
      const used = cols.filter((col) => rows.some((r) => col in r));
      const perStmt = Math.max(1, Math.floor(100 / used.length));
      const stmts: D1PreparedStatement[] = [];
      if (t === 'templates' || t === 'settings') stmts.push(db.prepare(`DELETE FROM ${t}`));
      for (const part of chunk(rows, perStmt)) {
        const values = part.flatMap((r) =>
          used.map((col) => {
            if (t === 'activities' && col === 'has_streams') return 0; // streams are not part of a backup
            const v = r[col];
            if (v === undefined || v === null) return null;
            return typeof v === 'object' ? JSON.stringify(v) : typeof v === 'boolean' ? (v ? 1 : 0) : v;
          }),
        );
        stmts.push(
          db
            .prepare(`INSERT INTO ${t} (${used.join(', ')}) VALUES ${part.map(() => `(${placeholders(used.length)})`).join(', ')}`)
            .bind(...values),
        );
      }
      try {
        for (const b of chunk(stmts, 50)) await db.batch(b);
      } catch (e) {
        throw badRequest(`Could not import ${t}: ${e instanceof Error ? e.message : String(e)}`, 'import_failed');
      }
      imported[t] = rows.length;
    }
    return c.json({ imported });
  })
  .get('/export/workouts.csv', async (c) => {
    const workouts = await listWorkouts(c.env.DB, {});
    const header = [
      'date',
      'start_time',
      'sport',
      'sub_sport',
      'title',
      'intensity',
      'key',
      'planned_duration',
      'planned_duration_sec',
      'planned_distance_m',
      'planned_load',
      'planned_if',
      'status',
      'skip_reason',
      'paired_activity_id',
      'tags',
      'description',
      'pre_note',
      'structure',
      'id',
    ];
    const lines = [header.join(',')];
    for (const w of workouts) {
      let text = '';
      if (w.structure?.steps.length) {
        try {
          text = formatWorkoutText(w.structure, w.sport);
        } catch {
          text = '';
        }
      }
      lines.push(
        [
          w.date,
          w.startTime,
          w.sport,
          w.subSport,
          w.title,
          w.intensity,
          w.isKey ? 'yes' : '',
          hms(w.plannedDurationSec),
          w.plannedDurationSec,
          w.plannedDistanceM,
          w.plannedLoad,
          w.plannedIntensityFactor,
          w.status,
          w.skipReason,
          w.pairedActivityId,
          w.tags.join(' '),
          w.description,
          w.preNote,
          text,
          w.id,
        ]
          .map(csvCell)
          .join(','),
      );
    }
    const today = await getToday(c.env);
    return c.body(lines.join('\r\n') + '\r\n', 200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="cadence-workouts-${today}.csv"`,
    });
  });
