/**
 * Calendar keyboard model (product.md §3.5): a day cursor (roving tabindex) plus a card
 * sub-cursor. Arrows move ±1 day / ±1 week, Tab cycles cards in the day, ↵ opens, C/N quick-add,
 * T today, K key, 1–5 intensity, Delete with undo, ⌘D duplicate, ⌘C/⌘V copy/paste, M/W/A/D views.
 */
import { useEffect, useRef } from 'react';
import { INTENSITY_CLASSES, type IntensityClass, type LocalDate } from '@cadence/core/domain';
import { addDays } from '@cadence/core/time';
import { useShortcut } from '@/shell/shortcuts';
import type { CardActions } from './actions';
import type { CalendarModel } from './data';
import { calStore } from './store';

const LEVEL: Record<string, IntensityClass> = { '1': 'recovery', '2': 'endurance', '3': 'tempo', '4': 'threshold', '5': 'high' };
void INTENSITY_CLASSES;

export function focusDay(date: LocalDate) {
  requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-day-cell="${date}"]`)?.focus({ preventScroll: true }));
}

const inScope = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  if (!t || t === document.body) return true;
  return !!t.closest('[data-cal-grid]') || t.hasAttribute('data-page-title');
};

export interface CalendarKeysOptions {
  model: CalendarModel;
  actions: CardActions;
  /** Bring a date into view (scroll or navigate). */
  ensureVisible: (date: LocalDate) => void;
  goToday: () => void;
  goView: (view: 'month' | 'week' | 'day' | 'agenda', date: LocalDate) => void;
  onShift?: (date: LocalDate) => void;
  enabled?: boolean;
}

export function useCalendarKeys(o: CalendarKeysOptions) {
  const ref = useRef(o);
  ref.current = o;
  const enabled = o.enabled ?? true;
  const cursor = () => calStore.get().cursor ?? ref.current.model.today ?? null;
  const focusedCard = () => {
    const k = calStore.get().cardKey;
    return k ? ref.current.model.findCard(k) : null;
  };
  const targets = () => {
    const sel = calStore.get().selection;
    if (sel.size) return [...sel].map((k) => ref.current.model.findCard(k)).filter((x) => !!x);
    const f = focusedCard();
    return f ? [f] : [];
  };

  const move = (delta: number) => (e: KeyboardEvent) => {
    if (!inScope(e)) return;
    e.preventDefault();
    const c = cursor();
    if (!c) return;
    const next = addDays(c, delta);
    calStore.set({ cursor: next, cardKey: null, composer: null });
    ref.current.ensureVisible(next);
    focusDay(next);
  };
  const opts = { enabled, preventDefault: false };
  useShortcut('left', move(-1), opts);
  useShortcut('right', move(1), opts);
  useShortcut('up', move(-7), opts);
  useShortcut('down', move(7), opts);
  useShortcut(
    'enter',
    (e) => {
      if (!inScope(e)) return;
      const t = e.target as HTMLElement;
      if (t.closest('[data-card]')) return; // the card handles it
      const c = cursor();
      if (!c) return;
      e.preventDefault();
      ref.current.goView('day', c);
    },
    opts,
  );
  const quick = (e: KeyboardEvent) => {
    const c = cursor();
    if (!c) return;
    e.preventDefault();
    calStore.set({ composer: c, cursor: c });
    ref.current.ensureVisible(c);
  };
  useShortcut('c', quick, opts);
  useShortcut('n', quick, opts);
  useShortcut('t', () => ref.current.goToday(), { enabled });
  useShortcut('m', () => ref.current.goView('month', cursor() ?? ''), { enabled });
  useShortcut('w', () => ref.current.goView('week', cursor() ?? ''), { enabled });
  useShortcut('a', () => ref.current.goView('agenda', cursor() ?? ''), { enabled });
  useShortcut('d', () => ref.current.goView('day', cursor() ?? ''), { enabled });
  useShortcut(
    's',
    (e) => {
      const c = cursor();
      if (c && ref.current.onShift) {
        e.preventDefault();
        ref.current.onShift(c);
      }
    },
    opts,
  );
  useShortcut('k', () => targets().forEach((t) => ref.current.actions.toggleKey(t!.card)), { enabled });
  for (const n of ['1', '2', '3', '4', '5']) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useShortcut(n, () => targets().forEach((t) => ref.current.actions.setIntensity(t!.card, LEVEL[n]!)), { enabled });
  }
  const del = (e: KeyboardEvent) => {
    const ts = targets();
    if (!ts.length || !inScope(e)) return;
    e.preventDefault();
    ref.current.actions.remove(ts.map((t) => t!.card));
    calStore.set({ selection: new Set(), cardKey: null });
    const c = cursor();
    if (c) focusDay(c);
  };
  useShortcut('backspace', del, opts);
  useShortcut('delete', del, opts);
  useShortcut(
    'mod+d',
    (e) => {
      const f = focusedCard();
      if (!f) return;
      e.preventDefault();
      ref.current.actions.duplicate(f.card, addDays(f.date, 1));
    },
    { ...opts, allowInInputs: false },
  );
  useShortcut(
    'mod+c',
    (e) => {
      if (window.getSelection()?.toString()) return;
      const ts = targets().filter((t) => t!.card.workout);
      if (!ts.length) return;
      e.preventDefault();
      calStore.set({ clipboard: ts.map((t) => t!.card.key) });
    },
    { ...opts, allowInInputs: false },
  );
  useShortcut(
    'mod+v',
    (e) => {
      const clip = calStore.get().clipboard.map((k) => ref.current.model.findCard(k)?.card).filter((c) => !!c);
      const c = cursor();
      if (!clip.length || !c) return;
      e.preventDefault();
      ref.current.actions.paste(clip as NonNullable<(typeof clip)[number]>[], c);
    },
    { ...opts, allowInInputs: false },
  );
  useShortcut(
    'esc',
    () => {
      const s = calStore.get();
      if (s.selection.size || s.composer) calStore.set({ selection: new Set(), composer: null });
    },
    opts,
  );

  // reset transient state when the view unmounts
  useEffect(() => () => calStore.set({ composer: null, selection: new Set(), preview: null }), []);
}

/** Tab / Shift-Tab cycle the cards of the cursor day (attach to the grid's onKeyDown). */
export function onGridTab(e: React.KeyboardEvent) {
  if (e.key !== 'Tab') return;
  const s = calStore.get();
  const day = s.cursor && document.querySelector<HTMLElement>(`[data-day-cell="${s.cursor}"]`);
  if (!day) return;
  const cards = [...day.querySelectorAll<HTMLElement>('[data-card] > [role="link"]')];
  if (!cards.length) return;
  const i = cards.findIndex((c) => c === document.activeElement);
  const next = e.shiftKey ? (i <= 0 ? null : cards[i - 1]) : i < 0 ? cards[0] : cards[i + 1];
  if (!next) {
    if (e.shiftKey && i === 0) {
      e.preventDefault();
      calStore.set({ cardKey: null });
      day.focus();
    }
    return; // leave the grid
  }
  e.preventDefault();
  const key = next.parentElement?.getAttribute('data-card');
  if (key) calStore.set({ cardKey: key });
  requestAnimationFrame(() => next.focus());
}
