import { createContext, useContext } from 'react';
import type { Sport, ThresholdSnapshot, WorkoutStructure } from '@cadence/core';
import type { NodePath } from '@cadence/core/workout';
import type { UnitPrefs } from '@/lib/units';

export interface BuilderCtx {
  sport: Sport;
  units: UnitPrefs;
  th: ThresholdSnapshot;
  structure: WorkoutStructure;
  /** Apply an immutable edit (records undo). */
  apply: (fn: (s: WorkoutStructure) => WorkoutStructure, opts?: { label?: string }) => void;
  selected: string[];
  select: (id: string, extend?: boolean) => void;
  hovered: string | null;
  setHovered: (id: string | null) => void;
  pathOf: (id: string) => NodePath | undefined;
  remove: (id: string) => void;
}

export const Ctx = createContext<BuilderCtx | null>(null);
export const useB = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('builder context');
  return c;
};
