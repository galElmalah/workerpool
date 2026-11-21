import { todayIn } from '@cadence/core/time';
import { useEffect, useState } from 'react';

/** Today's LocalDate in the browser's timezone (or `timezone` when given). */
export function localToday(timezone?: string): string {
  return todayIn(timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
}

/** Re-renders at local midnight so "today" highlights flip on time. */
export function useToday(timezone?: string): string {
  const [today, setToday] = useState(() => localToday(timezone));
  useEffect(() => {
    const id = setInterval(() => {
      const t = localToday(timezone);
      setToday((prev) => (prev === t ? prev : t));
    }, 60_000);
    return () => clearInterval(id);
  }, [timezone]);
  return today;
}
