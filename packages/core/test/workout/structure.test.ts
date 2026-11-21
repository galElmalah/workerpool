import { describe, expect, it } from 'vitest';
import type { Step, WorkoutStructure } from '../../src/domain';
import {
  canPlace,
  cloneWithNewIds,
  countUnrolledSteps,
  duplicateNode,
  flattenStructure,
  getNode,
  insertNode,
  makeRepeat,
  makeStep,
  mapSteps,
  moveNode,
  newId,
  reassignIds,
  removeNode,
  setRepeatCount,
  stripIds,
  structureDepth,
  unrollRepeat,
  unwrapRepeat,
  updateStep,
  validateStructure,
  walk,
  wrapInRepeat,
} from '../../src/workout';

const t = (id: string, sec: number, role: Step['role'] = 'active'): Step => ({ kind: 'step', id, role, measure: { type: 'time', sec } });

/** wu 600 · 3x[a 120, r 60] · cd 300 */
function sample(): WorkoutStructure {
  return {
    steps: [
      t('wu', 600, 'warmup'),
      { kind: 'repeat', id: 'R', count: 3, steps: [t('a', 120), t('r', 60, 'recovery')] },
      t('cd', 300, 'cooldown'),
    ],
  };
}

describe('ids', () => {
  it('newId is unique and prefixed', () => {
    const ids = new Set(Array.from({ length: 2000 }, () => newId('s')));
    expect(ids.size).toBe(2000);
    expect([...ids][0]).toMatch(/^s_/);
  });
  it('cloneWithNewIds / reassignIds give fresh ids, stripIds normalises', () => {
    const s = sample();
    const c = reassignIds(s);
    expect(c.steps[0].id).not.toBe('wu');
    expect(stripIds(c)).toEqual(stripIds(s));
    const r = cloneWithNewIds(s.steps[1]);
    expect(r.kind === 'repeat' && r.steps[0].id).not.toBe('a');
  });
});

describe('flattenStructure', () => {
  it('expands repeats in execution order with offsets and iterations', () => {
    const f = flattenStructure(sample());
    expect(f.map((x) => x.step.id)).toEqual(['wu', 'a', 'r', 'a', 'r', 'a', 'r', 'cd']);
    expect(f.map((x) => x.startSec)).toEqual([0, 600, 720, 780, 900, 960, 1080, 1140]);
    expect(f[3].iterations).toEqual([1]);
    expect(f[3].iteration).toBe(1);
    expect(f[3].counts).toEqual([3]);
    expect(f[3].repeatIds).toEqual(['R']);
    expect(f[3].path).toEqual([1, 0]);
    expect(f[7].index).toBe(7);
    expect(f[0].iterations).toEqual([]);
  });
  it('handles nested repeats', () => {
    const s: WorkoutStructure = {
      steps: [{ kind: 'repeat', id: 'O', count: 2, steps: [{ kind: 'repeat', id: 'I', count: 2, steps: [t('x', 30)] }, t('y', 60)] }],
    };
    const f = flattenStructure(s);
    expect(f.map((x) => x.step.id)).toEqual(['x', 'x', 'y', 'x', 'x', 'y']);
    expect(f[4].iterations).toEqual([1, 1]);
    expect(f[4].repeatIds).toEqual(['O', 'I']);
    expect(f[4].path).toEqual([0, 0, 0]);
    expect(countUnrolledSteps(s)).toBe(6);
    expect(structureDepth(s)).toBe(2);
  });
  it('startSec becomes undefined after an unknown duration; custom resolver fixes it', () => {
    const s: WorkoutStructure = { steps: [t('a', 60), { kind: 'step', id: 'd', role: 'active', measure: { type: 'distance', m: 400 } }, t('b', 60)] };
    expect(flattenStructure(s).map((x) => x.startSec)).toEqual([0, 60, undefined]);
    expect(flattenStructure(s, (st) => (st.measure.type === 'distance' ? 100 : 60)).map((x) => x.startSec)).toEqual([0, 60, 160]);
  });
});

