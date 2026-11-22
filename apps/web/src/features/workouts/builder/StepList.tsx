/**
 * The step list: rows for steps and nested repeat blocks, drag-to-reorder (Motion Reorder, spring
 * reflow), inline measure / target / cue editors, swim and row extras, repeat count stepper.
 */
import { SWIM_EQUIPMENT, SWIM_STROKES, STEP_ROLES, type Step, type StepRole, type WorkoutStructure, type StructureNode } from '@cadence/core';
import { duplicateNode, setRepeatCount, unwrapRepeat, updateNode, updateStep, type AnyNode, type NodePath, type RepeatNode } from '@cadence/core/workout';
import { AnimatePresence, Reorder, useDragControls } from 'motion/react';
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

function setChildren(s: WorkoutStructure, parent: NodePath, ids: string[]): WorkoutStructure {
  const reorder = (kids: readonly AnyNode[]) => ids.map((id) => kids.find((k) => k.id === id)!).filter(Boolean);
  if (!parent.length) return { ...s, steps: reorder(s.steps as AnyNode[]) as StructureNode[] };
  return updateNode(s, parent, (r) => ({ ...(r as RepeatNode), steps: reorder((r as RepeatNode).steps as AnyNode[]) }) as AnyNode);
}

export function StepList({ nodes, parent, meta }: { nodes: readonly AnyNode[]; parent: NodePath; meta: Map<string, StepMeta> }) {
  const b = useB();
  return (
    <Reorder.Group as="div" axis="y" values={nodes.map((n) => n.id)} onReorder={(ids) => b.apply((s) => setChildren(s, parent, ids as string[]), { label: 'Reorder' })} className="flex flex-col gap-0.5" role="list">
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
      className="flex h-8 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded-xs text-fg-4 opacity-0 transition-opacity duration-(--dur-fast) group-hover/row:opacity-100 group-focus-within/row:opacity-100 hover:text-fg-2 focus-visible:opacity-100 active:cursor-grabbing pointer-coarse:opacity-100"
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

/**
 * A row's surface: transparent at rest, one surface step on hover / when its blocks are hovered in
 * the profile, two when selected. Inside a repeat (already on surface-1) everything sits one step up.
 * No borders, no edge marks.
 */
function RowShell({ id, selected, hovered, nested, children, className }: { id: string; selected: boolean; hovered?: boolean; nested?: boolean; children: ReactNode; className?: string }) {
  const b = useB();
  return (
    <div
      data-node-id={id}
      tabIndex={-1}
      aria-selected={selected || undefined}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('input,button,textarea,select,[role=menu]')) return;
        b.select(id, e.shiftKey);
      }}
      onFocus={(e) => {
        if (!b.selected.includes(id) && e.target === e.currentTarget) b.select(id);
      }}
      className={cn(
        'group/row relative rounded-md outline-none transition-colors duration-(--dur-fast) focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus',
        selected ? (nested ? 'bg-surface-3' : 'bg-surface-2') : hovered ? (nested ? 'bg-surface-2' : 'bg-surface-1') : nested ? 'hover:bg-surface-2' : 'hover:bg-surface-1',
        className,
      )}
    >
      {children}
    </div>
  );
}

