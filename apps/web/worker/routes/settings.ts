import { Hono } from 'hono';
import { z } from 'zod';
import { LocalDate, SPORTS, Settings, Sport, Threshold, type ThresholdKind, type ThresholdSnapshot } from '@cadence/core/domain';
import {
  HR_ZONES_FRIEL_BIKE,
  HR_ZONES_FRIEL_RUN,
  HR_ZONES_PCT_MAX,
  PACE_ZONES_FRIEL,
  POWER_ZONES_COGGAN,
  ROW_ZONES,
  SWIM_ZONES_CSS,
  defaultThresholds,
  resolveThresholds,
  resolveZones,
  zoneDisplayRanges,
  type ZoneModel,
} from '@cadence/core/metrics';
import type { AppEnv } from '../env';
import { badRequest, notFound } from '../lib/http';
import { getSettings, updateSettings } from '../db/settings';
import { deleteThreshold, insertThreshold, listThresholds } from '../db/thresholds';
import { getToday, validate } from '../services/context';
import { rederiveWorkouts } from '../services/planning';
import { recomputeActivities } from '../services/ingest';

/** Allowed sports and plausible value ranges per threshold kind. */
const KIND_RULES: Record<ThresholdKind, { sports: readonly (Sport | 'all')[]; min: number; max: number; unit: string }> = {
  ftp: { sports: ['bike'], min: 30, max: 1000, unit: 'W' },
  run_threshold: { sports: ['run'], min: 1, max: 8, unit: 'm/s' },
  swim_css: { sports: ['swim'], min: 0.3, max: 3, unit: 'm/s' },
  row_threshold: { sports: ['row'], min: 30, max: 1000, unit: 'W' },
  lthr: { sports: ['all', ...SPORTS], min: 60, max: 230, unit: 'bpm' },
  hr_max: { sports: ['all', ...SPORTS], min: 90, max: 240, unit: 'bpm' },
  hr_rest: { sports: ['all', ...SPORTS], min: 20, max: 120, unit: 'bpm' },
  weight: { sports: ['all'], min: 20, max: 300, unit: 'kg' },
};

const ThresholdInput = Threshold.omit({ id: true }).extend({ source: Threshold.shape.source.default('manual') });

/** Which activity sport a threshold change affects (undefined = all sports). */
function affectedSport(t: Pick<Threshold, 'kind' | 'sport'>): Sport | undefined {
  if (t.kind === 'weight') return undefined;
  return t.sport === 'all' ? undefined : t.sport;
}

interface ZoneTable {
  model: string;
  basis: ZoneModel['basis'];
  unit: ZoneModel['unit'];
  threshold: number;
  defaulted: boolean;
  zones: Array<{ zone: number; label: string; name: string; low: number | null; high: number | null }>;
}

function table(model: ZoneModel, threshold: number | undefined, defaulted: boolean): ZoneTable | null {
  if (!threshold || !(threshold > 0)) return null;
  let ranges: Array<{ label: string; name: string; low: number | null; high: number | null }>;
  if (model.unit === 'mps') {
    // speeds are not integers: report exact m/s bounds (3 decimals)
    const r = resolveZones(model, threshold)!;
    const round = (x: number) => Math.round(x * 1000) / 1000;
    ranges = r.lows.map((low, k) => ({
      label: model.labels[k],
      name: model.names[k],
      low: k === 0 && low === 0 ? null : round(low),
      high: k + 1 < r.lows.length ? round(r.lows[k + 1]) : null,
    }));
  } else ranges = zoneDisplayRanges(model, threshold);
  return {
    model: model.id,
    basis: model.basis,
    unit: model.unit,
    threshold,
    defaulted,
    zones: ranges.map((z, i) => ({ zone: i + 1, ...z })),
  };
}

const ZONE_SPORTS = ['bike', 'run', 'swim', 'row', 'other'] as const;

