/** Low-key sessions: yoga, hikes, walks. */
import { draft, fmtHm, type SessionCtx, type SessionDraft } from './common';

export function yoga(c: SessionCtx, min = 45): SessionDraft {
  return draft(
    { sport: 'yoga', subSport: 'generic', title: `Yoga flow ${min}′`, plannedDurationSec: min * 60, isKey: false, intensity: 'recovery', tags: ['mobility'], environment: 'indoor' },
    c.thr,
  );
}

export function hike(c: SessionCtx, min: number, where: string): SessionDraft {
  return draft(
    {
      sport: 'hike',
      subSport: 'generic',
      title: `Hike ${fmtHm(min)} — ${where}`,
      plannedDurationSec: min * 60,
      isKey: false,
      intensity: 'endurance',
      tags: ['hike', 'transition'],
      environment: 'outdoor',
    },
    c.thr,
  );
}

export function walk(c: SessionCtx, min = 45): SessionDraft {
  return draft(
    { sport: 'walk', subSport: 'generic', title: `Walk ${min}′`, plannedDurationSec: min * 60, isKey: false, intensity: 'recovery', tags: ['recovery'], environment: 'outdoor' },
    c.thr,
  );
}
