import { describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { json } from './helpers';

vi.setConfig({ testTimeout: 300_000 });

describe('demo seed, fast mode', () => {
  it('imports older activities from summaries only (no FIT/streams), recent ones in full', async () => {
    let p = await json('/demo/seed', { method: 'POST', body: { months: 3, seed: 9, fast: true, today: '2026-11-21', now: '2026-11-21T19:00:00Z' } });
    expect(p.fast).toBe(true);
    for (let i = 0; !p.finished && i < 40; i++) p = await json('/demo/seed/step', { method: 'POST', body: { maxActivities: 40 } });
    expect(p.finished).toBe(true);
    const counts = await env.DB.prepare(
      `SELECT count(*) AS total, sum(has_streams) AS streams, sum(CASE WHEN local_date < '2026-09-26' THEN has_streams ELSE 0 END) AS oldStreams FROM activities`,
    ).first<{ total: number; streams: number; oldStreams: number }>();
    expect(counts!.total).toBe(p.total);
    expect(counts!.oldStreams).toBe(0);
    expect(counts!.streams).toBeGreaterThan(0);
    expect(counts!.streams).toBeLessThan(counts!.total);
  });
});
