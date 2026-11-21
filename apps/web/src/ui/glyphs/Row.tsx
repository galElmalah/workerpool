import type { LucideProps } from 'lucide-react';

/** Custom ROW glyph — crossed oars on a waterline (design.md §2.4; Lucide has no rowing icon). */
export function RowGlyph({ size = 16, strokeWidth = 1.75, absoluteStrokeWidth: _a, ...p }: LucideProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
      aria-hidden
      {...p}
    >
      <path d="M4 20 15.5 8.5" />
      <path d="M20 20 8.5 8.5" />
      <path d="M15.5 8.5 18 4.5l1.5 1.5-4 2.5Z" />
      <path d="M8.5 8.5 6 4.5 4.5 6l4 2.5Z" />
      <path d="M3 14h18" opacity=".5" />
    </svg>
  );
}