describe('walk / mapSteps / getNode', () => {
  it('walks pre-order with paths and depth, can skip children', () => {
    const seen: string[] = [];
    walk(sample(), (n, path, _p, depth) => {
      seen.push(`${n.id}@${path.join('.')}:${depth}`);
    });
    expect(seen).toEqual(['wu@0:0', 'R@1:0', 'a@1.0:1', 'r@1.1:1', 'cd@2:0']);
    const skipped: string[] = [];
    walk(sample(), (n) => {
      skipped.push(n.id);
      return n.kind === 'repeat' ? false : undefined;
    });
    expect(skipped).toEqual(['wu', 'R', 'cd']);
  });
  it('mapSteps returns a new structure and keeps ids', () => {
    const s = sample();
    const m = mapSteps(s, (st) => ({ ...st, label: st.id }));
    expect(m).not.toBe(s);
    expect((getNode(m, [1, 1]) as Step).label).toBe('r');
    expect((getNode(s, [1, 1]) as Step).label).toBeUndefined();
  });
  it('getNode handles bad paths', () => {
    expect(getNode(sample(), [5])).toBeUndefined();
    expect(getNode(sample(), [0, 1])).toBeUndefined();
    expect(getNode(sample(), [1, 0])?.id).toBe('a');
  });
});

describe('immutable edits', () => {
  it('insertNode at top level and inside a repeat; preserves untouched references', () => {
    const s = sample();
    const n = insertNode(s, [1, 2], t('new', 30));
    expect((getNode(n, [1]) as { steps: Step[] }).steps.map((x) => x.id)).toEqual(['a', 'r', 'new']);
    expect(n.steps[0]).toBe(s.steps[0]);
    expect(s.steps[1].kind === 'repeat' && s.steps[1].steps.length).toBe(2);
    const top = insertNode(s, [3], t('end', 30));
    expect(top.steps.map((x) => x.id)).toEqual(['wu', 'R', 'cd', 'end']);
    expect(insertNode(s, [9], t('x', 1))).toBe(s);
  });
  it('enforces max nesting depth', () => {
    const inner = makeRepeat(2, [t('q', 10)]);
    const s = sample();
    const ok = insertNode(s, [1, 0], inner);
    expect(structureDepth(ok)).toBe(2);
    const deep = insertNode(ok, [1, 0, 0], makeRepeat(2, [t('z', 10)]) as never);
    expect(deep).toBe(ok);
    expect(canPlace([], { kind: 'repeat', id: 'x', count: 2, steps: [inner] })).toBe(true);
    expect(canPlace([0], { kind: 'repeat', id: 'x', count: 2, steps: [inner] })).toBe(false);
  });
  it('removeNode drops empty repeats', () => {
    let s = removeNode(sample(), [1, 0]);
    expect((getNode(s, [1]) as { steps: Step[] }).steps.map((x) => x.id)).toEqual(['r']);
    s = removeNode(s, [1, 0]);
    expect(s.steps.map((x) => x.id)).toEqual(['wu', 'cd']);
  });
  it('moveNode: array-move within a parent, across containers, no-op into itself', () => {
    const s = sample();
    expect(moveNode(s, [0], [2]).steps.map((x) => x.id)).toEqual(['R', 'cd', 'wu']);
    expect(moveNode(s, [2], [0]).steps.map((x) => x.id)).toEqual(['cd', 'wu', 'R']);
    // move warm-up into the repeat (before 'r'): original coordinates [1,1]
    const m = moveNode(s, [0], [1, 1]);
    expect(m.steps.map((x) => x.id)).toEqual(['R', 'cd']);
    expect((getNode(m, [0]) as { steps: Step[] }).steps.map((x) => x.id)).toEqual(['a', 'wu', 'r']);
    // out of the repeat to the end
    const o = moveNode(s, [1, 0], [3]);
    expect(o.steps.map((x) => x.id)).toEqual(['wu', 'R', 'cd', 'a']);
    expect(moveNode(s, [1], [1, 0])).toBe(s);
    expect(moveNode(s, [0], [0])).toBe(s);
    // moving the last child out removes the emptied repeat
    const single: WorkoutStructure = { steps: [makeRepeat(2, [t('only', 5)]), t('z', 5)] };
    expect(moveNode(single, [0, 0], [2]).steps.map((x) => x.id)).toEqual(['z', 'only']);
  });
  it('duplicateNode inserts a deep copy with fresh ids after the node', () => {
    const d = duplicateNode(sample(), [1]);
    expect(d.steps).toHaveLength(4);
    expect(d.steps[2].kind).toBe('repeat');
    expect(d.steps[2].id).not.toBe('R');
    expect(stripIds({ steps: [d.steps[2]] })).toEqual(stripIds({ steps: [d.steps[1]] }));
  });
  it('wrapInRepeat wraps contiguous siblings; rejects gaps and too-deep results', () => {
    const s = sample();
    const w = wrapInRepeat(s, [[2], [0]] as never, 2);
    expect(w).toBe(s); // not contiguous
    const w2 = wrapInRepeat(s, [[1], [2]], 4, 'Block');
    expect(w2.steps.map((x) => x.kind)).toEqual(['step', 'repeat']);
    const r = w2.steps[1];
    expect(r.kind === 'repeat' && [r.count, r.label, r.steps.map((x) => x.id)]).toEqual([4, 'Block', ['R', 'cd']]);
    // wrapping that repeat again would be depth 3
    expect(wrapInRepeat(w2, [[1]], 2)).toBe(w2);
    // wrap a step inside a repeat → inner repeat
    const inner = wrapInRepeat(s, [[1, 0]], 3);
    expect(structureDepth(inner)).toBe(2);
  });
  it('unwrapRepeat / unrollRepeat / setRepeatCount / updateStep', () => {
    const s = sample();
    expect(unwrapRepeat(s, [1]).steps.map((x) => x.id)).toEqual(['wu', 'a', 'r', 'cd']);
    const u = unrollRepeat(s, [1]);
    expect(u.steps).toHaveLength(8);
    expect(u.steps[1].id).toBe('a');
    expect(u.steps[3].id).not.toBe('a');
    const c = setRepeatCount(s, [1], 5.4);
    expect(c.steps[1].kind === 'repeat' && c.steps[1].count).toBe(5);
    expect(setRepeatCount(s, [1], 3)).toBe(s);
    expect(setRepeatCount(s, [0], 3)).toBe(s);
    const up = updateStep(s, [1, 0], { target: { type: 'power_pct', low: 100, high: 105 } });
    expect((getNode(up, [1, 0]) as Step).target).toEqual({ type: 'power_pct', low: 100, high: 105 });
    expect(getNode(up, [1, 0])!.id).toBe('a');
    const fn = updateStep(s, [0], (st) => ({ ...st, id: 'hijack', cue: 'easy' }));
    expect(getNode(fn, [0])!.id).toBe('wu');
    expect(updateStep(s, [1], { cue: 'x' })).toBe(s);
  });
  it('makeStep / makeRepeat assign ids', () => {
    const st = makeStep({ role: 'active', measure: { type: 'time', sec: 60 } });
    expect(st.kind).toBe('step');
    expect(st.id).toMatch(/^s_/);
    expect(makeRepeat(3, [st], 'Main').label).toBe('Main');
  });
});

