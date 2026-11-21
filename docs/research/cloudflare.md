# Cloudflare platform research: single-user training platform

Status: research complete, 2026-11-21. Audience: the engineer scaffolding the repo from this doc.

Everything marked **VERIFIED** was run in this container (Node 22.23.5, pnpm 10.28.0, Linux x64) in a throwaway spike under the session scratchpad (`cf-spike/`, `ws-spike/`, `mf4/`). Anything else is sourced from current docs and marked **UNVERIFIED** where it could not be exercised locally (anything that needs a Cloudflare account, for example). `developers.cloudflare.com` is blocked from this sandbox. Docs were read from the `cloudflare/cloudflare-docs` GitHub sources and from web search.

---

## 0. Decisions (TL;DR)

| Topic | Decision |
|---|---|
| Hosting | **One Worker with Static Assets** (`assets` + `not_found_handling: "single-page-application"` + `run_worker_first: ["/api/*"]`). **Not Pages**: Cloudflare points all new projects at Workers, and Pages only gets maintenance. |
| Dev server | **`@cloudflare/vite-plugin` with `vite dev`**: the Worker (Hono API) runs in real `workerd` inside the Vite dev server, React gets HMR, and the Worker hot-reloads. No separate `wrangler dev` and no Vite proxy. `wrangler dev` is only used to smoke-test the built output. |
| API | Hono 4.13 + `@hono/zod-validator` + zod 4; the SPA uses the `hc<AppType>` RPC client for end-to-end types. |
| DB | D1 for all relational data and summaries. Schema in **Drizzle** (`drizzle-kit generate`), migrations **applied with `wrangler d1 migrations apply`**. |
| Time series | **R2, not D1.** Raw FIT/zip goes to `raw/{id}.zip`, derived columnar streams to `streams/{id}.json.gz` (served pre-gzipped). D1 keeps only summaries and aggregates. |
| Unit/integration tests | **`@cloudflare/vitest-plugin` 1.9.0** (the renamed `@cloudflare/vitest-pool-workers`; the old name is deprecated) on **vitest 5.1.1**. Outbound Garmin calls are mocked with **MSW 3 + `@msw/cloudflare`** (`fetchMock` was removed). |
| E2E | Playwright `webServer` resets an isolated local state dir (`--persist-to .wrangler/e2e`), applies migrations, seeds, then runs `vite dev` against that dir (`CF_PERSIST_TO`). |
| Background | Cron Trigger (incremental sync) plus a **Workflow** for the resumable history backfill (one durable step per activity). No Queues and no DO alarms. |
| Plan | **Workers Paid ($5/mo).** FIT parsing measured at 20–55 ms CPU per 3 h file, which is over the Free plan's 10 ms/invocation. A Free-plan fallback is described in §4.5. |
| Auth | Built-in **passphrase login + HMAC-signed session cookie** (WebCrypto, verified). Optionally add **Cloudflare Access** in front for production (one dashboard toggle, no code). |
| Secrets | `wrangler secret put` in production; `.dev.vars` locally (gitignored). Garmin tokens are encrypted at rest in D1 with **AES-256-GCM**, using a key from a Worker secret. |
| Config format | `wrangler.jsonc`. `cloudflare.config.ts` is a beta format for the new `cf` CLI, and **Wrangler does not read it**. |

---

## 1. Project layout and build

### 1.1 Workers + Static Assets vs Pages

- **Workers Static Assets is the target.** Cloudflare's docs have "Migrate from Pages to Workers" guides and recommend Workers for new projects. Pages still runs and is not formally sunset, but new features land on Workers. Workers Sites (the older KV-based approach) is deprecated in Wrangler v4.
- Static asset requests are free and don't invoke the Worker unless they match `run_worker_first`.
- How it behaves (verified with `vite dev`, `vite preview` and `wrangler dev`):
  - `/api/*` reaches the Worker first because of `run_worker_first: ["/api/*"]`. An unknown `/api/nope` returns the Worker's own 404, not `index.html`.
  - Any other path that isn't a real file (for example `/calendar/2026-11`) returns `index.html` with status 200 because of `not_found_handling: "single-page-application"`.
  - Hashed files under `/assets/*` are served directly by the asset layer.
