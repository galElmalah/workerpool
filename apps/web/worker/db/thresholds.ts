import type { LocalDate, Sport, Threshold, ThresholdKind, ThresholdSnapshot } from '@cadence/core/domain';
import { resolveThresholds } from '@cadence/core/metrics';
import { newId } from '../lib/ids';
import { all, compact, first, run } from './sql';

interface ThresholdRow {
  id: string;
  kind: string;
  sport: string;
  value: number;
  effective_from: string;
  source: string;
  note: string | null;
}

function fromRow(r: ThresholdRow): Threshold {
  return compact({
    id: r.id,
    kind: r.kind as ThresholdKind,
    sport: r.sport as Threshold['sport'],
    value: r.value,
    effectiveFrom: r.effective_from,
    source: r.source as Threshold['source'],
    note: r.note ?? undefined,
  }) as Threshold;
}

/** All thresholds, newest effective date first. */
export async function listThresholds(db: D1Database): Promise<Threshold[]> {
  const rows = await all<ThresholdRow>(db, 'SELECT * FROM thresholds ORDER BY effective_from DESC, id DESC');
  return rows.map(fromRow);
}

export async function getThreshold(db: D1Database, id: string): Promise<Threshold | null> {
  const r = await first<ThresholdRow>(db, 'SELECT * FROM thresholds WHERE id = ?', id);
  return r ? fromRow(r) : null;
}

/**
 * Insert a threshold. An existing entry with the same kind, sport and effective date is
 * replaced (one value per day per kind/sport).
 */
export async function insertThreshold(db: D1Database, t: Omit<Threshold, 'id'>): Promise<Threshold> {
  const row: Threshold = { ...t, id: newId('thr') };
  await db.batch([
    db.prepare('DELETE FROM thresholds WHERE kind = ? AND sport = ? AND effective_from = ?').bind(t.kind, t.sport, t.effectiveFrom),
    db
      .prepare('INSERT INTO thresholds (id, kind, sport, value, effective_from, source, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(row.id, row.kind, row.sport, row.value, row.effectiveFrom, row.source, row.note ?? null),
  ]);
  return row;
}

export async function deleteThreshold(db: D1Database, id: string): Promise<Threshold | null> {
  const existing = await getThreshold(db, id);
  if (!existing) return null;
  await run(db, 'DELETE FROM thresholds WHERE id = ?', id);
  return existing;
}

/** Thresholds valid for `sport` on `date` (no cold-start defaults; estimators fill gaps). */
export async function thresholdsOn(db: D1Database, date: LocalDate, sport: Sport): Promise<ThresholdSnapshot> {
  return resolveThresholds(await listThresholds(db), date, sport);
}

/** One read, many lookups: for bulk operations that resolve thresholds for many dates. */
export async function thresholdResolver(db: D1Database): Promise<(date: LocalDate, sport: Sport) => ThresholdSnapshot> {
  const list = await listThresholds(db);
  const cache = new Map<string, ThresholdSnapshot>();
  return (date, sport) => {
    const k = `${date}|${sport}`;
    let s = cache.get(k);
    if (!s) {
      s = resolveThresholds(list, date, sport);
      cache.set(k, s);
    }
    return s;
  };
}