describe('validateStructure', () => {
  it('accepts a good structure', () => {
    expect(validateStructure(sample(), 'bike')).toEqual([]);
  });
  it('reports errors and warnings', () => {
    const bad: WorkoutStructure = {
      steps: [
        { kind: 'step', id: 'x', role: 'active', measure: { type: 'time', sec: 0 } },
        { kind: 'step', id: 'x', role: 'active', measure: { type: 'reps', n: 5 }, target: { type: 'power_pct', low: 110, high: 100 } },
        { kind: 'repeat', id: 'r1', count: 0, steps: [] },
        {
          kind: 'repeat',
          id: 'r2',
          count: 2,
          steps: [{ kind: 'repeat', id: 'r3', count: 2, steps: [{ kind: 'repeat', id: 'r4', count: 2, steps: [t('z', 5)] } as never] }],
        },
        { kind: 'step', id: 'h', role: 'active', measure: { type: 'time', sec: 60 }, target: { type: 'hr_zone', zone: 9 } },
      ],
    };
    const codes = validateStructure(bad, 'swim').map((i) => i.code).sort();
    expect(codes).toEqual(
      ['bad_count', 'bad_measure', 'bad_target', 'duplicate_id', 'empty_repeat', 'reps_without_strength', 'reversed_range', 'too_deep'].sort(),
    );
    expect(validateStructure({ steps: [] }).map((i) => i.code)).toEqual(['empty']);
    expect(validateStructure({ steps: [t('p', 60)] }, 'swim').length).toBe(0);
    const power: WorkoutStructure = { steps: [{ ...t('p', 60), target: { type: 'power_w', low: 100, high: 120 } }] };
    expect(validateStructure(power, 'swim')[0].code).toBe('target_sport');
  });
  it('warns above 50 unrolled steps', () => {
    const s: WorkoutStructure = { steps: [makeRepeat(30, [t('a', 30), t('b', 30)])] };
    expect(validateStructure(s).map((i) => i.code)).toEqual(['too_many_steps']);
  });
});
