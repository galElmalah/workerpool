/**
 * Tiny external store for calendar UI state that many cells read but few change: the keyboard day
 * cursor, the focused card, the multi-selection, the open quick-add composer, the drag preview
 * and the zoom focus target. Cells subscribe with selectors, so moving the cursor re-renders two
 * cells, not the grid.
 */
import { useSyncExternalStore } from 'react';
import type { LocalDate } from '@cadence/core/domain';

export interface DragPreview {
  key: string;
  from: LocalDate;
  to: LocalDate;
  copy: boolean;
}

export interface CalState {
  cursor: LocalDate | null;
  cardKey: string | null;
  selection: ReadonlySet<string>;
  composer: LocalDate | null;
  preview: DragPreview | null;
  /** Which element carries `cal-focus` for the month ⇄ week ⇄ day zoom. */
  focus: { kind: 'week'; start: LocalDate } | { kind: 'day'; date: LocalDate } | null;
  clipboard: string[];
}

let state: CalState = { cursor: null, cardKey: null, selection: new Set(), composer: null, preview: null, focus: null, clipboard: [] };
const subs = new Set<() => void>();

export const calStore = {
  get: () => state,
  set(patch: Partial<CalState> | ((s: CalState) => Partial<CalState>)) {
    const p = typeof patch === 'function' ? patch(state) : patch;
    state = { ...state, ...p };
    subs.forEach((f) => f());
  },
  subscribe(f: () => void) {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },
};

export function useCal<T>(sel: (s: CalState) => T): T {
  return useSyncExternalStore(calStore.subscribe, () => sel(state), () => sel(state));
}
