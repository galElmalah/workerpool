/** Running session templates. Pace targets are % of threshold speed (pace_pct). */
import { D, HRZ, PC, RAMP, SB, T } from '../structure';
import { draft, fmtHm, scaleMin, type SessionCtx, type SessionDraft } from './common';

export function runEasy(c: SessionCtx, baseMin = 45, strides = false, treadmill = false): SessionDraft {
  const min = Math.max(strides ? 35 : 30, scaleMin(baseMin, c.vol / 0.85, 0.55, 1.2));
  const sub = treadmill ? 'treadmill' : 'road_run';
  if (!strides) {
    return draft(
      {
        sport: 'run',
        subSport: sub,
        title: treadmill ? `Hotel treadmill ${fmtHm(min)}` : `Easy run ${fmtHm(min)}`,
        plannedDurationSec: min * 60,
        isKey: false,
        intensity: 'endurance',
        tags: ['easy'],
        environment: treadmill ? 'indoor' : 'outdoor',
      },
      c.thr,
    );
  }
  const b = new SB();
  b.add('active', T((min - 12) * 60), HRZ(2), { label: 'Easy' });
  b.rep(6, [b.s('active', T(20), PC(118, 128), { label: 'Stride', cue: 'Tall, relaxed, quick feet' }), b.s('recovery', T(70), PC(55, 65), { label: 'Walk back' })]);
  b.add('cooldown', T(180), HRZ(1));
  return draft(
    {
      sport: 'run',
      subSport: sub,
      title: `Easy ${fmtHm(min - 10)} + 6×20″ strides`,
      structure: b.build(),
      isKey: false,
      intensity: 'endurance',
      tags: ['easy', 'strides'],
      environment: 'outdoor',
    },
    c.thr,
  );
}

const trackWu = (b: SB) => {
  b.add('warmup', T(900), PC(70, 78), { label: 'Warm up' });
  b.rep(4, [b.s('active', T(20), PC(115, 125), { label: 'Stride' }), b.s('recovery', T(40), PC(50, 60))]);
};

export function runTrack(c: SessionCtx, short = false): SessionDraft {
  const b = new SB();
  trackWu(b);
  const v = c.variant % 4;
  let title: string;
  if (short) {
    title = 'Track 3×1 km @ HM pace';
    b.rep(3, [b.s('active', D(1000), PC(98, 101), { label: '1 km' }), b.s('rest', T(90), undefined, { label: 'Standing rest' })]);
  } else if (v === 0) {
    title = 'Track 6×800 m';
    b.rep(6, [b.s('active', D(800), PC(107, 111), { label: '800 m', cue: 'Even laps: same split ±1″' }), b.s('recovery', T(120), PC(55, 65), { label: 'Jog 200' })]);
  } else if (v === 1) {
    title = 'Track 5×1 km @ 10K';
    b.rep(5, [b.s('active', D(1000), PC(103, 106), { label: '1 km' }), b.s('rest', T(120), undefined, { label: 'Standing rest' })]);
  } else if (v === 2) {
    title = 'Track 12×400 m';
    b.rep(12, [b.s('active', D(400), PC(112, 117), { label: '400 m' }), b.s('recovery', T(75), PC(50, 60), { label: 'Jog 200' })]);
  } else {
    title = 'Track 3×1600 m';
    b.rep(3, [b.s('active', D(1600), PC(101, 104), { label: '1600 m' }), b.s('recovery', T(180), PC(55, 65), { label: 'Jog 400' })]);
  }
  b.add('cooldown', T(600), PC(65, 75), { label: 'Cool down' });
  return draft(
    {
      sport: 'run',
      subSport: 'track',
      title,
      description: 'Speed endurance. Run the reps by feel first, check splits after.',
      preNote: c.rng.chance(0.35) ? c.rng.pick(['With the club at 18:30, lane 2', 'Spikes stay in the bag', 'Wind on the back straight — don’t chase splits']) : undefined,
      structure: b.build(),
      isKey: true,
      intensity: 'high',
      tags: ['intervals', 'track'],
      environment: 'outdoor',
    },
    c.thr,
  );
}

