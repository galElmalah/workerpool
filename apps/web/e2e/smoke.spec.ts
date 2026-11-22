/**
 * Smoke journeys against the dev server in demo mode, seeded with 2 months of the synthetic
 * athlete by ./global-setup.ts ("today" pinned to 2026-11-21).
 */
import { expect, test, type Page } from '@playwright/test';

const PASSPHRASE = 'cadence-demo';

async function signIn(page: Page) {
  const res = await page.request.post('/api/auth/login', { data: { passphrase: PASSPHRASE } });
  expect(res.ok()).toBe(true);
}

test('signs in through the login page', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Passphrase' }).fill(PASSPHRASE);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).not.toHaveURL(/\/login|\/welcome/);
  await expect(page.getByRole('link', { name: 'Today' }).first()).toBeVisible();
});

test.describe('signed in', () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test('today renders its sessions', async ({ page }) => {
    await page.goto('/today');
    await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
    await expect(page.locator('main a[href^="/activities/act_"], main a[href^="/workouts/wk_"]').first()).toBeVisible();
  });

  test('activities list → activity → streams chart', async ({ page }) => {
    await page.goto('/activities');
    const row = page.locator('main a[href^="/activities/act_"]').first();
    await expect(row).toBeVisible();
    await row.click();
    await expect(page).toHaveURL(/\/activities\/act_/);
    await expect(page.locator('main canvas').first()).toBeVisible({ timeout: 15_000 });
  });

  test('trends overview shows tiles and charts', async ({ page }) => {
    await page.goto('/trends');
    await expect(page.getByRole('heading', { name: 'Trends', level: 1 })).toBeVisible();
    for (const t of ['Hours', 'Load', 'Fitness']) await expect(page.getByText(t, { exact: true }).first()).toBeVisible();
    await expect(page.locator('main svg[aria-roledescription="chart"]').first()).toBeVisible();
  });

  test('builder text side creates a workout, then it is sent to Garmin', async ({ page }) => {
    await page.goto('/workouts/new?sport=run&date=2026-11-24');
    // desktop: the text side sits next to the visual builder
    const text = page.getByLabel('Workout text');
    await text.fill('- 15m z2\n4x\n  - 4m 105%\n  - 2m z1\n- 10m z1');
    await expect(page.getByText('4×').or(page.getByText('4x')).first()).toBeVisible();
    await page.getByLabel('Title').fill('E2E threshold reps');
    // primary "Save" (carries a Ctrl/⌘+↵ hint), not "Save to library" / "Save & send"
    await page.locator('main button', { hasText: /^Save/ }).filter({ hasNotText: /library|send/ }).first().click();
    await expect(page).toHaveURL(/\/workouts\/wk_/);
    await expect(page.getByRole('heading', { level: 1, name: 'E2E threshold reps' })).toBeVisible();
    // persisted: reload shows the same structure
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'E2E threshold reps' })).toBeVisible();

    await page.getByRole('button', { name: 'Send to Garmin' }).click();
    await expect(page.getByRole('button', { name: 'Resend' })).toBeVisible({ timeout: 20_000 });
  });

  test('library: schedule a template and open the created workout', async ({ page }) => {
    await page.goto('/library');
    await page.getByRole('button', { name: 'Schedule' }).first().click();
    await page.getByRole('gridcell').filter({ hasText: /^25$/ }).first().click();
    await expect(page.getByText(/Scheduled/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Open' }).click();
    await expect(page).toHaveURL(/\/workouts\/wk_/);
  });

  test('settings: editing FTP updates the zone table', async ({ page }) => {
    await page.goto('/settings/zones');
    const table = page.locator('main table').first();
    await expect(table).toBeVisible();
    const before = await table.innerText();
    const ftp = page.getByLabel('FTP', { exact: true });
    const cur = Number((await ftp.inputValue()).replace(/[^\d.]/g, '')) || 250;
    await ftp.fill(String(Math.round(cur) + 37));
    await ftp.press('Enter');
    await expect.poll(async () => table.innerText(), { timeout: 15_000 }).not.toBe(before);
  });

  test('journal shows entries', async ({ page }) => {
    await page.goto('/journal');
    await expect(page.getByRole('heading', { name: 'Journal' })).toBeVisible();
    await expect(page.locator('main a[href^="/week/"], main a[href^="/workouts/"], main a[href^="/activities/"], main a[href^="/calendar/day/"]').first()).toBeVisible();
  });
});
