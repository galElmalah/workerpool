import { describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { api, json } from './helpers';
import { getGarminAuth } from '../worker/db/garmin';
import { putState } from '../worker/db/sync';
import { DEMO_API_KEY, DEMO_SSO, decryptCredentials, getDemoMock, setDemoConfig, setDemoNow } from '../worker/services/garmin';

// Syncs generate + parse FIT files in workerd; keep headroom when the whole suite runs in parallel.
vi.setConfig({ testTimeout: 60_000 });


const TODAY = '2026-11-20';

async function setupDemo() {
  await setDemoConfig(env, { seed: 3, athleteToday: TODAY, months: 1 });
  await setDemoNow(env, Date.parse(`${TODAY}T20:00:00Z`));
  return (await getDemoMock(env)).mock;
}

describe('garmin connect / status / disconnect', () => {
  it('reports disconnected before anything is stored', async () => {
    const s = await json('/garmin/status');
    expect(s).toMatchObject({ connected: false, state: 'disconnected', capabilities: { read: false, write: false }, demo: true });
  });

  it('rejects an empty connect body', async () => {
    const res = await api('/garmin/connect', { method: 'POST', body: {} });
    expect(res.status).toBe(400);
  });

  it('maps a rejected Personal API key to garmin_auth_failed and logs it', async () => {
    await setupDemo();
    const res = await api('/garmin/connect', { method: 'POST', body: { apiKey: 'not-the-key', initialSync: false } });
    expect(res.status).toBe(400);
    expect((await res.json<any>()).error.code).toBe('garmin_auth_failed');
    expect(await getGarminAuth(env.DB)).toBeNull();
    const log = await json('/sync/log?limit=5');
    expect(log.entries[0]).toMatchObject({ kind: 'auth', status: 'error' });
  });

  it('rejects malformed garmin_tokens.json', async () => {
    const res = await api('/garmin/connect', { method: 'POST', body: { tokensJson: '{"nope":1}', initialSync: false } });
    expect(res.status).toBe(400);
    expect((await res.json<any>()).error.code).toBe('garmin_tokens_invalid');
  });

  it('connects read-only with just an API key (encrypted at rest)', async () => {
    const s = await json('/garmin/connect', { method: 'POST', body: { apiKey: DEMO_API_KEY, keyExpiresOn: '2027-02-01', initialSync: false } });
    expect(s).toMatchObject({ connected: true, state: 'connected', capabilities: { read: true, write: false }, displayName: 'jonas.tri' });
    expect(s.credentials).toEqual({ personalApiKey: true, connectToken: false, keyExpiresOn: '2027-02-01' });
    const row = await getGarminAuth(env.DB);
    expect(row!.credentialsEnc).not.toContain(DEMO_API_KEY);
    const creds = await decryptCredentials(env, row!.credentialsEnc);
    expect(creds.personal?.apiKey).toBe(DEMO_API_KEY);
    expect(creds.personal?.bearer).toBeTruthy(); // exchanged bearer cached
  });

  it('adds write access with a pasted token set, keeping the API key', async () => {
    const mock = (await getDemoMock(env)).mock;
    const tokens = mock.issueDiTokens();
    const s = await json('/garmin/connect', { method: 'POST', body: { tokensJson: JSON.stringify(tokens), initialSync: false } });
    expect(s.capabilities).toEqual({ read: true, write: true });
    expect(s.credentials).toMatchObject({ personalApiKey: true, connectToken: true });
    const creds = await decryptCredentials(env, (await getGarminAuth(env.DB))!.credentialsEnc);
    expect(creds.di?.displayName).toBe('jonas.tri');
  });

  it('disconnect wipes credentials and sync cursors but keeps the log', async () => {
    await putState(env.DB, 'garmin:activities', { watermark: { startMs: 1, activityId: '1' } });
    const s = await json('/garmin/connect', { method: 'DELETE' });
    expect(s).toMatchObject({ connected: false, state: 'disconnected' });
    expect(await getGarminAuth(env.DB)).toBeNull();
    expect(await env.DB.prepare("SELECT count(*) AS n FROM sync_state WHERE key LIKE 'garmin:%'").first('n')).toBe(0);
    const log = await json('/sync/log');
    expect(log.entries[0]).toMatchObject({ kind: 'auth', status: 'ok' });
    expect(log.entries[0].summary).toMatch(/Disconnected/);
  });

  it('connects the demo account in one call', async () => {
    const s = await json('/garmin/connect', { method: 'POST', body: { demo: true, initialSync: false } });
    expect(s).toMatchObject({ connected: true, capabilities: { read: true, write: true } });
  });

  it('maps a bot block to garmin_blocked and rate limits to garmin_rate_limited', async () => {
    const mock = (await getDemoMock(env)).mock;
    await api('/garmin/connect', { method: 'DELETE' });
    mock.setScenario('blocked');
    const tokens = mock.issueDiTokens();
    let res = await api('/garmin/connect', { method: 'POST', body: { tokensJson: tokens, initialSync: false } });
    expect(res.status).toBe(503);
    expect((await res.json<any>()).error.code).toBe('garmin_blocked');
    mock.setScenario('rate_limited');
    res = await api('/garmin/connect', { method: 'POST', body: { apiKey: DEMO_API_KEY, initialSync: false } });
    expect(res.status).toBe(429);
    expect((await res.json<any>()).error.code).toBe('garmin_rate_limited');
    mock.setScenario('ok');
  });

  it('experimental email/password login with MFA (single attempt)', async () => {
    let s = await json('/garmin/connect', { method: 'POST', body: { email: DEMO_SSO.username, password: DEMO_SSO.password, initialSync: false } });
    expect(s.result).toBe('needs_mfa');
    expect(s.state).toBe('needs_mfa');
    const bad = await api('/garmin/connect', { method: 'POST', body: { mfaCode: '000000', initialSync: false } });
    expect((await bad.json<any>()).error.code).toBe('garmin_auth_failed');
    // a rejected code consumes nothing: ask again
    s = await json('/garmin/connect', { method: 'POST', body: { email: DEMO_SSO.username, password: DEMO_SSO.password, initialSync: false } });
    s = await json('/garmin/connect', { method: 'POST', body: { mfaCode: DEMO_SSO.mfaCode, initialSync: false } });
    expect(s).toMatchObject({ connected: true, state: 'connected', capabilities: { write: true } });
  });

  it('runs the initial sync in the background after connecting', async () => {
    await api('/garmin/connect', { method: 'DELETE' });
    await json('/garmin/connect', { method: 'POST', body: { demo: true } });
    let entry: any;
    for (let i = 0; i < 600 && !entry; i++) {
      const log = await json('/sync/log?kind=pull_activities');
      entry = log.entries.find((e: any) => e.status !== 'running');
      if (!entry) await new Promise((r) => setTimeout(r, 100));
    }
    expect(entry).toMatchObject({ kind: 'pull_activities', status: 'ok' });
    const s = await json('/garmin/status');
    expect(s.lastSyncAt).toBeTruthy();
    expect(s.counts.garminActivities).toBeGreaterThan(0);
  }, 90_000);
});
