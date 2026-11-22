/**
 * Bulk planning pickers (small popovers anchored to the week summary — never modals):
 *   Copy week to…  target week + progression % (−40…+20) with a ghost preview, undo deletes copies
 *   Shift plan     ±N days from a date; completed items never move; undo restores originals
 * And the docked multi-select actions bar.
 */
import { Popover as BasePopover } from '@base-ui/react/popover';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Star, Trash2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import type { CalendarResponse, PlannedWorkout } from '@cadence/core/domain';
import { addDays, addWeeks, isoWeekStart } from '@cadence/core/time';
import { api, call } from '@/lib/api';
import { formatDayShort, formatDuration, formatIsoWeek, formatIsoWeekRange, MINUS } from '@/lib/format';
import { invalidateTraining, qk } from '@/lib/query';
import { useRestoreWorkouts, type CalendarCard } from '@/lib/queries/training';
import { spring, tween } from '@/motion/tokens';
import { Button, IconButton } from '@/ui/Button';
import { Slider } from '@/ui/Slider';
import { toast } from '@/ui/toast';
import type { CardActions } from './actions';
import type { CalendarModel } from './data';
import { calStore, useCal } from './store';

export type BulkState = { kind: 'copy'; isoWeek: string; anchor: HTMLElement } | { kind: 'shift'; from: string; anchor: HTMLElement } | null;

