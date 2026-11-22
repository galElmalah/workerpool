/**
 * Week view (product.md §3.8, DESIGN_V2 §5): one quiet totals strip, seven columns separated by
 * space (no grid lines) holding roomy two-line cards, drag & drop between days, per-column
 * quick-add, ‹ › paging (page-next / page-prev) and the month ⇄ week ⇄ day zoom. Wellness and the
 * per-day detail live on the day page; per-sport totals on the weekly review.
 */
import { DndContext, useDroppable } from '@dnd-kit/core';
import { Link, useNavigate, useRouter } from '@tanstack/react-router';
import { Pilcrow, Plus, RotateCcw, TriangleAlert } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import type { LocalDate } from '@cadence/core/domain';
import { addDays, addWeeks, isoWeekOf, isoWeekStart, weekStart } from '@cadence/core/time';
import { cn } from '@/lib/cn';
import { formatDuration, formatIsoWeek, formatIsoWeekRange, weekdayShort } from '@/lib/format';
import { BP, useMediaQuery } from '@/lib/hooks/useMediaQuery';
import type { CalendarCard } from '@/lib/queries/training';
import { vtName } from '@/motion/morph';
import { links } from '@/shell/links';
import { Button } from '@/ui/Button';
import { calendarCollision } from '@/ui/dnd';
import { WorkoutCard } from '@/ui/domain/WorkoutCard';
import { ContextMenu, type MenuEntry } from '@/ui/Menu';
import { Page, PageHeader } from '@/ui/PageHeader';
import { Skeleton } from '@/ui/Skeleton';
import { useCardActions, type CardActions } from '../shared/actions';
import { CopyWeekPopover, SelectionBar, ShiftPopover, type BulkState } from '../shared/Bulk';
import { CardItem } from '../shared/CardItem';
import { useCalendarModel, useCalendarPages, weekIndexOf, type DayData } from '../shared/data';
import { useFlip } from '../shared/flip';
import { DateMark, DayGlyph, EventBanner } from '../shared/DayParts';
import { focusDay, onGridTab, useCalendarKeys } from '../shared/keys';
import { cardMenu, dayMenu } from '../shared/menu';
import { PeekLayer } from '../shared/Peek';
import { QuickAdd } from '../shared/QuickAdd';
import { calStore, useCal, type DragPreview } from '../shared/store';
import { WeekSummaryBlock } from '../shared/Summary';
import { NewButton, PagingControls, ViewSwitcher } from '../shared/Toolbar';
import { DragLayer, useCalendarDrag } from '../shared/useDrag';

interface ColumnProps {
  /** Card density: 'compact' (duration only) when columns are too narrow for distance/load. */
  density: 'full' | 'compact';
  day: DayData;
  cards: CalendarCard[];
  copyGhost?: CalendarCard;
  today: LocalDate | null;
  weekStart: LocalDate;
  actions: CardActions;
  affected: boolean;
  dayFocus: boolean;
}

