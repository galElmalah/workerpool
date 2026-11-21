/**
 * Athlete voice: RPE/feel, post-activity notes, day notes and weekly reflections.
 * Terse, specific, occasionally grumpy — like a real training log.
 */
import type { LocalDate } from '@cadence/core/domain';
import type { Thr } from './internal';
import type { Model } from './model';
import type { Rng } from './prng';
import type { Summary } from './summary';
import type { SynthPlannedSession } from './types';
import { clamp, fmtDuration, fmtPace100, fmtPaceKm, fmtSplit500 } from './util';

export interface NoteCtx {
  model: Model;
  sum: Summary;
  planned?: SynthPlannedSession;
  thr: Thr;
  thrNext: Thr;
  rng: Rng;
}

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ''));

function rpeFor(c: NoteCtx): number {
  const m = c.model;
  const base: Record<string, number> = { recovery: 2, endurance: 3.5, tempo: 5.5, threshold: 7, high: 8, race: 9 };
  let r = base[m.intensity] ?? 4;
  if (m.isTest) r = 9;
  if (m.isRace && c.planned?.tags.includes('C-race')) r = 8.5;
  if (m.family === 'strength') r = c.planned?.subSport === 'mobility' ? 3 : 6.5;
  if (m.family === 'walk' || m.family === 'yoga') r = 2;
  if (m.family === 'hike') r = 4;
  if (m.exec.reason === 'sick_onset') r += 2;
  if (m.exec.kind === 'short' && m.exec.reason === 'tired') r += 1;
  if (m.exec.kind === 'long') r += 1;
  if (m.tempC > 28 && !m.indoor) r += 1;
  if (c.sum.durationSec > 4 * 3600) r += 1;
  return Math.round(clamp(r + c.rng.normal(0, 0.6), 1, 10));
}

function feelFor(c: NoteCtx, rpe: number): number {
  const m = c.model;
  if (m.exec.reason === 'sick_onset') return 1;
  if (m.exec.kind === 'short' || m.exec.kind === 'off_short') return m.exec.reason === 'time' ? 3 : 2;
  if (m.exec.kind === 'long') return 5;
  let f = 3.6 + c.rng.normal(0, 0.8) - (rpe >= 9 ? 0.4 : 0) + m.exec.bias * 20;
  if (m.isRace) f += 0.5;
  return Math.round(clamp(f, 1, 5));
}

const BANK: Record<string, string[]> = {
  sick_onset: ['Throat scratchy from the start. Cut it. Bed.', 'HR way too high for the watts. Called it at {dur}. Something’s coming.', 'Felt off all day. Pulled the plug early.'],
  tired: ['Legs empty. Bailed after {dur}.', 'No pop today. Stopped early rather than dig a hole.', 'HRV was red this morning, should’ve listened. Cut short.'],
  time: ['Work ran late — only had {dur}.', 'Squeezed in what I could before pickup.', 'Out of time. Better than nothing.'],
  niggle: ['Left calf grumbling, stopped to be safe.', 'Knee twinge at 30′. Called it. Ice + foam roller.'],
  off_short: ['Total bail. {dur} and done.', 'Nope. Nothing there today.'],
  great: ['Perfect weather, kept going. {km} km.', 'Felt amazing, took the long way home.', 'Extended — sun out, legs good, no reason to stop.'],
  great_indoor: ['Felt good, added some extra Z2.', 'Good episode on, kept going.', 'Legs wanted more today. Took it.'],
  bike_int: ['{title}: avg {ap} W, NP {np}. Last rep ugly but done.', 'All reps done. Fan on max, still a puddle.', 'Controlled until the last one. HR {hr} avg.', 'Solid. Cadence 95ish, no fading.', 'Trainer felt hard today — calibrate it?'],
  bike_easy: ['Spin. Podcast. Done.', 'Easy legs, HR {hr}.', 'Flush ride, nothing to report.'],
  bike_long: ['{km} km, {gain} m. Coffee in Banyoles, headwind home.', 'Group was spicy on the climbs. NP {np}.', 'Nice Z2 day. Ate every 30′ like a good boy.', 'Windy on the coast road. {km} km.', 'Legs fine, butt not. Saddle?', 'Rocacorba still hurts. {gain} m in the legs.'],
  run_easy: ['Easy along the Ter. {pace}/km, HR {hr}.', 'Shuffled. Legs from yesterday.', 'Lovely morning, river path empty.', 'Easy means easy. Boring but right.'],
  run_track: ['{title}: reps on target. Wind on the back straight.', 'First two too fast, then locked in.', 'Club session, got dragged a bit quick.', 'Track was packed. Lane 3 life.'],
  run_tempo: ['Tempo felt hard-ish. {pace} avg.', 'Controlled. Could’ve done one more.', 'Hot and sticky, HR drifted. Pace held.'],
  run_long: ['{km} km at {pace}. Gel at 45′. Fine.', 'Long run done. Hips tight last 3k.', 'Carrilet out and back, steady.', 'Last 20′ felt great. Finally.'],
  run_brick: ['Legs like bricks (ha). Settled after 8′.', 'First km at {pace}, too fast as usual.'],
  run_trail: ['Gavarres mud everywhere. {gain} m.', 'Walked the steep bits. Ankles got a workout.'],
  swim_css: ['{title} — held {css}/100. Last 3 hurt.', 'Pool crowded, lane etiquette zero.', 'Felt slippery today. SWOLF {swolf}.', 'Send-offs tight but made all of them.'],
  swim_easy: ['Smooth. Focused on the catch.', 'Meh. Shoulder tight.', 'Lane to myself. Bliss.'],
  swim_ow: ['Banyoles like glass. Sighting better.', 'Wetsuit perfect, {m} m.', 'Chop on the far side. Swallowed half the lake.'],
  row: ['{title}: splits ~{split}/500, steady.', 'Erg is a different kind of pain.', 'Rate discipline better today.'],
  strength: ['Squat felt solid.', 'Gym busy, did what I could.', 'DOMS incoming.', 'Moved well. Added 2.5 on deadlift.', 'Grip gave out before legs.'],
  yoga: ['Hips thanked me.', 'Needed that.'],
  walk: ['Walk after dinner.', 'Leg loosener.', 'Coffee walk.'],
  hike: ['Núria valley stunning. Legs happy doing something different.', 'Summit! Windy up top.', 'Long day out, sandwiches at the top.'],
};

