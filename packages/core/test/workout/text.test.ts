import { describe, expect, it } from 'vitest';
import type { Repeat, Sport, Step, WorkoutStructure } from '../../src/domain';
import {
  formatWorkoutText,
  inferStepRoles,
  makeRepeat,
  makeStep,
  mIsMeters,
  parseQuickAdd,
  parseWorkoutText,
  stripIds,
} from '../../src/workout';

const parse = (text: string, sport: Sport = 'bike') => parseWorkoutText(text, sport);
const steps = (text: string, sport: Sport = 'bike') => parse(text, sport).structure.steps;
const one = (text: string, sport: Sport = 'bike') => steps(text, sport)[0] as Step;
const errors = (text: string, sport: Sport = 'bike') => parse(text, sport).issues.filter((i) => i.severity !== 'info');

/** parse → format → parse must be identical modulo ids. */
function roundTrip(text: string, sport: Sport) {
  const a = parse(text, sport).structure;
  const formatted = formatWorkoutText(a, sport);
  const b = parse(formatted, sport);
  expect(b.issues.filter((i) => i.severity === 'error'), formatted).toEqual([]);
  expect(stripIds(b.structure), formatted).toEqual(stripIds(a));
  // formatting is a fixed point
  expect(formatWorkoutText(b.structure, sport)).toBe(formatted);
  return formatted;
}

describe('measures', () => {
  const sec = (t: string, sport: Sport = 'bike') => {
    const m = one(`- ${t}`, sport).measure;
    return m.type === 'time' ? m.sec : m.type === 'distance' ? `${m.m}m` : m.type;
  };
  it('durations', () => {
    expect(sec('8m')).toBe(480);
    expect(sec('30s')).toBe(30);
    expect(sec('1h15')).toBe(4500);
    expect(sec('1h15m')).toBe(4500);
    expect(sec('1h 15m')).toBe(4500);
    expect(sec('1h30s')).toBe(3630);
    expect(sec('1h0m30s')).toBe(3630);
    expect(sec('2h')).toBe(7200);
    expect(sec('8m30s')).toBe(510);
    expect(sec('8:00')).toBe(480);
    expect(sec('1:15:00')).toBe(4500);
    expect(sec("8'30\"")).toBe(510);
    expect(sec('45min')).toBe(2700);
    expect(sec('90s')).toBe(90);
    expect(sec('12.5s')).toBe(12.5);
    expect(sec('lap')).toBe('lap_button');
  });
  it('distances and the "m" ambiguity', () => {
    expect(sec('400m', 'run')).toBe('400m');
    expect(sec('2km', 'run')).toBe('2000m');
    expect(sec('10k', 'run')).toBe('10000m');
    expect(sec('1mi', 'run')).toBe('1609.344m');
    expect(sec('100y', 'swim')).toBe(`${100 * 0.9144}m`);
    expect(sec('25m', 'swim')).toBe('25m');
    expect(sec('45m', 'swim')).toBe(2700); // not a multiple of 25 → minutes
    expect(sec('50m', 'run')).toBe(3000);
    expect(sec('500m', 'row')).toBe('500m');
    expect(sec('30m', 'row')).toBe(1800);
    expect(sec('30mtr', 'run')).toBe('30m');
    expect(sec('400min', 'run')).toBe(24000);
    expect(mIsMeters(300, 'bike')).toBe(true);
    expect(mIsMeters(90, 'bike')).toBe(false);
  });
});

