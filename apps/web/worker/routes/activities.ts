import { Hono } from 'hono';
import { z } from 'zod';
import {
  ActivityPatch,
  IntensityClass,
  LocalDate,
  ManualActivityInput,
  Sport,
  STREAM_CHANNELS,
  type Activity,
  type ActivityDetail,
  type ActivityStreams,
} from '@cadence/core/domain';
import { decoupling, lttb, weightedPower } from '@cadence/core/metrics';
import { unplannedCompliance } from '@cadence/core/workout';
import { extractFitFromDownload, isFitBytes } from '@cadence/garmin';
import type { AppEnv } from '../env';
import {
  findPreviousSimilar,
  getActivity,
  getActivityFull,
  restoreActivity,
  searchActivities,
  softDeleteActivity,
  updateActivityUserFields,
} from '../db/activities';
import { decodeStreams, getFile, getStreams, getStreamsBlob } from '../db/streams';
import { getSettings } from '../db/settings';
import { getWorkout, listWorkouts } from '../db/workouts';
import { badRequest, notFound, ApiError } from '../lib/http';
import { getToday, validate } from '../services/context';
import { decorateActivities, withCompliance } from '../services/compliance';
import { elevationGainOf, ingestActivity, recomputeActivity } from '../services/ingest';
import { autoPairDates } from '../services/pairing';
import { bodyBytes } from '../lib/bytes';
import { MAX_UPLOAD_BYTES, limitBody } from '../middleware/limits';

const ListQuery = z.object({
  from: LocalDate.optional(),
  to: LocalDate.optional(),
  sport: Sport.optional(),
  q: z.string().max(200).optional(),
  key: z.enum(['1', '0', 'true', 'false']).optional(),
  intensity: IntensityClass.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
});

const StreamsQuery = z.object({ maxPoints: z.coerce.number().int().min(10).max(100_000).optional() });
const SelectionQuery = z.object({ startSec: z.coerce.number().min(0), endSec: z.coerce.number().min(0) });

/** ActivityPatch plus the manual load override (null clears it). */
const Patch = ActivityPatch.extend({ loadManual: z.number().nonnegative().nullable().optional() });

/** Attach compliance (paired → the plan's, else unplanned). */
async function decorate(env: Env, items: Activity[]): Promise<Activity[]> {
  const ids = items.map((a) => a.pairedWorkoutId).filter((x): x is string => !!x);
  if (!ids.length) return items.map((a) => ({ ...a, compliance: unplannedCompliance() }));
  const [today, workouts] = await Promise.all([getToday(env), listWorkouts(env.DB, { ids })]);
  return decorateActivities(items, workouts, [], today);
}

async function decorated(env: Env, id: string): Promise<Activity> {
  const a = await getActivity(env.DB, id);
  if (!a) throw notFound('Activity');
  return (await decorate(env, [a]))[0];
}

async function requireStreams(db: D1Database, id: string): Promise<ActivityStreams> {
  const a = await getActivity(db, id);
  if (!a) throw notFound('Activity');
  const s = a.hasStreams ? await getStreams(db, id) : null;
  if (!s) throw notFound('Streams');
  return s;
}

/** Offset (minutes) of an IANA zone at a local wall time. */
function tzOffsetMin(timeZone: string, date: string, time: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const at = (ms: number) => {
      const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
      return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - ms) / 60_000;
    };
    const first = at(guess);
    return at(guess - first * 60_000);
  } catch {
    return 0;
  }
}

/** LTTB per channel (budget split across channels), union of picked indices. */
export function thinStreams(s: ActivityStreams, maxPoints: number): ActivityStreams {
  const n = s.t.length;
  if (n <= maxPoints) return s;
  const channels = (['power', 'hr', 'speed', 'cadence', 'altitude'] as const).filter((c) => s[c]?.some((v) => v !== null));
  const picked = new Set<number>([0, n - 1]);
  const idx = Array.from({ length: n }, (_, i) => i);
  if (channels.length) {
    const budget = Math.max(2, Math.floor((maxPoints - 2) / channels.length));
    for (const c of channels) for (const i of lttb(idx, s[c]!, budget).x) picked.add(i);
  } else {
    const step = n / maxPoints;
    for (let k = 0; k < maxPoints; k++) picked.add(Math.floor(k * step));
  }
  const keep = [...picked].sort((a, b) => a - b).slice(0, maxPoints);
  const out: ActivityStreams = { t: keep.map((i) => s.t[i]) };
  for (const c of STREAM_CHANNELS) {
    const src = s[c];
    if (src) out[c] = keep.map((i) => src[i] ?? null);
  }
  return out;
}

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
const r = (v: number | null | undefined, dp = 0): number | undefined => (finite(v) ? Math.round(v * 10 ** dp) / 10 ** dp : undefined);

