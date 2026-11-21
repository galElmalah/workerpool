/**
 * Fast text syntax (product.md §4.6): a tolerant line parser, a canonical serializer and the
 * calendar quick-add parser. The parser never throws; problems are reported as issues.
 *
 * Grammar (one node per line, indentation = 2 spaces / tab per repeat level):
 *
 *   line        := meta | section | repeat | step | strength | "// comment"
 *   meta        := "title: Text" | "# Text" | "pool 25m|25y|50m" | "intensity: tempo" | "@key" | "#tag"
 *   section     := Label ":"                      Warmup:/Cooldown: set the role of following top-level steps
 *   repeat      := [Label ":"] N "x"               block; children are the following more-indented lines
 *                | [Label ":"] N "x" seg {"/" seg} inline repeat ("6x 3m 110% / 3m 50%", "5x1000m r2m")
 *   step        := "-" [role] [label] measure {target | option} ["// cue"]
 *   role        := wu | cd | r (recovery; swim: rest) | rec | rest | active | other
 *   measure     := 1h15m | 1h15 | 8m | 8m30s | 90s | 8:00 | 1:15:00 | 400m | 2km | 10k | 1mi | 100y | lap | 12reps
 *                  ("m" = meters when swim N≥25 & N%25=0, run/row N≥100, others N≥300; force with "min"/"mtr")
 *   target      := 95% | 88-94% | 95%ftp | 97%pace | 85%hr | 250w | 240-260w | 150-160bpm | z2 [hr|pace|power]
 *                | 4:30/km | 4:20-4:30/km | 1:45/100m | 1:52/500m | css[+3s] | thr[-5s] | rpe 7 | rpe 6-7
 *                | ramp 50-75% | open | 90rpm | 180spm | easy/tempo/threshold/hard words (→ RPE)
 *   option      := free|back|breast|fly|im|choice|kick|drill | drill:name | +pull|+paddles|+fins|+kick|+snorkel
 *                | on 1:50 (send-off) | r 20s (swim rest; elsewhere appends a recovery step) | 24-26spm (row rate)
 *   strength    := Exercise name  SETS "x" REPS|DURATION [@80kg|@60lb|@bw] [rpe 8] [r 2m] {"+" strength}
 *
 * Bare "%" means %FTP on bike/row, % threshold speed on run/swim, %LTHR elsewhere. A bare `zN`
 * is a power zone on bike, a CSS zone on swim, an HR zone (Friel 7-zone) elsewhere.
 */
import { SPORT_META, SPORTS, INTENSITY_CLASSES } from '../domain';
import type {
  IntensityClass,
  InnerRepeat,
  Repeat,
  Sport,
  Step,
  StepMeasure,
  StepRole,
  StructureNode,
  SubSport,
  Target,
  ThresholdSnapshot,
  WorkoutStructure,
} from '../domain';
import { classifyPlannedIntensity } from './intensity';
import { resolveTargetIntensity } from './estimate';
import { LB_KG, MILE_M, PACE_UNIT_M, YARD_M, fmtNum, paceUnitFor } from './format';
import type { PaceUnit, Units } from './format';
import { cloneWithNewIds, flattenStructure, newId } from './structure';
import type { AnyNode } from './structure';
import { DEFAULT_THRESHOLDS, INTENSITY_WORDS, POWER_ZONE_PCT, STEP_INTENSITY_RPE, SWIM_ZONE_PCT } from './tables';
import { autoTitle, autoTitleUnstructured } from './title';

export interface TextIssue {
  /** 1-based line. */
  line: number;
  /** 1-based column of the offending token. */
  col: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

export interface ParseMeta {
  isKey?: boolean;
  tags: string[];
  intensity?: IntensityClass;
}

export interface ParseResult {
  structure: WorkoutStructure;
  title?: string;
  issues: TextIssue[];
  meta: ParseMeta;
}

export interface ParseOptions {
  /** Used to convert `css±Ns` / `thr±Ns` offsets into % of threshold (else DEFAULT_THRESHOLDS). */
  thresholds?: ThresholdSnapshot;
}

/** `zN` on a run with "pace": % threshold speed (Friel pace zones, speed fractions). */
const RUN_PACE_ZONE_PCT: Record<number, readonly [number, number]> = {
  1: [70, 77],
  2: [78, 87],
  3: [88, 94],
  4: [95, 99],
  5: [100, 103],
  6: [104, 110],
  7: [111, 120],
};

const MAX_REPEAT_COUNT = 500;
const MAX_UNROLL_STEPS = 200;

// ───────────────────────────── tokens ─────────────────────────────

interface Tok {
  text: string;
  col: number;
}

const PACE_UNIT_RE = /^\/\s*(km|mi|100m|100y|100yd|500m)\b/i;

function tokenize(s: string, base: number): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"' || ch === '“' || ch === '”') {
      let j = i + 1;
      while (j < s.length && !['"', '“', '”'].includes(s[j])) j++;
      const end = Math.min(s.length, j + 1);
      out.push({ text: '"' + s.slice(i + 1, j) + '"', col: base + i });
      i = end;
      continue;
    }
    let j = i;
    while (j < s.length && !/\s/.test(s[j])) j++;
    const word = s.slice(i, j);
    // split on "/" unless it introduces a pace unit (4:30/km)
    let start = 0;
    for (let k = 0; k < word.length; k++) {
      if (word[k] === '/' && !PACE_UNIT_RE.test(word.slice(k))) {
        if (k > start) out.push({ text: word.slice(start, k), col: base + i + start });
        out.push({ text: '/', col: base + i + k });
        start = k + 1;
      }
    }
    if (start < word.length) out.push({ text: word.slice(start), col: base + i + start });
    i = j;
  }
  return out;
}

/** Try `fn` on the longest join (≤ maxK tokens, never across "/") starting at i. */
function tryMatch<T>(toks: Tok[], i: number, maxK: number, fn: (s: string) => T | undefined): { v: T; k: number } | undefined {
  for (let k = Math.min(maxK, toks.length - i); k >= 1; k--) {
    let ok = true;
    for (let q = i; q < i + k; q++) if (toks[q].text === '/' || toks[q].text === '+') ok = false;
    if (!ok) continue;
    const v = fn(toks.slice(i, i + k).map((t) => t.text).join(' '));
    if (v !== undefined) return { v, k };
  }
  return undefined;
}

// ───────────────────────────── primitive parsers ─────────────────────────────

const NUM = String.raw`(\d+(?:\.\d+)?)`;
const RANGE = String.raw`${NUM}(?:\s*[-–]\s*${NUM})?`;

/** Whether "Nm" means meters for this sport (otherwise minutes). */
export function mIsMeters(n: number, sport: Sport): boolean {
  if (sport === 'swim') return n >= 25 && n % 25 === 0;
  if (sport === 'run' || sport === 'row' || sport === 'walk' || sport === 'hike') return n >= 100;
  return n >= 300;
}

const RE_CLOCK = /^(\d+):([0-5]\d(?:\.\d+)?)(?::([0-5]\d(?:\.\d+)?))?$/;
const RE_H_BARE = /^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs)\s*(\d{1,2})$/i;
const RE_TIME = new RegExp(
  String.raw`^(?:${NUM}\s*(h|hrs?|hours?)\s*)?(?:${NUM}\s*(minutes?|mins?|m|')\s*)?(?:${NUM}\s*(seconds?|secs?|s|"|''|″))?$`,
  'i',
);
const RE_DIST = new RegExp(String.raw`^${NUM}\s*(km|k|mi|miles?|mtrs?|meters?|metres?|y|yds?|yards?)$`, 'i');
const RE_REPS = /^(\d+)\s*(reps?)$/i;

/** Parse a time-only expression (m = minutes). Seconds or undefined. */
function parseTime(s: string): number | undefined {
  s = s.trim();
  let m = RE_CLOCK.exec(s);
  if (m) return m[3] !== undefined ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2];
  m = RE_H_BARE.exec(s);
  if (m) return +m[1] * 3600 + +m[2] * 60;
  m = RE_TIME.exec(s.replace(/′/g, "'"));
  if (m && (m[1] || m[3] || m[5])) return (m[1] ? +m[1] * 3600 : 0) + (m[3] ? +m[3] * 60 : 0) + (m[5] ? +m[5] : 0);
  return undefined;
}

function distanceUnitM(u: string): number {
  const x = u.toLowerCase();
  if (x === 'km' || x === 'k') return 1000;
  if (x.startsWith('mi')) return MILE_M;
  if (x.startsWith('y')) return YARD_M;
  return 1;
}

