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

/** Wait for a URL (regex) after an in-app navigation, then for the page to settle. */
async function arrive(page, re, opts) {
  await page.waitForURL(re, { timeout: 15000 });
  await settle(page, opts);
}

async function signIn(context, base) {
  const res = await context.request.post(`${base}/api/auth/login`, { data: { passphrase: PASS } });
  if (!res.ok()) throw new Error(`login failed: ${res.status()} ${await res.text()}`);
}

/** Visit routes once before recording so Vite has compiled every lazy chunk (no first-hit skeletons on camera). */
async function warm(page, base, routes) {
  for (const r of routes) {
    await page.goto(base + r, { waitUntil: 'networkidle' }).catch(() => {});
    await settle(page, { timeout: 20000, quiet: 100 });
  }
}

const pause = (rec, ms = 1200) => rec.wait(ms);

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
  await page.getByRole('heading', { name: 'Create your passphrase' }).waitFor();
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
  await rec.click(demoBtn, { after: 200 });
  const importBtn = page.getByRole('button', { name: /^Import .* of history$/ });
  await importBtn.waitFor({ timeout: 20000 });
  await pause(rec, 500);
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
  await page.getByRole('heading', { name: 'Your thresholds' }).waitFor();
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'Finish');
    return b && !b.disabled;
  }, null, { timeout: 20000 });
  await settle(page, { quiet: 300 });
  await rec.hover(page.getByText(/^FTP$/).first(), { ms: 700, dy: 18 }).catch(() => {});
  await pause(rec, 700);
  await rec.scroll(360, { ms: 700 });
  await pause(rec, 250);
  await rec.click(page.getByRole('button', { name: 'Finish' }), { after: 200 });

  rec.mark('onboarding: calendar appears');
  // (The "You're set" finale is skipped by the welcome gate — see report; the app lands straight on the calendar.)
  await page.waitForURL(/\/calendar|\/today/, { timeout: 20000 });
  await rec.caption('');
  await settle(page, { quiet: 200 });
  await rec.moveTo(W * 0.6, H * 0.42, 1000);
  await pause(rec, 1200);
  await rec.cursor(false);
  await rec.fade(true, 900);
}

const day = (page, date) => page.locator(`[data-day-cell="${date}"]`);
const cardIn = (page, date, text) => day(page, date).locator('[data-morph-id]', { hasText: text }).first();

/** Start a seeded segment on `url`, faded in from black (segments join on black or on the same page). */
async function begin(rec, base, url, { fadeIn = false, ready } = {}) {
  const { page } = rec;
  await page.goto(base + url, { waitUntil: 'networkidle' });
  if (ready) await ready(page);
  await settle(page, { quiet: 600 });
  if (fadeIn) await rec.fade(true, 650);
  await rec.start();
  if (fadeIn) {
    await rec.wait(250);
    await rec.fade(false, 700);
  }
}

