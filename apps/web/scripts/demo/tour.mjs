#!/usr/bin/env node
/**
 * Cadence product walkthrough — the scripted tour behind `cadence-walkthrough.mp4`.
 *
 *   node scripts/demo/tour.mjs --base http://localhost:5208 --fresh http://localhost:5218 --out <dir>
 *   node scripts/demo/tour.mjs ... --only calendar,builder     # re-record some segments, re-join all
 *   node scripts/demo/tour.mjs ... --no-join                   # record only, skip the final concat
 *
 * EXPECTED STATE — the tour mutates data, so every take needs fresh databases:
 *   --base   a dev server on a FRESH COPY of `.wrangler/seed-master` (the seeded demo athlete;
 *            demo clock pinned to Sat 2026-11-21; passphrase `cadence-demo`). The tour moves a
 *            workout, quick-adds one, toggles key/intensity, pushes one to the mock Garmin, builds and
 *            saves a new ride and logs a morning check-in.
 *   --fresh  a dev server on an EMPTY, freshly migrated database (first-run onboarding segment).
 * `scripts/demo/record.sh` resets both state dirs, starts both servers, runs this, and stops them.
 * Re-running a single segment with --only against an already-mutated copy mostly works (each
 * segment navigates to its own start page), but for the final take always use record.sh.
 *
 * Output: <out>/segments/<name>.mp4 (+ <name>.json with beat timestamps and the cursor hand-over
 * position), joined in SEGMENTS order into <out>/cadence-walkthrough.mp4 (+ beats.json).
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { createRecorder } from './recorder.mjs';

const run = promisify(execFile);

const { values: args } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://localhost:5208' },
    fresh: { type: 'string', default: 'http://localhost:5218' },
    out: { type: 'string', default: 'demo-video' },
    only: { type: 'string' },
    'no-join': { type: 'boolean', default: false },
    crf: { type: 'string', default: '20' },
    headed: { type: 'boolean', default: false },
  },
});

const W = 1600;
const H = 900;
const PASS = 'cadence-demo';
const TZ = 'Europe/Madrid';
const OUT = path.resolve(args.out);
const SEG_DIR = path.join(OUT, 'segments');
/** Centre of the content column (rail is 232 px): captions sit over the content, clear of the rail and the toasts. */
const CX = 1010;

// ───────────────────────────── helpers ─────────────────────────────

/** Wait until no loading skeleton is visible in the viewport (ignores the import progress sheen). */
async function settle(page, { timeout = 15000, quiet = 250 } = {}) {
  await page
    .waitForFunction(
      () => {
        const vis = [...document.querySelectorAll('.skeleton, [aria-busy="true"][aria-label="Loading"]')].filter((el) => {
          if (el.closest('[role=progressbar]')) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
        });
        return vis.length === 0;
      },
      null,
      { timeout, polling: 100 },
    )
    .catch(() => console.warn('  ! settle: skeletons still visible after', timeout, 'ms'));
  await page.waitForTimeout(quiet);
}

const skeletonVisible = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.skeleton, [aria-busy="true"][aria-label="Loading"]')].some((el) => {
      if (el.closest('[role=progressbar]')) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
    }),
  );

/**
 * After an in-app navigation: wait for the URL, let the view transition play on camera, then — if
 * the page is still loading — cut the skeleton out (pause until the data is in), so no loading frame
 * ever reaches the video.
 */
async function arrive(rec, re, { quiet = 250, timeout = 15000 } = {}) {
  const { page } = rec;
  await page.waitForURL(re, { timeout });
  await page.waitForTimeout(420);
  if (await skeletonVisible(page)) {
    await rec.pause();
    await settle(page, { quiet: 150 });
    await rec.resume();
  }
  await settle(page, { quiet });
}

/** Mid-segment readiness: if something is still loading, cut the skeleton out of the video. */
async function ready(rec, quiet = 200) {
  if (await skeletonVisible(rec.page)) {
    await rec.pause();
    await settle(rec.page, { quiet: 150 });
    await rec.resume();
  }
  await settle(rec.page, { quiet });
}

/** Navigate and wait for the network to quieten — but never forever (map tiles, polling). */
async function gotoQuiet(page, url) {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
}

async function signIn(context, base) {
  const res = await context.request.post(`${base}/api/auth/login`, { data: { passphrase: PASS } });
  if (!res.ok()) throw new Error(`login failed: ${res.status()} ${await res.text()}`);
}

/** Visit routes once before recording so Vite has compiled every lazy chunk (no first-hit skeletons on camera). */
async function warm(page, base, routes) {
  for (const r of routes) {
    await gotoQuiet(page, base + r).catch(() => {});
    await settle(page, { timeout: 20000, quiet: 100 });
  }
}

/** Pacing knobs: every cursor glide and every beat pause is scaled by these (tune the whole video in one place). */
const MOVE = 0.9;
const HOLD = 0.7;
const pause = (rec, ms = 1200) => rec.wait(Math.round(ms * HOLD));

function applyPacing(rec) {
  const moveTo = rec.moveTo;
  rec.moveTo = (x, y, ms = 650) => moveTo(x, y, Math.round(ms * MOVE)); // hover/click/drag glide through this too
  const click = rec.click;
  rec.click = (loc, o = {}) => click(loc, { ...o, after: Math.round((o.after ?? 500) * HOLD) });
}

// ───────────────────────────── segments ─────────────────────────────

const SEGMENTS = [
  { name: 'onboarding', server: 'fresh', fn: onboarding },
  { name: 'calendar', server: 'base', fn: calendar },
  { name: 'workout', server: 'base', fn: workout },
  { name: 'builder', server: 'base', fn: builder },
  { name: 'today', server: 'base', fn: today },
  { name: 'trends', server: 'base', fn: trends },
  { name: 'extras', server: 'base', fn: extras },
];