/** Parse a measure: time, distance, lap button or reps. */
function parseMeasure(s: string, sport: Sport, allowBare = false): { measure: StepMeasure; bare?: string } | undefined {
  s = s.trim();
  if (/^(lap|lap-?button|until-?lap)$/i.test(s)) return { measure: { type: 'lap_button' } };
  let m = RE_REPS.exec(s);
  if (m) return { measure: { type: 'reps', n: +m[1] } };
  m = RE_DIST.exec(s);
  if (m) return { measure: { type: 'distance', m: +m[1] * distanceUnitM(m[2]) } };
  m = RE_TIME.exec(s.replace(/′/g, "'"));
  if (m && m[3] && !m[1] && !m[5] && m[4].toLowerCase() === 'm' && mIsMeters(+m[3], sport)) return { measure: { type: 'distance', m: +m[3] } };
  const t = parseTime(s);
  if (t !== undefined) return { measure: { type: 'time', sec: t } };
  if (allowBare && /^\d+(?:\.\d+)?$/.test(s)) {
    const n = +s;
    const meters = sport === 'swim' ? n >= 25 : sport === 'run' || sport === 'row' ? n >= 100 : n >= 300;
    return meters
      ? { measure: { type: 'distance', m: n }, bare: `${n} m` }
      : { measure: { type: 'time', sec: n * 60 }, bare: `${n} min` };
  }
  return undefined;
}

type PctBasis = 'power_pct' | 'pace_pct' | 'hr_pct_lthr';

function defaultPctBasis(sport: Sport): PctBasis {
  if (sport === 'bike' || sport === 'row') return 'power_pct';
  if (sport === 'run' || sport === 'swim') return 'pace_pct';
  return 'hr_pct_lthr';
}

function pctSuffixBasis(suffix: string | undefined, sport: Sport): PctBasis {
  const s = (suffix ?? '').toLowerCase();
  if (s === 'ftp' || s === 'power' || s === 'pwr') return 'power_pct';
  if (s === 'pace' || s === 'thr' || s === 'css') return 'pace_pct';
  if (s === 'hr' || s === 'lthr') return 'hr_pct_lthr';
  return defaultPctBasis(sport);
}

const RE_PCT = new RegExp(String.raw`^${RANGE}\s*%\s*(ftp|power|pwr|pace|thr|css|hr|lthr)?$`, 'i');
const RE_WATTS = new RegExp(String.raw`^${RANGE}\s*(?:w|watts?)$`, 'i');
const RE_BPM = new RegExp(String.raw`^${RANGE}\s*bpm$`, 'i');
const RE_RATE = new RegExp(String.raw`^${RANGE}\s*(rpm|spm)$`, 'i');
const RE_RPE = new RegExp(String.raw`^rpe\s*${RANGE}$`, 'i');
const RE_ZONE = /^z([1-7])(?:\s*(hr|pace|power|pwr))?$/i;
const RE_REL = /^(css|thr)(?:\s*([+-])\s*(\d+(?:\.\d+)?)\s*s?)?$/i;
const PACE_CLOCK = String.raw`(\d+:\d{2}(?:\.\d+)?)`;
const RE_PACE = new RegExp(String.raw`^${PACE_CLOCK}(?:\s*[-–]\s*${PACE_CLOCK})?\s*\/\s*(km|mi|100m|100yd|100y|500m)$`, 'i');

function rangeOf(m: RegExpExecArray, i = 1): [number, number] {
  const a = +m[i];
  const b = m[i + 1] !== undefined ? +m[i + 1] : a;
  return [a, b];
}

function clockSec(s: string): number {
  const [mm, ss] = s.split(':');
  return +mm * 60 + +ss;
}

const ROLE_WORDS: Record<string, StepRole> = {
  wu: 'warmup',
  warmup: 'warmup',
  'warm-up': 'warmup',
  cd: 'cooldown',
  cooldown: 'cooldown',
  'cool-down': 'cooldown',
  r: 'recovery',
  rec: 'recovery',
  recovery: 'recovery',
  rest: 'rest',
  active: 'active',
  work: 'active',
  int: 'active',
  interval: 'active',
  other: 'other',
};

function roleWord(word: string, sport: Sport): StepRole | undefined {
  const w = word.toLowerCase();
  if (w === 'r' && sport === 'swim') return 'rest';
  return Object.prototype.hasOwnProperty.call(ROLE_WORDS, w) ? ROLE_WORDS[w] : undefined;
}

const STROKES: Record<string, NonNullable<Step['swim']>['stroke']> = {
  free: 'free',
  freestyle: 'free',
  fr: 'free',
  back: 'back',
  backstroke: 'back',
  bk: 'back',
  breast: 'breast',
  breaststroke: 'breast',
  br: 'breast',
  fly: 'fly',
  butterfly: 'fly',
  im: 'im',
  choice: 'choice',
  ch: 'choice',
  kick: 'kick',
  drill: 'drill',
};

type Equip = NonNullable<NonNullable<Step['swim']>['equipment']>[number];
const EQUIP: Record<string, Equip> = {
  pull: 'pull_buoy',
  buoy: 'pull_buoy',
  pullbuoy: 'pull_buoy',
  paddle: 'paddles',
  paddles: 'paddles',
  fin: 'fins',
  fins: 'fins',
  kick: 'kick_board',
  board: 'kick_board',
  kickboard: 'kick_board',
  snorkel: 'snorkel',
};
const EQUIP_TEXT: Record<Equip, string> = {
  pull_buoy: '+pull',
  paddles: '+paddles',
  fins: '+fins',
  kick_board: '+kick',
  snorkel: '+snorkel',
};

/** Words that are never part of a free-text label / exercise name. */
const RESERVED = new Set<string>([
  ...Object.keys(ROLE_WORDS),
  ...Object.keys(STROKES),
  ...Object.keys(STEP_INTENSITY_RPE),
  'lap',
  'open',
  'ramp',
  'on',
  'css',
  'thr',
  'rpe',
  'title',
  'pool',
  'intensity',
]);

// ───────────────────────────── step pieces ─────────────────────────────

type Piece =
  | { kind: 'target'; target: Target }
  | { kind: 'rate'; low: number; high: number }
  | { kind: 'stroke'; stroke: NonNullable<Step['swim']>['stroke'] }
  | { kind: 'drill'; name: string }
  | { kind: 'equip'; equip: Equip }
  | { kind: 'sendoff'; sec: number }
  | { kind: 'rest'; measure: StepMeasure }
  | { kind: 'key' }
  | { kind: 'tag'; tag: string }
  | { kind: 'label'; text: string }
  | { kind: 'measure'; measure: StepMeasure; bare?: string };

interface Ctx {
  sport: Sport;
  thresholds?: ThresholdSnapshot;
  issues: TextIssue[];
  meta: ParseMeta;
  line: number;
}

function issue(ctx: Ctx, col: number, message: string, severity: TextIssue['severity'] = 'warning') {
  ctx.issues.push({ line: ctx.line, col, message, severity });
}

function pctTarget(basis: PctBasis, lo: number, hi: number): Target {
  return { type: basis, low: Math.min(lo, hi), high: Math.max(lo, hi) };
}

function zoneTarget(z: number, kind: string | undefined, sport: Sport): Target {
  const k = (kind ?? '').toLowerCase();
  const type = k === 'hr' ? 'hr' : k === 'power' || k === 'pwr' ? 'power' : k === 'pace' ? 'pace' : sport === 'bike' ? 'power' : sport === 'swim' ? 'pace' : 'hr';
  if (type === 'power') {
    const [lo, hi] = POWER_ZONE_PCT[z];
    return { type: 'power_pct', low: lo, high: hi };
  }
  if (type === 'pace') {
    const [lo, hi] = sport === 'swim' ? SWIM_ZONE_PCT[Math.min(6, z)] : RUN_PACE_ZONE_PCT[z];
    return { type: 'pace_pct', low: lo, high: hi };
  }
  return { type: 'hr_zone', zone: z };
}

function relTarget(kind: string, sign: string | undefined, off: string | undefined, ctx: Ctx, col: number): Target {
  const swim = kind.toLowerCase() === 'css';
  if (!off || +off === 0) return { type: 'pace_pct', low: 100, high: 100 };
  const th = ctx.thresholds;
  const v = swim ? th?.swimCssMps ?? DEFAULT_THRESHOLDS.swimCssMps : th?.runThresholdMps ?? DEFAULT_THRESHOLDS.runThresholdMps;
  const unit = swim ? 100 : 1000;
  const ref = unit / v;
  const sec = ref + (sign === '-' ? -1 : 1) * +off;
  const pct = Math.round(((100 * ref) / sec) * 10) / 10;
  if (!th || (swim ? th.swimCssMps === undefined : th.runThresholdMps === undefined))
    issue(ctx, col, `${kind}${sign}${off}s read as ${pct}% of threshold speed (assumes ${Math.floor(ref / 60)}:${String(Math.round(ref % 60)).padStart(2, '0')}/${swim ? '100m' : 'km'})`, 'info');
  return { type: 'pace_pct', low: pct, high: pct };
}