function StepRow({ step, path, meta, grip, selected }: { step: Step; path: NodePath; meta?: StepMeta; grip: ReactNode; selected: boolean }) {
  const b = useB();
  const patch = (p: Partial<Step>) => b.apply((s) => updateStep(s, path, (st) => ({ ...st, ...p })));
  const hovered = b.hovered === step.id;
  const nested = path.length > 1;
  void meta;
  return (
    <RowShell id={step.id} selected={selected} hovered={hovered} nested={nested}>
      <div className="flex min-h-12 flex-wrap items-center gap-1 py-1.5 pr-1.5 pl-1 sm:flex-nowrap" onPointerEnter={() => b.setHovered(step.id)} onPointerLeave={() => b.setHovered(null)}>
        {grip}
        <Menu
          side="bottom"
          align="start"
          items={STEP_ROLES.map((r) => ({ label: roleLabel(r), checked: step.role === r, onSelect: () => patch({ role: r as StepRole }) }))}
          trigger={
            <button type="button" aria-label={`Step type: ${roleLabel(step.role)}`} className="inline-flex h-8 w-28 shrink-0 items-center justify-between gap-1 rounded-sm px-2 text-body-sm text-fg-2 transition-colors duration-(--dur-fast) hover:bg-surface-3 hover:text-fg-1 data-[popup-open]:bg-surface-3">
              <span className="truncate">{roleLabel(step.role)}</span>
              <ChevronDown className="size-3 shrink-0 text-fg-4 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100" />
            </button>
          }
        />
        <MeasureToggle step={step} onChange={(measure) => patch({ measure })} />
        <MeasureField step={step} sport={b.sport} units={b.units} onChange={(measure) => patch({ measure })} />
        <div className="min-w-0 flex-1 max-sm:order-last max-sm:basis-full max-sm:pl-6">
          <TargetChip step={step} sport={b.sport} th={b.th} units={b.units} onChange={patch} />
        </div>
        {b.sport === 'swim' && <SwimChip step={step} onChange={patch} />}
        <div className="flex shrink-0 items-center opacity-0 transition-opacity duration-(--dur-fast) group-hover/row:opacity-100 group-focus-within/row:opacity-100 pointer-coarse:opacity-100">
          <IconButton size="sm" label="Duplicate" icon={<Copy />} onClick={() => b.apply((s) => duplicateNode(s, path), { label: 'Duplicate' })} />
          <IconButton size="sm" label="Delete" icon={<X />} onClick={() => b.remove(step.id)} />
        </div>
      </div>
      {(selected || step.cue) && (
        <div className="-mt-1.5 flex items-center pb-2 pl-[2.375rem]">
          <span className="mr-1.5 text-body-sm text-fg-4" aria-hidden>
            Cue
          </span>
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
            className="h-7 min-w-0 flex-1 rounded-sm bg-transparent px-1 text-body-sm text-fg-2 outline-none placeholder:text-fg-4 focus:text-fg-1 focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-focus"
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
        <button type="button" aria-label="Measure type" className="flex h-8 w-5 shrink-0 items-center justify-center rounded-xs text-body-sm text-fg-4 transition-colors duration-(--dur-fast) hover:bg-surface-3 hover:text-fg-1">
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
        <button type="button" className="inline-flex h-8 max-w-44 shrink items-center rounded-sm px-2 text-body-sm text-fg-2 transition-colors duration-(--dur-fast) hover:bg-surface-3 hover:text-fg-1 data-[popup-open]:bg-surface-3">
          <span className="truncate">{parts.length ? parts.join(' · ') : '+ stroke'}</span>
        </button>
      }
    >
      <div className="flex w-72 flex-col gap-3 p-1">
        <div>
          <div className="mb-2 text-label text-fg-3">Stroke</div>
          <div className="flex flex-wrap gap-1">
            {SWIM_STROKES.map((s) => (
              <Pill key={s} on={sw.stroke === s} onClick={() => set({ stroke: sw.stroke === s ? undefined : s })}>
                {STROKE_LABEL[s]}
              </Pill>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 text-label text-fg-3">Equipment</div>
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
        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-body-sm text-fg-2">Send-off</span>
          <MiniField label="Send-off" value={sw.sendOffSec ?? 0} format={(v) => (v ? fmtClock(v) : '')} placeholder="1:50" parse={(s) => (s.trim() ? parseClock(s) : 0)} onCommit={(v) => set({ sendOffSec: v || undefined, ...(v ? { restSec: undefined } : {}) })} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-body-sm text-fg-2">Rest after</span>
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
      className={cn('h-7 rounded-md px-2.5 text-body-sm transition-colors duration-(--dur-fast)', on ? 'bg-surface-active text-fg-1' : 'text-fg-3 hover:bg-surface-3 hover:text-fg-1')}
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
    <div
      data-node-id={node.id}
      tabIndex={-1}
      aria-selected={selected || undefined}
      onPointerDown={(e) => {
        const t = e.target as HTMLElement;
        if (t.closest('input,button,textarea,select,[role=menu]') || t.closest('[data-node-id]') !== e.currentTarget) return;
        b.select(node.id, e.shiftKey);
      }}
      onFocus={(e) => {
        if (!b.selected.includes(node.id) && e.target === e.currentTarget) b.select(node.id);
      }}
      className={cn(
        'group/rep my-1.5 rounded-lg p-1.5 outline-none transition-colors duration-(--dur-fast) focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus',
        selected ? 'bg-surface-2' : 'bg-surface-1',
      )}
    >
      <div className="group/row flex h-11 items-center gap-1 pr-0 pl-0">
        {grip}
        <span className="w-[4.25rem] text-body-sm text-fg-2">Repeat</span>
        <div className="flex h-8 items-center rounded-md bg-surface-3">
          <button type="button" aria-label="Fewer repeats" className="flex size-8 items-center justify-center rounded-md text-fg-3 transition-colors duration-(--dur-fast) hover:text-fg-1 disabled:opacity-30" disabled={node.count <= 1} onClick={() => setCount(node.count - 1)}>
            <Minus className="size-3.5" />
          </button>
          <MiniField label="Repeat count" value={node.count} width="w-11" align="left" format={(v) => `${v}×`} parse={(s) => (parseInt(s, 10) >= 1 ? Math.min(99, parseInt(s, 10)) : null)} nudge={(v, d) => Math.max(1, v + d)} onCommit={setCount} className="[&_input]:h-8 [&_input]:px-0 [&_input]:text-center [&_input]:font-medium" />
          <button type="button" aria-label="More repeats" className="flex size-8 items-center justify-center rounded-md text-fg-3 transition-colors duration-(--dur-fast) hover:text-fg-1" onClick={() => setCount(node.count + 1)}>
            <Plus className="size-3.5" />
          </button>
        </div>
        {once > 0 && <span className="ml-3 text-body-sm text-fg-3">{fmtClock(once * node.count)}</span>}
        <input
          aria-label="Repeat label"
          defaultValue={node.label ?? ''}
          key={node.label ?? ''}
          placeholder="Add a label"
          onBlur={(e) => {
            const v = e.currentTarget.value.trim();
            if (v !== (node.label ?? '')) b.apply((s) => updateNode(s, path, (r) => ({ ...(r as RepeatNode), label: v || undefined }) as AnyNode));
          }}
          className="ml-3 h-8 min-w-0 flex-1 rounded-sm bg-transparent px-1 text-body-sm text-fg-2 outline-none placeholder:text-fg-4 placeholder:opacity-0 group-hover/rep:placeholder:opacity-100 focus:placeholder:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-focus"
        />
        <div className="flex shrink-0 items-center opacity-0 transition-opacity duration-(--dur-fast) group-hover/row:opacity-100 group-focus-within/row:opacity-100 pointer-coarse:opacity-100">
          <IconButton size="sm" label="Unwrap repeat" icon={<Ungroup />} onClick={() => b.apply((s) => unwrapRepeat(s, path), { label: 'Unwrap' })} />
          <IconButton size="sm" label="Duplicate" icon={<Copy />} onClick={() => b.apply((s) => duplicateNode(s, path), { label: 'Duplicate' })} />
          <IconButton size="sm" label="Delete repeat" icon={<X />} onClick={() => b.remove(node.id)} />
        </div>
      </div>
      <div className="pl-5">
        <StepList nodes={node.steps as AnyNode[]} parent={path} meta={meta} />
      </div>
    </div>
  );
}
