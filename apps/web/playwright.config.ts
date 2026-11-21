import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 5174);
const PERSIST = process.env.E2E_PERSIST ?? '.wrangler/e2e';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'off',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: {
    command:
      `rm -rf ${PERSIST} && wrangler d1 migrations apply DB --local --persist-to ${PERSIST}` +
      ` && CF_PERSIST_TO=${PERSIST} vite dev --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_ACCOUNT_ID: '', NO_D1_WARNING: 'true' },
  },
});
