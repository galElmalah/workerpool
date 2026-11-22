/**
 * Token access for charts. SVG marks use `T.*` (CSS var references, so they follow the
 * theme and the accent with zero JS). Canvas renderers call `useCanvasTokens()`, which
 * resolves the same tokens to concrete colour strings the 2D context accepts and re-resolves
 * whenever `<html data-theme | data-accent | class | style>` changes.
 *
 * v2 (DESIGN_V2 §3): every chart text is the UI sans with tabular figures. `T.mono` is kept
 * for API compatibility but resolves to the sans.
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
  /** @deprecated v2 charts use the sans for numbers too; kept as an alias of `sans`. */
  mono: 'var(--font-sans)',
  sans: 'var(--font-sans)',
} as const;

/** The one text style for chart labels and ticks: 12px sans, tabular figures (DESIGN_V2 §3). */
export const TXT = { fontFamily: T.sans, fontSize: 12, fontWeight: 400, letterSpacing: 0, fontVariantNumeric: 'tabular-nums' } as const;

export type Tone = 'accent' | 'fg1' | 'fg2' | 'fg3' | 'fg4';
export const toneStroke: Record<Tone, string> = { accent: T.accent, fg1: T.fg1, fg2: T.fg2, fg3: T.fg3, fg4: T.fg4 };
/** Text colour for a tone: accent text must use accent-ink (light-theme contrast). */
export const toneText: Record<Tone, string> = { accent: T.accentInk, fg1: T.fg1, fg2: T.fg2, fg3: T.fg3, fg4: T.fg3 };

export interface CanvasTokens {
  canvas: string;
  s1: string;
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
  a1: string;
  a2: string;
  a3: string;
  a6: string;
  zones: string[]; // z1..z7
  /** @deprecated alias of `sans` (v2: no mono in charts). */
  mono: string;
  sans: string;
  theme: 'dark' | 'light';
}

// ── resolution ──
// Tokens are var() chains, color-mix() and relative-colour expressions. A canvas 2D context
// does not understand var() and (depending on the browser) not color-mix() / `oklch(from …)`
// either, so each token is resolved through a probe element's computed `color`, checked
// against a scratch context, and as a last resort converted to plain rgba() via an sRGB mix.
let probe: HTMLSpanElement | null = null;
let scratch: CanvasRenderingContext2D | null = null;

function ensureProbe() {
  if (!probe) {
    probe = document.createElement('span');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;';
    (document.body ?? document.documentElement).appendChild(probe);
  }
  if (!probe.isConnected) (document.body ?? document.documentElement).appendChild(probe);
  if (!scratch) scratch = document.createElement('canvas').getContext('2d');
  return probe;
}

function canvasAccepts(c: string) {
  if (!scratch) return true;
  scratch.fillStyle = '#010203';
  scratch.fillStyle = c;
  return scratch.fillStyle !== '#010203';
}

const SRGB = /color\(srgb\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)(?:\s*\/\s*([-\d.e]+%?))?\s*\)/;

function resolveColor(css: string): string {
  const el = ensureProbe();
  el.style.color = '';
  el.style.color = css;
  const c = getComputedStyle(el).color;
  if (c && canvasAccepts(c)) return c;
  // Fallback: force an sRGB serialisation and convert it to rgba() ourselves.
  el.style.color = `color-mix(in srgb, ${css} 100%, transparent)`;
  const s = getComputedStyle(el).color;
  const m = SRGB.exec(s);
  if (m) {
    const ch = (v: string) => Math.round(Math.max(0, Math.min(1, parseFloat(v))) * 255);
    const a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return `rgba(${ch(m[1])}, ${ch(m[2])}, ${ch(m[3])}, ${a})`;
  }
  return s || c || '#888';
}

function read(): CanvasTokens {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => resolveColor(`var(${n})`);
  const tokens: CanvasTokens = {
    canvas: v('--color-canvas'),
    s1: v('--color-surface-1'),
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
    a1: v('--color-accent-a1'),
    a2: v('--color-accent-a2'),
    a3: v('--color-accent-a3'),
    a6: v('--color-accent-a6'),
    zones: [1, 2, 3, 4, 5, 6, 7].map((i) => v(`--color-z${i}`)),
    mono: cs.getPropertyValue('--font-sans').trim() || 'sans-serif',
    sans: cs.getPropertyValue('--font-sans').trim() || 'sans-serif',
    theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
  };
  if (probe) probe.style.color = '';
  return tokens;
}

let cache: CanvasTokens | null = null;
const subs = new Set<(t: CanvasTokens) => void>();
let observing = false;
function ensureObserver() {
  if (observing || typeof window === 'undefined') return;
  observing = true;
  const refresh = () => {
    // Let the style recalc for the new theme / accent land first.
    requestAnimationFrame(() => {
      cache = read();
      subs.forEach((f) => f(cache!));
    });
  };
  new MutationObserver(refresh).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent', 'class', 'style'] });
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', refresh);
}

export function getCanvasTokens(): CanvasTokens {
  if (!cache) cache = read();
  return cache;
}

/** Resolved token colours for canvas drawing; updates on theme and accent change. */
export function useCanvasTokens(): CanvasTokens {
  const [t, setT] = useState<CanvasTokens>(() => getCanvasTokens());
  useEffect(() => {
    ensureObserver();
    subs.add(setT);
    // The cache may predate a theme/accent change made while no chart was mounted.
    const fresh = read();
    cache = fresh;
    setT(fresh);
    return () => {
      subs.delete(setT);
    };
  }, []);
  return t;
}
