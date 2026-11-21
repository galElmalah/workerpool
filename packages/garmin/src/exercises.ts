/**
 * Compact strength exercise catalog → Garmin `category` / `exerciseName`
 * (UPPER_SNAKE forms of the FIT SDK `exercise_category` / `*_exercise_name`
 * enums, which is what Connect uses — garmin.md §5.2). Every entry is checked
 * against the bundled FIT profile in test/exercises.test.ts.
 */

export interface GarminExercise {
  category: string;
  exerciseName: string;
}

interface CatalogEntry extends GarminExercise {
  aliases: string[];
}

export const EXERCISE_CATALOG: Record<string, CatalogEntry> = {
  back_squat: { category: 'SQUAT', exerciseName: 'BARBELL_BACK_SQUAT', aliases: ['back squat', 'barbell squat', 'squat'] },
  front_squat: { category: 'SQUAT', exerciseName: 'BARBELL_FRONT_SQUAT', aliases: ['front squat'] },
  goblet_squat: { category: 'SQUAT', exerciseName: 'GOBLET_SQUAT', aliases: ['goblet squat'] },
  air_squat: { category: 'SQUAT', exerciseName: 'AIR_SQUAT', aliases: ['air squat', 'bodyweight squat'] },
  step_up: { category: 'SQUAT', exerciseName: 'DUMBBELL_STEP_UP', aliases: ['step up', 'step-up', 'dumbbell step up'] },
  thruster: { category: 'SQUAT', exerciseName: 'THRUSTERS', aliases: ['thruster', 'thrusters'] },
  wall_ball: { category: 'SQUAT', exerciseName: 'WALL_BALL', aliases: ['wall ball'] },
  bulgarian_split_squat: { category: 'LUNGE', exerciseName: 'DUMBBELL_BULGARIAN_SPLIT_SQUAT', aliases: ['bulgarian split squat', 'split squat'] },
  lunge: { category: 'LUNGE', exerciseName: 'LUNGE', aliases: ['lunge', 'lunges'] },
  dumbbell_lunge: { category: 'LUNGE', exerciseName: 'DUMBBELL_LUNGE', aliases: ['dumbbell lunge', 'walking lunge'] },
  barbell_lunge: { category: 'LUNGE', exerciseName: 'BARBELL_LUNGE', aliases: ['barbell lunge'] },
  bench_press: { category: 'BENCH_PRESS', exerciseName: 'BARBELL_BENCH_PRESS', aliases: ['bench press', 'bench', 'barbell bench press'] },
  dumbbell_bench_press: { category: 'BENCH_PRESS', exerciseName: 'DUMBBELL_BENCH_PRESS', aliases: ['dumbbell bench press', 'db bench press'] },
  incline_bench_press: { category: 'BENCH_PRESS', exerciseName: 'INCLINE_BARBELL_BENCH_PRESS', aliases: ['incline bench press', 'incline bench'] },
  deadlift: { category: 'DEADLIFT', exerciseName: 'BARBELL_DEADLIFT', aliases: ['deadlift', 'barbell deadlift', 'conventional deadlift'] },
  romanian_deadlift: { category: 'DEADLIFT', exerciseName: 'ROMANIAN_DEADLIFT', aliases: ['romanian deadlift', 'rdl'] },
  trap_bar_deadlift: { category: 'DEADLIFT', exerciseName: 'TRAP_BAR_DEADLIFT', aliases: ['trap bar deadlift', 'hex bar deadlift'] },
  sumo_deadlift: { category: 'DEADLIFT', exerciseName: 'SUMO_DEADLIFT', aliases: ['sumo deadlift'] },
  single_leg_rdl: { category: 'DEADLIFT', exerciseName: 'SINGLE_LEG_ROMANIAN_DEADLIFT_WITH_DUMBBELL', aliases: ['single leg rdl', 'single-leg romanian deadlift'] },
  overhead_press: { category: 'SHOULDER_PRESS', exerciseName: 'OVERHEAD_BARBELL_PRESS', aliases: ['overhead press', 'ohp', 'military press', 'strict press'] },
  dumbbell_shoulder_press: { category: 'SHOULDER_PRESS', exerciseName: 'DUMBBELL_SHOULDER_PRESS', aliases: ['dumbbell shoulder press', 'db shoulder press'] },
  pull_up: { category: 'PULL_UP', exerciseName: 'PULL_UP', aliases: ['pull up', 'pull-up', 'pullup', 'pull ups'] },
  chin_up: { category: 'PULL_UP', exerciseName: 'CHIN_UP', aliases: ['chin up', 'chin-up', 'chinup'] },
  lat_pulldown: { category: 'PULL_UP', exerciseName: 'LAT_PULLDOWN', aliases: ['lat pulldown', 'pulldown'] },
  push_up: { category: 'PUSH_UP', exerciseName: 'PUSH_UP', aliases: ['push up', 'push-up', 'pushup', 'push ups'] },
  barbell_row: { category: 'ROW', exerciseName: 'BARBELL_ROW', aliases: ['barbell row', 'bent over row', 'bent-over row'] },
  dumbbell_row: { category: 'ROW', exerciseName: 'DUMBBELL_ROW', aliases: ['dumbbell row', 'one arm row', 'single arm row'] },
  seated_cable_row: { category: 'ROW', exerciseName: 'SEATED_CABLE_ROW', aliases: ['seated cable row', 'cable row'] },
  inverted_row: { category: 'ROW', exerciseName: 'INVERTED_ROW', aliases: ['inverted row'] },
  face_pull: { category: 'ROW', exerciseName: 'FACE_PULL', aliases: ['face pull'] },
  plank: { category: 'PLANK', exerciseName: 'PLANK', aliases: ['plank'] },
  side_plank: { category: 'PLANK', exerciseName: 'SIDE_PLANK', aliases: ['side plank'] },
  hip_thrust: { category: 'HIP_RAISE', exerciseName: 'BARBELL_HIP_THRUST_WITH_BENCH', aliases: ['hip thrust', 'barbell hip thrust'] },
  glute_bridge: { category: 'HIP_RAISE', exerciseName: 'HIP_RAISE', aliases: ['glute bridge', 'hip raise', 'bridge'] },
  kettlebell_swing: { category: 'HIP_RAISE', exerciseName: 'KETTLEBELL_SWING', aliases: ['kettlebell swing', 'kb swing'] },
  calf_raise: { category: 'CALF_RAISE', exerciseName: 'STANDING_CALF_RAISE', aliases: ['calf raise', 'standing calf raise'] },
  biceps_curl: { category: 'CURL', exerciseName: 'DUMBBELL_BICEPS_CURL', aliases: ['biceps curl', 'bicep curl', 'dumbbell curl'] },
  barbell_curl: { category: 'CURL', exerciseName: 'BARBELL_BICEPS_CURL', aliases: ['barbell curl'] },
  leg_curl: { category: 'LEG_CURL', exerciseName: 'LEG_CURL', aliases: ['leg curl', 'hamstring curl'] },
  triceps_pressdown: { category: 'TRICEPS_EXTENSION', exerciseName: 'TRICEPS_PRESSDOWN', aliases: ['triceps pressdown', 'tricep pushdown'] },
  dip: { category: 'TRICEPS_EXTENSION', exerciseName: 'BODY_WEIGHT_DIP', aliases: ['dip', 'dips'] },
  lateral_raise: { category: 'LATERAL_RAISE', exerciseName: 'DUMBBELL_LATERAL_RAISE', aliases: ['lateral raise', 'side raise'] },
  shrug: { category: 'SHRUG', exerciseName: 'BARBELL_SHRUG', aliases: ['shrug', 'shrugs'] },
  farmers_carry: { category: 'CARRY', exerciseName: 'FARMERS_CARRY', aliases: ["farmer's carry", 'farmers carry', 'farmers walk'] },
  box_jump: { category: 'PLYO', exerciseName: 'BOX_JUMP', aliases: ['box jump', 'box jumps'] },
  jump_squat: { category: 'PLYO', exerciseName: 'JUMP_SQUAT', aliases: ['jump squat'] },
  burpee: { category: 'TOTAL_BODY', exerciseName: 'BURPEE', aliases: ['burpee', 'burpees'] },
  hanging_leg_raise: { category: 'LEG_RAISE', exerciseName: 'HANGING_LEG_RAISE', aliases: ['hanging leg raise'] },
  crunch: { category: 'CRUNCH', exerciseName: 'CRUNCH', aliases: ['crunch', 'crunches'] },
  sit_up: { category: 'SIT_UP', exerciseName: 'SIT_UP', aliases: ['sit up', 'sit-up', 'situp'] },
  russian_twist: { category: 'CORE', exerciseName: 'RUSSIAN_TWIST', aliases: ['russian twist'] },
  dead_bug: { category: 'HIP_STABILITY', exerciseName: 'DEAD_BUG', aliases: ['dead bug'] },
  power_clean: { category: 'OLYMPIC_LIFT', exerciseName: 'BARBELL_POWER_CLEAN', aliases: ['power clean'] },
  clean_and_jerk: { category: 'OLYMPIC_LIFT', exerciseName: 'CLEAN_AND_JERK', aliases: ['clean and jerk'] },
  snatch: { category: 'OLYMPIC_LIFT', exerciseName: 'SNATCH', aliases: ['snatch'] },
};

