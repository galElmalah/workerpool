/**
 * One week row of the infinite month view: 7 day cells · weekly summary. Days are separated by
 * space, weeks by one faint `line-1` hairline. Memoized on the (structurally shared) WeekData;
 * layout animation is enabled only in days a drag or mutation touched.
 */
import { useDroppable } from '@dnd-kit/core';
import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { memo, useMemo, useRef, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import type { LocalDate } from '@cadence/core/domain';
import { cn } from '@/lib/cn';
import type { CalendarCard } from '@/lib/queries/training';
import { vtName } from '@/motion/morph';
import { links } from '@/shell/links';
import { WorkoutCard } from '@/ui/domain/WorkoutCard';
import { Skeleton } from '@/ui/Skeleton';
import type { CardActions } from '../shared/actions';
import { CardItem, type CalDensity } from '../shared/CardItem';
import type { DayData, WeekData } from '../shared/data';
import { DateMark, DayGlyph, EventBanner } from '../shared/DayParts';
import { useFlip } from '../shared/flip';
import { QuickAdd } from '../shared/QuickAdd';
import { calStore, useCal, type DragPreview } from '../shared/store';
import { WeekSummaryBlock, type SummaryMenuHandlers } from '../shared/Summary';

export type MonthLayout = 'xl' | 'lg' | 'md' | 'sm';

export const COLS: Record<MonthLayout, string> = {
  xl: 'repeat(7, minmax(0, 1fr)) 160px',
  lg: 'repeat(7, minmax(0, 1fr)) 164px',
  md: 'repeat(7, minmax(0, 1fr))',
  sm: 'repeat(7, minmax(0, 1fr))',
};
/** Column gap (px) between day cells: space separates days, not lines. */
export const COL_GAP: Record<MonthLayout, number> = { xl: 4, lg: 4, md: 4, sm: 2 };
/** @deprecated The phase gutter is gone (the phase name lives in the week summary). */
export const GUTTER: Record<MonthLayout, number> = { xl: 0, lg: 0, md: 0, sm: 0 };

/** Items shown per day before "+N more". */
export const MAX_ITEMS = 3;

export interface DayCellProps {
  day: DayData;
  cards: CalendarCard[];
  /** Static ghost for an Alt-drag copy preview. */
  copyGhost?: CalendarCard;
  today: LocalDate | null;
  weekStart: LocalDate;
  density: CalDensity;
  actions: CardActions;
  affected: boolean;
  zoomItems: boolean;
  dayFocus: boolean;
  maxCards: number;
}

/** Droppable + roving-focus shell of a day; re-renders on dnd registration without touching its content. */
export const DropZone = memo(function DropZone({ date, today, className, style, composerOnClick, children }: { date: LocalDate; today: LocalDate | null; className: string; style?: CSSProperties; composerOnClick: boolean; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: date });
  const isCursor = useCal((s) => s.cursor === date || (s.cursor == null && date === today));
  const onClick = (e: MouseEvent) => {
    if ((e.target as Element).closest('[data-card],a,button,input')) return;
    calStore.set({ cursor: date, cardKey: null, composer: composerOnClick ? date : null, selection: new Set() });
  };
  return (
    <div
      ref={setNodeRef}
      role="gridcell"
      data-day-cell={date}
      tabIndex={isCursor ? 0 : -1}
      aria-label={date}
      aria-current={date === today ? 'date' : undefined}
      data-over={isOver || undefined}
      onClick={onClick}
      onFocus={(e) => e.target === e.currentTarget && calStore.get().cursor !== date && calStore.set({ cursor: date, cardKey: null })}
      style={style}
      className={cn(
        className,
        'outline-none transition-[background-color,outline-color] duration-(--dur-fast)',
        'focus-visible:z-[2] focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-focus',
        // drop target: one surface step + a thin neutral outline
        'data-[over]:bg-surface-1 data-[over]:outline-1 data-[over]:outline-solid data-[over]:-outline-offset-1 data-[over]:outline-line-3',
      )}
    >
      {children}
    </div>
  );
});