- Leave out `assets.directory` when using the Vite plugin; the plugin fills it in at build time (`dist/client`). Add `assets.binding: "ASSETS"` only if the Worker needs to fetch assets itself (this app doesn't).

### 1.2 `@cloudflare/vite-plugin` (chosen) vs `wrangler dev` + Vite proxy

`@cloudflare/vite-plugin@1.70.1` (a 2.0.0-rc.3 is on the `rc` tag; don't use it yet) runs the Worker as a **Vite environment inside workerd** (through Miniflare) during `vite dev`, so:

- Requests that match `run_worker_first` go to the Hono app running in workerd. Everything else is served by Vite with React Fast Refresh.
- **Worker HMR (verified):** editing `worker/index.ts` logged `hmr update virtual:cloudflare/worker-entry`, and the next request served the new code without a restart. Editing `src/main.tsx` triggers normal client HMR.
- Bindings (D1, R2, Queues, Workflows, rate limits, vars, `.dev.vars`) come from `wrangler.jsonc` and persist under `.wrangler/state` (the same directory `wrangler d1 … --local` uses, so seeded data shows up in `vite dev`; verified).
- `vite build` emits `dist/client` (SPA) and `dist/<worker_name_with_underscores>/{index.js,index.js.map,wrangler.json}`, and writes `.wrangler/deploy/config.json` to redirect Wrangler. After that, `wrangler deploy` / `wrangler dev` / `wrangler deploy --dry-run` use the built config automatically (verified: "Using redirected Wrangler configuration").
- `vite preview` serves the production build in workerd (verified).
- Local cron triggering, queue consumers and workflows all work inside `vite dev` (verified, see §4).
- When the plugin detects an AI agent, it prints a "Local Explorer API" at `/cdn-cgi/local/explorer/api` (lists D1/R2/workflows, invokes scheduled handlers, queries captured logs). Handy for debugging.

A separate `wrangler dev` with a Vite proxy only adds moving parts (two servers, a proxy config, no shared HMR), so don't use it.

**Version-coupling gotcha (verified):** the Vite plugin depends on its own pinned `wrangler@4.164.0` and `miniflare@5.20261117.0-beta`, so `vite dev` runs **workerd 1.20261117.1** while `wrangler dev` runs workerd 1.20261119.1. `compatibility_date` must not be newer than what the oldest of these supports. Use **`2026-11-15`** and bump it only when upgrading both packages.

### 1.3 Repo layout (pnpm workspace) — VERIFIED as `ws-spike/`

```
/
├─ package.json            # root scripts only
├─ pnpm-workspace.yaml
├─ apps/
│  └─ web/                 # THE Worker: SPA + API + cron + workflow (one Vite project)
│     ├─ index.html
│     ├─ src/              # React SPA
│     ├─ worker/           # Hono app, scheduled(), Workflow classes, lib/
│     ├─ migrations/       # SQL generated by drizzle-kit, applied by wrangler
│     ├─ test/             # vitest-plugin tests (run in workerd)
│     ├─ e2e/              # Playwright specs + seed.sql
│     ├─ wrangler.jsonc  vite.config.ts  vitest.config.ts  playwright.config.ts
│     ├─ drizzle.config.ts tsconfig.app.json  tsconfig.worker.json
│     └─ worker-configuration.d.ts   # generated by `wrangler types` (commit it)
└─ packages/
   └─ shared/              # pure TS (types, zod schemas, FIT->streams math); exports ./src/index.ts
```

Workspace packages can export raw TS (`"exports": { ".": "./src/index.ts" }`). Vite bundles them into the Worker, and the vitest plugin resolves them too (verified: an `@app/shared` function was called from the Worker in a test).

`pnpm-workspace.yaml` (verified: pnpm 10 skips dependency build scripts unless they are listed here):

```yaml
packages:
  - "apps/*"
  - "packages/*"
onlyBuiltDependencies:
  - esbuild
  - workerd
  - sharp
```

Root `package.json`:

```json
{
  "name": "workerpool",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.28.0",
  "engines": { "node": ">=22.12" },
  "scripts": {
    "dev": "pnpm --filter @app/web dev",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "e2e": "pnpm --filter @app/web e2e"
  }
}
```

`apps/web/package.json` (these exact versions were installed and run together):

```json
{
  "name": "@app/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview",
    "deploy": "vite build && wrangler deploy",
    "cf-typegen": "wrangler types",
    "typecheck": "wrangler types --check && tsc -p tsconfig.worker.json && tsc -p tsconfig.app.json",
    "test": "vitest run",
    "db:generate": "drizzle-kit generate",
    "db:migrate:local": "wrangler d1 migrations apply DB --local",
    "db:migrate:remote": "wrangler d1 migrations apply DB --remote",
    "e2e": "playwright test"
  },
  "dependencies": {
    "@app/shared": "workspace:*",
    "@garmin/fitsdk": "21.222.0",
    "@hono/zod-validator": "0.9.1",
    "drizzle-orm": "0.45.4",
    "fflate": "0.8.3",
    "hono": "4.13.19",
    "react": "19.3.1",
    "react-dom": "19.3.1",
    "zod": "4.6.7"
  },
  "devDependencies": {
    "@cloudflare/vite-plugin": "1.70.1",
    "@cloudflare/vitest-plugin": "1.9.0",
    "@msw/cloudflare": "0.2.0",
    "@playwright/test": "1.65.1",
    "@tailwindcss/vite": "4.3.5",
    "@types/node": "22.20.5",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "6.3.0",
    "drizzle-kit": "0.31.11",
    "msw": "3.0.7",
    "tailwindcss": "4.3.5",
    "typescript": "7.0.2",
    "vite": "8.3.8",
    "vitest": "5.1.1",
    "wrangler": "4.166.0"
  }
}
```

### 1.4 `wrangler.jsonc` (verified shape; IDs are placeholders)

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "workerpool",
  "main": "worker/index.ts",
  "compatibility_date": "2026-11-15",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "observability": { "enabled": true, "head_sampling_rate": 1 },
  "upload_source_maps": true,
  "triggers": { "crons": ["*/30 * * * *"] },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "workerpool-db",
      "database_id": "<from `wrangler d1 create workerpool-db`>",
      "migrations_dir": "migrations"
    }
  ],
  "r2_buckets": [{ "binding": "FILES", "bucket_name": "workerpool-files" }],
  "workflows": [{ "binding": "SYNC_WF", "name": "workerpool-sync", "class_name": "SyncWorkflow" }],
  "ratelimits": [{ "name": "LOGIN_LIMITER", "namespace_id": "1001", "simple": { "limit": 5, "period": 60 } }],
  "vars": { "GARMIN_API_BASE": "https://connectapi.garmin.com" },
  // documents required secrets; `wrangler types` + dev warn when missing
  "secrets": { "required": ["SESSION_SECRET", "PASSPHRASE_HASH", "TOKEN_ENC_KEY"] },
  "routes": [{ "pattern": "train.example.com", "custom_domain": true }],
  "workers_dev": false,
  "preview_urls": false,
  "env": {
    "staging": {
      "name": "workerpool-staging",
      "vars": { "GARMIN_API_BASE": "https://connectapi.garmin.com" },
      // bindings are NOT inherited by named envs: repeat every one
      "d1_databases": [{ "binding": "DB", "database_name": "workerpool-db-staging", "database_id": "<id>", "migrations_dir": "migrations" }],
      "r2_buckets": [{ "binding": "FILES", "bucket_name": "workerpool-files-staging" }],
      "workflows": [{ "binding": "SYNC_WF", "name": "workerpool-sync-staging", "class_name": "SyncWorkflow" }],
      "ratelimits": [{ "name": "LOGIN_LIMITER", "namespace_id": "1002", "simple": { "limit": 5, "period": 60 } }],
      "routes": [{ "pattern": "staging.train.example.com", "custom_domain": true }]
    }
  }
}
```

Notes:

- The `nodejs_compat` flag is needed by msw/fit-file-parser polyfills and is generally useful. Keep it on, and add `@types/node` because `wrangler types` asks for it.
- `ratelimits` `period` must be `10` or `60`.
- Queue config isn't needed for the chosen design. The verified shape, if you ever want Queues:
  `"queues": { "producers": [{ "binding": "Q", "queue": "q" }], "consumers": [{ "queue": "q", "max_batch_size": 5, "max_batch_timeout": 5, "max_retries": 5, "retry_delay": 60 }] }`.
- Selecting an environment with the Vite plugin happens **at build time** via `CLOUDFLARE_ENV` (verified): `CLOUDFLARE_ENV=staging vite build && wrangler deploy`. The built `dist/<name>/wrangler.json` then has `name: "workerpool-staging"`, the staging vars and the staging DB. Don't pass `--env` to `wrangler deploy` after a Vite build.
- The schema also supports `limits: { cpu_ms, subrequests }` (Paid plan), `observability.logs.invocation_logs`, and `access.dev` for local Access simulation.

### 1.5 `vite.config.ts` (verified)

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare({
      // E2E points this at an isolated, freshly seeded state dir
      persistState: process.env.CF_PERSIST_TO ? { path: process.env.CF_PERSIST_TO } : true,
    }),
  ],
});
```

`src/index.css` is just `@import "tailwindcss";` (Tailwind v4; verified that the `font-bold` class applied, `fontWeight: 700`).

### 1.6 TypeScript configs (verified; `tsc` 7.0.2 passes both)

Use **two** configs. The DOM lib's `SubtleCrypto` hides workerd extensions such as `crypto.subtle.timingSafeEqual`, and Worker code needs `ESNext` for `await using`.

`tsconfig.worker.json`:

```json
{
  "compilerOptions": {
    "target": "ES2024", "module": "ESNext", "moduleResolution": "Bundler",
    "lib": ["ESNext"], "strict": true, "skipLibCheck": true, "noEmit": true,
    "types": ["./worker-configuration.d.ts", "@cloudflare/vitest-plugin/types"]
  },
  "include": ["worker", "test"]
}
```

`tsconfig.app.json` (the SPA imports `type AppType` from the Worker, so it also needs the generated Worker types):

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "lib": ["ES2023", "DOM", "DOM.Iterable"], "jsx": "react-jsx",
    "strict": true, "skipLibCheck": true, "noEmit": true,
    "types": ["vite/client", "./worker-configuration.d.ts"]
  },
  "include": ["src"]
}
```

Run `wrangler types` (writes `worker-configuration.d.ts`, which provides a global `Env` and `Cloudflare.Env` from the bindings, the runtime types for your compat date, and Workflow param types inferred from your class). **Don't install `@cloudflare/workers-types`.** Use `wrangler types --check` in CI (verified).

### 1.7 Worker entry shape (verified)

```ts
// worker/index.ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

