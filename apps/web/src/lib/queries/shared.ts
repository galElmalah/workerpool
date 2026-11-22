/**
 * Cross-feature queries: auth, settings, current thresholds, Garmin status.
 * Feature-specific queries live in the feature folder and use `qk` from '@/lib/query'.
 */
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Settings } from '@cadence/core/domain';
import { useEffect } from 'react';
import { api, call } from '../api';
import { invalidateTraining, qk, queryClient } from '../query';
import { setUnits } from '../units';
import { setSyncStatus } from '@/shell/sync';

// ── auth ────────────────────────────────────────────────────────────────
export const authQuery = queryOptions({
  queryKey: qk.auth,
  queryFn: () => call(api.auth.status.$get()),
  staleTime: 60_000,
});
export const useAuthStatus = () => useQuery(authQuery);

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (passphrase: string) => call(api.auth.login.$post({ json: { passphrase } })),
    onSuccess: () => qc.invalidateQueries(),
  });
}
export function useSetupPassphrase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (passphrase: string) => call(api.auth.setup.$post({ json: { passphrase } })),
    onSuccess: () => qc.invalidateQueries(),
  });
}
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => call(api.auth.logout.$post()),
    onSuccess: () => {
      qc.clear();
      window.location.assign('/login');
    },
  });
}

// ── settings ────────────────────────────────────────────────────────────
export const settingsQuery = queryOptions({
  queryKey: qk.settings,
  queryFn: () => call(api.settings.$get()) as Promise<Settings>,
  staleTime: 5 * 60_000,
});
export const useSettings = () => useQuery(settingsQuery);

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => call(api.settings.$patch({ json: patch })) as Promise<Settings>,
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: qk.settings });
      const prev = qc.getQueryData<Settings>(qk.settings);
      if (prev) qc.setQueryData<Settings>(qk.settings, { ...prev, ...patch });
      return { prev };
    },
    onError: (_e, _p, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.settings, ctx.prev);
    },
    onSuccess: (next, patch) => {
      qc.setQueryData(qk.settings, next);
      if ('timezone' in patch || 'weekStart' in patch) void invalidateTraining();
    },
  });
}

/** Mount once in the shell: mirrors server settings into the per-device unit store. */
export function useSettingsSync(): void {
  const { data } = useSettings();
  useEffect(() => {
    if (data) setUnits({ system: data.units });
  }, [data?.units]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ── thresholds ──────────────────────────────────────────────────────────
export const currentThresholdsQuery = queryOptions({
  queryKey: qk.thresholds.current,
  queryFn: () => call(api.thresholds.current.$get()),
  staleTime: 5 * 60_000,
});
export const useCurrentThresholds = () => useQuery(currentThresholdsQuery);

// ── garmin ──────────────────────────────────────────────────────────────
export const garminStatusQuery = queryOptions({
  queryKey: qk.garmin.status,
  queryFn: () => call(api.garmin.status.$get()),
  staleTime: 20_000,
  refetchInterval: (q) => (q.state.data?.backfill?.running ? 4_000 : 60_000),
});
export const useGarminStatus = () => useQuery(garminStatusQuery);

/** Mount once in the shell: keeps the rail's sync dot in step with the Garmin status. */
export function useGarminStatusSync(): void {
  const { data, isError } = useGarminStatus();
  const syncing = useIsSyncing();
  useEffect(() => {
    if (isError) return setSyncStatus({ state: 'error', label: 'Sync status unavailable' });
    if (!data) return;
    if (!data.connected) return setSyncStatus({ state: 'offline', label: 'Garmin not connected' });
    if (syncing || data.backfill?.running) return setSyncStatus({ state: 'syncing' });
    if (data.state === 'error' || data.lastError) return setSyncStatus({ state: 'error', label: 'Sync failed' });
    setSyncStatus({ state: 'idle', lastSyncAt: data.lastSyncAt });
  }, [data, isError, syncing]);
}

const SYNC_KEY = ['garmin', 'sync-now'] as const;
export function useSyncNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: SYNC_KEY,
    mutationFn: () => call(api.garmin.sync.$post()),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: qk.garmin.status }), invalidateTraining()]),
  });
}
function useIsSyncing(): boolean {
  const qc = useQueryClient();
  return qc.isMutating({ mutationKey: SYNC_KEY }) > 0;
}

/**
 * Route guard helper: resolves where a visitor must go, or null when signed in and onboarded.
 * A signed-in user whose settings say `onboarded: false` finishes onboarding first (/welcome
 * resumes at the right step and sends onboarded users back to the app, so there is no loop).
 */
export async function requiredAuthRedirect(): Promise<'/welcome' | '/login' | null> {
  try {
    const s = await queryClient.ensureQueryData(authQuery);
    if (!s.configured) return '/welcome';
    if (!s.authenticated) return '/login';
    const settings = await queryClient.ensureQueryData(settingsQuery).catch(() => null);
    if (settings && settings.onboarded === false) return '/welcome';
    return null;
  } catch {
    return null; // offline: let the page render its own error state
  }
}