/** Returns rpe, feel and an optional post-note. */
export function athleteVoice(c: NoteCtx): { rpe: number; feel: number; postNote?: string } {
  const m = c.model;
  const s = c.sum;
  const rpe = rpeFor(c);
  const feel = feelFor(c, rpe);
  const v: Record<string, string | number> = {
    dur: fmtDuration(s.durationSec),
    title: m.header.title,
    ap: s.avgPower ?? '',
    np: s.normPower ?? '',
    hr: s.avgHr ?? '',
    km: s.distanceM ? (s.distanceM / 1000).toFixed(1) : '',
    m: s.distanceM ? Math.round(s.distanceM) : '',
    gain: s.elevationGainM ?? 0,
    pace: s.avgSpeedMps ? fmtPaceKm(s.avgSpeedMps) : '',
    css: s.avgSpeedMps ? fmtPace100(s.avgSpeedMps * 1.06) : '',
    swolf: s.avgSwolf ?? '',
    split: s.avgPower ? fmtSplit500(s.avgPower * 1.12) : '',
  };
  const tags = c.planned?.tags ?? [];
  let note: string | undefined;
  const pick = (k: string) => fill(c.rng.pick(BANK[k]!), v);

  if (m.isTest) {
    const test = tags.find((t) => t.startsWith('test:'))?.slice(5);
    if (test === 'ftp_20') note = `20′ @ ${Math.round(c.thrNext.ftp / 0.95)} W → FTP ${c.thrNext.ftp} (+${c.thrNext.ftp - c.thr.ftp}). Paced it well, last 3′ were dark.`;
    else if (test === 'ftp_ramp') note = `Ramp: topped out at ${Math.round(c.thrNext.ftp / 0.75)} W → FTP ${c.thrNext.ftp}. Up ${c.thrNext.ftp - c.thr.ftp} W on last season’s number.`;
    else if (test === 'css') {
      const v200 = c.thrNext.cssMps * 1.065;
      const t200 = 200 / v200;
      const t400 = t200 + 200 / c.thrNext.cssMps;
      note = `400 in ${fmtDuration(t400)}, 200 in ${fmtDuration(t200)} → CSS ${fmtPace100(c.thrNext.cssMps)}/100. Progress!`;
    } else if (test === 'run_tt30') note = `30′ TT at ${fmtPaceKm(c.thrNext.runMps)}/km → new threshold. HR ${s.avgHr} avg. Wanted to stop at 18′.`;
    else if (test === 'row_2k') {
      const p2k = c.thrNext.rowW / 0.75;
      note = `2k in ${fmtDuration(2000 * Math.cbrt(2.8 / p2k))} (${fmtSplit500(p2k)}/500). Saw stars. New erg threshold ${c.thrNext.rowW} W.`;
    }
  } else if (m.isRace) {
    note = undefined; // filled by the orchestrator (needs all legs)
  } else if (m.exec.reason === 'sick_onset') note = pick('sick_onset');
  else if (m.exec.kind === 'off_short') note = pick('off_short');
  else if (m.exec.kind === 'short') note = pick(m.exec.reason ?? 'tired');
  else if (m.exec.kind === 'long') note = pick(m.indoor ? 'great_indoor' : 'great');
  else if (c.rng.chance(0.5)) {
    switch (m.family) {
      case 'bike':
        note = pick(tags.includes('long') ? 'bike_long' : tags.includes('intervals') ? 'bike_int' : 'bike_easy');
        break;
      case 'run':
        note = pick(
          tags.includes('brick') ? 'run_brick' : tags.includes('track') ? 'run_track' : tags.includes('tempo') ? 'run_tempo' : tags.includes('trail') ? 'run_trail' : tags.includes('long') ? 'run_long' : 'run_easy',
        );
        break;
      case 'swim_pool':
        note = pick(tags.includes('css') ? 'swim_css' : 'swim_easy');
        break;
      case 'swim_ow':
        note = pick('swim_ow');
        break;
      case 'row':
        note = pick('row');
        break;
      case 'strength':
        note = pick('strength');
        break;
      case 'yoga':
        note = pick('yoga');
        break;
      case 'walk':
        note = c.rng.chance(0.5) ? pick('walk') : undefined;
        break;
      case 'hike':
        note = pick('hike');
        break;
    }
  }
  const out: { rpe: number; feel: number; postNote?: string } = { rpe, feel };
  if (note) out.postNote = note;
  return out;
}

