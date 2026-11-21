/**
 * Keyboard shortcuts — ONE central registry so /settings/shortcuts (and the palette) can list
 * everything. Definitions describe keys + copy; handlers attach with `useShortcut`.
 *
 * Key spec: combos with '+', sequences with a space. 'mod' = ⌘ on macOS, Ctrl elsewhere.
 *   'mod+k'  'g c'  '?'  '['  'shift+w'  'mod+enter'
 *
 *   useShortcut('nav.calendar', () => navigate({ to: '/calendar' }));      // by id (preferred)
 *   useShortcut('m', () => setView('month'), { scope: 'calendar' });      // ad-hoc keys
 *
 * Feature modules add their own definitions at module load with `defineShortcuts([...])` so the
 * reference page lists them even when the feature isn't mounted.
 */
import { useEffect, useRef } from 'react';
import { isMac } from '@/ui/Kbd';

export type ShortcutGroup = 'General' | 'Navigation' | 'Calendar' | 'Workout' | 'Lists';

export interface ShortcutDef {
  id: string;
  keys: string;
  label: string;
  group: ShortcutGroup;
}

const defs = new Map<string, ShortcutDef>();
const listeners = new Set<() => void>();

export function defineShortcuts(list: ShortcutDef[]) {
  for (const d of list) defs.set(d.id, d);
  listeners.forEach((f) => f());
}

/** Every known shortcut grouped in display order. */
export function listShortcuts(): { group: ShortcutGroup; items: ShortcutDef[] }[] {
  const order: ShortcutGroup[] = ['General', 'Navigation', 'Calendar', 'Workout', 'Lists'];
  return order
    .map((group) => ({ group, items: [...defs.values()].filter((d) => d.group === group) }))
    .filter((g) => g.items.length > 0);
}

export const shortcutKeys = (id: string): string | undefined => defs.get(id)?.keys;

// The global map (product.md §3.5 + §8.2). Calendar entries are listed here so the reference is
// complete; the calendar feature attaches their handlers.
defineShortcuts([
  { id: 'palette.open', keys: 'mod+k', label: 'Command palette', group: 'General' },
  { id: 'palette.search', keys: '/', label: 'Search', group: 'General' },
  { id: 'shortcuts.open', keys: '?', label: 'Keyboard shortcuts', group: 'General' },
  { id: 'workout.new', keys: 'n', label: 'New workout', group: 'General' },
  { id: 'rail.toggle', keys: '[', label: 'Collapse / expand sidebar', group: 'General' },
  { id: 'undo', keys: 'mod+z', label: 'Undo last change', group: 'General' },
  { id: 'theme.toggle', keys: 'shift+t', label: 'Toggle light / dark', group: 'General' },
  { id: 'nav.today', keys: 'g t', label: 'Go to Today', group: 'Navigation' },
  { id: 'nav.calendar', keys: 'g c', label: 'Go to Calendar', group: 'Navigation' },
  { id: 'nav.trends', keys: 'g r', label: 'Go to Trends', group: 'Navigation' },
  { id: 'nav.activities', keys: 'g a', label: 'Go to Activities', group: 'Navigation' },
  { id: 'nav.library', keys: 'g l', label: 'Go to Library', group: 'Navigation' },
  { id: 'nav.journal', keys: 'g j', label: 'Go to Journal', group: 'Navigation' },
  { id: 'nav.settings', keys: 'g s', label: 'Go to Settings', group: 'Navigation' },
  { id: 'cal.cursor', keys: 'left right up down', label: 'Move day cursor (↑↓ = ±1 week)', group: 'Calendar' },
  { id: 'cal.open', keys: 'enter', label: 'Open focused card / day', group: 'Calendar' },
  { id: 'cal.quickadd', keys: 'c', label: 'Quick-add on focused day', group: 'Calendar' },
  { id: 'cal.today', keys: 't', label: 'Jump to today', group: 'Calendar' },
  { id: 'cal.goto', keys: 'g g', label: 'Go to date / week', group: 'Calendar' },
  { id: 'cal.month', keys: 'm', label: 'Month view', group: 'Calendar' },
  { id: 'cal.week', keys: 'w', label: 'Week view', group: 'Calendar' },
  { id: 'cal.agenda', keys: 'a', label: 'Agenda view', group: 'Calendar' },
  { id: 'cal.day', keys: 'd', label: 'Day view', group: 'Calendar' },
  { id: 'cal.copy', keys: 'mod+c', label: 'Copy focused card(s) / day(s)', group: 'Calendar' },
  { id: 'cal.cut', keys: 'mod+x', label: 'Cut', group: 'Calendar' },
  { id: 'cal.paste', keys: 'mod+v', label: 'Paste at cursor', group: 'Calendar' },
  { id: 'cal.duplicate', keys: 'mod+d', label: 'Duplicate to next day', group: 'Calendar' },
  { id: 'cal.key', keys: 'k', label: 'Toggle key workout', group: 'Calendar' },
  { id: 'cal.intensity', keys: '1 2 3 4 5', label: 'Set intensity level', group: 'Calendar' },
  { id: 'cal.shift', keys: 's', label: 'Shift plan from here', group: 'Calendar' },
  { id: 'cal.delete', keys: 'backspace', label: 'Delete (with undo)', group: 'Calendar' },
  { id: 'cal.pickup', keys: 'space', label: 'Pick up card (keyboard drag)', group: 'Calendar' },
  { id: 'workout.save', keys: 'mod+enter', label: 'Save', group: 'Workout' },
]);