describe('targets', () => {
  const tgt = (t: string, sport: Sport = 'bike') => one(`- 8m ${t}`, sport).target;
  it('power and generic %', () => {
    expect(tgt('95-100%')).toEqual({ type: 'power_pct', low: 95, high: 100 });
    expect(tgt('95 - 100 %')).toEqual({ type: 'power_pct', low: 95, high: 100 });
    expect(tgt('100-95%')).toEqual({ type: 'power_pct', low: 95, high: 100 });
    expect(tgt('95-100%', 'run')).toEqual({ type: 'pace_pct', low: 95, high: 100 });
    expect(tgt('85%hr')).toEqual({ type: 'hr_pct_lthr', low: 85, high: 85 });
    expect(tgt('85 % hr', 'run')).toEqual({ type: 'hr_pct_lthr', low: 85, high: 85 });
    expect(tgt('97%pace', 'bike')).toEqual({ type: 'pace_pct', low: 97, high: 97 });
    expect(tgt('90%ftp', 'run')).toEqual({ type: 'power_pct', low: 90, high: 90 });
    expect(tgt('250w')).toEqual({ type: 'power_w', low: 250, high: 250 });
    expect(tgt('240-260W')).toEqual({ type: 'power_w', low: 240, high: 260 });
    expect(tgt('150-160bpm', 'run')).toEqual({ type: 'hr_bpm', low: 150, high: 160 });
  });
  it('zones', () => {
    expect(tgt('z2')).toEqual({ type: 'power_pct', low: 56, high: 75 });
    expect(tgt('Z2', 'run')).toEqual({ type: 'hr_zone', zone: 2 });
    expect(tgt('z2 hr')).toEqual({ type: 'hr_zone', zone: 2 });
    expect(tgt('z3', 'swim')).toEqual({ type: 'pace_pct', low: 97, high: 98 });
    expect(tgt('z4 power', 'run')).toEqual({ type: 'power_pct', low: 91, high: 105 });
    expect(tgt('z2 pace', 'run')).toEqual({ type: 'pace_pct', low: 78, high: 87 });
  });
  it('pace', () => {
    expect(tgt('4:30/km', 'run')).toEqual({ type: 'pace', lowMps: 1000 / 270, highMps: 1000 / 270 });
    expect(tgt('4:20-4:30/km', 'run')).toEqual({ type: 'pace', lowMps: 1000 / 270, highMps: 1000 / 260 });
    expect(tgt('4:20 - 4:30 /km', 'run')).toEqual({ type: 'pace', lowMps: 1000 / 270, highMps: 1000 / 260 });
    expect(tgt('7:00/mi', 'run')).toEqual({ type: 'pace', lowMps: 1609.344 / 420, highMps: 1609.344 / 420 });
    expect(tgt('1:45/100m', 'swim')).toEqual({ type: 'pace', lowMps: 100 / 105, highMps: 100 / 105 });
    expect(tgt('1:52/500m', 'row')).toEqual({ type: 'pace', lowMps: 500 / 112, highMps: 500 / 112 });
  });
  it('relative pace (css / thr) converts with thresholds or defaults', () => {
    expect(tgt('css', 'swim')).toEqual({ type: 'pace_pct', low: 100, high: 100 });
    const r = parseWorkoutText('- 100m css+3s', 'swim', { thresholds: { swimCssMps: 1 } });
    expect((r.structure.steps[0] as Step).target).toEqual({ type: 'pace_pct', low: 97.1, high: 97.1 });
    expect(r.issues).toEqual([]);
    const d = parse('- 100m css+3s', 'swim');
    expect((d.structure.steps[0] as Step).target).toEqual({ type: 'pace_pct', low: 97.3, high: 97.3 }); // CSS 1:50 default
    expect(d.issues[0].severity).toBe('info');
    expect(tgt('thr-5s', 'run')).toEqual({ type: 'pace_pct', low: 101.7, high: 101.7 });
  });
  it('rpe, open, ramp, cadence as secondary, intensity words', () => {
    expect(tgt('rpe 7')).toEqual({ type: 'rpe', low: 7, high: 7 });
    expect(tgt('RPE6-7')).toEqual({ type: 'rpe', low: 6, high: 7 });
    expect(tgt('open')).toEqual({ type: 'open' });
    expect(tgt('ramp 50-75%')).toEqual({ type: 'ramp', basis: 'power_pct', from: 50, to: 75 });
    expect(tgt('ramp 75-50%')).toEqual({ type: 'ramp', basis: 'power_pct', from: 75, to: 50 });
    expect(tgt('ramp 80-90%hr')).toEqual({ type: 'ramp', basis: 'hr_pct_lthr', from: 80, to: 90 });
    expect(tgt('easy')).toEqual({ type: 'rpe', low: 3, high: 3 });
    const s = one('- 8m 95-100% 85-95rpm');
    expect(s.secondary).toEqual({ type: 'cadence', low: 85, high: 95 });
    expect(one('- 5m 90rpm').target).toEqual({ type: 'cadence', low: 90, high: 90 });
    expect(one('- 10m 180spm', 'run').target).toEqual({ type: 'cadence', low: 180, high: 180 });
  });
});

