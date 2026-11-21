/**
 * StatTile — design.md §7: micro label (fg-3) · value (`stat-md` Ticker) + unit (fg-3, 0.6×) ·
 * delta (DeltaBadge, re-enters when it changes) · optional 24px sparkline. Spotlight card.
 * Loading = <StatTile.Skeleton/> of the exact same size (wrap both in <Crossfade>).
 *
 *   <StatTile label="Fitness" value={84} delta={0.06} good sparkline={[…]} />
 *   <StatTile label="Time" value={34200} format={(s) => formatDuration(s)} unit="h" />
 */
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { onSpotlightMove } from '@/motion/pointer';
import { Ticker } from '@/motion/Ticker';
import { spring, tween } from '@/motion/tokens';
import { DeltaBadge } from './domain/DeltaBadge';
import { MiniProfile } from './domain/MiniProfile';
import { Skeleton } from './Skeleton';

export interface StatTileProps {
  label: ReactNode;
  value: number | null | undefined;
  format?: (n: number) => string;
  unit?: ReactNode;
  /** Fractional delta (0.12 = +12%) or absolute with deltaKind="number". */
  delta?: number | null;
  deltaKind?: 'percent' | 'number';
  deltaSuffix?: string;
  /** Delta arrow in accent (good direction). */
  good?: boolean;
  warning?: boolean;
  /** 0..1 values (or raw; normalized) for a 24px bar sparkline. */
  sparkline?: number[];
  hint?: ReactNode;
  size?: 'md' | 'lg' | 'xl';
  /** Accent value (only for load/fitness/live numbers). */
  signal?: boolean;
  className?: string;
  /** Render without the card chrome (inside another card). */
  bare?: boolean;
  onClick?: () => void;
}

const valueSize = { md: 'text-stat-md', lg: 'text-stat-lg', xl: 'text-stat-xl' };
const unitSize = { md: 'text-[1.2rem]', lg: 'text-[1.5rem]', xl: 'text-[2.25rem]' };

export function StatTile({
  label,
  value,
  format,
  unit,
  delta,
  deltaKind = 'percent',
  deltaSuffix,
  good,
  warning,
  sparkline,
  hint,
  size = 'md',
  signal,
  className,
  bare,
  onClick,
}: StatTileProps) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      onPointerMove={bare ? undefined : onSpotlightMove}
      className={cn(
        'flex min-w-0 flex-col gap-1.5 text-left',
        !bare && 'spotlight rounded-lg border border-line-2 bg-surface-1 p-4',
        onClick && 'transition-colors duration-(--dur-fast) hover:bg-surface-2',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-micro uppercase text-fg-3">{label}</span>
        {hint && <span className="text-body-sm text-fg-3">{hint}</span>}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className={cn('flex min-w-0 items-baseline gap-1', valueSize[size], signal ? 'text-accent-ink' : 'text-fg-1')}>
          {value == null ? <span className="text-fg-4">—</span> : <Ticker value={value} format={format} />}
          {unit && <span className={cn('font-[450] tracking-normal text-fg-3', unitSize[size])}>{unit}</span>}
        </div>
        {sparkline && sparkline.length > 1 && <div className="mb-1.5 w-20 shrink-0">
            <MiniProfile values={sparkline} height={24} tone={signal ? 'accent' : 'fg'} />
          </div>}
      </div>
      <div className="h-5">
        <AnimatePresence mode="wait" initial={false}>
          {delta !== undefined && (
            <motion.div
              key={String(delta)}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0, transition: { ...spring.smooth, delay: 0.12 } }}
              exit={{ opacity: 0, transition: tween('fast', 'in') }}
            >
              <DeltaBadge value={delta} kind={deltaKind} good={good} warning={warning} suffix={deltaSuffix} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Comp>
  );
}

StatTile.Skeleton = function StatTileSkeleton({ size = 'md', className }: { size?: 'md' | 'lg' | 'xl'; className?: string }) {
  const h = size === 'md' ? 'h-9' : size === 'lg' ? 'h-12' : 'h-18';
  return (
    <div className={cn('flex flex-col gap-1.5 rounded-lg border border-line-2 bg-surface-1 p-4', className)} aria-hidden>
      <Skeleton className="h-3.5 w-16" />
      <Skeleton className={cn(h, 'w-28')} />
      <Skeleton className="h-5 w-12" />
    </div>
  );
};
