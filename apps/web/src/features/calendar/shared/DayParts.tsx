/**
 * Small day-cell atoms shared by the month and week views: the date mark, one marker/note glyph,
 * event rows and the readiness dot. All neutral; the accent is reserved for today's date.
 */
import { Link } from '@tanstack/react-router';
import { Bandage, Flag, Moon, MountainSnow, Pilcrow, Plane, Thermometer, TreePalm } from 'lucide-react';
import type { DayMarker, DayNote, Event, WellnessDay } from '@cadence/core/domain';
import { cn } from '@/lib/cn';
import { monthShort } from '@/lib/format';
import { links } from '@/shell/links';

export const MARKER_META: Record<DayMarker['type'], { icon: typeof Moon; label: string; range: boolean }> = {
  rest: { icon: Moon, label: 'Rest', range: false },
  sick: { icon: Thermometer, label: 'Sick', range: false },
  injured: { icon: Bandage, label: 'Injured', range: false },
  travel: { icon: Plane, label: 'Travel', range: true },
  vacation: { icon: TreePalm, label: 'Vacation', range: true },
  altitude: { icon: MountainSnow, label: 'Altitude', range: true },
};

const ORDER: DayMarker['type'][] = ['sick', 'injured', 'travel', 'vacation', 'altitude', 'rest'];

/**
 * ONE small glyph for the day's markers (most important first) or, failing that, its note. The
 * full list is in the accessible name / tooltip and on the day page.
 */
export function DayGlyph({ markers, note, className }: { markers: DayMarker[]; note?: DayNote; className?: string }) {
  const sorted = [...markers].sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
  const names = sorted.map((m) => m.label ?? MARKER_META[m.type].label);
  if (note) names.push('Day note');
  if (!names.length) return null;
  const Icon = sorted[0] ? MARKER_META[sorted[0].type].icon : Pilcrow;
  const label = names.join(' · ');
  return (
    <span className={cn('inline-flex shrink-0 text-fg-3', className)} role="img" aria-label={label} title={note && !sorted.length ? note.body.slice(0, 140) : label}>
      <Icon className="size-3" strokeWidth={2} aria-hidden />
    </span>
  );
}

/** @deprecated Use DayGlyph (one glyph per day). Kept for callers that still list every marker. */
export function MarkerGlyphs({ markers }: { markers: DayMarker[] }) {
  return <DayGlyph markers={markers} />;
}

/** @deprecated Range markers are shown by DayGlyph on every covered day (no edge bands in v2). */
export function RangeBands(_: { markers: DayMarker[]; date: string; weekStart: string }) {
  void _;
  return null;
}

/** The date numeral: quiet fg-3; the 1st carries the month; today is the accent numeral + dot. */
export function DateMark({ date, today, compact, className }: { date: string; today: boolean; compact?: boolean; className?: string }) {
  const first = date.endsWith('-01');
  return (
    <span className={cn('inline-flex items-center gap-1 text-label num', today ? 'font-semibold text-accent-ink' : first ? 'font-medium text-fg-1' : 'text-fg-3', className)}>
      {Number(date.slice(8))}
      {first && !compact && <span className={today ? '' : 'text-fg-1'}>{monthShort(date)}</span>}
      {today && !compact && <span className="size-1 rounded-full bg-accent" aria-hidden />}
      {today && <span className="sr-only">, today</span>}
    </span>
  );
}

/** A race/event row: neutral flag + name. A-races are semibold on one surface step. */
export function EventBanner({ e, compact }: { e: Event; compact?: boolean }) {
  return (
    <Link
      {...links.event(e.id)}
      onClick={(ev) => ev.stopPropagation()}
      className={cn(
        'flex min-w-0 items-center gap-1.5 rounded-md px-2 outline-none transition-colors duration-(--dur-fast) focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus',
        compact ? 'h-6 px-1' : 'h-7',
        e.priority === 'A' ? 'bg-surface-2 text-fg-1 hover:bg-surface-3' : 'text-fg-2 hover:bg-surface-2',
      )}
      title={`${e.priority}-race · ${e.name}`}
    >
      <Flag className={cn('size-3.5 shrink-0', e.priority === 'A' ? 'fill-fg-1' : e.priority === 'C' && 'text-fg-3')} strokeWidth={2} aria-hidden />
      {!compact && <span className="sr-only">{e.priority}-race </span>}
      <span className={cn('min-w-0 truncate text-body-sm', e.priority === 'A' ? 'font-semibold' : e.priority === 'B' ? 'font-medium' : '')}>{e.name}</span>
    </Link>
  );
}

/** Filled = HRV within/above baseline; ring = below (product.md §3.3). */
export function ReadinessDot({ w }: { w?: WellnessDay }) {
  if (!w || (w.hrvStatus == null && w.readiness == null)) return null;
  const s = w.hrvStatus?.toLowerCase() ?? '';
  const good = s ? s.startsWith('bal') || s.startsWith('high') || s.startsWith('above') : (w.readiness ?? 0) >= 50;
  const label = `${good ? 'Recovered' : 'Below baseline'}${w.hrvMs ? ` · HRV ${Math.round(w.hrvMs)} ms` : ''}${w.readiness ? ` · readiness ${w.readiness}` : ''}`;
  return <span className={cn('size-1.5 shrink-0 rounded-full', good ? 'bg-fg-3' : 'border border-fg-3')} title={label} role="img" aria-label={label} />;
}