describe('product.md §4.6 examples', () => {
  it('bike threshold', () => {
    const r = parse(`// Bike — threshold
Warmup:
- 15m ramp 50-75% 90rpm
- 3x 1m 110% / 1m 50%
Main set: 4x
  - 8m 95-100% 85-95rpm
  - 4m 55%
Cooldown:
- 10m 50%`);
    expect(r.issues).toEqual([]);
    const s = r.structure.steps;
    expect(s.map((n) => n.kind)).toEqual(['step', 'repeat', 'repeat', 'step']);
    expect((s[0] as Step).role).toBe('warmup');
    expect((s[0] as Step).secondary).toEqual({ type: 'cadence', low: 90, high: 90 });
    const openers = s[1] as Repeat;
    expect(openers.count).toBe(3);
    expect(openers.steps.map((x) => (x as Step).role)).toEqual(['active', 'recovery']);
    const main = s[2] as Repeat;
    expect(main).toMatchObject({ count: 4, label: 'Main set' });
    expect((main.steps[0] as Step).measure).toEqual({ type: 'time', sec: 480 });
    expect((main.steps[1] as Step).role).toBe('recovery');
    expect((s[3] as Step).role).toBe('cooldown');
  });
  it('run track VO2', () => {
    const r = parse(`// Run — track VO2
- 15m z2
6x
  - 800m 3:30/km
  - r 400m           // jog recovery, open target
- 10m z1`, 'run');
    expect(r.issues).toEqual([]);
    const s = r.structure.steps;
    expect((s[0] as Step).role).toBe('warmup');
    const rep = s[1] as Repeat;
    expect(rep.steps[0]).toMatchObject({ role: 'active', measure: { type: 'distance', m: 800 } });
    expect(rep.steps[1]).toMatchObject({ role: 'recovery', measure: { type: 'distance', m: 400 }, cue: 'jog recovery, open target' });
    expect((s[2] as Step).role).toBe('cooldown');
  });
  it('swim CSS set', () => {
    const r = parseWorkoutText(`// Swim — CSS set (pool 25m)
pool 25m
- 400m free z2
- 4x 50m drill:catchup on 1:00
Main set: 8x
  - 100m free css+3s on 1:50 +pull
- 200m choice easy`, 'swim', { thresholds: { swimCssMps: 1 } });
    expect(r.issues).toEqual([]);
    expect(r.structure.poolLengthM).toBe(25);
    const s = r.structure.steps;
    expect(s[0]).toMatchObject({ role: 'warmup', swim: { stroke: 'free' }, target: { type: 'pace_pct', low: 93, high: 96 } });
    expect((s[1] as Repeat).steps[0]).toMatchObject({ label: 'catchup', swim: { stroke: 'drill', sendOffSec: 60 } });
    expect((s[2] as Repeat).steps[0]).toMatchObject({
      role: 'active',
      measure: { type: 'distance', m: 100 },
      swim: { stroke: 'free', sendOffSec: 110, equipment: ['pull_buoy'] },
      target: { type: 'pace_pct', low: 97.1, high: 97.1 },
    });
    expect(s[3]).toMatchObject({ role: 'cooldown', swim: { stroke: 'choice' }, target: { type: 'rpe', low: 3, high: 3 } });
  });
  it('row erg pieces', () => {
    const r = parse(`// Row — erg pieces
- 10m rpe3 20spm
3x
  - 2000m 1:52/500m 24-26spm
  - r 5m
- 5m rpe2`, 'row');
    expect(r.issues).toEqual([]);
    const s = r.structure.steps;
    expect(s[0]).toMatchObject({ role: 'warmup', row: { strokeRateLow: 20, strokeRateHigh: 20 } });
    expect((s[1] as Repeat).steps[0]).toMatchObject({ measure: { type: 'distance', m: 2000 }, row: { strokeRateLow: 24, strokeRateHigh: 26 } });
    expect((s[1] as Repeat).steps[1]).toMatchObject({ role: 'recovery', measure: { type: 'time', sec: 300 } });
  });
  it('strength with superset', () => {
    const r = parse(`// Strength
Back squat 4x6 @80kg rpe8 r2m
Romanian deadlift 3x8 @60kg r90s
Pull-up 3x8 @bw + Push-up 3x15 @bw r60s     // superset A1/A2
Plank 3x45s`, 'strength');
    expect(r.issues).toEqual([]);
    const s = r.structure.steps as Step[];
    expect(s).toHaveLength(5);
    expect(s[0]).toMatchObject({
      role: 'active',
      measure: { type: 'reps', n: 6 },
      strength: { exercise: 'Back squat', sets: 4, reps: 6, weightKg: 80, rpe: 8, restSec: 120 },
    });
    expect(s[1].strength).toMatchObject({ exercise: 'Romanian deadlift', restSec: 90, weightKg: 60 });
    expect(s[2].strength).toMatchObject({ exercise: 'Pull-up', weightKg: 0, supersetGroup: 'A' });
    expect(s[2].cue).toBe('superset A1/A2');
    expect(s[3].strength).toMatchObject({ exercise: 'Push-up', reps: 15, supersetGroup: 'A', restSec: 60 });
    expect(s[4]).toMatchObject({ measure: { type: 'time', sec: 45 }, strength: { exercise: 'Plank', sets: 3, durationSec: 45 } });
  });
});

