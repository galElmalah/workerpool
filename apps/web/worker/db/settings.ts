import { DEFAULT_SETTINGS, Settings } from '@cadence/core/domain';
import { nowIso } from '../lib/ids';
import { first, run } from './sql';

/** Stored settings merged over DEFAULT_SETTINGS (unknown / invalid keys dropped). */
export async function getSettings(db: D1Database): Promise<Settings> {
  const row = await first<{ data: string }>(db, 'SELECT data FROM settings WHERE id = 1');
  if (!row) return { ...DEFAULT_SETTINGS };
  let stored: Record<string, unknown> = {};
  try {
    stored = JSON.parse(row.data) as Record<string, unknown>;
  } catch {
    stored = {};
  }
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  const shape = Settings.shape as Record<string, { safeParse: (v: unknown) => { success: boolean } }>;
  for (const [k, v] of Object.entries(stored)) {
    if (k in shape && shape[k].safeParse(v).success) out[k] = v;
  }
  return out as Settings;
}

export async function updateSettings(db: D1Database, patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings(db);
  const next: Settings = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) (next as Record<string, unknown>)[k] = v;
  }
  const parsed = Settings.parse(next);
  const now = nowIso();
  await run(
    db,
    `INSERT INTO settings (id, data, updated_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    JSON.stringify(parsed),
    now,
  );
  return parsed;
}