/** Keyword → category for unknown exercises (exerciseName "" shows the category only). */
const CATEGORY_KEYWORDS: [RegExp, string][] = [
  [/bench/, 'BENCH_PRESS'],
  [/deadlift|rdl/, 'DEADLIFT'],
  [/squat/, 'SQUAT'],
  [/lunge/, 'LUNGE'],
  [/pull.?up|chin.?up|pulldown/, 'PULL_UP'],
  [/push.?up/, 'PUSH_UP'],
  [/shoulder press|overhead press|military/, 'SHOULDER_PRESS'],
  [/\brow\b|rows\b/, 'ROW'],
  [/plank/, 'PLANK'],
  [/curl/, 'CURL'],
  [/calf/, 'CALF_RAISE'],
  [/carry|farmer/, 'CARRY'],
  [/swing/, 'HIP_SWING'],
  [/burpee/, 'TOTAL_BODY'],
  [/crunch/, 'CRUNCH'],
  [/sit.?up/, 'SIT_UP'],
  [/jump|plyo/, 'PLYO'],
  [/triceps?|dip/, 'TRICEPS_EXTENSION'],
  [/shrug/, 'SHRUG'],
  [/clean|snatch|jerk/, 'OLYMPIC_LIFT'],
  [/core|twist|hollow/, 'CORE'],
];