/** Stats of a selected range [startSec, endSec] (inclusive) of the stored 1 Hz streams. */
export function selectionStats(s: ActivityStreams, startSec: number, endSec: number, weightKg?: number) {
  const idx: number[] = [];
  for (let i = 0; i < s.t.length; i++) if (s.t[i] >= startSec && s.t[i] <= endSec) idx.push(i);
  const col = (c: (typeof STREAM_CHANNELS)[number]) => (s[c] ? idx.map((i) => s[c]![i]) : undefined);
  const mean = (x?: Array<number | null>, nonZero = false) => {
    if (!x) return undefined;
    let sum = 0;
    let c = 0;
    for (const v of x) if (finite(v) && (!nonZero || v > 0)) (sum += v), c++;
    return c ? sum / c : undefined;
  };
  const max = (x?: Array<number | null>) => {
    let m = -Infinity;
    for (const v of x ?? []) if (finite(v) && v > m) m = v;
    return Number.isFinite(m) ? m : undefined;
  };
  const hr = col('hr');
  const power = col('power');
  const speed = col('speed');
  const dist = col('distance');
  const alt = col('altitude');
  let distanceM: number | undefined;
  if (dist) {
    const vals = dist.filter(finite);
    if (vals.length) distanceM = vals[vals.length - 1] - vals[0];
  }
  const movingSec = idx.length;
  const durationSec = idx.length ? s.t[idx[idx.length - 1]] - s.t[idx[0]] + 1 : 0;
  const avgSpeed = distanceM !== undefined && movingSec > 0 ? distanceM / movingSec : mean(speed);
  const wp = power ? weightedPower(power) : null;
  const out = {
    startSec,
    endSec,
    durationSec,
    movingSec,
    distanceM: r(distanceM, 1),
    avgHr: r(mean(hr)),
    maxHr: r(max(hr)),
    avgPower: r(mean(power)),
    maxPower: r(max(power)),
    weightedPower: r(wp),
    wattsPerKg: weightKg && finite(wp ?? mean(power)) ? r((wp ?? mean(power)!) / weightKg, 2) : undefined,
    avgSpeedMps: r(avgSpeed, 3),
    paceSecPerKm: avgSpeed && avgSpeed > 0 ? r(1000 / avgSpeed, 1) : undefined,
    avgCadence: r(mean(col('cadence'), true)),
    elevationGainM: alt ? r(elevationGainOf(Float64Array.from(alt, (v) => (finite(v) ? v : NaN))), 1) : undefined,
    decouplingPct: hr && (power ?? speed) && movingSec >= 600 ? r(decoupling((power ?? speed)!, hr), 2) : undefined,
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as typeof out;
}

function csvOf(s: ActivityStreams): string {
  const chans = STREAM_CHANNELS.filter((c) => s[c]);
  const head = ['time_s', ...chans.map((c) => ({ speed: 'speed_mps', altitude: 'altitude_m', distance: 'distance_m', temp: 'temp_c' })[c as string] ?? c)];
  const lines = [head.join(',')];
  for (let i = 0; i < s.t.length; i++) lines.push([s.t[i], ...chans.map((c) => s[c]![i] ?? '')].join(','));
  return lines.join('\n') + '\n';
}

/** Mounted at /api — define full paths here (see docs/ARCHITECTURE.md → API surface). */
export const activitiesRoutes = new Hono<AppEnv>()
  .get('/activities', validate('query', ListQuery), async (c) => {
    const q = c.req.valid('query');
    const res = await searchActivities(c.env.DB, {
      from: q.from,
      to: q.to,
      sport: q.sport,
      q: q.q,
      key: q.key === undefined ? undefined : q.key === '1' || q.key === 'true',
      intensity: q.intensity,
      limit: q.limit,
      cursor: q.cursor,
    });
    const items = await decorate(c.env, res.items);
    return c.json({ items, totals: res.totals, ...(res.nextCursor ? { nextCursor: res.nextCursor } : {}) });
  })
  .post('/activities/manual', validate('json', ManualActivityInput), async (c) => {
    const input = c.req.valid('json');
    const settings = await getSettings(c.env.DB);
    const time = input.startTime ?? '12:00';
    const offset = tzOffsetMin(settings.timezone, input.localDate, time);
    const [y, m, d] = input.localDate.split('-').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    const startedAt = new Date(Date.UTC(y, m - 1, d, hh, mm) - offset * 60_000).toISOString();
    const res = await ingestActivity(c.env, {
      source: 'manual',
      summary: {
        startedAt,
        utcOffsetMin: offset,
        localDate: input.localDate,
        sport: input.sport,
        subSport: input.subSport,
        title: input.title,
        durationSec: input.durationSec,
        movingSec: input.durationSec,
        distanceM: input.distanceM,
        avgHr: input.avgHr,
        avgPower: input.avgPower,
      },
      user: { rpe: input.rpe, feel: input.feel, postNote: input.postNote, loadManual: input.load },
    });
    if (res.outcome === 'skipped') throw badRequest(res.reason ?? 'Could not create activity', 'ingest_skipped');
    return c.json(await decorated(c.env, res.activityId), 201);
  })
  .post('/activities/upload', limitBody(MAX_UPLOAD_BYTES, 'FIT file'), async (c) => {
    const body = new Uint8Array(await c.req.arrayBuffer());
    if (!body.length) throw badRequest('Empty body: send the FIT file (or a zip containing one) as the request body', 'empty_body');
    const fit = extractFitFromDownload(body);
    if (!fit || !isFitBytes(fit)) throw badRequest('Not a FIT file (or a zip containing one)', 'invalid_fit');
    const res = await ingestActivity(c.env, { source: 'upload', fit });
    if (res.outcome === 'skipped' && !res.activityId) throw new ApiError(422, 'invalid_fit', res.reason ?? 'Unreadable FIT file');
    const activity = res.activityId && res.outcome !== 'skipped' ? await decorated(c.env, res.activityId) : undefined;
    return c.json({ ...res, ...(activity ? { activity } : {}) }, res.outcome === 'created' ? 201 : 200);
  })
  .get('/activities/:id', async (c) => {
    const db = c.env.DB;
    const full = await getActivityFull(db, c.req.param('id'));
    if (!full) throw notFound('Activity');
    const { activity, extras } = full;
    const [decoratedAct, previous, workout] = await Promise.all([
      decorate(c.env, [activity]).then((x) => x[0]),
      findPreviousSimilar(db, activity),
      activity.pairedWorkoutId ? getWorkout(db, activity.pairedWorkoutId) : Promise.resolve(null),
    ]);
    const { three: _three, ...zones } = extras.zones;
    const detail: ActivityDetail = {
      ...decoratedAct,
      laps: extras.laps,
      zones,
      peaks: extras.peaks,
      thresholdsUsed: extras.thresholdsUsed,
    };
    if (extras.strengthSets) detail.strengthSets = extras.strengthSets;
    if (Object.keys(extras.facts).length) detail.facts = extras.facts;
    if (extras.swimLengths) detail.swimLengths = extras.swimLengths;
    if (workout) detail.plannedWorkout = (await withCompliance(c.env, [workout], [activity]))[0];
    if (previous) detail.previousSimilar = previous;
    return c.json(detail);
  })
  .get('/activities/:id/streams', validate('query', StreamsQuery), async (c) => {
    const id = c.req.param('id');
    const { maxPoints } = c.req.valid('query');
    const a = await getActivity(c.env.DB, id);
    if (!a) throw notFound('Activity');
    const blob = a.hasStreams ? await getStreamsBlob(c.env.DB, id) : null;
    if (!blob) throw notFound('Streams');
    const acceptsGzip = /\bgzip\b/.test(c.req.header('accept-encoding') ?? '');
    if (!maxPoints && acceptsGzip) {
      return new Response(bodyBytes(blob.data), {
        headers: {
          'content-type': 'application/json',
          'content-encoding': 'gzip',
          'cache-control': 'private, max-age=60',
          vary: 'accept-encoding',
        },
        encodeBody: 'manual',
      });
    }
    const s = await decodeStreams(blob.data);
    return c.json(maxPoints ? thinStreams(s, maxPoints) : s);
  })
  .get('/activities/:id/selection', validate('query', SelectionQuery), async (c) => {
    const id = c.req.param('id');
    const { startSec, endSec } = c.req.valid('query');
    if (endSec < startSec) throw badRequest('endSec must be ≥ startSec');
    const full = await getActivityFull(c.env.DB, id);
    if (!full) throw notFound('Activity');
    const s = await requireStreams(c.env.DB, id);
    return c.json(selectionStats(s, startSec, endSec, full.extras.thresholdsUsed.weightKg));
  })
  .get('/activities/:id/export.csv', async (c) => {
    const id = c.req.param('id');
    const s = await requireStreams(c.env.DB, id);
    return c.body(csvOf(s), 200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${id}.csv"`,
    });
  })
  .get('/activities/:id/original', async (c) => {
    const id = c.req.param('id');
    const a = await getActivity(c.env.DB, id);
    if (!a) throw notFound('Activity');
    const f = await getFile(c.env.DB, id);
    if (!f) throw notFound('Original file');
    return c.body(bodyBytes(f.data), 200, {
      'content-type': 'application/vnd.ant.fit',
      'content-disposition': `attachment; filename="${id}.${f.kind}"`,
    });
  })
  .patch('/activities/:id', validate('json', Patch), async (c) => {
    const id = c.req.param('id');
    const p = c.req.valid('json');
    const full = await getActivityFull(c.env.DB, id);
    if (!full) throw notFound('Activity');
    const before = full.activity;
    await updateActivityUserFields(c.env.DB, id, {
      title: p.title,
      sport: p.sport,
      sub_sport: p.subSport ?? (p.sport && p.sport !== before.sport ? null : undefined),
      is_key: p.isKey,
      intensity_override: p.intensityOverride,
      rpe: p.rpe,
      feel: p.feel,
      post_note: p.postNote,
      tags: p.tags,
      load_manual: p.loadManual,
    });
    const metricsChanged =
      (p.sport !== undefined && p.sport !== before.sport) ||
      (p.subSport !== undefined && p.subSport !== before.subSport) ||
      (p.rpe !== undefined && (p.rpe ?? undefined) !== before.rpe) ||
      (p.intensityOverride !== undefined && (p.intensityOverride ?? undefined) !== before.intensityOverride) ||
      (p.loadManual !== undefined && (p.loadManual ?? undefined) !== full.extras.loadManual);
    if (metricsChanged) await recomputeActivity(c.env, id);
    if (p.sport !== undefined && p.sport !== before.sport) await autoPairDates(c.env, [before.localDate]);
    return c.json(await decorated(c.env, id));
  })
  .delete('/activities/:id', async (c) => {
    const id = c.req.param('id');
    const a = await getActivity(c.env.DB, id);
    if (!a) throw notFound('Activity');
    // The released workout may sit on another day (manual cross-date pair): re-pair both days.
    const w = await c.env.DB.prepare('SELECT date FROM workouts WHERE paired_activity_id = ?').bind(id).first<{ date: string }>();
    await softDeleteActivity(c.env.DB, id);
    await autoPairDates(c.env, w ? [a.localDate, w.date] : [a.localDate]);
    const { pairedWorkoutId: _p, ...rest } = a;
    return c.json({ ...rest, compliance: unplannedCompliance() } as Activity);
  })
  .post('/activities/:id/restore', async (c) => {
    const id = c.req.param('id');
    const a = await getActivity(c.env.DB, id, { includeDeleted: true });
    if (!a) throw notFound('Activity');
    await restoreActivity(c.env.DB, id);
    await autoPairDates(c.env, [a.localDate]);
    return c.json(await decorated(c.env, id));
  });
