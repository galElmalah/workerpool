/**
 * One calendar card: the shared WorkoutCard inside a focusable, draggable shell with a hover
 * quick-actions row (floats over the card's top edge — no layout shift), Shift-click selection,
 * and click → shared-element morph into the workout / activity page.
 */
import { useDraggable } from '@dnd-kit/core';
import { ArrowUpRight, Copy, Star, Trash2, Watch } from 'lucide-react';
import { motion } from 'motion/react';
import { memo, useMemo, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { addDays } from '@cadence/core/time';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import type { CalendarCard } from '@/lib/queries/training';
import { useIsMorphTarget, vt, vtName } from '@/motion/morph';
import { tween } from '@/motion/tokens';
import { SportGlyph } from '@/ui/domain/SportGlyph';
import { WorkoutCard, type CardDensity } from '@/ui/domain/WorkoutCard';
import { ComplianceGlyph, complianceStyles } from '@/ui/domain/Compliance';
import { IntensityPips } from '@/ui/domain/Intensity';
import { KeyStar } from '@/ui/domain/KeyStar';
import { Tooltip } from '@/ui/Tooltip';
import type { CardActions } from './actions';
import { calStore, useCal } from './store';

export type CalDensity = CardDensity | 'mini';

export interface CardItemProps {
  card: CalendarCard;
  date: string;
  density: CalDensity;
  actions: CardActions;
  /** Carry `w-<id>` (class cal-item) for the zoom view transition. */
  zoomName?: boolean;
  /** Replace the card's own sparkline with a larger profile (week view). */
  trailing?: ReactNode;
  hideSpark?: boolean;
}

function MiniChip({ card }: { card: CalendarCard }) {
  const m = card.model;
  const on = useIsMorphTarget(m.id);
  const state = m.compliance?.state ?? (m.kind === 'activity' ? 'unplanned' : 'planned');
  const s = complianceStyles(state);
  return (
    <div
      className={cn('relative flex h-6 min-w-0 items-center justify-center gap-0.5 overflow-hidden rounded-xs px-0.5', s.card, s.dim && 'opacity-55')}
      style={vt(on, 'card')}
      data-morph-id={m.id}
    >
      {(s.rail ?? (m.isKey ? 'bg-accent' : null)) && <span className={cn('absolute inset-y-0.5 left-0 w-0.5 rounded-r-full', s.rail ?? 'bg-accent')} aria-hidden />}
      <SportGlyph sport={m.sport} size={14} className="shrink-0 text-fg-1" style={vt(on, 'glyph')} />
      <span className={cn('truncate text-mono-sm text-fg-2 max-[360px]:hidden', state === 'missed' && 'line-through')}>
        {m.durationSec && m.durationSec >= 3600 ? `${Math.round(m.durationSec / 3600)}h` : formatDuration(m.durationSec).replace(/^0:/, ':')}
      </span>
    </div>
  );
}

/** Month-view compact card: title gets the full first line; duration · load + status on the second. */
function CompactCard({ card, ghost, selected, style }: { card: CalendarCard; ghost?: boolean; selected?: boolean; style?: CSSProperties }) {
  const m = card.model;
  const on = useIsMorphTarget(m.id);
  const state = m.compliance?.state ?? (m.kind === 'activity' ? 'unplanned' : 'planned');
  const s = complianceStyles(state);
  const rail = s.rail ?? (m.isKey ? 'bg-accent' : null);
  return (
    <div
      data-morph-id={m.id}
      aria-label={`${m.title}, ${formatDuration(m.durationSec, 'short')}, ${s.label}`}
      className={cn(
        'relative flex min-w-0 flex-col overflow-hidden rounded-md py-1.5 pr-1.5 pl-2.5 transition-[background-color,border-color,opacity] duration-(--dur-fast)',
        s.card,
        'hover:border-line-3 hover:bg-surface-3',
        s.dim && 'opacity-55',
        selected && 'ring-1 ring-fg-1 ring-inset',
        ghost && 'border-dashed !border-line-3 !bg-transparent bg-hatch-faint opacity-60 [&>*]:invisible',
      )}
      style={{ ...style, ...vt(on, 'card') }}
    >
      {rail && !ghost && <span className={cn('absolute inset-y-1.5 left-0 w-[3px] rounded-r-full', rail)} aria-hidden />}
      {/* title gets the full width (2 lines); glyph · duration · status share the line below */}
      <span className={cn('line-clamp-2 min-w-0 text-body-sm leading-4 font-[520] break-words text-fg-1', s.title)} style={vt(on, 'title')}>
        {m.title}
      </span>
      <div className="flex min-w-0 items-center gap-1 pt-0.5">
        <SportGlyph sport={m.sport} subSport={m.subSport} size={14} style={vt(on, 'glyph')} className="shrink-0 text-fg-2" />
        <span className={cn('shrink-0 text-mono-sm text-fg-2', state === 'missed' && 'line-through')}>{formatDuration(m.durationSec)}</span>
        <span className="ml-auto flex min-w-0 items-center gap-1">
          {m.isKey && <KeyStar pressed readOnly size="sm" />}
          {m.compliance && state !== 'planned' && <ComplianceGlyph state={state} size={11} />}
          {m.intensity && !(m.isKey && m.compliance && state !== 'planned') && <IntensityPips intensity={m.intensity} />}
        </span>
      </div>
    </div>
  );
}

function QuickActions({ card, date, actions }: { card: CalendarCard; date: string; actions: CardActions }) {
  const planned = !!card.workout && !card.activity;
  const stop = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    fn();
  };
  const btn = (label: string, icon: ReactNode, fn: () => void, pressed?: boolean) => (
    <Tooltip content={label} side="top">
      <button
        type="button"
        tabIndex={-1}
        aria-label={label}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={stop(fn)}
        className={cn(
          'flex size-6 items-center justify-center rounded-xs text-fg-2 transition-colors duration-(--dur-fast) hover:bg-surface-3 hover:text-fg-1 [&_svg]:size-3.5',
          pressed && 'text-accent-ink',
        )}
      >
        {icon}
      </button>
    </Tooltip>
  );
  const garminOn = card.workout?.garmin.syncState === 'synced' || card.workout?.garmin.syncState === 'pending';
  return (
    <motion.div
      initial={{ opacity: 0, y: 3, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...tween('fast'), delay: 0.08 }}
      className="glass absolute -top-3.5 right-1 z-(--z-sticky) flex items-center gap-px rounded-sm border border-line-3 p-px inset-shadow-hairline"
      onClick={(e) => e.stopPropagation()}
    >
      {btn('Open', <ArrowUpRight />, () => actions.open(card))}
      {planned && btn('Duplicate to next day', <Copy />, () => actions.duplicate(card, addDays(date, 1)))}
      {btn(card.model.isKey ? 'Unmark key' : 'Mark key', <Star className={card.model.isKey ? 'fill-current' : undefined} />, () => actions.toggleKey(card), card.model.isKey)}
      {planned && btn(garminOn ? 'Remove from watch' : 'Send to watch', <Watch />, () => actions.garmin(card, !garminOn), garminOn)}
      {planned && btn('Delete', <Trash2 />, () => actions.remove([card]))}
    </motion.div>
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
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          actions.open(card);
          return;
        }
        listeners?.onKeyDown?.(e);
      }}
      onFocus={() => calStore.get().cardKey !== card.key && calStore.set({ cardKey: card.key, cursor: date })}
      className={cn(
        'relative block outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
        rounded,
        card.draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        selected && 'ring-1 ring-fg-1 ring-offset-1 ring-offset-canvas',
        isDragging && '[&>.face]:invisible',
      )}
    >
      {children}
      {isDragging && <span className={cn('absolute inset-0 border border-dashed border-line-3 bg-hatch-faint opacity-70', rounded)} aria-hidden />}
    </div>
  );
});

