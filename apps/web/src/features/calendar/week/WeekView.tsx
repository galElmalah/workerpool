/**
 * Week view (product.md §3.8): the horizontal summary header, seven equal columns of full cards
 * with large step profiles, sticky day headers, a wellness metrics row, drag & drop between days,
 * per-column quick-add, ‹ › paging (page-next / page-prev) and the month ⇄ week ⇄ day zoom.
 */
import { DndContext, useDroppable } from '@dnd-kit/core';
import { Link, useNavigate, useRouter } from '@tanstack/react-router';
import { Moon, Pilcrow, Plus, RotateCcw, TriangleAlert } from 'lucide-react';
import { LayoutGroup } from 'motion/react';
import { memo, useCallback, useEffect, useState, type MouseEvent } from 'react';
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
import { calendarCollision, Settle } from '@/ui/dnd';
import { MiniProfile } from '@/ui/domain/MiniProfile';
import { WorkoutCard } from '@/ui/domain/WorkoutCard';
import { ContextMenu, type MenuEntry } from '@/ui/Menu';
import { Page, PageHeader } from '@/ui/PageHeader';
import { Skeleton } from '@/ui/Skeleton';
import { useCardActions, type CardActions } from '../shared/actions';
import { CopyWeekPopover, SelectionBar, ShiftPopover, type BulkState } from '../shared/Bulk';
import { CardItem } from '../shared/CardItem';
import { useCalendarModel, useCalendarPages, weekIndexOf, type DayData } from '../shared/data';
import { EventBanner, MarkerGlyphs, RangeBands, ReadinessDot } from '../shared/DayParts';
import { focusDay, onGridTab, useCalendarKeys } from '../shared/keys';
import { cardMenu, dayMenu } from '../shared/menu';
import { QuickAdd } from '../shared/QuickAdd';
import { calStore, useCal, type DragPreview } from '../shared/store';
import { WeekSummaryBlock } from '../shared/Summary';
import { NewButton, PagingControls, ViewSwitcher } from '../shared/Toolbar';
import { DragLayer, useCalendarDrag } from '../shared/useDrag';

function Metrics({ day }: { day: DayData }) {
  const w = day.wellness;
  const cell = (label: string, value: string | null) => (
    <div className="flex items-baseline justify-between gap-1">
      <span className="text-micro uppercase text-fg-3">{label}</span>
      <span className={cn('font-mono text-mono-sm', value ? 'text-fg-1' : 'text-fg-4')}>{value ?? '—'}</span>
    </div>
  );
  return (
    <div className="flex flex-col gap-1 px-2.5 py-2">
      {cell('HRV', w?.hrvMs ? `${Math.round(w.hrvMs)}` : null)}
      {cell('RHR', w?.restingHr ? `${Math.round(w.restingHr)}` : null)}
      {cell('Sleep', w?.sleepSec ? formatDuration(w.sleepSec) : null)}
      <div className="flex items-center justify-between gap-1">
        <span className="text-micro uppercase text-fg-3">Feel</span>
        <span className="flex gap-0.5" role="img" aria-label={w?.feel ? `Feel ${w.feel} of 5` : 'No check-in'}>
          {[1, 2, 3, 4, 5].map((i) => (
            <span key={i} className={cn('size-1.5 rounded-full', w?.feel && i <= w.feel ? 'bg-fg-1' : 'border border-line-3')} />
          ))}
        </span>
      </div>
    </div>
  );
}

interface ColumnProps {
  day: DayData;
  cards: CalendarCard[];
  copyGhost?: CalendarCard;
  today: LocalDate | null;
  weekStart: LocalDate;
  actions: CardActions;
  affected: boolean;
  dayFocus: boolean;
}

