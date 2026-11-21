/**
 * Built-in starter library: ~30 templates across bike / run / swim / row / strength, written in
 * the text syntax (text.ts) and parsed once at module load. Node ids are deterministic
 * (`<key>.<path>`) so server and client renders agree.
 */
import type { IntensityClass, Sport, SubSport, ThresholdSnapshot, WorkoutStructure } from '../domain';
import { derivePlannedTotals } from './estimate';
import { reassignIds } from './structure';
import type { AnyNode } from './structure';
import { parseWorkoutText } from './text';

export interface StarterTemplateSource {
  /** Stable key, e.g. 'bike-threshold-2x20'. */
  key: string;
  sport: Sport;
  subSport?: SubSport;
  title: string;
  /** Purpose / coaching cues (markdown). */
  description: string;
  intensity: IntensityClass;
  tags: string[];
  isKey: boolean;
  /** Library folder (defaults by sport). */
  folder: string;
  /** Workout in the text syntax. */
  text: string;
}

export interface StarterTemplate extends StarterTemplateSource {
  structure: WorkoutStructure;
}

const SOURCES: StarterTemplateSource[] = [
  // ───────── bike ─────────
  {
    key: 'bike-recovery-45',
    sport: 'bike',
    title: 'Recovery spin 45′',
    description: 'Very easy spin to promote recovery. Keep it conversational and the cadence light.',
    intensity: 'recovery',
    tags: ['recovery'],
    isKey: false,
    folder: 'Bike',
    text: `- 45m 45-55% 90-100rpm`,
  },
  {
    key: 'bike-endurance-90',
    sport: 'bike',
    title: 'Endurance 1:30',
    description: 'Steady zone-2 aerobic ride. Smooth pedalling, fuel every 30′.',
    intensity: 'endurance',
    tags: ['endurance', 'z2'],
    isKey: false,
    folder: 'Bike',
    text: `Warmup:
- 10m ramp 50-65%
Main set:
- 1h10m 65-72% 85-95rpm
Cooldown:
- 10m 50%`,
  },
  {
    key: 'bike-long-3h',
    sport: 'bike',
    title: 'Long ride 3:00',
    description: 'The weekly long endurance ride. Stay in zone 2; practise race fuelling.',
    intensity: 'endurance',
    tags: ['long', 'endurance'],
    isKey: true,
    folder: 'Bike',
    text: `Warmup:
- 15m ramp 50-65%
Main set:
- 2h30m 62-75%  // eat 60–90 g carbs per hour
Cooldown:
- 15m 50-55%`,
  },
  {
    key: 'bike-tempo-3x15',
    sport: 'bike',
    title: 'Tempo 3×15′',
    description: 'Muscular endurance at tempo. Seated, steady, nose-breathing hard but sustainable.',
    intensity: 'tempo',
    tags: ['tempo'],
    isKey: false,
    folder: 'Bike',
    text: `Warmup:
- 15m ramp 50-70%
Main set: 3x
  - 15m 80-85% 85-90rpm
  - 5m 55%
Cooldown:
- 10m 50%`,
  },
  {
    key: 'bike-sweetspot-3x12',
    sport: 'bike',
    title: 'Sweet spot 3×12′',
    description: 'Sweet-spot intervals just under threshold: big aerobic stimulus for moderate fatigue.',
    intensity: 'tempo',
    tags: ['sweetspot'],
    isKey: false,
    folder: 'Bike',
    text: `Warmup:
- 15m ramp 50-75%
Main set: 3x
  - 12m 88-93% 85-95rpm
  - 4m 50%
Cooldown:
- 10m 50%`,
  },
  {
    key: 'bike-threshold-2x20',
    sport: 'bike',
    title: 'Threshold 2×20′',
    description: 'Classic 2×20′ at threshold. Even pacing; the second interval should feel like the first.',
    intensity: 'threshold',
    tags: ['threshold', 'ftp'],
    isKey: true,
    folder: 'Bike',
    text: `Warmup:
- 15m ramp 50-75%
- 3x 1m 100% / 1m 50%  // openers
Main set: 2x
  - 20m 95-100% 85-95rpm
  - 5m 50%
Cooldown:
- 10m 50%`,
  },
  {
    key: 'bike-over-unders',
    sport: 'bike',
    title: 'Over-unders 3×9′',
    description: 'Alternate just under and just over threshold to train lactate clearance.',
    intensity: 'threshold',
    tags: ['threshold', 'over-under'],
    isKey: true,
    folder: 'Bike',
    text: `Warmup:
- 15m ramp 50-75%
Main set: 3x
  3x
    - 2m 95%
    - 1m 105%
  - 5m 50%
Cooldown:
- 10m 50%`,
  },
  {
    key: 'bike-vo2-5x4',
    sport: 'bike',
    title: 'VO2max 5×4′',
    description: 'Hard aerobic-capacity intervals. Start controlled, finish each rep at your limit.',
    intensity: 'high',
    tags: ['vo2'],
    isKey: true,
    folder: 'Bike',
    text: `Warmup:
- 15m ramp 50-75%
Main set: 5x
  - 4m 110-120% 95-105rpm
  - 4m 50%
Cooldown:
- 10m 50%`,
  },
  {
    key: 'bike-30-30',
    sport: 'bike',
    title: '30/30s 2×10',
    description: 'Short VO2 intervals: 30″ hard, 30″ easy. Time at high oxygen uptake with less strain than long reps.',
    intensity: 'high',
    tags: ['vo2', 'intervals'],
    isKey: true,
    folder: 'Bike',
    text: `Warmup:
- 15m ramp 50-75%
Main set: 2x
  10x
    - 30s 120-130%
    - 30s 50%
  - 5m 50%
Cooldown:
- 10m 50%`,
  },
  // ───────── run ─────────
  {
    key: 'run-recovery-30',
    sport: 'run',
    title: 'Recovery jog 30′',
    description: 'Very easy jog. Walk breaks are fine; HR stays in zone 1.',
    intensity: 'recovery',
    tags: ['recovery'],
    isKey: false,
    folder: 'Run',
    text: `- 30m z1`,
  },
  {
    key: 'run-easy-45',
    sport: 'run',
    title: 'Easy run 45′',
    description: 'Conversational aerobic run in HR zone 2.',
    intensity: 'endurance',
    tags: ['easy', 'z2'],
    isKey: false,
    folder: 'Run',
    text: `- 45m z2`,
  },
  {
    key: 'run-long-90',
    sport: 'run',
    title: 'Long run 1:30',
    description: 'The weekly long run. Easy effort; practise fuelling after 60′.',
    intensity: 'endurance',
    tags: ['long'],
    isKey: true,
    folder: 'Run',
    text: `- 1h30m z2  // gel at 45′ and 75′`,
  },
  {
    key: 'run-strides',
    sport: 'run',
    title: 'Easy run + strides',
    description: 'Easy aerobic running finished with relaxed, fast strides for leg speed and form.',
    intensity: 'endurance',
    tags: ['easy', 'strides'],
    isKey: false,
    folder: 'Run',
    text: `- 45m z2
6x
  - 20s 105-110%  // relaxed, tall, quick feet
  - 1m40s rpe2
- 5m z1`,
  },
  {
    key: 'run-tempo-20',
    sport: 'run',
    title: 'Tempo 20′',
    description: 'Continuous tempo at "comfortably hard" — about half-marathon effort.',
    intensity: 'tempo',
    tags: ['tempo'],
    isKey: true,
    folder: 'Run',
    text: `- 15m z2
- 20m 88-92%
- 10m z1`,
  },
  {
    key: 'run-cruise-4x8',
    sport: 'run',
    title: 'Cruise intervals 4×8′',
    description: 'Threshold-pace cruise intervals with short jog recoveries.',
    intensity: 'threshold',
    tags: ['threshold'],
    isKey: true,
    folder: 'Run',
    text: `- 15m z2
4x
  - 8m 97-100%
  - 2m z1
- 10m z1`,
  },
  {
    key: 'run-track-6x800',
    sport: 'run',
    title: 'Track 6×800 m',
    description: 'VO2max reps on the track at roughly 3–5 km race pace, 400 m jog between.',
    intensity: 'high',
    tags: ['vo2', 'track'],
    isKey: true,
    folder: 'Run',
    text: `- 15m z2
- 4x 100m 105% / r 100m  // strides
6x
  - 800m 106-110%
  - r 400m  // jog recovery
- 10m z1`,
  },
  {
    key: 'run-hills-8x90',
    sport: 'run',
    title: 'Hill repeats 8×90″',
    description: 'Strong uphill efforts (~5 % grade), jog down to recover.',
    intensity: 'high',
    tags: ['hills', 'vo2'],
    isKey: true,
    folder: 'Run',
    text: `- 15m z2
8x
  - 90s rpe9  // uphill, drive the arms
  - 2m30s rpe2  // jog back down
- 10m z1`,
  },
  // ───────── swim ─────────
  {
    key: 'swim-css-8x100',
    sport: 'swim',
    subSport: 'pool',
    title: 'CSS 8×100',
    description: 'Threshold swim set at critical swim speed on a tight send-off.',
    intensity: 'threshold',
    tags: ['css', 'threshold'],
    isKey: true,
    folder: 'Swim',
    text: `pool 25m
- 400m free z1
- 4x 50m drill:catchup on 1:00
- 4x 50m kick +kick on 1:10
Main set: 8x
  - 100m free css on 1:50
- 200m choice easy`,
  },
  {
    key: 'swim-aerobic-2500',
    sport: 'swim',
    subSport: 'pool',
    title: 'Aerobic 2500',
    description: 'Steady aerobic volume with short rests.',
    intensity: 'endurance',
    tags: ['endurance'],
    isKey: false,
    folder: 'Swim',
    text: `pool 25m
- 300m free z1
- 200m kick +kick
4x
  - 400m free z2 r 30s
- 200m choice z1`,
  },
  {
    key: 'swim-pull-6x200',
    sport: 'swim',
    subSport: 'pool',
    title: 'Pull 6×200',
    description: 'Pull-buoy and paddles strength-endurance set; focus on catch and rotation.',
    intensity: 'endurance',
    tags: ['pull'],
    isKey: false,
    folder: 'Swim',
    text: `pool 25m
- 400m free z1
6x
  - 200m free z2 +pull +paddles r 20s
- 4x 50m kick +kick r 15s
- 200m choice z1`,
  },
  {
    key: 'swim-kick-drill',
    sport: 'swim',
    subSport: 'pool',
    title: 'Kick & drill',
    description: 'Technique session: drills and kick with fins, all easy.',
    intensity: 'recovery',
    tags: ['technique', 'kick'],
    isKey: false,
    folder: 'Swim',
    text: `pool 25m
- 300m free z1
6x
  - 50m drill:fingertip r 15s
8x
  - 50m kick +kick +fins r 15s
- 200m choice z1`,
  },
  {
    key: 'swim-speed-12x50',
    sport: 'swim',
    subSport: 'pool',
    title: 'Speed 12×50',
    description: 'Fast 50s with generous send-offs for speed and stroke rate.',
    intensity: 'high',
    tags: ['speed'],
    isKey: true,
    folder: 'Swim',
    text: `pool 25m
- 400m free z1
- 4x 50m drill:scull r 15s
Main set: 12x
  - 50m free z5 on 1:15
- 300m choice z1`,
  },
  // ───────── row ─────────
  {
    key: 'row-ut2-60',
    sport: 'row',
    subSport: 'erg',
    title: 'Steady state UT2 60′',
    description: 'Long, low-rate aerobic paddle. Length and relaxation over power.',
    intensity: 'endurance',
    tags: ['ut2', 'endurance'],
    isKey: false,
    folder: 'Row',
    text: `- wu 10m rpe3 20spm
- 45m 65-75% 18-20spm
- cd 5m rpe2`,
  },
  {
    key: 'row-ut1-3x15',
    sport: 'row',
    subSport: 'erg',
    title: 'UT1 3×15′',
    description: 'Upper aerobic pieces at a controlled rate.',
    intensity: 'tempo',
    tags: ['ut1'],
    isKey: false,
    folder: 'Row',
    text: `- wu 10m rpe3 20spm
3x
  - 15m 80-88% 22-24spm
  - r 3m
- cd 5m rpe2`,
  },
  {
    key: 'row-4x2k',
    sport: 'row',
    subSport: 'erg',
    title: 'Erg 4×2000 m',
    description: 'Threshold pieces at 2k-minus pace; hold the split for the whole piece.',
    intensity: 'threshold',
    tags: ['threshold'],
    isKey: true,
    folder: 'Row',
    text: `- wu 10m rpe3 20spm
4x
  - 2000m 95-100% 24-26spm
  - r 5m
- cd 10m rpe2`,
  },
  {
    key: 'row-8x500',
    sport: 'row',
    subSport: 'erg',
    title: 'Erg 8×500 m',
    description: 'High-intensity 500 m pieces at a high rate, 2′ easy paddle between.',
    intensity: 'high',
    tags: ['vo2', 'intervals'],
    isKey: true,
    folder: 'Row',
    text: `- wu 12m rpe3 20spm
8x
  - 500m 110-120% 30-32spm
  - r 2m
- cd 8m rpe2`,
  },
  // ───────── strength ─────────
  {
    key: 'strength-full-body-a',
    sport: 'strength',
    subSport: 'gym',
    title: 'Full body A',
    description: 'Compound full-body session. Leave 1–2 reps in reserve on every set.',
    intensity: 'threshold',
    tags: ['full-body'],
    isKey: false,
    folder: 'Strength',
    text: `- 5m rpe3  // easy row or bike
Back squat 4x6 rpe8 r2m
Romanian deadlift 3x8 rpe7 r90s
Pull-up 3x8 @bw + Push-up 3x15 @bw r60s
Plank 3x45s rpe6 r30s`,
  },
  {
    key: 'strength-full-body-b',
    sport: 'strength',
    subSport: 'gym',
    title: 'Full body B',
    description: 'Hinge, press and single-leg work.',
    intensity: 'threshold',
    tags: ['full-body'],
    isKey: false,
    folder: 'Strength',
    text: `- 5m rpe3
Deadlift 4x5 rpe8 r2m30s
Bench press 4x6 rpe8 r2m
Split squat 3x10 rpe7 r90s
Bent-over row 3x10 rpe7 r90s
Side plank 3x30s rpe5 r30s`,
  },
  {
    key: 'strength-lower-power',
    sport: 'strength',
    subSport: 'gym',
    title: 'Lower body power',
    description: 'Explosive jumps then heavy, low-rep squats for force and power.',
    intensity: 'threshold',
    tags: ['power', 'legs'],
    isKey: false,
    folder: 'Strength',
    text: `Box jump 4x5 rpe6 r90s
Back squat 5x3 rpe8 r3m
Hip thrust 3x8 rpe7 r90s
Calf raise 3x15 rpe6 r60s`,
  },
  {
    key: 'strength-core',
    sport: 'strength',
    subSport: 'bodyweight',
    title: 'Core 20′',
    description: 'Anti-extension, anti-rotation and bracing work. Quality over quantity.',
    intensity: 'endurance',
    tags: ['core'],
    isKey: false,
    folder: 'Strength',
    text: `Plank 3x45s rpe4 r30s
Dead bug 3x10 rpe4 r30s
Side plank 3x30s rpe4 r30s
Bird dog 3x10 rpe4 r30s
Hollow hold 3x20s rpe4 r30s`,
  },
  {
    key: 'strength-circuit',
    sport: 'strength',
    subSport: 'hiit',
    title: 'Kettlebell circuit',
    description: 'Three rounds, minimal rest between exercises, 1′ between rounds.',
    intensity: 'tempo',
    tags: ['circuit'],
    isKey: false,
    folder: 'Strength',
    text: `3x
  Goblet squat 1x10 rpe5 r15s
  Push-up 1x12 rpe6 r15s
  Kettlebell swing 1x15 rpe6 r15s
  - rest 1m`,
  },
];

