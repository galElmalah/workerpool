import type { LocalDate } from '@cadence/core/domain';
import { todayIn } from '@cadence/core/time';
import { getSettings } from '../db/settings';

/** "Today" in the athlete's timezone (settings.timezone). */
export async function getToday(env: Env): Promise<LocalDate> {
  const settings = await getSettings(env.DB);
  return todayIn(settings.timezone);
}
