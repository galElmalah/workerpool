/** Cycling session templates (indoor trainer intervals, outdoor long rides, tests). */
import { CAD, PP, RAMP, SB, T } from '../structure';
import { draft, fmtHm, scaleMin, type SessionCtx, type SessionDraft } from './common';

const wu = (b: SB, min = 12) => b.add('warmup', T(min * 60), RAMP('power_pct', 50, 75), { label: 'Warm up' });
const cd = (b: SB, min = 10) => b.add('cooldown', T(min * 60), PP(45, 55), { label: 'Cool down' });

export function bikeVo2(c: SessionCtx): SessionDraft {
  const b = new SB();
  wu(b, 15);
  b.rep(2, [b.s('active', T(60), PP(105, 110), { label: 'Opener' }), b.s('recovery', T(60), PP(50, 55))]);
  b.add('recovery', T(180), PP(50, 60));
  const v = c.variant % 4;
  let title: string;
  if (v === 0) {
    title = 'VO2 5×4′';
    b.rep(5, [b.s('active', T(240), PP(110, 118), { label: 'VO2', cue: 'Smooth, high cadence' }), b.s('recovery', T(180), PP(50, 55))]);
  } else if (v === 1) {
    title = 'VO2 6×3′';
    b.rep(6, [b.s('active', T(180), PP(114, 120), { label: 'VO2' }), b.s('recovery', T(180), PP(50, 55))]);
  } else if (v === 2) {
    title = '30/30s 3×8';
    b.rep(3, [
      b.ir(8, [b.s('active', T(30), PP(130, 145), { label: 'On' }), b.s('recovery', T(30), PP(45, 55), { label: 'Off' })]),
      b.s('recovery', T(300), PP(50, 60), { label: 'Set rest' }),
    ]);
  } else {
    title = 'VO2 4×5′';
    b.rep(4, [b.s('active', T(300), PP(108, 114), { label: 'VO2' }), b.s('recovery', T(240), PP(50, 55))]);
  }
  cd(b);
  return draft(
    {
      sport: 'bike',
      subSport: 'indoor',
      title,
      description: 'Aerobic capacity. First rep should feel controlled; hold cadence 95+.',
      structure: b.build(),
      isKey: true,
      intensity: 'high',
      tags: ['intervals', 'vo2'],
      environment: 'indoor',
    },
    c.thr,
  );
}

export function bikeThreshold(c: SessionCtx, racePace = false): SessionDraft {
  const b = new SB();
  wu(b, 15);
  const v = c.variant % 4;
  let title: string;
  if (racePace) {
    title = '3×20′ @ race power';
    b.rep(3, [b.s('active', T(1200), PP(80, 84), { label: 'Race power', cue: 'Aero position, fuel every 20′' }), b.s('recovery', T(300), PP(55, 60))]);
  } else if (v === 0) {
    title = 'Threshold 3×10′';
    b.rep(3, [b.s('active', T(600), PP(95, 100), { label: 'Threshold' }), b.s('recovery', T(300), PP(50, 55))]);
  } else if (v === 1) {
    title = 'Over-unders 3×9′';
    b.rep(3, [
      b.ir(3, [b.s('active', T(120), PP(92, 96), { label: 'Under' }), b.s('active', T(60), PP(105, 110), { label: 'Over' })]),
      b.s('recovery', T(300), PP(50, 55)),
    ]);
  } else if (v === 2) {
    title = '2×15′ @ FTP';
    b.rep(2, [b.s('active', T(900), PP(96, 100), { label: 'FTP' }), b.s('recovery', T(360), PP(50, 55))]);
  } else {
    title = '2×20′ threshold';
    b.rep(2, [b.s('active', T(1200), PP(92, 96), { label: 'Threshold' }), b.s('recovery', T(300), PP(50, 55))]);
  }
  cd(b);
  return draft(
    {
      sport: 'bike',
      subSport: 'indoor',
      title,
      description: racePace ? 'Dial in race power and fuelling on the TT bike.' : 'Raise FTP. Steady pressure, no surges.',
      structure: b.build(),
      isKey: true,
      intensity: 'threshold',
      tags: ['intervals', 'threshold'],
      environment: 'indoor',
    },
    c.thr,
  );
}

