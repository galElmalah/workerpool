/**
 * Activity streams and original files.
 *
 * Streams are stored as ONE gzip-compressed columnar JSON blob per activity (domain
 * `ActivityStreams`), holding the PREPARED 1 Hz series the metrics engine works on:
 * every recorded second from start to end, with paused seconds removed (so a pause
 * shows up as a gap in `t`, which re-preparation detects again). Values are rounded
 * to keep a 3 h ride well under ~200 KB gzipped.
 */
import type { ActivityStreams } from '@cadence/core/domain';
import { STREAM_CHANNELS } from '@cadence/core/domain';
import { bodyBytes } from '../lib/bytes';

/** Decimal places per channel when storing. */
const DECIMALS: Record<(typeof STREAM_CHANNELS)[number], number> = {
  hr: 0,
  power: 0,
  speed: 2, // 0.01 m/s: 1 decimal makes run/swim pace visibly stair-stepped
  cadence: 0,
  altitude: 1,
  distance: 1,
  grade: 3,
  temp: 0,
  lat: 6,
  lng: 6,
};

/** Max size of an original FIT kept in `activity_files`. */
export const MAX_FILE_BYTES = 1_500_000;

function roundTo(v: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

/** Round every channel for storage; drops channels without any value. */
export function roundStreams(s: ActivityStreams): ActivityStreams {
  const out: ActivityStreams = { t: s.t.map((v) => Math.round(v * 10) / 10) };
  for (const ch of STREAM_CHANNELS) {
    const src = s[ch];
    if (!src) continue;
    const dp = DECIMALS[ch];
    let any = false;
    const arr = new Array<number | null>(src.length);
    for (let i = 0; i < src.length; i++) {
      const v = src[i];
      if (typeof v === 'number' && Number.isFinite(v)) {
        arr[i] = roundTo(v, dp);
        any = true;
      } else arr[i] = null;
    }
    if (any) out[ch] = arr;
  }
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const body = new Response(bodyBytes(bytes)).body!.pipeThrough(stream);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  return pipe(bytes, new CompressionStream('gzip'));
}

export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  return pipe(bytes, new DecompressionStream('gzip'));
}

/** Streams (already rounded) → gzip bytes. */
export async function encodeStreams(s: ActivityStreams): Promise<Uint8Array> {
  return gzip(new TextEncoder().encode(JSON.stringify(s)));
}

export async function decodeStreams(bytes: Uint8Array): Promise<ActivityStreams> {
  return JSON.parse(new TextDecoder().decode(await gunzip(bytes))) as ActivityStreams;
}

/** Upsert statement for a batch. */
export function putStreamsStmt(db: D1Database, activityId: string, data: Uint8Array, samples: number): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO activity_streams (activity_id, data, samples, bytes) VALUES (?, ?, ?, ?)
       ON CONFLICT(activity_id) DO UPDATE SET data = excluded.data, samples = excluded.samples, bytes = excluded.bytes`,
    )
    .bind(activityId, data, samples, data.byteLength);
}

export function deleteStreamsStmt(db: D1Database, activityId: string): D1PreparedStatement {
  return db.prepare('DELETE FROM activity_streams WHERE activity_id = ?').bind(activityId);
}

function toBytes(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (Array.isArray(v)) return new Uint8Array(v as number[]);
  return null;
}

/** The stored gzip bytes (served as-is with `content-encoding: gzip`). */
export async function getStreamsBlob(db: D1Database, activityId: string): Promise<{ data: Uint8Array; samples: number } | null> {
  const row = await db
    .prepare('SELECT data, samples FROM activity_streams WHERE activity_id = ?')
    .bind(activityId)
    .first<{ data: unknown; samples: number }>();
  const data = row ? toBytes(row.data) : null;
  return data ? { data, samples: row!.samples } : null;
}

export async function getStreams(db: D1Database, activityId: string): Promise<ActivityStreams | null> {
  const blob = await getStreamsBlob(db, activityId);
  return blob ? decodeStreams(blob.data) : null;
}

export function putFileStmt(db: D1Database, activityId: string, data: Uint8Array, kind = 'fit'): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO activity_files (activity_id, kind, data, bytes) VALUES (?, ?, ?, ?)
       ON CONFLICT(activity_id) DO UPDATE SET kind = excluded.kind, data = excluded.data, bytes = excluded.bytes`,
    )
    .bind(activityId, kind, data, data.byteLength);
}

export async function getFile(db: D1Database, activityId: string): Promise<{ kind: string; data: Uint8Array } | null> {
  const row = await db
    .prepare('SELECT kind, data FROM activity_files WHERE activity_id = ?')
    .bind(activityId)
    .first<{ kind: string; data: unknown }>();
  const data = row ? toBytes(row.data) : null;
  return data ? { kind: row!.kind, data } : null;
}