export const DayCell = memo(function DayCell({ day, cards, copyGhost, today, weekStart, density, actions, affected, zoomItems, dayFocus, maxCards }: DayCellProps) {
  void weekStart;
  const { date } = day;
  const composing = useCal((s) => s.composer === date);
  const listRef = useRef<HTMLDivElement>(null);
  useFlip(listRef, affected);
  const isToday = date === today;
  const mini = density === 'mini';

  const content = useMemo(() => {
    const overflow = cards.length > maxCards;
    const shown = cards.slice(0, maxCards);
    const more = cards.length - shown.length;
    return (
      <>
        <div className={cn('relative flex items-center gap-1.5', mini ? 'h-5 justify-center' : 'h-6 px-1.5')}>
          <Link
            {...links.calendarDay(date)}
            tabIndex={-1}
            onClickCapture={() => flushSync(() => calStore.set({ focus: { kind: 'day', date } }))}
            className="flex h-5 shrink-0 items-center rounded-xs outline-none transition-colors duration-(--dur-fast) hover:[&>span]:text-fg-1"
            aria-label={`Open ${date}`}
          >
            <DateMark date={date} today={isToday} compact={mini} />
          </Link>
          {!mini && <DayGlyph markers={day.markers} note={day.note} />}
          {!mini && (
            <Link
              {...links.newWorkout({ date })}
              tabIndex={-1}
              onClick={(e) => e.stopPropagation()}
              className="-mr-1 ml-auto flex size-5 items-center justify-center rounded-xs text-fg-3 opacity-0 transition-opacity duration-(--dur-fast) group-hover/day:opacity-100 hover:bg-surface-2 hover:text-fg-1 focus-visible:opacity-100"
              aria-label={`New workout on ${date}`}
              title="New workout"
            >
              <Plus className="size-3.5" />
            </Link>
          )}
        </div>
        {!day.loaded ? (
          <Skeleton className={mini ? 'h-6' : 'h-7'} />
        ) : (
          <>
            {day.events.length > 0 && (
              <div className="flex flex-col gap-1">
                {day.events.map((e) => (
                  <EventBanner key={e.id} e={e} compact={mini} />
                ))}
              </div>
            )}
            <div ref={listRef} className={cn('flex flex-col', mini ? 'gap-0.5' : 'gap-1')}>
              {shown.map((c) => (
                <div key={c.key} data-flip={c.key} className="relative">
                  <CardItem card={c} date={date} density={density} actions={actions} zoomName={zoomItems} />
                </div>
              ))}
              {copyGhost && (
                <div data-flip={`copy-${copyGhost.key}`}>
                  <WorkoutCard model={copyGhost.model} density="chip" ghost />
                </div>
              )}
            </div>
            {overflow && (
              <Link
                {...links.calendarDay(date)}
                onClick={(e) => e.stopPropagation()}
                className={cn('self-start rounded-sm text-label text-fg-3 transition-colors hover:bg-surface-2 hover:text-fg-1 num', mini ? 'px-0.5' : 'px-1.5 py-0.5')}
              >
                +{more}
                {!mini && ' more'}
              </Link>
            )}
            {composing && <QuickAdd date={date} actions={actions} />}
          </>
        )}
      </>
    );
  }, [day, cards, copyGhost, isToday, mini, date, density, actions, zoomItems, maxCards, composing]);

  return (
    <DropZone
      date={date}
      today={today}
      composerOnClick={!mini}
      style={dayFocus ? vtName('cal-focus') : undefined}
      className={cn('group/day relative flex min-w-0 flex-col rounded-lg', mini ? 'gap-0.5 px-0.5 pt-1.5 pb-2' : 'gap-1 px-0.5 pt-2 pb-4')}
    >
      {content}
    </DropZone>
  );
});

export interface WeekRowProps extends SummaryMenuHandlers {
  week: WeekData;
  layout: MonthLayout;
  density: CalDensity;
  today: LocalDate | null;
  actions: CardActions;
  preview: DragPreview | null;
  previewCard: CalendarCard | null;
  affected: ReadonlySet<string> | null;
  focusWeek: boolean;
  focusDay: LocalDate | null;
  y: number;
  index: number;
  measureRef: (el: HTMLElement | null) => void;
}

export const WeekRow = memo(function WeekRow({ week, layout, density, today, actions, preview, previewCard, affected, focusWeek, focusDay, y, index, measureRef, onCopyWeek, onShift }: WeekRowProps) {
  const todayIndex = today && today >= week.start && today <= week.days[6]!.date ? week.days.findIndex((d) => d.date === today) : undefined;
  const summaryCol = layout === 'xl' || layout === 'lg';
  return (
    <div ref={measureRef} data-index={index} data-week={week.start} role="row" className="absolute top-0 left-0 flex w-full" style={{ transform: `translateY(${y}px)` }}>
      <div
        className={cn('grid min-w-0 flex-1 border-t border-line-1', layout === 'sm' ? 'min-h-[76px]' : 'min-h-[104px]')}
        style={{ gridTemplateColumns: COLS[layout], columnGap: COL_GAP[layout], ...(focusWeek ? vtName('cal-focus') : undefined) }}
      >
        {week.days.map((d) => {
          let cards = d.cards;
          let copyGhost: CalendarCard | undefined;
          if (preview && previewCard) {
            if (d.date === preview.from && preview.from !== preview.to && !preview.copy) cards = cards.filter((c) => c.key !== preview.key);
            if (d.date === preview.to && preview.from !== preview.to) {
              if (preview.copy) copyGhost = previewCard;
              else if (!cards.some((c) => c.key === preview.key)) cards = [...cards, previewCard];
            }
          }
          return (
            <DayCell
              key={d.date}
              day={d}
              cards={cards}
              copyGhost={copyGhost}
              today={today}
              weekStart={week.start}
              density={density}
              actions={actions}
              affected={!!affected?.has(d.date)}
              zoomItems={focusWeek}
              dayFocus={focusDay === d.date}
              maxCards={MAX_ITEMS}
            />
          );
        })}
        {summaryCol ? (
          <WeekSummaryBlock week={week} variant={layout === 'xl' ? 'column' : 'narrow'} todayIndex={todayIndex} onCopyWeek={onCopyWeek} onShift={onShift} className="my-1.5 ml-1 self-start" />
        ) : (
          <WeekSummaryBlock
            week={week}
            variant="row"
            todayIndex={todayIndex}
            onCopyWeek={onCopyWeek}
            onShift={onShift}
            className={cn('col-span-full mb-1.5', todayIndex != null && 'bg-surface-1')}
          />
        )}
      </div>
    </div>
  );
});
