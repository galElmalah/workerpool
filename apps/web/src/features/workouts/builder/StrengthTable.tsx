/**
 * Strength editor: an exercise table instead of the profile graph — exercise (autocomplete from a
 * compact catalog), sets × reps, load (kg or bodyweight), RPE, rest, superset group — with a
 * volume summary (sets, reps, tonnage, est. time).
 */
import type { Step, StructureNode, WorkoutStructure } from '@cadence/core';
import { fmtClock, updateStep, type NodePath } from '@cadence/core/workout';
import { AnimatePresence, motion, Reorder, useDragControls } from 'motion/react';
import { Copy, GripVertical, Plus, X } from 'lucide-react';
import { useId } from 'react';
import { Button, IconButton } from '@/ui';
import { cn } from '@/lib/cn';
import { Ticker } from '@/motion';
import { spring } from '@/motion/tokens';
import { strengthStep } from '../model';
import { useB } from './context';
import { MiniField } from './fields';
import { duplicateNode, insertNode } from '@cadence/core/workout';

export const EXERCISES = [
  'Back squat', 'Front squat', 'Goblet squat', 'Split squat', 'Bulgarian split squat', 'Lunge', 'Walking lunge', 'Step-up', 'Leg press',
  'Deadlift', 'Romanian deadlift', 'Trap bar deadlift', 'Single-leg RDL', 'Hip thrust', 'Glute bridge', 'Kettlebell swing', 'Good morning',
  'Bench press', 'Incline bench press', 'Dumbbell press', 'Overhead press', 'Push press', 'Push-up', 'Dip',
  'Pull-up', 'Chin-up', 'Lat pulldown', 'Bent-over row', 'Single-arm row', 'Seated row', 'Inverted row', 'Face pull',
  'Calf raise', 'Tibialis raise', 'Nordic curl', 'Leg curl', 'Leg extension', 'Copenhagen plank',
  'Plank', 'Side plank', 'Dead bug', 'Bird dog', 'Pallof press', 'Hanging leg raise', 'Ab wheel', 'Russian twist',
  'Box jump', 'Broad jump', 'Pogo hops', 'Medicine ball slam', "Farmer's carry", 'Suitcase carry', 'Turkish get-up',
];