describe('strength variants', () => {
  it('name after the sets, pounds, spaced x', () => {
    expect(one('3x8 @ 60kg Squat', 'strength').strength).toMatchObject({ exercise: 'Squat', sets: 3, reps: 8, weightKg: 60 });
    expect(one('Bench press 5 x 5 @100lb', 'strength').strength).toMatchObject({ sets: 5, reps: 5, weightKg: 45.359237 });
    expect(one('"21s curl" 3x21', 'strength').strength?.exercise).toBe('21s curl');
    expect(one('Back extension 3x12', 'strength').strength?.exercise).toBe('Back extension');
  });
  it('rep ranges keep the low value with an info issue', () => {
    const r = parse('Lunge 3x8-10', 'strength');
    expect((r.structure.steps[0] as Step).strength?.reps).toBe(8);
    expect(r.issues[0].severity).toBe('info');
  });
  it('circuits inside repeats', () => {
    const r = parse('3x\n  Goblet squat 1x10\n  Push-up 1x12\n  - rest 1m', 'strength');
    const rep = r.structure.steps[0] as Repeat;
    expect(rep.steps.map((s) => (s as Step).role)).toEqual(['active', 'active', 'rest']);
  });
  it('a swim "8x100 free" is not mistaken for an exercise', () => {
    const r = parse('8x100 free', 'swim');
    const rep = r.structure.steps[0] as Repeat;
    expect(rep.count).toBe(8);
    expect(rep.steps[0]).toMatchObject({ measure: { type: 'distance', m: 100 }, swim: { stroke: 'free' } });
  });
});

