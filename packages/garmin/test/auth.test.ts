import { describe, expect, it } from 'vitest';
import {
  DI_CLIENT_IDS,
  GarminAuthError,
  GarminBlockedError,
  basicClientAuth,
  decodeJwtPayload,
  experimentalCompleteMfa,
  experimentalPasswordLogin,
  exchangePersonalApiKey,
  jwtExpiry,
  parseGarminTokensJson,
  refreshDiToken,
} from '../src';
import { createGarminMock } from '../src/mock';
import { base64UrlEncodeString } from '../src/util';
import { fakeSynth, makeAthlete } from './helpers/fake-athlete';
import { clock, harness } from './helpers/setup';

const jwt = (payload: object) => `${base64UrlEncodeString('{"alg":"none"}')}.${base64UrlEncodeString(JSON.stringify(payload))}.sig`;

describe('JWT + token file helpers', () => {
  it('decodes payload and exp, tolerates opaque tokens', () => {
    const t = jwt({ exp: 1_800_000_000, client_id: 'GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2', name: 'Zoë' });
    expect(decodeJwtPayload(t)?.name).toBe('Zoë');
    expect(jwtExpiry(t)).toBe(1_800_000_000);
    expect(jwtExpiry('opaque-token')).toBeUndefined();
    expect(basicClientAuth('ABC')).toBe(`Basic ${btoa('ABC:')}`);
  });

  it('parses garmin_tokens.json (text or object), falls back to the JWT client_id claim', () => {
    const token = jwt({ exp: 1, client_id: 'GARMIN_CONNECT_MOBILE_ANDROID_DI' });
    const parsed = parseGarminTokensJson(JSON.stringify({ di_token: token, di_refresh_token: 'refresh-xyz' }));
    expect(parsed).toEqual({ di_token: token, di_refresh_token: 'refresh-xyz', di_client_id: 'GARMIN_CONNECT_MOBILE_ANDROID_DI' });
    expect(parseGarminTokensJson({ di_token: token, di_refresh_token: 'r123', di_client_id: 'X_ID' }).di_client_id).toBe('X_ID');
    expect(() => parseGarminTokensJson('{not json')).toThrow(GarminAuthError);
    expect(() => parseGarminTokensJson({ oauth1_token: 'legacy garth format' })).toThrow(/di_token/);
  });
});

describe('Personal API key exchange', () => {
  it('returns the raw JWT and its exp; a bad key is personal_key_invalid', async () => {
    const clk = clock();
    const mock = createGarminMock({ athlete: makeAthlete(), synth: fakeSynth, now: clk.now });
    const nowSec = Math.floor(clk.now().getTime() / 1000);
    const ok = await exchangePersonalApiKey(mock.fetch, 'https://personal.connectapi.garmin.com', 'good-key', nowSec);
    expect(ok.bearerExp).toBe(nowSec + 86_400);
    expect(ok.bearer.split('.')).toHaveLength(3);
    await expect(exchangePersonalApiKey(mock.fetch, 'https://personal.connectapi.garmin.com', 'bad-key', nowSec)).rejects.toMatchObject({
      name: 'GarminAuthError',
      code: 'personal_key_invalid',
    });
  });

  it('client persists the bearer through the TokenStore and reuses it', async () => {
    const h = harness({ personal: true });
    await h.client.listActivities({ limit: 1 });
    await h.client.listActivities({ limit: 1 });
    expect(h.mock.state.personalExchangeCount).toBe(1);
    expect(h.store.current?.personal?.bearer).toBeTruthy();
    expect(h.store.current?.personal?.apiKey).toBe('good-key');
    // < 1 h left → re-exchange before the call
    h.clk.advance(23.5 * 3600_000);
    await h.client.listActivities({ limit: 1 });
    expect(h.mock.state.personalExchangeCount).toBe(2);
  });
});

