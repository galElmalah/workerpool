/** Internal shared types of the synthetic athlete generator (not part of the public contract). */
import type { Sport, SubSport } from '@cadence/core/domain';

/** Thresholds valid on a given date. */
export interface Thr {
  ftp: number;
  runMps: number;
  cssMps: number;
  rowW: number;
  lthr: number;
  hrRest: number;
  hrMax: number;
  weightKg: number;
}

/** Simulation family: decides which stream model renders an activity. */
export type Family = 'bike' | 'run' | 'swim_pool' | 'swim_ow' | 'row' | 'strength' | 'yoga' | 'walk' | 'hike';

export function familyOf(sport: Sport, subSport?: SubSport): Family {
  switch (sport) {
    case 'bike':
      return 'bike';
    case 'run':
      return 'run';
    case 'swim':
      return subSport === 'open_water' ? 'swim_ow' : 'swim_pool';
    case 'row':
      return 'row';
    case 'strength':
      return 'strength';
    case 'yoga':
      return 'yoga';
    case 'hike':
      return 'hike';
    case 'walk':
      return 'walk';
    default:
      return 'walk';
  }
}

/** Garmin activityType.typeKey for a sport/subSport. */
export function garminTypeKey(sport: Sport, subSport?: SubSport): string {
  switch (sport) {
    case 'bike':
      return subSport === 'indoor' ? 'indoor_cycling' : subSport === 'virtual' ? 'virtual_ride' : subSport === 'gravel' ? 'gravel_cycling' : subSport === 'mtb' ? 'mountain_biking' : 'road_biking';
    case 'run':
      return subSport === 'trail' ? 'trail_running' : subSport === 'track' ? 'track_running' : subSport === 'treadmill' ? 'treadmill_running' : 'running';
    case 'swim':
      return subSport === 'open_water' ? 'open_water_swimming' : 'lap_swimming';
    case 'row':
      return subSport === 'on_water' ? 'rowing_v2' : 'indoor_rowing';
    case 'strength':
      return 'strength_training';
    case 'yoga':
      return 'yoga';
    case 'hike':
      return 'hiking';
    case 'walk':
      return 'walking';
    default:
      return 'other';
  }
}

export function isIndoor(sport: Sport, subSport?: SubSport): boolean {
  return (
    (sport === 'bike' && (subSport === 'indoor' || subSport === 'virtual')) ||
    (sport === 'run' && subSport === 'treadmill') ||
    (sport === 'swim' && subSport !== 'open_water') ||
    (sport === 'row' && subSport !== 'on_water') ||
    sport === 'strength' ||
    sport === 'yoga'
  );
}

/** Minimal activity identity needed to (re)build its model. */
export interface Header {
  id: number;
  sport: Sport;
  subSport?: SubSport;
  title: string;
  startedAt: string;
  localDate: string;
  utcOffsetMin: number;
  plannedKey?: string;
}
