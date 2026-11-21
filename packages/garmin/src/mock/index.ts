/**
 * `@cadence/garmin/mock` — offline fake Garmin (tests, Miniflare outboundService,
 * DEMO mode). See server.ts for routing and failure injection.
 *
 *   const mock = createGarminMock({ athlete, synth });
 *   const client = new GarminClient({ fetch: mock.fetch, tokens });            // real hostnames
 *   // mounted inside the app Worker (DEMO):
 *   //   if (url.pathname.startsWith('/__garmin/')) return mock.fetch(request);
 *   //   new GarminClient({ fetch, baseUrls: mockBaseUrls(origin), tokens })
 *   // Miniflare: new Miniflare({ outboundService: (req) => mock.fetch(req), ... })
 */
export {
  createGarminMock,
  mockBaseUrls,
  type GarminMock,
  type GarminMockOptions,
  type GarminMockState,
  type MockApi,
  type MockFailures,
  type MockRequestLog,
  type MockScenario,
  type MockSchedule,
} from './server';
export { MOCK_ACTIVITY_TYPES, MOCK_DEVICE_ID, MOCK_PROFILE_ID } from './wire';