export const CardItem = memo(function CardItem({ card, date, density, actions, zoomName, trailing, hideSpark }: CardItemProps) {
  const [hover, setHover] = useState(false);
  const zoomStyle: CSSProperties | undefined = zoomName ? vtName(`w-${card.key}`, 'cal-item') : undefined;
  const face = useMemo(() => {
    const model =
      hideSpark || card.model.compliance?.state === 'planned'
        ? { ...card.model, sparkline: hideSpark ? null : card.model.sparkline, compliance: card.model.compliance?.state === 'planned' ? null : card.model.compliance }
        : card.model;
    return (
      <div className="face">
        {density === 'mini' ? (
          <MiniChip card={card} />
        ) : density === 'compact' && !trailing ? (
          <CompactCard card={card} style={zoomStyle} />
        ) : (
          <WorkoutCard
            model={model}
            density={density}
            style={zoomStyle}
            className={cn('w-full', 'hover:border-line-3 hover:bg-surface-3', density === 'compact' && '!gap-0.5 !py-1.5')}
            trailing={trailing}
          />
        )}
      </div>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, density, zoomName, trailing, hideSpark]);

  return (
    <div className="relative" data-card={card.key} onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      <DragShell card={card} date={date} actions={actions} rounded={density === 'chip' || density === 'mini' ? 'rounded-sm' : 'rounded-md'}>
        {face}
      </DragShell>
      {hover && density !== 'mini' && <QuickActions card={card} date={date} actions={actions} />}
    </div>
  );
});
