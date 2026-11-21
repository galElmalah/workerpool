import type { Activity, PlannedWorkout } from '../../src/domain';

export function planned(p: Partial<PlannedWorkout> & { id: string; date: string }): PlannedWorkout {
  return {
    sport: 'run',
    title: 'Planned',
    isKey: false,
    intensity: 'endurance',
    tags: [],
    environment: 'any',
    status: 'planned',
    garmin: { syncState: 'none' },
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    ...p,
  };
}

export function activity(a: Partial<Activity> & { id: string; localDate: string }): Activity {
  return {
    source: 'garmin',
    startedAt: `${a.localDate}T07:00:00Z`,
    utcOffsetMin: 0,
    sport: 'run',
    title: 'Morning Run',
    durationSec: 3600,
    movingSec: 3600,
    load: 50,
    loadSource: 'pace',
    intensityAuto: 'endurance',
    intensity: 'endurance',
    isKey: false,
    tags: [],
    hasStreams: true,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    ...a,
  };
}
