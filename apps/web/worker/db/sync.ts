/**
 * Sync bookkeeping in D1: the sync log, key/value cursors (`sync_state`), a lease-style lock and
 * small persistent work queues (one `sync_state` row per item, ordered by key).
 */
import type { SyncLogEntry } from '@cadence/core/domain';
import { newId, nowIso } from '../lib/ids';
import { all, chunk, compact, first, placeholders, run } from './sql';

// ───────────────────────────── sync log ─────────────────────────────

/** Append one entry to the sync log (`at` = now, id `log_…`). */
export async function logSync(db: D1Database, entry: Omit<SyncLogEntry, 'id' | 'at'>): Promise<void> {
  await insertSyncLog(db, entry);
}

/** Same as {@link logSync} but returns the stored entry (used to update a `running` entry later). */
export async function insertSyncLog(db: D1Database, entry: Omit<SyncLogEntry, 'id' | 'at'>, at = nowIso()): Promise<SyncLogEntry> {
  const id = newId('log');
  await run(
    db,
    'INSERT INTO sync_log (id, at, kind, status, summary, detail, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id,
    at,
    entry.kind,
    entry.status,
    entry.summary,
    entry.detail ?? null,
    entry.durationMs === undefined ? null : Math.round(entry.durationMs),
  );
  return compact({ id, at, ...entry }) as SyncLogEntry;
}

interface SyncLogRow {
  id: string;
  at: string;
  kind: SyncLogEntry['kind'];
  status: SyncLogEntry['status'];
  summary: string;
  detail: string | null;
  duration_ms: number | null;
}

const logFromRow = (r: SyncLogRow): SyncLogEntry =>
  compact({
    id: r.id,
    at: r.at,
    kind: r.kind,
    status: r.status,
    summary: r.summary,
    detail: r.detail ?? undefined,
    durationMs: r.duration_ms ?? undefined,
  }) as SyncLogEntry;

/** Newest first. `cursor` is the opaque `nextCursor` of the previous page (`<at>|<id>`). */
export async function listSyncLog(
  db: D1Database,
  q: { limit?: number; cursor?: string; kind?: SyncLogEntry['kind']; status?: SyncLogEntry['status'] } = {},
): Promise<{ entries: SyncLogEntry[]; nextCursor?: string }> {
  const limit = Math.min(200, Math.max(1, q.limit ?? 50));
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.cursor) {
    const sep = q.cursor.lastIndexOf('|');
    const at = sep > 0 ? q.cursor.slice(0, sep) : q.cursor;
    const id = sep > 0 ? q.cursor.slice(sep + 1) : '';
    where.push('(at < ? OR (at = ? AND id < ?))');
    params.push(at, at, id);
  }
  if (q.status) {
    where.push('status = ?');
    params.push(q.status);
  }
  if (q.kind) {
    where.push('kind = ?');
    params.push(q.kind);
  }
  const rows = await all<SyncLogRow>(
    db,
    `SELECT * FROM sync_log${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY at DESC, id DESC LIMIT ?`,
    ...params,
    limit + 1,
  );
  const page = rows.slice(0, limit).map(logFromRow);
  const last = page.at(-1);
  return rows.length > limit && last ? { entries: page, nextCursor: `${last.at}|${last.id}` } : { entries: page };
}

export async function updateSyncLog(db: D1Database, id: string, patch: Partial<Omit<SyncLogEntry, 'id' | 'at'>>): Promise<void> {
  const map: Record<string, string> = { kind: 'kind', status: 'status', summary: 'summary', detail: 'detail', durationMs: 'duration_ms' };
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, col] of Object.entries(map)) {
    const v = (patch as Record<string, unknown>)[k];
    if (v === undefined) continue;
    sets.push(`${col} = ?`);
    params.push(k === 'durationMs' ? Math.round(v as number) : v);
  }
  if (sets.length) await run(db, `UPDATE sync_log SET ${sets.join(', ')} WHERE id = ?`, ...params, id);
}

// ───────────────────────────── key/value state ─────────────────────────────

/** `sync_state` key of the demo clock (epoch ms; DEMO_MODE only). Set by demo seed, moved by demo/advance. */
export const DEMO_NOW_KEY = 'demo:now';

export async function getState<T>(db: D1Database, key: string): Promise<T | undefined> {
  const row = await first<{ value: string }>(db, 'SELECT value FROM sync_state WHERE key = ?', key);
  if (!row) return undefined;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return undefined;
  }
}

