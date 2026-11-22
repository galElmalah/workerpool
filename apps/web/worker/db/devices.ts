/**
 * Device tokens for native clients (docs/MOBILE_API.md §1). Rows hold only the SHA-256 hash of a
 * token; revoking a device deletes its row.
 */
import type { Device, DevicePlatform } from '@cadence/core/domain';
import { all, first, run } from './sql';

interface DeviceRow {
  id: string;
  name: string;
  platform: string;
  token_hash: string;
  created_at: string;
  last_used_at: string | null;
}

const toDevice = (r: DeviceRow): Device => ({
  id: r.id,
  name: r.name,
  platform: r.platform === 'ios' ? 'ios' : 'other',
  createdAt: r.created_at,
  lastUsedAt: r.last_used_at ?? null,
});

export async function insertDevice(
  db: D1Database,
  d: { id: string; name: string; platform: DevicePlatform; tokenHash: string; createdAt: string },
): Promise<Device> {
  await run(
    db,
    'INSERT INTO devices (id, name, platform, token_hash, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, NULL)',
    d.id,
    d.name,
    d.platform,
    d.tokenHash,
    d.createdAt,
  );
  return { id: d.id, name: d.name, platform: d.platform, createdAt: d.createdAt, lastUsedAt: null };
}

/** Newest first. */
export async function listDevices(db: D1Database): Promise<Device[]> {
  const rows = await all<DeviceRow>(db, 'SELECT * FROM devices ORDER BY created_at DESC, id DESC');
  return rows.map(toDevice);
}

export async function findDeviceByHash(db: D1Database, tokenHash: string): Promise<{ id: string; tokenHash: string; lastUsedAt: string | null } | null> {
  const r = await first<Pick<DeviceRow, 'id' | 'token_hash' | 'last_used_at'>>(
    db,
    'SELECT id, token_hash, last_used_at FROM devices WHERE token_hash = ?',
    tokenHash,
  );
  return r ? { id: r.id, tokenHash: r.token_hash, lastUsedAt: r.last_used_at ?? null } : null;
}

/** True when a row was deleted. */
export async function deleteDevice(db: D1Database, id: string): Promise<boolean> {
  const res = await run(db, 'DELETE FROM devices WHERE id = ?', id);
  return (res.meta.changes ?? 0) > 0;
}

/** Statement deleting every device (batched with the passphrase change). */
export const deleteAllDevicesStmt = (db: D1Database): D1PreparedStatement => db.prepare('DELETE FROM devices');

/** Records use, unless the stored value is already newer than `staleBeforeIso` (another isolate wrote it). */
export async function touchDevice(db: D1Database, id: string, nowIso: string, staleBeforeIso: string): Promise<void> {
  await run(db, 'UPDATE devices SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)', nowIso, id, staleBeforeIso);
}