export function StrengthTable() {
  const b = useB();
  const listId = useId();
  const rows = b.structure.steps.map((n, i) => ({ n, i })).filter((r): r is { n: Step & StructureNode; i: number } => r.n.kind === 'step');
  const sets = rows.reduce((a, r) => a + (r.n.strength?.sets ?? 0), 0);
  const reps = rows.reduce((a, r) => a + (r.n.strength ? r.n.strength.sets * (r.n.strength.reps ?? 0) : 0), 0);
  const tonnage = rows.reduce((a, r) => a + (r.n.strength ? r.n.strength.sets * (r.n.strength.reps ?? 0) * (r.n.strength.weightKg ?? 0) : 0), 0);
  const add = () => b.apply((s) => insertNode(s, [s.steps.length], strengthStep(rows.length ? 'Romanian deadlift' : 'Back squat')), { label: 'Add exercise' });
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line-1 bg-line-1 sm:grid-cols-4">
        {[
          ['Exercises', rows.filter((r) => r.n.strength).length, ''],
          ['Sets', sets, ''],
          ['Reps', reps, ''],
          ['Tonnage', Math.round(tonnage), 'kg'],
        ].map(([l, v, u]) => (
          <div key={l as string} className="bg-surface-1 px-4 py-3">
            <div className="text-micro uppercase text-fg-3">{l}</div>
            <div className="text-stat-sm text-fg-1">
              <Ticker value={v as number} />
              {u && <span className="ml-1 text-body-sm text-fg-3">{u}</span>}
            </div>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          <div className="grid grid-cols-[20px_minmax(10rem,1fr)_4rem_4rem_6rem_4rem_4.5rem_3rem_56px] items-center gap-1 border-b border-line-1 px-1 pb-1.5 text-micro uppercase text-fg-3">
            <span />
            <span className="pl-1.5">Exercise</span>
            <span className="text-right">Sets</span>
            <span className="text-right">Reps</span>
            <span className="text-right">Load</span>
            <span className="text-right">RPE</span>
            <span className="text-right">Rest</span>
            <span className="text-center">Grp</span>
            <span />
          </div>
          <datalist id={listId}>
            {EXERCISES.map((e) => (
              <option key={e} value={e} />
            ))}
          </datalist>
          <Reorder.Group
            as="div"
            axis="y"
            values={b.structure.steps.map((n) => n.id)}
            onReorder={(ids) => b.apply((s) => ({ ...s, steps: (ids as string[]).map((id) => s.steps.find((n) => n.id === id)!) }) as WorkoutStructure)}
            className="flex flex-col"
          >
            <AnimatePresence initial={false}>
              {b.structure.steps.map((n, i) =>
                n.kind === 'step' ? <ExerciseRow key={n.id} step={n} path={[i]} listId={listId} /> : null,
              )}
            </AnimatePresence>
          </Reorder.Group>
        </div>
      </div>
      <div>
        <Button size="sm" variant="ghost" icon={<Plus />} onClick={add}>
          Add exercise
        </Button>
      </div>
    </div>
  );
}

function ExerciseRow({ step, path, listId }: { step: Step; path: NodePath; listId: string }) {
  const b = useB();
  const controls = useDragControls();
  const s = step.strength;
  const set = (p: Partial<NonNullable<Step['strength']>>) =>
    b.apply((st) =>
      updateStep(st, path, (x) => {
        const strength = { ...(x.strength ?? { exercise: 'Exercise', sets: 1 }), ...p };
        for (const k of Object.keys(strength) as (keyof typeof strength)[]) if (strength[k] === undefined) delete strength[k];
        return { ...x, strength, measure: strength.reps ? { type: 'reps', n: strength.reps } : x.measure };
      }),
    );
  const sel = b.selected.includes(step.id);
  return (
    <Reorder.Item
      as="div"
      value={step.id}
      dragListener={false}
      dragControls={controls}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={spring.smooth}
      onPointerDown={() => b.select(step.id)}
      className={cn('group/row grid grid-cols-[20px_minmax(10rem,1fr)_4rem_4rem_6rem_4rem_4.5rem_3rem_56px] items-center gap-1 border-b border-line-1 px-1 py-1', sel && 'bg-surface-2')}
    >
      <button type="button" aria-label="Drag to reorder" onPointerDown={(e) => controls.start(e)} className="flex h-7 cursor-grab touch-none items-center justify-center text-fg-4 hover:text-fg-2">
        <GripVertical className="size-3.5" />
      </button>
      {s ? (
        <>
          <input
            list={listId}
            aria-label="Exercise"
            defaultValue={s.exercise}
            key={s.exercise}
            onBlur={(e) => {
              const v = e.currentTarget.value.trim();
              if (v && v !== s.exercise) set({ exercise: v });
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="h-7 min-w-0 rounded-sm border border-transparent bg-transparent px-1.5 text-body text-fg-1 outline-none hover:border-line-2 focus:border-line-3 focus:bg-surface-2"
          />
          <MiniField label="Sets" value={s.sets} width="w-full" format={String} parse={(v) => (+v >= 1 ? Math.round(+v) : null)} nudge={(v, d) => Math.max(1, v + d)} onCommit={(sets) => set({ sets })} />
          <MiniField
            label="Reps"
            value={s.reps ?? (s.durationSec ? -s.durationSec : 0)}
            width="w-full"
            format={(v) => (v < 0 ? fmtClock(-v) : v ? String(v) : '—')}
            parse={(v) => {
              const t = v.trim();
              if (/^\d+:\d\d$/.test(t)) return -(+t.split(':')[0] * 60 + +t.split(':')[1]);
              if (/^\d+s$/.test(t)) return -parseInt(t, 10);
              return +t >= 1 ? Math.round(+t) : null;
            }}
            nudge={(v, d) => (v < 0 ? Math.min(-5, v - d * 5) : Math.max(1, v + d))}
            onCommit={(v) => (v < 0 ? set({ reps: undefined, durationSec: -v }) : set({ reps: v, durationSec: undefined }))}
          />
          <MiniField
            label="Load"
            value={s.weightKg ?? -1}
            width="w-full"
            format={(v) => (v < 0 ? '—' : v === 0 ? 'BW' : `${v} kg`)}
            parse={(v) => {
              const t = v.trim().toLowerCase();
              if (!t || t === '—' || t === '-') return -1;
              if (t === 'bw' || t === '@bw') return 0;
              const n = parseFloat(t);
              return n >= 0 ? n : null;
            }}
            nudge={(v, d, big) => Math.max(0, (v < 0 ? 0 : v) + d * (big ? 10 : 2.5))}
            onCommit={(v) => set({ weightKg: v < 0 ? undefined : v })}
          />
          <MiniField label="RPE" value={s.rpe ?? 0} width="w-full" format={(v) => (v ? String(v) : '—')} parse={(v) => (!v.trim() || v === '—' ? 0 : +v >= 1 && +v <= 10 ? +v : null)} nudge={(v, d) => Math.min(10, Math.max(1, (v || 6) + d))} onCommit={(v) => set({ rpe: v || undefined })} />
          <MiniField label="Rest" value={s.restSec ?? 0} width="w-full" format={(v) => (v ? fmtClock(v) : '—')} parse={(v) => (/^\d+:\d\d$/.test(v.trim()) ? +v.split(':')[0] * 60 + +v.split(':')[1] : /^\d+$/.test(v.trim()) ? +v : !v.trim() || v === '—' ? 0 : null)} nudge={(v, d) => Math.max(0, v + d * 15)} onCommit={(v) => set({ restSec: v || undefined })} />
          <MiniField label="Superset group" value={s.supersetGroup ?? ''} width="w-full" align="left" format={(v) => v} parse={(v) => v.trim().toUpperCase().slice(0, 2)} onCommit={(v) => set({ supersetGroup: v || undefined })} className="[&_input]:text-center" />
        </>
      ) : (
        <span className="col-span-7 px-1.5 text-body-sm text-fg-3">Warm-up / cardio step — edit it in the text pane</span>
      )}
      <div className="flex justify-end opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 pointer-coarse:opacity-100">
        <IconButton size="sm" label="Duplicate" icon={<Copy />} onClick={() => b.apply((st) => duplicateNode(st, path))} />
        <IconButton size="sm" label="Delete" icon={<X />} onClick={() => b.remove(step.id)} />
      </div>
      <motion.span layout className="hidden" />
    </Reorder.Item>
  );
}
