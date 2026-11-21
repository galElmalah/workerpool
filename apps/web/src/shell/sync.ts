/**
 * Shell-level sync status (the rail dot). The data layer calls `setSyncStatus` when Garmin status
 * or a sync run changes; the rail and the palette read it.
 */
import { useSyncExternalStore } from 'react';
import type { SyncState } from '@/ui/domain/Status';

export interface SyncStatus {
  state: SyncState;
  /** ISO instant of the last successful sync. */
  lastSyncAt?: string;
  /** Short human text; derived when omitted. */
  label?: string;
}

let status: SyncStatus = { state: 'offline', label: 'Garmin not connected' };
const subs = new Set<() => void>();

export function setSyncStatus(next: SyncStatus) {
  status = next;
  subs.forEach((f) => f());
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => {
        subs.delete(f);
      };
    },
    () => status,
    () => status,
  );
}

export function syncLabel(s: SyncStatus, now = Date.now()): string {
  if (s.label) return s.label;
  if (s.state === 'syncing') return 'Syncing…';
  if (s.state === 'error') return 'Sync failed';
  if (s.state === 'offline') return 'Garmin not connected';
  if (!s.lastSyncAt) return 'Synced';
  const min = Math.round((now - Date.parse(s.lastSyncAt)) / 60000);
  return min < 1 ? 'Synced just now' : min < 60 ? `Synced ${min}m ago` : `Synced ${Math.round(min / 60)}h ago`;
}
