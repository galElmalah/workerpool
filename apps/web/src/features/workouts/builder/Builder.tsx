/**
 * The workout builder (product.md §4.5): profile graph on top, step list on the left, the text
 * editor on the right — bidirectionally synced. Text is the source while you type in it (parsed
 * on every keystroke, node ids reconciled so blocks morph instead of re-mounting); the canonical
 * text is re-generated from the structure after structural edits and on blur. Mobile: graph pinned
 * on top with "Steps | Text" tabs. Strength swaps the graph for an exercise table.
 */
import type { Sport, SubSport, ThresholdSnapshot, WorkoutStructure } from '@cadence/core';
import {
  formatWorkoutText,
  garminSupport,
  getNode,
  insertNode,
  moveNode,
  parseWorkoutText,
  removeNode,
  walk,
  wrapInRepeat,
  duplicateNode,
  type AnyNode,
  type NodePath,
  type TextIssue,
  type WorkoutEstimate,
} from '@cadence/core/workout';
import { Group, Plus, Watch } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IntensityProfile, levelFor } from '@/charts';
import { Button, Kbd, Segmented, toast } from '@/ui';
import { cn } from '@/lib/cn';
import { useIsMobile } from '@/lib/hooks';
import { useUnits } from '@/lib/units';
import { axisLabelFor, chartBlocks, presetNode, reconcileIds, type Preset } from '../model';
import { Ctx, type BuilderCtx } from './context';
import { StepList, type StepMeta } from './StepList';
import { StrengthTable } from './StrengthTable';
import { TextPane } from './TextPane';

export interface BuilderProps {
  sport: Sport;
  subSport?: SubSport;
  structure: WorkoutStructure;
  onChange: (s: WorkoutStructure) => void;
  thresholds: ThresholdSnapshot;
  estimate: WorkoutEstimate;
  /** Focus the text editor (or the first step) on mount — `/workouts/:id/edit`. */
  autoFocus?: 'text' | 'steps';
  /** Show the Garmin compatibility line (default true). */
  garminLine?: boolean;
}

const PRESETS: { p: Preset; label: string }[] = [
  { p: 'warmup', label: 'Warm-up' },
  { p: 'interval', label: 'Interval' },
  { p: 'recovery', label: 'Recovery' },
  { p: 'cooldown', label: 'Cool-down' },
  { p: 'repeat', label: 'Repeat' },
];

