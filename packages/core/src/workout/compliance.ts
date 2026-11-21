/**
 * Planned ↔ completed pairing and compliance (product.md §3.6).
 */
import type { Activity, Compliance, ComplianceState, DayMarker, LocalDate, PlannedWorkout, Sport } from '../domain';

export type ComplianceMetric = Compliance['metric'];

/** Default metric precedence (§3.6.3). */
export const DEFAULT_METRIC_ORDER: readonly ComplianceMetric[] = ['load', 'duration', 'distance'];

/** Day-marker types that excuse a missed workout. */
export const EXCUSING_MARKERS: readonly DayMarker['type'][] = ['sick', 'injured', 'travel'];

export interface ComplianceContext {
  /** Athlete-local today. */
  today: LocalDate;
  markers?: readonly DayMarker[];
  /** Per-sport override of the metric precedence. */
  metricOrder?: readonly ComplianceMetric[];
}

/** State for a ratio (actual ÷ planned, already rounded to whole %). */
export function stateForRatio(ratio: number): ComplianceState {
  if (ratio < 0.5) return 'off_short';
  if (ratio < 0.8) return 'partial_short';
  if (ratio <= 1.2) return 'on_target';
  if (ratio <= 1.5) return 'partial_long';
  return 'off_long';
}

function markerCovers(m: DayMarker, date: LocalDate): boolean {
  return m.date <= date && date <= (m.endDate ?? m.date);
}

/** True when the workout's date is excused by a sick/injured/travel marker or an explicit skip. */
export function isExcused(planned: Pick<PlannedWorkout, 'date' | 'status'>, markers: readonly DayMarker[] = []): boolean {
  return planned.status === 'skipped' || markers.some((m) => EXCUSING_MARKERS.includes(m.type) && markerCovers(m, planned.date));
}

/** First metric of the precedence list available on the plan (and on the activity, when given). */
export function chooseMetric(planned: PlannedWorkout, activity?: Activity, order: readonly ComplianceMetric[] = DEFAULT_METRIC_ORDER): ComplianceMetric | undefined {
  for (const m of order) {
    if (m === 'load' && (planned.plannedLoad ?? 0) > 0 && (!activity || activity.load > 0)) return m;
    if (m === 'duration' && (planned.plannedDurationSec ?? 0) > 0) return m;
    if (m === 'distance' && (planned.plannedDistanceM ?? 0) > 0 && (!activity || activity.distanceM !== undefined)) return m;
  }
  return undefined;
}

/** Actual value of a metric (duration = moving time when recorded, else elapsed). */
function actualOf(metric: ComplianceMetric, a: Activity): number {
  if (metric === 'load') return a.load;
  if (metric === 'duration') return a.movingSec > 0 ? a.movingSec : a.durationSec;
  return a.distanceM ?? 0;
}

function plannedOf(metric: ComplianceMetric, p: PlannedWorkout): number {
  if (metric === 'load') return p.plannedLoad ?? 0;
  if (metric === 'duration') return p.plannedDurationSec ?? 0;
  return p.plannedDistanceM ?? 0;
}

/**
 * Compliance of a planned workout (§3.6.3).
 *  - Paired: metric = load (plan > 0 and activity has load) → duration → distance;
 *    ratio = actual ÷ planned rounded to whole %; state by the 80/120 and 50/150 bands.
 *    A paired plan without any planned value is `on_target` with ratio 1.
 *  - Unpaired: skipped or excused by a sick/injured/travel marker → `excused`;
 *    date < today → `missed`; otherwise (today or future) → `planned`. Ratio 0.
 */
export function computeCompliance(planned: PlannedWorkout, activity: Activity | undefined, ctx: ComplianceContext): Compliance {
  const order = ctx.metricOrder ?? DEFAULT_METRIC_ORDER;
  if (!activity) {
    const metric = chooseMetric(planned, undefined, order) ?? 'duration';
    if (isExcused(planned, ctx.markers)) return { metric, ratio: 0, state: 'excused' };
    if (planned.date < ctx.today) return { metric, ratio: 0, state: 'missed' };
    return { metric, ratio: 0, state: 'planned' };
  }
  const metric = chooseMetric(planned, activity, order);
  if (!metric) return { metric: 'duration', ratio: 1, state: 'on_target' };
  const ratio = Math.round((actualOf(metric, activity) / plannedOf(metric, planned)) * 100) / 100;
  return { metric, ratio, state: stateForRatio(ratio) };
}

/** Compliance of a completed activity with no planned pair. */
export function unplannedCompliance(): Compliance {
  return { metric: 'duration', ratio: 0, state: 'unplanned' };
}

/**
 * Week compliance (§3.6.3): mean of per-workout ratios clamped to 1.0 over workouts whose
 * date has passed, excluding `excused` (and `planned`). Missed counts as 0. Null when none.
 */
export function weeklyCompliance(items: readonly { date: LocalDate; compliance?: Compliance }[], today: LocalDate): number | null {
  const rs = items
    .filter((i) => i.date < today && i.compliance && i.compliance.state !== 'excused' && i.compliance.state !== 'planned' && i.compliance.state !== 'unplanned')
    .map((i) => Math.min(1, i.compliance!.ratio));
  return rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
}

// ───────────────────────────── pairing ─────────────────────────────

/**
 * Sports that may auto-pair (§3.6.1): the same sport (sub-sports such as indoor bike, trail /
 * treadmill run or open-water swim are variants of one sport), except "other", which never
 * auto-pairs.
 */
