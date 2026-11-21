/**
 * Garmin connection row (`garmin_auth`, single row id = 1) plus the few read-only lookups the sync
 * engine needs from the activities/workouts tables (owned by B/A; only read here).
 */
import { nowIso } from '../lib/ids';
import { all, chunk, first, placeholders, run } from './sql';

export type GarminAuthState = 'connected' | 'needs_mfa' | 'error';

export interface GarminAuthRow {
  credentialsEnc: string;
  displayName?: string;
  state: GarminAuthState;
  lastSyncAt?: string;
  lastError?: string;
  updatedAt: string;
}

interface Row {
  credentials_enc: string;
  display_name: string | null;
  state: string;
  last_sync_at: string | null;
  last_error: string | null;
  updated_at: string;
}

export async function getGarminAuth(db: D1Database): Promise<GarminAuthRow | null> {
  const r = await first<Row>(db, 'SELECT * FROM garmin_auth WHERE id = 1');
  if (!r) return null;
  const out: GarminAuthRow = { credentialsEnc: r.credentials_enc, state: r.state as GarminAuthState, updatedAt: r.updated_at };
  if (r.display_name) out.displayName = r.display_name;
  if (r.last_sync_at) out.lastSyncAt = r.last_sync_at;
  if (r.last_error) out.lastError = r.last_error;
  return out;
}

/** Create or replace the connection (keeps last_sync_at). */
export async function upsertGarminAuth(
  db: D1Database,
  v: { credentialsEnc: string; displayName?: string; state?: GarminAuthState; lastError?: string | null },
): Promise<void> {
  await run(
    db,
    `INSERT INTO garmin_auth (id, credentials_enc, display_name, state, last_error, updated_at) VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET credentials_enc = excluded.credentials_enc,
       display_name = coalesce(excluded.display_name, garmin_auth.display_name),
       state = excluded.state, last_error = excluded.last_error, updated_at = excluded.updated_at`,
    v.credentialsEnc,
    v.displayName ?? null,
    v.state ?? 'connected',
    v.lastError ?? null,
    nowIso(),
  );
}

/**
 * Compare-and-swap of the encrypted credentials: succeeds only while the stored ciphertext is
 * still `expected` (AES-GCM ciphertexts are unique per write, so this is an exact version check).
 */
export async function casGarminCredentials(db: D1Database, expected: string, next: string): Promise<boolean> {
  const res = await run(
    db,
    'UPDATE garmin_auth SET credentials_enc = ?, updated_at = ? WHERE id = 1 AND credentials_enc = ?',
    next,
    nowIso(),
    expected,
  );
  return (res.meta.changes ?? 0) > 0;
}

/** Unconditional credential overwrite; never creates the row (a disconnect must win). */
export async function overwriteGarminCredentials(db: D1Database, next: string): Promise<boolean> {
  const res = await run(db, 'UPDATE garmin_auth SET credentials_enc = ?, updated_at = ? WHERE id = 1', next, nowIso());
  return (res.meta.changes ?? 0) > 0;
}

export async function setGarminSyncResult(
  db: D1Database,
  v: { lastSyncAt?: string; lastError?: string | null; state?: GarminAuthState; displayName?: string },
): Promise<void> {
  const sets: string[] = ['updated_at = ?'];
  const params: unknown[] = [nowIso()];
  if (v.lastSyncAt !== undefined) {
    sets.push('last_sync_at = ?');
    params.push(v.lastSyncAt);
  }
  if (v.lastError !== undefined) {
    sets.push('last_error = ?');
    params.push(v.lastError);
  }
  if (v.state !== undefined) {
    sets.push('state = ?');
    params.push(v.state);
  }
  if (v.displayName !== undefined) {
    sets.push('display_name = ?');
    params.push(v.displayName);
  }
  await run(db, `UPDATE garmin_auth SET ${sets.join(', ')} WHERE id = 1`, ...params);
}

export async function deleteGarminAuth(db: D1Database): Promise<void> {
  await run(db, 'DELETE FROM garmin_auth WHERE id = 1');
}

// ───────────────────────────── read-only lookups ─────────────────────────────

export interface KnownGarminActivity {
  garminActivityId: string;
  startMs: number;
  editHash: string;
  deleted: boolean;
}

/** Garmin-sourced activities started at/after `sinceMs` (soft-deleted ones included, flagged). */
export async function listKnownGarminActivities(db: D1Database, sinceMs: number): Promise<KnownGarminActivity[]> {
  const rows = await all<{ garmin_activity_id: string; started_at: string; summary_hash: string | null; deleted_at: string | null }>(
    db,
    `SELECT garmin_activity_id, started_at, summary_hash, deleted_at FROM activities
     WHERE garmin_activity_id IS NOT NULL AND started_at >= ?`,
    new Date(sinceMs).toISOString(),
  );
  return rows.map((r) => ({
    garminActivityId: r.garmin_activity_id,
    startMs: Date.parse(r.started_at),
    editHash: r.summary_hash ?? '',
    deleted: r.deleted_at !== null,
  }));
}

/** garminActivityId → stored summary hash (deleted ones included) for the given ids. */
export async function knownGarminHashes(db: D1Database, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const part of chunk([...new Set(ids)], 90)) {
    if (!part.length) continue;
    const rows = await all<{ garmin_activity_id: string; summary_hash: string | null }>(
      db,
      `SELECT garmin_activity_id, summary_hash FROM activities WHERE garmin_activity_id IN (${placeholders(part.length)})`,
      ...part,
    );
    for (const r of rows) out.set(r.garmin_activity_id, r.summary_hash ?? '');
  }
  return out;
}

export interface GarminCounts {
  activities: number;
  garminActivities: number;
  oldestGarminDate?: string;
  workoutsSynced: number;
  workoutsPending: number;
  workoutsError: number;
}

export async function garminCounts(db: D1Database): Promise<GarminCounts> {
  const [a, w] = await db.batch<Record<string, unknown>>([
    db.prepare(
      `SELECT count(*) AS total, count(garmin_activity_id) AS garmin, min(CASE WHEN garmin_activity_id IS NOT NULL THEN local_date END) AS oldest
       FROM activities WHERE deleted_at IS NULL`,
    ),
    db.prepare(
      `SELECT sum(garmin_sync_state = 'synced') AS synced, sum(garmin_sync_state = 'pending') AS pending, sum(garmin_sync_state = 'error') AS error
       FROM workouts`,
    ),
  ]);
  const ar = a!.results[0] ?? {};
  const wr = w!.results[0] ?? {};
  const out: GarminCounts = {
    activities: Number(ar.total ?? 0),
    garminActivities: Number(ar.garmin ?? 0),
    workoutsSynced: Number(wr.synced ?? 0),
    workoutsPending: Number(wr.pending ?? 0),
    workoutsError: Number(wr.error ?? 0),
  };
  if (typeof ar.oldest === 'string') out.oldestGarminDate = ar.oldest;
  return out;
}
