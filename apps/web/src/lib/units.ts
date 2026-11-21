/**
 * Unit system (UI-only conversion; the domain is SI: m, s, m/s, W, kg).
 * Until the settings API is wired, the preference is per-device (localStorage). Feature code
 * reads it with `useUnits()` and passes it to the pure formatters in lib/format.ts.
 */
import { useSyncExternalStore } from 'react';

export type UnitSystem = 'metric' | 'imperial';
export type SwimUnit = 'm' | 'yd';
export interface UnitPrefs {
  system: UnitSystem;
  /** Pool unit override (swimmers in the US often train in yards with metric elsewhere). */
  swim: SwimUnit;
}

export const M_PER_KM = 1000;
export const M_PER_MI = 1609.344;
export const M_PER_YD = 0.9144;
export const M_PER_FT = 0.3048;
export const KG_PER_LB = 0.45359237;

const KEY = 'cadence.units';
const DEFAULT: UnitPrefs = { system: 'metric', swim: 'm' };
const subs = new Set<() => void>();

function read(): UnitPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT, ...(JSON.parse(raw) as Partial<UnitPrefs>) };
  } catch {
    /* ignore */
  }
  return DEFAULT;
}

let prefs: UnitPrefs = typeof window !== 'undefined' ? read() : DEFAULT;

export function getUnits(): UnitPrefs {
  return prefs;
}

export function setUnits(next: Partial<UnitPrefs>) {
  prefs = { ...prefs, ...next };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
  subs.forEach((f) => f());
}

export function useUnits(): UnitPrefs {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => {
        subs.delete(f);
      };
    },
    getUnits,
    () => DEFAULT,
  );
}

/** Meters per display distance unit for a sport. */
export function distanceUnit(sport: string, u: UnitPrefs = prefs): { unit: 'km' | 'mi' | 'm' | 'yd'; mPer: number } {
  if (sport === 'swim') return u.swim === 'yd' ? { unit: 'yd', mPer: M_PER_YD } : { unit: 'm', mPer: 1 };
  if (sport === 'row') return { unit: 'm', mPer: 1 };
  return u.system === 'imperial' ? { unit: 'mi', mPer: M_PER_MI } : { unit: 'km', mPer: M_PER_KM };
}

/** Pace basis per sport: run-like per km/mi, swim per 100 m/yd, row per 500 m. */
export function paceBasis(sport: string, u: UnitPrefs = prefs): { label: string; meters: number } {
  if (sport === 'swim') return u.swim === 'yd' ? { label: '/100yd', meters: 100 * M_PER_YD } : { label: '/100m', meters: 100 };
  if (sport === 'row') return { label: '/500m', meters: 500 };
  return u.system === 'imperial' ? { label: '/mi', meters: M_PER_MI } : { label: '/km', meters: M_PER_KM };
}

/** Sports whose speed is read as pace rather than km/h. */
export const PACE_SPORTS = new Set(['run', 'swim', 'row', 'walk', 'hike']);
