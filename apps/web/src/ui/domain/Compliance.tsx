/**
 * Compliance encodings (DESIGN_V2 §5 chip/card rules, §8.3 status colour). Calm defaults: no
 * borders, no edge rails, no accent. Done = one surface step (the card adds its sport tint);
 * planned = no fill; missed = dimmed text struck through; skipped = quiet text. Shape lives in
 * ComplianceGlyph and always travels with its status colour (on plan = good, short / long / way
 * off = warn, missed = critical, planned / skipped / unplanned neutral).
 *
 *   const s = complianceStyles(c.state);
 *   <div className={cn(s.card)}><span className={s.title}>…</span></div>
 *   <ComplianceGlyph state="partial_short" />   <ComplianceBar ratio={0.93} state="on_target" />
 */
import { COMPLIANCE_STATES, type ComplianceState } from '@cadence/core';
import { motion } from 'motion/react';
import { cn } from '@/lib/cn';
import { spring } from '@/motion/tokens';
import { complianceTone, STATUS_COLOR } from './dataColor';

export interface ComplianceStyle {
  /** Card container: surface classes (no borders). */
  card: string;
  /** @deprecated Always null: v2 has no edge rails (DESIGN_V2 rule 5). Kept for API compatibility. */
  rail: string | null;
  /** Title text treatment (strike-through only; text colour is the caller's). */
  title: string;
  /** Missed / skipped read quieter (WorkoutCard dims them through text colour, not opacity). */
  dim: boolean;
  /** Copy (product.md Appendix A). */
  label: string;
  /** @deprecated Always null (unplanned is told in the hover card / detail page). */
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

const DONE = 'bg-surface-2';

/** True when the outcome deviates from plan (partial / way off / missed): the only states a card marks. */
export function complianceDeviates(state: ComplianceState | null | undefined): boolean {
  return state === 'partial_short' || state === 'partial_long' || state === 'off_short' || state === 'off_long' || state === 'missed';
}

export function complianceStyles(state: ComplianceState | null | undefined): ComplianceStyle {
  const st = state ?? 'planned';
  switch (st) {
    case 'planned':
      return { card: 'bg-transparent', rail: null, title: '', dim: false, label: LABELS.planned, microLabel: null };
    case 'on_target':
    case 'partial_short':
    case 'partial_long':
    case 'off_short':
    case 'off_long':
      return { card: DONE, rail: null, title: '', dim: false, label: LABELS[st], microLabel: null };
    case 'missed':
      return { card: 'bg-transparent', rail: null, title: 'line-through decoration-fg-4', dim: true, label: LABELS.missed, microLabel: null };
    case 'excused':
      return { card: 'bg-transparent', rail: null, title: '', dim: true, label: LABELS.excused, microLabel: null };
    case 'unplanned':
      return { card: DONE, rail: null, title: '', dim: false, label: LABELS.unplanned, microLabel: null };
  }
}

/** All states, for galleries and legends. */
export const ALL_COMPLIANCE = COMPLIANCE_STATES;

/**
 * 12px glyph in its status colour (shape carries the meaning; colour reinforces it): ○ planned · ● on plan · ◐ short (left half) / long (right half) ·
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
  const status = complianceTone(state);
  const tone = status !== 'neutral' ? '' : state === 'unplanned' ? 'text-fg-2' : 'text-fg-3';
  return (
    <svg
      viewBox="0 0 12 12"
      width={size}
      height={size}
      className={cn('shrink-0', tone, className)}
      style={status !== 'neutral' ? { color: STATUS_COLOR[status] } : undefined}
      role="img"
      aria-label={title ?? LABELS[state]}
    >
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
 * Actual / planned bar with a tick at 100%. The overshoot beyond 100% is hatched. Filled in the
 * status colour of `state` (neutral without one); pair it with the glyph or a % label. Animates
 * with scaleX (smooth).
 */
export function ComplianceBar({ ratio, state, className, showLabel }: { ratio: number | null | undefined; state?: ComplianceState; className?: string; showLabel?: boolean }) {
  if (ratio == null || !Number.isFinite(ratio)) return null;
  const scaleMax = Math.max(1.25, Math.min(ratio, 2));
  const under = Math.min(ratio, 1) / scaleMax;
  const over = ratio > 1 ? (Math.min(ratio, scaleMax) - 1) / scaleMax : 0;
  const tick = 1 / scaleMax;
  const status = complianceTone(state);
  const fill = status === 'neutral' ? undefined : STATUS_COLOR[status];
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="relative h-1 flex-1 rounded-full bg-surface-3" role="meter" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={200} aria-label={`${Math.round(ratio * 100)}% of plan`}>
        <motion.span
          className={cn('absolute inset-y-0 left-0 w-full origin-left rounded-full', !fill && 'bg-fg-3')}
          style={fill ? { backgroundColor: fill } : undefined}
          initial={false}
          animate={{ scaleX: under }}
          transition={spring.smooth}
        />
        {over > 0 && (
          <motion.span
            className="absolute inset-y-0 w-full origin-left bg-hatch-fg"
            style={{ left: `${tick * 100}%`, ...(fill ? { backgroundImage: `repeating-linear-gradient(135deg, ${fill} 0 1px, transparent 1px 5px)` } : null) }}
            initial={false}
            animate={{ scaleX: over }}
            transition={spring.smooth}
          />
        )}
        <span className="absolute -top-0.5 -bottom-0.5 w-px bg-fg-2" style={{ left: `${tick * 100}%` }} aria-hidden />
      </div>
      {showLabel && <span className="w-10 text-right text-label text-fg-2 num">{Math.round(ratio * 100)}%</span>}
    </div>
  );
}
