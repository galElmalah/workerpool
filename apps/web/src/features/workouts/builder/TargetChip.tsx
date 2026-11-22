/**
 * Target chip in a step row: shows "95–100 % · 262–276 W"; ↑/↓ nudges the range live; click opens
 * a small picker (≤ 320 px) to change the target type and values, plus the secondary target.
 */
import type { Sport, Step, Target, ThresholdSnapshot } from '@cadence/core';
import { Popover } from '@/ui';
import { cn } from '@/lib/cn';
import type { UnitPrefs } from '@/lib/units';
import { formatPace } from '@/lib/format';
import { defaultTarget, targetKinds, TARGET_KIND_LABEL, type TargetKind } from '../model';
import { MiniField, fmtRange, nudgeTarget, parsePaceRange, parseRange, targetAbsolute, targetLabel } from './fields';

interface Props {
  step: Step;
  sport: Sport;
  th: ThresholdSnapshot;
  units: UnitPrefs;
  onChange: (patch: Partial<Step>) => void;
}

export function TargetChip({ step, sport, th, units, onChange }: Props) {
  const t = step.target;
  const abs = targetAbsolute(t, sport, th, units);
  const sec = step.secondary;
  return (
    <Popover
      title="Target"
      trigger={
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (!t || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
            e.preventDefault();
            e.stopPropagation();
            onChange({ target: nudgeTarget(t, (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 5 : 1)) });
          }}
          aria-label={`Target ${targetLabel(t, sport, units)}${abs ? `, ${abs}` : ''}. Arrow keys adjust.`}
          className={cn(
            'inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-sm border border-transparent px-1.5 text-left transition-colors duration-(--dur-fast)',
            'hover:border-line-2 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-focus data-[popup-open]:border-line-3 data-[popup-open]:bg-surface-2',
          )}
        >
          <span className="text-fg-4">@</span>
          <span className={cn('truncate text-mono', t && t.type !== 'open' ? 'text-fg-1' : 'text-fg-3')}>{targetLabel(t, sport, units)}</span>
          {abs && <span className="truncate text-mono-sm text-fg-3 max-sm:hidden">{abs}</span>}
          {sec && <span className="truncate text-mono-sm text-fg-3 max-md:hidden">· {targetLabel(sec, sport, units)}</span>}
        </button>
      }
    >
      <TargetEditor step={step} sport={sport} th={th} units={units} onChange={onChange} />
    </Popover>
  );
}

