/**
 * Seeds a SMALL demo dataset (2 months of the synthetic athlete, pinned "today") into the dev
 * server Playwright started (webServer runs before globalSetup). Idempotent: the demo seed
 * reuses a finished job with the same parameters.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { FullConfig } from '@playwright/test';

export const E2E_TODAY = '2026-11-21';

export default function globalSetup(config: FullConfig): void {
  const base = (config.projects[0]?.use.baseURL ?? `http://localhost:${process.env.E2E_PORT ?? 5174}`).replace(/\/$/, '');
  execFileSync(
    process.execPath,
    [path.join(import.meta.dirname, '../scripts/seed-demo.mjs'), '--base', base, '--months', '2', '--fast', '--today', E2E_TODAY, '--quiet'],
    { stdio: 'inherit', timeout: 300_000 },
  );
}
