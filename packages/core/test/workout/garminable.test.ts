import { describe, expect, it } from 'vitest';
import { garminSportType, garminSupport, parseWorkoutText } from '../../src/workout';

const st = (t: string, sport: Parameters<typeof parseWorkoutText>[1]) => parseWorkoutText(t, sport).structure;

describe('garminSupport', () => {
  it('maps sports to Garmin workout types', () => {
    expect(garminSportType('run')).toBe('running');
    expect(garminSportType('bike')).toBe('cycling');
    expect(garminSportType('swim')).toBe('swimming');
    expect(garminSportType('strength')).toBe('strength_training');
    expect(garminSportType('strength', 'mobility')).toBe('mobility');
    expect(garminSportType('strength', 'hiit')).toBe('hiit');
    expect(garminSportType('yoga')).toBe('yoga');
    expect(garminSportType('row')).toBe('cardio_training');
    expect(garminSportType('hike')).toBe('other');
  });
  it('clean bike workout: pushable, no warnings', () => {
    expect(garminSupport('bike', st('- 10m 60%\n4x\n  - 8m 95-100%\n  - 4m 55%', 'bike'), { thresholds: { ftp: 250 } })).toEqual({
      pushable: true,
      sportTypeKey: 'cycling',
      warnings: [],
    });
  });
  it('rowing / hiking have no native type', () => {
    const r = garminSupport('row', st('4x\n  - 2000m 95%\n  - r 5m', 'row'));
    expect(r.pushable).toBe(true);
    expect(r.sportTypeKey).toBe('cardio_training');
    expect(r.warnings[0]).toMatch(/rowing/);
    expect(garminSupport('hike', st('- 3h', 'hike')).sportTypeKey).toBe('other');
  });
  it('unstructured needs the push-unstructured option', () => {
    expect(garminSupport('run', undefined).pushable).toBe(false);
    expect(garminSupport('run', { steps: [] }, { pushUnstructured: true }).pushable).toBe(true);
  });
  it('warns about RPE, ramps, nesting, step count and missing thresholds', () => {
    const r = garminSupport('bike', st('- 15m ramp 50-75%\n2x\n  10x\n    - 30s 120%\n    - 30s rpe2\n  - 5m 50%', 'bike'), { thresholds: {} });
    expect(r.pushable).toBe(true);
    const w = r.warnings.join('\n');
    expect(w).toMatch(/RPE/);
    expect(w).toMatch(/ramp/i);
    expect(w).toMatch(/Nested/);
    expect(w).toMatch(/FTP/);
    const many = garminSupport('run', st('30x\n  - 30s 110%\n  - 30s z1', 'run'));
    expect(many.warnings.some((x) => x.includes('60 steps'))).toBe(true);
    expect(garminSupport('swim', st('- 400m free', 'swim'), { subSport: 'open_water' }).warnings[0]).toMatch(/open-water/);
  });
});
