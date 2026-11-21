/** Swim session templates: 25 m pool sets with send-offs, open water in summer, CSS test. */
import { D, PC, SB, T } from '../structure';
import { draft, type SessionCtx, type SessionDraft } from './common';

const POOL = 25;

/** Send-off (s) for a repeat distance at a pace % of CSS plus a rest allowance, rounded to 5 s. */
function sendOff(c: SessionCtx, distM: number, pct: number, restSec: number): number {
  return Math.ceil((distM / (c.thr.cssMps * (pct / 100)) + restSec) / 5) * 5;
}

function warmup(b: SB) {
  b.add('warmup', D(400), PC(80, 88), { label: '400 choice', swim: { stroke: 'choice', restSec: 20 } });
  b.rep(4, [b.s('active', D(50), PC(75, 85), { label: 'Drill: catch-up / fingertip', swim: { stroke: 'drill', restSec: 15 } })]);
}

export function swimCss(c: SessionCtx): SessionDraft {
  const b = new SB();
  warmup(b);
  const v = c.variant % 4;
  let title: string;
  if (v === 0) {
    title = 'CSS 12×100';
    b.rep(12, [b.s('active', D(100), PC(100, 103), { label: '100 @ CSS', swim: { stroke: 'free', sendOffSec: sendOff(c, 100, 101.5, 12) } })]);
  } else if (v === 1) {
    title = 'CSS 8×200';
    b.rep(8, [b.s('active', D(200), PC(98, 101), { label: '200 @ CSS', swim: { stroke: 'free', sendOffSec: sendOff(c, 200, 99.5, 18) } })]);
  } else if (v === 2) {
    title = 'CSS 3×400';
    b.rep(3, [b.s('active', D(400), PC(97, 100), { label: '400 @ CSS', swim: { stroke: 'free', restSec: 40 } })]);
    b.rep(4, [b.s('active', D(50), PC(108, 114), { label: '50 fast', swim: { stroke: 'free', sendOffSec: sendOff(c, 50, 111, 20) } })]);
  } else {
    title = 'CSS 16×75';
    b.rep(16, [b.s('active', D(75), PC(102, 105), { label: '75 @ CSS−', swim: { stroke: 'free', sendOffSec: sendOff(c, 75, 103.5, 10) } })]);
  }
  b.add('active', D(300), PC(88, 93), { label: 'Pull', swim: { stroke: 'free', equipment: ['pull_buoy', 'paddles'], restSec: 20 } });
  b.add('cooldown', D(200), PC(75, 85), { label: 'Easy back/free', swim: { stroke: 'choice' } });
  return draft(
    {
      sport: 'swim',
      subSport: 'pool',
      title,
      description: 'Threshold swim. Hold the pace clock, not your ego.',
      structure: b.build(POOL),
      isKey: c.week.block === 'build1' || c.week.block === 'build2',
      intensity: 'threshold',
      tags: ['css', 'intervals'],
      environment: 'indoor',
    },
    c.thr,
  );
}

export function swimEndurance(c: SessionCtx): SessionDraft {
  const b = new SB();
  warmup(b);
  const v = c.variant % 3;
  let title: string;
  let intensity: SessionDraft['intensity'] = 'endurance';
  if (v === 0) {
    title = 'Endurance 3×800 pull';
    b.rep(3, [b.s('active', D(800), PC(88, 92), { label: '800 pull', swim: { stroke: 'free', equipment: ['pull_buoy'], restSec: 30 } })]);
  } else if (v === 1) {
    title = 'Aerobic 10×200';
    b.rep(10, [b.s('active', D(200), PC(90, 94), { label: '200 aerobic', swim: { stroke: 'free', sendOffSec: sendOff(c, 200, 92, 15) } })]);
  } else {
    title = 'Technique + 10×50 fast';
    intensity = 'high';
    b.rep(6, [b.s('active', D(100), PC(80, 88), { label: 'Kick / drill', swim: { stroke: 'kick', equipment: ['fins'], restSec: 20 } })]);
    b.rep(10, [b.s('active', D(50), PC(108, 113), { label: '50 fast', swim: { stroke: 'free', sendOffSec: sendOff(c, 50, 110, 25) } })]);
    b.add('active', D(400), PC(88, 92), { label: '400 smooth', swim: { stroke: 'free', restSec: 20 } });
  }
  b.add('cooldown', D(200), PC(75, 85), { label: 'Cool down', swim: { stroke: 'choice' } });
  return draft(
    { sport: 'swim', subSport: 'pool', title, structure: b.build(POOL), isKey: false, intensity, tags: ['endurance'], environment: 'indoor' },
    c.thr,
  );
}

