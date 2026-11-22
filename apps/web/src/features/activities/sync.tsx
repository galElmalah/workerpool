/**
 * Shared interaction state of one activity page: the stream cursor (seconds, a MotionValue so
 * scrubbing never re-renders React), the committed selection (chart drag or lap click), a hovered
 * span (lap row hover preview) and the selected lap. Map, charts and laps all read and write it.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { MotionValue } from 'motion/react';
import { useStreamCursor, type StreamSelection } from '@/charts';

export interface ActivitySync {
  cursor: MotionValue<number>;
  selection: StreamSelection | null;
  hover: StreamSelection | null;
  selectedLap: number | null;
  /** Commit a selection; `lap` marks it as coming from a lap row (null clears the lap highlight). */
  select: (s: StreamSelection | null, lap?: number | null) => void;
  setHover: (s: StreamSelection | null) => void;
}

const Ctx = createContext<ActivitySync | null>(null);

export function ActivitySyncProvider({ children }: { children: ReactNode }) {
  const cursor = useStreamCursor();
  const [selection, setSelection] = useState<StreamSelection | null>(null);
  const [hover, setHover] = useState<StreamSelection | null>(null);
  const [selectedLap, setSelectedLap] = useState<number | null>(null);
  const value = useMemo<ActivitySync>(
    () => ({
      cursor,
      selection,
      hover,
      selectedLap,
      select: (s, lap = null) => {
        setSelection(s);
        setSelectedLap(s ? lap : null);
        setHover(null);
      },
      setHover,
    }),
    [cursor, selection, hover, selectedLap],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useActivitySync(): ActivitySync {
  const v = useContext(Ctx);
  if (!v) throw new Error('useActivitySync outside ActivitySyncProvider');
  return v;
}
