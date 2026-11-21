import { describe, expect, it } from 'vitest';
import { exports } from 'cloudflare:workers';

describe('api', () => {
  it('responds to health checks', async () => {
    const res = await exports.default.fetch('https://cadence.test/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});
