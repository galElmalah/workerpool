/**
 * PLACEHOLDER — the calendar agent replaces this file. Contract (src/shell/README.md):
 * named exports CalendarPage, CalendarMonthPage, CalendarWeekPage, CalendarDayPage, AgendaPage,
 * SeasonPage, EventPage.
 */
import { getRouteApi } from '@tanstack/react-router';
import { CalendarDays, CalendarRange, Flag, ListTodo, Mountain } from 'lucide-react';
import { formatDateLong, formatIsoWeekLabel, formatMonthYearLong } from '@/lib/format';
import { PlaceholderPage } from '@/shell/Placeholder';

const weekApi = getRouteApi('/_app/calendar/week/$isoWeek');
const dayApi = getRouteApi('/_app/calendar/day/$date');
const monthApi = getRouteApi('/_app/calendar/month/$month');
const eventApi = getRouteApi('/_app/events/$id');

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

export function CalendarDayPage() {
  const { date } = dayApi.useParams();
  return (
    <PlaceholderPage title={formatDateLong(date)} eyebrow={date.slice(0, 4)} back={{ to: '/calendar' }} width="prose" icon={<CalendarDays />}>
      Every workout of the day at full width, markers, metrics entry, the day note and events.
    </PlaceholderPage>
  );
}

export function AgendaPage() {
  return (
    <PlaceholderPage title="Agenda" variant="compact" width="prose" icon={<ListTodo />} breadcrumb={[{ label: 'Calendar', link: { to: '/calendar' } }]}>
      Day groups with sticky headers; past days collapse to one summary line, today and the future stay open.
    </PlaceholderPage>
  );
}

export function SeasonPage() {
  return (
    <PlaceholderPage title="Season" eyebrow="Planner" icon={<Mountain />}>
      A year grid of weeks with phase bands, events, weekly load targets and projected fitness.
    </PlaceholderPage>
  );
}

export function EventPage() {
  const { id } = eventApi.useParams();
  return (
    <PlaceholderPage title="Event" eyebrow={id} back={{ to: '/calendar' }} icon={<Flag />}>
      Priority, goal, countdown, taper plan and the linked result with a race report.
    </PlaceholderPage>
  );
}
