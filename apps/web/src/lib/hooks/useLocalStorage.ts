import { useCallback, useSyncExternalStore } from 'react';

/**
 * Tiny persisted store per key (localStorage + same-tab broadcast). Values are JSON.
 * Use for per-device UI state only (rail collapsed, last view); user settings live on the server.
 */
const listeners = new Map<string, Set<() => void>>();
const cache = new Map<string, unknown>();

function readKey<T>(key: string, fallback: T): T {
  if (cache.has(key)) return cache.get(key) as T;
  let v: T = fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw != null) v = JSON.parse(raw) as T;
  } catch {
    /* ignore */
  }
  cache.set(key, v);
  return v;
}

export function writeLocal<T>(key: string, value: T) {
  cache.set(key, value);
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
  listeners.get(key)?.forEach((f) => f());
}

export function readLocal<T>(key: string, fallback: T): T {
  return typeof window === 'undefined' ? fallback : readKey(key, fallback);
}

export function useLocalStorage<T>(key: string, fallback: T): [T, (v: T | ((prev: T) => T)) => void] {
  const subscribe = useCallback(
    (cb: () => void) => {
      let set = listeners.get(key);
      if (!set) listeners.set(key, (set = new Set()));
      set.add(cb);
      return () => {
        set.delete(cb);
      };
    },
    [key],
  );
  const value = useSyncExternalStore(
    subscribe,
    () => readKey(key, fallback),
    () => fallback,
  );
  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      const prev = readKey(key, fallback);
      writeLocal(key, typeof v === 'function' ? (v as (p: T) => T)(prev) : v);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  return [value, set];
}