/** Read one piece at toks[i]. `measured` = a measure was already read. */
function readPiece(toks: Tok[], i: number, ctx: Ctx, measured: boolean, allowBare: boolean): { p: Piece; k: number } | undefined {
  const sport = ctx.sport;
  const t = toks[i].text;
  const lower = t.toLowerCase();
  if (lower === '@key') return { p: { kind: 'key' }, k: 1 };
  const tag = /^#([\p{L}\d][\p{L}\d_\-]*)$/u.exec(t);
  if (tag) return { p: { kind: 'tag', tag: tag[1].toLowerCase() }, k: 1 };
  if (t.startsWith('"')) return { p: { kind: 'label', text: t.slice(1, -1).trim() }, k: 1 };
  if (lower === 'open') return { p: { kind: 'target', target: { type: 'open' } }, k: 1 };
  if (lower === 'ramp') {
    const r = tryMatch(toks, i + 1, 4, (s) => RE_PCT.exec(s) ?? undefined);
    if (r) {
      const [a, b] = rangeOf(r.v);
      return { p: { kind: 'target', target: { type: 'ramp', basis: pctSuffixBasis(r.v[3], sport), from: a, to: b } }, k: r.k + 1 };
    }
    return undefined;
  }
  const matchers: [number, (s: string) => Piece | undefined][] = [
    [4, (s) => {
      const m = RE_PACE.exec(s);
      if (!m) return undefined;
      const unit = m[3].toLowerCase().replace('100yd', '100y') as PaceUnit;
      const um = PACE_UNIT_M[unit];
      const a = um / clockSec(m[1]);
      const b = m[2] ? um / clockSec(m[2]) : a;
      return { kind: 'target', target: { type: 'pace', lowMps: Math.min(a, b), highMps: Math.max(a, b) } };
    }],
    [4, (s) => {
      const m = RE_PCT.exec(s);
      if (!m) return undefined;
      const [a, b] = rangeOf(m);
      return { kind: 'target', target: pctTarget(pctSuffixBasis(m[3], sport), a, b) };
    }],
    [3, (s) => {
      const m = RE_WATTS.exec(s);
      if (!m) return undefined;
      const [a, b] = rangeOf(m);
      return { kind: 'target', target: { type: 'power_w', low: Math.min(a, b), high: Math.max(a, b) } };
    }],
    [3, (s) => {
      const m = RE_BPM.exec(s);
      if (!m) return undefined;
      const [a, b] = rangeOf(m);
      return { kind: 'target', target: { type: 'hr_bpm', low: Math.min(a, b), high: Math.max(a, b) } };
    }],
    [3, (s) => {
      const m = RE_RATE.exec(s);
      if (!m) return undefined;
      const [a, b] = rangeOf(m);
      if (m[3].toLowerCase() === 'spm' && sport === 'row') return { kind: 'rate', low: Math.min(a, b), high: Math.max(a, b) };
      return { kind: 'target', target: { type: 'cadence', low: Math.min(a, b), high: Math.max(a, b) } };
    }],
    [4, (s) => {
      const m = RE_RPE.exec(s);
      if (!m) return undefined;
      const [a, b] = rangeOf(m);
      return { kind: 'target', target: { type: 'rpe', low: Math.min(a, b), high: Math.max(a, b) } };
    }],
    [2, (s) => {
      const m = RE_ZONE.exec(s);
      return m ? { kind: 'target', target: zoneTarget(+m[1], m[2], sport) } : undefined;
    }],
    [3, (s) => {
      const m = RE_REL.exec(s);
      return m ? { kind: 'target', target: relTarget(m[1], m[2], m[3], ctx, toks[i].col) } : undefined;
    }],
  ];
  if (sport === 'swim') {
    matchers.push([2, (s) => {
      const m = /^on\s*(.+)$/i.exec(s);
      const sec = m ? parseTime(m[1]) : undefined;
      return sec ? { kind: 'sendoff', sec } : undefined;
    }]);
    matchers.push([1, (s) => {
      const m = /^drill:(.+)$/i.exec(s);
      return m ? { kind: 'drill', name: m[1] } : undefined;
    }]);
    matchers.push([1, (s) => {
      const st = STROKES[s.toLowerCase()];
      return st ? { kind: 'stroke', stroke: st } : undefined;
    }]);
    matchers.push([1, (s) => {
      const m = /^\+(\w+)$/.exec(s);
      const e = m ? EQUIP[m[1].toLowerCase()] : undefined;
      return e ? { kind: 'equip', equip: e } : undefined;
    }]);
  }
  if (measured) {
    matchers.push([4, (s) => {
      const m = /^(?:r|rest)\s*(\d.*)$/i.exec(s);
      if (!m) return undefined;
      if (sport === 'swim') {
        const sec = parseTime(m[1]);
        return sec !== undefined ? { kind: 'rest', measure: { type: 'time', sec } } : undefined;
      }
      const d = parseMeasure(m[1], sport);
      return d && (d.measure.type === 'time' || d.measure.type === 'distance') ? { kind: 'rest', measure: d.measure } : undefined;
    }]);
  }
  matchers.push([1, (s) => {
    const rpe = STEP_INTENSITY_RPE[s.toLowerCase()];
    return rpe !== undefined ? { kind: 'target', target: { type: 'rpe', low: rpe, high: rpe } } : undefined;
  }]);
  matchers.push([3, (s) => {
    const m = parseMeasure(s, sport, allowBare && !measured);
    return m ? { kind: 'measure', measure: m.measure, bare: m.bare } : undefined;
  }]);
  for (const [k, fn] of matchers) {
    const r = tryMatch(toks, i, k, fn);
    if (r) return { p: r.v, k: r.k };
  }
  return undefined;
}

interface Draft {
  step: Step;
  explicitRole?: StepRole;
  extra: { step: Step; role: StepRole }[];
}

/**
 * Parse the tokens of one step (no leading dash). Always returns a step; a missing measure
 * becomes a lap-button step with an error issue.
 */