export function runTempo(c: SessionCtx, hmPace = false): SessionDraft {
  const b = new SB();
  b.add('warmup', T(900), PC(70, 78), { label: 'Warm up' });
  const v = c.variant % 4;
  let title: string;
  let intensity: SessionDraft['intensity'] = 'threshold';
  if (hmPace) {
    title = '2×5 km @ HM pace';
    b.rep(2, [b.s('active', D(5000), PC(96, 99), { label: 'HM pace' }), b.s('recovery', T(180), PC(60, 70))]);
  } else if (v === 0) {
    title = 'Tempo 3×10′';
    b.rep(3, [b.s('active', T(600), PC(94, 98), { label: 'Tempo' }), b.s('recovery', T(120), PC(60, 70))]);
  } else if (v === 1) {
    title = 'Cruise intervals 4×8′';
    b.rep(4, [b.s('active', T(480), PC(98, 102), { label: 'Threshold' }), b.s('recovery', T(90), PC(60, 70))]);
  } else if (v === 2) {
    title = 'Tempo 25′ continuous';
    intensity = 'tempo';
    b.add('active', T(1500), PC(90, 94), { label: 'Tempo' });
  } else {
    title = 'Progression 30′';
    intensity = 'tempo';
    b.add('active', T(1800), RAMP('pace_pct', 82, 100), { label: 'Progression', cue: 'Finish at threshold' });
  }
  b.add('cooldown', T(600), PC(65, 75), { label: 'Cool down' });
  return draft(
    {
      sport: 'run',
      subSport: 'road_run',
      title,
      description: 'River path loop. Controlled discomfort, not a race.',
      structure: b.build(),
      isKey: true,
      intensity,
      tags: ['tempo'],
      environment: 'outdoor',
    },
    c.thr,
  );
}

export function runHills(c: SessionCtx): SessionDraft {
  const b = new SB();
  b.add('warmup', T(1200), HRZ(2), { label: 'Warm up to the hill' });
  b.rep(8, [b.s('active', T(90), PC(100, 110), { label: 'Hill', cue: 'Drive the arms, short steps' }), b.s('recovery', T(150), PC(50, 65), { label: 'Jog down' })]);
  b.add('cooldown', T(900), HRZ(1));
  return draft(
    {
      sport: 'run',
      subSport: 'road_run',
      title: 'Hill repeats 8×90″',
      structure: b.build(),
      isKey: true,
      intensity: 'high',
      tags: ['hills', 'intervals'],
      environment: 'outdoor',
    },
    c.thr,
  );
}

export function runLong(c: SessionCtx, opts: { hmPace?: boolean; trail?: boolean } = {}): SessionDraft {
  const blk = c.week.block;
  const runFocus = blk === 'runbase' || blk === 'hmbuild';
  const min = scaleMin(100, c.vol / (runFocus ? 0.75 : 0.9), 0.6, 1.15);
  if (opts.trail) {
    return draft(
      {
        sport: 'run',
        subSport: 'trail',
        title: `Trail run ${fmtHm(min)} — Gavarres`,
        description: 'Time on feet. Walk the steep bits, no shame.',
        plannedDurationSec: min * 60,
        isKey: false,
        intensity: 'endurance',
        tags: ['long', 'trail'],
        environment: 'outdoor',
      },
      c.thr,
    );
  }
  const v = c.variant % 3;
  if (opts.hmPace || v === 1) {
    const b = new SB();
    const reps = opts.hmPace ? 3 : 3;
    const work = opts.hmPace ? 12 : 10;
    b.add('active', T(Math.max(20, min - reps * (work + 3) - 10) * 60), HRZ(2), { label: 'Easy' });
    b.rep(reps, [
      b.s('active', T(work * 60), opts.hmPace ? PC(95, 98) : PC(88, 92), { label: opts.hmPace ? 'HM pace' : 'Steady' }),
      b.s('recovery', T(180), PC(70, 78)),
    ]);
    b.add('cooldown', T(600), HRZ(1));
    return draft(
      {
        sport: 'run',
        subSport: 'road_run',
        title: opts.hmPace ? `Long run w/ ${reps}×${work}′ @ HM` : `Long run w/ ${reps}×${work}′ steady`,
        description: 'Greenway out-and-back. Gel at 45′.',
        structure: b.build(),
        isKey: true,
        intensity: 'tempo',
        tags: ['long'],
        environment: 'outdoor',
      },
      c.thr,
    );
  }
  if (v === 2) {
    const b = new SB();
    b.add('active', T(Math.round(min * 0.7) * 60), HRZ(2), { label: 'Easy' });
    b.add('active', T((min - Math.round(min * 0.7)) * 60), RAMP('pace_pct', 82, 93), { label: 'Progress' });
    return draft(
      {
        sport: 'run',
        subSport: 'road_run',
        title: `Long run ${fmtHm(min)} progression`,
        structure: b.build(),
        isKey: true,
        intensity: 'endurance',
        tags: ['long'],
        environment: 'outdoor',
      },
      c.thr,
    );
  }
  return draft(
    {
      sport: 'run',
      subSport: 'road_run',
      title: `Long run ${fmtHm(min)}`,
      description: 'Easy, conversational. Carrilet greenway.',
      plannedDurationSec: min * 60,
      isKey: c.week.block !== 'offseason',
      intensity: 'endurance',
      tags: ['long'],
      environment: 'outdoor',
    },
    c.thr,
  );
}

