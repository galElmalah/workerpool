/** Small day-cell atoms shared by the month and week views: markers, event banners, readiness. */
import { Link } from '@tanstack/react-router';
import { Bandage, Flag, Moon, MountainSnow, Plane, Thermometer, TreePalm } from 'lucide-react';
import type { DayMarker, Event, WellnessDay } from '@cadence/core/domain';
import { cn } from '@/lib/cn';
import { links } from '@/shell/links';

export const MARKER_META: Record<DayMarker['type'], { icon: typeof Moon; label: string; range: boolean }> = {
  rest: { icon: Moon, label: 'Rest', range: false },
  sick: { icon: Thermometer, label: 'Sick', range: false },
  injured: { icon: Bandage, label: 'Injured', range: false },
  travel: { icon: Plane, label: 'Travel', range: true },
  vacation: { icon: TreePalm, label: 'Vacation', range: true },
  altitude: { icon: MountainSnow, label: 'Altitude', range: true },
};

export function MarkerGlyphs({ markers }: { markers: DayMarker[] }) {
  const singles = markers.filter((m) => !(MARKER_META[m.type].range && m.endDate));
  if (!singles.length) return null;
  return (
    <span className="flex items-center gap-0.5 text-fg-2">
      {singles.map((m) => {
        const I = MARKER_META[m.type].icon;
        return <I key={m.id} className="size-3" strokeWidth={2} aria-label={m.label ?? MARKER_META[m.type].label} />;
      })}
    </span>
  );
}

/** Thin continuous band along the top of cells covered by a travel/vacation/altitude range. */
export function RangeBands({ markers, date, weekStart }: { markers: DayMarker[]; date: string; weekStart: string }) {
  const ranges = markers.filter((m) => MARKER_META[m.type].range && m.endDate);
  if (!ranges.length) return null;
  return (
    <>
      {ranges.slice(0, 2).map((m, i) => {
        const I = MARKER_META[m.type].icon;
        const first = m.date === date || date === weekStart;
        return (
          <span key={m.id} className="pointer-events-none absolute inset-x-0 z-[1]" style={{ top: i * 4 }} aria-hidden={!first}>
            <span className={cn('block h-[3px] bg-fg-4', m.date === date && 'ml-1 rounded-l-full', m.endDate === date && 'mr-1 rounded-r-full')} />
            {first && (
              <span className="absolute top-1 right-1.5 flex max-w-[70%] items-center gap-1 truncate text-micro uppercase text-fg-3">
                <I className="size-3 shrink-0" strokeWidth={2} />
                <span className="truncate">{m.label ?? MARKER_META[m.type].label}</span>
              </span>
            )}
          </span>
        );
      })}
    </>
  );
}

export function EventBanner({ e, compact }: { e: Event; compact?: boolean }) {
  return (
    <Link
      {...links.event(e.id)}
      onClick={(ev) => ev.stopPropagation()}
      className={cn(
        'flex min-w-0 items-center gap-1 rounded-sm px-1.5 outline-none transition-colors duration-(--dur-fast) focus-visible:outline-2 focus-visible:outline-focus',
        compact ? 'h-5' : 'h-6',
        e.priority === 'A' && 'bg-accent text-on-accent hover:bg-accent-hover',
        e.priority === 'B' && 'border border-accent text-accent-ink hover:bg-accent-a2',
        e.priority === 'C' && 'h-5 border border-line-3 text-fg-2 hover:bg-surface-3',
      )}
      title={`${e.priority}-race · ${e.name}`}
    >
      <Flag className="size-3 shrink-0" strokeWidth={2.25} aria-hidden />
      {!compact && <span className="shrink-0 font-mono text-mono-sm font-[600]">{e.priority}</span>}
      <span className={cn('min-w-0 truncate', e.priority === 'C' ? 'text-label' : 'text-label font-[600]')}>{e.name}</span>
    </Link>
  );
}

/** Filled = HRV within/above baseline; ring = below (product.md §3.3). */
export function ReadinessDot({ w }: { w?: WellnessDay }) {
  if (!w || (w.hrvStatus == null && w.readiness == null)) return null;
  const s = w.hrvStatus?.toLowerCase() ?? '';
  const good = s ? s.startsWith('bal') || s.startsWith('high') || s.startsWith('above') : (w.readiness ?? 0) >= 50;
  const label = `${good ? 'Recovered' : 'Below baseline'}${w.hrvMs ? ` · HRV ${Math.round(w.hrvMs)} ms` : ''}${w.readiness ? ` · readiness ${w.readiness}` : ''}`;
  return <span className={cn('size-1.5 shrink-0 rounded-full', good ? 'bg-fg-2' : 'border border-fg-3')} title={label} role="img" aria-label={label} />;
}
