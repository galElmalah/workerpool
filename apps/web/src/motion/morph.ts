/**
 * Shared-element morph target — design.md §5.4a.
 *
 * Only ONE element per page may carry each of `wk-card`, `wk-glyph`, `wk-title`. Lists (calendar,
 * agenda, today) render those names only on the item whose id is the current morph target, which
 * is set synchronously on click (capture phase, before TanStack's Link onClick), so the names are
 * in the DOM when the old snapshot is taken. On Back, the source item still matches the target and
 * renders with names again, so the morph reverses. `vtTypes` clears the target when navigation
 * leaves the source ⇄ detail pair.
 */
import { useSyncExternalStore, type CSSProperties } from 'react';

let target: string | null = null;
let source: string | null = null; // pathname the morph started from (for back-focus)
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};

export const morph = {
  set(id: string) {
    target = id;
    source = typeof location !== 'undefined' ? location.pathname : null;
    emit();
  },
  clear() {
    if (target === null) return;
    target = null;
    source = null;
    emit();
  },
  get target() {
    return target;
  },
  get source() {
    return source;
  },
};

export function useIsMorphTarget(id: string | undefined): boolean {
  return useSyncExternalStore(
    subscribe,
    () => id != null && target === id,
    () => false,
  );
}

export type MorphPart = 'card' | 'glyph' | 'title';

/** `style={vt(on, 'card')}` → `{ viewTransitionName: 'wk-card' }` when on. */
export const vt = (on: boolean, n: MorphPart): CSSProperties | undefined => (on ? { viewTransitionName: `wk-${n}` } : undefined);

/** Any registered view-transition name (see the registry in styles/view-transitions.css). */
export const vtName = (name: string | false | null | undefined, cls?: string): CSSProperties | undefined =>
  name ? ({ viewTransitionName: name, ...(cls ? { viewTransitionClass: cls } : null) } as CSSProperties) : undefined;
