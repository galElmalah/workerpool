/**
 * Optional end-to-end test against the real synthetic-athlete generator
 * (src/synth, owned by another workstream). Skips when it is missing or fails
 * to produce an athlete, so this suite never depends on its progress.
 */
import { describe, expect, it } from 'vitest';
import type { SynthApi, SynthAthlete } from '../src/synth/types';
import {
  GarminClient,
  mapActivitySummary,
  memoryTokenStore,
  parseFit,
  pullWellnessRange,
  pushPlannedWorkout,
  runBackfillStep,
  toThresholdSnapshot,
  type BackfillCursor,
} from '../src';
import { createGarminMock } from '../src/mock';

let synth: SynthApi | undefined;
let athlete: SynthAthlete | undefined;
let skipReason = '';
try {
  const path = '../src/synth/index';
  const mod = (await import(/* @vite-ignore */ path)) as Partial<SynthApi>;
  if (typeof mod.generateAthlete === 'function' && typeof mod.generateActivityDetail === 'function' && typeof mod.encodeFit === 'function') {
    synth = mod as SynthApi;
    athlete = synth.generateAthlete({ today: '2026-11-21', months: 2, seed: 7 });
  } else skipReason = 'synth exports missing';
} catch (e) {
  skipReason = `synth unavailable: ${e instanceof Error ? e.message : String(e)}`;
}

describe.skipIf(!athlete)(`real synth athlete through the mock ${skipReason}`, () => {
  const now = () => new Date('2026-11-21T23:00:00Z');
  const setup = () => {
    const mock = createGarminMock({ athlete: athlete!, synth: synth!, now });
    const client = new GarminClient({ fetch: mock.fetch, tokens: memoryTokenStore({ personal: { apiKey: 'good-key' }, di: mock.issueDiTokens() }), now });
    return { mock, client };
  };

  it('backfills every activity, maps them, and parses a downloaded FIT', async () => {
    const { client } = setup();
    let cursor: BackfillCursor | null = null;
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const r = await runBackfillStep(client, cursor, { pageSize: 50, maxRequests: 2 });
      for (const it of r.items) seen.add(it.garminActivityId);
      cursor = r.nextCursor;
      if (r.done) break;
    }
    expect(seen.size).toBe(athlete!.activities.length);
    const first = athlete!.activities.at(-1)!;
    const summary = mapActivitySummary(await client.getActivity(first.garminActivityId));
    expect(summary.sport).toBe(first.sport);
    const fit = parseFit(await client.downloadOriginalFit(first.garminActivityId));
    expect(fit.ok).toBe(true);
    expect(fit.sport).toBe(first.sport);
  });

  it('pulls wellness and pushes an upcoming planned session', async () => {
    const { client, mock } = setup();
    const w = await pullWellnessRange(client, '2026-11-01', '2026-11-21');
    expect(w.days.length).toBeGreaterThan(10);
    const next = athlete!.plan.find((p) => p.date > athlete!.today && p.structure);
    if (!next) return;
    const th = toThresholdSnapshot(await client.getUserSettings());
    const link = await pushPlannedWorkout(
      client,
      {
        id: next.key.replace(/[^A-Za-z0-9_-]/g, '_'),
        date: next.date,
        sport: next.sport,
        ...(next.subSport ? { subSport: next.subSport } : {}),
        title: next.title,
        structure: next.structure!,
        isKey: next.isKey,
        intensity: next.intensity,
        tags: next.tags,
        environment: next.environment,
        status: 'planned',
        garmin: { syncState: 'none' },
        createdAt: '2026-11-21T00:00:00Z',
        updatedAt: '2026-11-21T00:00:00Z',
      },
      { ...th, swimCssMps: athlete!.profile.swimCssMps },
      undefined,
    );
    expect(link.syncState).toBe('synced');
    expect(mock.state.schedules.size).toBe(1);
  });
});
