/**
 * "Importing history" note for the calendar header. While a Garmin history import runs (right
 * after onboarding, or one started in Settings → Garmin) the calendar is still filling in: older
 * weeks are empty only because their activities have not arrived yet. This says so, calmly, and
 * counts up live (the Garmin status polls every few seconds during an import, and the training
 * views refresh with it — see `useGarminStatusSync`).
 */
import { Link } from '@tanstack/react-router';
import { AnimatePresence, motion } from 'motion/react';
import { formatDateMedium, formatNumber } from '@/lib/format';
import { useGarminStatus } from '@/lib/queries/shared';
import { spring, tween } from '@/motion/tokens';
import { Tooltip } from '@/ui/Tooltip';

export function ImportNote() {
  const { data } = useGarminStatus();
  const bf = data?.backfill;
  const running = !!bf?.running;
  const total = bf?.total ?? null;
  const done = bf?.done ?? 0;
  const frac = total ? Math.min(1, done / Math.max(1, total)) : 0.04;
  const since = data?.counts.oldestGarminDate;
  const detail = `Your Garmin history is still arriving${since ? ` (back to ${formatDateMedium(since, true)} so far)` : ''}. Earlier weeks fill in as activities land.`;
  return (
    <AnimatePresence initial={false}>
      {running && (
        <motion.div
          key="import"
          initial={{ opacity: 0, x: 6 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, transition: tween('fast', 'in') }}
          transition={spring.smooth}
          className="flex"
        >
          <Tooltip content={detail} side="bottom">
            <Link
              to="/settings/garmin"
              role="status"
              aria-label={`Importing history${total ? `: ${done} of ${total} activities` : ''}`}
              className="flex h-8 items-center gap-2.5 rounded-md px-2 text-body-sm text-fg-2 transition-colors duration-(--dur-fast) hover:bg-surface-1 hover:text-fg-1"
            >
              <span className="max-md:hidden">Importing history</span>
              {total ? (
                <span className="num whitespace-nowrap">
                  <span className="text-fg-1">{formatNumber(done)}</span>
                  <span className="text-fg-3"> / {formatNumber(total)}</span>
                </span>
              ) : (
                <span className="text-fg-3 md:hidden">Importing…</span>
              )}
              <span aria-hidden className="relative h-1 w-10 overflow-hidden rounded-full bg-surface-3 md:w-14">
                <motion.span className="absolute inset-0 origin-left rounded-full bg-fg-2" initial={false} animate={{ scaleX: frac }} transition={spring.gentle} />
              </span>
            </Link>
          </Tooltip>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
