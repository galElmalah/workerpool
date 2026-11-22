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
const CX = 232 + (W - 232) / 2;

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
  { name: 'activity', server: 'base', fn: activity },
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
  await rec.titleCard('cadence', 'Your training, one quiet instrument.', 'Plan · sync with Garmin · see progress — self-hosted on Cloudflare', 3400);
  await rec.cursor(false);
  await rec.fade(false, 700);
  await rec.cursor(true);

  rec.mark('onboarding: passphrase');
  await rec.caption('Set up in a minute', 'Connect Garmin and your history flows in — activities, FIT files, wellness.', { pos: 'top' });
  const pp = page.locator('#pp');
  await rec.click(pp, { after: 200 });
  await rec.type('quiet morning miles', { delay: 45 });
  await pause(rec, 500);
  await rec.click(page.getByRole('button', { name: 'Continue' }), { after: 300 });

  rec.mark('onboarding: profile');
  const name = page.getByRole('textbox', { name: 'Name' });
  await name.waitFor();
  await pause(rec, 500);
  await rec.click(name, { after: 150 });
  await rec.type('Jonas', { delay: 70 });
  await pause(rec, 500);
  await rec.click(page.getByRole('button', { name: 'Continue' }), { after: 300 });

  rec.mark('onboarding: garmin');
  const demoBtn = page.getByRole('button', { name: 'Use the demo Garmin account' });
  await demoBtn.waitFor();
  await pause(rec, 700);
  await rec.click(demoBtn, { after: 300 });
  const importBtn = page.getByRole('button', { name: /^Import .* of history$/ });
  await importBtn.waitFor({ timeout: 20000 });
  await pause(rec, 900);
  await rec.click(importBtn, { after: 300 });
  rec.mark('onboarding: history import ticking');
  // let the import counter tick for a few seconds
  await page.waitForFunction(() => /Importing|History imported/.test(document.body.innerText), null, { timeout: 20000 }).catch(() => {});
  await rec.hover(page.getByText('Activities imported'), { ms: 900 });
  await pause(rec, 4200);
  const cont = page.getByRole('button', { name: /^Continue/ });
  await rec.click(cont, { after: 300 });

  rec.mark('onboarding: thresholds');
  await page.getByRole('heading', { name: 'Your thresholds' }).waitFor();
  const finish = page.getByRole('button', { name: 'Finish' });
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'Finish');
    return b && !b.disabled;
  }, null, { timeout: 20000 });
  await pause(rec, 600);
  await rec.hover(page.getByText('FTP', { exact: false }).first(), { ms: 800 }).catch(() => {});
  await pause(rec, 1400);
  await rec.click(finish, { after: 300 });

  rec.mark('onboarding: finale → calendar');
  await rec.caption('');
  await page.waitForURL(/\/calendar|\/today/, { timeout: 20000 });
  await settle(page);
  await rec.moveTo(W * 0.55, H * 0.45, 900);
  await pause(rec, 2600);
  await rec.cursor(false);
  await rec.fade(true, 800);
}

async function calendar(rec, base) {
  throw new Error('todo');
}
async function workout() {
  throw new Error('todo');
}
async function builder() {
  throw new Error('todo');
}
async function today() {
  throw new Error('todo');
}
async function activity() {
  throw new Error('todo');
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
  if (prev && existsSync(prev)) mouse = JSON.parse(await readFile(prev, 'utf8')).mouse;
  const segOut = path.join(OUT, 'work', seg.name);
  await mkdir(segOut, { recursive: true });
  const rec = await createRecorder({ outDir: segOut, width: W, height: H, timezoneId: TZ, locale: 'en-GB', headless: !args.headed, mouse });
  rec.captionDefaults({ x: CX, maxWidth: 760 });
  const t0 = Date.now();
  console.log(`▶ ${seg.name} (${base})`);
  try {
    if (seg.server === 'base') {
      await signIn(rec.context, base);
      await warm(rec.page, base, WARM_ROUTES);
    }
    await seg.fn(rec, base);
    await rec.stop();
    const file = path.join(SEG_DIR, `${seg.name}.mp4`);
    const info = await rec.encode(file, { crf: Number(args.crf) });
    await writeFile(path.join(SEG_DIR, `${seg.name}.json`), JSON.stringify({ seconds: info.seconds, marks: rec.marks, mouse: rec.mouse }, null, 2));
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