const app = new Hono<{ Bindings: Env }>().basePath("/api");

const routes = app
  .get("/health", (c) => c.json({ ok: true }))
  .post(
    "/activities",
    zValidator("json", z.object({ garminId: z.string(), name: z.string(), startTime: z.iso.datetime(), durationS: z.number().int() })),
    async (c) => {
      const b = c.req.valid("json");
      const row = await c.env.DB.prepare(
        "INSERT INTO activities (garmin_id, name, start_time, duration_s) VALUES (?, ?, ?, ?) RETURNING id",
      ).bind(b.garminId, b.name, b.startTime, b.durationS).first<{ id: number }>();
      return c.json({ id: row!.id }, 201);
    },
  );

export type AppType = typeof routes;     // consumed by the SPA via hc<AppType>
export { SyncWorkflow } from "./sync-workflow";

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(env.SYNC_WF.create({ id: `incr-${controller.scheduledTime}`, params: { mode: "incremental" } }));
  },
} satisfies ExportedHandler<Env>;
```

SPA side (verified with `tsc` and in the browser): `const client = hc<AppType>("/"); const r = await client.api.health.$get(); (await r.json()).ok`.

---

## 2. D1

### 2.1 Migrations workflow (verified)

- Source of truth is `worker/db/schema.ts` (Drizzle). `drizzle-kit generate --name <slug>` writes `migrations/0000_<slug>.sql` plus `migrations/meta/*` (keep `meta/` committed).
- Apply with Wrangler, which tracks applied files in the `d1_migrations` table:
  - local: `wrangler d1 migrations apply DB --local` (non-interactive under CI; it auto-answers yes)
  - prod: `wrangler d1 migrations apply DB --remote`
  - list: `wrangler d1 migrations list DB --local|--remote`
- Wrangler and the vitest helper (`readD1Migrations`) read every top-level `*.sql` in `migrations_dir`. Drizzle's `--> statement-breakpoint` comments are harmless (verified: `readD1Migrations` split the drizzle file into 5 queries and applied them).
- For data-only or hand-written migrations, use `drizzle-kit generate --custom --name x`, which keeps drizzle's journal in sync. **Don't** use `wrangler d1 migrations create` alongside drizzle-kit. Verified hazard: a hand-made `0001_add_hrv.sql` applied fine, but drizzle didn't know about the column, so typed selects silently omitted it.

`drizzle.config.ts` (verified; generation is offline and needs no credentials):

```ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({ dialect: "sqlite", schema: "./worker/db/schema.ts", out: "./migrations" });
```

### 2.2 Drizzle vs thin SQL layer

**Use Drizzle (`drizzle-orm@0.45.4`, `drizzle-kit@0.31.11`, both on the `latest` tag; v1 is still `1.0.0-rc.6`, so don't use it yet).** Verified in workerd: `drizzle(env.DB)`, inserts with `onConflictDoNothing`, typed selects, `text({ mode: "json" }).$type<…>()` round-trips objects, `sql\`json_extract(…)\``, and `db.batch([...])`. It costs about 70 KB minified / 19 KB gzipped. You get typed rows, schema-to-migration generation, and composable queries for calendar/aggregate views. For a schema of roughly 10–15 tables that beats hand-maintaining SQL strings plus row types. Use raw `env.DB.prepare()` for hot paths or anything Drizzle can't express.

Drizzle `sqliteTable` example (verified to generate valid D1 SQL):

```ts
import { sqliteTable, integer, text, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
export const activities = sqliteTable("activities", {
  id: integer("id").primaryKey(),
  garminId: text("garmin_id").notNull().unique(),
  sport: text("sport").notNull(),
  startTime: text("start_time").notNull(),          // UTC ISO-8601 with Z
  localDate: text("local_date").notNull(),          // 'YYYY-MM-DD' in athlete's tz at start
  utcOffsetMin: integer("utc_offset_min").notNull(),
  durationS: integer("duration_s").notNull(),
  summary: text("summary", { mode: "json" }).$type<{ np?: number; avgHr?: number }>().notNull().default(sql`'{}'`),
  streamsKey: text("streams_key"),                  // R2 key, null until processed
  createdAt: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
}, (t) => [index("idx_act_local_date").on(t.localDate), index("idx_act_sport_start").on(t.sport, t.startTime)]);
```

### 2.3 D1 limits that matter (from `cloudflare-docs` d1/platform/limits, Nov 2026)

| Limit | Value |
|---|---|
| DB size | **500 MB Free / 10 GB Paid** (hard cap) |
| Storage per account | 5 GB Free / 1 TB Paid |
| Row / string / BLOB size | **2,000,000 bytes** |
| SQL statement length | **100,000 bytes** (applies to each statement in a batch) |
| Bound parameters | **100 per statement** (multi-row INSERT: ≤ 100 / columns rows per statement) |
| Queries per Worker invocation | **50 Free / 1,000 Paid**; a `db.batch()` counts as ONE |
| Query duration | 30 s, which also covers a whole `batch()` |
| Result size | **50 MB per query (enforced since 2026-11-04)** |
| Columns per table / per result | 100 / 100 |
| Compound SELECT terms | 5 |
| Free daily quotas | 5 M rows read, **100 k rows written** per day (enforced since 2026-09-01; indexes add writes) |
| Paid included | 25 B rows read, 50 M rows written per month |
| Time Travel | 7 days Free / 30 days Paid |

Transactions:

- **No interactive transactions** (`BEGIN`…`COMMIT` across awaits is not supported).
- `db.batch([...stmts])` runs as one implicit transaction (all-or-nothing) and is the way to do atomic multi-statement writes (verified with Drizzle and the raw API).
- Use `INSERT … ON CONFLICT … DO UPDATE` and `RETURNING` (verified) instead of read-modify-write.

### 2.4 JSON, generated columns, dates (verified on local D1)

- `json_extract(summary,'$.np')`, `summary->>'$.np'`, and `GENERATED ALWAYS AS (json_extract(...)) VIRTUAL` columns with an index on them all work. Keep flexible metrics in a JSON column and promote the ones you query or sort on to generated columns plus an index.
- Dates:
  - Store instants as **UTC ISO-8601 TEXT with milliseconds and `Z`** (`2026-11-01T07:00:00.000Z`, from `new Date().toISOString()`). It sorts lexically and SQLite date functions accept it (`date()`, `strftime('%Y-%W',…)`, `unixepoch()` verified).
  - Also store `local_date` (`YYYY-MM-DD`) and `utc_offset_min` at the activity's start. Calendar and weekly-load views group by the athlete's local day, never by UTC.
  - Durations are integer seconds.
  - Garmin's `startTimeGMT` (`"2026-11-01 07:00:00"`) needs `+"Z"` before parsing (verified).
- Indexes: `(local_date)`, `(sport, start_time)`, a unique `garmin_id`, and indexes on generated JSON columns you filter by. Every index adds a row write per insert or update, which matters against the Free 100 k/day write quota.

### 2.5 Where to store per-second streams: **R2**

Size math (measured on a synthetic 3 h, 1 Hz ride with 9 channels: 10,800 records):

| Representation | Size |
|---|---|
| FIT file | 324 KB (real Garmin files with more fields: roughly 0.5–1.5 MB; UNVERIFIED estimate) |
| gzip(FIT) / Garmin zip download | 176 KB |
| Row-oriented JSON (`[{timestamp,hr,…}]`) | 2.25 MB, **over D1's 2 MB row limit** |
| Columnar JSON (`{t:[],hr:[],pwr:[],…}`, ints scaled) | 652 KB |
| gzip(columnar JSON) | **135 KB** (synthetic data is smooth; expect about 2× on real data) |

- Per-second rows in D1 are a non-starter: 10,800 rows per activity and about 50 M rows for 4–5 k activities, which blows through the Free 100 k/day write quota and bloats the 10 GB cap.
- A gzip BLOB per activity in D1 *fits* (about 135–400 KB, under 2 MB). But 5 k activities × about 250 KB ≈ 1.25 GB is 2.5× the Free DB cap, and it makes exports and Time Travel heavier.
- **Decision:**
  - D1 holds summaries and derived aggregates (laps, zone times, power/HR bests, TSS).
  - R2 holds `raw/{garminId}.zip` (the original, for re-parsing later) and `streams/{garminId}.json.gz` (columnar, pre-gzipped).
  - Total for 5 k activities is about 2–3 GB, well inside R2's free 10 GB-month (1 M Class A and 10 M Class B ops/month free; egress free).
- Serve streams with no CPU spent on decompression (verified):

```ts
const obj = await c.env.FILES.get(`streams/${id}.json.gz`);
return new Response(obj!.body, {
  headers: { "content-type": "application/json", "content-encoding": "gzip", "cache-control": "private, max-age=31536000, immutable" },
  encodeBody: "manual", // body is already gzip; don't recompress
});
```

(In `vite dev` the dev proxy transparently decodes it; the browser gets valid JSON either way.)

---

## 3. Testing with Miniflare

### 3.1 Package situation (important; Nov 2026)

- `@cloudflare/vitest-pool-workers` is **deprecated**: its final 0.23.0 README says it was renamed. It only supports `vitest ^4.1` and pins an old `wrangler@4.124.0`.
- **Use `@cloudflare/vitest-plugin@1.9.0`**, whose peer range is `vitest ^4.1.0 || ^5.0.0`. Verified with **vitest 5.1.1**. It bundles `miniflare@5.20261119.0-beta`, so there's no separate miniflare install.
- Migrating from the old name: `npx @cloudflare/codemods vitest:pool-workers-to-vitest-plugin`.
- API changes vs the old pool:
  - Config uses `cloudflareTest()` as a **Vite plugin**, not `defineWorkersConfig`/`poolOptions`.
  - `import { env, exports } from "cloudflare:workers"` replaces `env`/`SELF` from `cloudflare:test`. The old ones still work but are deprecated (verified both).
  - **`fetchMock` is gone.** Use MSW (`msw@3` + `@msw/cloudflare`).
- Speed: the full suite (20 tests: D1, MSW, cron, queues, workflows, R2, rate limit, crypto) runs in about 7 s, or about 1.3 s without the 5 s queue-batch test.

### 3.2 `vitest.config.ts` (verified)

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },     // bindings come from here
        miniflare: {
          // test-only bindings / overrides (win over wrangler vars and .dev.vars — verified)
          bindings: { TEST_MIGRATIONS: migrations, GARMIN_API_BASE: "https://garmin.test", SESSION_SECRET: "test-secret" },
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts"],     // REQUIRED: otherwise vitest also picks up e2e/*.spec.ts
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
```

`test/apply-migrations.ts`:

```ts
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);   // idempotent
```

`test/env.d.ts`:

```ts
import type { D1Migration } from "cloudflare:test";
declare global { namespace Cloudflare { interface Env { TEST_MIGRATIONS: D1Migration[] } } }
export {};
```

Isolation (verified):

- **Storage is isolated per test file**: rows inserted in one `it()` are visible to the next `it()` in the same file, and a different file starts empty.
- For per-test isolation, use `beforeEach(async () => { await reset(); await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); })`. `reset()` wipes D1 as well, so migrations must be re-applied (verified).

### 3.3 Verified test examples

These come from the spike, where `scheduled()` called `syncFromGarmin(env)` directly. That function fetches `${GARMIN_API_BASE}/activitylist-service/...`, upserts into `activities` with `env.DB.batch`, and stamps `sync_state.last_run`. With the Workflow design, assert on `introspectWorkflow` instead (shown below).

```ts
// test/api.test.ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { env, exports } from "cloudflare:workers";
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { http, HttpResponse } from "msw";
import { setupNetwork } from "@msw/cloudflare";
import worker from "../worker/index";

const network = setupNetwork();                 // intercepts fetch() made by the Worker too
beforeAll(() => network.enable());
afterEach(() => network.resetHandlers());
afterAll(() => network.disable());

const garminList = [{ activityId: 111, activityName: "Morning Ride", startTimeGMT: "2026-11-01 07:00:00", duration: 3600.4 }];

describe("api", () => {
  it("hits the Hono app through the real Worker entry, D1 migrated", async () => {
    const post = await exports.default.fetch("https://example.com/api/activities", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ garminId: "g1", name: "Test", startTime: "2026-11-20T10:00:00Z", durationS: 60 }),
    });
    expect(post.status).toBe(201);
    const list = await (await exports.default.fetch("https://example.com/api/activities")).json<any>();
    expect(list.activities).toHaveLength(1);
  });

  it("mocks Garmin outbound fetch with MSW", async () => {
    network.use(http.get("https://garmin.test/activitylist-service/activities/search/activities",
      () => HttpResponse.json(garminList)));
    const res = await exports.default.fetch("https://example.com/api/sync", { method: "POST" });
    expect(await res.json()).toEqual({ imported: 1 });
  });

  it("runs the cron handler", async () => {
    network.use(http.get("https://garmin.test/*", () => HttpResponse.json(garminList)));
    const controller = createScheduledController({ scheduledTime: new Date("2026-11-21T00:00:00Z"), cron: "*/30 * * * *" });
    const ctx = createExecutionContext();
    await worker.scheduled(controller, env, ctx);
    await waitOnExecutionContext(ctx);          // waits for ctx.waitUntil work
    expect(await env.DB.prepare("SELECT last_run FROM sync_state WHERE id=1").first()).toBeTruthy();
  });
});
```

Other `cloudflare:test` helpers, all verified:

- **Queues (unit):**
  ```ts
  const batch = createMessageBatch("q", [{ id: "m1", timestamp: new Date(), attempts: 1, body: {...} }]);
  await worker.queue(batch, env);
  const r = await getQueueResult(batch, ctx);   // r.explicitAcks, r.retryMessages[].msgId
  ```
  `retryMessages` did not carry `delaySeconds` locally.
- **Queues (integration):** the producer→consumer loop runs for real in Miniflare. Delivery waits for `max_batch_timeout` (5 s in the test), so poll D1.
- **Workflows:**
  ```ts
  await using i = await introspectWorkflow(env.SYNC_WF);
  await i.modifyAll(m => m.disableSleeps());
  // ...trigger via exports.default.fetch...
  const [inst] = await i.get();
  await inst.waitForStatus("complete");
  await inst.getOutput();
  ```
  Per instance: `introspectWorkflowInstance(env.WF, id)` plus `m.mockStepResult({ name: "page-0" }, 41)`, `mockStepError`, `forceStepTimeout`, `disableRetryDelays`.
- Also available: `runInDurableObject`, `runDurableObjectAlarm`, `reset`, `adminSecretsStore`.
- **`exports.default.scheduled(...)` is not typed** in the generated types, and invoking `SELF.scheduled` threw `DataCloneError`. **Test cron by calling `worker.scheduled(createScheduledController(), env, ctx)` as above.**

### 3.4 Fake Garmin upstream: three layers

1. **Unit/integration (vitest):** MSW via `@msw/cloudflare` (above). It intercepts the Worker's own `fetch` because tests and the Worker share an isolate.
2. **Direct Miniflare API:** the `outboundService(req)` callback (below).
3. **Dev/E2E:** make the base URL a var (`GARMIN_API_BASE`) and override it in `.dev.vars` (`GARMIN_API_BASE=http://127.0.0.1:9999`) pointing at a tiny Node mock server. Verified: `curl /cdn-cgi/local/scheduled` made the dev Worker call the Node mock and insert into local D1.

   A mock implemented as a Worker via the Vite plugin's `auxiliaryWorkers` plus a service binding is possible but **UNVERIFIED**.

