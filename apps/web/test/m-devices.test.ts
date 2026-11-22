/** Device tokens (docs/MOBILE_API.md §1): bearer auth for native clients. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { Device } from '@cadence/core/domain';
import { anon, TEST_PASSPHRASE } from './helpers';

vi.setConfig({ testTimeout: 60_000 });

const NEXT_PASSPHRASE = 'a completely new passphrase';
const TOKEN_RE = /^cad_[A-Za-z0-9_-]{43}$/;

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  anon(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const get = (path: string, headers: Record<string, string> = {}) => anon(path, { headers });
const del = (path: string, headers: Record<string, string> = {}) => anon(path, { method: 'DELETE', headers });
const cookieOf = (res: Response) => res.headers.get('set-cookie')?.split(';')[0] ?? '';

async function createDevice(name = 'Test iPhone', passphrase = TEST_PASSPHRASE): Promise<{ token: string; device: Device }> {
  const res = await post('/auth/devices', { passphrase, name, platform: 'ios' });
  expect(res.status).toBe(201);
  return res.json();
}

const resetThrottle = () => env.DB.prepare(`DELETE FROM sync_state WHERE key = 'auth.throttle'`).run();

afterEach(() => {
  vi.useRealTimers();
});

describe('device tokens', () => {
  let cookie = '';

  it('cannot create a device before a passphrase is set', async () => {
    const res = await post('/auth/devices', { passphrase: TEST_PASSPHRASE, name: 'Phone', platform: 'ios' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'not_configured' } });
  });

  it('creates a token once and stores only its SHA-256 hash', async () => {
    cookie = cookieOf(await post('/auth/setup', { passphrase: TEST_PASSPHRASE }));
    expect(cookie).toMatch(/^cadence_session=/);

    const res = await post('/auth/devices', { passphrase: TEST_PASSPHRASE, name: "  Gal's iPhone  ", platform: 'ios' });
    expect(res.status).toBe(201);
    expect(res.headers.get('set-cookie')).toBeNull(); // a device token never comes with a cookie
    const body = await res.json<{ token: string; device: Device }>();
    expect(body.token).toMatch(TOKEN_RE);
    const device = Device.parse(body.device);
    expect(device).toMatchObject({ name: "Gal's iPhone", platform: 'ios', lastUsedAt: null });
    expect(device.id).toMatch(/^dev_/);

    const row = await env.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(device.id).first<Record<string, string>>();
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.token)));
    const expected = btoa(String.fromCharCode(...digest)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    expect(row!.token_hash).toBe(expected);
    expect(JSON.stringify(row)).not.toContain(body.token.slice(4));
  });

  it('validates the request', async () => {
    expect((await post('/auth/devices', { passphrase: TEST_PASSPHRASE, name: '', platform: 'ios' })).status).toBe(400);
    expect((await post('/auth/devices', { passphrase: TEST_PASSPHRASE, name: 'x'.repeat(65), platform: 'ios' })).status).toBe(400);
    expect((await post('/auth/devices', { passphrase: TEST_PASSPHRASE, name: 'Pixel', platform: 'android' })).status).toBe(400);
    const wrong = await post('/auth/devices', { passphrase: 'not the passphrase', name: 'Phone', platform: 'ios' });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toMatchObject({ error: { code: 'invalid_passphrase' } });
    await resetThrottle();
  });

  it('a bearer token works on protected routes (reads and writes) and in auth/status', async () => {
    const { token } = await createDevice();
    expect((await get('/settings', bearer(token))).status).toBe(200);
    expect((await get('/calendar?from=2026-11-16&to=2026-11-22', bearer(token))).status).toBe(200);
    const patch = await anon('/settings', {
      method: 'PATCH',
      headers: { ...bearer(token), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Gal' }),
    });
    expect(patch.status).toBe(200);
    expect(await (await get('/auth/status', bearer(token))).json()).toEqual({ configured: true, authenticated: true, demo: true });
    expect(await (await get('/auth/status', bearer('cad_' + 'A'.repeat(43)))).json()).toMatchObject({ authenticated: false });
    // scheme is case-insensitive
    expect((await get('/settings', { authorization: `bearer ${token}` })).status).toBe(200);
  });

  it('missing, malformed, unknown → 401 unauthorized; a bad bearer is not rescued by a cookie', async () => {
    for (const h of [{}, bearer('nope'), bearer(''), bearer('cad_' + 'A'.repeat(43)), { authorization: 'Bearer' }]) {
      const res = await get('/settings', h);
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: 'unauthorized' } });
    }
    expect((await get('/settings', { cookie })).status).toBe(200);
    expect((await get('/settings', { cookie, ...bearer('cad_' + 'B'.repeat(43)) })).status).toBe(401);
    // a non-Bearer Authorization header (e.g. basic auth from a proxy) leaves cookie auth alone
    expect((await get('/settings', { cookie, authorization: 'Basic dXNlcjpwYXNz' })).status).toBe(200);
  });

  it('lists devices newest first (cookie or bearer); listing requires auth', async () => {
    const a = await createDevice('Older');
    const b = await createDevice('Newer');
    expect((await get('/auth/devices')).status).toBe(401);
    for (const h of [{ cookie }, bearer(a.token)]) {
      const res = await get('/auth/devices', h);
      expect(res.status).toBe(200);
      const { devices } = await res.json<{ devices: Device[] }>();
      for (const d of devices) Device.parse(d);
      expect(devices.map((d) => d.id).indexOf(b.device.id)).toBeLessThan(devices.map((d) => d.id).indexOf(a.device.id));
      expect(JSON.stringify(devices)).not.toMatch(/cad_|token/);
    }
  });

  it('DELETE /auth/devices/:id revokes at once (same isolate); unknown id → 404', async () => {
    const { token, device } = await createDevice('To revoke');
    expect((await get('/settings', bearer(token))).status).toBe(200); // now cached
    expect((await del(`/auth/devices/${device.id}`)).status).toBe(401);
    const res = await del(`/auth/devices/${device.id}`, { cookie });
    expect(res.status).toBe(204);
    expect((await get('/settings', bearer(token))).status).toBe(401);
    expect((await del(`/auth/devices/${device.id}`, { cookie })).status).toBe(404);
  });

  it('DELETE /auth/devices/current revokes the calling token; 400 with a cookie', async () => {
    const other = await createDevice('Other');
    const { token, device } = await createDevice('Signing out');
    const viaCookie = await del('/auth/devices/current', { cookie });
    expect(viaCookie.status).toBe(400);
    expect((await del('/auth/devices/current')).status).toBe(401);
    expect((await del('/auth/devices/current', bearer(token))).status).toBe(204);
    expect((await get('/settings', bearer(token))).status).toBe(401);
    expect((await get('/settings', bearer(other.token))).status).toBe(200);
    const { devices } = await (await get('/auth/devices', { cookie })).json<{ devices: Device[] }>();
    expect(devices.some((d) => d.id === device.id)).toBe(false);
  });

  it('revocation elsewhere (another isolate) takes effect within 30 s', async () => {
    const { token, device } = await createDevice('Cached');
    expect((await get('/settings', bearer(token))).status).toBe(200);
    await env.DB.prepare('DELETE FROM devices WHERE id = ?').bind(device.id).run(); // not via this isolate's API
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 31_000 });
    expect((await get('/settings', bearer(token))).status).toBe(401);
  });

  it('writes last_used_at on first use, then at most once per hour', async () => {
    const { token, device } = await createDevice('Usage');
    const lastUsed = async () =>
      (await env.DB.prepare('SELECT last_used_at AS t FROM devices WHERE id = ?').bind(device.id).first<{ t: string | null }>())!.t;
    expect(await lastUsed()).toBeNull();
    await get('/settings', bearer(token));
    const first = await lastUsed();
    expect(first).not.toBeNull();
    // later requests within the hour (also after the cache TTL) do not write
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 10 * 60_000 });
    await get('/settings', bearer(token));
    await get('/today', bearer(token));
    expect(await lastUsed()).toBe(first);
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse(first!) + 61 * 60_000 });
    await get('/settings', bearer(token));
    const second = await lastUsed();
    expect(Date.parse(second!)).toBeGreaterThan(Date.parse(first!) + 3600_000);
    vi.useRealTimers();
    const { devices } = await (await get('/auth/devices', { cookie })).json<{ devices: Device[] }>();
    expect(devices.find((d) => d.id === device.id)!.lastUsedAt).toBe(second);
  });

  it('device creation shares the login throttle and lockout (both ways)', async () => {
    await resetThrottle();
    for (let i = 0; i < 5; i++) {
      const res = await post('/auth/devices', { passphrase: `wrong ${i}`, name: 'Brute', platform: 'other' });
      expect(res.status).toBe(401);
    }
    const login = await post('/auth/login', { passphrase: TEST_PASSPHRASE });
    expect(login.status).toBe(429);
    expect(Number(login.headers.get('retry-after'))).toBeGreaterThan(0);
    const create = await post('/auth/devices', { passphrase: TEST_PASSPHRASE, name: 'Phone', platform: 'ios' });
    expect(create.status).toBe(429);
    expect(await create.json()).toMatchObject({ error: { code: 'too_many_attempts' } });
    expect(Number(create.headers.get('retry-after'))).toBeGreaterThan(0);

    // failed logins lock device creation too
    await resetThrottle();
    for (let i = 0; i < 5; i++) await post('/auth/login', { passphrase: `wrong again ${i}` });
    expect((await post('/auth/devices', { passphrase: TEST_PASSPHRASE, name: 'Phone', platform: 'ios' })).status).toBe(429);

    // a success resets the counter
    await env.DB.prepare(`UPDATE sync_state SET value = '{"fails":5,"lockedUntil":0}' WHERE key = 'auth.throttle'`).run();
    expect((await post('/auth/devices', { passphrase: TEST_PASSPHRASE, name: 'Phone', platform: 'ios' })).status).toBe(201);
    const t = await env.DB.prepare(`SELECT value FROM sync_state WHERE key = 'auth.throttle'`).first<{ value: string }>();
    expect(JSON.parse(t!.value)).toMatchObject({ fails: 0 });
  });

  it('changing the passphrase revokes every device token', async () => {
    const a = await createDevice('A');
    const b = await createDevice('B');
    expect((await get('/settings', bearer(a.token))).status).toBe(200);
    expect((await get('/settings', bearer(b.token))).status).toBe(200);
    const res = await post('/auth/change', { current: TEST_PASSPHRASE, next: NEXT_PASSPHRASE }, bearer(a.token));
    expect(res.status).toBe(200);
    expect((await get('/settings', bearer(a.token))).status).toBe(401);
    expect((await get('/settings', bearer(b.token))).status).toBe(401);
    expect(await (await get('/auth/status', bearer(a.token))).json()).toMatchObject({ authenticated: false });
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM devices').first<{ n: number }>();
    expect(n!.n).toBe(0);
    // the new passphrase issues working tokens
    const fresh = await createDevice('After change', NEXT_PASSPHRASE);
    expect((await get('/settings', bearer(fresh.token))).status).toBe(200);
  });

  it('demo reset keeps device sign-ins', async () => {
    const { token } = await createDevice('Survivor', NEXT_PASSPHRASE);
    const res = await anon('/demo/reset', { method: 'POST', headers: bearer(token) });
    expect(res.status).toBe(200);
    expect((await res.json<{ tables: string[] }>()).tables).not.toContain('devices');
    expect((await get('/settings', bearer(token))).status).toBe(200);
  });

  it('adds no CORS: a cross-origin preflight for Authorization is not granted', async () => {
    const res = await anon('/settings', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('access-control-allow-headers')).toBeNull();
  });
});
