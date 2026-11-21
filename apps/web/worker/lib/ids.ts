export type IdPrefix = 'wk' | 'act' | 'tpl' | 'evt' | 'ph' | 'mk' | 'thr' | 'log' | 'ser';

/** Prefixed, URL-safe, sortable-enough random id, e.g. `wk_m3k2a9x0q1`. */
export function newId(prefix: IdPrefix): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let s = '';
  for (const b of bytes) s += (b % 36).toString(36);
  return `${prefix}_${s}`;
}

export const nowIso = (): string => new Date().toISOString();