// 0 + 1 — title card, then first run on an empty database.
async function onboarding(rec, base) {
  const { page } = rec;
  await page.goto(`${base}/welcome`, { waitUntil: 'networkidle' });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Create your passphrase' }).waitFor({ timeout: 45000 });
  await rec.placeCursor(W * 0.62, H * 0.62);
  await rec.fade(true, 700);
  await rec.start();
  rec.mark('title card');
  await rec.titleCard('cadence', 'Your training, one quiet instrument.', 'Plan · sync with Garmin · see progress — self-hosted on Cloudflare', 3000);
  await rec.cursor(false);
  await rec.fade(false, 700);
  await rec.cursor(true);

  rec.mark('onboarding: passphrase');
  const cap = { x: W / 2, maxWidth: 860 }; // bare layout: no rail, centre on the page
  await rec.caption('Set up in a minute', 'Connect Garmin and your history flows in — activities, FIT files, wellness.', cap);
  const pp = page.locator('#pp');
  await rec.click(pp, { after: 200 });
  await rec.type('quiet morning miles', { delay: 38 });
  await pause(rec, 300);
  await rec.click(page.getByRole('button', { name: 'Continue' }), { after: 300 });

  rec.mark('onboarding: profile');
  const name = page.getByRole('textbox', { name: 'Name' });
  await name.waitFor();
  await pause(rec, 400);
  await rec.click(name, { after: 120 });
  await rec.type('Jonas', { delay: 65 });
  await pause(rec, 450);
  await rec.click(page.getByRole('button', { name: 'Continue' }), { after: 300 });

  rec.mark('onboarding: garmin');
  const demoBtn = page.getByRole('button', { name: 'Use the demo Garmin account' });
  await demoBtn.waitFor();
  await pause(rec, 400);
  await rec.click(demoBtn, { after: 500 });
  const importBtn = page.getByRole('button', { name: /^Import .* of history$/ });
  if (!(await importBtn.isVisible())) {
    await rec.pause(); // connecting to the (mock) Garmin account
    await importBtn.waitFor({ timeout: 20000 });
    await page.waitForTimeout(400);
    await rec.resume();
  }
  await pause(rec, 600);
  await rec.click(importBtn, { after: 200 });
  // The first sync runs before the import can start, and the import then lands a few activities per
  // step: cut the waiting out and show the counter as a time-lapse (cursor still, so the cuts read as ticks).
  const imported = () =>
    page.evaluate(() => {
      const m = document.body.innerText.match(/Importing activities\s*([\d,]+)\s*\/\s*([\d,]+)/);
      return m ? Number(m[1].replace(/,/g, '')) : -1;
    });
  await rec.hover(page.getByText('History', { exact: true }), { ms: 700, dy: 40 });
  rec.mark('onboarding: history import (time-lapse)');
  for (let i = 0; i < 9; i++) {
    const before = await imported();
    await rec.pause();
    await page.waitForFunction(
      (n) => {
        const m = document.body.innerText.match(/Importing activities\s*([\d,]+)\s*\/\s*([\d,]+)/);
        return (m ? Number(m[1].replace(/,/g, '')) : -1) > n || /History imported/.test(document.body.innerText);
      },
      before,
      { timeout: 30000, polling: 100 },
    ).catch(() => {});
    await rec.resume();
    await rec.wait(i === 0 ? 900 : 420);
  }
  await pause(rec, 600);
  await rec.click(page.getByRole('button', { name: /^Continue/ }), { after: 300 });

  rec.mark('onboarding: thresholds');
  await rec.pause(); // the step swap + estimating thresholds from the imported history: cut to the loaded step
  await page.getByRole('heading', { name: 'Your thresholds' }).waitFor();
  await page.waitForTimeout(700);
  await rec.resume();
  const finishReady = () =>
    page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'Finish');
      return !!b && !b.disabled && !document.querySelector('main .skeleton, .skeleton:not([role=progressbar] *)');
    });
  if (!(await finishReady())) {
    await rec.pause(); // estimates load from the just-imported history
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'Finish');
      return b && !b.disabled;
    }, null, { timeout: 30000 });
    await settle(page, { quiet: 300 });
    await rec.resume();
  }
  await rec.hover(page.getByText(/^FTP$/).first(), { ms: 700, dy: 18 }).catch(() => {});
  await pause(rec, 900);
  await rec.scroll(360, { ms: 700 });
  await pause(rec, 200);
  await rec.click(page.getByRole('button', { name: 'Finish' }), { after: 200 });

  // The finale ("You’re set, Jonas.") lingers, then "Open calendar" lands on the freshly imported history.
  rec.mark('onboarding: finale → calendar');
  const open = page.getByRole('button', { name: /^Open (calendar|today)$/ });
  if (!(await open.isVisible().catch(() => false))) {
    await rec.pause(); // saving re-dates the thresholds over the imported history
    await open.waitFor({ timeout: 30000 });
    await page.waitForTimeout(300);
    await rec.resume();
  }
  await rec.caption('');
  await pause(rec, 1300);
  await rec.click(open, { ms: 700, after: 200 });
  await page.waitForURL(/\/calendar|\/today/, { timeout: 20000 });
  await page.waitForTimeout(400);
  await ready(rec, 300);
  await rec.moveTo(W * 0.58, H * 0.45, 900);
  await pause(rec, 1300);
  await rec.cursor(false);
  await rec.fade(true, 900);
}


// ── bounding-box helpers: aim at what is on screen at run time, never at fixed pixels ──

/** Bounding box of the first visible match, or null. */
async function boxOf(loc) {
  try {
    if (!(await loc.count())) return null;
    const first = loc.first();
    if (!(await first.isVisible())) return null;
    return await first.boundingBox();
  } catch {
    return null;
  }
}

