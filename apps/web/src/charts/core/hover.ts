/**
 * Shared hover state for synced charts.
 *
 * `HoverSync<K>` is a tiny external store (not React state): charts write the hovered key
 * (a LocalDate, an isoWeek, a duration…) and every subscriber's *overlay* re-renders, never
 * the whole chart. Pass the same instance to several charts to sync their crosshairs.
 *
 * For 1 Hz streams use a `MotionValue<number>` of seconds instead (`useStreamCursor`), which
 * updates at 60 fps without touching React at all.
 */
import { useState, useSyncExternalStore } from 'react';
import { useMotionValue, type MotionValue } from 'motion/react';

export interface HoverSync<K> {
  get(): K | null;
  set(k: K | null, source?: string): void;
  /** Id of the chart that last wrote (lets a chart skip its own tooltip on mirrored hovers). */
  source(): string | undefined;
  subscribe(fn: () => void): () => void;
}

export function createHoverSync<K>(): HoverSync<K> {
  let value: K | null = null;
  let src: string | undefined;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    source: () => src,
    set(k, source) {
      if (k === value && source === src) return;
      value = k;
      src = source;
      subs.forEach((f) => f());
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

/** A stable HoverSync instance owned by the calling component. */
export function useHoverSync<K>(external?: HoverSync<K>): HoverSync<K> {
  const [own] = useState(() => createHoverSync<K>());
  return external ?? own;
}

/** Subscribe to a HoverSync (re-renders only the calling component). */
export function useHoverValue<K>(s: HoverSync<K>): K | null {
  return useSyncExternalStore(s.subscribe, s.get, s.get);
}

/** Shared cursor for StreamChart ↔ RouteMap ↔ anything else: seconds from start, NaN = none. */
export function useStreamCursor(): MotionValue<number> {
  return useMotionValue(Number.NaN);
}
