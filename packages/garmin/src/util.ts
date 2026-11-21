/** Small runtime-agnostic helpers (Web APIs only). */

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type JsonObject = Record<string, unknown>;

export function isObject(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function asObject(v: unknown): JsonObject {
  return isObject(v) ? v : {};
}

export function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** First finite number among the given keys of `o`. */
export function num(o: unknown, ...keys: string[]): number | undefined {
  if (!isObject(o)) return undefined;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  }
  return undefined;
}

export function str(o: unknown, ...keys: string[]): string | undefined {
  if (!isObject(o)) return undefined;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v !== '') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

export function bool(o: unknown, key: string): boolean | undefined {
  if (!isObject(o)) return undefined;
  const v = o[key];
  return typeof v === 'boolean' ? v : undefined;
}

export function round(v: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/** Drop keys whose value is undefined (keeps objects clean for zod/toEqual). */
export function compact<T extends object>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as T;
}

/**
 * Parse a Garmin zone-less timestamp as UTC.
 * Accepts "2026-01-08 14:10:21", "2026-01-08T14:10:21.0", "2026-01-08T14:10:21",
 * ISO with Z/offset, or epoch ms numbers.
 */
export function parseGarminTimestamp(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string' || v.length < 10) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(v.trim());
  if (!m) {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : undefined;
  }
  const [, y, mo, d, h = '0', mi = '0', s = '0', frac, zone] = m;
  const ms = frac ? Math.round(Number(`0.${frac}`) * 1000) : 0;
  let t = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), ms);
  if (zone && zone !== 'Z') {
    const sign = zone.startsWith('-') ? -1 : 1;
    const digits = zone.slice(1).replace(':', '');
    t -= sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4))) * 60_000;
  }
  return t;
}

/** ISO-8601 UTC without milliseconds when they are zero: '2026-01-08T14:10:21Z'. */
export function toIsoInstant(ms: number): string {
  const iso = new Date(ms).toISOString();
  return iso.endsWith('.000Z') ? `${iso.slice(0, 19)}Z` : iso;
}

/** Garmin list format "YYYY-MM-DD HH:mm:ss" for a wall-clock ms value. */
export function formatGarminListTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

/** Garmin detail format "YYYY-MM-DDTHH:mm:ss.0". */
export function formatGarminDetailTime(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 19)}.0`;
}

/** FNV-1a 32-bit hash, hex. Deterministic, tiny, not cryptographic. */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** JSON.stringify with sorted keys (stable fingerprints). */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (isObject(v)) {
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

export function base64UrlDecodeToString(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function base64UrlEncodeString(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** YYYY-MM-DD of an epoch ms value (UTC calendar). */
export function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