function zonesFor(all: Threshold[], date: LocalDate, sport: (typeof ZONE_SPORTS)[number], age?: number) {
  const actual = resolveThresholds(all, date, sport);
  const { snapshot, defaulted } = defaultThresholds(actual, { sport, age });
  const isDefault = (k: keyof ThresholdSnapshot) => defaulted.includes(k);
  const hr =
    actual.lthr || !actual.hrMax
      ? table(sport === 'bike' ? HR_ZONES_FRIEL_BIKE : HR_ZONES_FRIEL_RUN, snapshot.lthr, isDefault('lthr'))
      : table(HR_ZONES_PCT_MAX, actual.hrMax, false);
  const power =
    sport === 'bike' ? table(POWER_ZONES_COGGAN, snapshot.ftp, isDefault('ftp')) : sport === 'row' ? table(ROW_ZONES, actual.rowThresholdW, false) : null;
  const pace =
    sport === 'run' ? table(PACE_ZONES_FRIEL, actual.runThresholdMps, false) : sport === 'swim' ? table(SWIM_ZONES_CSS, actual.swimCssMps, false) : null;
  return { thresholds: actual, defaulted, hr, power, pace };
}

/** Mounted at /api — define full paths here (see docs/ARCHITECTURE.md → API surface). */
export const settingsRoutes = new Hono<AppEnv>()
  .get('/settings', async (c) => c.json(await getSettings(c.env.DB)))
  .patch('/settings', validate('json', Settings.partial()), async (c) => {
    const patch = c.req.valid('json');
    if (patch.timezone) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: patch.timezone });
      } catch {
        throw badRequest(`Unknown timezone ${patch.timezone}`, 'validation');
      }
    }
    return c.json(await updateSettings(c.env.DB, patch));
  })
  .get('/thresholds', async (c) => c.json(await listThresholds(c.env.DB)))
  .get('/thresholds/current', async (c) => {
    const date = await getToday(c.env);
    const all = await listThresholds(c.env.DB);
    const out = {} as Record<Sport, ThresholdSnapshot>;
    for (const s of SPORTS) out[s] = resolveThresholds(all, date, s);
    return c.json({ date, sports: out });
  })
  .post('/thresholds', validate('json', ThresholdInput), async (c) => {
    const input = c.req.valid('json');
    const rule = KIND_RULES[input.kind];
    if (!rule.sports.includes(input.sport)) {
      throw badRequest(`${input.kind} applies to ${rule.sports.slice(0, 3).join('/')}${rule.sports.length > 3 ? '…' : ''}, not ${input.sport}`, 'validation');
    }
    if (input.value < rule.min || input.value > rule.max) {
      throw badRequest(`${input.kind} must be between ${rule.min} and ${rule.max} ${rule.unit}`, 'validation');
    }
    const saved = await insertThreshold(c.env.DB, input);
    const sport = affectedSport(saved);
    c.executionCtx.waitUntil(afterThresholdChange(c.env, saved.effectiveFrom, sport));
    return c.json(saved, 201);
  })
  .delete('/thresholds/:id', async (c) => {
    const removed = await deleteThreshold(c.env.DB, c.req.param('id'));
    if (!removed) throw notFound('Threshold');
    c.executionCtx.waitUntil(afterThresholdChange(c.env, removed.effectiveFrom, affectedSport(removed)));
    return c.json(removed);
  })
  .get('/zones', validate('query', z.object({ date: LocalDate.optional() })), async (c) => {
    const date = c.req.valid('query').date ?? (await getToday(c.env));
    const [all, settings] = await Promise.all([listThresholds(c.env.DB), getSettings(c.env.DB)]);
    const age = settings.birthYear ? Number(date.slice(0, 4)) - settings.birthYear : undefined;
    const sports = {} as Record<(typeof ZONE_SPORTS)[number], ReturnType<typeof zonesFor>>;
    for (const s of ZONE_SPORTS) sports[s] = zonesFor(all, date, s, age);
    return c.json({ date, sports });
  });

/** Background work after a threshold insert/delete: recompute activity metrics and planned totals. */
async function afterThresholdChange(env: Env, from: LocalDate, sport: Sport | undefined): Promise<void> {
  const tasks: Promise<unknown>[] = [rederiveWorkouts(env, { from, sport })];
  tasks.push(
    (async () => {
      let cursor: string | undefined;
      for (let i = 0; i < 20; i++) {
        const r = await recomputeActivities(env, { from, sport, cursor });
        if (!r.nextCursor) break;
        cursor = r.nextCursor;
      }
    })(),
  );
  const results = await Promise.allSettled(tasks);
  for (const r of results) if (r.status === 'rejected') console.error('threshold recompute failed', r.reason);
}
