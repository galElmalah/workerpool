/**
 * Calendar drag & drop kit — design.md §5.4c: @dnd-kit/core + Motion, no @dnd-kit/sortable.
 *  - useCalendarDnd(): sensors (pointer 4px, touch long-press, keyboard by-day), collision
 *    detection (pointerWithin, rect fallback for keyboard), optimistic over/commit/revert
 *    callbacks, screen-reader announcements, and the drop "settle" handoff.
 *  - <DayDrop id>: droppable day; while hovered → accent-a2 wash + 1px accent-a5 inset ring.
 *  - <DragItem id>: draggable wrapper (render prop gets { dragging }).
 *  - <DragLift>: overlay content — lifts to scale 1.04, rotate −1.5° (snappy), glass.
 *  - <Settle id>: wraps a list item; when it lands after a drop it flies from the overlay's last
 *    rect into its slot with `bouncy` (FLIP, transform only). Instant under reduced motion.
 *
 *   const dnd = useCalendarDnd({ onOver: (id, day) => moveOptimistic(id, day), onDrop: commit, onCancel: revert,
 *                               describe: (id) => titleOf(id), dayLabel: (day) => formatDateLong(day) });
 *   <DndContext {...dnd.contextProps}>
 *     {days.map((d) => <DayDrop key={d} id={d}>
 *       {items[d].map((w) => <Settle key={w.id} id={w.id} layout={dnd.affected.has(d)}>
 *         <DragItem id={w.id}>{({ dragging }) => <WorkoutCard model={w} ghost={dragging} />}</DragItem>
 *       </Settle>)}
 *     </DayDrop>)}
 *     <DragOverlay {...dnd.overlayProps}>{dnd.activeId && <DragLift><WorkoutCard model={byId(dnd.activeId)} /></DragLift>}</DragOverlay>
 *   </DndContext>
 */
import {
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DndContextProps,
  type DragOverlayProps,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { animate, motion } from 'motion/react';
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { isReducedMotion } from '@/motion/prefs';
import { spring } from '@/motion/tokens';

// ───────────── keyboard: move between droppables by geometry ─────────────
/** Arrow keys jump to the nearest droppable (day) in that direction; Space/Enter drops. */
export const calendarKeyboardCoordinates: KeyboardCoordinateGetter = (event, { context, currentCoordinates }) => {
  const dirs: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };
  const d = dirs[event.code] ?? dirs[event.key];
  if (!d) return undefined;
  event.preventDefault();
  const rect = context.collisionRect;
  if (!rect) return undefined;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let best: { x: number; y: number; dist: number } | null = null;
  context.droppableRects.forEach((r, id) => {
    if (context.over?.id === id) return;
    const tx = r.left + r.width / 2;
    const ty = r.top + Math.min(r.height / 2, 40);
    const dx = tx - cx;
    const dy = ty - cy;
    const along = dx * d[0] + dy * d[1];
    if (along <= 4) return;
    const across = Math.abs(dx * d[1]) + Math.abs(dy * d[0]);
    const dist = along + across * 3;
    if (!best || dist < best.dist) best = { x: tx, y: ty, dist };
  });
  if (!best) return currentCoordinates;
  const b = best as { x: number; y: number };
  return { x: currentCoordinates.x + (b.x - cx), y: currentCoordinates.y + (b.y - cy) };
};

/** pointerWithin for pointers; rect intersection for keyboard drags (no pointer coordinates). */
export const calendarCollision: CollisionDetection = (args) => {
  if (args.pointerCoordinates) {
    const hits = pointerWithin(args);
    if (hits.length) return hits;
  }
  return rectIntersection(args);
};

export function useCalendarSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: calendarKeyboardCoordinates }),
  );
}

// ───────────── settle handoff ─────────────
const pendingSettle = new Map<string, { left: number; top: number }>();

/** Wrap each list item. `layout` enables neighbor reflow (only for days affected by the drag). */
export function Settle({ id, layout = false, children, className }: { id: string; layout?: boolean; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const from = pendingSettle.get(id);
    const el = ref.current;
    if (!from || !el) return;
    pendingSettle.delete(id);
    if (isReducedMotion()) return;
    const to = el.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    el.style.zIndex = '40';
    const c = animate(el, { x: [dx, 0], y: [dy, 0], scale: [1.04, 1], rotate: [-1.5, 0] }, spring.bouncy);
    void c.finished.then(() => {
      el.style.zIndex = '';
    });
  });
  return (
    <motion.div ref={ref} layout={layout ? 'position' : false} transition={spring.smooth} className={cn('relative', className)}>
      {children}
    </motion.div>
  );
}

