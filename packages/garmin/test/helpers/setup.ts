import { GarminClient, memoryTokenStore, type GarminCredentials } from '../../src';
import { createGarminMock, type GarminMockOptions } from '../../src/mock';
import { fakeSynth, makeAthlete } from './fake-athlete';

/** A mutable mock clock. */
export function clock(iso = '2026-11-21T08:00:00Z') {
  let t = Date.parse(iso);
  return {
    now: () => new Date(t),
    set: (s: string) => {
      t = Date.parse(s);
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

export interface Harness {
  mock: ReturnType<typeof createGarminMock>;
  client: GarminClient;
  store: ReturnType<typeof memoryTokenStore>;
  clk: ReturnType<typeof clock>;
  sleeps: number[];
}

/** Mock + client wired together. `creds`: which credential kinds to start with. */
export function harness(
  creds: { personal?: boolean; di?: boolean } = { personal: true, di: true },
  mockOpts: Partial<GarminMockOptions> = {},
): Harness {
  const clk = clock();
  const mock = createGarminMock({ athlete: makeAthlete(), synth: fakeSynth, now: clk.now, ...mockOpts });
  const initial: GarminCredentials = {};
  if (creds.personal) initial.personal = { apiKey: 'good-key' };
  if (creds.di) initial.di = mock.issueDiTokens();
  const store = memoryTokenStore(initial);
  const sleeps: number[] = [];
  const client = new GarminClient({
    fetch: mock.fetch,
    tokens: store,
    now: clk.now,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.5,
  });
  return { mock, client, store, clk, sleeps };
}