### 3.5 Direct `miniflare` API (only if you need a Node-side harness)

- `miniflare@latest` is **stale**: `4.20260730.0` (July) rejects compat dates newer than 2026-08-06 (verified failure).
- Wrangler 4.166 uses **`miniflare@5.20261119.0-beta`** (the `beta` tag). v5 has a new options shape (`{ workers: [{ config: {...} }] }`); it rejects v4 keys like `scriptPath`/`d1Databases`, but ships `convertV4MiniflareOptions`.
- Verified working:

```js
import { Miniflare, convertV4MiniflareOptions } from "miniflare"; // 5.20261119.0-beta
const mf = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  scriptPath: `${root}/dist/workerpool/index.js`,   // output of `vite build`
  modulesRoot: `${root}/dist/workerpool`,           // REQUIRED if scriptPath is outside cwd
  compatibilityDate: "2026-11-15",
  compatibilityFlags: ["nodejs_compat"],
  d1Databases: { DB: "test-db" },                    // in-memory
  bindings: { GARMIN_API_BASE: "https://garmin.mock" },
  outboundService: (req) => new URL(req.url).hostname === "garmin.mock"
    ? Response.json([{ activityId: 9, activityName: "MF Ride", startTimeGMT: "2026-11-03 07:00:00", duration: 100 }])
    : new Response("blocked", { status: 599 }),
}));
const db = await mf.getD1Database("DB");             // run migration statements via db.prepare(s).run()
await mf.dispatchFetch("http://localhost/api/sync", { method: "POST" });
await (await mf.getWorker()).scheduled({ cron: "*/30 * * * *" }); // -> { outcome: "ok", noRetry: false }
await mf.dispose();
```