describe('structure, sections, roles', () => {
  it('nested blocks by indentation (tabs too)', () => {
    const s = steps('2x\n\t10x\n\t\t- 30s 120%\n\t\t- 30s 50%\n\t- 5m 50%\n- 10m 50%');
    expect(s).toHaveLength(2);
    const outer = s[0] as Repeat;
    expect(outer.steps.map((x) => x.kind)).toEqual(['repeat', 'step']);
    expect((outer.steps[0] as Repeat).count).toBe(10);
    expect((outer.steps[1] as Step).role).toBe('recovery');
  });
  it('too-deep nesting is expanded with a warning', () => {
    const r = parse('2x\n  2x\n    3x\n      - 1m 100%\n      - 1m 50%');
    expect(r.issues.map((i) => i.severity)).toEqual(['warning']);
    const inner = (r.structure.steps[0] as Repeat).steps[0] as Repeat;
    expect(inner.steps).toHaveLength(6);
    expect(new Set(inner.steps.map((x) => x.id)).size).toBe(6);
  });
  it('inline repeats with "/" and trailing rest', () => {
    const r = steps('- 6x 3m 110% / 3m 50%')[0] as Repeat;
    expect(r.count).toBe(6);
    expect(r.steps.map((x) => (x as Step).measure)).toEqual([
      { type: 'time', sec: 180 },
      { type: 'time', sec: 180 },
    ]);
    const row = steps('5x1000m r2m', 'row')[0] as Repeat;
    expect(row.steps).toMatchObject([
      { role: 'active', measure: { type: 'distance', m: 1000 } },
      { role: 'recovery', measure: { type: 'time', sec: 120 } },
    ]);
    const thirty = steps('10x30s/30s 120%')[0] as Repeat;
    expect(thirty.steps).toHaveLength(2);
  });
  it('sections set roles of top-level steps; explicit role keywords win', () => {
    const s = steps('Warmup:\n- 10m 80%\n- cd 5m 50%\nMain:\n- 20m 80%\nCooldown:\n- 10m 70%') as Step[];
    expect(s.map((x) => x.role)).toEqual(['warmup', 'cooldown', 'active', 'cooldown']);
  });
  it('role keywords', () => {
    expect(steps('- wu 10m\n- active 5m\n- r 2m\n- rest 1m\n- other 1m\n- cd 10m').map((x) => (x as Step).role)).toEqual([
      'warmup',
      'active',
      'recovery',
      'rest',
      'other',
      'cooldown',
    ]);
    expect(one('- r 20s', 'swim').role).toBe('rest');
    expect(one('- r400m', 'run')).toMatchObject({ role: 'recovery', measure: { type: 'distance', m: 400 } });
  });
  it('inferred roles: warmup / active / recovery / cooldown', () => {
    expect((steps('- 15m 60%\n- 20m 100%\n- 5m 55%\n- 20m 100%\n- 10m 50%') as Step[]).map((x) => x.role)).toEqual([
      'warmup',
      'active',
      'recovery',
      'active',
      'cooldown',
    ]);
    expect((steps('- 1h30m z2', 'run') as Step[])[0].role).toBe('active');
    expect((steps('- 10m 50%\n- 2h 65%\n- 10m 50%') as Step[]).map((x) => x.role)).toEqual(['warmup', 'active', 'cooldown']);
    const st: WorkoutStructure = { steps: [makeStep({ role: 'other', measure: { type: 'time', sec: 60 } })] };
    expect([...inferStepRoles(st, 'bike').values()]).toEqual(['active']);
  });
  it('labels, cues, meta, title, pool, intensity lines', () => {
    const r = parse('title: Big day\nintensity: vo2\npool 25y\n@key #VO2 #hills\n- Spin-ups 5m 100rpm // high cadence\n- "Z2 block" 20m z2', 'swim');
    expect(r.title).toBe('Big day');
    expect(r.meta).toEqual({ isKey: true, tags: ['vo2', 'hills'], intensity: 'high' });
    expect(r.structure.poolLengthM).toBeCloseTo(22.86);
    expect(r.structure.steps[0]).toMatchObject({ label: 'Spin-ups', cue: 'high cadence' });
    expect((r.structure.steps[1] as Step).label).toBe('Z2 block');
    expect(parse('# My title\n- 5m').title).toBe('My title');
  });
  it('swim options', () => {
    const s = one('- 200m back +fins +paddles r 20s', 'swim');
    expect(s.swim).toEqual({ stroke: 'back', equipment: ['fins', 'paddles'], restSec: 20 });
    expect(one('- 100m im on 1:45', 'swim').swim).toEqual({ stroke: 'im', sendOffSec: 105 });
  });
});

