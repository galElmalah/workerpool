/**
 * PLACEHOLDER — the week agent replaces this file. Contract: named export WeekPage.
 */
import { getRouteApi } from '@tanstack/react-router';
import { CalendarCheck } from 'lucide-react';
import { formatIsoWeekRange } from '@/lib/format';
import { PlaceholderPage } from '@/shell/Placeholder';

const api = getRouteApi('/_app/week/$isoWeek');

export function WeekPage() {
  const { isoWeek } = api.useParams();
  return (
    <PlaceholderPage title={`Week ${Number(isoWeek.slice(6))}`} eyebrow={formatIsoWeekRange(isoWeek, true)} back={{ to: '/calendar' }} icon={<CalendarCheck />}>
      Plan vs actual, key sessions, load vs target, form at week end, the reflection and “plan next week”.
    </PlaceholderPage>
  );
}
