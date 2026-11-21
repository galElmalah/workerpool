/**
 * Synthetic athlete generator — public API (see ./types.ts for the contract).
 *
 *   const athlete = generateAthlete({ seed: 7, today: '2026-11-21' });   // summaries only, fast
 *   const detail = generateActivityDetail(athlete, athlete.activities[0].garminActivityId); // 1 Hz streams
 *   const fit = encodeFit(detail);                                        // real FIT bytes
 */
import type { SynthApi } from './types';
import { generateActivityDetail, generateAthlete } from './athlete';
import { encodeFit } from './fit';

export { generateActivityDetail, generateAthlete, encodeFit };
export { thresholdsAt } from './profile';
export type * from './types';

export const synth: SynthApi = { generateAthlete, generateActivityDetail, encodeFit };
