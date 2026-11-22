/**
 * The infinite month view (product.md §3.1–3.7, DESIGN_V2 §5): virtualized week rows (±10 years,
 * measured heights), windowed 12-week fetching merged seamlessly, sticky weekday header, one-line
 * chips with hover cards, a three-line weekly summary column, drag & drop with live reflow + undo,
 * inline quick-add, context menu, keyboard grid, multi-select and the bulk week tools.
 */
import { DndContext } from '@dnd-kit/core';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import { animate } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { RotateCcw, TriangleAlert } from 'lucide-react';
import type { LocalDate } from '@cadence/core/domain';
import { addDays, isoWeekOf, weekStart } from '@cadence/core/time';
import { cn } from '@/lib/cn';
import { formatMonthYearLong, weekdayShort } from '@/lib/format';
import { BP, useMediaQuery } from '@/lib/hooks/useMediaQuery';
import { localToday } from '@/lib/hooks/useToday';
import { useSettings } from '@/lib/queries/shared';
import { isReducedMotion } from '@/motion/prefs';
import { tween } from '@/motion/tokens';
import { links } from '@/shell/links';
import { Button } from '@/ui/Button';
import { calendarCollision } from '@/ui/dnd';
import { ContextMenu, type MenuEntry } from '@/ui/Menu';
import { Page, PageHeader } from '@/ui/PageHeader';
import { useCardActions } from '../shared/actions';
import { CopyWeekPopover, SelectionBar, ShiftPopover, type BulkState } from '../shared/Bulk';
import type { CalDensity } from '../shared/CardItem';
import { useCalendarModel, useCalendarPages, weekIndexOf, weekStartOf } from '../shared/data';
import { focusDay, onGridTab, useCalendarKeys } from '../shared/keys';
import { cardMenu, dayMenu } from '../shared/menu';
import { calStore, useCal } from '../shared/store';
import { DragLayer, useCalendarDrag } from '../shared/useDrag';
import { NewButton, PagingControls, RollingTitle, ViewSwitcher } from '../shared/Toolbar';
import { PeekLayer } from '../shared/Peek';
import { COL_GAP, COLS, WeekRow, type MonthLayout } from './WeekRow';

const HALF = 520; // weeks each side of the anchor: effectively infinite
const ROWS = HALF * 2 + 1;
const EST: Record<MonthLayout, number> = { xl: 140, lg: 140, md: 176, sm: 120 };
const WEEKDAYS = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'];

/** Remembered position for Back navigation (card → page → back lands where you were). */
let saved: { href: string; row: number; within: number; base: number } | null = null;

/**
 * xl = the three-line summary column (only when the grid is wide enough to keep chip titles
 * legible); md = summaries as a line under each week; sm = phone (compact rows).
 */
function useLayoutMode(ref: React.RefObject<HTMLElement | null>): MonthLayout {
  const md = useMediaQuery(BP.md);
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1360);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWide(e!.contentRect.width >= 1060));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, md]);
  return !md ? 'sm' : wide ? 'xl' : 'md';
}

