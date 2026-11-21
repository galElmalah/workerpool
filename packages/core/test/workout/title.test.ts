import { describe, expect, it } from 'vitest';
import type { Sport, Step } from '../../src/domain';
import { autoTitle, autoTitleUnstructured, describeStep, parseWorkoutText, targetShort } from '../../src/workout';

const title = (text: string, sport: Sport = 'bike') => autoTitle(parseWorkoutText(text, sport).structure, sport);
const first = (text: string, sport: Sport = 'bike') => parseWorkoutText(text, sport).structure.steps[0] as Step;

describe('autoTitle', () => {
  it('main repeat', () => {
    expect(title('- 15m 60%\n4x\n  - 8m 95-100%\n  - 4m 55%\n- 10m 50%')).toBe('4×8′ @ 95–100%');
    expect(title('2x\n  - 20m 95-100%\n  - 5m 50%')).toBe('2×20′ @ 95–100%');
  });
  it('30/30s and nested repeats', () => {
    expect(title('- 10m 60%\n10x\n  - 30s 120%\n  - 30s 50%')).toBe('10×30″/30″ @ 120%');
    expect(title('2x\n  10x\n    - 30s 120%\n    - 30s 50%\n  - 5m 50%')).toBe('2×(10×30″/30″ @ 120%)');
  });
  it('swim send-off sets', () => {
    expect(title('- 400m free z1\n10x\n  - 100m free on 1:45\n- 200m choice', 'swim')).toBe('10×100 on 1:45');
  });
  it('two comparable main sets are joined', () => {
    expect(title('3x\n  - 10m 88%\n  - 3m 50%\n5x\n  - 3m 115%\n  - 3m 50%')).toBe('3×10′ @ 88% + 5×3′ @ 115%');
  });
  it('steady workouts: class + length', () => {
    expect(title('- 1h30m z2', 'run')).toBe('Endurance 1:30');
    expect(title('- 10m 50%\n- 1h10m 65-72%\n- 10m 50%')).toBe('Endurance 1:30');
    expect(title('- 45m 50%')).toBe('Recovery 45′');
    expect(title('- 15m z2\n- 20m 88-92%\n- 10m z1', 'run')).toBe('Tempo 20′ @ 88–92% pace');
    expect(title('- 10km z2', 'run')).toBe('Endurance 10 km');
  });
  it('flat intervals without a repeat are counted', () => {
    expect(title('- 15m 60%\n- 20m 100%\n- 5m 55%\n- 20m 100%\n- 10m 50%')).toBe('2×20′ @ 100%');
  });
  it('strength lists exercises', () => {
    expect(title('Back squat 4x6\nBench press 4x6\nRow 3x10\nPlank 3x45s', 'strength')).toBe('Back squat, Bench press +2');
  });
  it('empty structure → sport label', () => {
    expect(autoTitle({ steps: [] }, 'row')).toBe('Row');
  });
  it('unstructured', () => {
    expect(autoTitleUnstructured({ sport: 'run', durationSec: 2700, intensity: 'endurance' })).toBe('Endurance 45′');
    expect(autoTitleUnstructured({ sport: 'bike', durationSec: 5400, intensity: 'tempo' })).toBe('Tempo 1:30');
    expect(autoTitleUnstructured({ sport: 'swim', distanceM: 3000, intensity: 'endurance' })).toBe('Endurance 3000 m');
    expect(autoTitleUnstructured({ sport: 'yoga', intensity: 'recovery' })).toBe('Recovery yoga');
  });
});

describe('describeStep / targetShort', () => {
  it('percent with absolute watts when FTP is known', () => {
    const s = first('- 8m 95-100%');
    expect(describeStep(s, 'bike', 'metric', { ftp: 250 })).toBe('8:00 @ 95–100% · 238–250 W');
    expect(describeStep(s, 'bike')).toBe('8:00 @ 95–100%');
  });
  it('zones, HR, pace, ramps, cadence', () => {
    expect(describeStep(first('- 1h z2'), 'bike', 'metric', { ftp: 200 })).toBe('1:00:00 @ Z2 · 112–150 W');
    expect(describeStep(first('- 45m z2', 'run'), 'run', 'metric', { lthr: 170 })).toBe('45:00 @ HR Z2 · 138–151 bpm');
    expect(describeStep(first('- 1km 4:30/km', 'run'), 'run', 'metric', { runThresholdMps: 1000 / 270 })).toBe('1 km @ 4:30/km · 100%');
    expect(describeStep(first('- 1mi 7:00/mi', 'run'), 'run', 'imperial')).toBe('1 mi @ 7:00/mi');
    expect(describeStep(first('- 20m 95-100%', 'run'), 'run', 'metric', { runThresholdMps: 1000 / 240 })).toBe('20:00 @ 95–100% pace · 4:00–4:13/km');
    expect(describeStep(first('- 15m ramp 50-75% 90rpm'), 'bike', 'metric', { ftp: 200 })).toBe('15:00 @ 50→75% · 100→150 W · 90 rpm');
    expect(describeStep(first('- 5m 150-160bpm', 'run'), 'run', 'metric', { lthr: 160 })).toBe('5:00 @ 150–160 bpm · 94–100% LTHR');
    expect(describeStep(first('- lap rpe 7', 'run'), 'run')).toBe('Until lap @ RPE 7');
  });
  it('swim and row details', () => {
    expect(describeStep(first('- 100m free css on 1:50 +pull', 'swim'), 'swim', 'metric', { swimCssMps: 1 })).toBe(
      '100 m Free @ CSS · 1:40/100m · pull buoy · on 1:50',
    );
    expect(describeStep(first('- 50m drill:catchup r 15s', 'swim'), 'swim')).toBe('catchup · 50 m Drill · rest 0:15');
    expect(describeStep(first('- 2000m 1:52/500m 24-26spm', 'row'), 'row')).toBe('2000 m @ 1:52/500m · 24–26 spm');
  });
  it('strength', () => {
    expect(describeStep(first('Back squat 4x6 @80kg rpe8 r2m', 'strength'), 'strength')).toBe('Back squat 4×6 @ 80 kg · RPE 8 · rest 2:00');
    expect(describeStep(first('Plank 3x45s', 'strength'), 'strength')).toBe('Plank 3×0:45');
    expect(describeStep(first('Pull-up 3x8 @bw', 'strength'), 'strength')).toBe('Pull-up 3×8 @ BW');
  });
  it('targetShort', () => {
    expect(targetShort({ type: 'pace_pct', low: 93, high: 96 }, 'swim')).toBe('Z2');
    expect(targetShort({ type: 'pace_pct', low: 97, high: 97 }, 'swim')).toBe('97% CSS');
    expect(targetShort({ type: 'power_w', low: 250, high: 250 }, 'bike')).toBe('250 W');
    expect(targetShort({ type: 'hr_pct_lthr', low: 85, high: 89 }, 'run')).toBe('85–89% LTHR');
    expect(targetShort({ type: 'cadence', low: 180, high: 180 }, 'run')).toBe('180 spm');
    expect(targetShort({ type: 'open' }, 'run')).toBe('open');
  });
});
