/**
 * PLACEHOLDER — the today agent replaces this file. Contract: named export TodayPage.
 */
import { Sunrise } from 'lucide-react';
import { formatDateLong } from '@/lib/format';
import { useToday } from '@/lib/hooks/useToday';
import { PlaceholderPage } from '@/shell/Placeholder';

export function TodayPage() {
  const today = useToday();
  return (
    <PlaceholderPage title="Today" eyebrow={formatDateLong(today)} icon={<Sunrise />}>
      Readiness strip, today’s workouts, the morning check-in, this week at a glance and the next event.
    </PlaceholderPage>
  );
}