export async function putState(db: D1Database, key: string, value: unknown): Promise<void> {
  await run(
    db,
    `INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key,
    JSON.stringify(value ?? null),
    nowIso(),
  );
}

export async function deleteState(db: D1Database, ...keys: string[]): Promise<void> {
  for (const part of chunk(keys, 90)) {
    if (part.length) await run(db, `DELETE FROM sync_state WHERE key IN (${placeholders(part.length)})`, ...part);
  }
}

/** Delete every key starting with `prefix` (prefixes never contain LIKE wildcards here). */
export async function deleteStatePrefix(db: D1Database, prefix: string): Promise<void> {
  await run(db, 'DELETE FROM sync_state WHERE key >= ? AND key < ?', prefix, prefixEnd(prefix));
}

function prefixEnd(prefix: string): string {
  return prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);
}

// ───────────────────────────── lock ─────────────────────────────

export interface Lease {
  name: string;
  owner: string;
  until: number;
}

/**
 * Lease lock in `sync_state` (`lock:<name>`): acquired when absent or expired. Atomic: a single
 * INSERT … ON CONFLICT DO UPDATE … WHERE until < now, so two isolates cannot both win.
 */
export async function acquireLock(db: D1Database, name: string, ttlMs: number, now = Date.now()): Promise<Lease | null> {
  const owner = crypto.randomUUID();
  const lease: Lease = { name, owner, until: now + ttlMs };
  const res = await run(
    db,
    `INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
     WHERE coalesce(json_extract(sync_state.value, '$.until'), 0) < ?`,
    `lock:${name}`,
    JSON.stringify({ owner, until: lease.until }),
    nowIso(),
    now,
  );
  return (res.meta.changes ?? 0) > 0 ? lease : null;
}

export async function extendLock(db: D1Database, lease: Lease, ttlMs: number, now = Date.now()): Promise<boolean> {
  lease.until = now + ttlMs;
  const res = await run(
    db,
    `UPDATE sync_state SET value = ?, updated_at = ? WHERE key = ? AND json_extract(value, '$.owner') = ?`,
    JSON.stringify({ owner: lease.owner, until: lease.until }),
    nowIso(),
    `lock:${lease.name}`,
    lease.owner,
  );
  return (res.meta.changes ?? 0) > 0;
}

export async function releaseLock(db: D1Database, lease: Lease): Promise<void> {
  await run(db, `DELETE FROM sync_state WHERE key = ? AND json_extract(value, '$.owner') = ?`, `lock:${lease.name}`, lease.owner);
}

export async function lockHeld(db: D1Database, name: string, now = Date.now()): Promise<boolean> {
  const v = await getState<{ until?: number }>(db, `lock:${name}`);
  return !!v && (v.until ?? 0) >= now;
}

// ───────────────────────────── queues ─────────────────────────────

/**
 * A persistent queue is a set of `sync_state` rows `q:<name>:<sortKey>`; `take` reads the
 * highest sort keys first (callers use a zero-padded start time so newest is processed first).
 */
export async function enqueue<T>(db: D1Database, name: string, items: { sortKey: string; value: T }[]): Promise<void> {
  const now = nowIso();
  const stmts = items.map((it) =>
    db
      .prepare(
        `INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .bind(`q:${name}:${it.sortKey}`, JSON.stringify(it.value), now),
  );
  for (const part of chunk(stmts, 50)) if (part.length) await db.batch(part);
}

export async function takeQueue<T>(db: D1Database, name: string, limit: number): Promise<{ key: string; value: T }[]> {
  const prefix = `q:${name}:`;
  const rows = await all<{ key: string; value: string }>(
    db,
    'SELECT key, value FROM sync_state WHERE key >= ? AND key < ? ORDER BY key DESC LIMIT ?',
    prefix,
    prefixEnd(prefix),
    limit,
  );
  return rows.map((r) => ({ key: r.key, value: JSON.parse(r.value) as T }));
}

export async function queueSize(db: D1Database, name: string): Promise<number> {
  const prefix = `q:${name}:`;
  const row = await first<{ n: number }>(db, 'SELECT count(*) AS n FROM sync_state WHERE key >= ? AND key < ?', prefix, prefixEnd(prefix));
  return row?.n ?? 0;
}

export async function clearQueue(db: D1Database, name: string): Promise<void> {
  await deleteStatePrefix(db, `q:${name}:`);
}

/** Mark `running` entries of `kind` as interrupted (call while holding the lock for that work). */
export async function failStaleRunning(db: D1Database, kind: SyncLogEntry['kind']): Promise<number> {
  const res = await run(
    db,
    `UPDATE sync_log SET status = 'error', summary = summary || ' (interrupted)' WHERE kind = ? AND status = 'running'`,
    kind,
  );
  return res.meta.changes ?? 0;
}
