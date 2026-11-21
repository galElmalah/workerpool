/** PLACEHOLDER — replaced by the day/agenda engineer. Keep the export name. */
import { getRouteApi } from '@tanstack/react-router';
import { CalendarDays } from 'lucide-react';
import { formatDateLong } from '@/lib/format';
import { PlaceholderPage } from '@/shell/Placeholder';

const dayApi = getRouteApi('/_app/calendar/day/$date');

export function CalendarDayPage() {
  const { date } = dayApi.useParams();
  return (
    <PlaceholderPage title={formatDateLong(date)} eyebrow={date.slice(0, 4)} back={{ to: '/calendar' }} width="prose" icon={<CalendarDays />}>
      Every workout of the day at full width, markers, metrics entry, the day note and events.
    </PlaceholderPage>
  );
}