Recommendation: don't depend on `miniflare` directly. `@cloudflare/vitest-plugin` covers unit and integration needs, and Playwright covers E2E.

### 3.6 E2E with Playwright (verified: 2/2 passing against `vite dev`)

- Local state lives in `.wrangler/state/v3/{d1,r2,kv,do,cache,…}` (gitignore `.wrangler/`).
- `wrangler … --persist-to X` and the Vite plugin's `persistState: { path: X }` both use `X/v3/...`, so they share data (verified).

`playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";
const PORT = 5174;
const PERSIST = ".wrangler/e2e";
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    // sandbox: pre-installed Chromium revision differs from @playwright/test 1.65.1's
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: {
    command:
      `rm -rf ${PERSIST} && wrangler d1 migrations apply DB --local --persist-to ${PERSIST}` +
      ` && wrangler d1 execute DB --local --persist-to ${PERSIST} --file e2e/seed.sql` +
      ` && CF_PERSIST_TO=${PERSIST} vite dev --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { WRANGLER_SEND_METRICS: "false" },
  },
});
```

- Seed with plain SQL (`e2e/seed.sql`). For R2 fixtures use `wrangler r2 object put <bucket>/<key> --local --persist-to X --file f` (verified without `--persist-to`).
- Auth in E2E: set the dev `PASSPHRASE_HASH` in `.dev.vars`, or log in once in a Playwright `setup` project and reuse `storageState`.
- For a production-like E2E, swap the last command for `vite build && wrangler dev --port $PORT --persist-to X` (verified to serve assets and the API).

---

## 4. Background work

### 4.1 Workers platform limits (cloudflare-docs `workers/platform/limits`, Nov 2026)

| | Free | Paid ($5/mo) |
|---|---|---|
| Requests | 100 k/day | unlimited (10 M/mo included) |
| CPU per HTTP request | **10 ms** | 30 s default, up to **5 min** (`limits.cpu_ms`) |
| CPU per Cron invocation | 10 ms | 30 s default (5 min max); **15 min** for crons with an interval of 1 h or more |
| Wall-clock for Cron / Queue consumer / DO alarm | 15 min | 15 min |
| Memory | 128 MB | 128 MB |
| Subrequests (external fetch) per invocation | **50** | **10,000 default** (configurable up to 10 M via `limits.subrequests`). The old "1,000 paid" figure is outdated. |
| Subrequests to Cloudflare services (D1/R2/KV…) | 1,000 | = configured limit |
| Simultaneous open connections | 6 | 6 |
| `ctx.waitUntil()` after response | up to 30 s | up to 30 s |
| Request body | 100 MB (Free/Pro zone) | same, per zone plan |
| Worker size | 64 MiB uncompressed | same |
| Startup time | 1 s | 1 s |
| Cron Triggers | 5 per account | 1,000 per account |
| Static asset files | 20 k (25 MiB each) | 100 k |
| Env vars | 64 per Worker | 128 per Worker |

D1 queries per invocation: 50 Free, 1,000 Paid (batch = 1).

### 4.2 Cron Triggers

- Syntax: standard 5-field cron in **UTC** (`"*/30 * * * *"`, `"17 3 * * *"`). Quartz-style `L`, `W` and `#` are supported (UNVERIFIED in this sandbox). Changes take a few minutes to propagate after deploy.
- Local testing (verified):
  - `vite dev`: `GET /cdn-cgi/handler/scheduled?cron=*/30+*+*+*+*`, or `POST /cdn-cgi/local/explorer/api/local/scheduled?worker=<name>` with JSON `{"cron":"*/30 * * * *"}`.
  - `wrangler dev`: `GET /cdn-cgi/local/scheduled` (new; printed by wrangler) and `/cdn-cgi/handler/scheduled` both work. `--test-scheduled` (`/__scheduled`) still exists.
  - Crons never fire automatically in local dev.
- Keep the cron handler tiny. It should only enqueue durable work (create a Workflow instance with a deterministic id). Then the Free 10 ms or Paid 30 s CPU limit never bites inside the handler.

### 4.3 Options compared for a 3–5 k activity backfill

