/**
 * Theme + accent (DESIGN_V2 §2).
 *
 * Theme: 'dark' (default) | 'light' | 'system' → <html data-theme>.
 * Accent: 'blue' (default) | 'green' | 'rose'    → <html data-accent>.
 *
 * Both are persisted per device in localStorage (`cadence.theme`, `cadence.accent`) and applied by
 * index.html before first paint (no flash). The accent is also an account setting
 * (`Settings.accent`): the shell calls `syncAccentFromServer` when settings load, and the Settings →
 * Appearance picker calls `setAccent(a)` and saves `{ accent: a }` to the server.
 * `<meta name="theme-color">` follows the resolved theme AND accent (the canvas is hue-tinted).
 */
import type { Accent } from '@cadence/core';
import { useSyncExternalStore } from 'react';

export type ThemePref = 'dark' | 'light' | 'system';
export type AccentPref = Accent;
export const ACCENT_OPTIONS: readonly { value: AccentPref; label: string }[] = [
  { value: 'blue', label: 'Blue' },
  { value: 'green', label: 'Green' },
  { value: 'rose', label: 'Rose' },
];

const KEY = 'cadence.theme';
const ACCENT_KEY = 'cadence.accent';
const subs = new Set<() => void>();
const mq = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: light)') : null;

/** Canvas colour per theme × accent (oklch(0.165 0.006 h) / oklch(0.974 0.004 h)), for theme-color. */
const CANVAS_HEX: Record<'dark' | 'light', Record<AccentPref, string>> = {
  dark: { blue: '#0c0f11', green: '#0c0f0d', rose: '#110d0e' },
  light: { blue: '#f4f7f9', green: '#f4f7f5', rose: '#f9f5f6' },
};

const isAccent = (v: unknown): v is AccentPref => v === 'blue' || v === 'green' || v === 'rose';

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'system' ? v : 'dark';
  } catch {
    return 'dark';
  }
}
function readAccent(): AccentPref {
  try {
    const v = localStorage.getItem(ACCENT_KEY);
    return isAccent(v) ? v : 'blue';
  } catch {
    return 'blue';
  }
}

let pref: ThemePref = typeof window !== 'undefined' ? read() : 'dark';
let accent: AccentPref = typeof window !== 'undefined' ? readAccent() : 'blue';

export const resolveTheme = (p: ThemePref): 'dark' | 'light' => (p === 'system' ? (mq?.matches ? 'light' : 'dark') : p);

function apply() {
  if (typeof document === 'undefined') return;
  const t = resolveTheme(pref);
  const root = document.documentElement;
  root.dataset.theme = t;
  root.dataset.accent = accent;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CANVAS_HEX[t][accent]);
}

const emit = () => subs.forEach((f) => f());

export function setTheme(next: ThemePref) {
  pref = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* ignore */
  }
  apply();
  emit();
}

export function toggleTheme() {
  setTheme(resolveTheme(pref) === 'dark' ? 'light' : 'dark');
}

/** Applies and persists the accent on this device (instant). Callers that own the account setting
 *  also save it: `setAccent(a); saver.save({ accent: a })`. Invalid values are ignored. */
export function setAccent(next: AccentPref) {
  if (!isAccent(next) || next === accent) return;
  accent = next;
  try {
    localStorage.setItem(ACCENT_KEY, next);
  } catch {
    /* ignore */
  }
  apply();
  emit();
}

/** Server → device: adopt the account's accent when settings load or change elsewhere. */
export function syncAccentFromServer(serverAccent: string | undefined | null) {
  if (isAccent(serverAccent)) setAccent(serverAccent);
}

export function getAccent(): AccentPref {
  return accent;
}

mq?.addEventListener('change', () => {
  if (pref === 'system') {
    apply();
    emit();
  }
});
apply();

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};

export function useTheme(): { pref: ThemePref; resolved: 'dark' | 'light'; setTheme: typeof setTheme } {
  const p = useSyncExternalStore(subscribe, () => pref, () => 'dark' as ThemePref);
  return { pref: p, resolved: resolveTheme(p), setTheme };
}

/** `const { accent, setAccent } = useAccent()` — re-renders when the accent changes. */
export function useAccent(): { accent: AccentPref; setAccent: typeof setAccent } {
  const a = useSyncExternalStore(subscribe, () => accent, () => 'blue' as AccentPref);
  return { accent: a, setAccent };
}