describe('DI refresh rotation', () => {
  it('rotates the refresh token, persists it, and the old refresh token is dead', async () => {
    const clk = clock();
    const mock = createGarminMock({ athlete: makeAthlete(), synth: fakeSynth, now: clk.now });
    const di = mock.issueDiTokens();
    const fresh = await refreshDiToken(mock.fetch, 'https://diauth.garmin.com', di);
    expect(fresh.di_token).not.toBe(di.di_token);
    expect(fresh.di_refresh_token).not.toBe(di.di_refresh_token);
    expect(fresh.di_client_id).toBe(DI_CLIENT_IDS[0]);
    await expect(refreshDiToken(mock.fetch, 'https://diauth.garmin.com', di)).rejects.toMatchObject({ code: 'needs_reauth' });
  });

  it('client refreshes proactively near exp and saves the rotated set via TokenStore', async () => {
    const h = harness({ di: true }, { diAccessTtlSec: 1200 });
    const before = h.store.current!.di!;
    h.clk.advance(400_000); // 800 s left < 900 s margin
    await h.client.verifyDiToken();
    const after = h.store.current!.di!;
    expect(h.mock.state.refreshCount).toBe(1);
    expect(after.di_refresh_token).not.toBe(before.di_refresh_token);
    expect(after.displayName).toBe('cadence-test'); // cached identity survives
    expect(h.mock.state.diRefreshTokens.has(before.di_refresh_token)).toBe(false);
  });

  it('refresh_invalid → GarminAuthError needs_reauth', async () => {
    const h = harness({ di: true }, { failures: { refreshInvalid: true } });
    h.mock.expireAccessTokens();
    await expect(h.client.verifyDiToken()).rejects.toMatchObject({ name: 'GarminAuthError', code: 'needs_reauth', kind: 'di' });
  });
});

describe('experimental SSO login (single attempt)', () => {
  const sso = { username: 'me@example.com', password: 'pw' };

  it('logs in without MFA and exchanges the ticket for a DI token', async () => {
    const clk = clock();
    const mock = createGarminMock({ athlete: makeAthlete(), synth: fakeSynth, now: clk.now, sso });
    const res = await experimentalPasswordLogin({ fetch: mock.fetch, ...sso, delayMs: 0 });
    expect(res.status).toBe('ok');
    if (res.status === 'ok') expect(mock.state.diAccessTokens.has(res.di.di_token)).toBe(true);
  });

  it('MFA: returns a serializable pending state, then completes with the code', async () => {
    const clk = clock();
    const mock = createGarminMock({ athlete: makeAthlete(), synth: fakeSynth, now: clk.now, sso: { ...sso, mfaCode: '123456' } });
    const res = await experimentalPasswordLogin({ fetch: mock.fetch, ...sso, delayMs: 0 });
    expect(res.status).toBe('mfa_required');
    if (res.status !== 'mfa_required') return;
    const pending = JSON.parse(JSON.stringify(res.pending));
    expect(pending.cookies.SESSION).toBeTruthy();
    await expect(experimentalCompleteMfa({ fetch: mock.fetch, pending, code: '000000' })).rejects.toMatchObject({ code: 'invalid_mfa_code' });
    const done = await experimentalCompleteMfa({ fetch: mock.fetch, pending, code: '123456' });
    expect(done.di.di_refresh_token).toMatch(/^mock-refresh/);
  });

  it('reports wrong credentials and blocking distinctly', async () => {
    const clk = clock();
    const mock = createGarminMock({ athlete: makeAthlete(), synth: fakeSynth, now: clk.now, sso });
    await expect(experimentalPasswordLogin({ fetch: mock.fetch, username: 'me@example.com', password: 'nope', delayMs: 0 })).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
    mock.setScenario('sso_blocked');
    await expect(experimentalPasswordLogin({ fetch: mock.fetch, ...sso, delayMs: 0 })).rejects.toBeInstanceOf(GarminBlockedError);
  });

  it('POST without the sign-in page cookies is refused (429) as Garmin does', async () => {
    const clk = clock();
    const mock = createGarminMock({ athlete: makeAthlete(), synth: fakeSynth, now: clk.now, sso });
    const res = await mock.fetch(new Request('https://sso.garmin.com/mobile/api/login?clientId=GCM_IOS_DARK', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(429);
  });
});
