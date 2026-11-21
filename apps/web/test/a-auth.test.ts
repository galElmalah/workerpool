import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { anon, TEST_PASSPHRASE } from './helpers';

const post = (path: string, body: unknown, cookie?: string) =>
  anon(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
const cookieOf = (res: Response) => res.headers.get('set-cookie')?.split(';')[0] ?? '';
const get = (path: string, cookie?: string) => anon(path, { headers: cookie ? { cookie } : {} });

describe('auth', () => {
  let session = '';

  it('is open for health and status, closed elsewhere', async () => {
    expect((await get('/health')).status).toBe(200);
    const st = await get('/auth/status');
    expect(st.status).toBe(200);
    expect(await st.json()).toEqual({ configured: false, authenticated: false, demo: true });
    const res = await get('/settings');
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: 'unauthorized' } });
  });

  it('login before setup is rejected', async () => {
    const res = await post('/auth/login', { passphrase: TEST_PASSPHRASE });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'not_configured' } });
  });

  it('setup validates length and sets a hardened cookie', async () => {
    const short = await post('/auth/setup', { passphrase: 'short' });
    expect(short.status).toBe(400);
    expect(await short.json()).toMatchObject({ error: { code: 'validation' } });

    const res = await post('/auth/setup', { passphrase: TEST_PASSPHRASE });
    expect(res.status).toBe(201);
    const raw = res.headers.get('set-cookie') ?? '';
    expect(raw).toMatch(/^cadence_session=/);
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Lax/i);
    expect(raw).toMatch(/Secure/i);
    expect(raw).toMatch(/Max-Age=5184000/);
    session = cookieOf(res);
    expect((await get('/settings', session)).status).toBe(200);
    expect(await (await get('/auth/status', session)).json()).toMatchObject({ configured: true, authenticated: true });
  });

  it('setup only works once', async () => {
    const res = await post('/auth/setup', { passphrase: 'another passphrase' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'already_configured' } });
  });

  it('stores a PBKDF2 hash, never the passphrase', async () => {
    const row = await env.DB.prepare('SELECT * FROM auth WHERE id = 1').first<Record<string, unknown>>();
    expect(row?.iterations).toBe(100_000);
    expect(JSON.stringify(row)).not.toContain(TEST_PASSPHRASE);
  });

  it('rejects tampered and foreign cookies', async () => {
    const [name, value] = session.split('=');
    const [body, sig] = value.split('.');
    const forged = `${name}=${body}.${sig.slice(0, -2)}xx`;
    expect((await get('/settings', forged)).status).toBe(401);
    expect((await get('/settings', 'cadence_session=garbage')).status).toBe(401);
  });

  it('wrong passphrase → 401, right one → cookie', async () => {
    const bad = await post('/auth/login', { passphrase: 'not the passphrase' });
    expect(bad.status).toBe(401);
    expect(await bad.json()).toMatchObject({ error: { code: 'invalid_passphrase' } });
    expect(bad.headers.get('set-cookie')).toBeNull();
    const ok = await post('/auth/login', { passphrase: TEST_PASSPHRASE });
    expect(ok.status).toBe(200);
    expect((await get('/settings', cookieOf(ok))).status).toBe(200);
  });

  it('logout clears the cookie', async () => {
    const res = await post('/auth/logout', {}, session);
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/cadence_session=;.*Max-Age=0/i);
  });

  it('changing the passphrase bumps the epoch and invalidates old sessions', async () => {
    const before = cookieOf(await post('/auth/login', { passphrase: TEST_PASSPHRASE }));
    expect((await get('/settings', before)).status).toBe(200);

    const wrong = await post('/auth/change', { current: 'nope nope nope', next: 'brand new passphrase' });
    expect(wrong.status).toBe(401);

    const res = await post('/auth/change', { current: TEST_PASSPHRASE, next: 'brand new passphrase' });
    expect(res.status).toBe(200);
    const after = cookieOf(res);
    const epoch = await env.DB.prepare('SELECT session_epoch AS e FROM auth').first<{ e: number }>();
    expect(epoch?.e).toBe(2);

    expect((await get('/settings', before)).status).toBe(401);
    expect((await get('/settings', after)).status).toBe(200);
    expect((await post('/auth/login', { passphrase: TEST_PASSPHRASE })).status).toBe(401);
    expect((await post('/auth/login', { passphrase: 'brand new passphrase' })).status).toBe(200);
  });

  it('throttles repeated failures', async () => {
    let last: Response | undefined;
    for (let i = 0; i < 5; i++) last = await post('/auth/login', { passphrase: `wrong guess ${i}` });
    expect(last?.status).toBe(401);
    const locked = await post('/auth/login', { passphrase: 'brand new passphrase' });
    expect(locked.status).toBe(429);
    expect(await locked.json()).toMatchObject({ error: { code: 'too_many_attempts' } });
    // unlock (simulate the lock expiring)
    await env.DB.prepare(`UPDATE sync_state SET value = '{"fails":5,"lockedUntil":0}' WHERE key = 'auth.throttle'`).run();
    expect((await post('/auth/login', { passphrase: 'brand new passphrase' })).status).toBe(200);
    const t = await env.DB.prepare(`SELECT value FROM sync_state WHERE key = 'auth.throttle'`).first<{ value: string }>();
    expect(JSON.parse(t!.value)).toMatchObject({ fails: 0 });
  });
});
