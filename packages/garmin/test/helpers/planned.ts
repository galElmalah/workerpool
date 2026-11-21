import type { InnerRepeat, PlannedWorkout, Repeat, Step, StructureNode } from '@cadence/core/domain';

export function planned(over: Partial<PlannedWorkout> & Pick<PlannedWorkout, 'sport' | 'title'>, steps?: StructureNode[], poolLengthM?: number): PlannedWorkout {
  const p: PlannedWorkout = {
    id: 'pw_1',
    date: '2026-11-24',
    isKey: false,
    intensity: 'threshold',
    tags: [],
    environment: 'any',
    status: 'planned',
    garmin: { syncState: 'none' },
    createdAt: '2026-11-20T10:00:00Z',
    updatedAt: '2026-11-20T10:00:00Z',
    ...over,
  };
  if (steps) p.structure = poolLengthM ? { steps, poolLengthM } : { steps };
  return p;
}

let n = 0;
export const step = (s: Omit<Step, 'kind' | 'id'>): Step => ({ kind: 'step', id: `s${++n}`, ...s });
export const repeat = (count: number, steps: Repeat['steps']): Repeat => ({ kind: 'repeat', id: `r${++n}`, count, steps });
export const innerRepeat = (count: number, steps: Step[]): InnerRepeat => ({ kind: 'repeat', id: `r${++n}`, count, steps });
