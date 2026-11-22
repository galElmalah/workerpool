/**
 * Calendar furniture for the daily views: event banners, the inline day-marker editor and the
 * inline "new event" form. Used by the day, season and event pages.
 */
import { DAY_MARKER_TYPES, type DayMarker, type Event, type LocalDate } from '@cadence/core/domain';
import { addDays } from '@cadence/core/time';
import { Link, useNavigate } from '@tanstack/react-router';
import { Flag, HeartPulse, Mountain, Moon, Palmtree, Plane, Plus, Thermometer, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { distanceParts, formatDayMonth } from '@/lib/format';
import { useUnits } from '@/lib/units';
import { spring, tween } from '@/motion/tokens';
import { links } from '@/shell/links';
import { Button, DatePicker, Input, Segmented, toast } from '@/ui';
import { useEventMutations, useMarkerMutations } from './kit';

export const MARKER_META: Record<DayMarker['type'], { label: string; icon: ReactNode }> = {
  sick: { label: 'Sick', icon: <Thermometer /> },
  injured: { label: 'Injured', icon: <HeartPulse /> },
  travel: { label: 'Travel', icon: <Plane /> },
  vacation: { label: 'Vacation', icon: <Palmtree /> },
  rest: { label: 'Rest', icon: <Moon /> },
  altitude: { label: 'Altitude', icon: <Mountain /> },
};

/** Full-width event banner (product.md §3.7): A = solid accent, B = accent outline, C = neutral outline. */
export function EventBanner({ event, result, className }: { event: Event; result?: ReactNode; className?: string }) {
  const units = useUnits();
  const dist = event.distanceM ? distanceParts(event.distanceM, event.sport ?? 'run', units) : null;
  const a = event.priority === 'A';
  return (
    <Link
      {...links.event(event.id)}
      className={cn(
        'flex items-center gap-3 rounded-md px-4 outline-none transition-colors duration-(--dur-fast) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        a ? 'bg-accent py-3 text-on-accent hover:bg-accent-hover' : event.priority === 'B' ? 'border border-accent-a6 py-3 text-fg-1 hover:bg-accent-a1' : 'border border-line-3 py-2 text-fg-1 hover:bg-surface-2',
        className,
      )}
    >
      <Flag className={cn('size-4 shrink-0', a ? 'fill-current' : event.priority === 'B' ? 'text-accent-ink' : 'text-fg-2')} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn('text-micro uppercase', a ? 'text-on-accent opacity-75' : 'text-fg-3')}>
          {event.priority}-race{event.location ? ` · ${event.location}` : ''}
          {dist ? ` · ${dist.value} ${dist.unit}` : ''}
        </span>
        <span className="truncate text-body font-[600]">{event.name}</span>
      </span>
      {result ?? (event.goal && <span className={cn('max-sm:hidden text-body-sm', a ? 'opacity-80' : 'text-fg-2')}>Goal · {event.goal}</span>)}
    </Link>
  );
}