export function swimEasy(c: SessionCtx, distM = 1500): SessionDraft {
  const b = new SB();
  b.add('active', D(distM - 300), PC(82, 88), { label: 'Easy continuous', swim: { stroke: 'free', restSec: 20 } });
  b.add('cooldown', D(300), PC(75, 85), { label: 'Choice', swim: { stroke: 'choice' } });
  return draft(
    {
      sport: 'swim',
      subSport: 'pool',
      title: `Easy swim ${(distM / 1000).toFixed(1)}k`,
      structure: b.build(POOL),
      isKey: false,
      intensity: 'recovery',
      tags: ['easy'],
      environment: 'indoor',
    },
    c.thr,
  );
}

export function swimOpenWater(c: SessionCtx, racePace = false): SessionDraft {
  const distM = racePace ? 2000 : 2400;
  const b = new SB();
  if (racePace) {
    b.add('warmup', D(400), PC(82, 88), { label: 'Easy, sighting every 6' });
    b.rep(3, [b.s('active', D(400), PC(94, 98), { label: 'Race pace' }), b.s('recovery', D(100), PC(75, 85), { label: 'Easy' })]);
    b.add('cooldown', D(100), PC(75, 85));
  } else {
    b.add('active', D(distM), PC(86, 92), { label: 'Continuous, sight every 8' });
  }
  return draft(
    {
      sport: 'swim',
      subSport: 'open_water',
      title: racePace ? 'OW 3×400 race pace — Banyoles' : `Open water ${(distM / 1000).toFixed(1)}k — Banyoles`,
      description: 'Wetsuit. Practise sighting and drafting off the buoy line.',
      preNote: c.rng.chance(0.5) ? c.rng.pick(['Water 21° per the club chat', 'Meeting Laia at the rowing club 7:15', 'Tinted goggles — low sun']) : undefined,
      structure: b.build(),
      isKey: racePace,
      intensity: racePace ? 'threshold' : 'endurance',
      tags: ['open-water'],
      environment: 'outdoor',
    },
    c.thr,
  );
}

export function swimCssTest(c: SessionCtx): SessionDraft {
  const b = new SB();
  b.add('warmup', D(600), PC(80, 90), { label: 'Warm up incl. 4×50 build', swim: { stroke: 'choice', restSec: 30 } });
  b.add('active', D(400), PC(97, 100), { label: '400 TT', swim: { stroke: 'free' } });
  b.add('rest', T(300), undefined, { label: 'Easy / rest' });
  b.add('active', D(200), PC(104, 108), { label: '200 TT', swim: { stroke: 'free' } });
  b.add('cooldown', D(300), PC(70, 80), { label: 'Cool down', swim: { stroke: 'choice' } });
  return draft(
    {
      sport: 'swim',
      subSport: 'pool',
      title: 'CSS test 400/200',
      description: 'CSS = 200 / (T400 − T200).',
      structure: b.build(POOL),
      isKey: true,
      intensity: 'threshold',
      tags: ['test', 'test:css'],
      environment: 'indoor',
    },
    c.thr,
  );
}

export function swimRaceLeg(c: SessionCtx, distM: number, name: string): SessionDraft {
  return draft(
    {
      sport: 'swim',
      subSport: 'open_water',
      title: `${name} — Swim ${distM >= 1000 ? `${(distM / 1000).toFixed(1)}k` : `${distM} m`}`,
      plannedDurationSec: Math.round(distM / (c.thr.cssMps * 0.93) / 60) * 60,
      plannedDistanceM: distM,
      isKey: true,
      intensity: 'race',
      tags: ['race'],
      environment: 'outdoor',
    },
    c.thr,
  );
}
