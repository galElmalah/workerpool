/**
 * Pure utilities over {@link WorkoutStructure}: ids, traversal, flattening (repeat expansion),
 * immutable edit helpers for the builder, and validation.
 *
 * Nesting (domain.ts): top level holds Steps and Repeats; a Repeat holds Steps and InnerRepeats;
 * an InnerRepeat holds Steps only (max depth 2). Nodes are addressed by a {@link NodePath}:
 * the index at each level, e.g. `[2]` = third top-level node, `[2, 0, 1]` = second step of the
 * first inner repeat of that repeat.
 *
 * All edit helpers return a NEW structure, never mutate, and preserve the ids of nodes they
 * keep (ids are layout-animation keys). Invalid edits (bad path, nesting too deep) return the
 * input structure unchanged (same reference) so callers can detect a no-op with `===`.
 */
import type { InnerRepeat, Repeat, Sport, Step, StructureNode, Target, WorkoutStructure } from '../domain';

export type AnyNode = Step | Repeat | InnerRepeat;
export type RepeatNode = Repeat | InnerRepeat;
export type NodePath = readonly number[];

/** Maximum repeat nesting depth (a repeat inside a repeat). */
export const MAX_REPEAT_DEPTH = 2;

// ───────────────────────────── ids ─────────────────────────────

let idCounter = 0;

/** A short random id (≈ 60 bits), unique enough for client-side node keys. Isomorphic. */
export function newId(prefix = 'n'): string {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } }).crypto;
  let rnd = '';
  if (c?.getRandomValues) {
    const a = c.getRandomValues(new Uint32Array(2));
    rnd = a[0].toString(36) + a[1].toString(36);
  } else {
    rnd = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }
  idCounter = (idCounter + 1) % 1_679_616;
  return `${prefix}_${rnd.slice(0, 10)}${idCounter.toString(36)}`;
}

/** Deep clone of a node with fresh ids on it and all descendants. */
export function cloneWithNewIds<T extends AnyNode>(node: T): T {
  if (node.kind === 'step') return { ...structuredCloneSafe(node), id: newId('s') } as T;
  return {
    ...node,
    id: newId('r'),
    steps: node.steps.map((c) => cloneWithNewIds(c as AnyNode)),
  } as T;
}

/** Fresh ids for every node of a structure (e.g. when instantiating a template). */
export function reassignIds(structure: WorkoutStructure): WorkoutStructure {
  return { ...structure, steps: structure.steps.map((n) => cloneWithNewIds(n)) };
}

