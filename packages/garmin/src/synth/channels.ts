/**
 * The exact 1 Hz value formulas shared by the renderer and the summary pass:
 * value(t) = linear interpolation of the 5 s grid + zero-sum block noise.
 */
import type { Model } from './model';
import { blockZ, CH, noiseKey } from './noise';
import { DT, type Base } from './simulate';

export interface ChannelNoise {
  key: number;
  sd: number;
  mul: boolean;
}

export function noiseFor(m: Model, ch: keyof typeof CH): ChannelNoise {
  const key = noiseKey(m.seed, m.header.id, CH[ch]);
  switch (ch) {
    case 'power':
      return { key, mul: true, sd: m.family === 'row' ? 0.035 : m.indoor ? 0.028 : 0.075 };
    case 'hr':
      return { key, mul: false, sd: 0.9 };
    case 'cad':
      return { key, mul: false, sd: m.family === 'row' ? 0.4 : 1.4 };
    case 'speed':
      return { key, mul: true, sd: m.family === 'run' || m.family === 'walk' || m.family === 'hike' ? 0.03 : 0.012 };
    default:
      return { key, mul: false, sd: 0 };
  }
}

const zbuf = new Float64Array(5);

/** Samples in block k (seconds 5k … min(5k+4, dur−1)). */
export function blockLen(base: Base, k: number): number {
  return Math.max(0, Math.min(DT, base.dur - k * DT));
}

/** Fill `out[0..m)` with the channel's 1 Hz values in block k (unrounded). */
export function blockValues(c: Float64Array, base: Base, k: number, nz: ChannelNoise, out: Float64Array): number {
  const m = blockLen(base, k);
  if (m === 0) return 0;
  const a = c[k]!;
  const b = k + 1 < base.n ? c[k + 1]! : a;
  if (nz.sd > 0) blockZ(nz.key, k, m, zbuf);
  for (let j = 0; j < m; j++) {
    const v = a + ((b - a) * j) / DT;
    if (nz.sd === 0) out[j] = v;
    else if (nz.mul) out[j] = v * (1 + nz.sd * zbuf[j]!);
    else out[j] = v === 0 ? 0 : v + nz.sd * zbuf[j]!;
  }
  return m;
}
