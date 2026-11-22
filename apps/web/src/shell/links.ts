/**
 * Typed link helpers — the stable way for features to point at each other without importing
 * across feature folders. Each returns TanStack link options usable as
 *   <Link {...links.workout(id)}>…</Link>      navigate(links.calendarDay(date))
 *   <WorkoutCard link={links.workout(id)} />   <ButtonLink {...links.newWorkout({ date })}>…
 */
import type { IsoWeek, LocalDate, Sport } from '@cadence/core';
import { linkOptions } from '@tanstack/react-router';
import type { ActivitiesSearch, LibrarySearch, NewWorkoutSearch, TrendsSearch, JournalSearch } from './search';

export const links = {
  home: () => linkOptions({ to: '/' }),
  today: () => linkOptions({ to: '/today' }),

  calendar: (date?: LocalDate) => linkOptions({ to: '/calendar', search: date ? { date } : {} }),
  calendarMonth: (month: string /* YYYY-MM */) => linkOptions({ to: '/calendar/month/$month', params: { month } }),
  calendarWeek: (isoWeek: IsoWeek) => linkOptions({ to: '/calendar/week/$isoWeek', params: { isoWeek } }),
  calendarDay: (date: LocalDate) => linkOptions({ to: '/calendar/day/$date', params: { date } }),
  agenda: (date?: LocalDate) => linkOptions({ to: '/calendar/agenda', search: date ? { date } : {} }),
  season: () => linkOptions({ to: '/season' }),
  event: (id: string) => linkOptions({ to: '/events/$id', params: { id } }),

  newWorkout: (search: NewWorkoutSearch = {}) => linkOptions({ to: '/workouts/new', search }),
  workout: (id: string) => linkOptions({ to: '/workouts/$id', params: { id } }),
  workoutEdit: (id: string) => linkOptions({ to: '/workouts/$id/edit', params: { id } }),

  activities: (search: ActivitiesSearch = {}) => linkOptions({ to: '/activities', search }),
  activity: (id: string) => linkOptions({ to: '/activities/$id', params: { id } }),
  activityCompare: (id: string, withIds: string[]) =>
    linkOptions({ to: '/activities/$id/compare', params: { id }, search: { with: withIds.join(',') } }),

  library: (search: LibrarySearch = {}) => linkOptions({ to: '/library', search }),
  template: (templateId: string) => linkOptions({ to: '/library/$templateId', params: { templateId } }),
  block: (blockId: string) => linkOptions({ to: '/library/blocks/$blockId', params: { blockId } }),

  trends: (search: TrendsSearch = {}) => linkOptions({ to: '/trends', search }),
  trendsFitness: (search: TrendsSearch = {}) => linkOptions({ to: '/trends/fitness', search }),
  trendsVolume: (search: TrendsSearch = {}) => linkOptions({ to: '/trends/volume', search }),
  trendsIntensity: (search: TrendsSearch = {}) => linkOptions({ to: '/trends/intensity', search }),
  trendsPeaks: (search: TrendsSearch = {}) => linkOptions({ to: '/trends/peaks', search }),
  trendsWellness: (search: TrendsSearch = {}) => linkOptions({ to: '/trends/wellness', search }),
  trendsSport: (sport: Sport) => linkOptions({ to: '/trends/sport/$sport', params: { sport } }),

  week: (isoWeek: IsoWeek) => linkOptions({ to: '/week/$isoWeek', params: { isoWeek } }),
  journal: (search: JournalSearch = {}) => linkOptions({ to: '/journal', search }),

  settings: () => linkOptions({ to: '/settings/profile' }),
  settingsProfile: () => linkOptions({ to: '/settings/profile' }),
  settingsZones: () => linkOptions({ to: '/settings/zones' }),
  settingsSports: () => linkOptions({ to: '/settings/sports' }),
  settingsGarmin: () => linkOptions({ to: '/settings/garmin' }),
  settingsSync: () => linkOptions({ to: '/settings/sync' }),
  settingsAppearance: () => linkOptions({ to: '/settings/appearance' }),
  settingsData: () => linkOptions({ to: '/settings/data' }),
  settingsDevices: () => linkOptions({ to: '/settings/devices' }),
  settingsShortcuts: () => linkOptions({ to: '/settings/shortcuts' }),

  welcome: () => linkOptions({ to: '/welcome' }),
  login: (redirect?: string) => linkOptions({ to: '/login', search: redirect ? { redirect } : {} }),
};
