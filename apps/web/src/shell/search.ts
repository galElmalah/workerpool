/**
 * Search-param schemas for every route (zod, validated by TanStack via Standard Schema).
 * All params are optional and lenient: invalid values are dropped (`.catch(undefined)`), never a
 * crash. Feature agents read them with `Route.useSearch()`-style hooks:
 *   import { useSearch } from '@tanstack/react-router';
 *   const { date } = useSearch({ from: '/app/calendar' });
 */
import { IntensityClass, LocalDate, Sport } from '@cadence/core';
import { z } from 'zod';

const opt = <T extends z.ZodType>(t: T) => t.optional().catch(undefined);

export const calendarSearch = z.object({
  /** Anchor date to scroll to / focus (default: today). */
  date: opt(LocalDate),
});
export type CalendarSearch = z.infer<typeof calendarSearch>;

export const newWorkoutSearch = z.object({
  date: opt(LocalDate),
  sport: opt(Sport),
  /** Template id to start from (tpl_…), or a workout id to duplicate (wk_…). */
  from: opt(z.string().min(1)),
  /** Initial quick-add text ("bike 4x8m 95-100%"). */
  text: opt(z.string()),
});
export type NewWorkoutSearch = z.infer<typeof newWorkoutSearch>;

export const activitiesSearch = z.object({
  sport: opt(Sport),
  q: opt(z.string()),
  tag: opt(z.string()),
  from: opt(LocalDate),
  to: opt(LocalDate),
  key: opt(z.boolean()),
  intensity: opt(IntensityClass),
});
export type ActivitiesSearch = z.infer<typeof activitiesSearch>;

export const compareSearch = z.object({
  /** Comma-separated activity ids. */
  with: opt(z.string()),
});

export const librarySearch = z.object({
  q: opt(z.string()),
  sport: opt(Sport),
  folder: opt(z.string()),
  intensity: opt(IntensityClass),
});
export type LibrarySearch = z.infer<typeof librarySearch>;

export const TREND_RANGES = ['6w', '12w', '3m', '6m', '1y', 'all'] as const;
export const trendsSearch = z.object({
  range: opt(z.enum(TREND_RANGES)),
  sport: opt(Sport),
  /** Volume metric. */
  metric: opt(z.enum(['hours', 'load', 'distance'])),
  /** Compare mode for WoW tiles / overlays. */
  compare: opt(z.enum(['prev', 'year', 'avg'])),
});
export type TrendsSearch = z.infer<typeof trendsSearch>;

export const journalSearch = z.object({
  type: opt(z.enum(['day', 'workout', 'week'])),
  q: opt(z.string()),
  tag: opt(z.string()),
});
export type JournalSearch = z.infer<typeof journalSearch>;

export const syncLogSearch = z.object({
  status: opt(z.enum(['ok', 'error', 'running'])),
});

export const loginSearch = z.object({
  redirect: opt(z.string()),
});