export function MonthView({ anchor }: { anchor?: LocalDate }) {
  const navigate = useNavigate();
  const router = useRouter();
  const settings = useSettings();
  const scrollRef = useRef<HTMLDivElement>(null);
  const layout = useLayoutMode(scrollRef);
  const est = EST[layout];
  const guess = useMemo(() => anchor ?? localToday(settings.data?.timezone), [anchor, settings.data?.timezone]);
  const href = typeof location !== 'undefined' ? location.pathname + location.search : '';
  const restore = saved && saved.href === href ? saved : null;
  const [base] = useState(() => (restore ? restore.base : weekIndexOf(guess) - HALF));
  const anchorRow = weekIndexOf(guess) - base;
  const headerRef = useRef<HTMLDivElement>(null);
  const [dayW, setDayW] = useState(140);
  const actions = useCardActions();
  const [bulk, setBulk] = useState<BulkState>(null);
  const [menu, setMenu] = useState<MenuEntry[]>([]);
  const preview = useCal((s) => s.preview);
  const focus = useCal((s) => s.focus);

  // ── rows that must stay mounted (drag source/target) ──
  const keep = useRef<number[]>([]);
  const virtualizer = useVirtualizer({
    count: ROWS,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => est,
    overscan: 4,
    initialOffset: () => (restore ? restore.row * est + restore.within : Math.max(0, anchorRow - 1) * est),
    rangeExtractor: (r) => {
      const out = new Set<number>();
      for (let i = Math.max(0, r.startIndex - r.overscan); i <= Math.min(r.count - 1, r.endIndex + r.overscan); i++) out.add(i);
      keep.current.forEach((i) => i >= 0 && i < r.count && out.add(i));
      return [...out].sort((a, b) => a - b);
    },
  });
  const items = virtualizer.getVirtualItems();
  const range = virtualizer.range ?? { startIndex: anchorRow, endIndex: anchorRow + 4 };
  const pages = useCalendarPages(base + Math.max(0, range.startIndex - 8), base + range.endIndex + 8);
  const model = useCalendarModel(pages.data);
  const today = model.today;

  // keep the drag source + target rows mounted
  keep.current = preview ? [weekIndexOf(preview.from) - base, weekIndexOf(preview.to) - base] : [];

  // ── measure the day column width once per resize (one observer, not per card) ──
  useLayoutEffect(() => {
    const el = headerRef.current?.querySelector<HTMLElement>('[data-col="0"]');
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setDayW(Math.round(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout]);
  const density: CalDensity = dayW < 72 ? 'mini' : 'chip';

  // ── remember position for Back ──
  useEffect(() => {
    return () => {
      const off = virtualizer.scrollOffset ?? 0;
      const top = virtualizer.getVirtualItems().find((it) => it.end > off);
      if (top) saved = { href, row: top.index, within: Math.max(0, off - top.start), base };
    };
  }, [virtualizer, href, base]);
  // The router's own scroll restoration re-applies the old raw scrollTop after we mount, which no
  // longer matches once rows are re-measured; re-pin the remembered row (and the anchor row on a
  // fresh load) a few times while the view transition and first measurements settle.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const row = restore ? restore.row : Math.max(0, anchorRow - 1);
    const within = restore ? restore.within : 0;
    const pin = () => {
      const off = virtualizer.getOffsetForIndex(row, 'start')?.[0];
      if (off != null && Math.abs(el.scrollTop - (off + within)) > 2) el.scrollTop = off + within;
    };
    let cancelled = false;
    const stop = () => (cancelled = true);
    el.addEventListener('wheel', stop, { once: true, passive: true });
    el.addEventListener('pointerdown', stop, { once: true });
    el.addEventListener('keydown', stop, { once: true });
    const timers = [0, 60, 180, 400].map((ms) => setTimeout(() => !cancelled && pin(), ms));
    return () => {
      timers.forEach(clearTimeout);
      el.removeEventListener('wheel', stop);
      el.removeEventListener('pointerdown', stop);
      el.removeEventListener('keydown', stop);
    };
    // mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── scrolling to a date (today jump: teleport to ±4 weeks, then a capped tween) ──
  const scrollToDate = useCallback(
    (date: LocalDate, smooth = true) => {
      const el = scrollRef.current;
      if (!el) return;
      const row = weekIndexOf(date) - base;
      const target = Math.max(0, row - 1);
      const offset = virtualizer.getOffsetForIndex(target, 'start')?.[0] ?? target * est;
      const from = el.scrollTop;
      if (!smooth || isReducedMotion()) {
        virtualizer.scrollToIndex(target, { align: 'start' });
        return;
      }
      const span = 4 * est;
      const start = Math.abs(offset - from) > span ? offset - Math.sign(offset - from) * span : from;
      el.scrollTop = start;
      animate(start, offset, {
        ...tween('slow', 'out'),
        onUpdate: (v) => (el.scrollTop = v),
        onComplete: () => virtualizer.scrollToIndex(target, { align: 'start' }),
      });
    },
    [base, est, virtualizer],
  );

  // anchor changes while mounted (palette "dec 24", ?date=) → scroll there
  const lastAnchor = useRef(anchor);
  useEffect(() => {
    if (anchor && anchor !== lastAnchor.current) scrollToDate(anchor);
    lastAnchor.current = anchor;
  }, [anchor, scrollToDate]);
  // the API's `today` wins over the browser's guess
  const settled = useRef(false);
  useEffect(() => {
    if (!today || settled.current) return;
    settled.current = true;
    if (!anchor && !restore && weekStart(today) !== weekStart(guess)) scrollToDate(today, false);
    if (!calStore.get().cursor) calStore.set({ cursor: anchor ?? today });
  }, [today, anchor, guess, restore, scrollToDate]);

  // warm the week/day route chunks so the zoom never waits on a lazy import
  useEffect(() => {
    if (!today) return;
    const id = setTimeout(() => {
      void router.preloadRoute(links.calendarWeek(isoWeekOf(today))).catch(() => {});
      void router.preloadRoute(links.calendarDay(today)).catch(() => {});
    }, 600);
    return () => clearTimeout(id);
  }, [router, today]);

  const goToday = useCallback(() => {
    if (!today) return;
    calStore.set({ cursor: today, cardKey: null });
    scrollToDate(today);
  }, [today, scrollToDate]);

  const ensureVisible = useCallback(
    (date: LocalDate) => {
      const row = weekIndexOf(date) - base;
      const el = scrollRef.current;
      const it = virtualizer.measurementsCache[row];
      if (!el || !it) return;
      const top = el.scrollTop + 32;
      if (it.start < top || it.end > el.scrollTop + el.clientHeight) virtualizer.scrollToIndex(row, { align: it.start < top ? 'start' : 'end' });
    },
    [base, virtualizer],
  );

  const goView = useCallback(
    (view: 'month' | 'week' | 'day' | 'agenda', date: LocalDate) => {
      const d = date || today || guess;
      if (view === 'month') return;
      if (view === 'week') {
        flushSync(() => calStore.set({ focus: { kind: 'week', start: weekStart(d) }, cursor: d }));
        void navigate(links.calendarWeek(isoWeekOf(d)));
      } else if (view === 'day') {
        flushSync(() => calStore.set({ focus: { kind: 'day', date: d }, cursor: d }));
        void navigate(links.calendarDay(d));
      } else void navigate(links.agenda(d));
    },
    [navigate, today, guess],
  );

  const openShift = useCallback(
    (date: LocalDate) => {
      const a = document.querySelector<HTMLElement>(`[data-week="${weekStart(date)}"] [data-summary]`);
      if (a) setBulk({ kind: 'shift', from: date, anchor: a });
    },
    [],
  );
  useCalendarKeys({ model, actions, ensureVisible, goToday, goView, onShift: openShift });

  // ── drag & drop ──
  const { sensors, dnd, preview: _p, previewCard, active } = useCalendarDrag(model, actions);
  void _p;

  // ── context menu: one menu for the whole grid; items depend on what was right-clicked ──
  const onContextMenuCapture = (e: React.MouseEvent) => {
    const t = e.target as Element;
    const cardKey = t.closest('[data-card]')?.getAttribute('data-card');
    const date = t.closest('[data-day-cell]')?.getAttribute('data-day-cell');
    const f = cardKey ? model.findCard(cardKey) : null;
    if (f) {
      calStore.set({ cardKey: f.card.key, cursor: f.date });
      setMenu(cardMenu(f.card, f.date, actions));
    } else if (date) {
      calStore.set({ cursor: date });
      const clip = calStore.get().clipboard.map((k) => model.findCard(k)?.card).filter((c) => !!c);
      setMenu(dayMenu(date, actions, { paste: clip as never, openDay: () => goView('day', date), newWorkout: () => void navigate(links.newWorkout({ date })) }));
    } else setMenu([]);
  };

  // ── month label: the month of the top row's last day ──
  const off = virtualizer.scrollOffset ?? 0;
  const topItem = items.find((it) => it.end > off + 40) ?? items[0];
  const topStart = topItem ? weekStartOf(base + topItem.index) : weekStart(guess);
  const month = addDays(topStart, 6).slice(0, 7);
  const prevMonth = useRef(month);
  const dir = month >= prevMonth.current ? 1 : -1;
  useEffect(() => void (prevMonth.current = month), [month]);
  // The header only re-renders when the month changes: re-rendering the segmented control's
  // layoutId thumb on every row change would make Motion re-measure the page while scrolling.
  const header = useMemo(() => {
    const stepMonth = (n: number) => {
      const [y, m] = month.split('-').map(Number) as [number, number];
      const d = new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
      scrollToDate(addDays(d, 7));
    };
    return (
      <PageHeader
        variant="compact"
        titleText="Calendar"
        title={<RollingTitle text={formatMonthYearLong(month)} dir={dir} />}
        toolbar={<ViewSwitcher value="month" onChange={(v) => goView(v, calStore.get().cursor ?? today ?? guess)} />}
        actions={
          <>
            <PagingControls onPrev={() => stepMonth(-1)} onNext={() => stepMonth(1)} onToday={goToday} prevLabel="Previous month" nextLabel="Next month" />
            <NewButton />
          </>
        }
      />
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, today, goView, goToday, scrollToDate]);

  const onCopyWeek = useCallback((isoWeek: string, a: HTMLElement) => setBulk({ kind: 'copy', isoWeek, anchor: a }), []);
  const onShiftWeek = useCallback(
    (from: string, a: HTMLElement) => setBulk({ kind: 'shift', from: today && weekStart(today) === from ? today : from, anchor: a }),
    [today],
  );
  const focusWeekStart = focus?.kind === 'week' ? focus.start : null;
  const focusDayDate = focus?.kind === 'day' ? focus.date : null;
  const affected = dnd.affected.size ? dnd.affected : null;

  return (
    <Page
      width="full"
      stagger={false}
      className="!gap-0 !pt-0 !pb-0"
      header={header}
    >
      <DndContext {...dnd.contextProps} sensors={sensors} collisionDetection={calendarCollision} autoScroll={{ threshold: { x: 0, y: 0.12 }, acceleration: 12 }}>
        <ContextMenu items={menu} className="block">
          <div
            ref={scrollRef}
            data-cal-grid
            role="grid"
            aria-label="Training calendar"
            aria-rowcount={ROWS}
            onContextMenuCapture={onContextMenuCapture}
            onKeyDown={onGridTab}
            className="relative -mx-4 overflow-y-auto overscroll-contain px-4 md:-mx-6 md:px-6 xl:-mx-6 xl:px-3"
            style={{ height: 'calc(100dvh - var(--header-h) - 1px - var(--bottom-bar-h))', scrollbarGutter: 'stable' }}
          >
            <div ref={headerRef} role="row" className="sticky top-0 z-(--z-sticky) flex bg-canvas" aria-hidden>
              <div className="grid min-w-0 flex-1" style={{ gridTemplateColumns: COLS[layout], columnGap: COL_GAP[layout] }}>
                {WEEKDAYS.map((d, i) => (
                  <div key={d} data-col={i} className={cn('flex h-8 items-center text-label text-fg-3', layout === 'sm' ? 'justify-center' : 'px-2')}>
                    {layout === 'sm' ? weekdayShort(d).slice(0, 1) : weekdayShort(d)}
                  </div>
                ))}
                {(layout === 'xl' || layout === 'lg') && <div className="flex h-8 items-center px-5 text-label text-fg-3">Week</div>}
              </div>
            </div>
            {pages.error && !pages.data.some(Boolean) ? (
              <div className="mx-auto mt-16 flex max-w-md flex-col items-center gap-3 rounded-lg bg-surface-1 p-6 text-center">
                <TriangleAlert className="size-5 text-fg-1" />
                <p className="text-body text-fg-1">The calendar couldn&apos;t load.</p>
                <p className="text-body-sm text-fg-2">{pages.error.message}</p>
                <Button size="sm" icon={<RotateCcw />} onClick={pages.refetch}>
                  Retry
                </Button>
              </div>
            ) : (
              <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                {items.map((it) => {
                  const start = weekStartOf(base + it.index);
                  const week = model.getWeek(start);
                  const end = addDays(start, 6);
                  const pv = preview && ((preview.from >= start && preview.from <= end) || (preview.to >= start && preview.to <= end)) ? preview : null;
                  return (
                    <WeekRow
                      key={it.key}
                      index={it.index}
                      measureRef={virtualizer.measureElement}
                      y={it.start}
                      week={week}
                      layout={layout}
                      density={density}
                      today={today}
                      actions={actions}
                      preview={pv}
                      previewCard={pv ? previewCard : null}
                      affected={affected && [...affected].some((d) => d >= start && d <= end) ? affected : null}
                      focusWeek={focusWeekStart === start}
                      focusDay={focusDayDate && focusDayDate >= start && focusDayDate <= end ? focusDayDate : null}
                      onCopyWeek={onCopyWeek}
                      onShift={onShiftWeek}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </ContextMenu>
        <DragLayer active={active} density={density} copy={!!preview?.copy} overlayProps={dnd.overlayProps} />
      </DndContext>
      <PeekLayer model={model} />
      <SelectionBar model={model} actions={actions} />
      {bulk?.kind === 'copy' && <CopyWeekPopover isoWeek={bulk.isoWeek} anchor={bulk.anchor} model={model} actions={actions} onClose={() => setBulk(null)} />}
      {bulk?.kind === 'shift' && <ShiftPopover from={bulk.from} anchor={bulk.anchor} onClose={() => setBulk(null)} />}
    </Page>
  );
}

export { focusDay };
