/**
 * The text side of the builder: a monospace editor with a line gutter, wavy underlines on lines
 * with issues (a mirror layer behind a transparent-background textarea), the issue list and a
 * compact syntax cheat-sheet popover.
 */
import type { Sport } from '@cadence/core';
import type { TextIssue } from '@cadence/core/workout';
import { BookOpen, TriangleAlert } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { Popover } from '@/ui';
import { cn } from '@/lib/cn';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  issues: TextIssue[];
  sport: Sport;
  activeLine?: number | null;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  minRows?: number;
}

const LINE = 20; // px, text-mono line-height

export function TextPane({ value, onChange, onFocus, onBlur, issues, sport, activeLine, textareaRef, minRows = 12 }: Props) {
  const lines = value.split('\n');
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const ref = textareaRef ?? ownRef;
  const mirror = useRef<HTMLDivElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const byLine = useMemo(() => {
    const m = new Map<number, TextIssue>();
    for (const i of issues) if (i.severity !== 'info' && (!m.has(i.line) || i.severity === 'error')) m.set(i.line, i);
    return m;
  }, [issues]);
  const rows = Math.max(minRows, lines.length + 1);

  useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    const sync = () => {
      if (mirror.current) mirror.current.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
      if (gutter.current) gutter.current.style.transform = `translateY(${-ta.scrollTop}px)`;
    };
    sync();
    ta.addEventListener('scroll', sync, { passive: true });
    return () => ta.removeEventListener('scroll', sync);
  }, [ref]);

  const jump = (line: number, col: number) => {
    const ta = ref.current;
    if (!ta) return;
    let pos = 0;
    for (let k = 0; k < line - 1 && k < lines.length; k++) pos += lines[k].length + 1;
    pos += Math.max(0, col - 1);
    ta.focus();
    ta.setSelectionRange(pos, pos);
  };

  const shown = issues.filter((i) => i.severity !== 'info');

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-micro uppercase text-fg-3">Text</span>
        <Popover
          title="Syntax"
          showTitle
          side="bottom"
          align="end"
          trigger={
            <button type="button" className="inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-label text-fg-3 transition-colors hover:bg-surface-2 hover:text-fg-1">
              <BookOpen className="size-3.5" /> Syntax
            </button>
          }
        >
          <CheatSheet sport={sport} />
        </Popover>
      </div>
      <div className="relative overflow-hidden rounded-md border border-line-2 bg-surface-1 focus-within:border-line-3" style={{ height: rows * LINE + 20 }}>
        <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-9 border-r border-line-1 bg-canvas/40">
          <div ref={gutter} className="pt-2.5">
            {lines.map((_, i) => (
              <div key={i} className={cn('flex h-5 items-center justify-end gap-1 pr-2 font-mono text-mono-sm', activeLine === i + 1 ? 'text-fg-1' : 'text-fg-4')}>
                {byLine.has(i + 1) && <span className={cn('size-1.5 rounded-full', byLine.get(i + 1)!.severity === 'error' ? 'bg-fg-1' : 'border border-fg-2')} />}
                {i + 1}
              </div>
            ))}
          </div>
        </div>
        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 left-9 overflow-hidden">
          <div ref={mirror} className="py-2.5 pr-3 pl-3 font-mono text-mono whitespace-pre text-transparent">
            {lines.map((l, i) => (
              <div key={i} className={cn('h-5', activeLine === i + 1 && 'bg-surface-2 -mx-3 px-3')}>
                <span className={cn(byLine.has(i + 1) && 'underline decoration-fg-2 decoration-wavy underline-offset-4')}>{l || ' '}</span>
              </div>
            ))}
          </div>
        </div>
        <textarea
          ref={ref}
          value={value}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label="Workout text"
          aria-invalid={byLine.size > 0 || undefined}
          onChange={(e) => onChange(e.currentTarget.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          onKeyDown={(e) => {
            if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              const ta = e.currentTarget;
              const s = ta.selectionStart;
              const next = value.slice(0, s) + '  ' + value.slice(ta.selectionEnd);
              onChange(next);
              requestAnimationFrame(() => ta.setSelectionRange(s + 2, s + 2));
            }
          }}
          wrap="off"
          className="absolute inset-y-0 right-0 left-9 resize-none bg-transparent py-2.5 pr-3 pl-3 font-mono text-mono leading-5 whitespace-pre text-fg-1 caret-accent outline-none placeholder:text-fg-4"
          placeholder={PLACEHOLDER[sport] ?? '- 45m z2'}
        />
      </div>
      <ul className="flex flex-col gap-1" aria-live="polite">
        {shown.slice(0, 4).map((i, k) => (
          <li key={k}>
            <button type="button" onClick={() => jump(i.line, i.col)} className="flex w-full items-start gap-2 rounded-sm px-1 py-0.5 text-left text-body-sm text-fg-2 hover:bg-surface-2 hover:text-fg-1">
              <TriangleAlert className={cn('mt-0.5 size-3.5 shrink-0', i.severity === 'error' ? 'text-fg-1' : 'text-fg-3')} />
              <span className="font-mono text-mono-sm text-fg-3">
                {i.line}:{i.col}
              </span>
              <span className="min-w-0">{i.message}</span>
            </button>
          </li>
        ))}
        {shown.length > 4 && <li className="px-1 text-body-sm text-fg-3">+{shown.length - 4} more</li>}
      </ul>
    </div>
  );
}

const PLACEHOLDER: Partial<Record<Sport, string>> = {
  bike: '- 10m ramp 50-75%\n5x\n  - 4m 110-120%\n  - 3m 50%\n- 10m 50%',
  run: '- 15m z2\n6x\n  - 800m 3:30/km\n  - r 400m\n- 10m z1',
  swim: 'pool 25m\n- 400m free z2\n8x\n  - 100m free css+3s on 1:50 +pull\n- 200m choice',
  row: '- 10m rpe3 20spm\n3x\n  - 2000m 1:52/500m 24-26spm\n  - r 5m\n- 5m rpe2',
  strength: 'Back squat 4x6 @80kg rpe8 r2m\nPull-up 3x8 @bw + Push-up 3x15 @bw r60s',
};

function CheatSheet({ sport }: { sport: Sport }) {
  const rows: [string, string][] = [
    ['- 8m 95-100%', 'step: time + target'],
    ['5x', 'repeat the indented lines'],
    ['  - 4m 110%', '2 spaces = inside the repeat'],
    ['6x 3m 110% / 3m 50%', 'inline repeat'],
    ['ramp 50-75%', 'ramp target'],
    ['z2 · rpe7 · 150bpm', 'zone, RPE, heart rate'],
    ['4:30/km · css+3s', 'pace / swim CSS offset'],
    ['250w · 90rpm', 'watts, cadence'],
    ['wu cd r', 'role: warm-up, cool-down, recovery'],
    ['Main set: 4x', 'labelled repeat'],
    ['// cue text', 'cue shown on the watch'],
  ];
  if (sport === 'swim') rows.push(['on 1:50 · r 20s · +pull', 'send-off, rest, equipment']);
  if (sport === 'row') rows.push(['1:52/500m 24-26spm', 'split + stroke rate']);
  if (sport === 'strength') rows.push(['Squat 4x6 @80kg rpe8 r2m', 'exercise · sets×reps · load'], ['A 3x8 + B 3x10', 'superset']);
  return (
    <dl className="grid w-76 grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-1 pb-1">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-mono text-mono-sm whitespace-pre text-fg-1">{k}</dt>
          <dd className="text-body-sm text-fg-3">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
