/**
 * Compliance encodings — product.md §3.6.4 mapped onto design tokens (design.md §2.4, rule 2: 1px
 * hairlines only). Readable in grayscale: fill, outline style, hatch, glyph shape and text.
 * Green only where ARCHITECTURE allows it: completed/compliant work (on plan).
 *
 *   const s = complianceStyles(c.state);
 *   <div className={cn(s.card)}>{s.rail && <span className={s.rail} />}<span className={s.title}>…</span></div>
 *   <ComplianceGlyph state="partial_short" />   <ComplianceBar ratio={0.93} state="on_target" />
 */
import { COMPLIANCE_STATES, type ComplianceState } from '@cadence/core';
import { motion } from 'motion/react';
import { cn } from '@/lib/cn';
import { spring } from '@/motion/tokens';

export interface ComplianceStyle {
  /** Card container: surface + border classes. */
  card: string;
  /** 3px left rail classes (absolute, inset-y) or null. */
  rail: string | null;
  /** Title text treatment (strike-through, muted). */
  title: string;
  /** Whole-card dimming for missed/excused. */
  dim: boolean;
  /** Copy (product.md Appendix A). */
  label: string;
  /** Show the UNPLANNED micro label. */
  microLabel: string | null;
}

const LABELS: Record<ComplianceState, string> = {
  planned: 'Planned',
  on_target: 'On plan',
  partial_short: 'Short',
  partial_long: 'Long',
  off_short: 'Way short',
  off_long: 'Way over',
  missed: 'Missed',
  excused: 'Skipped',
  unplanned: 'Unplanned',
};

export function complianceLabel(state: ComplianceState, reason?: string): string {
  return state === 'excused' && reason ? `Skipped · ${reason}` : LABELS[state];
}

const DONE = 'bg-surface-2 border border-line-2';

export function complianceStyles(state: ComplianceState | null | undefined): ComplianceStyle {
  switch (state ?? 'planned') {
    case 'planned':
      return { card: 'bg-transparent border border-dashed border-line-3', rail: null, title: '', dim: false, label: LABELS.planned, microLabel: null };
    case 'on_target':
      return { card: DONE, rail: 'bg-accent', title: '', dim: false, label: LABELS.on_target, microLabel: null };
    case 'partial_short':
    case 'partial_long':
      return { card: DONE, rail: 'bg-hatch-accent', title: '', dim: false, label: LABELS[state!], microLabel: null };
    case 'off_short':
    case 'off_long':
      return { card: 'bg-surface-2 border border-fg-4', rail: 'bg-dots-fg', title: '', dim: false, label: LABELS[state!], microLabel: null };
    case 'missed':
      return {
        card: 'bg-transparent border border-dashed border-line-2 bg-hatch-faint',
        rail: null,
        title: 'line-through decoration-fg-3',
        dim: true,
        label: LABELS.missed,
        microLabel: null,
      };
    case 'excused':
      return { card: 'bg-transparent border border-dotted border-line-3', rail: null, title: 'text-fg-2', dim: true, label: LABELS.excused, microLabel: null };
    case 'unplanned':
      return { card: 'bg-surface-2 border border-transparent', rail: 'bg-fg-1', title: '', dim: false, label: LABELS.unplanned, microLabel: 'Unplanned' };
  }
}

/** All states, for galleries and legends. */
export const ALL_COMPLIANCE = COMPLIANCE_STATES;

/**
 * 12px glyph: ○ planned · ● on plan (accent) · ◐ short (left half) / long (right half) ·
 * ◔ way short · ◕ way over · ⊘ missed · ◌ excused (dotted ring) · ▪ unplanned.
 */
export function ComplianceGlyph({ state, size = 12, className, title }: { state: ComplianceState; size?: number; className?: string; title?: string }) {
  const r = 4.75;
  const c = 6;
  const wedge = (frac: number) => {
    const a = frac * Math.PI * 2;
    const x = c + r * Math.sin(a);
    const y = c - r * Math.cos(a);
    return `M${c} ${c} L${c} ${c - r} A${r} ${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${x.toFixed(3)} ${y.toFixed(3)} Z`;
  };
  const tone = state === 'on_target' ? 'text-accent' : state === 'planned' ? 'text-fg-3' : state === 'excused' || state === 'missed' ? 'text-fg-2' : 'text-fg-1';
  return (
    <svg viewBox="0 0 12 12" width={size} height={size} className={cn('shrink-0', tone, className)} role="img" aria-label={title ?? LABELS[state]}>
      {state === 'unplanned' ? (
        <rect x={3} y={3} width={6} height={6} rx={1} fill="currentColor" />
      ) : state === 'on_target' ? (
        <circle cx={c} cy={c} r={r + 0.5} fill="currentColor" />
      ) : (
        <>
          <circle cx={c} cy={c} r={r} fill="none" stroke="currentColor" strokeWidth={1.4} strokeDasharray={state === 'excused' ? '1.2 1.6' : undefined} />
          {state === 'partial_short' && <path d={`M${c} ${c - r} A${r} ${r} 0 0 0 ${c} ${c + r} Z`} fill="currentColor" />}
          {state === 'partial_long' && <path d={`M${c} ${c - r} A${r} ${r} 0 0 1 ${c} ${c + r} Z`} fill="currentColor" />}
          {state === 'off_short' && <path d={wedge(0.25)} fill="currentColor" />}
          {state === 'off_long' && <path d={wedge(0.75)} fill="currentColor" />}
          {state === 'missed' && <path d="M2.8 9.2 9.2 2.8" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />}
        </>
      )}
    </svg>
  );
}

/**
 * Actual / planned bar with a tick at 100%. The overshoot beyond 100% is hatched. Fill is accent
 * only when on plan; otherwise fg-2. Animates with scaleX (smooth).
 */
export function ComplianceBar({ ratio, state, className, showLabel }: { ratio: number | null | undefined; state?: ComplianceState; className?: string; showLabel?: boolean }) {
  if (ratio == null || !Number.isFinite(ratio)) return null;
  const scaleMax = Math.max(1.25, Math.min(ratio, 2));
  const under = Math.min(ratio, 1) / scaleMax;
  const over = ratio > 1 ? (Math.min(ratio, scaleMax) - 1) / scaleMax : 0;
  const tick = 1 / scaleMax;
  const on = state ? state === 'on_target' : ratio >= 0.8 && ratio <= 1.2;
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="relative h-1 flex-1 rounded-full bg-surface-3" role="meter" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={200} aria-label={`${Math.round(ratio * 100)}% of plan`}>
        <motion.span
          className={cn('absolute inset-y-0 left-0 w-full origin-left rounded-full', on ? 'bg-accent' : 'bg-fg-2')}
          initial={false}
          animate={{ scaleX: under }}
          transition={spring.smooth}
        />
        {over > 0 && (
          <motion.span
            className="absolute inset-y-0 w-full origin-left bg-hatch-fg"
            style={{ left: `${tick * 100}%` }}
            initial={false}
            animate={{ scaleX: over }}
            transition={spring.smooth}
          />
        )}
        <span className="absolute -top-0.5 -bottom-0.5 w-px bg-fg-1" style={{ left: `${tick * 100}%` }} aria-hidden />
      </div>
      {showLabel && <span className="w-10 text-right font-mono text-mono-sm text-fg-2">{Math.round(ratio * 100)}%</span>}
    </div>
  );
}
