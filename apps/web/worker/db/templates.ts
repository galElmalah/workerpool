import type { IntensityClass, Sport, Template, WorkoutStructure } from '@cadence/core/domain';
import { all, bindValue, chunk, compact, first, parseJson, placeholders, run } from './sql';

interface TemplateRow {
  id: string;
  sport: string;
  sub_sport: string | null;
  title: string;
  description: string | null;
  planned_duration_sec: number | null;
  planned_distance_m: number | null;
  planned_load: number | null;
  planned_if: number | null;
  structure: string | null;
  sparkline: string | null;
  intensity: string;
  tags: string;
  folder: string | null;
  usage_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export function templateFromRow(r: TemplateRow): Template {
  const structure = r.structure ? parseJson<WorkoutStructure | null>(r.structure, null) : null;
  return compact({
    id: r.id,
    sport: r.sport,
    subSport: r.sub_sport ?? undefined,
    title: r.title,
    description: r.description ?? undefined,
    plannedDurationSec: r.planned_duration_sec ?? undefined,
    plannedDistanceM: r.planned_distance_m ?? undefined,
    plannedLoad: r.planned_load ?? undefined,
    plannedIntensityFactor: r.planned_if ?? undefined,
    structure: structure ?? undefined,
    intensity: r.intensity,
    tags: parseJson<string[]>(r.tags, []),
    folder: r.folder ?? undefined,
    usageCount: r.usage_count ?? 0,
    lastUsedAt: r.last_used_at ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  } as Record<string, unknown>) as unknown as Template;
}

const COLS = [
  'id',
  'sport',
  'sub_sport',
  'title',
  'description',
  'planned_duration_sec',
  'planned_distance_m',
  'planned_load',
  'planned_if',
  'structure',
  'sparkline',
  'intensity',
  'tags',
  'folder',
  'usage_count',
  'last_used_at',
  'created_at',
  'updated_at',
] as const;

function values(t: Template & { sparkline?: number[] }): unknown[] {
  const v: Record<(typeof COLS)[number], unknown> = {
    id: t.id,
    sport: t.sport,
    sub_sport: t.subSport,
    title: t.title,
    description: t.description,
    planned_duration_sec: t.plannedDurationSec,
    planned_distance_m: t.plannedDistanceM,
    planned_load: t.plannedLoad,
    planned_if: t.plannedIntensityFactor,
    structure: t.structure,
    sparkline: t.sparkline,
    intensity: t.intensity,
    tags: t.tags ?? [],
    folder: t.folder,
    usage_count: t.usageCount ?? 0,
    last_used_at: t.lastUsedAt,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  };
  return COLS.map((c) => bindValue(v[c]));
}

const statement = (db: D1Database, t: Template & { sparkline?: number[] }, verb: 'INSERT OR REPLACE' | 'INSERT OR IGNORE') =>
  db.prepare(`${verb} INTO templates (${COLS.join(', ')}) VALUES (${placeholders(COLS.length)})`).bind(...values(t));

/** Insert or replace verbatim (ids included). */
export async function insertTemplates(db: D1Database, templates: Template[]): Promise<void> {
  for (const part of chunk(templates, 50)) if (part.length) await db.batch(part.map((t) => statement(db, t, 'INSERT OR REPLACE')));
}

/** Insert, keeping any existing row with the same id. Returns how many rows were inserted. */
export async function insertTemplatesIfMissing(db: D1Database, templates: (Template & { sparkline?: number[] })[]): Promise<number> {
  let n = 0;
  for (const part of chunk(templates, 50)) {
    if (!part.length) continue;
    const res = await db.batch(part.map((t) => statement(db, t, 'INSERT OR IGNORE')));
    for (const r of res) n += r.meta.changes ?? 0;
  }
  return n;
}

export async function listTemplates(
  db: D1Database,
  q: { sport?: Sport; intensity?: IntensityClass; q?: string; folder?: string; ids?: string[] } = {},
): Promise<Template[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.sport) {
    where.push('sport = ?');
    params.push(q.sport);
  }
  if (q.intensity) {
    where.push('intensity = ?');
    params.push(q.intensity);
  }
  if (q.folder) {
    where.push('folder = ?');
    params.push(q.folder);
  }
  if (q.ids) {
    const ids = q.ids.slice(0, 90);
    if (!ids.length) return [];
    where.push(`id IN (${placeholders(ids.length)})`);
    params.push(...ids);
  }
  for (const word of (q.q ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6)) {
    where.push(`(lower(title) LIKE ? OR lower(coalesce(description, '')) LIKE ? OR lower(tags) LIKE ? OR lower(coalesce(folder, '')) LIKE ?)`);
    const like = `%${word}%`;
    params.push(like, like, like, like);
  }
  const sql = `SELECT * FROM templates${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY sport, coalesce(folder, ''), title, id`;
  return (await all<TemplateRow>(db, sql, ...params)).map(templateFromRow);
}

export async function getTemplate(db: D1Database, id: string): Promise<Template | null> {
  const r = await first<TemplateRow>(db, 'SELECT * FROM templates WHERE id = ?', id);
  return r ? templateFromRow(r) : null;
}

export async function deleteTemplate(db: D1Database, id: string): Promise<void> {
  await run(db, 'DELETE FROM templates WHERE id = ?', id);
}

export async function countTemplates(db: D1Database): Promise<number> {
  return (await first<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM templates'))?.n ?? 0;
}

export async function bumpTemplateUsage(db: D1Database, id: string, by: number, at: string): Promise<void> {
  await run(db, 'UPDATE templates SET usage_count = usage_count + ?, last_used_at = ? WHERE id = ?', by, at, id);
}