| | Queues | Workflows | DO alarms |
|---|---|---|---|
| Status | GA; **on Free plan since 2026-02-04** | **GA since 2025-04-07** | GA; SQLite-backed DOs on Free |
| Free limits | 10 k ops/day (about 3 ops/message, so about 3.3 k msgs/day); 24 h retention | 3,000 steps/day; 1,024 steps/instance; **10 ms CPU/step**; 100 concurrent instances; 3-day retention | 10 ms CPU/alarm |
| Paid limits | 1 M ops/mo incl.; 14-day retention; batch ≤ 100 msgs, wait ≤ 60 s, 100 retries max, msg ≤ 128 KB, delay ≤ 24 h, 250 concurrent consumers; consumer CPU 30 s → 5 min | 500 k steps/mo incl.; **10,000 steps/instance default (25 k max)**; 30 s CPU/step (5 min max); unlimited wall-clock per step; step result ≤ 1 MiB; 1 GB state/instance; `step.sleep` ≤ 365 d; sleeps don't count as steps | 30 s CPU (configurable), 15 min wall |
| Local dev | ✔ producer→consumer works in `vite dev` and vitest (verified) | ✔ runs in `vite dev` (verified: 2 steps + sleeps completed) and vitest with introspection/mocking (verified) | ✔ (`runDurableObjectAlarm`) |
| Resumability/state | You keep the cursor in D1 | Built-in: completed steps never re-run; per-step retries with backoff | Hand-rolled |
| Ops tooling | `wrangler queues` | `wrangler workflows instances list/describe/pause/resume/terminate` | none |

### 4.4 Recommended design (Paid plan)

- **One `SyncWorkflow`** serves both modes:
  - `params: { mode: "backfill" | "incremental", before?: string }`
  - steps:
    1. `step.do("list-page-N")` fetches 100 summaries from Garmin and upserts them into D1 in one `batch()`. It returns only the IDs that still need files (small, well under the 1 MiB step result limit).
    2. For each such ID, `step.do("fit-<garminId>", { retries: { limit: 5, delay: "30 seconds", backoff: "exponential" }, timeout: "5 minutes" }, …)` downloads the zip, puts `raw/<id>.zip` in R2, unzips with fflate, parses the FIT, writes `streams/<id>.json.gz` to R2 and the summaries/aggregates to D1 in one batch, and returns `{ ok: true }`.
    3. `step.sleep("pace-N", "2 seconds")` between downloads to be polite to Garmin (sleeps are free and don't count as steps).
  - Make every step **idempotent** (deterministic R2 keys, `ON CONFLICT`), because a step can re-run if it fails after side effects.
- **Cron** `*/30 * * * *` → `env.SYNC_WF.create({ id: "incr-<scheduledTime>", params: { mode: "incremental" } })`. The deterministic id makes duplicate fires no-ops (UNVERIFIED: duplicate-id create semantics).
- **Backfill**: an authenticated `POST /api/backfill` creates `{ id: "backfill-<date>", params: { mode: "backfill" } }`. 5 k activities ≈ 5 k + 50 steps, under the 10 k/instance default. For more history, chain instances by year (or raise `limits.steps` in the workflow binding, up to 25 k).
- Each step does one Garmin fetch plus a few R2/D1 calls, so subrequest limits are irrelevant. CPU per step is about 50–100 ms (FIT parse 20–55 ms + gzip ~37 ms), comfortably inside 30 s.
- Why not Queues: they work, but you'd rebuild cursor state, idempotency bookkeeping and progress UI that Workflows gives you, and testing is less ergonomic. Why not DO alarms: the lowest-level option, so the most code.

### 4.5 Free-plan feasibility, and what Paid buys

The Free plan **cannot parse FIT server-side reliably**: 10 ms CPU per invocation and per Workflow step versus 20–55 ms measured. It also caps Workflows at 3,000 steps/day (a 5 k backfill would take at least 2 days) and 1,024 steps/instance.

A Free-plan fallback that does work:

- Download only on the server: the cron or a Workflow streams each Garmin zip straight into R2 (`env.FILES.put(key, res.body)`, minimal CPU), and stores Garmin's JSON summary fields in D1.
- **Parse FIT in the browser** with `@garmin/fitsdk`, which is pure ESM and also runs in browsers. The SPA computes streams and aggregates and POSTs them back.
- It works, but every analytic depends on a browser visit.

**$5/mo Paid buys:**

- 30 s to 5 min CPU per invocation and per step
- 10 k+ subrequests
- 1,000 D1 queries per invocation
- 10 GB D1 and 30-day Time Travel
- 10 k steps per workflow instance and 500 k steps/mo
- 14-day queue retention
- 20 M log events/mo

**Recommend Paid.**

---

## 5. Auth and secrets

### 5.1 Options

- **Cloudflare Access (zero code):**
  - Dashboard: Workers & Pages → Worker → **Access** tab → "Protect this Worker behind Access" (All traffic or Previews only). It covers custom domains, `workers.dev` and preview URLs.
  - Requires Zero Trust enabled on the account. The Free Zero Trust plan covers small teams; the "up to 50 users free" figure is UNVERIFIED for 2026.
  - In code, `ctx.access?.getIdentity()` returns the identity (email etc.); it is typed in generated runtime types as `ExecutionContext.access`.
  - Local simulation: `"access": { "dev": { "aud": "workerpool", "identity": { "email": "me@example.com" } } }` in `wrangler.jsonc` (documented 2026-08-14; works with `wrangler dev` and the Vite plugin; UNVERIFIED here).
  - Caveat: Worker-level Access breaks WebSockets (403).
- **Built-in passphrase + signed cookie (recommended baseline; verified code below):**
  - `PASSPHRASE_HASH` (a PBKDF2 string) and `SESSION_SECRET` are Worker secrets.
  - `POST /api/login` is guarded by the `ratelimits` binding (verified locally: 5 OK, then 429).
  - On success it sets `session=<payload>.<hmac>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000`.
  - No session storage: the cookie is stateless and HMAC-signed. Revoke everything by rotating `SESSION_SECRET`, so you need neither KV nor D1 for sessions.
- Recommendation: ship the built-in login, because it works identically in Miniflare tests, `vite dev` and E2E. Optionally turn on Access in production for SSO/MFA at zero code cost.
- Passkeys (WebAuthn) are possible later but not researched (UNVERIFIED).

### 5.2 WebCrypto snippets (verified in workerd via vitest)

```ts
const enc = new TextEncoder();
const b64u = {
  enc: (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""),
  dec: (s: string) => Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0)),
};

// PBKDF2-SHA256. PRODUCTION Workers cap iterations at 100_000 (local workerd does NOT enforce the cap —
// verified 100_001 succeeds locally — so never go above 100k or prod will throw).
export const PBKDF2_ITERATIONS = 100_000;
export async function hashPassword(pw: string, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS }, key, 256);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${b64u.enc(salt)}$${b64u.enc(bits)}`;
}
export async function verifyPassword(pw: string, stored: string) {
  const [, iter, s, h] = stored.split("$");
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: b64u.dec(s), iterations: Number(iter) }, key, 256));
  const exp = b64u.dec(h);
  return bits.length === exp.length && crypto.subtle.timingSafeEqual(bits, exp); // workerd extension
}

// Session cookie: base64url(JSON).base64url(HMAC-SHA256)
const hmacKey = (secret: string) => crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
export async function signSession(p: { sub: string; exp: number }, secret: string) {
  const body = b64u.enc(enc.encode(JSON.stringify(p)));
  return `${body}.${b64u.enc(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body)))}`;
}
export async function verifySession(tok: string, secret: string) {
  const [body, sig] = tok.split(".");
  if (!body || !sig) return null;
  if (!(await crypto.subtle.verify("HMAC", await hmacKey(secret), b64u.dec(sig), enc.encode(body)))) return null;
  const p = JSON.parse(new TextDecoder().decode(b64u.dec(body)));
  return p.exp > Date.now() / 1000 ? p : null;
}

