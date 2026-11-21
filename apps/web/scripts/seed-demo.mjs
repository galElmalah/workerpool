#!/usr/bin/env node
/**
 * Seed a Cadence dev server running in demo mode (DEMO_MODE=1) with the synthetic athlete.
 * No dependencies (Node ≥ 18).
 *
 *   node scripts/seed-demo.mjs --base http://localhost:5173 [--passphrase cadence-demo]
 *        [--months 12] [--seed 7] [--today 2026-11-21] [--fast] [--batch 20] [--reset] [--quiet]
 *
 * Signs in (setting the passphrase on first run), starts POST /api/demo/seed and calls
 * POST /api/demo/seed/step until the job is finished, printing progress. Exits non-zero on error.
 */
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && i + 1 < args.length && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

if (flag('help') || flag('h')) {
  console.log('usage: node scripts/seed-demo.mjs --base http://localhost:5173 [--passphrase cadence-demo] [--months 12] [--seed 7] [--today YYYY-MM-DD] [--fast] [--batch 20] [--reset] [--quiet]');
  process.exit(0);
}

const base = opt('base', 'http://localhost:5173').replace(/\/$/, '');
const passphrase = opt('passphrase', 'cadence-demo');
const months = Number(opt('months', '12'));
const seed = opt('seed') !== undefined ? Number(opt('seed')) : undefined;
const today = opt('today');
const batch = Number(opt('batch', '20'));
const fast = flag('fast');
const quiet = flag('quiet');

let cookie = '';

async function call(method, path, body) {
  const headers = { accept: 'application/json' };
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${base}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: res.status, ok: res.ok, data };
}

function fail(msg, res) {
  console.error(`seed-demo: ${msg}${res ? ` (HTTP ${res.status}: ${JSON.stringify(res.data?.error ?? res.data)})` : ''}`);
  process.exit(1);
}

async function signIn() {
  const status = await call('GET', '/auth/status');
  if (!status.ok) fail(`cannot reach ${base}`, status);
  if (!status.data.configured) {
    const r = await call('POST', '/auth/setup', { passphrase });
    if (!r.ok && r.data?.error?.code !== 'already_configured') fail('passphrase setup failed', r);
  }
  if (!cookie) {
    const r = await call('POST', '/auth/login', { passphrase });
    if (!r.ok) fail('login failed (wrong --passphrase?)', r);
  }
}

const fmt = (ms) => `${(ms / 1000).toFixed(1)}s`;

async function main() {
  const t0 = Date.now();
  await signIn();
  const health = await call('GET', '/health');
  if (health.ok && health.data.demo === false) fail('the server is not in demo mode (set DEMO_MODE=1)');
  if (flag('reset')) {
    const r = await call('POST', '/demo/reset');
    if (!r.ok) fail('reset failed', r);
  }
  const body = { months };
  if (seed !== undefined) body.seed = seed;
  if (today) body.today = today;
  if (fast) body.fast = true;
  let res = await call('POST', '/demo/seed', body);
  if (!res.ok) fail('seed failed', res);
  let p = res.data;
  console.log(`seed-demo: job ${p.jobId} — ${p.planned} planned workouts, ${p.total} activities to import (${months} months, seed ${p.seed}, today ${p.today}${p.fast ? ', fast' : ''})`);
  let last = -1;
  let steps = 0;
  while (!p.finished) {
    res = await call('POST', '/demo/seed/step', { maxActivities: batch });
    if (!res.ok) {
      if (res.status === 409) {
        await new Promise((r) => setTimeout(r, 500)); // a cron/background sync holds the lock
        continue;
      }
      fail('step failed', res);
    }
    p = res.data;
    steps++;
    if (!quiet && (p.done !== last || p.finished)) {
      const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
      const extra = p.phase === 'activities' && p.backfill?.phase === 'wellness' ? ` · wellness ${p.backfill.wellnessDays} days` : '';
      console.log(`  ${String(pct).padStart(3)}%  ${p.done}/${p.total} activities · ${p.phase}${extra} · ${fmt(Date.now() - t0)}`);
      last = p.done;
    }
    if (steps > 10_000) fail('too many steps');
  }
  const total = Date.now() - t0;
  console.log(`seed-demo: done — ${p.done} activities in ${fmt(total)} (${steps} steps, ${p.throughput ?? '?'} activities/s of step time)`);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
