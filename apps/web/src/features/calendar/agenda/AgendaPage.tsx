/** PLACEHOLDER — replaced by the day/agenda engineer. Keep the export name. */
import { ListTodo } from 'lucide-react';
import { PlaceholderPage } from '@/shell/Placeholder';

export function AgendaPage() {
  return (
    <PlaceholderPage title="Agenda" variant="compact" width="prose" icon={<ListTodo />} breadcrumb={[{ label: 'Calendar', link: { to: '/calendar' } }]}>
      Day groups with sticky headers; past days collapse to one summary line, today and the future stay open.
    </PlaceholderPage>
  );
}
