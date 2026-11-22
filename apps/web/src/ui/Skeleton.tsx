/**
 * Skeleton — surface-2 blocks with the EXACT final dimensions and matching radius; sheen sweeps
 * (static under reduced motion). Show only after 150ms (router defaultPendingMs) and for ≥ 300ms.
 * Swap to content with <Crossfade> from '@/motion'.
 */
import { cn } from '@/lib/cn';
import { containerCls } from './PageHeader';

export function Skeleton({ className, radius = 'sm' }: { className?: string; radius?: 'xs' | 'sm' | 'md' | 'lg' | 'full' }) {
  const r = { xs: 'rounded-xs', sm: 'rounded-sm', md: 'rounded-md', lg: 'rounded-lg', full: 'rounded-full' }[radius];
  return <div className={cn('skeleton', r, className)} aria-hidden />;
}

/** N lines of text, last one shorter. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-3.5', i === lines - 1 ? 'w-3/5' : 'w-full')} />
      ))}
    </div>
  );
}

/** Generic page skeleton used by the router while a lazy page or its loader is pending
 *  (same frame as <Page> + <PageHeader>: 52px bar, title block, a stat row, one large block). */
export function PageSkeleton() {
  return (
    <div className={cn(containerCls('page'), 'flex flex-col gap-12 md:gap-14 lg:gap-16')} aria-busy aria-label="Loading">
      <div className="flex flex-col gap-2.5 pt-[calc(var(--header-h)+1.5rem)] md:pt-[calc(var(--header-h)+2.5rem)]">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-8 w-64" />
      </div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-8 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-3.5 w-16" />
            <Skeleton className="h-8 w-24" />
          </div>
        ))}
      </div>
      <Skeleton radius="lg" className="h-72" />
    </div>
  );
}
