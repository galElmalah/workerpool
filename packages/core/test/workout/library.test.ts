import { describe, expect, it } from 'vitest';
import {
  STARTER_TEMPLATES,
  STARTER_TEMPLATE_SOURCES,
  classifyPlannedIntensity,
  estimateWorkout,
  formatWorkoutText,
  garminSupport,
  instantiateTemplate,
  parseWorkoutText,
  stripIds,
  validateStructure,
  walk,
} from '../../src/workout';

describe('starter library', () => {
  it('has ~30 templates across all five sports with unique keys', () => {
    expect(STARTER_TEMPLATES.length).toBeGreaterThanOrEqual(28);
    expect(new Set(STARTER_TEMPLATES.map((t) => t.key)).size).toBe(STARTER_TEMPLATES.length);
    for (const sport of ['bike', 'run', 'swim', 'row', 'strength'] as const)
      expect(STARTER_TEMPLATES.filter((t) => t.sport === sport).length).toBeGreaterThanOrEqual(4);
    expect(STARTER_TEMPLATE_SOURCES).toHaveLength(STARTER_TEMPLATES.length);
  });

  describe.each(STARTER_TEMPLATES.map((t) => [t.key, t] as const))('%s', (_key, t) => {
    it('parses without issues and validates', () => {
      const r = parseWorkoutText(t.text, t.sport);
      expect(r.issues.filter((i) => i.severity !== 'info')).toEqual([]);
      expect(validateStructure(t.structure, t.sport).filter((i) => i.severity === 'error')).toEqual([]);
      expect(t.structure.steps.length).toBeGreaterThan(0);
    });
    it('round-trips through the canonical text', () => {
      const text = formatWorkoutText(t.structure, t.sport);
      const back = parseWorkoutText(text, t.sport);
      expect(back.issues.filter((i) => i.severity === 'error')).toEqual([]);
      expect(stripIds(back.structure)).toEqual(stripIds(t.structure));
      expect(formatWorkoutText(back.structure, t.sport)).toBe(text);
    });
    it('auto-classifies to its declared intensity and has a sane length', () => {
      expect(classifyPlannedIntensity(t.structure, t.sport, {}).intensity).toBe(t.intensity);
      const e = estimateWorkout(t.structure, t.sport, {});
      expect(e.durationSec).toBeGreaterThan(10 * 60);
      expect(e.durationSec).toBeLessThan(4 * 3600);
      expect(e.load).toBeGreaterThan(5);
    });
    it('has deterministic ids and is pushable to Garmin', () => {
      walk(t.structure, (n, path) => {
        expect(n.id).toBe(`${t.key}.${path.join('.')}`);
      });
      expect(garminSupport(t.sport, t.structure, { subSport: t.subSport }).pushable).toBe(true);
    });
  });

  it('instantiateTemplate gives fresh ids and planned totals', () => {
    const t = STARTER_TEMPLATES.find((x) => x.key === 'bike-threshold-2x20')!;
    const w = instantiateTemplate(t, { ftp: 250 });
    expect(w.structure.steps[0].id).not.toBe(t.structure.steps[0].id);
    expect(stripIds(w.structure)).toEqual(stripIds(t.structure));
    expect(w.plannedDurationSec).toBe(Math.round(estimateWorkout(t.structure, 'bike', {}).durationSec));
    expect(w.plannedLoad).toBeGreaterThan(80);
    expect(w).toMatchObject({ sport: 'bike', intensity: 'threshold', isKey: true, templateKey: t.key });
  });
});
