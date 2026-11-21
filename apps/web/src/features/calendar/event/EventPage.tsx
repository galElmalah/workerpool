/** PLACEHOLDER — replaced by the day/agenda engineer. Keep the export name. */
import { getRouteApi } from '@tanstack/react-router';
import { Flag } from 'lucide-react';
import { PlaceholderPage } from '@/shell/Placeholder';

const eventApi = getRouteApi('/_app/events/$id');

export function EventPage() {
  const { id } = eventApi.useParams();
  return (
    <PlaceholderPage title="Event" eyebrow={id} back={{ to: '/calendar' }} icon={<Flag />}>
      Priority, goal, countdown, taper plan and the linked result with a race report.
    </PlaceholderPage>
  );
}
