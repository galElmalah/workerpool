/** Motion lab: a one-week calendar row with drag & drop (design.md §5.4c) + undo toast. */
import { addDays } from '@cadence/core/time';
import { DndContext, DragOverlay } from '@dnd-kit/core';
import { LayoutGroup } from 'motion/react';
import { useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { formatDateLong, formatDayShort, weekdayShort } from '@/lib/format';
import { DayDrop, DragItem, DragLift, Settle, useCalendarDnd } from '@/ui/dnd';
import { WorkoutCard } from '@/ui/domain/WorkoutCard';
import { toast } from '@/ui/toast';
import { byId } from './mock';

const START = '2026-11-16';
const DAYS = Array.from({ length: 7 }, (_, i) => addDays(START, i));
const TODAY = '2026-11-21';

type Board = Record<string, string[]>;
const INITIAL: Board = {
  [DAYS[0]!]: ['wk_swim'],
  [DAYS[1]!]: ['wk_thr', 'wk_str'],
  [DAYS[2]!]: [],
  [DAYS[3]!]: ['wk_row'],
  [DAYS[4]!]: ['wk_yoga'],
  [DAYS[5]!]: ['wk_easy', 'wk_vo2'],
  [DAYS[6]!]: ['wk_long'],
};

const dayOf = (b: Board, id: string) => Object.keys(b).find((d) => b[d]!.includes(id));
function move(b: Board, id: string, to: string): Board {
  const from = dayOf(b, id);
  if (!from || from === to) return b;
  return { ...b, [from]: b[from]!.filter((x) => x !== id), [to]: [...b[to]!, id] };
}

export function DndDemo() {
  const [board, setBoard] = useState<Board>(INITIAL);
  const snapshot = useRef<Board>(INITIAL);
  const dnd = useCalendarDnd({
    onStart: () => {
      snapshot.current = board;
    },
    onOver: (id, day) => setBoard((b) => move(b, id, day)),
    onDrop: (id, day) => {
      const before = snapshot.current;
      const fromDay = dayOf(before, id);
      setBoard((b) => move(b, id, day));
      if (fromDay !== day)
        toast.undo(
          <>
            Moved <b>{byId(id)?.title}</b> to {formatDayShort(day)}
          </>,
          () => setBoard(before),
        );
    },
    onCancel: () => setBoard(snapshot.current),
    describe: (id) => byId(id)?.title ?? id,
    dayLabel: (d) => formatDateLong(d),
  });

  return (
    <DndContext {...dnd.contextProps}>
      <div data-dnd-demo className="overflow-x-auto rounded-lg border border-line-2 bg-line-1">
        <div className="grid min-w-[56rem] grid-cols-7 gap-px">
          {DAYS.map((d) => (
            <DayDrop key={d} id={d} className={cn('flex min-h-44 flex-col gap-1.5 bg-canvas p-1.5', d > TODAY && 'bg-surface-1/40')}>
              <div className="flex items-center justify-between px-1 pt-0.5 pb-1">
                <span className="text-micro text-fg-3">{weekdayShort(d)}</span>
                <span
                  className={cn(
                    'flex size-5 items-center justify-center rounded-full text-mono-sm',
                    d === TODAY ? 'bg-accent font-[600] text-on-accent' : 'text-fg-2',
                  )}
                >
                  {Number(d.slice(8))}
                </span>
              </div>
              <LayoutGroup id={d}>
                {board[d]!.map((id) => {
                  const m = byId(id)!;
                  return (
                    <Settle key={id} id={id} layout={dnd.affected.has(d)}>
                      <DragItem id={id} dayId={d}>
                        {({ dragging }) => <WorkoutCard model={m} density="compact" ghost={dragging} />}
                      </DragItem>
                    </Settle>
                  );
                })}
              </LayoutGroup>
            </DayDrop>
          ))}
        </div>
      </div>
      <DragOverlay {...dnd.overlayProps}>
        {dnd.activeId && (
          <DragLift>
            <WorkoutCard model={byId(dnd.activeId)!} density="compact" className="!bg-surface-3" />
          </DragLift>
        )}
      </DragOverlay>
    </DndContext>
  );
}