const norm = (s: string) => s.toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Resolve a prescription to a Garmin exercise.
 * - exact catalog key or alias → { category, exerciseName, exact: true }
 * - keyword match → { category, exerciseName: '', exact: false }
 * - nothing → undefined (caller puts the name into the step description)
 */
export function resolveExercise(exercise: string, exerciseKey?: string): (GarminExercise & { exact: boolean }) | undefined {
  if (exerciseKey) {
    const byKey = EXERCISE_CATALOG[exerciseKey] ?? EXERCISE_CATALOG[exerciseKey.toLowerCase()];
    if (byKey) return { category: byKey.category, exerciseName: byKey.exerciseName, exact: true };
    // Already a Garmin pair "CATEGORY/EXERCISE_NAME"?
    const m = /^([A-Z_]+)\/([A-Z0-9_]*)$/.exec(exerciseKey);
    if (m) return { category: m[1]!, exerciseName: m[2]!, exact: true };
  }
  const n = norm(exercise);
  for (const e of Object.values(EXERCISE_CATALOG)) {
    if (e.aliases.some((a) => norm(a) === n)) return { category: e.category, exerciseName: e.exerciseName, exact: true };
  }
  for (const [re, category] of CATEGORY_KEYWORDS) if (re.test(n)) return { category, exerciseName: '', exact: false };
  return undefined;
}

/** Garmin UPPER_SNAKE → "Barbell Back Squat". */
export function humanizeExercise(key: string): string {
  return key
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
}

/** FIT SDK camelCase ("barbellBackSquat") → Garmin UPPER_SNAKE ("BARBELL_BACK_SQUAT"). */
export function camelToUpperSnake(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toUpperCase();
}

/** Reverse lookup for completed sets: Garmin pair → our catalog key. */
export function catalogKeyFor(category: string, exerciseName: string): string | undefined {
  for (const [k, e] of Object.entries(EXERCISE_CATALOG)) if (e.category === category && e.exerciseName === exerciseName) return k;
  return undefined;
}
