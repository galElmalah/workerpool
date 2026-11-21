/**
 * TanStack Query setup + the query-key registry shared by every feature.
 *
 * Keys are hierarchical so invalidation is coarse and simple:
 *   qk.calendar.range(from, to)  → ['calendar', from, to]
 * After any mutation that changes training data call `invalidateTraining()`; it refreshes
 * calendar, today, weeks, trends, workouts and activities in one go.
 */
import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
    mutations: { retry: false },
  },
});

export const qk = {
  auth: ['auth'] as const,
  settings: ['settings'] as const,
  thresholds: {
    all: ['thresholds'] as const,
    history: ['thresholds', 'history'] as const,
    current: ['thresholds', 'current'] as const,
    zones: (date?: string) => ['thresholds', 'zones', date ?? 'today'] as const,
  },
  calendar: {
    all: ['calendar'] as const,
    range: (from: string, to: string) => ['calendar', from, to] as const,
  },
  workouts: {
    all: ['workouts'] as const,
    detail: (id: string) => ['workouts', 'detail', id] as const,
  },
  activities: {
    all: ['activities'] as const,
    list: (filters: unknown) => ['activities', 'list', filters] as const,
    detail: (id: string) => ['activities', 'detail', id] as const,
    streams: (id: string) => ['activities', 'streams', id] as const,
  },
  templates: {
    all: ['templates'] as const,
    list: (filters: unknown) => ['templates', 'list', filters] as const,
    detail: (id: string) => ['templates', 'detail', id] as const,
  },
  trends: {
    all: ['trends'] as const,
    of: (name: string, params?: unknown) => ['trends', name, params ?? null] as const,
  },
  weeks: {
    all: ['weeks'] as const,
    detail: (isoWeek: string) => ['weeks', isoWeek] as const,
  },
  today: ['today'] as const,
  journal: {
    all: ['journal'] as const,
    list: (filters: unknown) => ['journal', filters] as const,
  },
  furniture: {
    events: ['events'] as const,
    phases: ['phases'] as const,
    markers: ['markers'] as const,
    dayNote: (date: string) => ['day-notes', date] as const,
    weekNote: (isoWeek: string) => ['week-notes', isoWeek] as const,
    wellness: (date: string) => ['wellness', date] as const,
  },
  garmin: {
    status: ['garmin', 'status'] as const,
    log: (filters?: unknown) => ['garmin', 'log', filters ?? null] as const,
  },
  search: (q: string) => ['search', q] as const,
};

/** Everything derived from workouts/activities/notes. Call after mutations of training data. */
export function invalidateTraining(): Promise<unknown> {
  return Promise.all(
    [qk.calendar.all, qk.today, qk.weeks.all, qk.trends.all, qk.workouts.all, qk.activities.all, qk.journal.all].map(
      (queryKey) => queryClient.invalidateQueries({ queryKey }),
    ),
  );
}