/** Markers covering `date` as removable chips + an inline, range-capable add form (no modal). */
export function MarkerEditor({ date, markers }: { date: LocalDate; markers: DayMarker[] }) {
  const { create, remove } = useMarkerMutations();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<DayMarker['type']>('sick');
  const [label, setLabel] = useState('');
  const [until, setUntil] = useState<LocalDate>(date);
  const covering = markers.filter((m) => m.date <= date && (m.endDate ?? m.date) >= date);

  const add = () => {
    create.mutate(
      { type, date, ...(until > date ? { endDate: until } : {}), ...(label.trim() ? { label: label.trim() } : {}) },
      {
        onSuccess: () => {
          setOpen(false);
          setLabel('');
          setUntil(date);
          toast.success(`Marked ${MARKER_META[type].label.toLowerCase()}${until > date ? ` until ${formatDayMonth(until)}` : ''}`);
        },
        onError: (e) => toast.error("Couldn't add the marker", { description: e instanceof Error ? e.message : undefined }),
      },
    );
  };
  const drop = (m: DayMarker) =>
    remove.mutate(m.id, {
      onSuccess: () => {
        const { id: _id, ...rest } = m;
        toast.undo(<>Removed <b>{MARKER_META[m.type].label}</b> marker</>, () => create.mutate(rest));
      },
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <AnimatePresence initial={false}>
          {covering.map((m) => (
            <motion.span
              key={m.id}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, transition: tween('fast', 'in') }}
              transition={spring.smooth}
              className={cn(
                'inline-flex h-8 items-center gap-2 rounded-md border pr-1 pl-2.5 text-label text-fg-1 [&_svg]:size-3.5',
                m.type === 'sick' || m.type === 'injured' ? 'border-fg-3 bg-hatch-faint' : 'border-line-3 bg-surface-2',
              )}
            >
              {MARKER_META[m.type].icon}
              {MARKER_META[m.type].label}
              {m.label && <span className="text-fg-2">· {m.label}</span>}
              {m.endDate && <span className="font-mono text-mono-sm text-fg-3">{formatDayMonth(m.date)}–{formatDayMonth(m.endDate)}</span>}
              <button type="button" aria-label={`Remove ${MARKER_META[m.type].label} marker`} onClick={() => drop(m)} className="grid size-6 place-items-center rounded-sm text-fg-3 outline-none hover:bg-surface-3 hover:text-fg-1 focus-visible:outline-2 focus-visible:outline-focus">
                <X />
              </button>
            </motion.span>
          ))}
        </AnimatePresence>
        {!open && (
          <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setOpen(true)}>
            {covering.length ? 'Marker' : 'Mark sick, travel, rest…'}
          </Button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="form"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0, transition: tween('fast', 'in') }}
            transition={spring.smooth}
            className="overflow-hidden"
          >
            <form
              className="flex flex-col gap-3 rounded-lg border border-line-2 bg-surface-1 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                add();
              }}
            >
              <div role="radiogroup" aria-label="Marker type" className="flex flex-wrap gap-1.5">
                {DAY_MARKER_TYPES.map((t) => (
                  <motion.button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={type === t}
                    whileTap={{ scale: 0.96 }}
                    transition={spring.snappy}
                    onClick={() => setType(t)}
                    className={cn(
                      'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-label outline-none transition-colors duration-(--dur-fast) focus-visible:outline-2 focus-visible:outline-focus pointer-coarse:h-10 [&_svg]:size-3.5',
                      type === t ? 'border-fg-2 bg-surface-3 text-fg-1' : 'border-line-2 text-fg-2 hover:text-fg-1',
                    )}
                  >
                    {MARKER_META[t].icon}
                    {MARKER_META[t].label}
                  </motion.button>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
                <Input aria-label="Marker label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={type === 'travel' ? 'Where? (e.g. Lisbon)' : 'Label (optional)'} />
                <DatePicker hideLabel label="Until" value={until} min={date} onValueChange={setUntil} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-body-sm text-fg-3">
                  {until > date ? `${formatDayMonth(date)} → ${formatDayMonth(until)}` : 'Just this day'}
                  {(type === 'sick' || type === 'injured') && ' · planned sessions become excused'}
                </span>
                <span className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" variant="secondary" type="submit" loading={create.isPending}>
                    Add marker
                  </Button>
                </span>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Inline "new event" form; on create it opens the event page to fill in the details. */
export function NewEventForm({ date, onDone, className }: { date: LocalDate; onDone?: () => void; className?: string }) {
  const { create } = useEventMutations();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [priority, setPriority] = useState<'A' | 'B' | 'C'>('B');
  const [d, setD] = useState<LocalDate>(date);
  return (
    <form
      className={cn('flex flex-col gap-3 rounded-lg border border-line-2 bg-surface-1 p-3', className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        create.mutate(
          { name: name.trim(), priority, date: d },
          {
            onSuccess: (ev) => {
              onDone?.();
              toast.success(<>Added <b>{ev.name}</b></>);
              void navigate(links.event(ev.id));
            },
            onError: (err) => toast.error("Couldn't add the event", { description: err instanceof Error ? err.message : undefined }),
          },
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_180px]">
        <Input aria-label="Event name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Race or event name" />
        <Segmented aria-label="Priority" value={priority} onValueChange={setPriority} options={[{ value: 'A', label: 'A' }, { value: 'B', label: 'B' }, { value: 'C', label: 'C' }]} />
        <DatePicker hideLabel label="Date" value={d} min={addDays(date, -3650)} onValueChange={setD} />
      </div>
      <div className="flex justify-end gap-2">
        {onDone && (
          <Button size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
        <Button size="sm" type="submit" variant="secondary" icon={<Flag />} loading={create.isPending} disabled={!name.trim()}>
          Create event
        </Button>
      </div>
    </form>
  );
}