function parseStepTokens(toks: Tok[], ctx: Ctx, opts: { allowBare?: boolean; cue?: string; fallbackCol: number }): Draft {
  const sport = ctx.sport;
  let i = 0;
  let explicitRole: StepRole | undefined;
  if (toks.length) {
    const compact = /^(r|rest)(\d.*)$/i.exec(toks[0].text);
    const rw = roleWord(toks[0].text, sport);
    if (rw && toks.length > 1) {
      explicitRole = rw;
      i = 1;
    } else if (compact && parseMeasure(compact[2], sport)) {
      explicitRole = roleWord(compact[1], sport);
      toks = [{ text: compact[2], col: toks[0].col + compact[1].length }, ...toks.slice(1)];
    } else if (rw && toks.length === 1) {
      explicitRole = rw;
      i = 1;
    }
  }
  let measure: StepMeasure | undefined;
  const targets: Target[] = [];
  const labelWords: string[] = [];
  let quoted: string | undefined;
  let rate: [number, number] | undefined;
  let stroke: NonNullable<Step['swim']>['stroke'] | undefined;
  const equipment: Equip[] = [];
  let sendOff: number | undefined;
  let restSec: number | undefined;
  const extra: Draft['extra'] = [];
  let drillName: string | undefined;
  for (; i < toks.length; ) {
    const tk = toks[i];
    if (tk.text === '/' || tk.text === '+') {
      issue(ctx, tk.col, `Unexpected ‘${tk.text}’`);
      i++;
      continue;
    }
    const r = readPiece(toks, i, ctx, measure !== undefined, !!opts.allowBare);
    if (!r) {
      if (tk.text.toLowerCase() === 'ramp') issue(ctx, tk.col, 'A ramp needs a % range, e.g. ramp 50-75% (or 80-90%hr)');
      else if (!measure && /^[\p{L}][\p{L}\d'’\-.()&]*$/u.test(tk.text)) labelWords.push(tk.text);
      else {
        const prev = i > 0 ? toks[i - 1].text : undefined;
        issue(ctx, tk.col, `Unknown ‘${tk.text}’${prev ? ` after ‘${prev}’` : ''} — try 95%, z3, 250w, 4:30/km or rpe 6`);
      }
      i++;
      continue;
    }
    const p = r.p;
    switch (p.kind) {
      case 'measure':
        if (measure) issue(ctx, tk.col, `Extra duration/distance ‘${tk.text}’ ignored`);
        else {
          measure = p.measure;
          if (p.bare) issue(ctx, tk.col, `Read ‘${tk.text}’ as ${p.bare}`, 'info');
        }
        break;
      case 'target':
        if (targets.length >= 2) issue(ctx, tk.col, 'Only two targets per step; extra target ignored');
        else targets.push(p.target);
        break;
      case 'rate':
        rate = [p.low, p.high];
        break;
      case 'stroke':
        stroke = p.stroke;
        break;
      case 'drill':
        stroke = 'drill';
        drillName = p.name;
        break;
      case 'equip':
        if (!equipment.includes(p.equip)) equipment.push(p.equip);
        break;
      case 'sendoff':
        sendOff = p.sec;
        break;
      case 'rest':
        if (sport === 'swim') {
          if (p.measure.type === 'time') restSec = p.measure.sec;
          else issue(ctx, tk.col, 'Swim rest must be a time (e.g. r 20s)');
        } else extra.push({ step: { kind: 'step', id: newId('s'), role: 'recovery', measure: p.measure }, role: 'recovery' });
        break;
      case 'key':
        ctx.meta.isKey = true;
        break;
      case 'tag':
        if (!ctx.meta.tags.includes(p.tag)) ctx.meta.tags.push(p.tag);
        break;
      case 'label':
        quoted = quoted ? `${quoted} ${p.text}` : p.text;
        break;
    }
    i += r.k;
  }
  let label = [quoted, labelWords.join(' ')].filter(Boolean).join(' ') || undefined;
  if (drillName) {
    if (label) issue(ctx, opts.fallbackCol, `Drill ‘${drillName}’ ignored: the step already has a label`);
    else label = drillName;
  }
  if (!measure) {
    issue(ctx, opts.fallbackCol, 'Expected a duration or distance (e.g. 8m, 30s, 400m, 2km) — using “lap button”', 'error');
    measure = { type: 'lap_button' };
  }
  if (measure.type === 'time' && !(measure.sec > 0)) {
    issue(ctx, opts.fallbackCol, 'Duration must be positive — using “lap button”', 'error');
    measure = { type: 'lap_button' };
  }
  if (measure.type === 'distance' && !(measure.m > 0)) {
    issue(ctx, opts.fallbackCol, 'Distance must be positive — using “lap button”', 'error');
    measure = { type: 'lap_button' };
  }
  const step: Step = { kind: 'step', id: newId('s'), role: explicitRole ?? 'active', measure };
  if (label) step.label = label;
  if (opts.cue) step.cue = opts.cue;
  if (targets[0]) step.target = targets[0];
  if (targets[1]) step.secondary = targets[1];
  if (stroke || equipment.length || sendOff || restSec !== undefined) {
    step.swim = {};
    if (stroke) step.swim.stroke = stroke;
    if (equipment.length) step.swim.equipment = equipment;
    if (sendOff) step.swim.sendOffSec = sendOff;
    if (restSec !== undefined) step.swim.restSec = restSec;
  }
  if (rate) step.row = { strokeRateLow: rate[0], strokeRateHigh: rate[1] };
  return { step, explicitRole, extra };
}

// ───────────────────────────── strength lines ─────────────────────────────

const RE_SETS = /^(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+))?\s*(s|secs?|m|mins?|reps?)?$/i;

function isNameWord(t: string): boolean {
  return /^[\p{L}][\p{L}\d'’\-.()&]*$/u.test(t) && !RESERVED.has(t.toLowerCase());
}

const STRENGTH_EXCLUDE = new Set<string>([...Object.keys(STEP_INTENSITY_RPE), 'lap', 'open', 'ramp', 'on', 'css', 'thr', 'rpe', 'r', 'rest']);
const STRENGTH_ROLE_PREFIX: Record<string, StepRole> = { wu: 'warmup', cd: 'cooldown', rec: 'recovery', rest: 'rest', other: 'other' };

/** A word that may be part of an exercise name in this sport. */
function isExerciseWord(t: string, sport: Sport): boolean {
  const l = t.toLowerCase();
  return /^[\p{L}][\p{L}\d'’\-.()&]*$/u.test(t) && !STRENGTH_EXCLUDE.has(l) && !(sport === 'swim' && STROKES[l]) && !/^z[1-7]$/.test(l);
}

/** Parse "Back squat 4x6 @80kg rpe8 r2m" segments joined by "+". Undefined when not a strength line. */
function parseStrengthLine(toks: Tok[], ctx: Ctx, cue: string | undefined, nextGroup: () => string): { steps: { step: Step; role?: StepRole }[] } | undefined {
  const segments: Tok[][] = [[]];
  for (const t of toks) {
    if (t.text === '+') segments.push([]);
    else segments[segments.length - 1].push(t);
  }
  const local: TextIssue[] = [];
  const lctx: Ctx = { ...ctx, issues: local, meta: { tags: [] } };
  const out: { step: Step; role?: StepRole }[] = [];
  for (const seg of segments) {
    let sets: RegExpExecArray | undefined;
    const name: string[] = [];
    let quotedName: string | undefined;
    let weightKg: number | undefined;
    let rpe: number | undefined;
    let restSec: number | undefined;
    let role: StepRole | undefined;
    let col = seg[0]?.col ?? 1;
    for (let i = 0; i < seg.length; ) {
      const t = seg[i].text;
      if (i === 0 && seg.length > 2 && Object.prototype.hasOwnProperty.call(STRENGTH_ROLE_PREFIX, t)) {
        role = STRENGTH_ROLE_PREFIX[t];
        i++;
        continue;
      }
      const setsM = sets ? undefined : tryMatch(seg, i, 3, (s) => RE_SETS.exec(s) ?? undefined);
      if (setsM) {
        sets = setsM.v;
        col = seg[i].col;
        i += setsM.k;
        continue;
      }
      const w = tryMatch(seg, i, 3, (s) => {
        const m = /^@?\s*(\d+(?:\.\d+)?)\s*(kg|kgs|lb|lbs)$/i.exec(s) ?? /^@\s*(\d+(?:\.\d+)?)$/.exec(s);
        if (m) return (m[2] ?? 'kg').toLowerCase().startsWith('lb') ? +m[1] * LB_KG : +m[1];
        return /^@\s*(bw|bodyweight)$/i.test(s) ? 0 : undefined;
      });
      if (w) {
        weightKg = w.v;
        i += w.k;
        continue;
      }
      const rp = tryMatch(seg, i, 2, (s) => {
        const m = /^@?rpe\s*(\d+(?:\.\d+)?)$/i.exec(s);
        return m ? +m[1] : undefined;
      });
      if (rp) {
        rpe = rp.v;
        i += rp.k;
        continue;
      }
      const rs = tryMatch(seg, i, 3, (s) => {
        const m = /^(?:r|rest)\s*(\d\S*(?:\s+\S+)?)$/i.exec(s);
        return m ? parseTime(m[1]) : undefined;
      });
      if (rs) {
        restSec = rs.v;
        i += rs.k;
        continue;
      }
      if (t.toLowerCase() === '@key') {
        lctx.meta.isKey = true;
        i++;
        continue;
      }
      const tag = /^#([\p{L}\d][\p{L}\d_\-]*)$/u.exec(t);
      if (tag) {
        lctx.meta.tags.push(tag[1].toLowerCase());
        i++;
        continue;
      }
      if (t.startsWith('"')) {
        quotedName = t.slice(1, -1).trim();
        i++;
        continue;
      }
      if (isExerciseWord(t, ctx.sport)) {
        name.push(t);
        i++;
        continue;
      }
      return undefined; // something we don't understand → not a strength line
    }
    const exercise = quotedName ?? name.join(' ');
    if (!sets || !exercise) return undefined;
    const unit = (sets[4] ?? '').toLowerCase();
    const isTime = unit !== '' && !unit.startsWith('rep');
    // "4x8m Spin-ups" on a bike is an inline repeat; timed sets elsewhere need a quoted name
    if (isTime && ctx.sport !== 'strength' && quotedName === undefined) return undefined;
    const nSets = +sets[1];
    const n = +sets[2];
    const strength: NonNullable<Step['strength']> = { exercise, sets: Math.max(1, nSets) };
    let measure: StepMeasure;
    if (isTime) {
      const sec = unit.startsWith('m') ? n * 60 : n;
      strength.durationSec = sec;
      measure = { type: 'time', sec };
    } else {
      const reps = Math.max(1, Math.round(n));
      if (sets[3]) local.push({ line: ctx.line, col, message: `Rep range ${sets[2]}–${sets[3]} stored as ${reps}`, severity: 'info' });
      strength.reps = reps;
      measure = { type: 'reps', n: reps };
    }
    if (nSets < 1) local.push({ line: ctx.line, col, message: 'Sets must be at least 1', severity: 'error' });
    if (weightKg !== undefined) strength.weightKg = weightKg;
    if (rpe !== undefined) strength.rpe = Math.min(10, Math.max(1, rpe));
    if (restSec !== undefined) strength.restSec = restSec;
    const step: Step = { kind: 'step', id: newId('s'), role: role ?? 'active', measure, strength };
    out.push({ step, role });
  }
  if (out.length > 1) {
    const g = nextGroup();
    for (const o of out) o.step.strength!.supersetGroup = g;
  }
  if (cue && out.length) out[0].step.cue = cue;
  ctx.issues.push(...local);
  if (lctx.meta.isKey) ctx.meta.isKey = true;
  for (const tg of lctx.meta.tags) if (!ctx.meta.tags.includes(tg)) ctx.meta.tags.push(tg);
  return { steps: out };
}

// ───────────────────────────── role inference ─────────────────────────────

function contentScore(step: Step, sport: Sport): { score: number; level: number } {
  if (!step.target) return { score: 0, level: 0 };
  const ti = resolveTargetIntensity(step.target, sport, {}, 'active');
  if (ti.source !== 'target') return { score: 0, level: 0 };
  return { score: ti.ifMid, level: ti.level };
}

/**
 * Roles implied by content alone (targets, structure), ignoring the steps' current roles.
 * Inside repeats: a step well below the hardest sibling (< 80 % of its intensity) is recovery,
 * others active. Top level: repeats, strength sets and hard steps are "work"; steps before the
 * first work are warmup, after the last are cooldown, between are recovery. With no work at
 * all, every step is active. The parser applies this and then explicit roles; the formatter
 * writes a role keyword only where the actual role differs, which keeps round-trips exact.
 */
export function inferStepRoles(structure: WorkoutStructure, sport: Sport): Map<string, StepRole> {
  const roles = new Map<string, StepRole>();
  const sc = new Map<Step, { score: number; level: number }>();
  const score = (s: Step) => {
    let v = sc.get(s);
    if (!v) sc.set(s, (v = contentScore(s, sport)));
    return v;
  };
  const allSteps = (n: AnyNode): Step[] => (n.kind === 'step' ? [n] : n.steps.flatMap((c) => allSteps(c as AnyNode)));
  const inRepeat = (r: Repeat | InnerRepeat) => {
    const max = Math.max(0, ...allSteps(r).map((s) => score(s).score));
    for (const c of r.steps) {
      if (c.kind === 'repeat') inRepeat(c);
      else roles.set(c.id, c.strength || max <= 0 || score(c).score >= 0.8 * max ? 'active' : 'recovery');
    }
  };
  const top = structure.steps;
  let maxLevel = 0;
  for (const n of top) for (const s of allSteps(n)) maxLevel = Math.max(maxLevel, score(s).level);
  const workLevel = maxLevel >= 3 ? Math.max(3, maxLevel - 1) : maxLevel;
  const isWork = top.map((n) => n.kind === 'repeat' || !!n.strength || (score(n).level > 0 && score(n).level >= workLevel));
  const first = isWork.indexOf(true);
  const last = isWork.lastIndexOf(true);
  top.forEach((n, i) => {
    if (n.kind === 'repeat') return inRepeat(n);
    if (first < 0) roles.set(n.id, 'active');
    else if (i < first) roles.set(n.id, 'warmup');
    else if (i > last) roles.set(n.id, 'cooldown');
    else roles.set(n.id, isWork[i] ? 'active' : 'recovery');
  });
  return roles;
}

// ───────────────────────────── parser ─────────────────────────────

interface Block {
  indent: number;
  node: Repeat | InnerRepeat;
  container: AnyNode[];
  line: number;
  col: number;
  /** Too deep: unroll into the parent container when closed. */
  unroll: boolean;
}

const SECTION_ROLES: [RegExp, StepRole][] = [
  [/^(warm\s*-?\s*up|wu)$/i, 'warmup'],
  [/^(cool\s*-?\s*down|cd)$/i, 'cooldown'],
];

function splitComment(raw: string): { content: string; comment?: string } {
  let inQ = false;
  for (let k = 0; k < raw.length - 1; k++) {
    const c = raw[k];
    if (c === '"' && (inQ || k === 0 || /\s/.test(raw[k - 1]))) inQ = !inQ;
    if (!inQ && c === '/' && raw[k + 1] === '/') {
      const comment = raw.slice(k + 2).trim();
      return { content: raw.slice(0, k), comment: comment || undefined };
    }
  }
  return { content: raw };
}

function indentWidth(s: string): number {
  let w = 0;
  for (const c of s) w += c === '\t' ? 2 : 1;
  return w;
}

/** Parse builder / library text. Never throws. */
export function parseWorkoutText(text: string, sport: Sport, opts: ParseOptions = {}): ParseResult {
  try {
    return parseImpl(typeof text === 'string' ? text : String(text ?? ''), (SPORTS as readonly string[]).includes(sport) ? sport : 'other', opts);
  } catch (e) {
    return {
      structure: { steps: [] },
      issues: [{ line: 1, col: 1, severity: 'error', message: `Could not parse: ${e instanceof Error ? e.message : String(e)}` }],
      meta: { tags: [] },
    };
  }
}

function parseImpl(text: string, sport: Sport, opts: ParseOptions): ParseResult {
  const issues: TextIssue[] = [];
  const meta: ParseMeta = { tags: [] };
  const top: AnyNode[] = [];
  const explicit = new Map<string, StepRole>();
  const stack: Block[] = [];
  let title: string | undefined;
  let poolLengthM: number | undefined;
  let section: StepRole | undefined;
  let group = 0;
  const nextGroup = () => String.fromCharCode(65 + (group++ % 26));
  const lines = text.split(/\r\n|\r|\n/);

  const cloneTracked = (n: AnyNode): AnyNode => {
    const c = cloneWithNewIds(n);
    const pair = (a: AnyNode, b: AnyNode) => {
      const r = explicit.get(a.id);
      if (r) explicit.set(b.id, r);
      if (a.kind === 'repeat' && b.kind === 'repeat') a.steps.forEach((x, i) => pair(x as AnyNode, b.steps[i] as AnyNode));
    };
    pair(n, c);
    return c;
  };

  const unrollInto = (container: AnyNode[], r: Repeat | InnerRepeat, ctx: Ctx, col: number) => {
    const per = r.steps.length;
    const count = Math.max(1, Math.min(r.count, Math.floor(MAX_UNROLL_STEPS / Math.max(1, per))));
    issue(ctx, col, 'Repeats nest at most two levels deep; this one was expanded into steps', 'warning');
    for (let k = 0; k < count; k++) for (const c of r.steps) container.push(k === 0 ? (c as AnyNode) : cloneTracked(c as AnyNode));
  };

  const close = () => {
    const b = stack.pop()!;
    const ctx: Ctx = { sport, thresholds: opts.thresholds, issues, meta, line: b.line };
    const idx = b.container.indexOf(b.node);
    if (!b.node.steps.length) {
      issue(ctx, b.col, `Repeat ‘${b.node.count}x’ has no indented steps below it`, 'error');
      if (idx >= 0) b.container.splice(idx, 1);
      return;
    }
    if (b.unroll && idx >= 0) {
      b.container.splice(idx, 1);
      const tmp: AnyNode[] = [];
      unrollInto(tmp, b.node, ctx, b.col);
      b.container.splice(idx, 0, ...tmp);
    }
  };

  const addRepeat = (container: AnyNode[], count: number, label: string | undefined, ctx: Ctx, col: number): Repeat => {
    let c = count;
    if (!(c >= 1)) {
      issue(ctx, col, 'Repeat count must be at least 1', 'error');
      c = 1;
    }
    if (c > MAX_REPEAT_COUNT) {
      issue(ctx, col, `Repeat count capped at ${MAX_REPEAT_COUNT}`, 'error');
      c = MAX_REPEAT_COUNT;
    }
    const r: Repeat = { kind: 'repeat', id: newId('r'), count: c, steps: [] };
    if (label) r.label = label;
    container.push(r);
    return r;
  };

  const pushStep = (container: AnyNode[], depth: number, d: { step: Step; role?: StepRole }) => {
    container.push(d.step);
    const role = d.role ?? (depth === 0 ? section : undefined);
    if (role) explicit.set(d.step.id, role);
  };

  /** Handle the body of a line (after indentation, comment removed). */
  const handle = (body: string, base: number, ctx: Ctx, comment: string | undefined, indent: number, allowSection = true): void => {
    const container = stack.length ? stack[stack.length - 1].node.steps as AnyNode[] : top;
    const depth = stack.length;
    let m: RegExpExecArray | null;

    if (allowSection) {
      if ((m = /^title\s*:\s*(.+)$/i.exec(body)) || (m = /^#\s+(.+)$/.exec(body))) {
        title = m[1].trim();
        return;
      }
      if ((m = /^pool\s*:?\s*(\d+(?:\.\d+)?)\s*(m|mtrs?|meters?|metres?|y|yds?|yards?)?$/i.exec(body))) {
        poolLengthM = +m[1] * (m[2] && m[2].toLowerCase().startsWith('y') ? YARD_M : 1);
        if (!(poolLengthM > 0)) poolLengthM = undefined;
        return;
      }
      if ((m = /^intensity\s*:\s*(\S+)$/i.exec(body))) {
        const w = m[1].toLowerCase();
        const c = (INTENSITY_CLASSES as readonly string[]).includes(w) ? (w as IntensityClass) : INTENSITY_WORDS[w];
        if (c) meta.intensity = c;
        else issue(ctx, base, `Unknown intensity ‘${m[1]}’`);
        return;
      }
      const toksAll = tokenize(body, base);
      if (toksAll.length && toksAll.every((t) => t.text.toLowerCase() === '@key' || /^#[\p{L}\d]/u.test(t.text))) {
        for (const t of toksAll) {
          if (t.text.toLowerCase() === '@key') meta.isKey = true;
          else if (!meta.tags.includes(t.text.slice(1).toLowerCase())) meta.tags.push(t.text.slice(1).toLowerCase());
        }
        return;
      }
      m = /^(?:"([^"]*)"|([^\s\-\d"#][^:"]*?))\s*:(?:\s+(.*))?$/u.exec(body);
      if (m) {
        const label = (m[1] ?? m[2]).trim();
        const rest = (m[3] ?? '').trim();
        const restBase = base + body.length - rest.length;
        if (!rest) {
          if (depth === 0) section = SECTION_ROLES.find(([re]) => re.test(label))?.[1];
          return;
        }
        const rm = /^(\d+)\s*[x×]\s*(.*)$/i.exec(rest);
        if (rm && !RE_SETS.test(rest.split(/\s+/)[0] ?? '')) {
          if (depth === 0) section = undefined;
          handleRepeat(+rm[1], rm[2], restBase + rest.length - rm[2].length, label, ctx, comment, indent, container, depth, restBase);
          return;
        }
        if (depth === 0) section = SECTION_ROLES.find(([re]) => re.test(label))?.[1];
        handle(rest, restBase, ctx, comment, indent, false);
        return;
      }
    }

    let content = body;
    let cbase = base;
    const dash = /^[-*•]\s*/.exec(content);
    if (dash) {
      content = content.slice(dash[0].length);
      cbase += dash[0].length;
    }
    if (!content) return;
    const rm = /^(\d+)\s*[x×]\s*(.*)$/i.exec(content);
    if (rm && !rm[2]) {
      handleRepeat(+rm[1], '', cbase, undefined, ctx, comment, indent, container, depth, cbase);
      return;
    }
    const toks = tokenize(content, cbase);
    const st = parseStrengthLine(toks, ctx, comment, nextGroup);
    if (st) {
      for (const s of st.steps) pushStep(container, depth, s);
      return;
    }
    if (rm) {
      handleRepeat(+rm[1], rm[2], cbase + content.length - rm[2].length, undefined, ctx, comment, indent, container, depth, cbase);
      return;
    }
    if (!dash && !toks.some((t) => parseMeasure(t.text, sport))) {
      const probe: Ctx = { ...ctx, issues: [], meta: { tags: [] } };
      const looksLikeStep = toks.some((_t, i) => readPiece(toks, i, probe, false, false));
      if (!looksLikeStep) {
        issue(ctx, base, `Didn’t understand ‘${body.length > 40 ? body.slice(0, 40) + '…' : body}’`);
        return;
      }
    }
    const d = parseStepTokens(toks, ctx, { cue: comment, fallbackCol: cbase });
    pushStep(container, depth, { step: d.step, role: d.explicitRole });
    for (const x of d.extra) pushStep(container, depth, x);
  };

  const handleRepeat = (
    count: number,
    inline: string,
    inlineBase: number,
    label: string | undefined,
    ctx: Ctx,
    comment: string | undefined,
    indent: number,
    container: AnyNode[],
    depth: number,
    col: number,
  ) => {
    const r = addRepeat(container, count, label, ctx, col);
    const tooDeep = depth >= 2;
    if (!inline.trim()) {
      stack.push({ indent, node: r, container, line: ctx.line, col, unroll: tooDeep });
      return;
    }
    // inline repeat: segments separated by "/"
    const toks = tokenize(inline, inlineBase);
    const segs: Tok[][] = [[]];
    for (const t of toks) {
      if (t.text === '/') segs.push([]);
      else segs[segs.length - 1].push(t);
    }
    segs.forEach((seg, k) => {
      if (!seg.length) {
        issue(ctx, inlineBase, 'Empty segment in repeat', 'warning');
        return;
      }
      const st = parseStrengthLine(seg, ctx, k === 0 ? comment : undefined, nextGroup);
      if (st) {
        for (const s of st.steps) {
          r.steps.push(s.step);
          if (s.role) explicit.set(s.step.id, s.role);
        }
        return;
      }
      const d = parseStepTokens(seg, ctx, { allowBare: true, cue: k === 0 ? comment : undefined, fallbackCol: seg[0].col });
      r.steps.push(d.step);
      if (d.explicitRole) explicit.set(d.step.id, d.explicitRole);
      for (const x of d.extra) {
        r.steps.push(x.step);
        explicit.set(x.step.id, x.role);
      }
    });
    if (!r.steps.length) {
      container.splice(container.indexOf(r), 1);
      issue(ctx, col, 'Repeat has no steps', 'error');
      return;
    }
    if (tooDeep) {
      container.splice(container.indexOf(r), 1);
      unrollInto(container, r, ctx, col);
    }
  };

  lines.forEach((raw, idx) => {
    const line = idx + 1;
    const { content, comment } = splitComment(raw);
    const ind = /^[\t ]*/.exec(content)![0];
    const body = content.slice(ind.length).trimEnd();
    if (!body) return;
    const indent = indentWidth(ind);
    while (stack.length && indent <= stack[stack.length - 1].indent) close();
    const ctx: Ctx = { sport, thresholds: opts.thresholds, issues, meta, line };
    handle(body, ind.length + 1, ctx, comment, indent);
  });
  while (stack.length) close();

  let structure: WorkoutStructure = { steps: top as StructureNode[] };
  if (poolLengthM !== undefined) structure.poolLengthM = poolLengthM;
  const inferred = inferStepRoles(structure, sport);
  const assign = (n: AnyNode): AnyNode =>
    n.kind === 'step'
      ? { ...n, role: explicit.get(n.id) ?? inferred.get(n.id) ?? 'active' }
      : ({ ...n, steps: n.steps.map((c) => assign(c as AnyNode)) } as AnyNode);
  structure = { ...structure, steps: structure.steps.map((n) => assign(n) as StructureNode) };
  return { structure, ...(title ? { title } : {}), issues, meta };
}

// ───────────────────────────── formatter ─────────────────────────────

export interface FormatOptions {
  /** Pace unit for run/walk/hike (km vs mi) and long distances. Default metric. */
  units?: Units;
  /** Emits a `title:` line first. */
  title?: string;
}

/** Candidates are tried in order; the first that re-parses to exactly `want` wins. */
function firstExact(cands: string[], check: (s: string) => boolean, fallback: string): string {
  for (const c of cands) if (check(c)) return c;
  return fallback;
}

function timeText(sec: number, sport: Sport): string {
  const ok = (s: string) => {
    const p = parseMeasure(s, sport);
    return !!p && p.measure.type === 'time' && p.measure.sec === sec;
  };
  if (!Number.isInteger(sec)) return firstExact([`${fmtNum(sec)}s`], ok, `${fmtNum(sec)}s`);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const cands: string[] = [];
  if (h > 0) cands.push(`${h}h${m || s ? `${m}m` : ''}${s ? `${s}s` : ''}`);
  else if (m > 0 && s && sec < 120) cands.push(`${sec}s`);
  else if (m > 0) cands.push(`${m}m${s ? `${s}s` : ''}`, `${m}min${s ? `${s}s` : ''}`);
  else cands.push(`${s}s`);
  return firstExact(cands, ok, `${sec}s`);
}

function distanceText(m: number, sport: Sport, units: Units, yardsPool: boolean): string {
  const ok = (s: string) => {
    const p = parseMeasure(s, sport);
    return !!p && p.measure.type === 'distance' && p.measure.m === m;
  };
  const km = `${fmtNum(m / 1000)}km`;
  const mtr = `${fmtNum(m)}m`;
  const yd = `${fmtNum(Math.round((m / YARD_M) * 1e6) / 1e6)}y`;
  const mi = `${fmtNum(Math.round((m / MILE_M) * 1e6) / 1e6)}mi`;
  let cands: string[];
  if (sport === 'swim') cands = yardsPool ? [yd, mtr] : [mtr, `${fmtNum(m)}mtr`, yd];
  else if (sport === 'row') cands = [mtr, `${fmtNum(m)}mtr`, km];
  else if (sport === 'run') cands = units === 'imperial' ? [mi, m < 5000 ? mtr : km, km] : m < 5000 ? [mtr, km] : [km, mtr];
  else cands = units === 'imperial' ? [mi, km, mtr] : [km, mtr];
  return firstExact(cands, ok, `${fmtNum(m)}mtr`);
}

function measureText(meas: StepMeasure, sport: Sport, units: Units, yardsPool: boolean): string {
  switch (meas.type) {
    case 'time':
      return timeText(meas.sec, sport);
    case 'distance':
      return distanceText(meas.m, sport, units, yardsPool);
    case 'lap_button':
      return 'lap';
    case 'reps':
      return `${meas.n}reps`;
  }
}

function rangeText(lo: number, hi: number): string {
  return lo === hi ? fmtNum(lo) : `${fmtNum(lo)}-${fmtNum(hi)}`;
}

function paceClock(sec: number, um: number, want: number): string {
  let txt = '';
  for (let d = 0; d <= 3; d++) {
    const t = Math.round(sec * 10 ** d) / 10 ** d;
    const mm = Math.floor(t / 60);
    const ss = t - mm * 60;
    txt = `${mm}:${ss < 10 ? '0' : ''}${ss.toFixed(d)}`;
    if (um / clockSec(txt) === want) return txt;
  }
  return txt;
}

function targetText(t: Target, sport: Sport, units: Units, yardsPool: boolean): string {
  const pctSuffix = (b: PctBasis) => (b === defaultPctBasis(sport) ? '' : b === 'power_pct' ? 'ftp' : b === 'pace_pct' ? 'pace' : 'hr');
  switch (t.type) {
    case 'open':
      return 'open';
    case 'power_pct':
    case 'pace_pct':
    case 'hr_pct_lthr': {
      if (t.type !== 'hr_pct_lthr' && t.type === defaultPctBasis(sport) && t.low === 100 && t.high === 100 && t.type === 'pace_pct')
        return sport === 'swim' ? 'css' : 'thr';
      if (t.type === 'power_pct' || t.type === 'pace_pct') {
        for (let z = 1; z <= 7; z++) {
          const zt = zoneTarget(z, undefined, sport);
          if (zt.type === t.type && zt.low === t.low && zt.high === t.high) return `z${z}`;
          const zp = zoneTarget(z, t.type === 'power_pct' ? 'power' : 'pace', sport);
          if (zp.type === t.type && zp.low === t.low && zp.high === t.high && sport !== 'swim') return `z${z} ${t.type === 'power_pct' ? 'power' : 'pace'}`;
        }
      }
      return `${rangeText(t.low, t.high)}%${pctSuffix(t.type)}`;
    }
    case 'power_w':
      return `${rangeText(t.low, t.high)}w`;
    case 'hr_bpm':
      return `${rangeText(t.low, t.high)}bpm`;
    case 'hr_zone':
      return zoneTarget(t.zone, undefined, sport).type === 'hr_zone' ? `z${t.zone}` : `z${t.zone} hr`;
    case 'rpe':
      return `rpe${rangeText(t.low, t.high)}`;
    case 'cadence':
      return `${rangeText(t.low, t.high)}${sport === 'run' ? 'spm' : 'rpm'}`;
    case 'ramp':
      return `ramp ${fmtNum(t.from)}-${fmtNum(t.to)}%${pctSuffix(t.basis)}`;
    case 'pace': {
      const unit = paceUnitFor(sport, units, yardsPool);
      const um = PACE_UNIT_M[unit];
      const fast = paceClock(um / t.highMps, um, t.highMps);
      const slow = paceClock(um / t.lowMps, um, t.lowMps);
      return `${fast === slow ? fast : `${fast}-${slow}`}/${unit}`;
    }
  }
}

function isPlainLabel(label: string, sport: Sport): boolean {
  return label.split(/\s+/).every((w) => isNameWord(w) && !parseMeasure(w, sport) && !/^z[1-7]$/i.test(w) && !w.startsWith('#') && !w.startsWith('@'));
}

function labelText(label: string, sport: Sport): string {
  const clean = label.replace(/["“”]/g, "'").trim();
  return isPlainLabel(clean, sport) ? clean : `"${clean}"`;
}

const ROLE_KEYWORD: Record<StepRole, string> = { warmup: 'wu', cooldown: 'cd', recovery: 'r', rest: 'rest', active: 'active', other: 'other' };

function roleKeyword(role: StepRole, sport: Sport): string {
  if (role === 'recovery' && sport === 'swim') return 'rec';
  return ROLE_KEYWORD[role];
}

function stepText(s: Step, sport: Sport, units: Units, yardsPool: boolean, inferred: StepRole | undefined): string {
  const parts: string[] = [];
  if (s.role !== inferred) parts.push(roleKeyword(s.role, sport));
  const drillInline = s.swim?.stroke === 'drill' && s.label && /^[^\s"“”/]+$/.test(s.label) && !s.label.includes('//');
  if (s.label && !drillInline) parts.push(labelText(s.label, sport));
  parts.push(measureText(s.measure, sport, units, yardsPool));
  if (s.swim?.stroke) parts.push(drillInline ? `drill:${s.label}` : s.swim.stroke);
  if (s.target) parts.push(targetText(s.target, sport, units, yardsPool));
  if (s.secondary) parts.push(targetText(s.secondary, sport, units, yardsPool));
  if (s.swim) {
    for (const e of s.swim.equipment ?? []) parts.push(EQUIP_TEXT[e]);
    if (s.swim.sendOffSec) parts.push(`on ${Number.isInteger(s.swim.sendOffSec) ? clockText(s.swim.sendOffSec) : timeText(s.swim.sendOffSec, sport)}`);
    if (s.swim.restSec !== undefined) parts.push(`r ${timeText(s.swim.restSec, 'strength')}`);
  }
  if (s.row && (s.row.strokeRateLow !== undefined || s.row.strokeRateHigh !== undefined)) {
    const lo = s.row.strokeRateLow ?? s.row.strokeRateHigh!;
    const hi = s.row.strokeRateHigh ?? lo;
    parts.push(`${rangeText(lo, hi)}spm`);
  }
  return parts.join(' ');
}

function clockText(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function strengthText(s: Step, sport: Sport, inferred: StepRole | undefined): string {
  const p = s.strength!;
  const parts: string[] = [];
  if (s.role !== inferred && s.role !== 'active') parts.push(s.role === 'recovery' ? 'rec' : roleKeyword(s.role, sport));
  const timed = p.durationSec !== undefined && p.reps === undefined;
  const nameOk = !(timed && sport !== 'strength') && p.exercise.split(/\s+/).every((w) => isExerciseWord(w, sport) && !RE_SETS.test(w));
  parts.push(nameOk && p.exercise.trim() ? p.exercise.trim() : `"${p.exercise.replace(/["“”]/g, "'")}"`);
  if (timed) {
    const d = p.durationSec as number;
    parts.push(Number.isInteger(d) && d % 60 === 0 && d >= 60 ? `${p.sets}x${d / 60}min` : `${p.sets}x${fmtNum(d)}s`);
  } else parts.push(`${p.sets}x${p.reps ?? (s.measure.type === 'reps' ? s.measure.n : 1)}`);
  if (p.weightKg !== undefined) parts.push(p.weightKg === 0 ? '@bw' : `@${fmtNum(p.weightKg)}kg`);
  if (p.rpe !== undefined) parts.push(`rpe${fmtNum(p.rpe)}`);
  if (p.restSec !== undefined) parts.push(`r${timeText(p.restSec, 'strength')}`);
  return parts.join(' ');
}

function repeatLabelText(label: string): string {
  const clean = label.replace(/["“”]/g, "'").trim();
  return /^[^\s\-\d"#][^:"]*$/u.test(clean) && !/^(title|pool|intensity)$/i.test(clean) ? clean : `"${clean}"`;
}

/** Canonical text for a structure. `parseWorkoutText(formatWorkoutText(s))` equals `s` modulo ids. */
export function formatWorkoutText(structure: WorkoutStructure, sport: Sport, opts: FormatOptions = {}): string {
  const units = opts.units ?? 'metric';
  const lines: string[] = [];
  if (opts.title) lines.push(`title: ${opts.title.replace(/\n/g, ' ')}`);
  const pool = structure.poolLengthM;
  let yardsPool = false;
  if (pool !== undefined) {
    const y = Math.round((pool / YARD_M) * 1e6) / 1e6;
    yardsPool = y * YARD_M === pool && Number.isInteger(y);
    lines.push(yardsPool ? `pool ${fmtNum(y)}y` : `pool ${fmtNum(pool)}m`);
  }
  const inferred = inferStepRoles(structure, sport);
  const cue = (s: Step) => (s.cue ? `  // ${s.cue.replace(/\s*\n\s*/g, ' ')}` : '');
  const emit = (nodes: readonly AnyNode[], depth: number) => {
    const pad = '  '.repeat(depth);
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.kind === 'repeat') {
        lines.push(`${pad}${n.label ? `${repeatLabelText(n.label)}: ` : ''}${n.count}x`);
        emit(n.steps as AnyNode[], depth + 1);
        continue;
      }
      if (n.strength) {
        const group: Step[] = [n];
        const g = n.strength.supersetGroup;
        while (g && i + 1 < nodes.length) {
          const nx = nodes[i + 1];
          if (nx.kind !== 'step' || !nx.strength || nx.strength.supersetGroup !== g) break;
          group.push(nx);
          i++;
        }
        lines.push(`${pad}${group.map((s) => strengthText(s, sport, inferred.get(s.id))).join(' + ')}${cue(n)}`);
        continue;
      }
      lines.push(`${pad}- ${stepText(n, sport, units, yardsPool, inferred.get(n.id))}${cue(n)}`);
    }
  };
  emit(structure.steps, 0);
  return lines.join('\n');
}

// ───────────────────────────── quick add ─────────────────────────────

const SPORT_WORDS: Record<string, Sport> = {
  ride: 'bike',
  bike: 'bike',
  cycle: 'bike',
  cycling: 'bike',
  biking: 'bike',
  run: 'run',
  running: 'run',
  jog: 'run',
  swim: 'swim',
  swimming: 'swim',
  row: 'row',
  rowing: 'row',
  erg: 'row',
  gym: 'strength',
  strength: 'strength',
  lift: 'strength',
  lifting: 'strength',
  weights: 'strength',
  hike: 'hike',
  hiking: 'hike',
  walk: 'walk',
  walking: 'walk',
  yoga: 'yoga',
  ski: 'ski',
  skiing: 'ski',
  other: 'other',
};

const SUB_WORDS: Record<string, SubSport> = {
  indoor: 'indoor',
  trainer: 'indoor',
  turbo: 'indoor',
  virtual: 'virtual',
  zwift: 'virtual',
  road: 'road',
  mtb: 'mtb',
  gravel: 'gravel',
  trail: 'trail',
  treadmill: 'treadmill',
  track: 'track',
  pool: 'pool',
  ow: 'open_water',
  openwater: 'open_water',
  open_water: 'open_water',
  erg: 'erg',
  water: 'on_water',
  gym: 'gym',
  bodyweight: 'bodyweight',
  mobility: 'mobility',
  hiit: 'hiit',
};

export interface QuickAddResult {
  sport: Sport;
  subSport?: SubSport;
  title: string;
  durationSec?: number;
  distanceM?: number;
  intensity: IntensityClass;
  isKey: boolean;
  tags: string[];
  /** Present when the text describes more than a bare duration/distance. */
  structure?: WorkoutStructure;
  issues: TextIssue[];
}

/**
 * Calendar composer one-liners: `run 45m easy`, `bike 4x8m 95-100% @key #vo2`, `swim 3km`,
 * `strength 40m`, `row 5x1000m r2m`, `bike indoor Threshold 4x8`. Grammar:
 * `sport [subsport] [Title words] body {@key|#tag|intensity-word}`. Never throws.
 */
export function parseQuickAdd(text: string, opts: { defaultSport?: Sport; thresholds?: ThresholdSnapshot } = {}): QuickAddResult {
  const issues: TextIssue[] = [];
  try {
    const src = typeof text === 'string' ? text.replace(/\s+/g, ' ') : '';
    const { content, comment } = splitComment(src);
    let toks = tokenize(content, 1);
    let sport: Sport = opts.defaultSport ?? 'other';
    const w0 = toks[0]?.text.toLowerCase();
    if (w0 && SPORT_WORDS[w0]) {
      sport = SPORT_WORDS[w0];
      toks = toks.slice(1);
    } else issues.push({ line: 1, col: 1, severity: 'warning', message: `Start with a sport (run, bike, swim, row, strength…); using ${sport}` });
    let subSport: SubSport | undefined;
    const w1 = toks[0]?.text.toLowerCase();
    if (w1 && SUB_WORDS[w1] && (SPORT_META[sport]?.subSports ?? []).includes(SUB_WORDS[w1])) {
      subSport = SUB_WORDS[w1];
      toks = toks.slice(1);
    }
    let isKey = false;
    const tags: string[] = [];
    let intensityWord: IntensityClass | undefined;
    const rest: Tok[] = [];
    for (const t of toks) {
      const l = t.text.toLowerCase();
      if (l === '@key') isKey = true;
      else if (/^#[\p{L}\d]/u.test(t.text)) {
        const tg = t.text.slice(1).toLowerCase();
        if (!tags.includes(tg)) tags.push(tg);
      } else rest.push(t);
    }
    // title words: leading words before the first token that starts the body
    const ctx: Ctx = { sport, thresholds: opts.thresholds, issues: [], meta: { tags: [] }, line: 1 };
    let bodyStart = rest.findIndex((t, i) => /^\d/.test(t.text) || /^(lap|ramp)$/i.test(t.text) || (!INTENSITY_WORDS[t.text.toLowerCase()] && !!readPiece(rest, i, ctx, false, false)));
    if (bodyStart < 0) bodyStart = rest.length;
    const titleToks = rest.slice(0, bodyStart);
    const bodyToks: Tok[] = [];
    for (const t of rest.slice(bodyStart)) {
      const iw = INTENSITY_WORDS[t.text.toLowerCase()];
      if (iw) intensityWord = iw;
      else bodyToks.push(t);
    }
    for (const t of titleToks) {
      const iw = INTENSITY_WORDS[t.text.toLowerCase()];
      if (iw) intensityWord = iw;
    }
    const rawTitle = titleToks.map((t) => t.text).join(' ');
    const titleText = rawTitle ? rawTitle[0].toUpperCase() + rawTitle.slice(1) : '';

    let structure: WorkoutStructure | undefined;
    let durationSec: number | undefined;
    let distanceM: number | undefined;
    if (bodyToks.length) {
      const bodyText = bodyToks.map((t) => t.text).join(' ') + (comment ? ` // ${comment}` : '');
      const parsed = parseWorkoutText(bodyText, sport, { thresholds: opts.thresholds });
      // re-map columns from the body back to the original text
      for (const is of parsed.issues) {
        let acc = 1;
        let col = bodyToks[0].col;
        for (const t of bodyToks) {
          if (is.col >= acc && is.col < acc + t.text.length + 1) {
            col = t.col + (is.col - acc);
            break;
          }
          acc += t.text.length + 1;
        }
        issues.push({ ...is, col });
      }
      if (parsed.meta.isKey) isKey = true;
      for (const tg of parsed.meta.tags) if (!tags.includes(tg)) tags.push(tg);
      const s = parsed.structure;
      const only = s.steps.length === 1 && s.steps[0].kind === 'step' ? (s.steps[0] as Step) : undefined;
      const bare = only && !only.target && !only.secondary && !only.label && !only.cue && !only.swim && !only.row && !only.strength;
      if (bare && only.measure.type === 'time') durationSec = only.measure.sec;
      else if (bare && only.measure.type === 'distance') distanceM = only.measure.m;
      else if (s.steps.length) {
        structure = s;
        const flat = flattenStructure(s);
        if (flat.length && flat.every((f) => f.step.measure.type === 'time' && !f.step.strength))
          durationSec = flat.reduce((a, f) => a + (f.step.measure as { sec: number }).sec, 0);
        if (flat.length && flat.every((f) => f.step.measure.type === 'distance'))
          distanceM = flat.reduce((a, f) => a + (f.step.measure as { m: number }).m, 0);
      }
    }
    const intensity: IntensityClass =
      intensityWord ?? (structure ? classifyPlannedIntensity(structure, sport, opts.thresholds ?? {}).intensity : 'endurance');
    const title =
      titleText ||
      (structure ? autoTitle(structure, sport) : autoTitleUnstructured({ sport, durationSec, distanceM, intensity }));
    return {
      sport,
      ...(subSport ? { subSport } : {}),
      title,
      ...(durationSec !== undefined ? { durationSec } : {}),
      ...(distanceM !== undefined ? { distanceM } : {}),
      intensity,
      isKey,
      tags,
      ...(structure ? { structure } : {}),
      issues,
    };
  } catch (e) {
    issues.push({ line: 1, col: 1, severity: 'error', message: `Could not parse: ${e instanceof Error ? e.message : String(e)}` });
    const sport = opts.defaultSport ?? 'other';
    return { sport, title: SPORT_META[sport].label, intensity: 'endurance', isKey: false, tags: [], issues };
  }
}