export function sportsCompatible(planned: Sport, activity: Sport): boolean {
  return planned === activity && planned !== 'other';
}

/** Auto-pair threshold (§3.6.1). */
export const PAIR_SCORE_THRESHOLD = 0.35;
/** Start-time difference (minutes) at which proximity reaches 0. */
export const START_PROXIMITY_WINDOW_MIN = 180;

function localMinutes(a: Activity): number {
  const t = Date.parse(a.startedAt) + a.utcOffsetMin * 60_000;
  const d = new Date(t);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/**
 * Pair score in 0..1: 0.5·durationSimilarity + 0.3·startTimeProximity + 0.2·match.
 *  - durationSimilarity = 1 − min(|a − p| / p, 1) on duration (falls back to distance; 0.5 when
 *    the plan has neither);
 *  - startTimeProximity = 1 − min(|Δmin| / 180, 1), or 0.5 without a planned start time;
 *  - match = 1 when tags overlap or the titles are equal (case-insensitive), else 0
 *    (activities carry no template id).
 */
export function pairScore(p: PlannedWorkout, a: Activity): number {
  let sim = 0.5;
  if ((p.plannedDurationSec ?? 0) > 0) {
    const act = a.movingSec > 0 ? a.movingSec : a.durationSec;
    sim = 1 - Math.min(Math.abs(act - p.plannedDurationSec!) / p.plannedDurationSec!, 1);
  } else if ((p.plannedDistanceM ?? 0) > 0 && a.distanceM !== undefined) {
    sim = 1 - Math.min(Math.abs(a.distanceM - p.plannedDistanceM!) / p.plannedDistanceM!, 1);
  }
  let prox = 0.5;
  if (p.startTime) {
    const [h, m] = p.startTime.split(':').map(Number);
    prox = 1 - Math.min(Math.abs(localMinutes(a) - (h * 60 + m)) / START_PROXIMITY_WINDOW_MIN, 1);
  }
  const tagMatch = p.tags.some((t) => a.tags.includes(t)) || p.title.trim().toLowerCase() === a.title.trim().toLowerCase();
  return 0.5 * sim + 0.3 * prox + 0.2 * (tagMatch ? 1 : 0);
}

export interface Pair {
  plannedId: string;
  activityId: string;
  /** Score for automatic pairs; undefined for kept existing (manual) pairs. */
  score?: number;
  manual: boolean;
}

export interface PairingResult {
  pairs: Pair[];
  unpairedActivityIds: string[];
  unpairedPlannedIds: string[];
}

/**
 * Auto-pairing (§3.6.1). Existing pairs (planned.pairedActivityId / activity.pairedWorkoutId) are
 * kept untouched as manual — unless `manualPlannedIds` is given, in which case only those are
 * kept and other existing pairs are re-evaluated. Skipped plans never auto-pair. Candidates
 * share the local date and a compatible sport; every candidate pair with score ≥ 0.35 is
 * ranked and assigned greedily, highest score first, one-to-one.
 */
export function pairActivities(
  planned: readonly PlannedWorkout[],
  activities: readonly Activity[],
  opts: { manualPlannedIds?: Iterable<string> } = {},
): PairingResult {
  const manualSet = opts.manualPlannedIds ? new Set(opts.manualPlannedIds) : undefined;
  const actById = new Map(activities.map((a) => [a.id, a]));
  const planById = new Map(planned.map((p) => [p.id, p]));
  const pairs: Pair[] = [];
  const usedP = new Set<string>();
  const usedA = new Set<string>();
  const keep = (pid: string, aid: string) => {
    if (usedP.has(pid) || usedA.has(aid)) return;
    if (manualSet && !manualSet.has(pid)) return;
    pairs.push({ plannedId: pid, activityId: aid, manual: true });
    usedP.add(pid);
    usedA.add(aid);
  };
  for (const p of planned) if (p.pairedActivityId && actById.has(p.pairedActivityId)) keep(p.id, p.pairedActivityId);
  for (const a of activities) if (a.pairedWorkoutId && planById.has(a.pairedWorkoutId)) keep(a.pairedWorkoutId, a.id);

  const cands: { p: PlannedWorkout; a: Activity; score: number }[] = [];
  for (const a of activities) {
    if (usedA.has(a.id)) continue;
    for (const p of planned) {
      if (usedP.has(p.id) || p.status === 'skipped' || p.date !== a.localDate || !sportsCompatible(p.sport, a.sport)) continue;
      const score = pairScore(p, a);
      if (score >= PAIR_SCORE_THRESHOLD) cands.push({ p, a, score });
    }
  }
  cands.sort((x, y) => y.score - x.score || x.a.startedAt.localeCompare(y.a.startedAt) || x.p.id.localeCompare(y.p.id));
  for (const c of cands) {
    if (usedP.has(c.p.id) || usedA.has(c.a.id)) continue;
    pairs.push({ plannedId: c.p.id, activityId: c.a.id, score: Math.round(c.score * 1000) / 1000, manual: false });
    usedP.add(c.p.id);
    usedA.add(c.a.id);
  }
  return {
    pairs,
    unpairedActivityIds: activities.filter((a) => !usedA.has(a.id)).map((a) => a.id),
    unpairedPlannedIds: planned.filter((p) => !usedP.has(p.id)).map((p) => p.id),
  };
}
