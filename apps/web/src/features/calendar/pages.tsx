/**
 * Calendar routes (src/shell/README.md). The day / agenda / season / event pages belong to the
 * day & agenda engineer and are re-exported unchanged.
 */
export { CalendarDayPage } from './day/DayPage';
export { AgendaPage } from './agenda/AgendaPage';
export { SeasonPage } from './season/SeasonPage';
export { EventPage } from './event/EventPage';

import { getRouteApi } from '@tanstack/react-router';
import { MonthView } from './month/MonthView';
import { WeekView } from './week/WeekView';

const calendarApi = getRouteApi('/_app/calendar');
const weekApi = getRouteApi('/_app/calendar/week/$isoWeek');
const monthApi = getRouteApi('/_app/calendar/month/$month');

/** /calendar?date= — the infinite month view anchored on `date` (default: today from the API). */
export function CalendarPage() {
  const { date } = calendarApi.useSearch();
  return <MonthView anchor={date} />;
}

/** /calendar/month/$month — the same infinite view, anchored on the 1st of the month. */
export function CalendarMonthPage() {
  const { month } = monthApi.useParams();
  return <MonthView anchor={`${month}-01`} />;
}

/** /calendar/week/$isoWeek — seven columns of full cards. */
export function CalendarWeekPage() {
  const { isoWeek } = weekApi.useParams();
  return <WeekView isoWeek={isoWeek} />;
}