function TargetEditor({ step, sport, th, units, onChange }: Props) {
  const t = step.target ?? { type: 'open' as const };
  const kinds = targetKinds(sport);
  const setKind = (k: TargetKind) => {
    if (k === t.type) return;
    onChange({ target: k === 'open' ? undefined : defaultTarget(k, sport, th, step.role === 'active' ? 1 : step.role === 'recovery' ? 0.6 : 0.75) });
  };
  const cad = step.secondary?.type === 'cadence' ? step.secondary : undefined;
  return (
    <div className="flex w-72 flex-col gap-3 p-1">
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Target type">
        {kinds.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={t.type === k}
            onClick={() => setKind(k)}
            className={cn(
              'h-6 rounded-sm border px-2 text-label transition-colors duration-(--dur-fast)',
              t.type === k ? 'border-line-3 bg-surface-active text-fg-1' : 'border-line-1 text-fg-2 hover:border-line-3 hover:text-fg-1',
            )}
          >
            {k === 'pace_pct' && sport === 'swim' ? '% CSS' : TARGET_KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <TargetValues t={t} sport={sport} units={units} onChange={(target) => onChange({ target })} />
      {targetAbsolute(t, sport, th, units) && <div className="text-mono-sm text-fg-3">= {targetAbsolute(t, sport, th, units)}</div>}
      {(sport === 'bike' || sport === 'run') && (
        <div className="flex items-center justify-between gap-2 border-t border-line-1 pt-2">
          <span className="text-label text-fg-2">Cadence</span>
          {cad ? (
            <span className="flex items-center gap-1">
              <MiniField label="Cadence range" value={[cad.low, cad.high] as [number, number]} format={fmtRange} parse={parseRange} width="w-20" onCommit={([low, high]) => onChange({ secondary: { type: 'cadence', low, high } })} suffix={sport === 'run' ? 'spm' : 'rpm'} />
              <button type="button" className="px-1 text-label text-fg-3 hover:text-fg-1" onClick={() => onChange({ secondary: undefined })}>
                Clear
              </button>
            </span>
          ) : (
            <button type="button" className="text-label text-fg-2 hover:text-fg-1" onClick={() => onChange({ secondary: { type: 'cadence', low: sport === 'run' ? 170 : 85, high: sport === 'run' ? 180 : 95 } })}>
              + Add
            </button>
          )}
        </div>
      )}
      {sport === 'row' && (
        <div className="flex items-center justify-between gap-2 border-t border-line-1 pt-2">
          <span className="text-label text-fg-2">Stroke rate</span>
          <MiniField
            label="Stroke rate"
            value={[step.row?.strokeRateLow ?? 0, step.row?.strokeRateHigh ?? 0] as [number, number]}
            format={(v) => (v[0] ? fmtRange(v) : '')}
            placeholder="24–26"
            parse={(s): [number, number] | null => (s.trim() ? parseRange(s) : [0, 0])}
            width="w-20"
            onCommit={([a, b]) => onChange({ row: a ? { strokeRateLow: a, strokeRateHigh: b } : undefined })}
            suffix="spm"
          />
        </div>
      )}
    </div>
  );
}

function TargetValues({ t, sport, units, onChange }: { t: Target; sport: Sport; units: UnitPrefs; onChange: (t: Target | undefined) => void }) {
  const row = (label: string, el: React.ReactNode) => (
    <label className="flex items-center justify-between gap-2">
      <span className="text-label text-fg-2">{label}</span>
      {el}
    </label>
  );
  switch (t.type) {
    case 'power_pct':
    case 'pace_pct':
    case 'hr_pct_lthr':
    case 'power_w':
    case 'hr_bpm':
    case 'rpe': {
      const unit = t.type === 'power_w' ? 'W' : t.type === 'hr_bpm' ? 'bpm' : t.type === 'rpe' ? '/10' : t.type === 'power_pct' ? '% FTP' : t.type === 'hr_pct_lthr' ? '% LTHR' : sport === 'swim' ? '% CSS' : '% thr';
      return row(
        'Range',
        <MiniField
          label="Target range"
          value={[t.low, t.high] as [number, number]}
          format={fmtRange}
          parse={(s) => {
            const r = parseRange(s);
            if (!r) return null;
            return t.type === 'rpe' ? ([Math.max(1, Math.min(10, r[0])), Math.max(1, Math.min(10, r[1]))] as [number, number]) : r;
          }}
          nudge={([a, b], d, big) => {
            const k = (t.type === 'power_w' ? 5 : 1) * (big ? 5 : 1) * d;
            return [Math.max(1, a + k), Math.max(1, b + k)] as [number, number];
          }}
          width="w-24"
          onCommit={([low, high]) => onChange({ ...t, low, high })}
          suffix={unit}
        />,
      );
    }
    case 'pace':
      return row(
        'Pace',
        <MiniField
          label="Pace range"
          value={[t.lowMps, t.highMps] as [number, number]}
          format={([lo, hi]) => (lo === hi ? formatPace(hi, sport, units) : `${formatPace(hi, sport, units)}–${formatPace(lo, sport, units)}`)}
          parse={(s) => parsePaceRange(s, sport, units)}
          width="w-36"
          onCommit={([lowMps, highMps]) => onChange({ type: 'pace', lowMps, highMps })}
        />,
      );
    case 'hr_zone':
      return row(
        'Zone',
        <span className="flex gap-1">
          {[1, 2, 3, 4, 5].map((z) => (
            <button
              key={z}
              type="button"
              onClick={() => onChange({ type: 'hr_zone', zone: z })}
              className={cn('h-7 w-8 rounded-sm border text-mono transition-colors duration-(--dur-fast)', t.zone === z ? 'border-line-3 bg-surface-active text-fg-1' : 'border-line-1 text-fg-2 hover:text-fg-1')}
            >
              Z{z}
            </button>
          ))}
        </span>,
      );
    case 'ramp':
      return row(
        'From → to',
        <MiniField
          label="Ramp from and to"
          value={[t.from, t.to] as [number, number]}
          format={([a, b]) => `${a}–${b}`}
          parse={(s) => {
            const m = s.replace(/[–—→>]/g, '-').match(/^(\d+)\s*-\s*(\d+)/);
            return m ? ([+m[1], +m[2]] as [number, number]) : null;
          }}
          width="w-24"
          onCommit={([from, to]) => onChange({ ...t, from, to })}
          suffix="%"
        />,
      );
    default:
      return <p className="text-body-sm text-fg-3">No target — ride or run by feel.</p>;
  }
}