const WeekColumn = memo(function WeekColumn({ density, day, cards, copyGhost, today, actions, affected, dayFocus }: ColumnProps) {
  const { date } = day;
  const { setNodeRef, isOver } = useDroppable({ id: date });
  const isCursor = useCal((s) => s.cursor === date || (s.cursor == null && date === today));
  const composing = useCal((s) => s.composer === date);
  const listRef = useRef<HTMLDivElement>(null);
  useFlip(listRef, affected);
  const onClick = (e: MouseEvent) => {
    if ((e.target as Element).closest('[data-card],a,button,input')) return;
    calStore.set({ cursor: date, cardKey: null, composer: date, selection: new Set() });
  };
  return (
    <div
      ref={setNodeRef}
      role="gridcell"
      data-day-cell={date}
      tabIndex={isCursor ? 0 : -1}
      aria-label={date}
      data-over={isOver || undefined}
      onClick={onClick}
      onFocus={(e) => e.target === e.currentTarget && calStore.get().cursor !== date && calStore.set({ cursor: date, cardKey: null })}
      style={dayFocus ? vtName('cal-focus') : undefined}
      className={cn(
        'group/day relative flex min-h-[440px] min-w-0 flex-col gap-2 rounded-lg p-1 outline-none transition-[background-color,outline-color] duration-(--dur-fast)',
        'focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-focus',
        'data-[over]:bg-surface-1 data-[over]:outline-1 data-[over]:outline-solid data-[over]:-outline-offset-1 data-[over]:outline-line-3',
      )}
    >
      {!day.loaded ? (
        <>
          <Skeleton radius="md" className="h-16" />
          <Skeleton radius="md" className="h-16" />
        </>
      ) : (
        <>
          {day.events.map((e) => (
            <EventBanner key={e.id} e={e} />
          ))}
          <div ref={listRef} className="flex flex-col gap-2">
            {cards.map((c) => (
              <div key={c.key} data-flip={c.key}>
                <CardItem card={c} date={date} density={density} actions={actions} zoomName />
              </div>
            ))}
            {copyGhost && <WorkoutCard model={copyGhost.model} density={density} ghost />}
          </div>
          {composing ? (
            <QuickAdd date={date} actions={actions} />
          ) : (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => calStore.set({ composer: date, cursor: date })}
              className="flex h-8 items-center gap-1.5 rounded-md px-3 text-body-sm text-fg-3 opacity-0 transition-[opacity,background-color,color] duration-(--dur-fast) group-hover/day:opacity-100 hover:bg-surface-1 hover:text-fg-1 focus-visible:opacity-100"
            >
              <Plus className="size-3.5" /> Add
            </button>
          )}
          {day.note && (
            <Link {...links.calendarDay(date)} className="mt-auto flex items-start gap-1.5 rounded-md px-3 py-2 text-label text-fg-3 hover:bg-surface-1 hover:text-fg-2">
              <Pilcrow className="mt-0.5 size-3 shrink-0" aria-hidden />
              <span className="line-clamp-2">{day.note.body.replace(/[#*_>`]/g, '')}</span>
            </Link>
          )}
        </>
      )}
    </div>
  );
});

function applyPreview(day: DayData, preview: DragPreview | null, previewCard: CalendarCard | null) {
  let cards = day.cards;
  let copyGhost: CalendarCard | undefined;
  if (preview && previewCard && preview.from !== preview.to) {
    if (day.date === preview.from && !preview.copy) cards = cards.filter((c) => c.key !== preview.key);
    if (day.date === preview.to) {
      if (preview.copy) copyGhost = previewCard;
      else if (!cards.some((c) => c.key === preview.key)) cards = [...cards, previewCard];
    }
  }
  return { cards, copyGhost };
}

export function WeekView({ isoWeek }: { isoWeek: string }) {
  const navigate = useNavigate();
  const router = useRouter();
  const start = isoWeekStart(isoWeek);
  useEffect(() => {
    const id = setTimeout(() => {
      void router.preloadRoute(links.calendar(start)).catch(() => {});
      void router.preloadRoute(links.calendarDay(start)).catch(() => {});
    }, 600);
    return () => clearTimeout(id);
  }, [router, start]);
  const idx = weekIndexOf(start);
  const pages = useCalendarPages(idx - 1, idx + 1);
  const model = useCalendarModel(pages.data);
  const today = model.today;
  const week = model.getWeek(start);
  const actions = useCardActions();
  const focus = useCal((s) => s.focus);
  const [bulk, setBulk] = useState<BulkState>(null);
  const [menu, setMenu] = useState<MenuEntry[]>([]);
  const mobile = !useMediaQuery(BP.md);
  const gridRef = useRef<HTMLDivElement>(null);
  const [colW, setColW] = useState(200);
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setColW(e!.contentRect.width / 7));
    ro.observe(el);
    return () => ro.disconnect();
  }, [week.loaded]);
  const { sensors, dnd, preview, previewCard, active } = useCalendarDrag(model, actions);

  const gridFocus = focus?.kind === 'week' && focus.start === start;
  const dayFocus = focus?.kind === 'day' && focus.date >= start && focus.date <= addDays(start, 6) ? focus.date : null;

  const page = (n: number) => {
    flushSync(() => calStore.set({ focus: null }));
    void navigate(links.calendarWeek(addWeeks(isoWeek, n)));
  };
  const goView = useCallback(
    (view: 'month' | 'week' | 'day' | 'agenda', date: LocalDate) => {
      const d = date && date >= start && date <= addDays(start, 6) ? date : start;
      if (view === 'week') return;
      if (view === 'month') {
        flushSync(() => calStore.set({ focus: { kind: 'week', start }, cursor: d }));
        void navigate(links.calendar(start));
      } else if (view === 'day') {
        flushSync(() => calStore.set({ focus: { kind: 'day', date: d }, cursor: d }));
        void navigate(links.calendarDay(d));
      } else void navigate(links.agenda(d));
    },
    [navigate, start],
  );
  const ensureVisible = useCallback(
    (date: LocalDate) => {
      if (date < start || date > addDays(start, 6)) {
        flushSync(() => calStore.set({ focus: null }));
        void navigate(links.calendarWeek(isoWeekOf(date)));
        focusDay(date);
      }
    },
    [navigate, start],
  );
  const goToday = () => {
    if (!today) return;
    calStore.set({ cursor: today });
    if (weekStart(today) !== start) {
      flushSync(() => calStore.set({ focus: null }));
      void navigate(links.calendarWeek(isoWeekOf(today)));
    }
    focusDay(today);
  };
  useCalendarKeys({
    model,
    actions,
    ensureVisible,
    goToday,
    goView,
    onShift: (d) => {
      const a = document.querySelector<HTMLElement>('[data-summary]');
      if (a) setBulk({ kind: 'shift', from: d, anchor: a });
    },
  });

  const onContextMenuCapture = (e: React.MouseEvent) => {
    const t = e.target as Element;
    const key = t.closest('[data-card]')?.getAttribute('data-card');
    const date = t.closest('[data-day-cell]')?.getAttribute('data-day-cell');
    const f = key ? model.findCard(key) : null;
    if (f) setMenu(cardMenu(f.card, f.date, actions));
    else if (date) {
      const clip = calStore.get().clipboard.map((k) => model.findCard(k)?.card).filter((c) => !!c);
      setMenu(dayMenu(date, actions, { paste: clip as never, openDay: () => goView('day', date), newWorkout: () => void navigate(links.newWorkout({ date })) }));
    } else setMenu([]);
  };

  const todayIndex = today ? week.days.findIndex((d) => d.date === today) : -1;

  return (
    <Page
      width="full"
      className="!gap-4"
      header={
        <PageHeader
          variant="compact"
          titleText={`${formatIsoWeek(isoWeek)} · ${formatIsoWeekRange(isoWeek)}`}
          title={
            <span className="flex items-baseline gap-2">
              {formatIsoWeek(isoWeek)}
              <span className="text-body font-normal text-fg-3 max-sm:hidden">
                {formatIsoWeekRange(isoWeek, true)}
                {week.phase && <span className="max-md:hidden"> · {week.phase.phase.label}</span>}
              </span>
            </span>
          }
          breadcrumb={[{ label: 'Calendar', link: links.calendar(start) }]}
          toolbar={<ViewSwitcher value="week" onChange={(v) => goView(v, calStore.get().cursor ?? start)} />}
          actions={
            <>
              <PagingControls onPrev={() => page(-1)} onNext={() => page(1)} onToday={goToday} prevLabel="Previous week" nextLabel="Next week" />
              <NewButton />
            </>
          }
        />
      }
    >
      <section className="pt-6 pb-6">
        <WeekSummaryBlock
          week={week}
          variant="header"
          todayIndex={todayIndex >= 0 ? todayIndex : undefined}
          onCopyWeek={(w, a) => setBulk({ kind: 'copy', isoWeek: w, anchor: a })}
          onShift={(f, a) => setBulk({ kind: 'shift', from: todayIndex >= 0 && today ? today : f, anchor: a })}
        />
      </section>
      {pages.error && !week.loaded ? (
        <div className="flex flex-col items-center gap-3 rounded-lg bg-surface-1 p-8 text-center">
          <TriangleAlert className="size-5 text-fg-1" />
          <p className="text-body text-fg-1">This week couldn&apos;t load.</p>
          <Button size="sm" icon={<RotateCcw />} onClick={pages.refetch}>
            Retry
          </Button>
        </div>
      ) : (
        <DndContext {...dnd.contextProps} sensors={sensors} collisionDetection={calendarCollision}>
          <ContextMenu items={menu} className="block">
            <div className={cn(mobile && '-mx-4 overflow-x-auto px-4 [scroll-snap-type:x_mandatory]')} onContextMenuCapture={onContextMenuCapture}>
              <div
                ref={gridRef}
                data-cal-grid
                role="grid"
                aria-label={`Week ${formatIsoWeek(isoWeek)}`}
                onKeyDown={onGridTab}
                className={cn('grid grid-cols-7 gap-x-2 xl:gap-x-3', mobile && 'w-[1400px]')}
                style={gridFocus ? vtName('cal-focus') : undefined}
              >
                {week.days.map((d) => {
                  const isToday = d.date === today;
                  const sec = d.cards.reduce((a, c) => a + (c.model.durationSec ?? 0), 0);
                  return (
                    <div
                      key={`h-${d.date}`}
                      role="columnheader"
                      className={cn('top-(--header-h) z-(--z-sticky) flex h-11 items-center gap-2 bg-canvas px-4 md:sticky', mobile && '[scroll-snap-align:start]')}
                    >
                      <Link
                        {...links.calendarDay(d.date)}
                        onClickCapture={() => flushSync(() => calStore.set({ focus: { kind: 'day', date: d.date } }))}
                        className="flex items-baseline gap-1.5 rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus [&:hover>span:first-child]:text-fg-1"
                      >
                        <span className="text-body-sm text-fg-3">{weekdayShort(d.date)}</span>
                        <DateMark date={d.date} today={isToday} className="!text-body-sm" />
                      </Link>
                      <DayGlyph markers={d.markers} note={d.note} />
                      <span className="ml-auto text-label text-fg-3 num">{sec ? formatDuration(sec) : ''}</span>
                    </div>
                  );
                })}
                {week.days.map((d) => {
                  const { cards, copyGhost } = applyPreview(d, preview, previewCard);
                  return (
                    <WeekColumn
                      key={d.date}
                      density={colW < 156 ? 'compact' : 'full'}
                      day={d}
                      cards={cards}
                      copyGhost={copyGhost}
                      today={today}
                      weekStart={start}
                      actions={actions}
                      affected={dnd.affected.has(d.date)}
                      dayFocus={dayFocus === d.date}
                    />
                  );
                })}
              </div>
            </div>
          </ContextMenu>
          <DragLayer active={active} density="full" copy={!!preview?.copy} overlayProps={dnd.overlayProps} />
        </DndContext>
      )}
      <SelectionBar model={model} actions={actions} />
      <PeekLayer model={model} />
      {bulk?.kind === 'copy' && <CopyWeekPopover isoWeek={bulk.isoWeek} anchor={bulk.anchor} model={model} actions={actions} onClose={() => setBulk(null)} />}
      {bulk?.kind === 'shift' && <ShiftPopover from={bulk.from} anchor={bulk.anchor} onClose={() => setBulk(null)} />}
    </Page>
  );
}