describe('tolerance and issues', () => {
  it('unknown tokens produce a warning with line and column', () => {
    const r = parse('- 10m 50%\n- 8m 95% foo');
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ line: 2, col: 10, severity: 'warning' });
    expect(r.issues[0].message).toContain('foo');
    expect((r.structure.steps[1] as Step).target).toEqual({ type: 'power_pct', low: 95, high: 95 });
  });
  it('missing measure → lap-button step and an error', () => {
    const r = parse('- z3');
    expect(r.issues[0]).toMatchObject({ severity: 'error', line: 1, col: 3 });
    expect(one('- z3').measure).toEqual({ type: 'lap_button' });
  });
  it('empty repeats and bad counts are reported', () => {
    const r = parse('4x\n- 5m');
    expect(r.issues.some((i) => i.severity === 'error' && i.message.includes('4x'))).toBe(true);
    expect(r.structure.steps).toHaveLength(1);
    expect(errors('0x\n  - 1m').length).toBe(1);
    expect((steps('9999x\n  - 1m')[0] as Repeat).count).toBe(500);
  });
  it('gibberish lines are reported, not dropped silently', () => {
    const r = parse('hello world\n- 5m');
    expect(r.issues[0]).toMatchObject({ line: 1, severity: 'warning' });
    expect(r.structure.steps).toHaveLength(1);
  });
  it('never throws on arbitrary input', () => {
    const alphabet = ['- ', '4x', ' ', '\n', '  ', '\t', '8m', '95%', '/', '+', ':', '"', '//', '#', '@', 'z', '3', 'x', 'rpe', 'r', 'on', '1:45', '/km', 'ramp', '-', '%', 'Main set:', 'css+', 'm', 'é', '💥'];
    let seed = 42;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let k = 0; k < 400; k++) {
      let s = '';
      const n = Math.floor(rnd() * 40);
      for (let i = 0; i < n; i++) s += alphabet[Math.floor(rnd() * alphabet.length)];
      for (const sport of ['bike', 'run', 'swim', 'row', 'strength'] as Sport[]) {
        const r = parseWorkoutText(s, sport);
        expect(Array.isArray(r.issues)).toBe(true);
        // whatever parsed must format and re-parse to the same structure
        const f = formatWorkoutText(r.structure, sport);
        expect(stripIds(parseWorkoutText(f, sport).structure)).toEqual(stripIds(r.structure));
      }
    }
    expect(parseWorkoutText(undefined as unknown as string, 'bike').structure.steps).toEqual([]);
    expect(parseQuickAdd(null as unknown as string).sport).toBe('other');
  });
});

