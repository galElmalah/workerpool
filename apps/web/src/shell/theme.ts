/**
 * Theme: 'dark' (default) | 'light' | 'system'. Applied as <html data-theme>; persisted per device
 * (index.html sets it before first paint to avoid a flash). The settings page writes it here; the
 * server copy (Settings.theme) can call setTheme on load.
 */
import { useSyncExternalStore } from 'react';

export type ThemePref = 'dark' | 'light' | 'system';
const KEY = 'cadence.theme';
const subs = new Set<() => void>();
const mq = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: light)') : null;

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'system' ? v : 'dark';
  } catch {
    return 'dark';
  }
}

let pref: ThemePref = typeof window !== 'undefined' ? read() : 'dark';

export const resolveTheme = (p: ThemePref): 'dark' | 'light' => (p === 'system' ? (mq?.matches ? 'light' : 'dark') : p);

function apply() {
  if (typeof document === 'undefined') return;
  const t = resolveTheme(pref);
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#fafafa' : '#000000');
}

export function setTheme(next: ThemePref) {
  pref = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* ignore */
  }
  apply();
  subs.forEach((f) => f());
}

export function toggleTheme() {
  setTheme(resolveTheme(pref) === 'dark' ? 'light' : 'dark');
}

mq?.addEventListener('change', () => {
  if (pref === 'system') {
    apply();
    subs.forEach((f) => f());
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
