/**
 * Motion preference: 'system' (follow prefers-reduced-motion, the default), 'full' or 'reduced'.
 * Persisted per device in localStorage and mirrored to <html data-motion="reduced"> so CSS
 * (transitions, view transitions, skeleton sheen) obeys it too.
 */
import { useSyncExternalStore } from 'react';

export type MotionPref = 'system' | 'full' | 'reduced';
const KEY = 'cadence.motion';
const subs = new Set<() => void>();
const mq = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

function read(): MotionPref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'full' || v === 'reduced' ? v : 'system';
  } catch {
    return 'system';
  }
}

let pref: MotionPref = typeof window !== 'undefined' ? read() : 'system';

function apply() {
  if (typeof document === 'undefined') return;
  const reduced = isReducedMotion();
  if (reduced) document.documentElement.dataset.motion = 'reduced';
  else delete document.documentElement.dataset.motion;
}

export function isReducedMotion(): boolean {
  if (pref === 'reduced') return true;
  if (pref === 'full') return false;
  return mq?.matches ?? false;
}

export function getMotionPref(): MotionPref {
  return pref;
}

export function setMotionPref(next: MotionPref) {
  pref = next;
  try {
    if (next === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    /* private mode */
  }
  apply();
  subs.forEach((f) => f());
}

mq?.addEventListener('change', () => {
  apply();
  subs.forEach((f) => f());
});
apply();

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};

/** The stored preference ('system' | 'full' | 'reduced'). */
export function useMotionPref(): MotionPref {
  return useSyncExternalStore(subscribe, getMotionPref, () => 'system' as const);
}

/** True when motion should be reduced (OS setting or the in-app preference). Use this instead of
 *  Motion's useReducedMotion(), which only knows the OS setting. */
export function useReducedMotionPref(): boolean {
  return useSyncExternalStore(subscribe, isReducedMotion, () => false);
}

/** Value for <MotionConfig reducedMotion>. */
export function useMotionConfigReduced(): 'user' | 'always' | 'never' {
  const p = useMotionPref();
  return p === 'reduced' ? 'always' : p === 'full' ? 'never' : 'user';
}
