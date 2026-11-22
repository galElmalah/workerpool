/**
 * The step list: rows for steps and nested repeat blocks, drag-to-reorder (Motion Reorder, spring
 * reflow), inline measure / target / cue editors, swim and row extras, repeat count stepper.
 */
import { SWIM_EQUIPMENT, SWIM_STROKES, STEP_ROLES, type Step, type StepRole, type WorkoutStructure, type StructureNode } from '@cadence/core';
import { duplicateNode, setRepeatCount, unwrapRepeat, updateNode, updateStep, type AnyNode, type NodePath, type RepeatNode } from '@cadence/core/workout';
import { AnimatePresence, motion, Reorder, useDragControls } from 'motion/react';
import { ChevronDown, Copy, GripVertical, Minus, Plus, Ungroup, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton, Menu, Popover } from '@/ui';
import { cn } from '@/lib/cn';
import { fmtClock } from '@cadence/core/workout';
import { spring } from '@/motion/tokens';
import { roleLabel } from '../model';
import { useB } from './context';
import { MeasureField, MiniField } from './fields';
import { TargetChip } from './TargetChip';

export interface StepMeta {
  level: number;
  durationSec: number;
}

const ZONE_BG = ['bg-z1', 'bg-z2', 'bg-z3', 'bg-z4', 'bg-z5', 'bg-z6', 'bg-z7'];

function setChildren(s: WorkoutStructure, parent: NodePath, ids: string[]): WorkoutStructure {
  const reorder = (kids: readonly AnyNode[]) => ids.map((id) => kids.find((k) => k.id === id)!).filter(Boolean);
  if (!parent.length) return { ...s, steps: reorder(s.steps as AnyNode[]) as StructureNode[] };
  return updateNode(s, parent, (r) => ({ ...(r as RepeatNode), steps: reorder((r as RepeatNode).steps as AnyNode[]) }) as AnyNode);
}

export function StepList({ nodes, parent, meta }: { nodes: readonly AnyNode[]; parent: NodePath; meta: Map<string, StepMeta> }) {
  const b = useB();
  return (
    <Reorder.Group as="div" axis="y" values={nodes.map((n) => n.id)} onReorder={(ids) => b.apply((s) => setChildren(s, parent, ids as string[]), { label: 'Reorder' })} className="flex flex-col gap-1" role="list">
      <AnimatePresence initial={false}>
        {nodes.map((n, i) => (
          <Item key={n.id} node={n} path={[...parent, i]} meta={meta} />
        ))}
      </AnimatePresence>
    </Reorder.Group>
  );
}

function Item({ node, path, meta }: { node: AnyNode; path: NodePath; meta: Map<string, StepMeta> }) {
  const controls = useDragControls();
  const b = useB();
  const sel = b.selected.includes(node.id);
  const grip = (
    <button
      type="button"
      aria-label="Drag to reorder"
      onPointerDown={(e) => {
        e.preventDefault();
        controls.start(e);
      }}
      className="flex h-7 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded-xs text-fg-4 transition-colors hover:text-fg-2 active:cursor-grabbing"
    >
      <GripVertical className="size-3.5" />
    </button>
  );
  return (
    <Reorder.Item
      as="div"
      value={node.id}
      dragListener={false}
      dragControls={controls}
      role="listitem"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.12 } }}
      whileDrag={{ scale: 1.015, zIndex: 20 }}
      transition={spring.smooth}
      className="relative"
    >
      {node.kind === 'repeat' ? <RepeatBlock node={node} path={path} meta={meta} grip={grip} selected={sel} /> : <StepRow step={node} path={path} meta={meta.get(node.id)} grip={grip} selected={sel} />}
    </Reorder.Item>
  );
}

