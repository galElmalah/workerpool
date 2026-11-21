/**
 * Thin helpers over D1. No ORM: repositories write SQL and map rows ↔ domain objects.
 * Remember: max 100 bound parameters per statement, no interactive transactions (use batch).
 */

export async function all<T = Record<string, unknown>>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  const { results } = await db.prepare(sql).bind(...params).all<T>();
  return results;
}

export async function first<T = Record<string, unknown>>(db: D1Database, sql: string, ...params: unknown[]): Promise<T | null> {
  return db.prepare(sql).bind(...params).first<T>();
}

export async function run(db: D1Database, sql: string, ...params: unknown[]): Promise<D1Result> {
  return db.prepare(sql).bind(...params).run();
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** `?, ?, ?` for IN (...) lists. Keep lists ≤ 90 items per statement. */
export const placeholders = (n: number): string => Array.from({ length: n }, () => '?').join(', ');

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value === '') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** undefined → null for binding; objects/arrays → JSON text; booleans → 0/1. */
export function bindValue(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'object' && !(v instanceof ArrayBuffer) && !ArrayBuffer.isView(v)) return JSON.stringify(v);
  return v;
}

/** Drop null columns so optional domain fields are absent rather than null. */
export function compact<T extends Record<string, unknown>>(obj: T): T {
  for (const k of Object.keys(obj)) if (obj[k] === null || obj[k] === undefined) delete obj[k];
  return obj;
}