/** A point inside a box, as fractions of its size. */
const at = (box, fx = 0.5, fy = 0.5) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });

/** Run an optional sub-beat: if it throws (layout changed), log and carry on with the tour. */
async function optional(label, fn) {
  try {
    await fn();
  } catch (e) {
    console.warn(`  ! skipped "${label}": ${String(e.message).split('\n')[0]}`);
  }
}

/** Scroll the page so `loc` sits `offset` px below the top of the viewport. */
async function scrollToLoc(rec, loc, offset = 90, ms = 1000) {
  await loc.first().waitFor({ state: 'attached', timeout: 8000 });
  const box = await loc.first().boundingBox();
  if (!box) return;
  await rec.scroll(box.y - offset, { ms });
  await ready(rec, 120);
}

/**
 * The largest chart surface (canvas or svg) that follows a heading in the page — i.e. the chart of
 * that section — clipped to the viewport. Excludes map canvases. Returns a box or null.
 */
async function chartAfter(page, headingText, { maxGap = 900 } = {}) {
  return page.evaluate(
    ([text, gap]) => {
      const h = [...document.querySelectorAll('h1,h2,h3,h4')].find((e) => e.textContent?.trim().startsWith(text));
      if (!h) return null;
      const top = h.getBoundingClientRect().top;
      const cands = [...document.querySelectorAll('main canvas, main svg')]
        .filter((el) => !el.closest('.maplibregl-map,[data-activity-map]'))
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 300 && r.height > 80 && r.top > top && r.top - top < gap);
      if (!cands.length) return null;
      const r = cands.sort((a, b) => b.width * b.height - a.width * a.height)[0];
      const y0 = Math.max(r.top, 60);
      const y1 = Math.min(r.bottom, innerHeight - 10);
      return y1 > y0 ? { x: r.left, y: y0, width: r.width, height: y1 - y0, fullTop: r.top, fullHeight: r.height } : null;
    },
    [headingText, maxGap],
  );
}

const rail = (page, name) => page.getByRole('complementary', { name: 'Primary' }).getByRole('link', { name, exact: true });
const day = (page, date) => page.locator(`[data-day-cell="${date}"]`);
const cardIn = (page, date, text) => day(page, date).locator('[data-morph-id]', { hasText: text }).first();

/** Start a seeded segment on `url`, faded in from black (segments join on black or on the same page). */
async function begin(rec, base, url, { fadeIn = false, ready } = {}) {
  const { page } = rec;
  // before the camera rolls, be patient (a cold dev server compiles on first hit)
  page.setDefaultTimeout(45000);
  await gotoQuiet(page, base + url);
  if (ready) await ready(page);
  await settle(page, { quiet: 600, timeout: 30000 });
  page.setDefaultTimeout(8000);
  if (fadeIn) await rec.fade(true, 650);
  await rec.start();
  if (fadeIn) {
    await rec.wait(250);
    await rec.fade(false, 700);
  }
}