export function runBrick(c: SessionCtx, min = 20): SessionDraft {
  const b = new SB();
  b.add('active', T(min * 60), PC(86, 92), { label: 'Off the bike', cue: 'Quick cadence, settle after 5′' });
  return draft(
    {
      sport: 'run',
      subSport: 'road_run',
      title: `Brick run ${min}′`,
      structure: b.build(),
      isKey: false,
      intensity: 'tempo',
      tags: ['brick'],
      environment: 'outdoor',
    },
    c.thr,
  );
}

export function runShakeout(c: SessionCtx, min = 20): SessionDraft {
  const b = new SB();
  b.add('active', T((min - 5) * 60), HRZ(1), { label: 'Easy' });
  b.rep(4, [b.s('active', T(20), PC(110, 120), { label: 'Stride' }), b.s('recovery', T(55), PC(50, 60))]);
  return draft(
    { sport: 'run', subSport: 'road_run', title: `Shakeout ${min}′ + strides`, structure: b.build(), isKey: false, intensity: 'recovery', tags: ['openers'], environment: 'outdoor' },
    c.thr,
  );
}

export function runTt30(c: SessionCtx): SessionDraft {
  const b = new SB();
  b.add('warmup', T(900), PC(70, 80));
  b.rep(3, [b.s('active', T(20), PC(110, 120)), b.s('recovery', T(60), PC(50, 60))]);
  b.add('active', T(1800), PC(100, 104), { label: '30′ TT', cue: 'Even effort. Lap at 10′ and 20′.' });
  b.add('cooldown', T(600), PC(60, 70));
  return draft(
    {
      sport: 'run',
      subSport: 'road_run',
      title: '30′ run TT',
      description: 'Threshold pace check: average pace of the 30′ = new threshold.',
      preNote: 'Flat river loop, no watch-staring for the first 10′.',
      structure: b.build(),
      isKey: true,
      intensity: 'threshold',
      tags: ['test', 'test:run_tt30'],
      environment: 'outdoor',
    },
    c.thr,
  );
}

export function runRace(c: SessionCtx, distM: number, title: string, tags: string[] = []): SessionDraft {
  const x = distM <= 5000 ? 1.06 : distM <= 10000 ? 1.03 : 0.97;
  return draft(
    {
      sport: 'run',
      subSport: 'road_run',
      title,
      plannedDurationSec: Math.round(distM / (c.thr.runMps * x) / 60) * 60,
      plannedDistanceM: distM,
      isKey: true,
      intensity: 'race',
      tags: ['race', ...tags],
      environment: 'outdoor',
    },
    c.thr,
  );
}