describe('formatWorkoutText', () => {
  it('canonical output', () => {
    const f = formatWorkoutText(
      parse('Warmup:\n- 15m ramp 50-75%\nMain set: 4x\n  - 8m 95-100% 85-95rpm\n  - 4m 55%\nCooldown:\n- 10m 50%').structure,
      'bike',
    );
    expect(f).toBe('- 15m ramp 50-75%\nMain set: 4x\n  - 8m 95-100% 85-95rpm\n  - 4m 55%\n- 10m 50%');
  });
  it('writes role keywords only where inference differs', () => {
    const s: WorkoutStructure = {
      steps: [
        makeStep({ role: 'other', measure: { type: 'time', sec: 600 } }),
        makeStep({ role: 'warmup', measure: { type: 'time', sec: 600 }, target: { type: 'power_pct', low: 100, high: 100 } }),
      ],
    };
    const f = formatWorkoutText(s, 'bike');
    expect(f).toBe('- other 10m\n- wu 10m 100%');
    expect(stripIds(parse(f).structure)).toEqual(stripIds(s));
  });
  it('round-trips builder-made structures', () => {
    const s: WorkoutStructure = {
      steps: [
        makeStep({ role: 'warmup', label: 'Easy spin', cue: 'relax', measure: { type: 'time', sec: 605 }, target: { type: 'hr_zone', zone: 2 } }),
        makeRepeat(5, [
          makeStep({ role: 'active', measure: { type: 'distance', m: 1000 }, target: { type: 'power_w', low: 250, high: 270 }, secondary: { type: 'cadence', low: 95, high: 100 } }),
          makeStep({ role: 'rest', measure: { type: 'lap_button' } }),
          makeRepeat(2, [makeStep({ role: 'active', measure: { type: 'time', sec: 12.5 }, target: { type: 'rpe', low: 9, high: 10 } })]),
        ], 'Block: A'),
        makeStep({ role: 'cooldown', measure: { type: 'time', sec: 3630 }, target: { type: 'ramp', basis: 'hr_pct_lthr', from: 80, to: 70 } }),
      ],
    };
    const f = formatWorkoutText(s, 'bike');
    expect(stripIds(parse(f).structure)).toEqual(stripIds(s));
    expect(f).toContain('"Block: A": 5x');
    expect(f).toContain('z2 hr');
    expect(f).toContain('1h0m30s');
  });
  it('round-trips paces and yard pools exactly', () => {
    roundTrip('- 5km 4:20-4:30/km\n- 400m 1:15.5/400m', 'run');
    roundTrip('pool 25y\n- 100y 1:30/100y\n- 500y free', 'swim');
    roundTrip('- 2000m 1:52.3/500m 24spm', 'row');
    const imperial = formatWorkoutText(parse('- 1mi 7:00/mi', 'run').structure, 'run', { units: 'imperial' });
    expect(imperial).toBe('- 1mi 7:00/mi');
  });
  it('round-trips the spec examples and many one-liners', () => {
    const cases: [string, Sport][] = [
      ['- 15m z2\n6x\n  - 800m 3:30/km\n  - r 400m  // jog\n- 10m z1', 'run'],
      ['pool 25m\n- 400m free z2\n- 4x 50m drill:catchup on 1:00\nMain set: 8x\n  - 100m free css+3s on 1:50 +pull\n- 200m choice easy', 'swim'],
      ['- 10m rpe3 20spm\n3x\n  - 2000m 1:52/500m 24-26spm\n  - r 5m\n- 5m rpe2', 'row'],
      ['Back squat 4x6 @80kg rpe8 r2m\nPull-up 3x8 @bw + Push-up 3x15 @bw r60s // ss\nPlank 3x45s', 'strength'],
      ['- 30m open\n- 10m 90%ftp 180spm', 'run'],
      ['- 2h 56-75%\n- 1m 150-200%', 'bike'],
      ['- 20m 85%hr\n- 10m 150-160bpm', 'hike'],
      ['- 50m kick +kick +fins\n- 25m back r 30s', 'swim'],
      ['- 45min', 'swim'],
      ['- 25min', 'swim'],
      ['- 10mtr', 'swim'],
      ['- 3x 1m 120% / 1m 50%', 'bike'],
      ['- 12reps', 'other'],
      ['- 300m', 'bike'],
      ['- 1.5km', 'bike'],
      ['- 42.195km', 'run'],
      ['- 5m z4 power\n- 5m z3 pace', 'run'],
      ['- 5m ramp 60-90%pace', 'bike'],
      ['- 10m css\n- 10m thr', 'run'],
      ['- 10m 60%\n"Plank" 3x45s\nSquat 3x10', 'bike'],
      ['Back extension 3x12\n- 400m free', 'swim'],
    ];
    for (const [t, sport] of cases) roundTrip(t, sport);
  });
});