/** A copy with every `id` set to '' — for "equal modulo ids" comparisons. */
export function stripIds(structure: WorkoutStructure): WorkoutStructure {
  const strip = (n: AnyNode): AnyNode =>
    n.kind === 'step' ? { ...n, id: '' } : ({ ...n, id: '', steps: n.steps.map((c) => strip(c as AnyNode)) } as AnyNode);
  return { ...structure, steps: structure.steps.map((n) => strip(n) as StructureNode) };
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ───────────────────────────── traversal ─────────────────────────────

/**
 * Depth-first pre-order traversal. `visit` may return `false` to skip a repeat's children.
 * `depth` is 0 at top level.
 */
export function walk(
  structure: WorkoutStructure,
  visit: (node: AnyNode, path: NodePath, parent: RepeatNode | null, depth: number) => void | false,
): void {
  const rec = (nodes: readonly AnyNode[], prefix: number[], parent: RepeatNode | null, depth: number) => {
    nodes.forEach((n, i) => {
      const path = [...prefix, i];
      const r = visit(n, path, parent, depth);
      if (r !== false && n.kind === 'repeat') rec(n.steps as AnyNode[], path, n, depth + 1);
    });
  };
  rec(structure.steps, [], null, 0);
}

/** All steps (not expanded) with their paths, in document order. */
export function listSteps(structure: WorkoutStructure): { step: Step; path: NodePath }[] {
  const out: { step: Step; path: NodePath }[] = [];
  walk(structure, (n, path) => {
    if (n.kind === 'step') out.push({ step: n, path });
  });
  return out;
}

/** Returns a new structure where every step is replaced by `fn(step, path)`. */
export function mapSteps(structure: WorkoutStructure, fn: (step: Step, path: NodePath) => Step): WorkoutStructure {
  const rec = (n: AnyNode, path: number[]): AnyNode =>
    n.kind === 'step' ? fn(n, path) : ({ ...n, steps: n.steps.map((c, i) => rec(c as AnyNode, [...path, i])) } as AnyNode);
  return { ...structure, steps: structure.steps.map((n, i) => rec(n, [i]) as StructureNode) };
}

/** Node at `path`, or undefined. */
export function getNode(structure: WorkoutStructure, path: NodePath): AnyNode | undefined {
  let nodes: readonly AnyNode[] = structure.steps;
  let node: AnyNode | undefined;
  for (const i of path) {
    if (!nodes) return undefined;
    node = nodes[i];
    if (!node) return undefined;
    nodes = node.kind === 'repeat' ? (node.steps as AnyNode[]) : (undefined as unknown as AnyNode[]);
  }
  return node;
}

/** Repeat nesting levels inside a node: step 0, repeat of steps 1, repeat containing a repeat 2. */
export function nodeHeight(node: AnyNode): number {
  if (node.kind === 'step') return 0;
  return 1 + Math.max(0, ...node.steps.map((c) => nodeHeight(c as AnyNode)));
}

/** Deepest repeat nesting of the structure (0 = no repeats). */
export function structureDepth(structure: WorkoutStructure): number {
  return Math.max(0, ...structure.steps.map(nodeHeight));
}

/** Number of executable steps after full repeat expansion. */
export function countUnrolledSteps(structure: WorkoutStructure): number {
  const count = (n: AnyNode): number =>
    n.kind === 'step' ? 1 : n.count * n.steps.reduce((s, c) => s + count(c as AnyNode), 0);
  return structure.steps.reduce((s, n) => s + count(n), 0);
}

// ───────────────────────────── flattening ─────────────────────────────

export interface FlatStep {
  step: Step;
  /** Path of the step node in the tree. */
  path: NodePath;
  /** Position in execution order (0-based). */
  index: number;
  /** 0-based iteration of each enclosing repeat, outermost first ([] at top level). */
  iterations: number[];
  /** Counts of the enclosing repeats, outermost first. */
  counts: number[];
  /** Ids of the enclosing repeats, outermost first. */
  repeatIds: string[];
  /** Iteration of the innermost enclosing repeat, or 0 at top level. */
  iteration: number;
  /** Duration in seconds when known (time measure, or from `durationOf`). */
  durationSec?: number;
  /** Start offset in seconds; undefined once any earlier duration is unknown. */
  startSec?: number;
}

/** Duration of a step when it is directly known: time measure, or a timed strength set. */
export function knownDurationSec(step: Step): number | undefined {
  return step.measure.type === 'time' ? step.measure.sec : undefined;
}

/**
 * Concrete steps in execution order with repeats expanded.
 * @param durationOf optional duration resolver (seconds) — defaults to {@link knownDurationSec}.
 */
export function flattenStructure(
  structure: WorkoutStructure,
  durationOf: (step: Step) => number | undefined = knownDurationSec,
): FlatStep[] {
  const out: FlatStep[] = [];
  let t: number | undefined = 0;
  const rec = (nodes: readonly AnyNode[], prefix: number[], iterations: number[], counts: number[], ids: string[]) => {
    nodes.forEach((n, i) => {
      const path = [...prefix, i];
      if (n.kind === 'step') {
        const d = durationOf(n);
        out.push({
          step: n,
          path,
          index: out.length,
          iterations,
          counts,
          repeatIds: ids,
          iteration: iterations.length ? iterations[iterations.length - 1] : 0,
          durationSec: d,
          startSec: t,
        });
        t = t !== undefined && d !== undefined ? t + d : undefined;
      } else {
        const count = Math.max(0, Math.floor(n.count));
        for (let k = 0; k < count; k++) {
          rec(n.steps as AnyNode[], path, [...iterations, k], [...counts, n.count], [...ids, n.id]);
        }
      }
    });
  };
  rec(structure.steps, [], [], [], []);
  return out;
}

// ───────────────────────────── immutable edits ─────────────────────────────

/** Children array at `parentPath` ([] = top level), or undefined when not a container. */
function childrenAt(structure: WorkoutStructure, parentPath: NodePath): readonly AnyNode[] | undefined {
  if (parentPath.length === 0) return structure.steps;
  const n = getNode(structure, parentPath);
  return n && n.kind === 'repeat' ? (n.steps as AnyNode[]) : undefined;
}

/** Replace the children array of the container at `parentPath`. */
function withChildren(structure: WorkoutStructure, parentPath: NodePath, children: AnyNode[]): WorkoutStructure {
  if (parentPath.length === 0) return { ...structure, steps: children as StructureNode[] };
  const rec = (nodes: readonly AnyNode[], depth: number): AnyNode[] =>
    nodes.map((n, i) => {
      if (i !== parentPath[depth] || n.kind !== 'repeat') return n;
      if (depth === parentPath.length - 1) return { ...n, steps: children } as AnyNode;
      return { ...n, steps: rec(n.steps as AnyNode[], depth + 1) } as AnyNode;
    });
  return { ...structure, steps: rec(structure.steps, 0) as StructureNode[] };
}

/** Whether `node` may live inside the container at `parentPath` (depth rule). */
export function canPlace(parentPath: NodePath, node: AnyNode): boolean {
  // container depth: top level = 0 → allows height ≤ 2; inside repeat (1) → ≤ 1; inside inner (2) → 0.
  return nodeHeight(node) <= MAX_REPEAT_DEPTH - parentPath.length;
}

/** Replace the node at `path` with `fn(node)`. */
export function updateNode(structure: WorkoutStructure, path: NodePath, fn: (node: AnyNode) => AnyNode): WorkoutStructure {
  if (path.length === 0) return structure;
  const parentPath = path.slice(0, -1);
  const kids = childrenAt(structure, parentPath);
  const i = path[path.length - 1];
  if (!kids || !kids[i]) return structure;
  const next = fn(kids[i]);
  if (!canPlace(parentPath, next)) return structure;
  const copy = kids.slice();
  copy[i] = next;
  return withChildren(structure, parentPath, copy);
}

/** Patch the step at `path` (no-op when the node is not a step). The id is preserved. */
export function updateStep(
  structure: WorkoutStructure,
  path: NodePath,
  patch: Partial<Omit<Step, 'kind' | 'id'>> | ((step: Step) => Step),
): WorkoutStructure {
  const n = getNode(structure, path);
  if (!n || n.kind !== 'step') return structure;
  return updateNode(structure, path, (s) => {
    const step = s as Step;
    const next = typeof patch === 'function' ? patch(step) : { ...step, ...patch };
    return { ...next, kind: 'step', id: step.id };
  });
}

/** Set a repeat's count (integer ≥ 1). */
export function setRepeatCount(structure: WorkoutStructure, path: NodePath, count: number): WorkoutStructure {
  const n = getNode(structure, path);
  if (!n || n.kind !== 'repeat') return structure;
  const c = Math.max(1, Math.round(count));
  if (c === n.count) return structure;
  return updateNode(structure, path, (r) => ({ ...(r as RepeatNode), count: c }));
}

/**
 * Insert `node` so it ends up at `path` (the last index is the position within the parent;
 * it may equal the parent's length to append).
 */
export function insertNode(structure: WorkoutStructure, path: NodePath, node: AnyNode): WorkoutStructure {
  if (path.length === 0) return structure;
  const parentPath = path.slice(0, -1);
  const kids = childrenAt(structure, parentPath);
  const i = path[path.length - 1];
  if (!kids || i < 0 || i > kids.length || !canPlace(parentPath, node)) return structure;
  const copy = kids.slice();
  copy.splice(i, 0, node);
  return withChildren(structure, parentPath, copy);
}

function removeRaw(structure: WorkoutStructure, path: NodePath): WorkoutStructure {
  if (path.length === 0) return structure;
  const parentPath = path.slice(0, -1);
  const kids = childrenAt(structure, parentPath);
  const i = path[path.length - 1];
  if (!kids || !kids[i]) return structure;
  const copy = kids.slice();
  copy.splice(i, 1);
  return withChildren(structure, parentPath, copy);
}

/** Remove repeats that have no steps left (recursively). Returns the input when none. */
export function pruneEmptyRepeats(structure: WorkoutStructure): WorkoutStructure {
  let changed = false;
  const rec = (nodes: readonly AnyNode[]): AnyNode[] =>
    nodes.flatMap((n) => {
      if (n.kind === 'step') return [n];
      const kids = rec(n.steps as AnyNode[]);
      if (!kids.length) {
        changed = true;
        return [];
      }
      const local = kids.length !== n.steps.length || kids.some((k, i) => k !== n.steps[i]);
      if (local) changed = true;
      return [local ? ({ ...n, steps: kids } as AnyNode) : n];
    });
  const steps = rec(structure.steps);
  return changed ? { ...structure, steps: steps as StructureNode[] } : structure;
}

/** Remove the node at `path`. A repeat left empty is removed as well. */
export function removeNode(structure: WorkoutStructure, path: NodePath): WorkoutStructure {
  const out = removeRaw(structure, path);
  return out === structure ? structure : pruneEmptyRepeats(out);
}

/**
 * Move the node at `from` to `to`. `to` is expressed in the ORIGINAL tree: within the same
 * parent it is the final index (array-move semantics); into another container the node is
 * inserted before the node currently at `to` (or appended when `to` is one past the end).
 * Moving a repeat into itself, or deeper than allowed, is a no-op.
 */
export function moveNode(structure: WorkoutStructure, from: NodePath, to: NodePath): WorkoutStructure {
  const node = getNode(structure, from);
  if (!node || to.length === 0) return structure;
  const isPrefix = from.length <= to.length && from.every((v, k) => to[k] === v);
  const sameParent = from.length === to.length && from.slice(0, -1).every((v, k) => to[k] === v);
  if (isPrefix && !sameParent) return structure; // into itself
  if (sameParent && from[from.length - 1] === to[to.length - 1]) return structure;
  const adjusted = to.slice();
  if (!sameParent) {
    // Removing `from` shifts later siblings (and their subtrees) one to the left.
    const d = from.length - 1;
    const sharesParent = from.slice(0, d).every((v, k) => to[k] === v);
    if (to.length > from.length - 1 && sharesParent && to[d] > from[d]) adjusted[d] -= 1;
  }
  const removed = removeRaw(structure, from);
  const parentPath = adjusted.slice(0, -1);
  if (!childrenAt(removed, parentPath) || !canPlace(parentPath, node)) return structure;
  const out = insertNode(removed, adjusted, node);
  return out === removed ? structure : pruneEmptyRepeats(out);
}

/** Insert a deep copy (fresh ids) right after the node at `path`. */
export function duplicateNode(structure: WorkoutStructure, path: NodePath): WorkoutStructure {
  const n = getNode(structure, path);
  if (!n) return structure;
  const next = path.slice();
  next[next.length - 1] += 1;
  return insertNode(structure, next, cloneWithNewIds(n));
}

/**
 * Wrap contiguous siblings in a new repeat (the builder's "Wrap in repeat", ⌘G).
 * `paths` must share a parent and be contiguous (any order). Returns unchanged when invalid
 * or when the result would exceed the nesting depth.
 */
export function wrapInRepeat(
  structure: WorkoutStructure,
  paths: readonly NodePath[],
  count = 2,
  label?: string,
): WorkoutStructure {
  if (!paths.length) return structure;
  const parentPath = paths[0].slice(0, -1);
  if (!paths.every((p) => p.length === parentPath.length + 1 && parentPath.every((v, k) => p[k] === v))) return structure;
  const idx = [...new Set(paths.map((p) => p[p.length - 1]))].sort((a, b) => a - b);
  for (let k = 1; k < idx.length; k++) if (idx[k] !== idx[k - 1] + 1) return structure;
  const kids = childrenAt(structure, parentPath);
  if (!kids || idx[0] < 0 || idx[idx.length - 1] >= kids.length) return structure;
  const repeat = {
    kind: 'repeat',
    id: newId('r'),
    count: Math.max(1, Math.round(count)),
    ...(label ? { label } : {}),
    steps: kids.slice(idx[0], idx[idx.length - 1] + 1),
  } as AnyNode;
  if (!canPlace(parentPath, repeat)) return structure;
  const copy = kids.slice();
  copy.splice(idx[0], idx.length, repeat);
  return withChildren(structure, parentPath, copy);
}

/** Replace the repeat at `path` by its children (once). */
export function unwrapRepeat(structure: WorkoutStructure, path: NodePath): WorkoutStructure {
  const n = getNode(structure, path);
  if (!n || n.kind !== 'repeat' || path.length === 0) return structure;
  const parentPath = path.slice(0, -1);
  const kids = childrenAt(structure, parentPath)!;
  const copy = kids.slice();
  copy.splice(path[path.length - 1], 1, ...(n.steps as AnyNode[]));
  return withChildren(structure, parentPath, copy);
}

/** Expand a repeat into `count` copies of its children (first copy keeps the ids). */
export function unrollRepeat(structure: WorkoutStructure, path: NodePath): WorkoutStructure {
  const n = getNode(structure, path);
  if (!n || n.kind !== 'repeat' || path.length === 0) return structure;
  const parentPath = path.slice(0, -1);
  const kids = childrenAt(structure, parentPath)!;
  const items: AnyNode[] = [];
  for (let k = 0; k < n.count; k++) for (const c of n.steps as AnyNode[]) items.push(k === 0 ? c : cloneWithNewIds(c));
  const copy = kids.slice();
  copy.splice(path[path.length - 1], 1, ...items);
  return withChildren(structure, parentPath, copy);
}

// ───────────────────────────── builders ─────────────────────────────

/** Convenience step constructor with a fresh id. */
export function makeStep(partial: Omit<Step, 'kind' | 'id'> & { id?: string }): Step {
  return { kind: 'step', ...partial, id: partial.id ?? newId('s') } as Step;
}

/** Convenience repeat constructor with a fresh id. */
export function makeRepeat(count: number, steps: (Step | InnerRepeat)[], label?: string): Repeat {
  return { kind: 'repeat', id: newId('r'), count, ...(label ? { label } : {}), steps };
}

// ───────────────────────────── validation ─────────────────────────────

export interface StructureIssue {
  path: NodePath;
  severity: 'error' | 'warning';
  code:
    | 'empty'
    | 'empty_repeat'
    | 'too_deep'
    | 'bad_count'
    | 'duplicate_id'
    | 'bad_measure'
    | 'bad_target'
    | 'reversed_range'
    | 'target_sport'
    | 'reps_without_strength'
    | 'too_many_steps';
  message: string;
}

/** Garmin (older devices) warn above this many unrolled steps. */
export const MAX_UNROLLED_STEPS = 50;

function targetIssue(t: Target, sport: Sport | undefined): { severity: 'error' | 'warning'; code: StructureIssue['code']; message: string } | undefined {
  const nums = Object.values(t).filter((v): v is number => typeof v === 'number');
  if (nums.some((v) => !Number.isFinite(v) || v < 0)) return { severity: 'error', code: 'bad_target', message: 'Target values must be positive numbers' };
  if (t.type === 'hr_zone' && (t.zone < 1 || t.zone > 7)) return { severity: 'error', code: 'bad_target', message: 'HR zone must be 1–7' };
  if (t.type === 'rpe' && (t.low < 1 || t.high > 10)) return { severity: 'error', code: 'bad_target', message: 'RPE must be 1–10' };
  if ('low' in t && 'high' in t && t.low > t.high) return { severity: 'warning', code: 'reversed_range', message: 'Range low is above high' };
  if (t.type === 'pace' && t.lowMps > t.highMps) return { severity: 'warning', code: 'reversed_range', message: 'Pace range is reversed' };
  if (sport && (t.type === 'power_pct' || t.type === 'power_w') && (sport === 'swim' || sport === 'strength' || sport === 'yoga'))
    return { severity: 'warning', code: 'target_sport', message: `Power targets are unusual for ${sport}` };
  if (sport && (t.type === 'pace' || t.type === 'pace_pct') && !['run', 'swim', 'row', 'walk', 'hike', 'ski'].includes(sport))
    return { severity: 'warning', code: 'target_sport', message: `Pace targets are unusual for ${sport}` };
  return undefined;
}

/** Structural and semantic checks. Errors make the structure unusable; warnings are advisory. */
export function validateStructure(structure: WorkoutStructure, sport?: Sport): StructureIssue[] {
  const issues: StructureIssue[] = [];
  if (!structure.steps.length) issues.push({ path: [], severity: 'warning', code: 'empty', message: 'The workout has no steps' });
  const seen = new Set<string>();
  walk(structure, (n, path, _parent, depth) => {
    if (seen.has(n.id)) issues.push({ path, severity: 'error', code: 'duplicate_id', message: `Duplicate id ${n.id}` });
    seen.add(n.id);
    if (n.kind === 'repeat') {
      if (depth >= MAX_REPEAT_DEPTH) issues.push({ path, severity: 'error', code: 'too_deep', message: 'Repeats can be nested only two levels deep' });
      if (!Number.isInteger(n.count) || n.count < 1) issues.push({ path, severity: 'error', code: 'bad_count', message: 'Repeat count must be a whole number ≥ 1' });
      if (!n.steps.length) issues.push({ path, severity: 'error', code: 'empty_repeat', message: 'Repeat has no steps' });
      return;
    }
    const m = n.measure;
    const bad =
      (m.type === 'time' && !(m.sec > 0 && Number.isFinite(m.sec))) ||
      (m.type === 'distance' && !(m.m > 0 && Number.isFinite(m.m))) ||
      (m.type === 'reps' && !(Number.isInteger(m.n) && m.n > 0));
    if (bad) issues.push({ path, severity: 'error', code: 'bad_measure', message: 'Duration, distance or reps must be positive' });
    if (m.type === 'reps' && !n.strength && sport !== 'strength')
      issues.push({ path, severity: 'warning', code: 'reps_without_strength', message: 'Reps steps need an exercise' });
    for (const t of [n.target, n.secondary]) {
      if (!t) continue;
      const ti = targetIssue(t, sport);
      if (ti) issues.push({ path, ...ti });
    }
  });
  const unrolled = countUnrolledSteps(structure);
  if (unrolled > MAX_UNROLLED_STEPS)
    issues.push({ path: [], severity: 'warning', code: 'too_many_steps', message: `${unrolled} steps when expanded; older Garmin devices accept ${MAX_UNROLLED_STEPS}` });
  return issues;
}
