/**
 * Screen recorder for product walkthroughs.
 *
 * Playwright's built-in video is low-bitrate; this captures Chromium screencast frames over CDP
 * (lossless-ish JPEGs with real timestamps) and lets ffmpeg assemble a crisp constant-frame-rate
 * MP4. It also draws a visible cursor with click ripples and offers caption / title-card helpers,
 * because headless browsers render neither.
 *
 *   const rec = await createRecorder({ outDir, width: 1600, height: 900 });
 *   await rec.page.goto(url); await rec.start();
 *   await rec.caption('Calendar', 'Every week at a glance');
 *   await rec.click(rec.page.getByRole('link', { name: 'Trends' }));
 *   await rec.stop(); await rec.encode('walkthrough.mp4');
 */
import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url);
const run = promisify(execFile);

function loadPlaywright() {
  for (const id of ['playwright', '@playwright/test', '/opt/node-tools/node_modules/playwright']) {
    try {
      return require(id);
    } catch {
      /* try next */
    }
  }
  throw new Error('playwright is not installed');
}

const OVERLAY_SCRIPT = `
(() => {
  if (window.__demoOverlay) return;
  window.__demoOverlay = true;
  const css = document.createElement('style');
  css.textContent = \`
    #demo-cursor { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none; width: 22px; height: 22px;
      margin: -3px 0 0 -3px; will-change: transform; filter: drop-shadow(0 1px 2px rgba(0,0,0,.6)); }
    .demo-ripple { position: fixed; z-index: 2147483646; pointer-events: none; width: 44px; height: 44px; margin: -22px 0 0 -22px;
      border-radius: 50%; border: 1.5px solid rgba(255,255,255,.9); animation: demo-ripple .55s cubic-bezier(.2,.7,.2,1) forwards; }
    @keyframes demo-ripple { from { transform: scale(.25); opacity: .9 } to { transform: scale(1); opacity: 0 } }
    #demo-caption { position: fixed; left: var(--demo-cx, 50%); bottom: 36px; z-index: 2147483645; pointer-events: none; transform: translate(-50%, 12px);
      opacity: 0; transition: opacity .35s ease, transform .45s cubic-bezier(.2,.8,.2,1); max-width: min(var(--demo-cw, 980px), 86vw);
      padding: 14px 22px; border-radius: 16px; background: rgba(10,10,10,.78); backdrop-filter: blur(18px) saturate(1.4);
      border: 1px solid rgba(255,255,255,.14); color: #fff; font: 500 19px/1.3 'Geist Variable', system-ui, sans-serif;
      letter-spacing: -0.01em; text-align: center; }
    #demo-caption.on { opacity: 1; transform: translate(-50%, 0); }
    #demo-caption.top { bottom: auto; top: 30px; transform: translate(-50%, -12px); }
    #demo-caption.top.on { transform: translate(-50%, 0); }
    #demo-keys { position: fixed; right: 28px; bottom: 30px; z-index: 2147483645; pointer-events: none; display: flex; gap: 6px;
      opacity: 0; transform: translateY(8px) scale(.96); transition: opacity .2s ease, transform .3s cubic-bezier(.2,.8,.2,1); }
    #demo-keys.on { opacity: 1; transform: none; }
    #demo-keys kbd { min-width: 34px; height: 34px; padding: 0 10px; display: grid; place-items: center; border-radius: 9px; background: rgba(18,18,18,.88);
      border: 1px solid rgba(255,255,255,.2); box-shadow: inset 0 -2px 0 rgba(255,255,255,.08); color: #fff; font: 600 15px/1 'Geist Mono Variable', ui-monospace, monospace; }
    #demo-fade { position: fixed; inset: 0; z-index: 2147483643; pointer-events: none; background: #000; opacity: 0; transition: opacity .6s ease; }
    #demo-fade.on { opacity: 1; }
    #demo-caption small { display: block; margin-top: 4px; font: 400 14.5px/1.35 'Geist Variable', system-ui, sans-serif; color: rgba(255,255,255,.66); letter-spacing: 0; }
    #demo-card { position: fixed; inset: 0; z-index: 2147483644; pointer-events: none; display: grid; place-items: center; background: #000;
      opacity: 0; transition: opacity .5s ease; color: #fff; text-align: center; }
    #demo-card.on { opacity: 1; }
    #demo-card h1 { margin: 0; font: 600 76px/1 'Geist Variable', system-ui, sans-serif; letter-spacing: -0.045em; }
    #demo-card p { margin: 22px auto 0; max-width: 820px; font: 400 23px/1.4 'Geist Variable', system-ui, sans-serif; color: rgba(255,255,255,.62); letter-spacing: -0.01em; }
    #demo-card .k { display: inline-block; margin-bottom: 26px; font: 600 13px/1 'Geist Mono Variable', ui-monospace, monospace; letter-spacing: .14em; text-transform: uppercase; color: #34f47a; }
  \`;
  const mount = () => {
    document.documentElement.appendChild(css);
    const cur = document.createElement('div');
    cur.id = 'demo-cursor';
    cur.innerHTML = '<svg viewBox="0 0 22 22" width="22" height="22"><path d="M3 2.5l14.2 6.3-5.9 2.3-2.4 5.9z" fill="#fff" stroke="#000" stroke-width="1.2" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(cur);
    const cap = document.createElement('div'); cap.id = 'demo-caption'; document.documentElement.appendChild(cap);
    const card = document.createElement('div'); card.id = 'demo-card'; document.documentElement.appendChild(card);
    const keys = document.createElement('div'); keys.id = 'demo-keys'; document.documentElement.appendChild(keys);
    const fade = document.createElement('div'); fade.id = 'demo-fade'; document.documentElement.appendChild(fade);
    if (window.__demoFadeOn) fade.classList.add('on');
    let keysTimer = 0;
    window.__demoKeys = (list) => {
      clearTimeout(keysTimer); keys.innerHTML = '';
      for (const k of list) { const e = document.createElement('kbd'); e.textContent = k; keys.append(e); }
      keys.classList.add('on'); keysTimer = setTimeout(() => keys.classList.remove('on'), 1300);
    };
    window.__demoFade = (on) => { window.__demoFadeOn = on; fade.classList.toggle('on', !!on); };
    window.__demoCursor = (on) => { cur.style.opacity = on ? '1' : '0'; };
    const pos = (x, y) => { cur.style.transform = 'translate(' + x + 'px,' + y + 'px)'; };
    pos(window.__demoX ?? -40, window.__demoY ?? -40);
    addEventListener('mousemove', (e) => { window.__demoX = e.clientX; window.__demoY = e.clientY; pos(e.clientX, e.clientY); }, true);
    addEventListener('mousedown', (e) => {
      const r = document.createElement('div'); r.className = 'demo-ripple'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
      document.documentElement.appendChild(r); setTimeout(() => r.remove(), 600);
    }, true);
    window.__demoCaption = (title, sub, opts) => {
      if (!title) { cap.classList.remove('on'); return; }
      const o = opts || {};
      cap.classList.toggle('top', o.pos === 'top');
      cap.style.setProperty('--demo-cx', o.x != null ? o.x + 'px' : '50%');
      cap.style.setProperty('--demo-cw', (o.maxWidth || 980) + 'px');
      cap.innerHTML = ''; cap.append(title);
      if (sub) { const s = document.createElement('small'); s.textContent = sub; cap.append(s); }
      cap.classList.add('on');
    };
    window.__demoCard = (kicker, title, sub) => {
      if (!title) { card.classList.remove('on'); return; }
      card.innerHTML = '<div><span class="k"></span><h1></h1><p></p></div>';
      card.querySelector('.k').textContent = kicker || ''; card.querySelector('h1').textContent = title; card.querySelector('p').textContent = sub || '';
      card.classList.add('on');
    };
  };
  if (document.documentElement) mount(); else addEventListener('DOMContentLoaded', mount);
})();
`;

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export async function createRecorder({ outDir, width = 1600, height = 900, fps = 30, headless = true, quality = 92, timezoneId, locale, mouse: startMouse }) {
  const { chromium } = loadPlaywright();
  const framesDir = path.join(outDir, 'frames');
  await rm(framesDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });

  const browser = await chromium.launch({
    headless,
    args: ['--force-color-profile=srgb', '--disable-lcd-text', '--enable-gpu-rasterization', '--hide-scrollbars'],
    ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
  });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: 'no-preference', ...(timezoneId ? { timezoneId } : {}), ...(locale ? { locale } : {}) });
  await context.addInitScript(OVERLAY_SCRIPT);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);

  const frames = []; // { file, t }
  let recording = false;
  let writes = Promise.resolve();
  let mouse = startMouse ? { ...startMouse } : { x: width / 2, y: height / 2 };
  const captionDefaults = {};
  const marks = [];
  let startedAt = 0;
  let pausedTotal = 0; // seconds cut out by pause()/resume()
  let pausedAt = 0;
  let clockOffset = null; // wall clock − screencast clock (s)
  let stopT = null; // stop() time on the frame timeline, so a still last frame keeps its length

  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    if (!recording) return;
    const file = path.join(framesDir, `f${String(frames.length).padStart(6, '0')}.jpg`);
    if (clockOffset == null) clockOffset = Date.now() / 1000 - metadata.timestamp;
    frames.push({ file, t: metadata.timestamp - pausedTotal });
    writes = writes.then(() => writeFile(file, Buffer.from(data, 'base64')));
  });

  const api = {
    page,
    context,
    browser,
    get frameCount() {
      return frames.length;
    },
    /** Current cursor position (to hand over to the next segment). */
    get mouse() {
      return { ...mouse };
    },
    /** Place the cursor without animating (before start(), e.g. to continue from the previous segment). */
    async placeCursor(x, y) {
      mouse = { x, y };
      await page.mouse.move(x, y);
    },
    async start() {
      await page.mouse.move(mouse.x, mouse.y).catch(() => {});
      recording = true;
      startedAt = Date.now();
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality, maxWidth: width, maxHeight: height, everyNthFrame: 1 });
    },
    /** Stop capturing (a jump cut — use it to skip waiting); resume() continues the same timeline. */
    async pause() {
      await page.waitForTimeout(120);
      recording = false;
      pausedAt = Date.now();
    },
    async resume() {
      pausedTotal += (Date.now() - pausedAt) / 1000;
      startedAt += Date.now() - pausedAt;
      recording = true;
      // force a fresh frame right away so the cut lands now, not at the next paint
      await page.mouse.move(mouse.x + 0.5, mouse.y).catch(() => {});
      await page.mouse.move(mouse.x, mouse.y).catch(() => {});
    },
    async stop() {
      await page.waitForTimeout(300);
      recording = false;
      if (clockOffset != null) stopT = Date.now() / 1000 - clockOffset - pausedTotal;
      await cdp.send('Page.stopScreencast').catch(() => {});
      await writes;
    },
    wait: (ms) => page.waitForTimeout(ms),

    /** Glide the visible cursor to a point with easing. */
    async moveTo(x, y, ms = 650) {
      // Time-based (not step-based): on a heavy page each mouse event round-trip is slow, and a
      // fixed number of steps would stretch the glide well past `ms`.
      const from = { ...mouse };
      const t0 = Date.now();
      for (;;) {
        const f = Math.min(1, (Date.now() - t0) / ms);
        const k = ease(f);
        await page.mouse.move(from.x + (x - from.x) * k, from.y + (y - from.y) * k);
        if (f >= 1) break;
        await page.waitForTimeout(12);
      }
      mouse = { x, y };
    },
    async centerOf(locator, { dx = 0, dy = 0 } = {}) {
      await locator.scrollIntoViewIfNeeded().catch(() => {});
      const box = await locator.boundingBox();
      if (!box) throw new Error('element not visible for cursor move');
      return { x: box.x + box.width / 2 + dx, y: box.y + box.height / 2 + dy };
    },
    async hover(locator, opts = {}) {
      const p = await api.centerOf(locator, opts);
      await api.moveTo(p.x, p.y, opts.ms ?? 650);
    },
    async click(locator, opts = {}) {
      await api.hover(locator, opts);
      await page.waitForTimeout(opts.pause ?? 140);
      await page.mouse.down(opts.modifiers ? {} : undefined);
      await page.waitForTimeout(60);
      await page.mouse.up();
      await page.waitForTimeout(opts.after ?? 500);
    },
    /** Press-drag-release between two locators or points with a human-looking path. */
    async drag(from, to, { ms = 1100, hold = 220, settle = 700 } = {}) {
      const a = 'x' in from ? from : await api.centerOf(from);
      const b = 'x' in to ? to : await api.centerOf(to);
      await api.moveTo(a.x, a.y, 600);
      await page.mouse.down();
      await page.waitForTimeout(hold);
      await api.moveTo(a.x + 12, a.y + 8, 140); // exceed the drag activation distance
      await api.moveTo(b.x, b.y, ms);
      await page.waitForTimeout(260);
      await page.mouse.up();
      await page.waitForTimeout(settle);
    },
    /** Type like a person. */
    async type(text, { delay = 55 } = {}) {
      for (const ch of text) {
        await page.keyboard.type(ch);
        await page.waitForTimeout(delay + Math.random() * 30);
      }
    },
    async scroll(deltaY, { ms = 900 } = {}) {
      // time-based eased wheel, like moveTo
      const t0 = Date.now();
      let done = 0;
      for (;;) {
        const f = Math.min(1, (Date.now() - t0) / ms);
        const target = deltaY * ease(f);
        const step = target - done;
        if (Math.abs(step) >= 1 || f >= 1) {
          await page.mouse.wheel(0, step);
          done = target;
        }
        if (f >= 1) break;
        await page.waitForTimeout(16);
      }
    },
    /**
     * Caption pill. opts: { pos: 'bottom' | 'top', x: centre in px (default: page centre), maxWidth }.
     * Changing text while one is showing crossfades through a short hide so the eye catches the new line.
     */
    async caption(title, sub, opts = {}) {
      const showing = await page.evaluate(() => document.getElementById('demo-caption')?.classList.contains('on')).catch(() => false);
      if (showing && title) {
        await page.evaluate(() => window.__demoCaption?.('')).catch(() => {});
        await page.waitForTimeout(320);
      }
      await page.evaluate(([t, s, o]) => window.__demoCaption?.(t, s, o), [title ?? '', sub ?? '', { ...captionDefaults, ...opts }]).catch(() => {});
    },
    /** Defaults merged into every caption (e.g. { x: 916 } to centre over the content column). */
    captionDefaults(opts) {
      Object.assign(captionDefaults, opts);
    },
    /** Press a key or chord (Playwright syntax, e.g. 'Control+k'), showing a keycap chip bottom-right. */
    async press(key, { show = true, label, after = 450 } = {}) {
      if (show) {
        const caps = label ?? key.split('+').map((k) => ({ Control: 'Ctrl', Meta: '⌘', Shift: '⇧', Alt: '⌥', Enter: '↵', Escape: 'Esc', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' })[k] ?? (k.length === 1 ? k.toUpperCase() : k));
        await page.evaluate((l) => window.__demoKeys?.(l), Array.isArray(caps) ? caps : [caps]).catch(() => {});
        await page.waitForTimeout(160);
      }
      await page.keyboard.press(key);
      await page.waitForTimeout(after);
    },
    /** Fade the whole frame to / from black (used to join segments). */
    async fade(on, ms = 650) {
      await page.evaluate((v) => window.__demoFade?.(v), on).catch(() => {});
      await page.waitForTimeout(ms);
    },
    async cursor(on) {
      await page.evaluate((v) => window.__demoCursor?.(v), on).catch(() => {});
    },
    /** Seconds since start() — for logging beat timestamps. */
    elapsed() {
      return startedAt ? (Date.now() - startedAt) / 1000 : 0;
    },
    /** Record a named beat at the current time (written next to the video as beats.json). */
    mark(label) {
      const t = api.elapsed();
      marks.push({ t: Math.round(t * 10) / 10, label });
      console.log(`  [${t.toFixed(1).padStart(6)}s] ${label}`);
    },
    marks,
    /** Full-frame title card. { keep: true } leaves it up (for an end card); { instant } skips the fade-in. */
    async titleCard(kicker, title, sub, ms = 2600, { keep = false } = {}) {
      await api.cursor(false);
      await page.evaluate(([k, t, s]) => window.__demoCard?.(k, t, s), [kicker, title, sub]);
      await page.waitForTimeout(ms);
      if (keep) return;
      await page.evaluate(() => window.__demoCard?.('', '', ''));
      await page.waitForTimeout(550);
      await api.cursor(true);
    },

    /** Assemble frames (real timestamps → constant frame rate) into an H.264 MP4. */
    async encode(outFile, { crf = 18, tail = 0.1 } = {}) {
      if (frames.length < 2) throw new Error('nothing recorded');
      const lines = ['ffconcat version 1.0'];
      for (let i = 0; i < frames.length; i++) {
        const next = frames[i + 1];
        const d = next ? Math.max(0.001, next.t - frames[i].t) : stopT != null ? Math.max(tail, stopT - frames[i].t) : tail;
        lines.push(`file '${frames[i].file}'`, `duration ${d.toFixed(4)}`);
      }
      lines.push(`file '${frames[frames.length - 1].file}'`);
      const list = path.join(outDir, 'frames.ffconcat');
      await writeFile(list, lines.join('\n'));
      await run(
        'ffmpeg',
        ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-vf', `fps=${fps},format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-r', String(fps),
          '-movflags', '+faststart', outFile],
        { maxBuffer: 1 << 26 },
      );
      const dur = (stopT ?? frames[frames.length - 1].t) - frames[0].t;
      return { outFile, frames: frames.length, seconds: dur, capturedFps: frames.length / dur };
    },
    async close() {
      await browser.close();
    },
  };
  return api;
}