function Shell({ anchor, onClose, children, title }: { anchor: HTMLElement; onClose: () => void; children: React.ReactNode; title: string }) {
  return (
    <BasePopover.Root open onOpenChange={(o) => !o && onClose()}>
      <BasePopover.Portal>
        <BasePopover.Positioner anchor={anchor} side="left" align="start" sideOffset={8} collisionPadding={12} className="z-(--z-popover)">
          <BasePopover.Popup className="ui-popup w-72 max-w-80 rounded-lg p-4" initialFocus>
            <BasePopover.Title className="pb-3 text-body-sm font-medium text-fg-1">{title}</BasePopover.Title>
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}

function Stepper({ label, onPrev, onNext }: { label: React.ReactNode; onPrev: () => void; onNext: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-surface-2 p-0.5">
      <IconButton label="Earlier" icon={<ChevronLeft />} size="sm" tooltip={false} onClick={onPrev} />
      <span className="min-w-0 truncate text-center text-body text-fg-1">{label}</span>
      <IconButton label="Later" icon={<ChevronRight />} size="sm" tooltip={false} onClick={onNext} />
    </div>
  );
}

export function CopyWeekPopover({ isoWeek, anchor, model, actions, onClose }: { isoWeek: string; anchor: HTMLElement; model: CalendarModel; actions: CardActions; onClose: () => void }) {
  const [offset, setOffset] = useState(1);
  const [pct, setPct] = useState(0);
  const [busy, setBusy] = useState(false);
  const target = addWeeks(isoWeek, offset);
  const src = model.getWeek(isoWeekStart(isoWeek));
  const planned = src.days.flatMap((d) => d.cards.filter((c) => c.workout)).map((c) => c.workout!);
  const sec = planned.reduce((a, w) => a + (w.plannedDurationSec ?? 0), 0);
  const apply = () => {
    setBusy(true);
    call(api.calendar['copy-week'].$post({ json: { fromWeek: isoWeek, toWeek: target, progressionPct: pct } }))
      .then((res) => {
        const ids = (res.created as PlannedWorkout[]).map((w) => w.id);
        void invalidateTraining();
        toast.undo(
          <>
            Copied <b>{ids.length} workouts</b> to {formatIsoWeek(target)}
            {pct ? ` (${pct > 0 ? '+' : MINUS}${Math.abs(pct)}%)` : ''}
          </>,
          () => actions.deleteIds(ids),
        );
        onClose();
      })
      .catch((e: Error) => {
        setBusy(false);
        toast.error(`Couldn't copy: ${e.message}`);
      });
  };
  return (
    <Shell anchor={anchor} onClose={onClose} title={`Copy ${formatIsoWeek(isoWeek)} to…`}>
      <div className="flex flex-col gap-3">
        <Stepper
          label={
            <>
              <span className="font-medium">{formatIsoWeek(target)}</span> <span className="text-fg-3">· {formatIsoWeekRange(target)}</span>
            </>
          }
          onPrev={() => setOffset((o) => (o - 1 === 0 ? -1 : o - 1))}
          onNext={() => setOffset((o) => (o + 1 === 0 ? 1 : o + 1))}
        />
        <Slider
          label="Progression"
          valueLabel={<span className="text-label num">{pct > 0 ? '+' : pct < 0 ? MINUS : '±'}{Math.abs(pct)}%</span>}
          value={pct}
          onValueChange={setPct}
          min={-40}
          max={20}
          step={5}
          ticks
          aria-label="Progression percent"
        />
        <div className="flex items-center gap-1.5 rounded-md bg-surface-2 px-2.5 py-2 text-body-sm text-fg-2 num">
          <span className="text-fg-1">{planned.length}</span>
          <span className="font-sans text-fg-3">workouts</span>
          <span className="ml-auto text-fg-3">{formatDuration(sec)} →</span>
          <span className="text-fg-1">{formatDuration(sec * (1 + pct / 100))}</span>
          <span className="font-sans text-fg-3">h</span>
        </div>
        <Button variant="primary" size="sm" onClick={apply} loading={busy} disabled={!planned.length}>
          Copy to {formatIsoWeek(target)}
        </Button>
      </div>
    </Shell>
  );
}

export function ShiftPopover({ from, anchor, onClose }: { from: string; anchor: HTMLElement; onClose: () => void }) {
  const [days, setDays] = useState(1);
  const [busy, setBusy] = useState(false);
  const restore = useRestoreWorkouts();
  const qc = useQueryClient();
  const apply = () => {
    setBusy(true);
    // optimistic: slide every not-completed planned workout from `from`
    qc.setQueriesData<CalendarResponse>({ queryKey: qk.calendar.all }, (cal) =>
      cal ? { ...cal, workouts: cal.workouts.map((w) => (w.date >= from && !w.pairedActivityId ? { ...w, date: addDays(w.date, days) } : w)) } : cal,
    );
    call(api.calendar.shift.$post({ json: { fromDate: from, days } }))
      .then((res) => {
        void invalidateTraining();
        const prev = res.previous as PlannedWorkout[];
        toast.undo(
          <>
            Shifted <b>{prev.length} workouts</b> by {days > 0 ? '+' : MINUS}
            {Math.abs(days)} day{Math.abs(days) === 1 ? '' : 's'}
          </>,
          () => restore.mutate(prev),
        );
        onClose();
      })
      .catch((e: Error) => {
        void invalidateTraining();
        setBusy(false);
        toast.error(`Couldn't shift: ${e.message}`);
      });
  };
  return (
    <Shell anchor={anchor} onClose={onClose} title="Shift plan">
      <div className="flex flex-col gap-3">
        <p className="text-body-sm text-fg-2">
          Everything planned from <b className="text-fg-1">{formatDayShort(from)}</b> on moves. Completed work stays.
        </p>
        <Stepper
          label={
            <span className="font-medium num">
              {days > 0 ? '+' : MINUS}
              {Math.abs(days)} day{Math.abs(days) === 1 ? '' : 's'}
            </span>
          }
          onPrev={() => setDays((d) => (d - 1 === 0 ? -1 : Math.max(-14, d - 1)))}
          onNext={() => setDays((d) => (d + 1 === 0 ? 1 : Math.min(14, d + 1)))}
        />
        <Button variant="primary" size="sm" onClick={apply} loading={busy}>
          Shift plan
        </Button>
      </div>
    </Shell>
  );
}

export function SelectionBar({ model, actions }: { model: CalendarModel; actions: CardActions }) {
  const selection = useCal((s) => s.selection);
  const cards = [...selection].map((k) => model.findCard(k)).filter((x): x is { card: CalendarCard; date: string } => !!x);
  const clear = () => calStore.set({ selection: new Set() });
  const shift = (n: number) => {
    for (const { card, date } of cards) actions.move(card, addDays(date, n), { silent: true });
    toast(`Moved ${cards.filter((c) => c.card.draggable).length} workouts ${n > 0 ? 'later' : 'earlier'} by a day`);
  };
  return (
    <AnimatePresence>
      {selection.size > 0 && (
        <motion.div
          role="toolbar"
          aria-label="Selected workouts"
          initial={{ y: 24, opacity: 0, x: '-50%' }}
          animate={{ y: 0, opacity: 1, x: '-50%' }}
          exit={{ y: 16, opacity: 0, x: '-50%', transition: tween('fast', 'in') }}
          transition={spring.smooth}
          className="fixed bottom-[calc(var(--bottom-bar-h)+1.5rem)] left-[calc(50%+var(--rail-w)/2)] z-(--z-popover) flex items-center gap-1 rounded-lg bg-surface-3 p-1 pl-3"
        >
          <span className="pr-2 text-label text-fg-1">
            <span className="">{selection.size}</span> selected
          </span>
          <Button size="sm" variant="ghost" icon={<ArrowLeft />} onClick={() => shift(-1)}>
            Day
          </Button>
          <Button size="sm" variant="ghost" iconRight={<ArrowRight />} onClick={() => shift(1)}>
            Day
          </Button>
          <Button size="sm" variant="ghost" icon={<Star />} onClick={() => cards.forEach((c) => !c.card.model.isKey && actions.toggleKey(c.card))}>
            Key
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 />}
            onClick={() => {
              actions.remove(cards.map((c) => c.card));
              clear();
            }}
          >
            Delete
          </Button>
          <span className="mx-1 h-5 w-px bg-line-2" />
          <IconButton label="Clear selection" icon={<X />} size="sm" kbd="esc" onClick={clear} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
