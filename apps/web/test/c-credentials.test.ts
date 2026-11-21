import { describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { json } from './helpers';
import { getGarminAuth, upsertGarminAuth } from '../worker/db/garmin';
import {

  d1TokenStore,
  decryptCredentials,
  encryptCredentials,
  getDemoMock,
  getGarminClient,
  resetDemoMock,
  setDemoConfig,
  setDemoNow,
} from '../worker/services/garmin';

// Syncs generate + parse FIT files in workerd; keep headroom when the whole suite runs in parallel.
vi.setConfig({ testTimeout: 60_000 });

const TODAY = '2026-11-20';

describe('credential store', () => {
  it('encrypts with AES-GCM: round trip, fresh IV per write, tamper detection', async () => {
    const creds = { personal: { apiKey: 'k-123', keyExpiresOn: '2027-01-01' }, di: { di_token: 'a.b.c', di_refresh_token: 'r1', di_client_id: 'cid' } };
    const a = await encryptCredentials(env, creds);
    const b = await encryptCredentials(env, creds);
    expect(a).not.toBe(b);
    expect(a).not.toContain('k-123');
    expect(await decryptCredentials(env, a)).toEqual(creds);
    const tampered = a.slice(0, -4) + (a.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    await expect(decryptCredentials(env, tampered)).rejects.toThrow();
  });

  it('the D1 store loads null and never creates a row when disconnected', async () => {
    const store = d1TokenStore(env);
    expect(await store.load()).toBeNull();
    await store.save({ personal: { apiKey: 'x' } });
    expect(await getGarminAuth(env.DB)).toBeNull();
    expect(store.saves).toBe(0);
  });

  it('saves with compare-and-swap; a stale writer still persists its (newer) token', async () => {
    await upsertGarminAuth(env.DB, { credentialsEnc: await encryptCredentials(env, { personal: { apiKey: 'v0' } }) });
    const s1 = d1TokenStore(env);
    const s2 = d1TokenStore(env);
    await s1.load();
    await s2.load();
    await s1.save({ personal: { apiKey: 'v1' } });
    await s2.save({ personal: { apiKey: 'v2' } });
    expect(s1.saves + s2.saves).toBe(2);
    const row = await getGarminAuth(env.DB);
    expect((await decryptCredentials(env, row!.credentialsEnc)).personal?.apiKey).toBe('v2');
  });

  it('persists DI token rotation so the next client uses the new refresh token', async () => {
    await setDemoConfig(env, { seed: 4, athleteToday: TODAY, months: 1 });
    await setDemoNow(env, Date.parse(`${TODAY}T12:00:00Z`));
    await json('/garmin/connect', { method: 'POST', body: { demo: true, initialSync: false } });
    const { mock } = await getDemoMock(env);
    const before = (await decryptCredentials(env, (await getGarminAuth(env.DB))!.credentialsEnc)).di!;
    const client = (await getGarminClient(env))!;
    await client.refreshDiNow();
    const after = (await decryptCredentials(env, (await getGarminAuth(env.DB))!.credentialsEnc)).di!;
    expect(after.di_refresh_token).not.toBe(before.di_refresh_token);
    expect(after.displayName).toBe(before.displayName);
    expect(mock.state.diRefreshTokens.has(before.di_refresh_token)).toBe(false); // rotated: old one is dead
    // a brand-new client (another request) works with what was persisted
    const next = (await getGarminClient(env))!;
    expect((await next.verifyDiToken()).displayName).toBe('jonas.tri');
  });

  it('persists the Personal API bearer after an expiry-driven re-exchange', async () => {
    const { mock } = await getDemoMock(env);
    const before = (await decryptCredentials(env, (await getGarminAuth(env.DB))!.credentialsEnc)).personal!;
    mock.expireAccessTokens();
    const client = (await getGarminClient(env))!;
    await client.listActivities({ limit: 1 }); // 401 → re-exchange → retry
    const after = (await decryptCredentials(env, (await getGarminAuth(env.DB))!.credentialsEnc)).personal!;
    expect(after.bearer).toBeTruthy();
    expect(after.bearer).not.toBe(before.bearer);
  });

  it('demo mode heals credentials the in-memory mock no longer knows (isolate restart)', async () => {
    resetDemoMock();
    const client = (await getGarminClient(env))!;
    expect((await client.verifyDiToken()).displayName).toBe('jonas.tri');
    expect((await client.listActivities({ limit: 2 })).length).toBe(2);
  });
});
