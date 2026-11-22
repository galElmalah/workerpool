/**
 * Map section of an outdoor activity: the lazy MapLibre map (its own chunk) beside a quiet column of
 * where/when facts. Space is reserved at the final height while the chunk and streams load, so the
 * layout never jumps. Indoor / GPS-less activities render nothing at all (no empty box).
 */
import type { ActivityDetail, ActivityStreams } from '@cadence/core/domain';
import { MapPin } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { RouteMap } from '@/charts';
import { Section, Skeleton } from '@/ui';
import { useMediaQuery } from '@/lib/hooks';
import { formatCoords, localClock } from './fmt';
import { useActivitySync } from './sync';

const ActivityMap = lazy(() => import('./ActivityMap'));

export const hasRoute = (s: ActivityStreams | undefined) => !!s?.lat?.some((v) => v != null) && !!s?.lng?.some((v) => v != null);

export function MapSection({ a, streams }: { a: ActivityDetail; streams: ActivityStreams }) {
  const sync = useActivitySync();
  const wide = useMediaQuery('(min-width: 1024px)');
  const height = wide ? 460 : 320;
  const [svg, setSvg] = useState(false);
  const f = a.facts ?? {};
  const lat = f.startLat ?? streams.lat?.find((v) => v != null) ?? undefined;
  const lng = f.startLng ?? streams.lng?.find((v) => v != null) ?? undefined;
  const loopish = f.endLat != null && f.endLng != null && lat != null && lng != null && Math.hypot((f.endLat - lat) * 111, (f.endLng - lng) * 82) < 0.15;
  const facts: { label: string; value: string; sub?: string }[] = [
    ...(a.locationName ? [{ label: 'Location', value: a.locationName }] : []),
    { label: 'Start', value: localClock(a.startedAt, a.utcOffsetMin), sub: lat != null && lng != null ? formatCoords(lat, lng) : undefined },
    {
      label: 'Finish',
      value: localClock(a.startedAt, a.utcOffsetMin, a.durationSec),
      sub: loopish ? 'Back at the start' : f.endLat != null && f.endLng != null ? formatCoords(f.endLat, f.endLng) : undefined,
    },
  ];
  return (
    <Section id="map" title="Map" description={a.locationName ? undefined : 'Location name not reported by the device — start coordinates shown.'}>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_15rem]">
        <div data-activity-map className="relative min-w-0 select-none overflow-hidden rounded-lg bg-surface-1" style={{ height, ['--chart-bg' as string]: 'var(--color-surface-1)' }}>
          {svg ? (
            <RouteMap streams={streams} cursor={sync.cursor} selection={sync.hover ?? sync.selection} height={height} kmMarkers={false} />
          ) : (
            <Suspense fallback={<Skeleton className="size-full" radius="lg" />}>
              <ActivityMap streams={streams} sport={a.sport} laps={a.laps} cursor={sync.cursor} selection={sync.hover ?? sync.selection} height={height} onUnsupported={() => setSvg(true)} />
            </Suspense>
          )}
        </div>
        <dl className="grid grid-cols-2 content-start gap-x-6 gap-y-5 lg:grid-cols-1">
          {facts.map((x) => (
            <div key={x.label} className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-body-sm text-fg-3">{x.label}</dt>
              <dd className="flex min-w-0 flex-col text-body-lg text-fg-1 tabular-nums">
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  {x.label === 'Location' && <MapPin className="size-4 shrink-0 text-fg-3" aria-hidden />}
                  <span className="truncate">{x.value}</span>
                </span>
                {x.sub && <span className="truncate text-body-sm text-fg-3">{x.sub}</span>}
              </dd>
            </div>
          ))}
          <p className="col-span-2 text-body-sm text-fg-3 lg:col-span-1">Scrub the charts or the route to trace it; pick a lap to highlight it.</p>
        </dl>
      </div>
    </Section>
  );
}

export function MapSkeleton() {
  return (
    <Section id="map" title="Map">
      <Skeleton className="h-[320px] w-full lg:h-[460px]" radius="lg" />
    </Section>
  );
}