export function Builder({ sport, subSport, structure, onChange, thresholds, estimate, autoFocus, garminLine = true }: BuilderProps) {
  const units = useUnits();
  const mobile = useIsMobile();
  const [selected, setSelected] = useState<string[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [tab, setTab] = useState<'steps' | 'text'>(autoFocus === 'text' ? 'text' : 'steps');
  const textRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ── text ⇄ structure sync ──
  const fmt = useCallback((s: WorkoutStructure) => formatWorkoutText(s, sport, { units: units.system }), [sport, units.system]);
  const [text, setText] = useState(() => fmt(structure));
  const [issues, setIssues] = useState<TextIssue[]>([]);
  const fromText = useRef<WorkoutStructure | null>(null);
  const typing = useRef(false);
  const structRef = useRef(structure);
  structRef.current = structure;

  useEffect(() => {
    if (structure === fromText.current) return;
    if (typing.current) return;
    setText(fmt(structure));
    setIssues([]);
  }, [structure, fmt]);

  const onText = (v: string) => {
    setText(v);
    const r = parseWorkoutText(v, sport, { thresholds });
    const next = reconcileIds(structRef.current, r.structure);
    fromText.current = next;
    setIssues(r.issues);
    onChange(next);
  };
  const onTextBlur = () => {
    typing.current = false;
    if (!issues.some((i) => i.severity === 'error')) {
      setText(fmt(structRef.current));
      setIssues((is) => is.filter((i) => i.severity === 'info'));
    }
  };

  useEffect(() => {
    if (autoFocus === 'text') requestAnimationFrame(() => textRef.current?.focus());
    if (autoFocus === 'steps') requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>('input,button[aria-label^="Target"]')?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── editing ──
  const pathOf = useCallback(
    (id: string): NodePath | undefined => {
      let out: NodePath | undefined;
      walk(structRef.current, (n, p) => {
        if (n.id === id) out = p;
      });
      return out;
    },
    [],
  );
  const apply = useCallback(
    (fn: (s: WorkoutStructure) => WorkoutStructure) => {
      const next = fn(structRef.current);
      if (next !== structRef.current) onChange(next);
    },
    [onChange],
  );
  const remove = useCallback(
    (id: string) => {
      const p = pathOf(id);
      if (!p) return;
      const before = structRef.current;
      const n = getNode(before, p);
      onChange(removeNode(before, p));
      setSelected((s) => s.filter((x) => x !== id));
      toast.undo(<>Removed {n?.kind === 'repeat' ? 'repeat block' : 'step'}</>, () => onChange(before));
    },
    [onChange, pathOf],
  );
  const select = useCallback(
    (id: string, extend?: boolean) => {
      setSelected((cur) => {
        if (!extend || !cur.length) return [id];
        const a = pathOf(cur[0]);
        const b = pathOf(id);
        if (!a || !b || a.length !== b.length || a.slice(0, -1).join() !== b.slice(0, -1).join()) return [id];
        const parent = a.slice(0, -1);
        const lo = Math.min(a[a.length - 1], b[b.length - 1]);
        const hi = Math.max(a[a.length - 1], b[b.length - 1]);
        const ids: string[] = [];
        for (let k = lo; k <= hi; k++) {
          const n = getNode(structRef.current, [...parent, k]);
          if (n) ids.push(n.id);
        }
        return ids;
      });
    },
    [pathOf],
  );

  const addPreset = (p: Preset) => {
    const node = presetNode(p, sport);
    const sel = selected.length ? pathOf(selected[selected.length - 1]) : undefined;
    let at: NodePath;
    if (p === 'warmup' || p === 'cooldown' || p === 'repeat') {
      // block-level presets live at the top level, after the selected block
      at = sel ? [sel[0] + 1] : p === 'warmup' ? [0] : [structure.steps.length];
    } else if (sel) {
      const n = getNode(structure, sel);
      at = n?.kind === 'repeat' ? [...sel, n.steps.length] : [...sel.slice(0, -1), sel[sel.length - 1] + 1];
    } else at = [structure.steps.length];
    let next = insertNode(structure, at, node);
    if (next === structure) next = insertNode(structure, [structure.steps.length], node);
    onChange(next);
    setSelected([node.id]);
  };
  const wrap = () => {
    const paths = selected.map(pathOf).filter((p): p is NodePath => !!p);
    if (!paths.length) return;
    const next = wrapInRepeat(structure, paths, 3);
    if (next === structure) return toast('Pick neighbouring steps to wrap');
    onChange(next);
  };

  const onListKey = (e: React.KeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (el.closest('input,textarea,[role=menu]')) return;
    const mod = e.metaKey || e.ctrlKey;
    const cur = selected[0];
    if (mod && e.key.toLowerCase() === 'g') {
      e.preventDefault();
      wrap();
    } else if (mod && e.key.toLowerCase() === 'd' && cur) {
      e.preventDefault();
      const p = pathOf(cur);
      if (p) onChange(duplicateNode(structure, p));
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && cur) {
      e.preventDefault();
      remove(cur);
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && cur) {
      e.preventDefault();
      const p = pathOf(cur);
      if (!p) return;
      const d = e.key === 'ArrowUp' ? -1 : 1;
      if (e.altKey) {
        const to = [...p.slice(0, -1), Math.max(0, p[p.length - 1] + d)];
        onChange(moveNode(structure, p, to));
      } else {
        const order: string[] = [];
        walk(structure, (n) => void order.push(n.id));
        const i = order.indexOf(cur);
        const nx = order[Math.max(0, Math.min(order.length - 1, i + d))];
        setSelected([nx]);
        listRef.current?.querySelector<HTMLElement>(`[data-node-id="${nx}"]`)?.focus();
      }
    } else if (e.key === 'Escape') setSelected([]);
  };

  // ── derived ──
  const { blocks, repeats } = useMemo(() => chartBlocks(estimate, structure), [estimate, structure]);
  const meta = useMemo(() => {
    const m = new Map<string, StepMeta>();
    for (const b of estimate.profile) if (!m.has(b.stepId)) m.set(b.stepId, { level: levelFor(b.rampTo !== undefined ? Math.max(b.rampFrom ?? 0, b.rampTo) : b.intensity), durationSec: b.durationSec });
    return m;
  }, [estimate]);
  const lineOf = useMemo(() => {
    const m = new Map<string, number>();
    let line = structure.poolLengthM !== undefined ? 2 : 1;
    walk(structure, (n) => void m.set(n.id, line++));
    return m;
  }, [structure]);
  const focusId = hovered ?? selected[0] ?? null;
  const activeLine = focusId && !typing.current ? (lineOf.get(focusId) ?? null) : null;

  const ctx: BuilderCtx = { sport, units, th: thresholds, structure, apply, selected, select, hovered, setHovered, pathOf, remove };
  const isStrength = sport === 'strength';

  const graph = !isStrength && (
    <div className={cn('-mx-1', mobile && 'sticky top-(--header-h) z-10 bg-canvas pt-2 pb-1')}>
      <IntensityProfile
        blocks={blocks}
        repeats={repeats}
        height={mobile ? 96 : 160}
        axisLabel={axisLabelFor(sport)}
        hoveredId={hovered}
        onHover={(id) => setHovered(id ? id.split('#')[0] : null)}
        selectedId={selected[0] ?? null}
        onSelect={(id) => {
          const sid = id.split('#')[0];
          setSelected([sid]);
          listRef.current?.querySelector<HTMLElement>(`[data-node-id="${sid}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }}
      />
    </div>
  );

  const steps = (
    <div ref={listRef} onKeyDown={onListKey} className="flex min-w-0 flex-col gap-4">
      {isStrength ? (
        <StrengthTable />
      ) : (
        <>
          {sport === 'swim' && <PoolLength structure={structure} onChange={onChange} />}
          {structure.steps.length ? (
            <StepList nodes={structure.steps as AnyNode[]} parent={[]} meta={meta} />
          ) : (
            <p className="rounded-lg bg-surface-1 px-4 py-8 text-center text-body-sm text-fg-3">Add a warm-up to start, or type in the text pane.</p>
          )}
          <div className="-ml-2 flex flex-wrap items-center gap-0.5">
            {PRESETS.map(({ p, label }) => (
              <Button key={p} size="sm" variant="ghost" icon={<Plus />} onClick={() => addPreset(p)}>
                {label}
              </Button>
            ))}
            {selected.length > 0 && (
              <Button size="sm" variant="ghost" icon={<Group />} onClick={wrap} className="sm:ml-auto">
                Wrap in repeat <Kbd keys="mod+g" className="ml-1" />
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );

  const textPane = (
    <TextPane
      value={text}
      onChange={onText}
      onFocus={() => (typing.current = true)}
      onBlur={onTextBlur}
      issues={issues}
      sport={sport}
      activeLine={activeLine}
      textareaRef={textRef}
      minRows={mobile ? 10 : Math.min(22, Math.max(12, (text.match(/\n/g)?.length ?? 0) + 3))}
    />
  );

  return (
    <Ctx.Provider value={ctx}>
      <div className="flex flex-col gap-6">
        {graph}
        {mobile ? (
          <>
            <Segmented
              aria-label="Builder view"
              block
              value={tab}
              onValueChange={setTab}
              options={[
                { value: 'steps', label: isStrength ? 'Exercises' : 'Steps' },
                { value: 'text', label: 'Text' },
              ]}
            />
            {tab === 'steps' ? steps : textPane}
          </>
        ) : (
          <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-8">
            {steps}
            {textPane}
          </div>
        )}
        {garminLine && <GarminLine sport={sport} subSport={subSport} structure={structure} thresholds={thresholds} />}
      </div>
    </Ctx.Provider>
  );
}

function PoolLength({ structure, onChange }: { structure: WorkoutStructure; onChange: (s: WorkoutStructure) => void }) {
  const v = structure.poolLengthM === 50 ? '50' : structure.poolLengthM && Math.abs(structure.poolLengthM - 22.86) < 0.01 ? '25y' : '25';
  return (
    <div className="flex items-center gap-3">
      <span className="text-body-sm text-fg-3">Pool</span>
      <Segmented
        size="sm"
        aria-label="Pool length"
        value={v}
        onValueChange={(x) => onChange({ ...structure, poolLengthM: x === '50' ? 50 : x === '25y' ? 22.86 : 25 })}
        options={[
          { value: '25', label: '25 m' },
          { value: '50', label: '50 m' },
          { value: '25y', label: '25 yd' },
        ]}
      />
    </div>
  );
}

const GARMIN_TYPE: Record<string, string> = {
  running: 'a structured running workout',
  cycling: 'a structured cycling workout',
  swimming: 'a structured pool swim',
  strength_training: 'a strength workout with exercises',
  cardio_training: 'a cardio workout with step notes',
  yoga: 'a yoga workout',
  mobility: 'a mobility workout',
  hiit: 'a HIIT workout',
  other: 'an “Other” workout',
};

export function GarminLine({ sport, subSport, structure, thresholds, className }: { sport: Sport; subSport?: SubSport; structure?: WorkoutStructure; thresholds?: ThresholdSnapshot; className?: string }) {
  const g = useMemo(() => garminSupport(sport, structure, { subSport, thresholds }), [sport, subSport, structure, thresholds]);
  const first = sport === 'row' ? 'Rowing isn’t a Garmin workout type — sent as cardio with step notes' : g.pushable ? `Sends to Garmin as ${GARMIN_TYPE[g.sportTypeKey] ?? 'a workout'}` : 'Not sent to Garmin until it has steps';
  const rest = g.warnings.filter((w) => !(sport === 'row' && w.startsWith('Garmin has no rowing')));
  return (
    <div className={cn('flex items-start gap-2 text-body-sm text-fg-3', className)}>
      <Watch className="mt-0.5 size-3.5 shrink-0 text-fg-4" />
      <div className="min-w-0">
        <span className="text-fg-2">{first}.</span>
        {rest.length > 0 && <span> {rest.join(' ')}</span>}
      </div>
    </div>
  );
}
