/** Settings building blocks: setting rows, autosave status, two-step destructive button. */
import { useQuery } from '@tanstack/react-query';
import type { Settings } from '@cadence/core/domain';
import { TriangleAlert } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, call } from '@/lib/api';
import { cn } from '@/lib/cn';
import { qk } from '@/lib/query';
import { useUpdateSettings } from '@/lib/queries/shared';
import { spring, tween } from '@/motion/tokens';
import { Button, type ButtonProps } from '@/ui/Button';
import type { SaveStatus } from '@/ui/SaveIndicator';

export function Row({ title, description, children, className, stack }: { title: ReactNode; description?: ReactNode; children?: ReactNode; className?: string; stack?: boolean }) {
  return (
    <div className={cn('flex flex-col gap-3 py-5 first:pt-0 last:pb-0', !stack && 'sm:flex-row sm:items-center sm:justify-between sm:gap-8', className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-body text-fg-1">{title}</span>
        {description && <span className="max-w-[46ch] text-body-sm text-fg-3">{description}</span>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

export function Rows({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-line-1">{children}</div>;
}

export function InlineError({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div role="alert" className="flex items-start justify-between gap-3 rounded-md bg-surface-1 px-3 py-2.5 text-body-sm text-fg-1">
      <span className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
        {children}
      </span>
      {action}
    </div>
  );
}

/** Settings autosave with a status for the Saved tick. */
export function useSettingsSaver(): { save: (patch: Partial<Settings>) => Promise<void>; status: SaveStatus } {
  const m = useUpdateSettings();
  const [status, setStatus] = useState<SaveStatus>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const save = async (patch: Partial<Settings>) => {
    clearTimeout(timer.current);
    setStatus('saving');
    try {
      await m.mutateAsync(patch);
      setStatus('saved');
      timer.current = setTimeout(() => setStatus('idle'), 2400);
    } catch {
      setStatus('error');
    }
  };
  return { save, status };
}

/** The API's notion of today (athlete timezone; demo clock in demo mode). */
export function useApiToday(): string | undefined {
  return useQuery({ queryKey: qk.thresholds.current, queryFn: () => call(api.thresholds.current.$get()), staleTime: 60_000 }).data?.date;
}

/**
 * Destructive action without a modal: first press arms it ("Confirm disconnect"), a second press
 * within 4 s runs it. Escape / blur / timeout disarm.
 */
export function TwoStepButton({ label, confirmLabel, onConfirm, icon, loading, size = 'md', disabled }: { label: string; confirmLabel: string; onConfirm: () => void; icon?: ReactNode; loading?: boolean; size?: ButtonProps['size']; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <div className="flex items-center gap-2">
      <AnimatePresence initial={false}>
        {armed && (
          <motion.span key="cancel" initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, transition: tween('fast', 'in') }} transition={spring.snappy}>
            <Button variant="ghost" size={size} onClick={() => setArmed(false)}>
              Cancel
            </Button>
          </motion.span>
        )}
      </AnimatePresence>
      <motion.span layout transition={spring.snappy}>
        <Button
          variant="danger"
          size={size}
          icon={icon}
          loading={loading}
          disabled={disabled}
          onKeyDown={(e) => e.key === 'Escape' && setArmed(false)}
          onClick={() => {
            if (armed) {
              setArmed(false);
              onConfirm();
            } else setArmed(true);
          }}
          className={armed ? '!bg-surface-active' : undefined}
        >
          {armed ? confirmLabel : label}
        </Button>
      </motion.span>
    </div>
  );
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
export function relativeTime(iso: string | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const diff = (Date.parse(iso) - now) / 1000;
  const a = Math.abs(diff);
  if (a < 45) return 'just now';
  if (a < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

export function formatClock(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}
export function formatStamp(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}
