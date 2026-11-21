import { describe, expect, it } from 'vitest';
import {
  classForLevel,
  classifyPlannedIntensity,
  intensityFromIF,
  levelForClass,
  levelForIF,
  parseWorkoutText,
} from '../../src/workout';

const cls = (text: string, sport: Parameters<typeof parseWorkoutText>[1] = 'bike') =>
  classifyPlannedIntensity(parseWorkoutText(text, sport).structure, sport, {});

describe('levelForIF (§4.3 table)', () => {
  it('bike %FTP bands', () => {
    expect([0.5, 0.56, 0.75, 0.76, 0.9, 0.91, 1.05, 1.06].map((x) => levelForIF('bike', x))).toEqual([1, 2, 2, 3, 3, 4, 4, 5]);
  });
  it('run % threshold speed bands', () => {
    expect([0.7, 0.78, 0.88, 0.95, 1.02, 1.03].map((x) => levelForIF('run', x))).toEqual([1, 2, 3, 4, 4, 5]);
  });
  it('swim CSS bands', () => {
    expect([0.86, 0.945, 0.975, 1.0, 1.05].map((x) => levelForIF('swim', x))).toEqual([1, 2, 3, 4, 5]);
  });
  it('class ↔ level', () => {
    expect(classForLevel(4)).toBe('threshold');
    expect(levelForClass('race')).toBe(5);
  });
});

describe('intensityFromIF (session IF)', () => {
  it('maps the unstructured label IFs back to their class', () => {
    expect(intensityFromIF(0.55)).toBe('recovery');
    expect(intensityFromIF(0.68)).toBe('endurance');
    expect(intensityFromIF(0.8)).toBe('tempo');
    expect(intensityFromIF(0.88)).toBe('threshold');
    expect(intensityFromIF(0.97)).toBe('high');
    expect(intensityFromIF(0.8, 'run')).toBe('endurance');
    expect(intensityFromIF(0.97, 'swim')).toBe('threshold');
  });
});

describe('classifyPlannedIntensity (§4.3 planned rules)', () => {
  it('threshold: 2×20′ at 95–100 %', () => {
    const r = cls('- 15m 60%\n2x\n  - 20m 95-100%\n  - 5m 50%\n- 10m 50%');
    expect(r.intensity).toBe('threshold');
    expect(r.level).toBe(4);
    expect(r.activeSecAtOrAbove[3]).toBe(2400);
    expect(r.reason).toContain('40′');
  });
  it('high needs ≥ 4′ at L5; less falls through to lower levels', () => {
    expect(cls('- 10m 60%\n3x\n  - 2m 115%\n  - 2m 50%').intensity).toBe('high');
    expect(cls('- 10m 60%\n3x\n  - 1m 115%\n  - 2m 50%').intensity).toBe('recovery');
    // 3′ at L5 + 10′ at L4 → cumulative ≥ L4 = 13′ → threshold
    expect(cls('- 15m 60%\n- 3m 115%\n- 5m 50%\n- 10m 95%\n- 10m 50%').intensity).toBe('threshold');
  });
  it('tempo needs ≥ 15′ at L3+', () => {
    expect(cls('- 10m 60%\n- 15m 85%\n- 10m 55%').intensity).toBe('tempo');
    expect(cls('- 10m 60%\n- 14m 85%\n- 10m 55%').intensity).toBe('recovery');
    expect(cls('- 10m 60%\n- 14m 85%\n- 40m 65%').intensity).toBe('endurance');
  });
  it('endurance needs ≥ 45′ above recovery', () => {
    expect(cls('- 1h 65%').intensity).toBe('endurance');
    expect(cls('- 30m 65%').intensity).toBe('recovery');
    expect(cls('- 45m z2', 'run').intensity).toBe('endurance');
    expect(cls('- 30m z1', 'run').intensity).toBe('recovery');
  });
  it('only active steps count toward hard levels', () => {
    expect(cls('- wu 20m 100%\n- 40m 60%').intensity).toBe('endurance');
  });
  it('swim endurance minimum is 20′', () => {
    expect(cls('4x\n  - 400m z2 r 20s', 'swim').intensity).toBe('endurance');
  });
  it('strength uses the highest prescribed RPE', () => {
    expect(cls('Back squat 4x6 rpe8\nPlank 3x45s', 'strength').intensity).toBe('threshold');
    expect(cls('Plank 3x45s', 'strength').intensity).toBe('tempo');
    expect(cls('Plank 3x45s rpe9', 'strength').intensity).toBe('high');
  });
  it('empty structure → endurance', () => {
    expect(classifyPlannedIntensity({ steps: [] }, 'bike').intensity).toBe('endurance');
  });
});
