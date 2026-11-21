import { describe, expect, it } from 'vitest';
import {
  ActivityStreams,
  DayMarker,
  DayNote,
  Event,
  IntensityClass,
  Lap,
  Phase,
  PlannedWorkoutInput,
  SPORT_META,
  StrengthSet,
  WeekNote,
  WellnessDay,
  WorkoutStructure,
} from '@cadence/core/domain';
import { generateActivityDetail } from '../../src/synth';
import { athlete, sample } from './fixtures';

describe('schema sanity', () => {
  const a = athlete();

  it('every planned structure validates against WorkoutStructure (and as a PlannedWorkoutInput)', () => {
    const structured = a.plan.filter((p) => p.structure);
    expect(structured.length).toBeGreaterThan(a.plan.length * 0.6);
    for (const p of a.plan) {
      if (p.structure) expect(WorkoutStructure.safeParse(p.structure).success, p.title).toBe(true);
      const input = {
        date: p.date,
        startTime: p.startTime,
        sport: p.sport,
        subSport: p.subSport,
        title: p.title,
        description: p.description,
        preNote: p.preNote,
        plannedDurationSec: p.plannedDurationSec,
        plannedDistanceM: p.plannedDistanceM,
        structure: p.structure,
        isKey: p.isKey,
        intensity: p.intensity,
        tags: p.tags,
        environment: p.environment,
        status: p.skipped ? 'skipped' : 'planned',
        skipReason: p.skipped?.reason,
      };
      const r = PlannedWorkoutInput.safeParse(input);
      expect(r.success, `${p.key} ${p.title} ${JSON.stringify(r.error?.issues?.[0])}`).toBe(true);
      expect(SPORT_META[p.sport].subSports).toContain(p.subSport);
    }
  });

  it('structures use the richer step features (repeats, nested repeats, swim send-offs, erg rates, strength)', () => {
    const js = JSON.stringify(a.plan.map((p) => p.structure ?? null));
    expect(js).toContain('"type":"power_pct"');
    expect(js).toContain('"type":"pace_pct"');
    expect(js).toContain('"sendOffSec"');
    expect(js).toContain('"strokeRateLow"');
    expect(js).toContain('"weightKg"');
    expect(js).toContain('"poolLengthM":25');
    const nested = a.plan.some((p) => p.structure?.steps.some((n) => n.kind === 'repeat' && n.steps.some((s) => s.kind === 'repeat')));
    expect(nested).toBe(true);
  });

  it('every wellness day validates', () => {
    for (const w of a.wellness) expect(WellnessDay.safeParse(w).success, w.date).toBe(true);
  });

  it('calendar furniture validates', () => {
    for (const e of a.events) expect(Event.omit({ id: true }).safeParse(e).success).toBe(true);
    for (const p of a.phases) expect(Phase.omit({ id: true }).safeParse(p).success).toBe(true);
    for (const m of a.markers) expect(DayMarker.omit({ id: true }).safeParse(m).success).toBe(true);
    for (const n of a.dayNotes) expect(DayNote.omit({ updatedAt: true }).safeParse(n).success).toBe(true);
    for (const n of a.weekNotes) expect(WeekNote.omit({ updatedAt: true }).safeParse(n).success).toBe(true);
  });

  it('activity summaries are well-formed', () => {
    for (const x of a.activities) {
      expect(SPORT_META[x.sport].subSports, x.title).toContain(x.subSport);
      expect(x.durationSec).toBeGreaterThan(0);
      expect(x.movingSec).toBeLessThanOrEqual(x.durationSec);
      expect(x.garminTypeKey).toMatch(/^[a-z_]+$/);
      expect(Number.isSafeInteger(x.garminActivityId)).toBe(true);
      expect(x.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      if (x.rpe !== undefined) expect(x.rpe).toBeGreaterThanOrEqual(1);
      if (x.feel !== undefined) expect([1, 2, 3, 4, 5]).toContain(x.feel);
      for (const v of Object.values(x)) expect(v).not.toBeUndefined();
    }
    for (const p of a.plan) expect(IntensityClass.safeParse(p.intensity).success).toBe(true);
  });

  it('details (streams, laps, sets) validate', () => {
    for (const x of sample(a, 40)) {
      const d = generateActivityDetail(a, x.garminActivityId);
      if (d.streams) {
        expect(ActivityStreams.safeParse(d.streams).success, x.title).toBe(true);
        const n = d.streams.t.length;
        for (const [k, v] of Object.entries(d.streams)) expect((v as unknown[]).length, `${x.title} ${k}`).toBe(n);
      }
      for (const l of d.laps) expect(Lap.safeParse(l).success).toBe(true);
      for (const s of d.strengthSets ?? []) expect(StrengthSet.safeParse(s).success).toBe(true);
    }
  });
});
