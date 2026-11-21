/**
 * The route tree (code-based) — EVERY route of product.md §2.2, each lazily loading a NAMED export
 * from `src/features/<feature>/pages.tsx`. The contract (export names, paths, params, search
 * schemas) is documented in src/shell/README.md; keep it stable.
 *
 * Navigation = native View Transitions typed by `vtTypes` (design.md §5.2). Scroll restoration is
 * on; focus moves to the new page's h1 after each navigation (see AppShell).
 */
import { IsoWeek, LocalDate, Sport } from '@cadence/core';
import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router';
import { z } from 'zod';
import { requiredAuthRedirect } from '@/lib/queries/shared';
import { vtTypes } from '@/motion/vt-types';
import { PageSkeleton } from '@/ui/Skeleton';
import { AppShell, BareShell, RootLayout, RouteError, NotFound } from './AppShell';
import {
  activitiesSearch,
  calendarSearch,
  compareSearch,
  journalSearch,
  librarySearch,
  loginSearch,
  newWorkoutSearch,
  syncLogSearch,
  trendsSearch,
} from './search';

// ───────────── lazy feature modules (one chunk per feature) ─────────────
const calendar = () => import('@/features/calendar/pages');
const workouts = () => import('@/features/workouts/pages');
const activities = () => import('@/features/activities/pages');
const trends = () => import('@/features/trends/pages');
const week = () => import('@/features/week/pages');
const today = () => import('@/features/today/pages');
const library = () => import('@/features/library/pages');
const journal = () => import('@/features/journal/pages');
const settings = () => import('@/features/settings/pages');
const welcome = () => import('@/features/welcome/pages');
const dev = () => import('./dev/pages');

// ───────────── params schemas ─────────────
const monthParam = z.string().regex(/^\d{4}-\d{2}$/);
const parse =
  <T,>(schema: z.ZodType<T>, key: string) =>
  (raw: Record<string, string>) => {
    const r = schema.safeParse(raw[key]);
    if (!r.success) throw redirect({ to: '/calendar' });
    return { [key]: r.data } as Record<string, T>;
  };

// ───────────── tree ─────────────
const rootRoute = createRootRoute({ component: RootLayout, notFoundComponent: NotFound });

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: '_app',
  component: AppShell,
  // Single-user gate: first visit → /welcome (set a passphrase), signed out → /login.
  beforeLoad: async ({ location }) => {
    if (location.pathname.startsWith('/dev/')) return;
    const to = await requiredAuthRedirect();
    if (to === '/welcome') throw redirect({ to: '/welcome', replace: true });
    if (to === '/login') throw redirect({ to: '/login', search: { redirect: location.href }, replace: true });
  },
});
const bareRoute = createRoute({ getParentRoute: () => rootRoute, id: '_bare', component: BareShell });

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  beforeLoad: () => {
    const mobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 47.99rem)').matches;
    throw redirect({ to: mobile ? '/today' : '/calendar', replace: true });
  },
});

const todayRoute = createRoute({ getParentRoute: () => appRoute, path: '/today', component: lazyRouteComponent(today, 'TodayPage') });

const calendarRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/calendar',
  validateSearch: calendarSearch,
  component: lazyRouteComponent(calendar, 'CalendarPage'),
});
const calendarMonthRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/calendar/month/$month',
  params: { parse: parse(monthParam, 'month') as (raw: Record<string, string>) => { month: string }, stringify: (p: { month: string }) => p },
  component: lazyRouteComponent(calendar, 'CalendarMonthPage'),
});
const calendarWeekRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/calendar/week/$isoWeek',
  params: { parse: parse(IsoWeek, 'isoWeek') as (raw: Record<string, string>) => { isoWeek: string }, stringify: (p: { isoWeek: string }) => p },
  component: lazyRouteComponent(calendar, 'CalendarWeekPage'),
});
const calendarDayRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/calendar/day/$date',
  params: { parse: parse(LocalDate, 'date') as (raw: Record<string, string>) => { date: string }, stringify: (p: { date: string }) => p },
  component: lazyRouteComponent(calendar, 'CalendarDayPage'),
});
const agendaRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/calendar/agenda',
  validateSearch: calendarSearch,
  component: lazyRouteComponent(calendar, 'AgendaPage'),
});
const seasonRoute = createRoute({ getParentRoute: () => appRoute, path: '/season', component: lazyRouteComponent(calendar, 'SeasonPage') });
const eventRoute = createRoute({ getParentRoute: () => appRoute, path: '/events/$id', component: lazyRouteComponent(calendar, 'EventPage') });

const workoutNewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/workouts/new',
  validateSearch: newWorkoutSearch,
  component: lazyRouteComponent(workouts, 'WorkoutNewPage'),
});
const workoutRoute = createRoute({ getParentRoute: () => appRoute, path: '/workouts/$id', component: lazyRouteComponent(workouts, 'WorkoutPage') });
const workoutEditRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/workouts/$id/edit',
  component: lazyRouteComponent(workouts, 'WorkoutEditPage'),
});

const activitiesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/activities',
  validateSearch: activitiesSearch,
  component: lazyRouteComponent(activities, 'ActivitiesPage'),
});
const activityRoute = createRoute({ getParentRoute: () => appRoute, path: '/activities/$id', component: lazyRouteComponent(activities, 'ActivityPage') });
const activityCompareRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/activities/$id/compare',
  validateSearch: compareSearch,
  component: lazyRouteComponent(activities, 'ActivityComparePage'),
});

const libraryRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/library',
  validateSearch: librarySearch,
  component: lazyRouteComponent(library, 'LibraryPage'),
});
const templateRoute = createRoute({ getParentRoute: () => appRoute, path: '/library/$templateId', component: lazyRouteComponent(library, 'TemplatePage') });
const blockRoute = createRoute({ getParentRoute: () => appRoute, path: '/library/blocks/$blockId', component: lazyRouteComponent(library, 'BlockPage') });

const trendsRoute = createRoute({ getParentRoute: () => appRoute, path: '/trends', validateSearch: trendsSearch, component: lazyRouteComponent(trends, 'TrendsPage') });
const trendsFitnessRoute = createRoute({ getParentRoute: () => appRoute, path: '/trends/fitness', validateSearch: trendsSearch, component: lazyRouteComponent(trends, 'TrendsFitnessPage') });
const trendsVolumeRoute = createRoute({ getParentRoute: () => appRoute, path: '/trends/volume', validateSearch: trendsSearch, component: lazyRouteComponent(trends, 'TrendsVolumePage') });
const trendsIntensityRoute = createRoute({ getParentRoute: () => appRoute, path: '/trends/intensity', validateSearch: trendsSearch, component: lazyRouteComponent(trends, 'TrendsIntensityPage') });
const trendsPeaksRoute = createRoute({ getParentRoute: () => appRoute, path: '/trends/peaks', validateSearch: trendsSearch, component: lazyRouteComponent(trends, 'TrendsPeaksPage') });
const trendsWellnessRoute = createRoute({ getParentRoute: () => appRoute, path: '/trends/wellness', validateSearch: trendsSearch, component: lazyRouteComponent(trends, 'TrendsWellnessPage') });
const trendsSportRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/trends/sport/$sport',
  params: { parse: parse(Sport, 'sport') as (raw: Record<string, string>) => { sport: Sport }, stringify: (p: { sport: Sport }) => p },
  validateSearch: trendsSearch,
  component: lazyRouteComponent(trends, 'TrendsSportPage'),
});

const weekRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/week/$isoWeek',
  params: { parse: parse(IsoWeek, 'isoWeek') as (raw: Record<string, string>) => { isoWeek: string }, stringify: (p: { isoWeek: string }) => p },
  component: lazyRouteComponent(week, 'WeekPage'),
});

const journalRoute = createRoute({ getParentRoute: () => appRoute, path: '/journal', validateSearch: journalSearch, component: lazyRouteComponent(journal, 'JournalPage') });

