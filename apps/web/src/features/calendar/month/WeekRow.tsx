/**
 * One week row of the infinite month view: phase gutter segment · 7 day cells · weekly summary.
 * Memoized on the (structurally shared) WeekData; layout animation is enabled only in days a
 * drag or mutation touched.
 */
import { useDroppable } from '@dnd-kit/core';
import { Link } from '@tanstack/react-router';
import { Pilcrow, Plus } from 'lucide-react';
import { memo, useMemo, useRef, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import type { LocalDate, Phase } from '@cadence/core/domain';
import { cn } from '@/lib/cn';
import { monthShort } from '@/lib/format';
import type { CalendarCard } from '@/lib/queries/training';
import { vtName } from '@/motion/morph';
import { links } from '@/shell/links';
import { WorkoutCard } from '@/ui/domain/WorkoutCard';
import { Skeleton } from '@/ui/Skeleton';
import type { CardActions } from '../shared/actions';
import { CardItem, type CalDensity } from '../shared/CardItem';
import type { DayData, PhaseInfo, WeekData } from '../shared/data';
import { EventBanner, MarkerGlyphs, RangeBands, ReadinessDot } from '../shared/DayParts';
import { useFlip } from '../shared/flip';
import { QuickAdd } from '../shared/QuickAdd';
import { calStore, useCal, type DragPreview } from '../shared/store';
import { WeekSummaryBlock, type SummaryMenuHandlers } from '../shared/Summary';

export type MonthLayout = 'xl' | 'lg' | 'md' | 'sm';

export const COLS: Record<MonthLayout, string> = {
  xl: 'repeat(7, minmax(0, 1fr)) minmax(220px, 0.95fr)',
  lg: 'repeat(7, minmax(0, 1fr)) 168px',
  md: 'repeat(7, minmax(0, 1fr))',
  sm: 'repeat(7, minmax(0, 1fr))',
};
export const GUTTER: Record<MonthLayout, number> = { xl: 24, lg: 24, md: 20, sm: 6 };

const PHASE_FILL: Record<Phase['type'], string> = {
  base: 'bg-surface-3',
  build: 'bg-gray-6',
  peak: 'bg-gray-8',
  race: 'bg-gray-9',
  taper: 'bg-surface-2 bg-dots-fg',
  recovery: 'bg-surface-2 bg-dots-fg',
  transition: 'bg-surface-2 bg-hatch-faint',
};

function PhaseGutter({ info, width }: { info?: PhaseInfo; width: number }) {
  return (
    <div className="relative shrink-0" style={{ width }}>
      {info && (
        <div
          className={cn(
            'absolute inset-x-0.5 flex items-start justify-center overflow-hidden',
            PHASE_FILL[info.phase.type],
            info.isFirst ? 'top-1 rounded-t-sm' : 'top-0',
            info.isLast ? 'bottom-1 rounded-b-sm' : 'bottom-0',
          )}
          title={`${info.phase.label} · week ${info.index} of ${info.count}`}
        >
          {width >= 16 && (
            <span
              className={cn('mt-2 truncate text-micro ', info.phase.type === 'peak' || info.phase.type === 'race' ? 'text-fg-1' : 'text-fg-2')}
              style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', maxHeight: 'calc(100% - 16px)' }}
            >
              {info.phase.label}
              <span className="text-fg-3"> · {info.index}/{info.count}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

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
        'outline-none transition-[background-color,box-shadow] duration-(--dur-fast)',
        'focus-visible:z-[2] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
        'data-[over]:bg-accent-a2 data-[over]:ring-1 data-[over]:ring-accent-a5 data-[over]:ring-inset',
      )}
    >
      {children}
    </div>
  );
});

export const DayCell = memo(function DayCell({ day, cards, copyGhost, today, weekStart, density, actions, affected, zoomItems, dayFocus, maxCards }: DayCellProps) {
  const { date } = day;
  const composing = useCal((s) => s.composer === date);
  const listRef = useRef<HTMLDivElement>(null);
  useFlip(listRef, affected);
  const isToday = date === today;
  const future = today != null && date > today;
  const first = date.endsWith('-01');
  const mini = density === 'mini';
  const sickish = day.markers.some((m) => m.type === 'sick' || m.type === 'injured');

  const content = useMemo(() => {
    const shown = cards.slice(0, maxCards);
    const more = cards.length - shown.length;
    const rest = day.markers.some((m) => m.type === 'rest');
    return (
      <>
        {isToday && <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-accent" aria-hidden />}
        <RangeBands markers={day.markers} date={date} weekStart={weekStart} />
        <div className={cn('relative z-[2] flex items-center gap-1', mini ? 'h-4 justify-center' : 'h-5')}>
          <Link
            {...links.calendarDay(date)}
            tabIndex={-1}
            onClickCapture={() => flushSync(() => calStore.set({ focus: { kind: 'day', date } }))}
            className={cn(
              'flex h-5 shrink-0 items-center justify-center rounded-full text-mono-sm transition-colors duration-(--dur-fast)',
              isToday ? 'min-w-5 bg-accent px-1 font-[600] text-on-accent' : first ? 'px-0.5 font-[600] text-fg-1 hover:text-accent-ink' : 'min-w-5 px-0.5 text-fg-2 hover:text-fg-1',
              mini && 'h-4 min-w-4',
            )}
            aria-label={`Open ${date}`}
          >
            {Number(date.slice(8))}
            {first && !mini && <span className={cn('ml-1 ', isToday ? '' : 'text-fg-1')}>{monthShort(date)}</span>}
          </Link>
          {!mini && <MarkerGlyphs markers={day.markers} />}
          {!mini && day.note && <Pilcrow className="size-3 shrink-0 text-fg-3" aria-label="Day note" />}
          {!mini && !future && <ReadinessDot w={day.wellness} />}
          {!mini && (
            <Link
              {...links.newWorkout({ date })}
              tabIndex={-1}
              onClick={(e) => e.stopPropagation()}
              className="ml-auto flex size-5 items-center justify-center rounded-xs text-fg-3 opacity-0 transition-opacity duration-(--dur-fast) group-hover/day:opacity-100 hover:bg-surface-3 hover:text-fg-1 focus-visible:opacity-100"
              aria-label={`New workout on ${date}`}
              title="New workout"
            >
              <Plus className="size-3.5" />
            </Link>
          )}
        </div>
        {!day.loaded ? (
          <Skeleton className={mini ? 'h-6' : 'h-11'} />
        ) : (
          <>
            {day.events.length > 0 && (
              <div className="flex flex-col gap-0.5">
                {day.events.map((e) => (
                  <EventBanner key={e.id} e={e} compact={mini || density === 'chip'} />
                ))}
              </div>
            )}
            {rest && cards.length === 0 && !mini && <span className="text-micro text-fg-3">Rest</span>}
            <div ref={listRef} className={cn('flex flex-col', mini ? 'gap-0.5' : 'gap-1')}>
              {shown.map((c) => (
                <div key={c.key} data-flip={c.key} className="relative">
                  <CardItem card={c} date={date} density={density} actions={actions} zoomName={zoomItems} />
                </div>
              ))}
              {copyGhost && (
                <div data-flip={`copy-${copyGhost.key}`}>
                  <WorkoutCard model={copyGhost.model} density={mini ? 'chip' : (density as 'full')} ghost />
                </div>
              )}
            </div>
            {more > 0 && (
              <Link
                {...links.calendarDay(date)}
                onClick={(e) => e.stopPropagation()}
                className="self-start rounded-xs px-1 text-mono-sm text-fg-3 transition-colors hover:bg-surface-3 hover:text-fg-1"
              >
                +{more}
                {!mini && ' more'}
              </Link>
            )}
            {composing && <QuickAdd date={date} actions={actions} />}
            {day.note && !mini && !composing && (
              <p className="mt-auto truncate pt-0.5 text-label font-[420] text-fg-3" title={day.note.body}>
                {day.note.body.replace(/[#*_>`]/g, '').split('\n').find((l) => l.trim())}
              </p>
            )}
          </>
        )}
      </>
    );
  }, [day, cards, copyGhost, isToday, future, first, mini, date, weekStart, density, actions, zoomItems, maxCards, composing]);

  return (
    <DropZone
      date={date}
      today={today}
      composerOnClick={!mini}
      style={dayFocus ? vtName('cal-focus') : undefined}
      className={cn('group/day relative flex min-w-0 flex-col', mini ? 'gap-0.5 p-0.5 pt-1' : 'gap-1 p-1.5', future ? 'bg-canvas' : 'bg-surface-1', sickish && 'bg-hatch-faint')}
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
  const maxCards = density === 'mini' ? 3 : 4;
  const todayIndex = today && today >= week.start && today <= week.days[6]!.date ? week.days.findIndex((d) => d.date === today) : undefined;
  const summaryCol = layout === 'xl' || layout === 'lg';
  return (
    <div ref={measureRef} data-index={index} data-week={week.start} role="row" className="absolute top-0 left-0 flex w-full" style={{ transform: `translateY(${y}px)` }}>
      <PhaseGutter info={week.phase} width={GUTTER[layout]} />
      <div
        className={cn('grid min-w-0 flex-1 gap-px bg-line-2 pb-px', layout === 'sm' ? 'min-h-[84px]' : 'min-h-[132px]')}
        style={{ gridTemplateColumns: COLS[layout], ...(focusWeek ? vtName('cal-focus') : undefined) }}
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
              maxCards={maxCards}
            />
          );
        })}
        {summaryCol ? (
          <WeekSummaryBlock week={week} variant={layout === 'xl' ? 'column' : 'narrow'} todayIndex={todayIndex} onCopyWeek={onCopyWeek} onShift={onShift} className={cn('bg-surface-1', todayIndex != null && 'bg-surface-2')} />
        ) : (
          <WeekSummaryBlock week={week} variant="row" todayIndex={todayIndex} onCopyWeek={onCopyWeek} onShift={onShift} className="col-span-full bg-surface-1" />
        )}
      </div>
    </div>
  );
});
