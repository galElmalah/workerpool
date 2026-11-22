import { Hono } from 'hono';
import { z } from 'zod';
import { IntensityClass, LocalDate, Sport, Template, WorkoutStructure, type PlannedWorkout } from '@cadence/core/domain';
import { STARTER_TEMPLATES } from '@cadence/core/workout';
import type { AppEnv } from '../env';
import { badRequest, notFound } from '../lib/http';
import { newId, nowIso } from '../lib/ids';
import { first, run } from '../db/sql';
import { thresholdsOn } from '../db/thresholds';
import { getWorkout, listWorkouts } from '../db/workouts';
import {
  bumpTemplateUsage,
  countTemplates,
  deleteTemplate,
  getTemplate,
  insertTemplates,
  insertTemplatesIfMissing,
  listTemplates,
} from '../db/templates';
import { getToday, validate } from '../services/context';
import { checkStructure, createWorkout, deriveWorkout } from '../services/planning';
import { withCompliance } from '../services/compliance';
import { rePairDates } from '../services/pairing';

const TemplateInput = Template.omit({ id: true, usageCount: true, lastUsedAt: true, createdAt: true, updatedAt: true }).partial({
  intensity: true,
  tags: true,
});

const TemplatePatch = TemplateInput.partial().extend({
  subSport: Template.shape.subSport.unwrap().nullable().optional(),
  description: z.string().nullable().optional(),
  plannedDurationSec: z.number().nonnegative().nullable().optional(),
  plannedDistanceM: z.number().nonnegative().nullable().optional(),
  plannedLoad: z.number().nonnegative().nullable().optional(),
  plannedIntensityFactor: z.number().nonnegative().nullable().optional(),
  structure: WorkoutStructure.nullable().optional(),
  folder: z.string().nullable().optional(),
});

const SEEDED_KEY = 'library.seeded';

/** Strip the stored-only sparkline so responses match the domain Template. */
function clean(t: Template & { sparkline?: number[] }): Template {
  const { sparkline: _s, ...rest } = t;
  return rest;
}

async function derive(env: Env, t: Template, flags: { title: boolean; intensity: boolean; unstructured: boolean }): Promise<Template> {
  const th = await thresholdsOn(env.DB, await getToday(env), t.sport);
  const out = deriveWorkout(t, th, flags);
  if (!out.structure) delete out.structure;
  return out;
}