// AES-256-GCM at rest for Garmin tokens. TOKEN_ENC_KEY = 32 random bytes, base64url, a Worker secret.
const aesKey = (k: string) => crypto.subtle.importKey("raw", b64u.dec(k), "AES-GCM", false, ["encrypt", "decrypt"]);
export async function encryptString(plain: string, k: string, aad = "garmin-tokens:v1") {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, await aesKey(k), enc.encode(plain));
  return `v1.${b64u.enc(iv)}.${b64u.enc(ct)}`;      // store this TEXT in D1
}
export async function decryptString(blob: string, k: string, aad = "garmin-tokens:v1") {
  const [v, iv, ct] = blob.split(".");
  if (v !== "v1") throw new Error("unknown ciphertext version");
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64u.dec(iv), additionalData: enc.encode(aad) }, await aesKey(k), b64u.dec(ct)));
}
```

- Generate the key once: `node -e "console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'))"`.
- The version prefix (`v1.`) leaves room for key rotation later.

### 5.3 Where secrets live

- Production: `wrangler secret put SESSION_SECRET` (plus `--env staging`), or `wrangler secret bulk secrets.json`. Declare them under `"secrets": { "required": [...] }` so that `wrangler types` types them and dev warns when one is missing.
- Local: `apps/web/.dev.vars` (dotenv format, **gitignored**). Note that `vite build` copies `.dev.vars` into `dist/<worker>/` (verified), so `dist/` must also be gitignored. `wrangler deploy` doesn't upload it as a secret.
- Tests: values in `cloudflareTest({ miniflare: { bindings } })`; these win over `.dev.vars` (verified).

---

## 6. Parsing Garmin FIT files in a Worker

Both parsers below were verified to run inside workerd (vitest-plugin, `nodejs_compat`) on a 3 h, 1 Hz file with 10,800 records, with 0 decode errors:

| Package | Version | Format | Min / gzip bundle | CPU per 3 h file (workerd, warm → cold) | Notes |
|---|---|---|---|---|---|
| **`@garmin/fitsdk`** (official) | 21.222.0 | pure ESM, no deps, `.d.ts` included | 435 KB / 64 KB | 39–55 ms | **Recommended.** Official Garmin profile, has both decoder and encoder (used to generate test fixtures), `Decoder.read({ convertDateTimesToDates, applyScaleAndOffset, expandComponents, mergeHeartRates })` → `messages.recordMesgs/lapMesgs/sessionMesgs`. License: Garmin FIT SDK license (not MIT); read `LICENSE.txt`. |
| `fit-file-parser` | 6.2.10 | ESM + CJS, depends on `buffer` | 297 KB / 62 KB | 19–34 ms | A bit faster, community-maintained; `parseAsync(arrayBuffer)` with `mode: "list"`. |
| `fflate` | 0.8.3 | pure ESM | 11 KB / 5 KB | unzip of a 176 KB zip: about 11 ms; gzip of 650 KB JSON: about 37 ms | Use `unzipSync(new Uint8Array(await res.arrayBuffer()))` for Garmin's zipped "original" downloads and `gzipSync` for streams. |

- CPU conclusion: about 50–100 ms per activity end to end. That is fine on Paid (30 s/step) and **not** on Free (10 ms).
- Memory: a 1.5 MB FIT turns into about 10 k JS objects (tens of MB at most), well under 128 MB, but process one activity per step.
- Fixtures: generate deterministic test FIT files with `new Encoder()` from `@garmin/fitsdk` (verified in Node) and commit a small one under `test/fixtures`.
- In vitest, load binary fixtures with `miniflare: { dataBlobBindings: { FIT: "<abs path>" } }` (verified; the binding is an `ArrayBuffer`).

---

## 7. Observability and deploy

- **Logs:**
  - `observability: { enabled: true, head_sampling_rate: 1 }` turns on Workers Logs (`console.log` and invocation logs, queryable in the dashboard). 7-day retention, max 256 KB per log line.
  - Pricing: 20 M logs/mo included on Paid, then $0.60/M. The rates page shows 200 k events/day on Free (pricing pages disagree on units; UNVERIFIED).
  - `observability.logs.invocation_logs: false` reduces volume.
  - `wrangler tail` streams live logs.
  - Locally, the explorer API can query captured logs and spans (`/cdn-cgi/local/explorer/api/local/observability/query`).
- **Source maps:** `upload_source_maps: true` (the default for `wrangler deploy` now). `vite build` emits `index.js.map` next to the Worker (verified).
- **Types:** `wrangler types` (re-run after every `wrangler.jsonc` change) and `wrangler types --check` in CI.
- **Deploy:** `pnpm --filter @app/web deploy` (`vite build && wrangler deploy`).
  - Staging: `CLOUDFLARE_ENV=staging vite build && wrangler deploy`.
  - Remote migrations: `wrangler d1 migrations apply DB --remote [--env staging]`, run **before** deploying code that needs them.
  - `wrangler deploy --dry-run` works offline (verified; it lists bindings and the upload size of about 232 KiB, 55 KiB gzipped).
  - Rollback: `wrangler rollback`. Versioned uploads: `wrangler versions upload/deploy`.
  - `wrangler preview` (open beta) creates preview deployments; `preview_urls` controls version preview URLs.
- **Custom domain:** `"routes": [{ "pattern": "train.example.com", "custom_domain": true }]` (the zone must be on Cloudflare) and `"workers_dev": false`.
- **GitHub Actions** (`cloudflare/wrangler-action@v4` is current; UNVERIFIED end to end here):

```yaml
name: ci
on: { push: { branches: [main] }, pull_request: {} }
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm --filter @app/web exec playwright install --with-deps chromium
      - run: pnpm e2e
        env: { CI: "1", WRANGLER_SEND_METRICS: "false" }
  deploy:
    if: github.ref == 'refs/heads/main'
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @app/web build
      - uses: cloudflare/wrangler-action@v4
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: apps/web
          packageManager: pnpm
          command: |
            d1 migrations apply DB --remote
            deploy
