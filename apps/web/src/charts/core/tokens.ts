/**
 * Token access for charts. SVG marks use `T.*` (CSS var references, so they follow the
 * theme with zero JS). Canvas renderers call `useCanvasTokens()` which resolves the same
 * tokens to concrete colour strings and re-resolves whenever `<html data-theme>` changes.
 */
import { useEffect, useState } from 'react';

export const T = {
  canvas: 'var(--color-canvas)',
  /** The surface the chart sits on (set `--chart-bg` on a card; defaults to canvas). Used for rings/halos. */
  bg: 'var(--chart-bg, var(--color-canvas))',
  s1: 'var(--color-surface-1)',
  s2: 'var(--color-surface-2)',
  s3: 'var(--color-surface-3)',
  sActive: 'var(--color-surface-active)',
  fg1: 'var(--color-fg-1)',
  fg2: 'var(--color-fg-2)',
  fg3: 'var(--color-fg-3)',
  fg4: 'var(--color-fg-4)',
  line1: 'var(--color-line-1)',
  line2: 'var(--color-line-2)',
  line3: 'var(--color-line-3)',
  accent: 'var(--color-accent)',
  accentInk: 'var(--color-accent-ink)',
  onAccent: 'var(--color-on-accent)',
  a1: 'var(--color-accent-a1)',
  a2: 'var(--color-accent-a2)',
  a3: 'var(--color-accent-a3)',
  a4: 'var(--color-accent-a4)',
  a5: 'var(--color-accent-a5)',
  a6: 'var(--color-accent-a6)',
  a7: 'var(--color-accent-a7)',
  gray: (n: number) => `var(--color-gray-${n})`,
  zone: (n: number) => `var(--color-z${Math.max(1, Math.min(7, Math.round(n)))})`,
  mono: 'var(--font-mono)',
  sans: 'var(--font-sans)',
} as const;

export type Tone = 'accent' | 'fg1' | 'fg2' | 'fg3' | 'fg4';
export const toneStroke: Record<Tone, string> = { accent: T.accent, fg1: T.fg1, fg2: T.fg2, fg3: T.fg3, fg4: T.fg4 };
/** Text colour for a tone: accent text must use accent-ink (light-theme contrast). */
export const toneText: Record<Tone, string> = { accent: T.accentInk, fg1: T.fg1, fg2: T.fg2, fg3: T.fg3, fg4: T.fg3 };

export interface CanvasTokens {
  canvas: string;
  s2: string;
  s3: string;
  fg1: string;
  fg2: string;
  fg3: string;
  fg4: string;
  line1: string;
  line2: string;
  line3: string;
  accent: string;
  accentInk: string;
  a2: string;
  a6: string;
  zones: string[]; // z1..z7
  mono: string;
  sans: string;
  theme: 'dark' | 'light';
}

function read(): CanvasTokens {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    canvas: v('--color-canvas'),
    s2: v('--color-surface-2'),
    s3: v('--color-surface-3'),
    fg1: v('--color-fg-1'),
    fg2: v('--color-fg-2'),
    fg3: v('--color-fg-3'),
    fg4: v('--color-fg-4'),
    line1: v('--color-line-1'),
    line2: v('--color-line-2'),
    line3: v('--color-line-3'),
    accent: v('--color-accent'),
    accentInk: v('--color-accent-ink'),
    a2: v('--color-accent-a2'),
    a6: v('--color-accent-a6'),
    zones: [1, 2, 3, 4, 5, 6, 7].map((i) => v(`--color-z${i}`)),
    mono: v('--font-mono') || 'monospace',
    sans: v('--font-sans') || 'sans-serif',
    theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
  };
}

let cache: CanvasTokens | null = null;
const subs = new Set<(t: CanvasTokens) => void>();
let observing = false;
function ensureObserver() {
  if (observing || typeof window === 'undefined') return;
  observing = true;
  const refresh = () => {
    // Let the style recalc for the new theme land first.
    requestAnimationFrame(() => {
      cache = read();
      subs.forEach((f) => f(cache!));
    });
  };
  new MutationObserver(refresh).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', refresh);
}

export function getCanvasTokens(): CanvasTokens {
  if (!cache) cache = read();
  return cache;
}

/** Resolved token colours for canvas drawing; updates on theme change. */
export function useCanvasTokens(): CanvasTokens {
  const [t, setT] = useState<CanvasTokens>(() => getCanvasTokens());
  useEffect(() => {
    ensureObserver();
    subs.add(setT);
    return () => {
      subs.delete(setT);
    };
  }, []);
  return t;
}