// ───────────── runtime ─────────────
type Handler = { keys: string; fn: (e: KeyboardEvent) => void; allowInInputs: boolean; prevent: boolean };
const active: Handler[] = [];
let prefix: string | null = null;
let prefixTimer: ReturnType<typeof setTimeout> | null = null;

const KEY_ALIASES: Record<string, string> = {
  ' ': 'space',
  escape: 'esc',
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
  return: 'enter',
  del: 'delete',
};

/** Canonical form of one combo: modifiers in fixed order + key. */
function canon(combo: string): string {
  const parts = combo.toLowerCase().split('+').filter(Boolean);
  const key = KEY_ALIASES[parts.at(-1)!] ?? parts.at(-1)!;
  const mods = new Set(parts.slice(0, -1).map((m) => (m === 'cmd' || m === 'meta' || (m === 'ctrl' && !isMac) ? 'mod' : m)));
  return [...['mod', 'ctrl', 'alt', 'shift'].filter((m) => mods.has(m)), key].join('+');
}
const canonSpec = (spec: string) => spec.trim().split(/\s+/).map(canon).join(' ');

function eventCombo(e: KeyboardEvent): string | null {
  const k = e.key;
  if (k === 'Shift' || k === 'Meta' || k === 'Control' || k === 'Alt' || k === 'Dead') return null;
  const key = KEY_ALIASES[k.toLowerCase()] ?? k.toLowerCase();
  const printableSymbol = k.length === 1 && !/[a-z0-9]/i.test(k);
  const mods: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) mods.push('mod');
  if (isMac && e.ctrlKey) mods.push('ctrl');
  if (e.altKey) mods.push('alt');
  if (e.shiftKey && !printableSymbol) mods.push('shift');
  return [...mods, key].join('+');
}

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
};

function onKeyDown(e: KeyboardEvent) {
  if (e.defaultPrevented || e.isComposing || e.repeat) return;
  const combo = eventCombo(e);
  if (!combo) return;
  const typing = isTyping(e.target);
  const candidates = prefix ? [`${prefix} ${combo}`, combo] : [combo];
  for (const c of candidates) {
    for (let i = active.length - 1; i >= 0; i--) {
      const h = active[i]!;
      if (h.keys !== c) continue;
      if (typing && !h.allowInInputs) continue;
      if (h.prevent) e.preventDefault();
      prefix = null;
      h.fn(e);
      return;
    }
  }
  // Start a sequence if any handler begins with this combo.
  if (!typing && active.some((h) => h.keys.startsWith(`${combo} `))) {
    prefix = combo;
    if (prefixTimer) clearTimeout(prefixTimer);
    prefixTimer = setTimeout(() => (prefix = null), 1000);
    return;
  }
  prefix = null;
}

if (typeof window !== 'undefined') window.addEventListener('keydown', onKeyDown);

export interface UseShortcutOptions {
  enabled?: boolean;
  /** Fire while typing in a field (default: true only for combos with mod/ctrl/alt). */
  allowInInputs?: boolean;
  preventDefault?: boolean;
}

/** Attach a handler to a shortcut id (from the registry) or a raw key spec. Last mounted wins. */
export function useShortcut(idOrKeys: string, handler: (e: KeyboardEvent) => void, opts: UseShortcutOptions = {}) {
  const fn = useRef(handler);
  fn.current = handler;
  const keys = defs.get(idOrKeys)?.keys ?? idOrKeys;
  const enabled = opts.enabled ?? true;
  useEffect(() => {
    if (!enabled) return;
    const spec = canonSpec(keys);
    const h: Handler = {
      keys: spec,
      fn: (e) => fn.current(e),
      allowInInputs: opts.allowInInputs ?? /(^|\+)(mod|ctrl|alt)\+/.test(spec),
      prevent: opts.preventDefault ?? true,
    };
    active.push(h);
    return () => {
      const i = active.indexOf(h);
      if (i >= 0) active.splice(i, 1);
    };
  }, [keys, enabled, opts.allowInInputs, opts.preventDefault]);
}
