/**
 * One calendar card: the shared WorkoutCard face inside a focusable, draggable shell. Shift/⌘-click
 * selects, click → shared-element morph into the workout / activity page, hover or keyboard focus
 * opens the hover card (Peek) with everything the one-line chip leaves out. Card actions live in the
 * context menu and the keyboard model (no hover toolbar: DESIGN_V2 rule 2).
 */
import { useDraggable } from '@dnd-kit/core';
import { memo, useMemo, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import type { CalendarCard } from '@/lib/queries/training';
import { useIsMorphTarget, vt, vtName } from '@/motion/morph';
import { sportVars } from '@/ui/domain/dataColor';
import { SportGlyph } from '@/ui/domain/SportGlyph';
import { cardTone, WorkoutCard, type CardDensity } from '@/ui/domain/WorkoutCard';
import type { CardActions } from './actions';
import { usePeekTrigger } from './Peek';
import { calStore, useCal } from './store';

export type CalDensity = CardDensity | 'mini';

export interface CardItemProps {
  card: CalendarCard;
  date: string;
  density: CalDensity;
  actions: CardActions;
  /** Carry `w-<id>` (class cal-item) for the zoom view transition. */
  zoomName?: boolean;
  /** Extra node under the card face. */
  trailing?: ReactNode;
  /** @deprecated Cards never show a sparkline in the calendar now; kept for API compatibility. */
  hideSpark?: boolean;
}

/** Phone month view: glyph + short duration on one 24px row. */
function MiniChip({ card, style }: { card: CalendarCard; style?: CSSProperties }) {
  const m = card.model;
  const on = useIsMorphTarget(m.id);
  const state = m.compliance?.state ?? (m.kind === 'activity' ? 'unplanned' : 'planned');
  const t = cardTone(state);
  return (
    <div
      className={cn('relative flex h-6 min-w-0 items-center justify-center gap-0.5 overflow-hidden rounded-sm px-0.5', t.fill)}
      style={{ ...sportVars(m.sport), ...style, ...vt(on, 'card') }}
      data-morph-id={m.id}
      aria-label={`${m.title}, ${formatDuration(m.durationSec, 'short')}`}
    >
      <SportGlyph sport={m.sport} size={14} neutral={t.neutralGlyph} className={cn('shrink-0', t.glyph)} style={vt(on, 'glyph')} />
      <span className={cn('truncate text-label num max-[360px]:hidden', t.meta, m.isKey && 'font-semibold text-fg-1')}>
        {m.durationSec && m.durationSec >= 3600 ? `${Math.round(m.durationSec / 3600)}h` : formatDuration(m.durationSec).replace(/^0:/, ':')}
      </span>
    </div>
  );
}

/**
 * The draggable / focusable shell. dnd-kit re-renders every hook consumer whenever a draggable
 * or droppable registers (i.e. every time a virtual row mounts), so the hook lives here and the
 * card face arrives as a memoized `children` element that React can skip.
 */
const DragShell = memo(function DragShell({
  card,
  date,
  actions,
  rounded,
  children,
}: {
  card: CalendarCard;
  date: string;
  actions: CardActions;
  rounded: string;
  children: ReactNode;
}) {
  const focused = useCal((s) => s.cardKey === card.key);
  const selected = useCal((s) => s.selection.has(card.key));
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: card.key, disabled: !card.draggable, data: { dayId: date } });
  const peek = usePeekTrigger({ kind: 'card', key: card.key });
  const onClick = (e: MouseEvent) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      e.preventDefault();
      calStore.set((s) => {
        const next = new Set(s.selection);
        if (next.has(card.key)) next.delete(card.key);
        else next.add(card.key);
        return { selection: next, cardKey: card.key, cursor: date };
      });
      return;
    }
    actions.open(card);
  };
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      role="link"
      tabIndex={focused ? 0 : -1}
      aria-roledescription={card.draggable ? 'draggable workout' : undefined}
      aria-label={`${card.model.title}${card.model.isKey ? ', key' : ''}`}
      aria-selected={selected || undefined}
      data-dragging={isDragging || undefined}
      data-selected={selected || undefined}
      onClick={onClick}
      onPointerEnter={peek.onPointerEnter}
      onPointerLeave={peek.onPointerLeave}
      onPointerDown={(e) => {
        peek.onPointerDown();
        listeners?.onPointerDown?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          actions.open(card);
          return;
        }
        listeners?.onKeyDown?.(e);
      }}
      onFocus={(e) => {
        if (calStore.get().cardKey !== card.key) calStore.set({ cardKey: card.key, cursor: date });
        peek.onFocus(e);
      }}
      onBlur={peek.onBlur}
      className={cn(
        'relative block outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-focus',
        rounded,
        card.draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        // selection: one surface step + a thin neutral outline (never accent)
        selected && 'outline-1 outline-solid -outline-offset-1 outline-line-3 [&_.face>*]:!bg-surface-3',
        isDragging && '[&>.face]:invisible',
      )}
    >
      {children}
      {/* where the card will land: the one accent-tinted slot (the drop indicator) */}
      {isDragging && <span className={cn('absolute inset-0 bg-accent-a3', rounded)} aria-hidden />}
    </div>
  );
});

export const CardItem = memo(function CardItem({ card, date, density, actions, zoomName, trailing }: CardItemProps) {
  const zoomStyle: CSSProperties | undefined = zoomName ? vtName(`w-${card.key}`, 'cal-item') : undefined;
  const face = useMemo(
    () => (
      <div className="face">
        {density === 'mini' ? (
          <MiniChip card={card} style={zoomStyle} />
        ) : (
          <WorkoutCard model={card.model} density={density} style={zoomStyle} hoverable className="w-full" trailing={trailing} />
        )}
      </div>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [card, density, zoomName, trailing],
  );

  return (
    <div className="relative" data-card={card.key}>
      <DragShell card={card} date={date} actions={actions} rounded={density === 'full' || density === 'compact' ? 'rounded-lg' : density === 'chip' ? 'rounded-md' : 'rounded-sm'}>
        {face}
      </DragShell>
    </div>
  );
});