// 2 — the calendar: hover card, season scroll, drag to move, type to plan, key/intensity, zoom to week.
async function calendar(rec, base) {
  const { page } = rec;
  await begin(rec, base, '/calendar', {
    fadeIn: true,
    ready: async (p) => {
      await cardIn(p, '2026-11-27', 'Strength B').waitFor();
      // pre-load the weeks the tour scrolls back to, then return to today
      await p.mouse.move(820, 420);
      await p.mouse.wheel(0, -900);
      await settle(p, { quiet: 300 });
      await p.keyboard.press('t');
      await p.waitForTimeout(800);
      await p.mouse.move(rec.mouse.x, rec.mouse.y);
    },
  });
  rec.mark('calendar: overview + hover card');
  await rec.caption('The calendar', 'Each week in one row, with its phase, hours against plan, load and form.');
  await rec.hover(page.locator('a', { hasText: /^W47$/ }).first(), { ms: 1000, dy: 40 });
  await pause(rec, 1100);
  // hover a planned chip: the hover card shows what the one-line chip leaves out
  await rec.hover(cardIn(page, '2026-11-24', 'Tempo 3×15'), { ms: 1000 });
  await pause(rec, 2200);

  rec.mark('calendar: scroll back to the A-race');
  await rec.moveTo(820, 330, 600);
  await rec.caption('The whole season', 'Scroll back through the year — the A-race was 18 October.');
  await rec.scroll(-830, { ms: 2000 });
  await ready(rec, 200);
  const race = page.getByRole('link', { name: /Costa Brava Half Triathlon/ }).first();
  await rec.hover(race, { ms: 900 });
  await pause(rec, 1300);
  await rec.hover(page.locator('a', { hasText: /^W42$/ }).first(), { ms: 800, dy: 30 });
  await pause(rec, 900);

  rec.mark('calendar: back to today (T)');
  await rec.hover(page.getByRole('button', { name: /^Today/ }).first(), { ms: 700 }).catch(() => {});
  await rec.press('t', { after: 1000 });
  await ready(rec, 300);

  rec.mark('calendar: drag to move');
  await rec.caption('Plan by dragging', 'Move a session to another day — the week follows, and undo is one click away.');
  const strength = cardIn(page, '2026-11-27', 'Strength B');
  const thu = day(page, '2026-11-26');
  const tb = await thu.boundingBox();
  await rec.hover(strength, { ms: 800 });
  await pause(rec, 200);
  await rec.drag(strength, { x: tb.x + tb.width / 2, y: tb.y + tb.height - 30 }, { ms: 1000, hold: 120, settle: 700 });
  await cardIn(page, '2026-11-26', 'Strength B').waitFor({ timeout: 5000 });
  await rec.moveTo(tb.x + tb.width / 2 - 60, tb.y + tb.height + 50, 700);
  await pause(rec, 1000);

  rec.mark('calendar: type to plan');
  await rec.caption('Type to plan', 'Click a day and write the session the way you would say it.');
  const fri = day(page, '2026-11-27');
  const fb = await fri.boundingBox();
  await rec.moveTo(fb.x + fb.width / 2, fb.y + fb.height - 30, 800);
  await pause(rec, 300);
  await page.mouse.down();
  await rec.wait(60);
  await page.mouse.up();
  const composer = page.getByRole('textbox', { name: /Quick add on 2026-11-27/ });
  await composer.waitFor();
  await pause(rec, 400);
  await rec.type('run 45m easy @key', { delay: 55 });
  await pause(rec, 700);
  await rec.press('Enter', { label: '↵', after: 900 });
  await rec.press('Escape', { show: false, after: 200 });
  await rec.moveTo(fb.x + fb.width - 20, fb.y + fb.height + 30, 600);
  await pause(rec, 900);

  rec.mark('calendar: key + intensity');
  // top: the selection bar appears at the bottom
  await rec.caption('Mark what matters', 'Select a session, then K for key and 1–5 for intensity.', { pos: 'top', x: 780, maxWidth: 560 });
  const run = cardIn(page, '2026-12-02', 'Easy run 35');
  await rec.hover(run, { ms: 800 });
  await pause(rec, 150);
  // Ctrl-click selects without opening (Shift-click would also select the title text).
  await page.keyboard.down('Control');
  await page.mouse.down();
  await rec.wait(60);
  await page.mouse.up();
  await page.keyboard.up('Control');
  await pause(rec, 500);
  await rec.press('k', { after: 1000 });
  await rec.press('2', { after: 1200 });

  rec.mark('calendar: zoom to week');
  await rec.caption('');
  await rec.press('Escape', { show: false, after: 100 });
  await rec.click(page.getByRole('button', { name: 'Week', exact: true }), { ms: 800, after: 400 });
  await arrive(rec, /\/calendar\/week\//);
  await pause(rec, 1500);
  await rec.click(page.getByRole('button', { name: 'Month', exact: true }), { ms: 600, after: 400 });
  await arrive(rec, /\/calendar(\/month\/|$|\?)/);
  await pause(rec, 800);
}

// 3 — a planned structured workout as a page (card → page morph), then to the watch.
async function workout(rec, base) {
  const { page } = rec;
  await begin(rec, base, rec.prevUrl ?? '/calendar', { ready: (p) => cardIn(p, '2026-12-01', 'Track 6×800').waitFor() });
  rec.mark('workout: open card → page (morph)');
  const card = cardIn(page, '2026-12-01', 'Track 6×800');
  await rec.hover(card, { ms: 1000 });
  await pause(rec, 400);
  await rec.click(card, { ms: 200, after: 200 });
  await arrive(rec, /\/workouts\/wk_/);
  await rec.caption('Every workout is a page', 'Structure, targets in your own watts and paces, notes — no modals.');
  await pause(rec, 700);
  // trace the profile: the stride block, then the 800 m reps
  await optional('workout: trace profile', async () => {
    const prof = await chartAfter(page, 'Track 6×800', { maxGap: 600 });
    if (!prof) return;
    await rec.moveTo(prof.x + prof.width * 0.3, prof.y + prof.height * 0.5, 800);
    await rec.moveTo(prof.x + prof.width * 0.75, prof.y + prof.height * 0.4, 1300);
  });
  await pause(rec, 300);
  await optional('workout: step row', () => rec.hover(page.getByText(/800 m · 800 m @/).first(), { ms: 800 }));
  await pause(rec, 1000);

  rec.mark('workout: send to Garmin');
  await rec.caption('One click to your watch', 'Planned sessions go to Garmin as structured workouts, with your targets.');
  const send = page.getByRole('button', { name: 'Send to Garmin' });
  await rec.hover(send, { ms: 900 });
  await pause(rec, 300);
  await rec.click(send, { ms: 100, after: 300 });
  await page.getByText(/On your Garmin/).first().waitFor({ timeout: 15000 });
  await pause(rec, 1600);

  rec.mark('workout: back to calendar (morph back)');
  await rec.caption('');
  await rec.click(page.getByRole('button', { name: 'Back' }), { after: 300 });
  await arrive(rec, /\/calendar/);
  await pause(rec, 1000);
}

// 4 — new workout in the builder: text syntax ↔ visual steps, live profile and totals.
async function builder(rec, base) {
  const { page } = rec;
  await begin(rec, base, rec.prevUrl ?? '/calendar', { ready: (p) => cardIn(p, '2026-11-26', 'Progression').waitFor() });
  rec.mark('builder: new workout from a day');
  const thu = day(page, '2026-11-26');
  const tb = await thu.boundingBox();
  // approach along the date header so the card's hover toolbar never covers the "+"
  await rec.moveTo(tb.x + tb.width / 2, tb.y - 30, 900);
  await rec.moveTo(tb.x + 40, tb.y + 12, 500);
  await pause(rec, 200);
  await rec.click(page.getByRole('link', { name: 'New workout on 2026-11-26' }), { ms: 600, after: 300 });
  await arrive(rec, /\/workouts\/new/);
  await rec.caption('Build it your way', 'Visual steps and a fast text syntax, always in sync — ride, run, swim, row, strength.');
  await pause(rec, 600);
  await rec.click(page.getByRole('radio', { name: 'Ride' }), { after: 500 });
  const text = page.getByRole('textbox', { name: 'Workout text' });
  await text.waitFor();
  await pause(rec, 400);
  // bring profile, steps, text editor and totals into one frame
  const graph = page.getByText('%FTP').first();
  const gy = (await graph.boundingBox()).y;
  await rec.moveTo(1240, 600, 600);
  await rec.scroll(gy - 72, { ms: 900 });
  await pause(rec, 300);

  rec.mark('builder: typing the text syntax');
  await rec.click(text, { after: 200 });
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await pause(rec, 300);
  const lines = ['- 15m ramp 50-75%', '4x', '  - 8m 95-100%', '  - 4m 55%', '- 10m z1'];
  for (const [i, line] of lines.entries()) {
    await rec.type(line, { delay: 40 });
    if (i < lines.length - 1) await page.keyboard.press('Enter');
    await rec.wait(380);
  }
  await pause(rec, 900);

  rec.mark('builder: bump the repeat count');
  const more = page.getByRole('button', { name: 'More repeats' });
  await rec.hover(more, { ms: 1000 });
  await pause(rec, 300);
  await rec.click(more, { ms: 100, after: 900 });
  await pause(rec, 800);

  rec.mark('builder: key + note + save');
  await rec.caption('');
  await rec.moveTo(800, 600, 500);
  await rec.scroll(380, { ms: 900 });
  await pause(rec, 300);
  await rec.click(page.getByRole('button', { name: 'Mark as key workout' }), { after: 500 });
  const note = page.getByPlaceholder(/Intent for the day/);
  await rec.click(note, { after: 200 });
  await rec.type('Hold the last rep.', { delay: 40 });
  await pause(rec, 700);
  await rec.click(page.getByRole('button', { name: /^Save/ }).filter({ hasText: /^Save(Ctrl|⌘)?/ }).last(), { after: 300 });
  await arrive(rec, /\/workouts\/wk_/);
  await pause(rec, 1800);
}

// 5 + 6 — Today (session, freshness, check-in, ten-second log), activities, then one ride analysed.
async function today(rec, base) {
  const { page } = rec;
  await begin(rec, base, rec.prevUrl ?? '/calendar');
  rec.mark('today');
  await rec.click(rail(page, 'Today'), { ms: 800, after: 200 });
  await arrive(rec, /\/today/);
  await rec.caption('Today', 'What to do today, how fresh you are, and a ten-second log of how it felt.');
  await optional('today: session card', async () => {
    const card = await boxOf(page.locator('main [data-morph-id]'));
    if (card) {
      await rec.moveTo(...Object.values(at(card, 0.35, 0.4)), 900);
      await pause(rec, 900);
    }
  });
  await optional('today: form block', async () => {
    const form = await boxOf(page.getByText('Form', { exact: true }));
    if (form) {
      await rec.moveTo(form.x + 30, form.y + 40, 900);
      await pause(rec, 900);
    }
  });

  rec.mark('today: morning check-in');
  await optional('today: check-in', async () => {
    // feel first; soreness unfolds once feel is set (skip a rating that is already selected)
    const checked = async (l) => (await l.getAttribute('aria-checked').catch(() => null)) === 'true';
    const fresh = page.getByRole('radio', { name: '4 — Fresh' });
    if (!(await checked(fresh))) await rec.click(fresh, { ms: 800, after: 600 });
    const sore = page.getByRole('radio', { name: '2 — A little' });
    await sore.waitFor({ state: 'visible', timeout: 3000 });
    if (!(await checked(sore))) await rec.click(sore, { ms: 600, after: 700 });
  });

  rec.mark('today: log RPE + feel');
  await optional('today: log it', async () => {
    const logIt = page.getByRole('button', { name: 'Log it' });
    if (!(await logIt.count())) return;
    await rec.click(logIt.first(), { ms: 800, after: 500 });
    await rec.click(page.getByRole('radio', { name: '5, Moderate' }).first(), { ms: 700, after: 400 });
    await rec.click(page.getByRole('radio', { name: '4 — Good' }).first(), { ms: 600, after: 1000 });
  });

  rec.mark('activities: multi-sport');
  await rec.caption('Ride, run, swim, row, lift', 'Every sport in one list, with the numbers that matter for each.');
  await rec.click(rail(page, 'Activities'), { ms: 800, after: 200 });
  await arrive(rec, /\/activities(\?|$)/);
  await pause(rec, 400);
  const sportTab = (name) => page.getByRole('tab', { name, exact: true });
  await optional('activities: swim filter', async () => {
    await rec.click(sportTab('Swim'), { after: 300 });
    await ready(rec, 150);
    const row = await boxOf(page.getByRole('row').nth(1));
    if (row) await rec.moveTo(row.x + row.width * 0.8, row.y + row.height / 2, 800);
    await pause(rec, 900);
    await rec.click(sportTab('All'), { after: 300 });
    await ready(rec, 150);
  });

  rec.mark('activity: open a long ride (morph)');
  const ride = page.getByRole('row', { name: /Long ride 1h55 — Coast loop/ }).or(page.getByRole('link', { name: /Long ride 1h55 — Coast loop/ })).first();
  await rec.click(ride, { ms: 900, after: 100 });
  await arrive(rec, /\/activities\/act_/, { quiet: 300 });
  const top = { pos: 'top', x: 1100, maxWidth: 640 };
  const tab = (name) => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name, exact: true });
  await rec.caption('Every session, understood', 'Power, heart rate, pace, zones, peaks — and how it compared with the plan.', top);
  await pause(rec, 1600);

  // Map (if the activity page has one): zoom and pan the route.
  rec.mark('activity: map + streams');
  await optional('activity: map', async () => {
    const map = page.locator('.maplibregl-map, [data-activity-map], main [role=application]').first();
    if (!(await map.count())) return;
    // only an interactive (canvas) map gets panned — dragging a placeholder would select page text
    if (!(await map.locator('canvas').count())) return;
    await scrollToLoc(rec, map, 120, 900);
    const mb = await boxOf(map);
    if (!mb) return;
    const c = at(mb);
    await rec.moveTo(c.x, c.y, 800);
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, -120);
      await rec.wait(90);
    }
    await pause(rec, 500);
    await rec.drag(c, { x: c.x - mb.width * 0.18, y: c.y + mb.height * 0.1 }, { ms: 900, hold: 80, settle: 400 });
    await pause(rec, 500);
  });

  // Streams: sweep the cursor along the chart (the dot traces the route), then drag-select a range.
  await optional('activity: streams', async () => {
    await rec.click(tab('Charts'), { ms: 700, after: 900 });
    await ready(rec, 150);
    let chart = await chartAfter(page, 'Charts', { maxGap: 1400 });
    if (!chart) return;
    if (chart.y + chart.height > H - 40 || chart.fullTop < 60) {
      await rec.scroll(chart.fullTop - 220, { ms: 700 });
      await ready(rec, 120);
      chart = await chartAfter(page, 'Charts', { maxGap: 1400 });
      if (!chart) return;
    }
    // the first track (power on a ride) sits in the top part of the canvas
    const y = Math.min(chart.fullTop + chart.fullHeight * 0.12, chart.y + chart.height - 20);
    await rec.moveTo(chart.x + 40, y, 600);
    await rec.moveTo(chart.x + chart.width - 30, y, 3200);
    rec.mark('activity: drag-select a range');
    await rec.drag({ x: chart.x + chart.width * 0.55, y }, { x: chart.x + chart.width * 0.68, y }, { ms: 1000, hold: 80, settle: 400 });
    await pause(rec, 1500);
  });

  rec.mark('activity: laps, zones, peaks');
  for (const name of ['Laps', 'Zones', 'Peaks']) {
    await optional(`activity: ${name}`, async () => {
      if (!(await tab(name).count())) return;
      await rec.click(tab(name), { ms: 700, after: 600 });
      await ready(rec, 120);
      await rec.moveTo(W * 0.55, H * 0.6, 700);
      await pause(rec, 700);
    });
  }
  await optional('activity: compared with last time', async () => {
    const cmp = page.getByRole('heading', { name: /Plan vs actual|Compared with last time/ });
    if (!(await cmp.count())) return;
    await scrollToLoc(rec, cmp, 120, 900);
    await pause(rec, 1300);
  });
}