const settingsRoute = createRoute({ getParentRoute: () => appRoute, path: '/settings', component: lazyRouteComponent(settings, 'SettingsLayout') });
const settingsIndexRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/settings/profile', replace: true });
  },
});
const settingsProfileRoute = createRoute({ getParentRoute: () => settingsRoute, path: '/profile', component: lazyRouteComponent(settings, 'SettingsProfilePage') });
const settingsZonesRoute = createRoute({ getParentRoute: () => settingsRoute, path: '/zones', component: lazyRouteComponent(settings, 'SettingsZonesPage') });
const settingsSportsRoute = createRoute({ getParentRoute: () => settingsRoute, path: '/sports', component: lazyRouteComponent(settings, 'SettingsSportsPage') });
const settingsGarminRoute = createRoute({ getParentRoute: () => settingsRoute, path: '/garmin', component: lazyRouteComponent(settings, 'SettingsGarminPage') });
const settingsSyncRoute = createRoute({ getParentRoute: () => settingsRoute, path: '/sync', validateSearch: syncLogSearch, component: lazyRouteComponent(settings, 'SettingsSyncPage') });
const settingsAppearanceRoute = createRoute({ getParentRoute: () => settingsRoute, path: '/appearance', component: lazyRouteComponent(settings, 'SettingsAppearancePage') });
const settingsDataRoute = createRoute({ getParentRoute: () => settingsRoute, path: '/data', component: lazyRouteComponent(settings, 'SettingsDataPage') });
const settingsShortcutsRoute = createRoute({ getParentRoute: () => settingsRoute, path: '/shortcuts', component: lazyRouteComponent(settings, 'SettingsShortcutsPage') });

const devGalleryRoute = createRoute({ getParentRoute: () => appRoute, path: '/dev/gallery', component: lazyRouteComponent(dev, 'GalleryPage') });
const devChartsRoute = createRoute({ getParentRoute: () => appRoute, path: '/dev/charts', component: lazyRouteComponent(() => import('@/charts/Gallery')) });
const devMorphRoute = createRoute({ getParentRoute: () => appRoute, path: '/dev/morph', component: lazyRouteComponent(dev, 'MorphListPage') });
const devMorphDetailRoute = createRoute({ getParentRoute: () => appRoute, path: '/dev/morph/$id', component: lazyRouteComponent(dev, 'MorphDetailPage') });

const welcomeRoute = createRoute({ getParentRoute: () => bareRoute, path: '/welcome', component: lazyRouteComponent(welcome, 'WelcomePage') });
const loginRoute = createRoute({ getParentRoute: () => bareRoute, path: '/login', validateSearch: loginSearch, component: lazyRouteComponent(welcome, 'LoginPage') });

export const routeTree = rootRoute.addChildren([
  appRoute.addChildren([
    indexRoute,
    todayRoute,
    calendarRoute,
    calendarMonthRoute,
    calendarWeekRoute,
    calendarDayRoute,
    agendaRoute,
    seasonRoute,
    eventRoute,
    workoutNewRoute,
    workoutRoute,
    workoutEditRoute,
    activitiesRoute,
    activityRoute,
    activityCompareRoute,
    libraryRoute,
    templateRoute,
    blockRoute,
    trendsRoute,
    trendsFitnessRoute,
    trendsVolumeRoute,
    trendsIntensityRoute,
    trendsPeaksRoute,
    trendsWellnessRoute,
    trendsSportRoute,
    weekRoute,
    journalRoute,
    settingsRoute.addChildren([
      settingsIndexRoute,
      settingsProfileRoute,
      settingsZonesRoute,
      settingsSportsRoute,
      settingsGarminRoute,
      settingsSyncRoute,
      settingsAppearanceRoute,
      settingsDataRoute,
      settingsShortcutsRoute,
    ]),
    devGalleryRoute,
    devChartsRoute,
    devMorphRoute,
    devMorphDetailRoute,
  ]),
  bareRoute.addChildren([welcomeRoute, loginRoute]),
]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultPreloadDelay: 60,
  scrollRestoration: true,
  defaultViewTransition: { types: vtTypes },
  defaultPendingComponent: PageSkeleton,
  defaultPendingMs: 150,
  defaultPendingMinMs: 300,
  defaultErrorComponent: RouteError,
  defaultNotFoundComponent: NotFound,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