function RowShell({ id, selected, children, className }: { id: string; selected: boolean; children: ReactNode; className?: string }) {
  const b = useB();
  return (
    <div
      data-node-id={id}
      tabIndex={-1}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('input,button,textarea,select,[role=menu]')) return;
        b.select(id, e.shiftKey);
      }}
      onFocus={(e) => {
        if (!b.selected.includes(id) && e.target === e.currentTarget) b.select(id);
      }}
      className={cn(
        'group/row relative rounded-md border transition-colors duration-(--dur-fast) outline-none',
        selected ? 'border-line-3 bg-surface-2' : 'border-line-1 bg-surface-1 hover:border-line-2',
        className,
      )}
    >
      {selected && <motion.span layoutId={`sel-${id}`} className="absolute top-1.5 bottom-1.5 -left-px w-0.5 rounded-full bg-accent" transition={spring.snappy} />}
      {children}
    </div>
  );
}

function StepRow({ step, path, meta, grip, selected }: { step: Step; path: NodePath; meta?: StepMeta; grip: ReactNode; selected: boolean }) {
  const b = useB();
  const patch = (p: Partial<Step>) => b.apply((s) => updateStep(s, path, (st) => ({ ...st, ...p })));
  const hovered = b.hovered === step.id;
  const lvl = Math.min(7, Math.max(1, meta?.level ?? 1));
  return (
    <RowShell id={step.id} selected={selected} className={cn(hovered && !selected && 'border-line-3')}>
      <div className="flex min-h-11 flex-wrap items-center gap-1 py-1 pr-1 pl-0.5 sm:flex-nowrap" onPointerEnter={() => b.setHovered(step.id)} onPointerLeave={() => b.setHovered(null)}>
        {grip}
        <span aria-hidden className={cn('h-5 w-1 shrink-0 rounded-full', ZONE_BG[lvl - 1])} />
        <Menu
          side="bottom"
          align="start"
          items={STEP_ROLES.map((r) => ({ label: roleLabel(r), checked: step.role === r, onSelect: () => patch({ role: r as StepRole }) }))}
          trigger={
            <button type="button" className="ml-1 inline-flex h-7 w-[6.75rem] shrink-0 items-center justify-between gap-1 rounded-sm px-1.5 text-micro uppercase text-fg-2 transition-colors hover:bg-surface-3 hover:text-fg-1">
              <span className="truncate">{roleLabel(step.role)}</span>
              <ChevronDown className="size-3 shrink-0 opacity-60" />
            </button>
          }
        />
        <MeasureToggle step={step} onChange={(measure) => patch({ measure })} />
        <MeasureField step={step} sport={b.sport} units={b.units} onChange={(measure) => patch({ measure })} />
        <div className="min-w-0 flex-1 max-sm:order-last max-sm:basis-full max-sm:pl-7">
          <TargetChip step={step} sport={b.sport} th={b.th} units={b.units} onChange={patch} />
        </div>
        {b.sport === 'swim' && <SwimChip step={step} onChange={patch} />}
        <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 pointer-coarse:opacity-100">
          <IconButton size="sm" label="Duplicate" icon={<Copy />} onClick={() => b.apply((s) => duplicateNode(s, path), { label: 'Duplicate' })} />
          <IconButton size="sm" label="Delete" icon={<X />} onClick={() => b.remove(step.id)} />
        </div>
      </div>
      {(selected || step.cue) && (
        <div className="-mt-1 flex items-center pb-1.5 pl-[3.25rem]">
          <span className="mr-1 font-mono text-mono-sm text-fg-4">//</span>
          <input
            aria-label="Cue"
            defaultValue={step.cue ?? ''}
            key={step.cue ?? ''}
            placeholder="Cue shown on the watch…"
            onBlur={(e) => {
              const v = e.currentTarget.value.trim();
              if (v !== (step.cue ?? '')) patch({ cue: v || undefined });
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="h-6 min-w-0 flex-1 bg-transparent text-body-sm text-fg-2 outline-none placeholder:text-fg-4 focus:text-fg-1"
          />
        </div>
      )}
    </RowShell>
  );
}

function MeasureToggle({ step, onChange }: { step: Step; onChange: (m: Step['measure']) => void }) {
  const b = useB();
  const m = step.measure;
  const dist = b.sport === 'run' || b.sport === 'swim' || b.sport === 'row' || b.sport === 'walk' || b.sport === 'hike' || b.sport === 'bike';
  return (
    <Menu
      align="start"
      items={[
        { label: 'By time', checked: m.type === 'time', onSelect: () => onChange({ type: 'time', sec: meta(step) ?? 300 }) },
        ...(dist ? [{ label: 'By distance', checked: m.type === 'distance', onSelect: () => onChange({ type: 'distance', m: b.sport === 'swim' ? 100 : b.sport === 'row' ? 500 : 1000 }) }] : []),
        { label: 'Until lap button', checked: m.type === 'lap_button', onSelect: () => onChange({ type: 'lap_button' }) },
      ]}
      trigger={
        <button type="button" aria-label="Measure type" className="flex h-7 w-4 shrink-0 items-center justify-center rounded-xs font-mono text-mono-sm text-fg-4 transition-colors hover:bg-surface-3 hover:text-fg-1">
          {m.type === 'time' ? '◷' : m.type === 'distance' ? '↦' : m.type === 'reps' ? '#' : '⏎'}
        </button>
      }
    />
  );
}
const meta = (s: Step) => (s.measure.type === 'time' ? s.measure.sec : undefined);

const STROKE_LABEL: Record<string, string> = { free: 'Free', back: 'Back', breast: 'Breast', fly: 'Fly', im: 'IM', choice: 'Choice', kick: 'Kick', drill: 'Drill' };
const EQUIP_LABEL: Record<string, string> = { pull_buoy: 'Pull buoy', paddles: 'Paddles', fins: 'Fins', kick_board: 'Kickboard', snorkel: 'Snorkel' };

function SwimChip({ step, onChange }: { step: Step; onChange: (p: Partial<Step>) => void }) {
  const sw = step.swim ?? {};
  const set = (p: Partial<NonNullable<Step['swim']>>) => onChange({ swim: { ...sw, ...p } });
  const parts = [sw.stroke && STROKE_LABEL[sw.stroke], sw.sendOffSec && `on ${fmtClock(sw.sendOffSec)}`, sw.restSec !== undefined && `r ${fmtClock(sw.restSec)}`, ...(sw.equipment ?? []).map((e) => EQUIP_LABEL[e].toLowerCase())].filter(Boolean);
  if (step.role === 'rest') return null;
  return (
    <Popover
      title="Swim options"
      trigger={
        <button type="button" className="inline-flex h-7 max-w-44 shrink items-center rounded-sm px-1.5 text-body-sm text-fg-2 transition-colors hover:bg-surface-3 hover:text-fg-1 data-[popup-open]:bg-surface-3">
          <span className="truncate">{parts.length ? parts.join(' · ') : '+ stroke'}</span>
        </button>
      }
    >
      <div className="flex w-72 flex-col gap-3 p-1">
        <div>
          <div className="mb-1.5 text-micro uppercase text-fg-3">Stroke</div>
          <div className="flex flex-wrap gap-1">
            {SWIM_STROKES.map((s) => (
              <Pill key={s} on={sw.stroke === s} onClick={() => set({ stroke: sw.stroke === s ? undefined : s })}>
                {STROKE_LABEL[s]}
              </Pill>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-micro uppercase text-fg-3">Equipment</div>
          <div className="flex flex-wrap gap-1">
            {SWIM_EQUIPMENT.map((e) => {
              const on = sw.equipment?.includes(e) ?? false;
              return (
                <Pill key={e} on={on} onClick={() => set({ equipment: on ? sw.equipment!.filter((x) => x !== e) : [...(sw.equipment ?? []), e] })}>
                  {EQUIP_LABEL[e]}
                </Pill>
              );
            })}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-line-1 pt-2">
          <span className="text-label text-fg-2">Send-off</span>
          <MiniField label="Send-off" value={sw.sendOffSec ?? 0} format={(v) => (v ? fmtClock(v) : '')} placeholder="1:50" parse={(s) => (s.trim() ? parseClock(s) : 0)} onCommit={(v) => set({ sendOffSec: v || undefined, ...(v ? { restSec: undefined } : {}) })} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-label text-fg-2">Rest after</span>
          <MiniField label="Rest" value={sw.restSec ?? 0} format={(v) => (v ? fmtClock(v) : '')} placeholder="0:20" parse={(s) => (s.trim() ? parseClock(s) : 0)} onCommit={(v) => set({ restSec: v || undefined, ...(v ? { sendOffSec: undefined } : {}) })} />
        </div>
      </div>
    </Popover>
  );
}

function parseClock(s: string): number | null {
  const m = s.trim().match(/^(\d+):([0-5]\d)$/);
  if (m) return +m[1] * 60 + +m[2];
  const n = s.trim().match(/^(\d+)\s*s?$/);
  return n ? +n[1] : null;
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn('h-6 rounded-sm border px-2 text-label transition-colors duration-(--dur-fast)', on ? 'border-line-3 bg-surface-active text-fg-1' : 'border-line-1 text-fg-2 hover:border-line-3 hover:text-fg-1')}
    >
      {children}
    </button>
  );
}

function RepeatBlock({ node, path, meta, grip, selected }: { node: RepeatNode; path: NodePath; meta: Map<string, StepMeta>; grip: ReactNode; selected: boolean }) {
  const b = useB();
  const setCount = (c: number) => b.apply((s) => setRepeatCount(s, path, c), { label: 'Repeat count' });
  const once = node.steps.reduce((a, c) => a + (c.kind === 'step' ? (meta.get(c.id)?.durationSec ?? 0) : 0), 0);
  return (
    <RowShell id={node.id} selected={selected} className="bg-transparent!">
      <div className="flex h-10 items-center gap-1 pr-1 pl-0.5">
        {grip}
        <span className="ml-1 text-micro uppercase text-fg-3">Repeat</span>
        <div className="ml-1 flex items-center rounded-sm border border-line-2 bg-surface-2">
          <button type="button" aria-label="Fewer repeats" className="flex size-6 items-center justify-center text-fg-3 hover:text-fg-1 disabled:opacity-30" disabled={node.count <= 1} onClick={() => setCount(node.count - 1)}>
            <Minus className="size-3" />
          </button>
          <MiniField label="Repeat count" value={node.count} width="w-8" align="left" format={(v) => `${v}×`} parse={(s) => (parseInt(s, 10) >= 1 ? Math.min(99, parseInt(s, 10)) : null)} nudge={(v, d) => Math.max(1, v + d)} onCommit={setCount} className="[&_input]:h-6 [&_input]:text-center" />
          <button type="button" aria-label="More repeats" className="flex size-6 items-center justify-center text-fg-3 hover:text-fg-1" onClick={() => setCount(node.count + 1)}>
            <Plus className="size-3" />
          </button>
        </div>
        {once > 0 && <span className="ml-2 font-mono text-mono-sm text-fg-3">{fmtClock(once * node.count)}</span>}
        <input
          aria-label="Repeat label"
          defaultValue={node.label ?? ''}
          key={node.label ?? ''}
          placeholder="Label"
          onBlur={(e) => {
            const v = e.currentTarget.value.trim();
            if (v !== (node.label ?? '')) b.apply((s) => updateNode(s, path, (r) => ({ ...(r as RepeatNode), label: v || undefined }) as AnyNode));
          }}
          className="ml-2 h-7 min-w-0 flex-1 bg-transparent text-body-sm text-fg-2 outline-none placeholder:text-fg-4"
        />
        <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 pointer-coarse:opacity-100">
          <IconButton size="sm" label="Unwrap repeat" icon={<Ungroup />} onClick={() => b.apply((s) => unwrapRepeat(s, path), { label: 'Unwrap' })} />
          <IconButton size="sm" label="Duplicate" icon={<Copy />} onClick={() => b.apply((s) => duplicateNode(s, path), { label: 'Duplicate' })} />
          <IconButton size="sm" label="Delete repeat" icon={<X />} onClick={() => b.remove(node.id)} />
        </div>
      </div>
      <div className="relative ml-3 border-l border-line-2 pb-1.5 pl-2.5 pr-1.5">
        <StepList nodes={node.steps as AnyNode[]} parent={path} meta={meta} />
      </div>
    </RowShell>
  );
}
