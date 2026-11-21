/** Concept2-style erg sessions. power_pct is % of erg threshold power. */
import { D, PP, SB, T } from '../structure';
import { draft, scaleMin, type SessionCtx, type SessionDraft } from './common';

export function rowUt2(c: SessionCtx): SessionDraft {
  const min = scaleMin(40, c.vol / 0.8, 0.6, 1.15);
  const b = new SB();
  b.add('warmup', T(300), PP(50, 60), { row: { strokeRateLow: 18, strokeRateHigh: 20 } });
  b.add('active', T((min - 8) * 60), PP(62, 72), { label: 'UT2', row: { strokeRateLow: 18, strokeRateHigh: 20 } });
  b.add('cooldown', T(180), PP(45, 55), { row: { strokeRateLow: 16, strokeRateHigh: 18 } });
  return draft(
    { sport: 'row', subSport: 'erg', title: `UT2 ${min}′ r20`, structure: b.build(), isKey: false, intensity: 'endurance', tags: ['erg', 'ut2'], environment: 'indoor' },
    c.thr,
  );
}

export function rowPieces(c: SessionCtx): SessionDraft {
  const b = new SB();
  b.add('warmup', T(600), PP(55, 70), { label: 'Warm up incl. 3×10 strokes firm', row: { strokeRateLow: 18, strokeRateHigh: 22 } });
  const v = c.variant % 3;
  let title: string;
  let intensity: SessionDraft['intensity'] = 'threshold';
  if (v === 0) {
    title = '4×2k @ r24';
    b.rep(4, [b.s('active', D(2000), PP(90, 95), { label: '2k', row: { strokeRateLow: 24, strokeRateHigh: 24 } }), b.s('rest', T(180), undefined, { label: 'Rest' })]);
  } else if (v === 1) {
    title = '3×10′ r22/24/26';
    b.rep(1, [
      b.s('active', T(600), PP(80, 85), { label: '10′ r22', row: { strokeRateLow: 22, strokeRateHigh: 22 } }),
      b.s('rest', T(120)),
      b.s('active', T(600), PP(88, 92), { label: '10′ r24', row: { strokeRateLow: 24, strokeRateHigh: 24 } }),
      b.s('rest', T(120)),
      b.s('active', T(600), PP(95, 100), { label: '10′ r26', row: { strokeRateLow: 26, strokeRateHigh: 26 } }),
    ]);
  } else {
    title = '8×500 m @ r28';
    intensity = 'high';
    b.rep(8, [b.s('active', D(500), PP(106, 112), { label: '500 m', row: { strokeRateLow: 28, strokeRateHigh: 30 } }), b.s('rest', T(90))]);
  }
  b.add('cooldown', T(300), PP(45, 55), { row: { strokeRateLow: 18, strokeRateHigh: 20 } });
  return draft(
    { sport: 'row', subSport: 'erg', title, structure: b.build(), isKey: false, intensity, tags: ['erg', 'intervals'], environment: 'indoor' },
    c.thr,
  );
}

export function rowTest(c: SessionCtx): SessionDraft {
  const b = new SB();
  b.add('warmup', T(900), PP(55, 75), { label: 'Warm up + 3×20 strokes @ race rate', row: { strokeRateLow: 20, strokeRateHigh: 30 } });
  b.add('active', D(2000), PP(126, 134), { label: '2k test', cue: 'Fast start 10 strokes, settle, sprint last 250', row: { strokeRateLow: 30, strokeRateHigh: 32 } });
  b.add('cooldown', T(600), PP(40, 50), { row: { strokeRateLow: 18, strokeRateHigh: 18 } });
  return draft(
    {
      sport: 'row',
      subSport: 'erg',
      title: '2k erg test',
      description: 'Erg threshold ≈ 75 % of 2k power.',
      preNote: 'Damper 4. Bucket nearby.',
      structure: b.build(),
      isKey: true,
      intensity: 'high',
      tags: ['test', 'test:row_2k', 'erg'],
      environment: 'indoor',
    },
    c.thr,
  );
}
