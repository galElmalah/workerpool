/**
 * Class-name joiner (no tailwind-merge in the bundle). Components put the caller's `className`
 * LAST, so for single-property overrides prefer utilities that don't collide with the base
 * (or use the `!` important modifier, e.g. `!h-8`).
 */
export type ClassValue = string | number | false | null | undefined | ClassValue[] | Record<string, unknown>;

export function cn(...values: ClassValue[]): string {
  const out: string[] = [];
  const walk = (v: ClassValue) => {
    if (!v) return;
    if (typeof v === 'string' || typeof v === 'number') out.push(String(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else for (const k in v) if (v[k]) out.push(k);
  };
  values.forEach(walk);
  return out.join(' ');
}
