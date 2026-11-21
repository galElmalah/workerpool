/**
 * Skeleton — surface-2 blocks with the EXACT final dimensions and matching radius; sheen sweeps
 * (static under reduced motion). Show only after 150ms (router defaultPendingMs) and for ≥ 300ms.
 * Swap to content with <Crossfade> from '@/motion'.
 */
import { cn } from '@/lib/cn';

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

/** Generic page skeleton used by the router while a lazy page or its loader is pending. */
export function PageSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-page flex-col gap-8 px-4 pt-6 md:px-6 xl:px-10" aria-busy aria-label="Loading">
      <div className="flex flex-col gap-3 pt-10">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-10 w-72" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} radius="lg" className="h-28" />
        ))}
      </div>
      <Skeleton radius="lg" className="h-72" />
    </div>
  );
}