// ───────────── the hook ─────────────
export interface CalendarDndOptions {
  /** Drag started (snapshot state here so cancel can revert). */
  onStart?: (id: string) => void;
  /** Optimistically move `id` into day `dayId` while hovering (neighbors reflow). */
  onOver?: (id: string, dayId: string) => void;
  /** Commit the move (show the undo toast here). */
  onDrop: (id: string, dayId: string) => void;
  /** Revert any optimistic move. */
  onCancel?: (id: string) => void;
  /** Title of an item for announcements ("Threshold 4×8"). */
  describe?: (id: string) => string;
  /** Spoken day label ("Thursday 20 November"). */
  dayLabel?: (dayId: string) => string;
}

export function useCalendarDnd(opts: CalendarDndOptions) {
  const sensors = useCalendarSensors();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [affected, setAffected] = useState<Set<string>>(new Set());
  const origin = useRef<string | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const name = (id: UniqueIdentifier) => optsRef.current.describe?.(String(id)) ?? 'Item';
  const day = (id: UniqueIdentifier | undefined) => (id == null ? '' : (optsRef.current.dayLabel?.(String(id)) ?? String(id)));

  const contextProps: Partial<DndContextProps> = useMemo(
    () => ({
      sensors,
      collisionDetection: calendarCollision,
      onDragStart: ({ active }) => {
        setActiveId(String(active.id));
        optsRef.current.onStart?.(String(active.id));
        origin.current = (active.data.current?.dayId as string | undefined) ?? null;
        setAffected(new Set(origin.current ? [origin.current] : []));
      },
      onDragOver: ({ active, over }) => {
        if (!over) return;
        setAffected((prev) => (prev.has(String(over.id)) ? prev : new Set([...prev, String(over.id)])));
        optsRef.current.onOver?.(String(active.id), String(over.id));
      },
      onDragEnd: ({ active, over }) => {
        const r = active.rect.current.translated;
        setActiveId(null);
        if (over) {
          if (r) pendingSettle.set(String(active.id), { left: r.left, top: r.top });
          optsRef.current.onDrop(String(active.id), String(over.id));
        } else optsRef.current.onCancel?.(String(active.id));
        setTimeout(() => setAffected(new Set()), 800);
      },
      onDragCancel: ({ active }) => {
        setActiveId(null);
        optsRef.current.onCancel?.(String(active.id));
        setTimeout(() => setAffected(new Set()), 800);
      },
      accessibility: {
        announcements: {
          onDragStart: ({ active }) => `Picked up ${name(active.id)}. Use arrow keys to move between days, Space to drop, Escape to cancel.`,
          onDragOver: ({ active, over }) => (over ? `${name(active.id)} is over ${day(over.id)}.` : undefined),
          onDragEnd: ({ active, over }) => (over ? `Moved ${name(active.id)} to ${day(over.id)}.` : `${name(active.id)} dropped.`),
          onDragCancel: ({ active }) => `Cancelled. ${name(active.id)} returned to its day.`,
        },
        screenReaderInstructions: { draggable: 'Press Space to pick up. Arrow keys move between days. Space drops, Escape cancels.' },
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sensors],
  );

  const overlayProps: Partial<DragOverlayProps> = { dropAnimation: null, zIndex: 40 };
  const isActive = useCallback((id: string) => activeId === id, [activeId]);
  return { activeId, affected, contextProps, overlayProps, isActive };
}

// ───────────── building blocks ─────────────
export function DayDrop({ id, children, className, data }: { id: string; children: ReactNode; className?: string; data?: Record<string, unknown> }) {
  const { setNodeRef, isOver } = useDroppable({ id, data });
  return (
    <div
      ref={setNodeRef}
      data-day={id}
      data-over={isOver || undefined}
      className={cn(
        'relative transition-[background-color,box-shadow] duration-(--dur-fast) ease-out',
        'data-[over]:bg-surface-2 data-[over]:ring-1 data-[over]:ring-line-3 data-[over]:ring-inset', // neutral drop target (no accent wash)
        className,
      )}
    >
      {children}
    </div>
  );
}

export function DragItem({
  id,
  dayId,
  disabled,
  children,
  className,
}: {
  id: string;
  /** The day this item currently sits in (lets the hook mark origin + target as affected). */
  dayId?: string;
  disabled?: boolean;
  children: (s: { dragging: boolean }) => ReactNode;
  className?: string;
}) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id, disabled, data: { dayId } });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={cn('touch-manipulation outline-none', className)}>
      {children({ dragging: isDragging })}
    </div>
  );
}

/** Overlay wrapper: lift + tilt with snappy; glass so it reads as floating. */
export function DragLift({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ scale: 1, rotate: 0 }}
      animate={{ scale: 1.04, rotate: -1.5 }}
      transition={spring.snappy}
      className={cn('glass cursor-grabbing rounded-md [will-change:transform]', className)}
    >
      {children}
    </motion.div>
  );
}