describe('parseQuickAdd', () => {
  it('run 45m easy', () => {
    expect(parseQuickAdd('run 45m easy')).toMatchObject({ sport: 'run', durationSec: 2700, intensity: 'endurance', isKey: false, tags: [], title: 'Endurance 45′' });
    expect(parseQuickAdd('run 45m easy').structure).toBeUndefined();
  });
  it('bike 4x8m 95-100% @key #vo2', () => {
    const q = parseQuickAdd('bike 4x8m 95-100% @key #vo2');
    expect(q).toMatchObject({ sport: 'bike', isKey: true, tags: ['vo2'], intensity: 'threshold', durationSec: 1920, title: '4×8′ @ 95–100%' });
    expect((q.structure!.steps[0] as Repeat).count).toBe(4);
  });
  it('swim 3km, strength 40m, yoga 30m, hike 3h', () => {
    expect(parseQuickAdd('swim 3km')).toMatchObject({ sport: 'swim', distanceM: 3000 });
    expect(parseQuickAdd('strength 40m')).toMatchObject({ sport: 'strength', durationSec: 2400 });
    expect(parseQuickAdd('gym 40m').sport).toBe('strength');
    expect(parseQuickAdd('yoga 30m')).toMatchObject({ sport: 'yoga', durationSec: 1800 });
    expect(parseQuickAdd('hike 3h')).toMatchObject({ sport: 'hike', durationSec: 10800 });
    expect(parseQuickAdd('walk 5km').distanceM).toBe(5000);
  });
  it('row 5x1000m r2m', () => {
    const q = parseQuickAdd('row 5x1000m r2m');
    expect(q.sport).toBe('row');
    const rep = q.structure!.steps[0] as Repeat;
    expect(rep.count).toBe(5);
    expect(rep.steps).toHaveLength(2);
    expect(q.distanceM).toBeUndefined();
  });
  it('synonyms, sub-sport, title words', () => {
    expect(parseQuickAdd('ride 1h').sport).toBe('bike');
    expect(parseQuickAdd('cycle 1h').sport).toBe('bike');
    expect(parseQuickAdd('erg 20m').sport).toBe('row');
    expect(parseQuickAdd('lift 30m').sport).toBe('strength');
    const q = parseQuickAdd('bike indoor Threshold 4x8');
    expect(q).toMatchObject({ sport: 'bike', subSport: 'indoor', title: 'Threshold', intensity: 'threshold' });
    expect(q.issues.map((i) => i.severity)).toEqual(['info']);
    expect(parseQuickAdd('run trail Hill session 1h').subSport).toBe('trail');
    expect(parseQuickAdd('run trail Hill session 1h').title).toBe('Hill session');
  });
  it('targets keep a structure; bare intensity words set the class', () => {
    const q = parseQuickAdd('bike 2h z2 #long');
    expect(q).toMatchObject({ durationSec: 7200, intensity: 'endurance', tags: ['long'] });
    expect(q.structure).toBeDefined();
    expect(parseQuickAdd('swim 2500m css @key')).toMatchObject({ distanceM: 2500, isKey: true, intensity: 'threshold' });
    expect(parseQuickAdd('run 30m tempo').intensity).toBe('tempo');
    expect(parseQuickAdd('run 30m vo2').intensity).toBe('high');
    expect(parseQuickAdd('run 1h recovery').intensity).toBe('recovery');
  });
  it('missing sport is reported', () => {
    const q = parseQuickAdd('45m easy');
    expect(q.sport).toBe('other');
    expect(q.issues[0].severity).toBe('warning');
    expect(parseQuickAdd('45m easy', { defaultSport: 'run' }).sport).toBe('run');
  });
});
