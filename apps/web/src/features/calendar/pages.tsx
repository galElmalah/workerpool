/**
 * PLACEHOLDER — the calendar engineer replaces this file. Contract (src/shell/README.md):
 * named exports CalendarPage, CalendarMonthPage, CalendarWeekPage, plus the re-exports below, which
 * belong to the day/agenda engineer (./day, ./agenda, ./season, ./event) and must stay as they are.
 */
export { CalendarDayPage } from './day/DayPage';
export { AgendaPage } from './agenda/AgendaPage';
export { SeasonPage } from './season/SeasonPage';
export { EventPage } from './event/EventPage';

import { getRouteApi } from '@tanstack/react-router';
import { CalendarDays, CalendarRange } from 'lucide-react';
import { formatIsoWeekLabel, formatMonthYearLong } from '@/lib/format';
import { PlaceholderPage } from '@/shell/Placeholder';

const weekApi = getRouteApi('/_app/calendar/week/$isoWeek');
const monthApi = getRouteApi('/_app/calendar/month/$month');

export function CalendarPage() {
  return (
    <PlaceholderPage title="Calendar" variant="compact" width="full" icon={<CalendarDays />}>
      Infinite week rows with the weekly summary column, drag &amp; drop, quick-add and the month ⇄ week ⇄ day zoom.
    </PlaceholderPage>
  );
}

export function CalendarMonthPage() {
  const { month } = monthApi.useParams();
  return (
    <PlaceholderPage title={formatMonthYearLong(month)} variant="compact" width="full" icon={<CalendarDays />} breadcrumb={[{ label: 'Calendar', link: { to: '/calendar' } }]}>
      The month view anchored to {formatMonthYearLong(month)}; infinite scroll continues both ways.
    </PlaceholderPage>
  );
}

export function CalendarWeekPage() {
  const { isoWeek } = weekApi.useParams();
  return (
    <PlaceholderPage title={formatIsoWeekLabel(isoWeek)} variant="compact" width="full" icon={<CalendarRange />} breadcrumb={[{ label: 'Calendar', link: { to: '/calendar' } }]}>
      Seven columns of full cards with step profiles, a day metrics row and the week summary header.
    </PlaceholderPage>
  );
}