```

- **D1 backups / export:**
  - **Time Travel** is always on (7 days Free / 30 days Paid). Use `wrangler d1 time-travel info DB [--timestamp …]` and `wrangler d1 time-travel restore DB --bookmark <b> | --timestamp <unix|iso>`.
  - Portable export: `wrangler d1 export DB --remote --output backup-$(date +%F).sql` (`--no-data`, `--no-schema`, `--table`; `--compatibility sqlite3_cli_only` makes a file sqlite3 can import but D1 can't). Exports are not subject to the 50 MB result cap.
  - Put a weekly export in a scheduled GitHub Action that uploads the SQL to R2 or as an artifact. R2 objects need no backup beyond optional bucket versioning/lifecycle.

---

## 8. Version pin table (installed together and verified, 2026-11-21)

| Package | Pin | Notes / peer deps (from `npm view … peerDependencies`) |
|---|---|---|
| wrangler | **4.166.0** | Node ≥ 22.12; bundles `miniflare@5.20261119.0-beta` and `workerd@1.20261119.1`; optional peer `@cloudflare/workers-types ^5.20261119.1` (don't install it; use `wrangler types`) |
| miniflare | (don't install) | If needed: **5.20261119.0-beta** (`beta` tag; v5 API, use `convertV4MiniflareOptions`). `latest` = 4.20260730.0 is stale and fails with compat dates > 2026-08-06 |
| @cloudflare/vite-plugin | **1.70.1** | peers `vite ^6.1 \|\| ^7 \|\| ^8`, `wrangler ^4.164.0`; bundles its own wrangler 4.164.0 / workerd 1.20261117.1, so keep compat date ≤ 2026-11-17. 2.0.0-rc.3 exists, don't use it |
| @cloudflare/vitest-plugin | **1.9.0** | peers `vitest ^4.1.0 \|\| ^5.0.0`. **Replaces** `@cloudflare/vitest-pool-workers` (deprecated at 0.23.0, vitest ^4.1 only) |
| vitest | **5.1.1** | — |
| vite | **8.3.8** | — |
| hono | **4.13.19** | `hc` client from `hono/client` (verified typed end to end) |
| @hono/zod-validator | **0.9.1** | peers `zod ^3.25 \|\| ^4`, `hono >=4.11.2`. Alternative: `@hono/standard-validator@0.4.1` |
| zod | **4.6.7** | `z.iso.datetime()` etc.; about 450 KB min / 92 KB gzip in the Worker bundle (fine) |
| drizzle-orm | **0.45.4** | `drizzle-orm/d1`; v1 is still `rc` |
| drizzle-kit | **0.31.11** | Prints deprecation warnings for `@esbuild-kit/*` subdeps (harmless) |
| typescript | **7.0.2** | Native compiler; `tsc` verified for worker + app. **Has no JS API** (`require('typescript').createProgram` is undefined). `typescript-eslint@8.73.0` peers `typescript >=4.8.4 <6.1.0`, so if you want typescript-eslint, pin **typescript 6.0.3** instead, or lint with Biome 2.6.8 / oxlint 1.94.0 |
| @cloudflare/workers-types | **don't use** | `wrangler types` generates runtime + binding types |
| react / react-dom | **19.3.1** | @types/react 19.3.0, @types/react-dom 19.3.0 |
| @vitejs/plugin-react | **6.3.0** | peers **`vite ^8.0.0` only** (optional peers: babel/react-compiler) |
| tailwindcss / @tailwindcss/vite | **4.3.5 / 4.3.5** | peers `vite ^5.2 \|\| ^6 \|\| ^7 \|\| ^8` |
| @playwright/test | **1.65.1** | Wants chromium rev 1255. The sandbox has 1243 (playwright 1.63.0 global), so use `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium` (or pin `@playwright/test@1.63.0` to match the sandbox browser) |
| msw / @msw/cloudflare | **3.0.7 / 0.2.0** | msw peers `vite >=6`, `typescript >=5.9` |
| @garmin/fitsdk | **21.222.0** | pure ESM |
| fflate | **0.8.3** | — |
| @types/node | **22.20.5** | needed with `nodejs_compat` |

Known incompatibilities today:

1. `@cloudflare/vitest-pool-workers` doesn't support vitest 5. Use `@cloudflare/vitest-plugin`.
2. `@vitejs/plugin-react@6` requires vite 8.
3. TypeScript 7 breaks anything that needs the TS compiler API (typescript-eslint, ts-morph and similar).
4. Standalone `miniflare@latest` (4.x) is too old for current compat dates.
5. The Vite plugin's nested workerd is two days behind wrangler's.

No other peer conflicts were reported by `pnpm install`.

---

## 9. Sandbox notes: commands that worked here

Environment flags used everywhere: `WRANGLER_SEND_METRICS=false` (telemetry off) and `CI=1` (non-interactive; migrations auto-confirm). Harmless noise seen in this sandbox:

- "Proxy environment variables detected".
- "Unable to fetch the `Request.cf` object! Falling back to a default placeholder" (outbound to Cloudflare is blocked; dev still works).
- Scheduled handlers calling non-resolvable hosts log `failed to lookup address information`.

```bash
# install (pnpm 10; workerd/esbuild need onlyBuiltDependencies in pnpm-workspace.yaml)
pnpm install

# types + typecheck
pnpm --filter @app/web exec wrangler types
pnpm -r typecheck                                   # wrangler types --check && tsc -p … (TS 7.0.2)

# unit/integration tests in workerd (offline) — 20 tests, ~7-8 s
WRANGLER_SEND_METRICS=false CI=1 pnpm -r test

# local DB
cd apps/web
WRANGLER_SEND_METRICS=false CI=1 npx wrangler d1 migrations apply DB --local
npx wrangler d1 execute DB --local --file=seed.sql
npx wrangler d1 execute DB --local --command "SELECT count(*) n FROM activities" --json

# dev server (Vite + Worker in workerd); API + SPA fallback on one port
WRANGLER_SEND_METRICS=false npx vite dev --port 5173 --strictPort
curl localhost:5173/api/health                      # {"ok":true}
curl "localhost:5173/cdn-cgi/handler/scheduled?cron=*/30+*+*+*+*"   # fire cron locally

# production build served by wrangler / vite preview
npx vite build && npx wrangler dev --port 8787 --ip 127.0.0.1
curl 127.0.0.1:8787/cdn-cgi/local/scheduled
npx vite preview --port 4173 --strictPort
npx wrangler deploy --dry-run                       # offline check

# E2E (Playwright launches/stops vite dev itself, seeds .wrangler/e2e)
PW_CHROMIUM_PATH=/opt/pw-browsers/chromium CI=1 WRANGLER_SEND_METRICS=false pnpm e2e   # 2 passed (~7-9 s)

# drizzle
npx drizzle-kit generate --name init                # -> migrations/0000_init.sql (+ meta/)
```

Process cleanup: killing `vite dev` by `pkill -f "vite dev"` misses the real process (`node …/vite.js dev`). Use `pgrep -f "vite.js dev" | xargs -r kill` and `pgrep -f workerd | xargs -r kill`. `wrangler dev` runs as `wrangler.js dev`. Playwright's `webServer` cleans up after itself.

---

## 10. Sources

- cloudflare-docs (GitHub raw): `workers/platform/limits.mdx`, `d1/platform/limits.mdx`, `workflows/reference/limits.mdx`, `queues/platform/limits.mdx`, `r2/pricing.mdx`, `workers/observability/logs/workers-logs.mdx`, `workers/configuration/cloudflare-access.mdx`
- Changelog: `@cloudflare/vitest-pool-workers is now @cloudflare/vitest-plugin` (2026-08-19); Queues on Workers Free (2026-02-04); Workflows GA (2025-04-07); D1 free-tier enforcement (2026-09-01); Workers + Access (2026-08-14)
- Vitest integration: "mock outbound requests" guide (MSW + `@msw/cloudflare`); `workers-sdk/fixtures/vitest-plugin-examples`
- Package READMEs and type definitions read from the installed tarballs: `@cloudflare/vitest-plugin` (`types/cloudflare-test.d.ts`), `@cloudflare/vite-plugin` (`dist/index.d.mts`), `miniflare@5` (`dist/src/index.d.ts`), `wrangler/config-schema.json`, `@garmin/fitsdk` README, `create-cloudflare@2.75.0` React/Hono templates
- workerd PBKDF2 iteration cap discussion: workerd issue #1346
- `cloudflare/wrangler-action` README (v4)
- `cf` CLI / `cloudflare.config.ts` docs (beta; Wrangler does not read it)