export const RANDOM_DAY_NOTES = [
  'Slept badly — neighbours’ party till 3.',
  'New 28 mm tyres. Lovely.',
  'Deadline week at work. Training wherever it fits.',
  'Bike fit tweak: saddle +3 mm, cleats back 2 mm.',
  'Massage. Calves were concrete.',
  'Sauna after the swim. Should do that more.',
  'Ordered new run shoes (same model, 4th pair).',
  'Big family lunch. Zero regrets.',
  'Chain was skipping — new chain + cassette.',
  'Dentist. Not training related, just annoying.',
  'Rest day done right: couch, book, pasta.',
  'Coffee with the club after the swim, good chat about the race calendar.',
];

export interface WeekNoteCtx {
  rng: Rng;
  block: string;
  recovery: boolean;
  past: boolean;
  hoursDone: number;
  hoursPlanned: number;
  keyDone: number;
  keyPlanned: number;
  sick: boolean;
  travel: boolean;
  rel: number;
}

export function weekReflection(c: WeekNoteCtx): string | undefined {
  if (!c.past) {
    if (c.block === 'hmtaper') return 'Taper + race. Sleep, carbs, don’t do anything stupid. Goal sub 1:30.';
    if (c.block === 'hmbuild') return c.rng.pick(['Sharpen: track Tue, HM pace Thu, long run Sun. Everything else easy.', 'Last proper build week. Nail the long run with HM blocks.', 'Keep the bike ticking over, legs fresh for Thursday.']);
    return 'Consistency over heroics.';
  }
  if (c.sick) return 'Flu wiped out the week. Fever Wed–Sat. Back to easy stuff only when HRV says so.';
  if (c.travel) return 'Lisbon work trip ate the week. Hotel treadmill, pastéis de nata, zero regrets.';
  if (c.block === 'race') return 'RACE WEEK done. Sub-5 in the bag — the season’s work paid off. Now: nothing for a few days.';
  if (c.block === 'post_recovery') return 'Recovery. Legs still sore Tue. Walks and easy spins only.';
  if (c.block === 'vacation') return 'Pyrenees. Hikes, sleep, food. Bikes stayed home and that was the point.';
  if (c.block === 'taper') return 'Taper week. Felt flat Tue, sharp by Sat. Classic.';
  if (c.recovery) return c.rng.pick(['Recovery week. Legs came back by Thursday.', 'Easy week + tests. Numbers moving the right way.', 'Down week. Slept 8h most nights, HRV back up.']);
  const ratio = c.hoursPlanned > 0 ? c.hoursDone / c.hoursPlanned : 1;
  if (ratio < 0.75) return c.rng.pick(['Life got in the way. Got the key sessions, dropped the fillers.', 'Patchy week. Work + bad sleep. Reset next week.', `Only ${c.hoursDone.toFixed(1)} h. Not ideal, not a disaster.`]);
  if (c.keyDone >= c.keyPlanned && c.keyPlanned > 0)
    return c.rng.pick([
      'Solid block. Legs heavy Thu but hit every key session.',
      `All ${c.keyDone} key sessions done. Fitness creeping up.`,
      'Good week. Long ride felt easy for once.',
      'Big week, tired in a good way. Need more sleep though.',
    ]);
  return c.rng.pick(['Decent week, missed one key session.', 'OK week. Swim volume low again.', 'Felt flat midweek, came good at the weekend.']);
}

export function dayKey(d: LocalDate): string {
  return d;
}
