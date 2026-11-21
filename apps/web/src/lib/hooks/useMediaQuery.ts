import { useCallback, useSyncExternalStore } from 'react';

/** Subscribes to a media query. SSR/first render fallback = `false`. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Breakpoints mirror the @theme tokens (design.md §4.1). */
export const BP = {
  sm: '(min-width: 40rem)',
  md: '(min-width: 48rem)',
  lg: '(min-width: 64rem)',
  xl: '(min-width: 80rem)',
  coarse: '(pointer: coarse)',
} as const;

/** < 768px: bottom bar, no rail. */
export const useIsMobile = () => !useMediaQuery(BP.md);
/** ≥ 1280px: rail can be expanded inline. */
export const useIsWide = () => useMediaQuery(BP.xl);