function withDeterministicIds(key: string, s: WorkoutStructure): WorkoutStructure {
  const rec = (n: AnyNode, path: string): AnyNode =>
    n.kind === 'step' ? { ...n, id: `${key}.${path}` } : ({ ...n, id: `${key}.${path}`, steps: n.steps.map((c, i) => rec(c as AnyNode, `${path}.${i}`)) } as AnyNode);
  return { ...s, steps: s.steps.map((n, i) => rec(n, String(i)) as WorkoutStructure['steps'][number]) };
}

/** Text sources of the starter library (for seeding / editing). */
export const STARTER_TEMPLATE_SOURCES: readonly StarterTemplateSource[] = SOURCES;

/** Parsed starter templates with deterministic node ids. */
export const STARTER_TEMPLATES: readonly StarterTemplate[] = SOURCES.map((src) => ({
  ...src,
  structure: withDeterministicIds(src.key, parseWorkoutText(src.text, src.sport).structure),
}));

/**
 * Fields for a planned workout / template created from a starter template: fresh node ids
 * plus planned totals computed with the athlete's thresholds.
 */
export function instantiateTemplate(t: StarterTemplate, thresholds: ThresholdSnapshot) {
  const structure = reassignIds(t.structure);
  const totals = derivePlannedTotals({ sport: t.sport, intensity: t.intensity, structure }, thresholds);
  return {
    sport: t.sport,
    ...(t.subSport ? { subSport: t.subSport } : {}),
    title: t.title,
    description: t.description,
    structure,
    intensity: t.intensity,
    tags: [...t.tags],
    isKey: t.isKey,
    templateKey: t.key,
    ...totals,
  };
}
