import { test } from 'vitest';
import { generateAthlete } from '../../src/synth';
test('scratch', () => {
  for (let i = 0; i < 3; i++) generateAthlete({ seed: 7, today: '2026-11-21' });
  const N = 8;
  const ts: number[] = [];
  for (let i = 0; i < N; i++) { const t0 = performance.now(); generateAthlete({ seed: i, today: '2026-11-21' }); ts.push(performance.now() - t0); }
  console.log('times', ts.map((x) => x.toFixed(0)).join(' '));
});
