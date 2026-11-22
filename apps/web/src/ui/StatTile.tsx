/**
 * StatTile — DESIGN_V2 §3/§5: label (13px fg-3) · value (fg-1, Ticker, tabular) + unit (fg-3, one
 * step down) · ONE context line. Quiet by default: no border, no fill, never accent.
 *
 *  - Context line = `delta` (DeltaBadge, with `deltaSuffix`) and/or `hint`, on one line under the
 *    value. Pick one piece of context; both fit only when short.
 *  - `sparkline`: a small neutral (fg-3) 64×20 bar strip right of the value — only when the trend
 *    is the point; never decorative.
 *  - `signal` is accepted for compatibility and no longer colours the value (numbers are fg-1).
 *  - Default `variant="plain"`: sits directly on the canvas or inside a shared card. Put a row of
 *    tiles in ONE surface with <StatRow card> rather than giving every tile its own box.
 *    `variant="card"` = a standalone surface-1 tile (no border).
 *  - Sizes: `sm` 20px · `md` 28px (default) · `lg`/`xl` 44px display (one per page at most).
 * Loading = <StatTile.Skeleton/> of the same size (wrap both in <Crossfade>).
 *
 *   <StatRow card><StatTile label="Fitness" value={84} delta={0.06} good deltaSuffix="vs last wk" /> …</StatRow>
 *   <StatTile label="Time" value={34200} format={(s) => formatDuration(s)} unit="h" hint="of 9:45" />
 */
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Ticker } from '@/motion/Ticker';
import { spring, tween } from '@/motion/tokens';
import { DeltaBadge } from './domain/DeltaBadge';
import { MiniProfile } from './domain/MiniProfile';
import { Skeleton } from './Skeleton';

type TileSize = 'sm' | 'md' | 'lg' | 'xl';

export interface StatTileProps {
  label: ReactNode;
  value: number | null | undefined;
  format?: (n: number) => string;
  unit?: ReactNode;
  /** Fractional delta (0.12 = +12%) or absolute with deltaKind="number". */
  delta?: number | null;
  deltaKind?: 'percent' | 'number';
  deltaSuffix?: string;
  /** The delta's direction is good: its arrow wears the `good` status colour. */
  good?: boolean;
  /** The delta's direction is bad: its arrow wears the `warn` status colour. */
  bad?: boolean;
  warning?: boolean;
  /** 0..1 values (or raw; normalized) for a small neutral bar sparkline. */
  sparkline?: number[];
  /** Context text on the context line (e.g. "of 9:45", "vs 9:26 last week"). */
  hint?: ReactNode;
  size?: TileSize;
  /** @deprecated v2: values are always fg-1. Accepted and ignored. */
  signal?: boolean;
  className?: string;
  /** Same as `variant="plain"` (kept for compatibility). */
  bare?: boolean;
  /** 'plain' (default): no fill · 'card': standalone surface-1 tile. */
  variant?: 'plain' | 'card';
  onClick?: () => void;
}

const valueSize: Record<TileSize, string> = { sm: 'text-stat-md', md: 'text-stat-lg', lg: 'text-stat-xl', xl: 'text-stat-xl' };
const unitSize: Record<TileSize, string> = { sm: 'text-body-lg', md: 'text-title-2', lg: 'text-title-1', xl: 'text-title-1' };

export function StatTile({
  label,
  value,
  format,
  unit,
  delta,
  deltaKind = 'percent',
  deltaSuffix,
  good,
  bad,
  warning,
  sparkline,
  hint,
  size = 'md',
  className,
  bare,
  variant = 'plain',
  onClick,
}: StatTileProps) {
  const Comp = onClick ? 'button' : 'div';
  const card = variant === 'card' && !bare;
  const hasContext = delta !== undefined || hint != null;
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'flex min-w-0 flex-col gap-1 text-left',
        card && 'rounded-lg bg-surface-1 p-5 md:p-6',
        onClick && !card && '-m-3 rounded-md p-3',
        onClick && 'transition-colors duration-(--dur-fast) hover:bg-surface-2 focus-visible:outline-offset-0',
        className,
      )}
    >
      <span className="truncate text-body-sm text-fg-3">{label}</span>
      <div className="flex items-end gap-4">
        <div className={cn('flex min-w-0 items-baseline gap-1 text-fg-1', valueSize[size])}>
          {value == null ? <span className="text-fg-4">—</span> : <Ticker value={value} format={format} />}
          {unit && <span className={cn('font-normal tracking-normal text-fg-3', unitSize[size])}>{unit}</span>}
        </div>
        {sparkline && sparkline.length > 1 && (
          <div className="mb-1.5 w-16 shrink-0 opacity-70" aria-hidden>
            <MiniProfile values={sparkline} height={20} tone="fg" />
          </div>
        )}
      </div>
      {hasContext && (
        <div className="flex h-5 min-w-0 items-center gap-1.5 text-body-sm text-fg-3">
          {delta !== undefined && (
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={String(delta)}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0, transition: { ...spring.smooth, delay: 0.12 } }}
                exit={{ opacity: 0, transition: tween('fast', 'in') }}
                className="flex shrink-0"
              >
                <DeltaBadge value={delta} kind={deltaKind} good={good} bad={bad} warning={warning} suffix={deltaSuffix} />
              </motion.div>
            </AnimatePresence>
          )}
          {hint != null && <span className="min-w-0 truncate">{hint}</span>}
        </div>
      )}
    </Comp>
  );
}

StatTile.Skeleton = function StatTileSkeleton({ size = 'md', className, variant = 'plain' }: { size?: TileSize; className?: string; variant?: 'plain' | 'card' }) {
  const h = size === 'sm' ? 'h-7' : size === 'md' ? 'h-9' : 'h-12';
  return (
    <div className={cn('flex flex-col gap-1', variant === 'card' && 'rounded-lg bg-surface-1 p-5 md:p-6', className)} aria-hidden>
      <Skeleton className="my-0.5 h-3.5 w-16" />
      <Skeleton className={cn(h, 'w-28')} />
      <Skeleton className="my-0.5 h-4 w-20" />
    </div>
  );
};

export interface StatRowProps {
  children: ReactNode;
  /** Share one surface-1 card behind the whole row (no per-tile boxes). Default false: on the canvas. */
  card?: boolean;
  /** Columns at ≥ md (default: number of children, max 4). Two columns below md. */
  columns?: 2 | 3 | 4;
  className?: string;
}

const cols = { 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-4' };

/** A row of 2–4 StatTiles separated by whitespace — optionally on one shared surface. */
export function StatRow({ children, card, columns, className }: StatRowProps) {
  const n = columns ?? (Math.min(4, Math.max(2, Array.isArray(children) ? children.filter(Boolean).length : 2)) as 2 | 3 | 4);
  return (
    <div className={cn('grid grid-cols-2 gap-x-6 gap-y-8 md:gap-x-8', cols[n], card && 'rounded-lg bg-surface-1 p-5 md:p-6', className)}>{children}</div>
  );
}