const WeekColumn = memo(function WeekColumn({ day, cards, copyGhost, today, weekStart: ws, actions, affected, dayFocus }: ColumnProps) {
  const { date } = day;
  const { setNodeRef, isOver } = useDroppable({ id: date });
  const isCursor = useCal((s) => s.cursor === date || (s.cursor == null && date === today));
  const composing = useCal((s) => s.composer === date);
  const future = today != null && date > today;
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
        'group/day relative flex min-h-[420px] min-w-0 flex-col gap-2 p-2 outline-none transition-[background-color,box-shadow] duration-(--dur-fast)',
        future ? 'bg-canvas' : 'bg-surface-1',
        day.markers.some((m) => m.type === 'sick' || m.type === 'injured') && 'bg-hatch-faint',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
        'data-[over]:bg-accent-a2 data-[over]:ring-1 data-[over]:ring-accent-a5 data-[over]:ring-inset',
      )}
    >
      <RangeBands markers={day.markers} date={date} weekStart={ws} />
      {!day.loaded ? (
        <>
          <Skeleton radius="md" className="h-28" />
          <Skeleton radius="md" className="h-20" />
        </>
      ) : (
        <>
          {day.events.map((e) => (
            <EventBanner key={e.id} e={e} />
          ))}
          {day.markers.some((m) => m.type === 'rest') && cards.length === 0 && (
            <span className="flex items-center gap-1 text-micro uppercase text-fg-3">
              <Moon className="size-3" /> Rest
            </span>
          )}
          <LayoutGroup id={`w-${date}`}>
            <div className="flex flex-col gap-2">
              {cards.map((c) => (
                <Settle key={c.key} id={c.key} layout={affected}>
                  <CardItem
                    card={c}
                    date={date}
                    density="full"
                    actions={actions}
                    zoomName
                    hideSpark
                    trailing={
                      c.model.sparkline && c.model.sparkline.length > 1 ? (
                        <div className="pt-1 pl-6">
                          <MiniProfile values={c.model.sparkline} height={36} />
                        </div>
                      ) : undefined
                    }
                  />
                </Settle>
              ))}
              {copyGhost && <WorkoutCard model={copyGhost.model} density="full" ghost />}
            </div>
          </LayoutGroup>
          {composing ? (
            <QuickAdd date={date} actions={actions} />
          ) : (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => calStore.set({ composer: date, cursor: date })}
              className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-dashed border-line-2 text-label text-fg-3 opacity-0 transition-[opacity,background-color,color] duration-(--dur-fast) group-hover/day:opacity-100 hover:bg-surface-2 hover:text-fg-1 focus-visible:opacity-100"
            >
              <Plus className="size-3.5" /> Add
            </button>
          )}
          {day.note && (
            <Link {...links.calendarDay(date)} className="mt-auto flex items-start gap-1.5 rounded-sm p-1 text-label font-[420] text-fg-2 hover:bg-surface-2">
              <Pilcrow className="mt-0.5 size-3 shrink-0 text-fg-3" />
              <span className="line-clamp-3">{day.note.body.replace(/[#*_>`]/g, '')}</span>
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
              <span className="text-body font-[420] text-fg-3">{formatIsoWeekRange(isoWeek, true)}</span>
              {week.phase && <span className="text-micro uppercase text-fg-3 max-md:hidden">{week.phase.phase.label} · {week.phase.index}/{week.phase.count}</span>}
            </span>
          }
          breadcrumb={[{ label: 'Calendar', link: links.calendar(start) }]}
          toolbar={<ViewSwitcher value="week" onChange={(v) => goView(v, calStore.get().cursor ?? start)} />}
          actions={
            <>
              <PagingControls onPrev={() => page(-1)} onNext={() => page(1)} onToday={goToday} prevLabel="Previous week" nextLabel="Next week" />
              <NewButton date={calStore.get().cursor ?? start} />
            </>
          }
        />
      }
    >
      <section className="rounded-lg border border-line-2 bg-surface-1 p-4 md:p-5">
        <WeekSummaryBlock
          week={week}
          variant="header"
          todayIndex={todayIndex >= 0 ? todayIndex : undefined}
          onCopyWeek={(w, a) => setBulk({ kind: 'copy', isoWeek: w, anchor: a })}
          onShift={(f, a) => setBulk({ kind: 'shift', from: todayIndex >= 0 && today ? today : f, anchor: a })}
        />
      </section>
      {pages.error && !week.loaded ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line-3 p-8 text-center">
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
                data-cal-grid
                role="grid"
                aria-label={`Week ${formatIsoWeek(isoWeek)}`}
                onKeyDown={onGridTab}
                className={cn('grid grid-cols-7 gap-px overflow-clip rounded-lg border border-line-2 bg-line-2', mobile && 'w-[1540px]')}
                style={gridFocus ? vtName('cal-focus') : undefined}
              >
                {week.days.map((d) => {
                  const isToday = d.date === today;
                  return (
                    <div key={`h-${d.date}`} role="columnheader" className={cn('sticky top-(--header-h) z-(--z-sticky) flex h-10 items-center gap-2 px-2.5 glass', isToday && 'shadow-[inset_0_1px_0_var(--color-accent)]', mobile && '[scroll-snap-align:start]')}>
                      <span className="text-micro uppercase text-fg-3">{weekdayShort(d.date)}</span>
                      <Link
                        {...links.calendarDay(d.date)}
                        onClickCapture={() => flushSync(() => calStore.set({ focus: { kind: 'day', date: d.date } }))}
                        className={cn(
                          'flex h-5 min-w-5 items-center justify-center rounded-full px-1 font-mono text-mono-sm transition-colors',
                          isToday ? 'bg-accent font-[600] text-on-accent' : 'text-fg-1 hover:text-accent-ink',
                        )}
                      >
                        {Number(d.date.slice(8))}
                      </Link>
                      <MarkerGlyphs markers={d.markers} />
                      {!(today && d.date > today) && <ReadinessDot w={d.wellness} />}
                      <span className="ml-auto font-mono text-mono-sm text-fg-3">
                        {(() => {
                          const sec = d.cards.reduce((a, c) => a + (c.model.durationSec ?? 0), 0);
                          return sec ? formatDuration(sec) : '';
                        })()}
                      </span>
                    </div>
                  );
                })}
                {week.days.map((d) => {
                  const { cards, copyGhost } = applyPreview(d, preview, previewCard);
                  return (
                    <WeekColumn
                      key={d.date}
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
                {week.days.map((d) => (
                  <div key={`m-${d.date}`} className={cn(today && d.date > today ? 'bg-canvas' : 'bg-surface-1')}>
                    <Metrics day={d} />
                  </div>
                ))}
              </div>
            </div>
          </ContextMenu>
          <DragLayer active={active} density="full" copy={!!preview?.copy} overlayProps={dnd.overlayProps} />
        </DndContext>
      )}
      <SelectionBar model={model} actions={actions} />
      {bulk?.kind === 'copy' && <CopyWeekPopover isoWeek={bulk.isoWeek} anchor={bulk.anchor} model={model} actions={actions} onClose={() => setBulk(null)} />}
      {bulk?.kind === 'shift' && <ShiftPopover from={bulk.from} anchor={bulk.anchor} onClose={() => setBulk(null)} />}
    </Page>
  );
}
