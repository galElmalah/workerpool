/**
 * Calendar drag & drop (design.md §5.4c) on top of the shared dnd kit: lift, ghost in the source,
 * live make-room reflow in the target day (a local preview, the cache is untouched until drop),
 * bouncy settle, optimistic move + undo toast. Alt-drag copies. Space picks up from the keyboard
 * (Enter stays "open").
 */
import { DragOverlay, type DragEndEvent, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors, type DragOverlayProps } from '@dnd-kit/core';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { formatDateLong } from '@/lib/format';
import type { CalendarCard } from '@/lib/queries/training';
import { calendarKeyboardCoordinates, DragLift, useCalendarDnd } from '@/ui/dnd';
import { WorkoutCard } from '@/ui/domain/WorkoutCard';
import type { CardActions } from './actions';
import type { CalDensity } from './CardItem';
import type { CalendarModel } from './data';
import { recordDrop } from './flip';
import { calStore, useCal } from './store';

export function useCalendarDrag(model: CalendarModel, actions: CardActions) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: calendarKeyboardCoordinates, keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] } }),
  );
  const alt = useRef(false);
  const modelRef = useRef(model);
  modelRef.current = model;
  useEffect(() => {
    const on = (e: KeyboardEvent | PointerEvent) => {
      if (alt.current === e.altKey) return;
      alt.current = e.altKey;
      const p = calStore.get().preview;
      if (p) calStore.set({ preview: { ...p, copy: e.altKey } });
    };
    window.addEventListener('keydown', on);
    window.addEventListener('keyup', on);
    window.addEventListener('pointermove', on, { passive: true });
    return () => {
      window.removeEventListener('keydown', on);
      window.removeEventListener('keyup', on);
      window.removeEventListener('pointermove', on);
    };
  }, []);
  const dnd = useCalendarDnd({
    onStart: (id) => {
      const f = modelRef.current.findCard(id);
      if (f) calStore.set({ preview: { key: id, from: f.date, to: f.date, copy: alt.current } });
    },
    onOver: (id, day) => {
      const p = calStore.get().preview;
      if (p && p.key === id && p.to !== day) calStore.set({ preview: { ...p, to: day } });
    },
    onDrop: (id, day) => {
      const p = calStore.get().preview;
      const f = modelRef.current.findCard(id);
      calStore.set({ preview: null });
      if (!f || !p || day === p.from) return;
      if (p.copy || alt.current) actions.duplicate(f.card, day);
      else actions.move(f.card, day);
    },
    onCancel: () => calStore.set({ preview: null }),
    describe: (id) => modelRef.current.findCard(id)?.card.model.title ?? 'workout',
    dayLabel: (d) => formatDateLong(d),
  });
  const preview = useCal((s) => s.preview);
  const previewCard = preview ? (model.findCard(preview.key)?.card ?? null) : null;
  const active = dnd.activeId ? (model.findCard(dnd.activeId)?.card ?? null) : null;
  const contextProps = {
    ...dnd.contextProps,
    onDragEnd: (e: DragEndEvent) => {
      const r = e.active.rect.current.translated;
      if (r && e.over) recordDrop(String(e.active.id), r);
      dnd.contextProps.onDragEnd?.(e);
    },
  };
  return { sensors, dnd: { ...dnd, contextProps }, preview, previewCard, active };
}

/** The lifted card, portaled to <body> so virtual-row transforms can't offset it. */
export function DragLayer({ active, density, copy, overlayProps }: { active: CalendarCard | null; density: CalDensity; copy: boolean; overlayProps: Partial<DragOverlayProps> }) {
  return createPortal(
    <DragOverlay {...overlayProps}>
      {active && (
        <DragLift className="relative">
          <WorkoutCard model={active.model} density={density === 'mini' || density === 'chip' ? 'chip' : density === 'full' ? 'full' : 'compact'} className="!bg-surface-3" />
          {copy && <span className="absolute -top-2 -right-2 flex size-5 items-center justify-center rounded-full bg-fg-1 text-label font-[600] text-canvas">+</span>}
        </DragLift>
      )}
    </DragOverlay>,
    document.body,
  );
}