export function bikeSweetSpot(c: SessionCtx): SessionDraft {
  const b = new SB();
  wu(b, 12);
  const v = c.variant % 3;
  let title: string;
  if (v === 0) {
    title = 'Sweet spot 3×12′';
    b.rep(3, [b.s('active', T(720), PP(86, 90), { label: 'Sweet spot' }), b.s('recovery', T(240), PP(50, 55))]);
  } else if (v === 1) {
    title = 'Tempo 3×15′';
    b.rep(3, [b.s('active', T(900), PP(80, 85), { label: 'Tempo', cue: 'Low cadence 75–80 on #2' }), b.s('recovery', T(300), PP(50, 55))]);
  } else {
    title = 'Sweet spot 2×20′';
    b.rep(2, [b.s('active', T(1200), PP(85, 89), { label: 'Sweet spot' }), b.s('recovery', T(300), PP(50, 55))]);
  }
  cd(b);
  return draft(
    {
      sport: 'bike',
      subSport: 'indoor',
      title,
      description: 'Muscular endurance. Should feel comfortably hard.',
      structure: b.build(),
      isKey: true,
      intensity: 'tempo',
      tags: ['intervals', 'sweet-spot'],
      environment: 'indoor',
    },
    c.thr,
  );
}

export function bikeEnduranceIndoor(c: SessionCtx, baseMin = 60): SessionDraft {
  const min = scaleMin(baseMin, c.vol, 0.6, 1.15);
  const b = new SB();
  b.add('warmup', T(600), RAMP('power_pct', 50, 65));
  const main = min - 15;
  if (c.variant % 2 === 0 || main < 30) {
    b.add('active', T(main * 60), PP(65, 72), { label: 'Z2', secondary: CAD(88, 95) });
  } else {
    const blk = Math.floor(main / 2) * 60;
    b.add('active', T(blk), PP(65, 72), { label: 'Z2' });
    b.rep(5, [b.s('active', T(60), PP(70, 75), { label: 'Spin-up', secondary: CAD(110, 120) }), b.s('recovery', T(60), PP(60, 65))]);
    b.add('active', T(main * 60 - blk - 600), PP(65, 72), { label: 'Z2' });
  }
  b.add('cooldown', T(300), PP(45, 55));
  return draft(
    {
      sport: 'bike',
      subSport: 'indoor',
      title: c.variant % 2 === 0 || main < 30 ? `Z2 spin ${fmtHm(min)}` : `Z2 ${fmtHm(min)} + spin-ups`,
      structure: b.build(),
      isKey: false,
      intensity: 'endurance',
      tags: ['endurance'],
      environment: 'indoor',
    },
    c.thr,
  );
}

export function bikeRecovery(c: SessionCtx, min = 40, outdoor = false): SessionDraft {
  return draft(
    {
      sport: 'bike',
      subSport: outdoor ? 'road' : 'indoor',
      title: outdoor ? `Easy spin ${fmtHm(min)}` : `Recovery spin ${fmtHm(min)}`,
      plannedDurationSec: min * 60,
      isKey: false,
      intensity: 'recovery',
      tags: ['recovery'],
      environment: outdoor ? 'outdoor' : 'indoor',
    },
    c.thr,
  );
}

export function bikeOpeners(c: SessionCtx, min = 45): SessionDraft {
  const b = new SB();
  b.add('warmup', T(900), RAMP('power_pct', 50, 70));
  b.rep(4, [b.s('active', T(60), PP(105, 115), { label: 'Opener' }), b.s('recovery', T(120), PP(50, 55))]);
  b.add('active', T((min - 27) * 60), PP(60, 70));
  return draft(
    {
      sport: 'bike',
      subSport: 'road',
      title: `Openers ${min}′ w/ 4×1′`,
      structure: b.build(),
      isKey: false,
      intensity: 'endurance',
      tags: ['openers'],
      environment: 'outdoor',
    },
    c.thr,
  );
}