// 2 — the calendar: season scroll, drag to move, type to plan, key/intensity, zoom to week.
async function calendar(rec, base) {
  const { page } = rec;
  await begin(rec, base, '/calendar', { fadeIn: true, ready: (p) => cardIn(p, '2026-11-27', 'Strength B').waitFor() });
  rec.mark('calendar: overview');
  await rec.caption('The calendar', 'Every week in one row: done vs planned, load, fitness and form, week-over-week.');
  const summary = page.locator('a', { hasText: /^W47$/ }).first();
  await rec.hover(summary, { ms: 1000, dx: 40, dy: 50 });
  await pause(rec, 700);
  await rec.moveTo(1460, 310, 800);
  await pause(rec, 1000);

  rec.mark('calendar: scroll back to the A-race');
  await rec.moveTo(820, 420, 700);
  await rec.caption('The whole season', 'Training phases down the side, races as banners — the A-race was 18 October.');
  await rec.scroll(-830, { ms: 2200, steps: 55 });
  await settle(page, { quiet: 200 });
  const race = page.getByRole('link', { name: /Costa Brava Half Triathlon/ }).first();
  await rec.hover(race, { ms: 800 });
  await pause(rec, 1300);
  await rec.moveTo(268, 260, 800); // the phase band
  await pause(rec, 600);

  rec.mark('calendar: back to today (T)');
  await rec.moveTo(1416, 26, 700);
  await rec.press('t', { after: 1000 });
  await settle(page, { quiet: 300 });

  rec.mark('calendar: drag to move');
  await rec.caption('Plan by dragging', 'Move a session to another day — the week totals follow, and undo is one click away.');
  const strength = cardIn(page, '2026-11-27', 'Strength B');
  const thu = day(page, '2026-11-26');
  const tb = await thu.boundingBox();
  await rec.hover(strength, { ms: 800 });
  await pause(rec, 300);
  await rec.drag(strength, { x: tb.x + tb.width / 2, y: tb.y + tb.height - 40 }, { ms: 1000, settle: 700 });
  await cardIn(page, '2026-11-26', 'Strength B').waitFor({ timeout: 5000 });
  await rec.moveTo(tb.x + tb.width / 2 - 60, tb.y + tb.height + 60, 700);
  await pause(rec, 1000);

  rec.mark('calendar: type to plan');
  await rec.caption('Type to plan', 'Click a day and write the session the way you would say it.');
  const fri = day(page, '2026-11-27');
  const fb = await fri.boundingBox();
  await rec.moveTo(fb.x + fb.width / 2, fb.y + 70, 800);
  await pause(rec, 300);
  await page.mouse.down();
  await rec.wait(60);
  await page.mouse.up();
  const composer = page.getByRole('textbox', { name: /Quick add on 2026-11-27/ });
  await composer.waitFor();
  await pause(rec, 400);
  await rec.type('run 45m easy @key', { delay: 65 });
  await pause(rec, 700);
  await rec.press('Enter', { label: '↵', after: 700 });
  await cardIn(page, '2026-11-27', /Easy|Run|run/).waitFor({ timeout: 5000 }).catch(() => {});
  await rec.press('Escape', { show: false, after: 300 });
  await rec.moveTo(fb.x + fb.width - 20, fb.y + fb.height + 30, 600);
  await pause(rec, 900);

  rec.mark('calendar: key + intensity');
  await rec.caption('Mark what matters', 'Select a session, then K for key and 1–5 for intensity.');
  const ride = cardIn(page, '2026-11-28', 'Rocacorba');
  await rec.hover(ride, { ms: 800 });
  await pause(rec, 250);
  // Ctrl-click selects without opening (Shift-click would also select the title text).
  await page.keyboard.down('Control');
  await page.mouse.down();
  await rec.wait(60);
  await page.mouse.up();
  await page.keyboard.up('Control');
  await pause(rec, 500);
  await rec.press('k', { after: 1000 });
  await rec.press('4', { after: 1200 });

  rec.mark('calendar: zoom to week');
  await rec.caption('');
  await rec.moveTo(1256, 26, 800);
  await pause(rec, 200);
  await rec.click(page.getByRole('button', { name: 'Week', exact: true }), { after: 400 });
  await arrive(page, /\/calendar\/week\//);
  await pause(rec, 1800);
  await rec.moveTo(1200, 26, 600);
  await rec.click(page.getByRole('button', { name: 'Month', exact: true }), { after: 400 });
  await arrive(page, /\/calendar(\/month\/|$|\?)/);
  await pause(rec, 1200);
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
  await arrive(page, /\/workouts\/wk_/);
  await rec.caption('Every workout is a page', 'Structure, targets in your own watts and paces, notes — no modals.');
  await pause(rec, 700);
  // trace the profile: the stride block, then the 800 m reps
  await rec.moveTo(690, 360, 900);
  await pause(rec, 500);
  for (const x of [770, 860, 950, 1040]) {
    await rec.moveTo(x, 330, 420);
    await rec.wait(180);
  }
  await pause(rec, 500);
  await rec.hover(page.getByText(/800 m · 800 m @/).first(), { ms: 800 });
  await pause(rec, 1300);

  rec.mark('workout: send to Garmin');
  await rec.caption('One click to your watch', 'Planned sessions go to Garmin as structured workouts, with your targets.');
  const send = page.getByRole('button', { name: 'Send to Garmin' });
  await rec.hover(send, { ms: 900 });
  await pause(rec, 300);
  await rec.click(send, { ms: 100, after: 300 });
  await page.getByText(/On your Garmin/).first().waitFor({ timeout: 15000 });
  await pause(rec, 2000);

  rec.mark('workout: back to calendar (morph back)');
  await rec.caption('');
  await rec.click(page.getByRole('button', { name: 'Back' }), { after: 300 });
  await arrive(page, /\/calendar/);
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
  await arrive(page, /\/workouts\/new/);
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
    await rec.type(line, { delay: 48 });
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
  const note = page.getByRole('textbox', { name: /Intent for the day/ });
  await rec.click(note, { after: 200 });
  await rec.type('Fresh legs after the long ride. Hold the last rep.', { delay: 32 });
  await pause(rec, 700);
  await rec.click(page.getByRole('button', { name: /^Save/ }).filter({ hasText: /^Save(Ctrl|⌘)?/ }).last(), { after: 300 });
  await arrive(page, /\/workouts\/wk_/);
  await pause(rec, 1800);
}

// 5 + 6 — Today (readiness, check-in, ten-second log), then the long ride, analysed.
async function today(rec, base) {
  const { page } = rec;
  await begin(rec, base, rec.prevUrl ?? '/calendar');
  rec.mark('today');
  await rec.click(page.getByRole('link', { name: 'Today', exact: true }), { ms: 900, after: 300 });
  await arrive(page, /\/today/);
  await rec.caption('Today', 'Readiness, the plan, and a ten-second log of how it felt.');
  await pause(rec, 500);
  await rec.moveTo(516, 320, 900); // form dial
  await pause(rec, 1000);
  await rec.moveTo(860, 285, 800); // HRV
  await pause(rec, 500);
  await rec.moveTo(1380, 285, 900); // readiness
  await pause(rec, 700);

  rec.mark('today: morning check-in');
  await rec.click(page.getByRole('radio', { name: '4 — Fresh' }), { ms: 900, after: 500 });
  await rec.click(page.getByRole('radio', { name: '2 — A little' }), { ms: 600, after: 900 });

  rec.mark('today: log RPE + feel');
  await rec.moveTo(760, 600, 500);
  await rec.scroll(640, { ms: 1100 });
  await pause(rec, 300);
  const log = page.locator('section, div').filter({ has: page.getByRole('link', { name: 'UT2 35′ r20' }) }).last();
  await rec.click(log.getByRole('radio', { name: '5, Moderate' }).first(), { ms: 900, after: 500 });
  await rec.click(log.getByRole('radio', { name: '4 — Good' }).first(), { ms: 700, after: 1200 });
  await rec.moveTo(760, 300, 500);
  await rec.scroll(-640, { ms: 1000 });
  await pause(rec, 400);

  rec.mark('activity: open the long ride (morph)');
  const session = page.getByRole('link', { name: /Long ride 2h05 — Gavarres loop/ }).first();
  await rec.hover(session, { ms: 900 });
  await pause(rec, 300);
  await rec.click(session, { ms: 100, after: 200 });
  await arrive(page, /\/activities\/act_/, { quiet: 400 });
  const top = { pos: 'top', x: 1100, maxWidth: 640 };
  await rec.caption('Every session, understood', 'Power, heart rate, pace, zones, peaks — and how it compared with the plan.', top);
  await pause(rec, 1800);

  rec.mark('activity: streams + route');
  await rec.click(page.getByRole('button', { name: 'Charts', exact: true }), { ms: 800, after: 1100 });
  await settle(page, { quiet: 200 });
  const power = page.getByText('POWER', { exact: true }).last();
  const pb = await power.boundingBox();
  const y = pb.y + 50;
  await rec.moveTo(470, y, 700);
  await rec.moveTo(1380, y, 3800);
  await pause(rec, 400);

  rec.mark('activity: drag-select a range');
  await rec.moveTo(1000, y + 20, 700);
  await rec.drag({ x: 1000, y: y + 20 }, { x: 1150, y: y + 20 }, { ms: 1200, hold: 80, settle: 600 });
  await pause(rec, 1800);

  rec.mark('activity: laps, zones, peaks, plan vs actual');
  await rec.click(page.getByRole('button', { name: 'Laps', exact: true }), { ms: 800, after: 1000 });
  await rec.moveTo(700, 470, 700);
  await rec.moveTo(700, 710, 1400);
  await pause(rec, 500);
  await rec.click(page.getByRole('button', { name: 'Zones', exact: true }), { ms: 800, after: 1100 });
  await rec.moveTo(800, 700, 900);
  await rec.moveTo(980, 700, 900);
  await pause(rec, 700);
  await rec.scroll(700, { ms: 1100 });
  await pause(rec, 1600);

  rec.mark('activities: multi-sport');
  await rec.caption('Ride, run, swim, row, lift', 'Every sport in one list — swim pace per 100 m, strength sets and volume.');
  await rec.click(page.getByRole('link', { name: 'Activities', exact: true }), { ms: 900, after: 300 });
  await arrive(page, /\/activities(\?|$)/);
  await pause(rec, 600);
  await rec.click(page.getByRole('tab', { name: 'Swim' }).or(page.getByRole('button', { name: 'Swim', exact: true })).first(), { after: 600 });
  await settle(page, { quiet: 300 });
  await pause(rec, 1200);
  await rec.click(page.getByRole('tab', { name: 'Strength' }).or(page.getByRole('button', { name: 'Strength', exact: true })).first(), { after: 600 });
  await settle(page, { quiet: 300 });
  await pause(rec, 700);
  const lift = page.getByRole('row').filter({ hasText: /strength/i }).first();
  await rec.click(lift, { ms: 800, after: 300 });
  await arrive(page, /\/activities\/act_/, { quiet: 400 });
  await pause(rec, 1200);
  await rec.moveTo(800, 600, 600);
  await rec.scroll(520, { ms: 1000 });
  await pause(rec, 1800);
}

async function trends() {
  throw new Error('todo');
}
async function extras() {
  throw new Error('todo');
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
  rec.captionDefaults({ x: CX, maxWidth: 700 });
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
