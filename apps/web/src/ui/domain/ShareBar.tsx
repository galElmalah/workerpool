/**
 * ShareBar + Legend — the small "part of a whole" mark for by-sport and intensity breakdowns
 * outside charts (DESIGN_V2 §8). Segments keep the caller's order (pass the fixed sport / zone
 * order), are separated by a 2px surface gap and carry the full data colour; the legend puts a
 * coloured swatch beside ink-coloured text (text never wears the data colour).
 *
 *   <ShareBar parts={[{ key: 'bike', value: 3600, color: sportColor('bike'), label: 'Ride' }, …]} />
 *   <Legend items={[{ key: 'bike', color: sportColor('bike'), label: 'Ride', value: '1:00' }]} />
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface SharePart {
  key: string;
  value: number;
  color: string;
  /** Accessible label of the segment ("Ride 1:00"). */
  label?: string;
}

export interface ShareBarProps {
  parts: readonly SharePart[];
  /** Bar height in px (default 6). */
  height?: number;
  /** Scale against this total instead of the sum (the rest stays empty track). */
  total?: number;
  className?: string;
  'aria-label'?: string;
}

export function ShareBar({ parts, height = 6, total, className, ...aria }: ShareBarProps) {
  const shown = parts.filter((p) => p.value > 0);
  const sum = shown.reduce((a, p) => a + p.value, 0);
  const of = Math.max(total ?? sum, sum, 1e-9);
  return (
    <div
      className={cn('flex w-full overflow-hidden rounded-full', total != null && 'bg-surface-3', className)}
      style={{ height }}
      role={aria['aria-label'] ? 'img' : undefined}
      aria-label={aria['aria-label']}
      aria-hidden={aria['aria-label'] ? undefined : true}
    >
      <div className="flex h-full gap-[2px]" style={{ width: `${(sum / of) * 100}%` }}>
        {shown.map((p) => (
          <span
            key={p.key}
            title={p.label}
            className="h-full min-w-[2px] first:rounded-l-full last:rounded-r-full"
            style={{ flexGrow: p.value, flexBasis: 0, backgroundColor: p.color }}
          />
        ))}
      </div>
    </div>
  );
}

export interface LegendItem {
  key: string;
  color: string;
  label: ReactNode;
  value?: ReactNode;
  /** 'dot' (default), 'line' (for line series) or 'bar' (for filled marks). */
  mark?: 'dot' | 'line' | 'bar';
}

export function Legend({ items, className, vertical }: { items: readonly LegendItem[]; className?: string; vertical?: boolean }) {
  return (
    <ul className={cn('flex text-label text-fg-3', vertical ? 'flex-col gap-1.5' : 'flex-wrap items-center gap-x-4 gap-y-1.5', className)}>
      {items.map((it) => (
        <li key={it.key} className={cn('flex min-w-0 items-center gap-1.5', vertical && 'justify-between gap-3')}>
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              aria-hidden
              className={cn('shrink-0', it.mark === 'line' ? 'h-0.5 w-3 rounded-full' : it.mark === 'bar' ? 'h-2.5 w-2 rounded-[2px]' : 'size-2 rounded-full')}
              style={{ backgroundColor: it.color }}
            />
            <span className="truncate">{it.label}</span>
          </span>
          {it.value != null && <span className="shrink-0 text-fg-2 num">{it.value}</span>}
        </li>
      ))}
    </ul>
  );
}
