/**
 * Small status atoms: SyncDot (rail / Garmin connection), GarminStateIcon (per planned card),
 * FormZoneLabel (Fitness model zone). All monochrome-first; accent only for live/synced.
 */
import type { FormZone } from '@cadence/core';
import { Check, RefreshCw, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Tooltip } from '../Tooltip';

export type SyncState = 'idle' | 'syncing' | 'error' | 'offline';

const SYNC_LABEL: Record<SyncState, string> = {
  idle: 'Synced',
  syncing: 'Syncing…',
  error: 'Sync failed',
  offline: 'Garmin not connected',
};

/** 8px dot: accent (synced), accent + live ring (syncing), dashed ring (error), hollow (offline). */
export function SyncDot({ state, className, label }: { state: SyncState; className?: string; label?: string }) {
  return (
    <span className={cn('relative inline-flex size-2 shrink-0', className)} role="img" aria-label={label ?? SYNC_LABEL[state]}>
      {state === 'syncing' && <span className="absolute inset-0 rounded-full bg-accent animate-live" aria-hidden />}
      <span
        className={cn(
          'relative size-2 rounded-full',
          state === 'idle' && 'bg-accent',
          state === 'syncing' && 'bg-accent',
          state === 'error' && 'border border-dashed border-fg-1 bg-transparent',
          state === 'offline' && 'border border-fg-4 bg-transparent',
        )}
      />
    </span>
  );
}

export type GarminState = 'none' | 'pending' | 'synced' | 'error';
const GARMIN_COPY: Record<Exclude<GarminState, 'none'>, string> = {
  pending: 'Sending…',
  synced: 'On your watch',
  error: "Couldn't send",
};

/** ⟳ pending · ✓ on Garmin · ⚠ failed. Hidden for 'none'. (product.md §3.4, Appendix A) */
export function GarminStateIcon({ state, error, className }: { state: GarminState | null | undefined; error?: string; className?: string }) {
  if (!state || state === 'none') return null;
  const Icon = state === 'pending' ? RefreshCw : state === 'synced' ? Check : TriangleAlert;
  const label = state === 'error' && error ? `${GARMIN_COPY.error}: ${error}` : GARMIN_COPY[state];
  return (
    <Tooltip content={label}>
      <span className={cn('inline-flex text-fg-3', state === 'error' && 'text-fg-1', className)} aria-label={label} role="img" tabIndex={-1}>
        <Icon className="size-3" strokeWidth={2} />
      </span>
    </Tooltip>
  );
}

const ZONE_META: Record<FormZone, { label: string; tip: string; pos: number }> = {
  overreaching: { label: 'Overreaching', tip: 'Deep fatigue. Back off soon or risk getting run down.', pos: 0 },
  productive: { label: 'Productive', tip: 'Carrying fatigue that builds fitness. Fine for blocks, not forever.', pos: 1 },
  neutral: { label: 'Neutral', tip: 'Balanced: maintaining fitness without much fatigue.', pos: 2 },
  fresh: { label: 'Fresh', tip: 'Rested and ready. Ideal before a race.', pos: 3 },
  transition: { label: 'Transition', tip: 'Very fresh: fitness is starting to fade.', pos: 4 },
};

/** Zone name with a 5-step position scale (overreaching → transition). Monochrome. */
export function FormZoneLabel({ zone, className, withScale = true }: { zone: FormZone | null | undefined; className?: string; withScale?: boolean }) {
  if (!zone) return <span className={cn('text-fg-4', className)}>—</span>;
  const m = ZONE_META[zone];
  return (
    <Tooltip content={m.tip}>
      <span className={cn('inline-flex items-center gap-1.5 text-label text-fg-1', className)} tabIndex={0}>
        {withScale && (
          <span className="inline-flex items-center gap-0.5" aria-hidden>
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} className={cn('h-2 w-1 rounded-[1px]', i === m.pos ? 'bg-fg-1' : 'bg-gray-7', i === 2 && i !== m.pos && 'bg-line-3')} />
            ))}
          </span>
        )}
        {m.label}
      </span>
    </Tooltip>
  );
}

export const FORM_ZONE_META = ZONE_META;