// 7 — Trends and the weekly review.
async function trends(rec, base) {
  const { page } = rec;
  const heading = (name) => page.getByRole('heading', { name, exact: true });
  await begin(rec, base, rec.prevUrl ?? '/activities');
  rec.mark('trends: this week');
  await rec.click(rail(page, 'Trends'), { ms: 800, after: 200 });
  await arrive(rec, /\/trends/);
  await rec.caption('Progress at a glance', 'This week against last week at the same weekday — readable in two seconds.');
  await optional('trends: stat row', async () => {
    const hours = await boxOf(page.getByText('Hours', { exact: true }));
    if (hours) await rec.moveTo(hours.x + 40, hours.y + 40, 800);
    await pause(rec, 700);
    const load = await boxOf(page.getByText('Load', { exact: true }));
    if (load) await rec.moveTo(load.x + 40, load.y + 40, 600);
    await pause(rec, 800);
  });

  // Week-over-week first, at 12 weeks.
  rec.mark('trends: week-over-week + consistency');
  await optional('trends: week-over-week', async () => {
    await rec.moveTo(W * 0.56, H * 0.6, 300);
    await scrollToLoc(rec, heading('Week-over-week progression'), 90, 1300);
    await rec.caption('Week over week', 'One plain sentence, the ramp against a caution line, and every day of the year.');
    const sentence = await boxOf(page.getByText(/last week/).filter({ hasText: /caution|rose|fell|held|dropped/ }));
    if (sentence) await rec.moveTo(sentence.x + Math.min(sentence.width, 600) * 0.7, sentence.y + sentence.height / 2, 800);
    await pause(rec, 1400);
    await scrollToLoc(rec, heading('Consistency'), 300, 900);
    const cons = await chartAfter(page, 'Consistency');
    if (cons) await rec.moveTo(...Object.values(at(cons, 0.85, 0.5)), 800);
    await pause(rec, 800);
  });

  rec.mark('trends: fitness · fatigue · form, 12W → 1Y');
  await rec.caption('Fitness, fatigue and form', 'A year of training load, with the plan projected to race day.');
  await optional('trends: fitness chart', async () => {
    await rec.moveTo(W * 0.56, H * 0.5, 300);
    await scrollToLoc(rec, page.getByRole('link', { name: 'Fitness · Fatigue · Form' }), 80, 1300);
    await rec.click(page.getByRole('button', { name: '1Y', exact: true }), { ms: 800, after: 900 });
    await ready(rec, 150);
    const fff = await chartAfter(page, 'Fitness · Fatigue · Form');
    if (fff) {
      await rec.moveTo(fff.x + 40, fff.y + fff.height * 0.35, 600);
      await rec.moveTo(fff.x + fff.width * 0.85, fff.y + fff.height * 0.3, 2800);
    }
    await pause(rec, 400);
  });

  rec.mark('trends: weekly volume → week review');
  await rec.caption('Weekly volume', 'Hours by sport against your four-week average — click a week to review it.');
  await optional('trends: weekly volume', async () => {
    await rec.moveTo(W * 0.56, H * 0.5, 300);
    await scrollToLoc(rec, page.getByText('Weekly volume', { exact: true }), 80, 1000);
    // the Hours/Load/Distance switch nearest below the Weekly volume heading
    const loadBtn = await page.evaluate(() => {
      const h = [...document.querySelectorAll('h1,h2,h3,h4')].find((e) => e.textContent?.trim().startsWith('Weekly volume'));
      if (!h) return null;
      const top = h.getBoundingClientRect().top;
      const b = [...document.querySelectorAll('main button')].filter((x) => x.textContent?.trim() === 'Load').map((x) => x.getBoundingClientRect()).filter((r) => r.top > top - 40).sort((a, c) => a.top - c.top)[0];
      return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
    });
    if (loadBtn) {
      await rec.moveTo(loadBtn.x, loadBtn.y, 800);
      await pause(rec, 150);
      await page.mouse.down();
      await rec.wait(60);
      await page.mouse.up();
      await pause(rec, 1300);
    }
  });
  // open this week's review: the "This week" bar in the volume chart, else the "Week review" link
  const bar = await page.evaluate(() => {
    const h = [...document.querySelectorAll('h1,h2,h3,h4')].find((e) => e.textContent?.trim().startsWith('Weekly volume'));
    const top = h ? h.getBoundingClientRect().top : 0;
    const lbl = [...document.querySelectorAll('main *')]
      .filter((e) => e.childElementCount === 0 && e.textContent?.trim() === 'This week')
      .map((e) => e.getBoundingClientRect())
      .filter((r) => r.top > top && r.bottom < innerHeight)
      .sort((a, b) => a.top - b.top)[0];
    return lbl ? { x: lbl.x + lbl.width / 2, y: lbl.y - 50 } : null;
  });
  if (bar) {
    await rec.moveTo(bar.x, bar.y, 800);
    await pause(rec, 250);
    await page.mouse.down();
    await rec.wait(60);
    await page.mouse.up();
    await page.waitForURL(/\/week\//, { timeout: 3000 }).catch(() => {});
  }
  if (!/\/week\//.test(page.url())) {
    await rec.scroll(-8000, { ms: 900 });
    await rec.click(page.getByRole('link', { name: /Week review/ }).first(), { ms: 800, after: 200 });
  }
  await arrive(rec, /\/week\//);
  await rec.caption('A weekly ritual', 'Review the week, reflect, and roll the plan forward with progression.');
  await pause(rec, 1100);
  await rec.moveTo(W * 0.56, H * 0.55, 300);
  await optional('week: reflection', async () => {
    await scrollToLoc(rec, page.getByRole('heading', { name: 'Reflection' }), 90, 1500);
    await pause(rec, 700);
  });
  await optional('week: progression slider', async () => {
    await scrollToLoc(rec, page.getByRole('heading', { name: /^Plan week/ }), 160, 900);
    rec.mark('weekly review: progression slider → +5%');
    const tb = await page.locator('input[type=range]').first().boundingBox();
    const cx = tb.x + tb.width / 2;
    const cy = tb.y + tb.height / 2;
    await rec.moveTo(cx, cy, 700);
    await pause(rec, 150);
    await page.mouse.down();
    // move right until the copy button reads "+5 %"
    const label = () => page.evaluate(() => document.body.innerText.match(/Copy to W\d+ at ([+−-]?\d+)\s*%/)?.[1] ?? '');
    let x = cx;
    for (let i = 0; i < 80; i++) {
      x += 2;
      await page.mouse.move(x, cy);
      await rec.wait(26);
      if (Number((await label()).replace('−', '-')) >= 5) break;
    }
    await page.mouse.up();
    await rec.placeCursor(x, cy);
    await pause(rec, 900);
    await rec.moveTo(x + 120, cy + 110, 600);
    await pause(rec, 900);
  });
}

// 8–11 — library, ⌘K search → the next race → season, Garmin settings, accent picker, end card.
async function extras(rec, base) {
  const { page } = rec;
  await begin(rec, base, rec.prevUrl ?? '/week/2026-W47');
  rec.mark('library');
  await rec.click(rail(page, 'Library'), { ms: 800, after: 200 });
  await arrive(rec, /\/library/);
  await rec.caption('A library', 'Your templates by sport and intensity, ready to drop on any day.');
  await optional('library: run filter', async () => {
    await rec.click(page.getByRole('radio', { name: 'Run', exact: true }).first(), { ms: 700, after: 700 });
    await ready(rec, 200);
    const first = await boxOf(page.getByRole('button', { name: 'Schedule' }));
    if (first) await rec.moveTo(first.x - 120, first.y - 50, 700);
    await pause(rec, 900);
  });

  rec.mark('command palette: search "next race"');
  await rec.caption('Everything is one keystroke away', 'Pages, workouts, races and actions from one box — Ctrl/⌘ K.');
  await rec.press('Control+k', { after: 500 });
  await rec.type('next race', { delay: 80 });
  await page.getByRole('option').first().waitFor({ timeout: 8000 }).catch(() => {});
  await pause(rec, 900);
  await rec.press('Enter', { label: '↵', after: 200 });
  await arrive(rec, /\/events\/|\/workouts\/|\/calendar\//);
  await pause(rec, 1200);

  rec.mark('season');
  await optional('season', async () => {
    const season = page.getByRole('link', { name: 'Season', exact: true }).first();
    if (!(await season.count())) return;
    await rec.click(season, { ms: 700, after: 0 });
    void rec.caption('The season', 'Phases, races and weekly load targets for the whole year.');
    await arrive(rec, /\/season/);
    const chart = await chartAfter(page, 'Season', { maxGap: 600 });
    if (chart) {
      await rec.moveTo(chart.x + chart.width * 0.4, chart.y + chart.height * 0.5, 700);
      await rec.moveTo(chart.x + chart.width * 0.85, chart.y + chart.height * 0.5, 1300);
    }
    await pause(rec, 600);
  });

  rec.mark('settings: Garmin');
  await rec.caption('Your Garmin, your data', 'Official Personal API for reading, encrypted tokens, sync every 30 minutes.');
  await rec.press('Control+k', { after: 400 });
  await rec.type('garmin', { delay: 80 });
  await pause(rec, 500);
  await rec.press('Enter', { label: '↵', after: 200 });
  await arrive(rec, /\/settings\/garmin/);
  await pause(rec, 600);
  await optional('garmin: sync now', async () => {
    await rec.click(page.getByRole('button', { name: 'Sync now' }), { ms: 800, after: 400 });
    await page.waitForFunction(() => !/Syncing…/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
    await pause(rec, 1500);
  });

  rec.mark('settings: accent');
  await rec.caption('One accent, your choice', 'Quiet neutrals carry the interface; pick the one colour that marks what matters.');
  await rec.click(page.getByRole('link', { name: 'Appearance', exact: true }), { ms: 800, after: 200 });
  await arrive(rec, /\/settings\/appearance/);
  await pause(rec, 500);
  await optional('accent picker', async () => {
    for (const name of ['Green', 'Rose', 'Blue']) {
      await rec.click(page.getByRole('radio', { name, exact: true }), { ms: 700, after: 1100 });
    }
  });
  // the tour must leave the accent on Blue
  await page.evaluate(() => document.documentElement.dataset.accent).then((a) => a && a !== 'blue' && console.warn('  ! accent left on', a));
  await pause(rec, 800);

  rec.mark('end card');
  await rec.caption('');
  await rec.titleCard('cadence', 'Quiet by design.', 'Plan, sync and progress in one place · one Cloudflare Worker + D1 · yours alone', 3600, { keep: true });
}

// ───────────────────────────── runner ─────────────────────────────

const WARM_ROUTES = ['/calendar', '/today', '/trends', '/activities', '/library', '/season', '/settings/garmin', '/settings/zones', '/week/2026-W47', '/workouts/new?date=2026-11-26', '/workouts/wk_d20261201_1'];

async function recordSegment(seg) {
  const base = seg.server === 'fresh' ? args.fresh : args.base;
  let mouse;
  const idx = SEGMENTS.indexOf(seg);
  const prev = idx > 0 ? path.join(SEG_DIR, `${SEGMENTS[idx - 1].name}.json`) : null;
  let prevUrl;
  if (prev && existsSync(prev)) ({ mouse, url: prevUrl } = JSON.parse(await readFile(prev, 'utf8')));
  const segOut = path.join(OUT, 'work', seg.name);
  await mkdir(segOut, { recursive: true });
  const rec = await createRecorder({ outDir: segOut, width: W, height: H, timezoneId: TZ, locale: 'en-GB', headless: !args.headed, mouse });
  // fail fast: a missing element skips an optional sub-beat in seconds instead of stalling the take
  rec.page.setDefaultTimeout(8000);
  rec.page.setDefaultNavigationTimeout(60000);
  rec.captionDefaults({ x: CX, maxWidth: 700 });
  applyPacing(rec);
  // where the previous segment ended (path only), so this one can start on the same frame
  rec.prevUrl = prevUrl && seg.server === 'base' ? prevUrl : undefined;
  const t0 = Date.now();
  console.log(`▶ ${seg.name} (${base})`);
  try {
    if (seg.server === 'base') {
      await signIn(rec.context, base);
      await warm(rec.page, base, WARM_ROUTES);
    }
    await seg.fn(rec, base);
    const endUrl = new URL(rec.page.url());
    await rec.stop();
    const file = path.join(SEG_DIR, `${seg.name}.mp4`);
    const info = await rec.encode(file, { crf: Number(args.crf) });
    await writeFile(path.join(SEG_DIR, `${seg.name}.json`), JSON.stringify({ seconds: info.seconds, marks: rec.marks, mouse: rec.mouse, url: endUrl.pathname + endUrl.search }, null, 2));
    console.log(`✓ ${seg.name}: ${info.seconds.toFixed(1)} s, ${info.frames} frames (${info.capturedFps.toFixed(0)} fps captured) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  } catch (e) {
    await rec.page.screenshot({ path: path.join(segOut, 'failure.png') }).catch(() => {});
    throw new Error(`segment ${seg.name} failed: ${e.message}`, { cause: e });
  } finally {
    await rec.close();
  }
}

async function join() {
  const parts = SEGMENTS.map((s) => path.join(SEG_DIR, `${s.name}.mp4`)).filter((f) => existsSync(f));
  const list = path.join(OUT, 'work', 'segments.txt');
  await writeFile(list, parts.map((f) => `file '${f}'`).join('\n'));
  const file = path.join(OUT, 'cadence-walkthrough.mp4');
  await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', file], { maxBuffer: 1 << 26 });
  // beat list with absolute timestamps
  let offset = 0;
  const beats = [];
  for (const s of SEGMENTS) {
    const j = path.join(SEG_DIR, `${s.name}.json`);
    if (!existsSync(path.join(SEG_DIR, `${s.name}.mp4`)) || !existsSync(j)) continue;
    const meta = JSON.parse(await readFile(j, 'utf8'));
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(SEG_DIR, `${s.name}.mp4`)]);
    for (const m of meta.marks) beats.push({ t: Math.round((offset + m.t) * 10) / 10, segment: s.name, label: m.label });
    offset += Number(stdout.trim());
  }
  await writeFile(path.join(OUT, 'beats.json'), JSON.stringify(beats, null, 2));
  console.log(`■ ${file} — ${parts.length} segments, ${offset.toFixed(1)} s`);
  for (const b of beats) console.log(`  ${String(Math.floor(b.t / 60))}:${String(Math.floor(b.t % 60)).padStart(2, '0')}  ${b.label}`);
}

await mkdir(SEG_DIR, { recursive: true });
const only = args.only ? new Set(args.only.split(',')) : null;
for (const seg of SEGMENTS) {
  if (only && !only.has(seg.name)) continue;
  await recordSegment(seg);
}
if (!args['no-join']) await join();