/** Long outdoor ride; the flavour depends on the training block. */
export function bikeLong(c: SessionCtx): SessionDraft {
  const blk = c.week.block;
  const baseMin = blk === 'offseason' || blk === 'genprep' ? 160 : blk === 'runbase' || blk === 'hmbuild' || blk === 'transition' ? 140 : 185;
  const min = scaleMin(baseMin, c.vol / (blk === 'genprep' || blk === 'offseason' ? 0.66 : 0.9), 0.55, 1.15);
  const rides = ['Banyoles loop', 'Coast loop', 'Gavarres loop', 'Rocacorba'];
  const where = rides[c.variant % rides.length]!;
  const tags = ['long', 'endurance'];
  if (where === 'Rocacorba') tags.push('hilly');
  const preNotes = ['Coffee stop in Banyoles ☕', 'Fuel 70–80 g/h. Two bottles.', 'Club ride from the Plaça, 8:30 sharp', 'Keep it honest on the climbs — Z2 cap', undefined, undefined];
  const preNote = c.rng.pick(preNotes);

  const structured = (blk === 'base' && c.variant % 2 === 1) || blk === 'build1' || blk === 'build2' || blk === 'peak';
  if (!structured || min < 120) {
    return draft(
      {
        sport: 'bike',
        subSport: 'road',
        title: `Long ride ${fmtHm(min)} — ${where}`,
        description: 'Aerobic endurance. Conversational, eat early and often.',
        ...(preNote ? { preNote } : {}),
        plannedDurationSec: min * 60,
        isKey: true,
        intensity: 'endurance',
        tags,
        environment: 'outdoor',
      },
      c.thr,
    );
  }
  const b = new SB();
  const peak = blk === 'peak';
  const reps = peak ? 1 : blk === 'build2' ? 2 : blk === 'build1' ? 2 : 3;
  const work = peak ? Math.round(min * 0.62) : blk === 'base' ? 15 : 20;
  const tgt = peak ? PP(78, 82) : blk === 'base' ? PP(78, 84) : PP(80, 85);
  b.add('warmup', T(30 * 60), PP(55, 68), { label: 'Z2' });
  b.rep(reps, [b.s('active', T(work * 60), tgt, { label: peak ? 'Race power' : 'Tempo' }), b.s('recovery', T(10 * 60), PP(60, 70))]);
  const rest = Math.max(10, min - 30 - reps * (work + 10));
  b.add('active', T(rest * 60), PP(60, 70), { label: 'Z2 home' });
  return draft(
    {
      sport: 'bike',
      subSport: 'road',
      title: peak ? `Race sim ${fmtHm(min)}` : `Long ride w/ ${reps}×${work}′ ${blk === 'base' ? 'tempo' : 'race pace'}`,
      description: peak ? 'Full dress rehearsal: race wheels, race nutrition, race power.' : 'Tempo blocks on the flat sections. Rest of the ride Z2.',
      ...(preNote ? { preNote } : {}),
      structure: b.build(),
      plannedDurationSec: min * 60,
      isKey: true,
      intensity: 'tempo',
      tags: [...tags, 'race-specific'],
      environment: 'outdoor',
    },
    c.thr,
  );
}

export function bikeTest(c: SessionCtx, kind: 'ftp_20' | 'ftp_ramp'): SessionDraft {
  const b = new SB();
  if (kind === 'ftp_ramp') {
    b.add('warmup', T(600), PP(50, 55));
    b.add('active', T(1080), RAMP('power_pct', 45, 130), { label: 'Ramp to failure', cue: '+1 step per minute' });
    b.add('cooldown', T(600), PP(40, 50));
  } else {
    b.add('warmup', T(1200), RAMP('power_pct', 50, 75));
    b.rep(3, [b.s('active', T(60), PP(110, 120), { label: 'Fast pedal' }), b.s('recovery', T(60), PP(50, 55))]);
    b.add('active', T(300), PP(108, 115), { label: 'Blow-out' });
    b.add('recovery', T(600), PP(50, 55));
    b.add('active', T(1200), PP(100, 106), { label: '20′ TT', cue: 'Even pacing. Last 5′ empty the tank.' });
    b.add('cooldown', T(900), PP(40, 50));
  }
  return draft(
    {
      sport: 'bike',
      subSport: 'indoor',
      title: kind === 'ftp_ramp' ? 'Ramp test' : 'FTP test 20′',
      description: 'Fresh legs, fan on, same trainer setup as last time.',
      preNote: kind === 'ftp_ramp' ? 'Start of season benchmark. No heroics.' : 'Big breakfast, coffee 45′ before.',
      structure: b.build(),
      isKey: true,
      intensity: 'threshold',
      tags: ['test', `test:${kind}`],
      environment: 'indoor',
    },
    c.thr,
  );
}

export function bikeRaceLeg(c: SessionCtx, distM: number, name: string): SessionDraft {
  const v = distM > 50000 ? 9.1 : 9.8;
  return draft(
    {
      sport: 'bike',
      subSport: 'road',
      title: `${name} — Bike ${Math.round(distM / 1000)}k`,
      plannedDurationSec: Math.round(distM / v / 60) * 60,
      plannedDistanceM: distM,
      isKey: true,
      intensity: 'race',
      tags: ['race'],
      environment: 'outdoor',
    },
    c.thr,
  );
}

