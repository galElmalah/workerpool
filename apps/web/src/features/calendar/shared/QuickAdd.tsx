/**
 * Inline quick-add composer (product.md §3.5 / §4.6): one text field in the day cell with a live
 * parsed preview chip. ↵ creates (optimistic, the card springs in), ⌘↵ creates and opens the
 * page, Esc cancels.
 */
import { useNavigate } from '@tanstack/react-router';
import { CornerDownLeft, Star } from 'lucide-react';
import { motion } from 'motion/react';
import { useMemo, useRef, useState } from 'react';
import { parseQuickAdd } from '@cadence/core/workout';
import { cn } from '@/lib/cn';
import { formatDistance, formatDuration } from '@/lib/format';
import { useUnits } from '@/lib/units';
import { morph } from '@/motion/morph';
import { spring } from '@/motion/tokens';
import { links } from '@/shell/links';
import { IntensityPips } from '@/ui/domain/Intensity';
import { SportGlyph } from '@/ui/domain/SportGlyph';
import { toast } from '@/ui/toast';
import type { CardActions } from './actions';
import { calStore } from './store';

export function QuickAdd({ date, actions, className }: { date: string; actions: CardActions; className?: string }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const units = useUnits();
  const navigate = useNavigate();
  const ref = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => (text.trim().length > 1 ? parseQuickAdd(text) : null), [text]);
  const close = () => calStore.set({ composer: null });
  const known = parsed && !parsed.issues.some((i) => i.severity === 'warning' && /Start with a sport/.test(i.message));

  const submit = (open: boolean) => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    const p = actions.quickAdd(date, t);
    setText('');
    if (!open) {
      setBusy(false);
      ref.current?.focus();
    }
    p.then((res) => {
      if (open) {
        close();
        morph.set(res.workout.id);
        void navigate(links.workout(res.workout.id));
      }
    }).catch((e: Error) => {
      setBusy(false);
      setText(t);
      toast.error(`Couldn't add: ${e.message}`);
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -4, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring.snappy}
      className={cn('flex flex-col gap-0.5 rounded-md border border-line-2 bg-surface-1 p-1', className)}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <input
        ref={ref}
        autoFocus
        value={text}
        disabled={busy && false}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            e.preventDefault();
            close();
            document.querySelector<HTMLElement>(`[data-day-cell="${date}"]`)?.focus();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            submit(e.metaKey || e.ctrlKey);
          }
        }}
        onBlur={() => !text.trim() && setTimeout(() => calStore.get().composer === date && close(), 120)}
        placeholder="run 45m easy"
        aria-label={`Quick add on ${date}. Enter creates, Command Enter opens, Escape cancels`}
        className="h-6 w-full min-w-0 bg-transparent px-1 text-body-sm text-fg-1 outline-none placeholder:text-fg-4"
      />
      <div className="flex h-5 min-w-0 items-center gap-1.5 px-1">
        {parsed ? (
          <>
            <SportGlyph sport={parsed.sport} size={14} className={known ? 'text-fg-1' : 'text-fg-4'} />
            <span className="min-w-0 flex-1 truncate text-label text-fg-2 num" title={parsed.title}>
              {parsed.durationSec ? formatDuration(parsed.durationSec) : parsed.distanceM ? formatDistance(parsed.distanceM, parsed.sport, units) : parsed.title}
            </span>
            {parsed.isKey && <Star className="size-2.5 shrink-0 fill-fg-2 text-fg-2" strokeWidth={1.5} aria-label="key" />}
            <IntensityPips intensity={parsed.intensity} />
          </>
        ) : (
          <span className="flex flex-1 items-center gap-1 truncate text-label text-fg-4">
            <CornerDownLeft className="size-3" /> add · ⌘↵ open
          </span>
        )}
      </div>
    </motion.div>
  );
}
