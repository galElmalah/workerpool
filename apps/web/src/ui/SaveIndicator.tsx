/**
 * SaveIndicator — the autosave status that morphs "Saving…" → "Saved ✓" (check draws in with
 * snappy) and quietly fades back. Pair with `useAutosave` for edit-in-place pages.
 *
 *   const status = useAutosave(draft, (v) => api.patch(v), { delay: 600 });
 *   <SaveIndicator status={status} />
 */
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { spring, tween } from '@/motion/tokens';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function SaveIndicator({ status, className, errorText = "Couldn't save" }: { status: SaveStatus; className?: string; errorText?: string }) {
  return (
    <span className={cn('inline-flex h-5 items-center text-label', className)} role="status" aria-live="polite">
      <AnimatePresence mode="popLayout" initial={false}>
        {status === 'saving' && (
          <motion.span key="saving" layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4, transition: tween('fast', 'in') }} transition={spring.snappy} className="inline-flex items-center gap-1.5 text-fg-3">
            <span className="size-1.5 rounded-full bg-fg-3 animate-dot-pulse" />
            Saving…
          </motion.span>
        )}
        {status === 'saved' && (
          <motion.span key="saved" layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: tween('base', 'in') }} transition={spring.snappy} className="inline-flex items-center gap-1 text-fg-2">
            <svg viewBox="0 0 12 12" className="size-3 text-accent-ink" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <motion.path d="M2.5 6.2 5 8.5l4.5-5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ ...spring.snappy, delay: 0.05 }} />
            </svg>
            Saved
          </motion.span>
        )}
        {status === 'error' && (
          <motion.span key="error" layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring.snappy} className="inline-flex items-center gap-1 text-fg-1 underline decoration-dashed underline-offset-3">
            {errorText}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/**
 * Debounced autosave: calls `save(value)` `delay` ms after the last change and reports the status.
 * "saved" relaxes to "idle" after 2.4s. Errors stay until the next change.
 * Only real changes after mount are saved: the mount value (and any value seen while
 * `enabled` is false, e.g. data arriving from the server) is the baseline, so StrictMode's
 * double-invoked effects or enabling the hook never send the initial value back.
 */
export function useAutosave<T>(value: T, save: (v: T) => Promise<unknown> | void, opts?: { delay?: number; enabled?: boolean }): SaveStatus {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const baseline = useRef(value);
  const saveRef = useRef(save);
  saveRef.current = save;
  const delay = opts?.delay ?? 600;
  const enabled = opts?.enabled ?? true;
  useEffect(() => {
    if (!enabled) {
      baseline.current = value;
      return;
    }
    if (Object.is(value, baseline.current)) return;
    let cancelled = false;
    let relax: ReturnType<typeof setTimeout> | undefined;
    const t = setTimeout(async () => {
      baseline.current = value;
      setStatus('saving');
      try {
        await saveRef.current(value);
        if (cancelled) return;
        setStatus('saved');
        relax = setTimeout(() => !cancelled && setStatus('idle'), 2400);
      } catch {
        if (!cancelled) setStatus('error');
      }
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(t);
      if (relax) clearTimeout(relax);
    };
  }, [value, delay, enabled]);
  return status;
}