/** Install the core starter library (idempotent: deterministic ids `tpl_<key>`). */
async function seedStarter(env: Env): Promise<number> {
  const today = await getToday(env);
  const now = nowIso();
  const rows: Template[] = [];
  for (const s of STARTER_TEMPLATES) {
    const th = await thresholdsOn(env.DB, today, s.sport);
    const base: Template = {
      id: `tpl_${s.key}`,
      sport: s.sport,
      ...(s.subSport ? { subSport: s.subSport } : {}),
      title: s.title,
      description: s.description,
      structure: s.structure,
      intensity: s.intensity,
      tags: s.isKey && !s.tags.includes('key') ? [...s.tags, 'key'] : [...s.tags],
      folder: s.folder,
      usageCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    rows.push(deriveWorkout(base, th, { title: false, intensity: false, unstructured: true }));
  }
  const n = await insertTemplatesIfMissing(env.DB, rows);
  await markSeeded(env.DB);
  return n;
}

async function markSeeded(db: D1Database): Promise<void> {
  await run(
    db,
    `INSERT INTO sync_state (key, value, updated_at) VALUES (?, 'true', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    SEEDED_KEY,
    nowIso(),
  );
}

async function mustGet(env: Env, id: string): Promise<Template> {
  const t = await getTemplate(env.DB, id);
  if (!t) throw notFound('Template');
  return t;
}

/** Mounted at /api — define full paths here (see docs/ARCHITECTURE.md → API surface). */
export const templatesRoutes = new Hono<AppEnv>()
  .get(
    '/templates',
    validate('query', z.object({ sport: Sport.optional(), intensity: IntensityClass.optional(), q: z.string().max(200).optional(), folder: z.string().optional() })),
    async (c) => {
      const seeded = await first(c.env.DB, 'SELECT key FROM sync_state WHERE key = ?', SEEDED_KEY);
      if (!seeded) {
        if ((await countTemplates(c.env.DB)) === 0) await seedStarter(c.env);
        else await markSeeded(c.env.DB);
      }
      return c.json(await listTemplates(c.env.DB, c.req.valid('query')));
    },
  )
  .post('/templates', validate('json', TemplateInput), async (c) => {
    const input = c.req.valid('json');
    const now = nowIso();
    const structure = input.structure?.steps.length ? checkStructure(input.structure, input.sport) : undefined;
    const base: Template = {
      ...input,
      id: newId('tpl'),
      title: input.title.trim(),
      intensity: input.intensity ?? 'endurance',
      tags: input.tags ?? [],
      usageCount: 0,
      createdAt: now,
      updatedAt: now,
      ...(structure ? { structure } : {}),
    };
    if (!structure) delete base.structure;
    const t = await derive(c.env, base, {
      title: !base.title,
      intensity: !!structure && input.intensity === undefined,
      unstructured: input.plannedLoad === undefined,
    });
    await insertTemplates(c.env.DB, [t]);
    return c.json(clean(t), 201);
  })
  .post('/templates/seed-starter', async (c) => {
    const installed = await seedStarter(c.env);
    return c.json({ installed, templates: await listTemplates(c.env.DB) });
  })
  .post('/templates/restore', validate('json', z.object({ templates: z.array(Template).max(500) })), async (c) => {
    const templates = c.req.valid('json').templates;
    await insertTemplates(c.env.DB, templates);
    return c.json({ restored: await listTemplates(c.env.DB, { ids: templates.map((t) => t.id).slice(0, 90) }) });
  })
  .post('/templates/from-workout/:id', validate('json', z.object({ title: z.string().optional(), folder: z.string().optional() }).optional()), async (c) => {
    const w = await getWorkout(c.env.DB, c.req.param('id'));
    if (!w) throw notFound('Workout');
    const body = c.req.valid('json') ?? {};
    const now = nowIso();
    const t: Template = {
      id: newId('tpl'),
      sport: w.sport,
      ...(w.subSport ? { subSport: w.subSport } : {}),
      title: body.title?.trim() || w.title,
      ...(w.description ? { description: w.description } : {}),
      ...(w.plannedDurationSec !== undefined ? { plannedDurationSec: w.plannedDurationSec } : {}),
      ...(w.plannedDistanceM !== undefined ? { plannedDistanceM: w.plannedDistanceM } : {}),
      ...(w.plannedLoad !== undefined ? { plannedLoad: w.plannedLoad } : {}),
      ...(w.plannedIntensityFactor !== undefined ? { plannedIntensityFactor: w.plannedIntensityFactor } : {}),
      ...(w.structure ? { structure: w.structure } : {}),
      intensity: w.intensity,
      tags: w.isKey && !w.tags.includes('key') ? [...w.tags, 'key'] : [...w.tags],
      ...(body.folder ? { folder: body.folder } : {}),
      usageCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    const derived = w.structure ? await derive(c.env, t, { title: false, intensity: false, unstructured: false }) : t;
    await insertTemplates(c.env.DB, [derived]);
    return c.json(clean(derived), 201);
  })
  .get('/templates/:id', async (c) => c.json(await mustGet(c.env, c.req.param('id'))))
  .patch('/templates/:id', validate('json', TemplatePatch), async (c) => {
    const cur = await mustGet(c.env, c.req.param('id'));
    const patch = c.req.valid('json');
    const next: Record<string, unknown> = { ...cur };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      if (v === null) delete next[k];
      else next[k] = v;
    }
    next.updatedAt = nowIso();
    const t = next as Template;
    if (t.structure?.steps.length) t.structure = checkStructure(t.structure, t.sport);
    const changed = patch.structure !== undefined || patch.sport !== undefined;
    const unstructured =
      patch.plannedDurationSec !== undefined || patch.plannedDistanceM !== undefined || patch.intensity !== undefined || patch.structure === null;
    const userLoad = !t.structure?.steps.length && patch.plannedLoad != null;
    const out = await derive(c.env, t, {
      title: patch.title !== undefined && !patch.title.trim(),
      intensity: changed && patch.intensity === undefined,
      unstructured: unstructured && !userLoad,
    });
    if (userLoad) out.plannedLoad = patch.plannedLoad!;
    await insertTemplates(c.env.DB, [out]);
    return c.json(clean(out));
  })
  .delete('/templates/:id', async (c) => {
    const t = await mustGet(c.env, c.req.param('id'));
    await deleteTemplate(c.env.DB, t.id);
    return c.json(t);
  })
  .post(
    '/templates/:id/schedule',
    validate(
      'json',
      z
        .object({ date: LocalDate.optional(), dates: z.array(LocalDate).max(60).optional(), startTime: z.string().regex(/^\d{2}:\d{2}$/).optional() })
        .refine((b) => b.date || b.dates?.length, 'Give a date or dates'),
    ),
    async (c) => {
      const t = await mustGet(c.env, c.req.param('id'));
      const body = c.req.valid('json');
      const dates = [...new Set([...(body.date ? [body.date] : []), ...(body.dates ?? [])])].sort();
      if (!dates.length) throw badRequest('Give a date', 'validation');
      const created: PlannedWorkout[] = [];
      for (const date of dates) {
        created.push(
          await createWorkout(c.env, {
            date,
            ...(body.startTime ? { startTime: body.startTime } : {}),
            sport: t.sport,
            ...(t.subSport ? { subSport: t.subSport } : {}),
            title: t.title,
            ...(t.description ? { description: t.description } : {}),
            ...(t.structure ? { structure: t.structure } : {}),
            ...(!t.structure && t.plannedDurationSec !== undefined ? { plannedDurationSec: t.plannedDurationSec } : {}),
            ...(!t.structure && t.plannedDistanceM !== undefined ? { plannedDistanceM: t.plannedDistanceM } : {}),
            ...(!t.structure && t.plannedLoad !== undefined ? { plannedLoad: t.plannedLoad } : {}),
            intensity: t.intensity,
            isKey: t.tags.includes('key'),
            tags: t.tags.filter((x) => x !== 'key'),
            templateId: t.id,
          }),
        );
      }
      await bumpTemplateUsage(c.env.DB, t.id, created.length, nowIso());
      await rePairDates(c.env, dates);
      const stored = await listWorkouts(c.env.DB, { ids: created.map((w) => w.id) });
      const byId = new Map(stored.map((w) => [w.id, w]));
      const fresh = created.map((w) => byId.get(w.id) ?? w);
      return c.json({ workouts: await withCompliance(c.env, fresh), template: await mustGet(c.env, t.id) }, 201);
    },
  );
