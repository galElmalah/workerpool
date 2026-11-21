/**
 * Command palette registry — features contribute commands and async search sources.
 *
 *   // static commands while a page is mounted
 *   usePaletteSource({ id: 'calendar', commands: [
 *     { id: 'cal.today', group: 'Calendar', title: 'Jump to today', kbd: 't', perform: () => … },
 *   ] }, []);
 *
 *   // async search (e.g. the /api/search endpoint)
 *   usePaletteSource({ id: 'search', group: 'Workouts', minQuery: 2,
 *     search: async (q, signal) => (await api.search(q, { signal })).map(toCommand) }, []);
 *
 *   palette.open();            // or palette.open('new run')
 */
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';

export interface PaletteCommand {
  /** Stable id (used for recents). */
  id: string;
  title: string;
  /** Secondary text on the right side of the title (date, sport, path). */
  subtitle?: string;
  /** Group heading (micro caps): 'Navigate', 'Create', 'Actions', 'Workouts', … */
  group: string;
  icon?: ReactNode;
  /** Extra match terms (synonyms, abbreviations). */
  keywords?: string[];
  /** Shortcut hint shown at the right ('g c', 'mod+k'). */
  kbd?: string;
  perform: () => void | Promise<void>;
  /** Higher sorts first among equal scores. */
  priority?: number;
  /** Keep the palette open after performing (e.g. toggles). */
  keepOpen?: boolean;
}

export interface PaletteSource {
  id: string;
  /** Default group for this source's commands. */
  group?: string;
  /** Always-available commands (filtered by the fuzzy matcher). */
  commands?: PaletteCommand[] | (() => PaletteCommand[]);
  /** Query-driven results (already filtered by the source); may be async. */
  search?: (query: string, signal: AbortSignal) => Promise<PaletteCommand[]> | PaletteCommand[];
  /** Minimum query length before `search` runs (default 1). */
  minQuery?: number;
}

const sources = new Map<string, PaletteSource>();
let version = 0;
const subs = new Set<() => void>();
const emit = () => {
  version++;
  subs.forEach((f) => f());
};
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};

export function registerPaletteSource(source: PaletteSource): () => void {
  sources.set(source.id, source);
  emit();
  return () => {
    if (sources.get(source.id) === source) {
      sources.delete(source.id);
      emit();
    }
  };
}

export function getPaletteSources(): PaletteSource[] {
  return [...sources.values()];
}

/** Registers a source while the calling component is mounted. */
export function usePaletteSource(source: PaletteSource, deps: unknown[]) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => registerPaletteSource(source), deps);
}

export function usePaletteVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => 0);
}

// ───────────── open state ─────────────
let open = false;
let initialQuery = '';
const openSubs = new Set<() => void>();
const emitOpen = () => openSubs.forEach((f) => f());

export const palette = {
  open(query = '') {
    initialQuery = query;
    open = true;
    emitOpen();
  },
  close() {
    open = false;
    emitOpen();
  },
  toggle() {
    open = !open;
    initialQuery = '';
    emitOpen();
  },
  get isOpen() {
    return open;
  },
  get initialQuery() {
    return initialQuery;
  },
};

export function usePaletteOpen(): boolean {
  return useSyncExternalStore(
    (f) => {
      openSubs.add(f);
      return () => {
        openSubs.delete(f);
      };
    },
    () => open,
    () => false,
  );
}

// ───────────── recents ─────────────
const RECENT_KEY = 'cadence.palette.recent';
export function getRecentIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}
export function pushRecent(id: string) {
  const next = [id, ...getRecentIds().filter((x) => x !== id)].slice(0, 6);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

// ───────────── fuzzy matching ─────────────
/**
 * Subsequence score: consecutive runs and word-start hits score higher; 0 = no match.
 * fuzzyScore('nr', 'New run') > fuzzyScore('nr', 'Garmin sync').
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 1;
  const t = text.toLowerCase();
  const direct = t.indexOf(q);
  if (direct >= 0) return 100 - direct + (direct === 0 || t[direct - 1] === ' ' ? 50 : 0) + q.length * 2;
  let score = 0;
  let ti = 0;
  let run = 0;
  for (const ch of q) {
    if (ch === ' ') continue;
    const at = t.indexOf(ch, ti);
    if (at < 0) return 0;
    const wordStart = at === 0 || t[at - 1] === ' ' || t[at - 1] === '-' || t[at - 1] === '/';
    run = at === ti ? run + 1 : 0;
    score += 1 + (wordStart ? 6 : 0) + run * 3 - Math.min(at - ti, 6) * 0.3;
    ti = at + 1;
  }
  return Math.max(0.1, score);
}

export function scoreCommand(q: string, c: PaletteCommand): number {
  let best = fuzzyScore(q, c.title);
  for (const k of c.keywords ?? []) best = Math.max(best, fuzzyScore(q, k) * 0.9);
  if (c.subtitle) best = Math.max(best, fuzzyScore(q, c.subtitle) * 0.6);
  return best;
}
