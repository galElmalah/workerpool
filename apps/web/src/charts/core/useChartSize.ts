import { useCallback, useLayoutEffect, useRef, useState } from 'react';

export interface Size {
  width: number;
  height: number;
}

/**
 * Observe an element's content box with ResizeObserver. Returns a ref callback and the
 * current size (0×0 until first measured). Widths are floored so pixel math stays crisp.
 */
export function useChartSize<T extends HTMLElement = HTMLDivElement>(): [(el: T | null) => void, Size, T | null] {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [el, setEl] = useState<T | null>(null);
  const ref = useCallback((node: T | null) => setEl(node), []);
  useLayoutEffect(() => {
    if (!el) return;
    const measure = (w: number, h: number) =>
      setSize((s) => (s.width === Math.floor(w) && s.height === Math.floor(h) ? s : { width: Math.floor(w), height: Math.floor(h) }));
    const r = el.getBoundingClientRect();
    measure(r.width, r.height);
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr) measure(cr.width, cr.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [ref, size, el];
}

/**
 * Size a canvas for the device pixel ratio and return a context already scaled so you draw
 * in CSS pixels. Re-applies only when the size or DPR actually changed.
 */
export function fitCanvas(canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(width * dpr));
  const h = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/** Returns a stable function that coalesces calls into one requestAnimationFrame. */
export function useRafCallback(fn: () => void): () => void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const pending = useRef(0);
  return useCallback(() => {
    if (pending.current) return;
    pending.current = requestAnimationFrame(() => {
      pending.current = 0;
      fnRef.current();
    });
  }, []);
}
