/**
 * Small chart-local controls: segmented toggle (range / metric), delta glyph + badge.
 * The segmented control mirrors design.md §5.4f; when `src/ui/Segmented` exists, pages may
 * use that instead — the props are deliberately the same shape (value/options/onChange).
 */
import { useId } from 'react';
import { motion } from 'motion/react';
import { deltaDir, fmtPct, type DeltaDir } from '../format';
import { spring } from '../motion';
import { T } from './tokens';

export interface SegOption<V extends string> {
  value: V;
  label: string;
}

export function ChartSegmented<V extends string>({ value, options, onChange, ariaLabel, size = 'sm' }: { value: V; options: readonly SegOption<V>[]; onChange: (v: V) => void; ariaLabel: string; size?: 'sm' | 'xs' }) {
  const id = useId();
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="relative inline-flex rounded-md bg-surface-2 p-0.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              const i = options.findIndex((x) => x.value === value);
              const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
              if (!d) return;
              e.preventDefault();
              const n = options[(i + d + options.length) % options.length];
              onChange(n.value);
              const sib = (e.currentTarget.parentElement?.children[(i + d + options.length) % options.length] as HTMLElement | undefined);
              sib?.focus();
            }}
            className={`relative z-0 rounded-[8px] px-2.5 text-label transition-colors duration-(--dur-fast) ${size === 'xs' ? 'h-6' : 'h-7'} ${on ? 'text-fg-1' : 'text-fg-2 hover:text-fg-1'}`}
          >
            {on && <motion.span layoutId={`seg-${id}`} transition={spring.snappy} className="absolute inset-0 -z-10 rounded-[8px] bg-surface-active inset-shadow-hairline" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** 12px arrow glyph per design.md §2.4: ↗ up, ↘ down, → flat (as inline SVG, no font dependency). */
export function DeltaArrow({ dir, accent = false, size = 12 }: { dir: DeltaDir; accent?: boolean; size?: number }) {
  const rot = dir === 'up' ? -45 : dir === 'down' ? 45 : 0;
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden className="shrink-0">
      <g transform={`rotate(${rot} 6 6)`} style={{ stroke: accent ? T.accent : 'currentColor' }} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 6h8M7 3l3 3-3 3" />
      </g>
    </svg>
  );
}

/** Warning triangle (TriangleAlert-like) for ramp cautions. */
export function CautionGlyph({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden className="shrink-0">
      <path d="M6 1.5 11 10.5H1Z" fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinejoin="round" />
      <path d="M6 5v2.4" stroke="currentColor" strokeWidth={1.25} strokeLinecap="round" />
      <circle cx="6" cy="8.9" r=".7" fill="currentColor" />
    </svg>
  );
}

/**
 * Delta pill: arrow + signed percent. Increase = 600 fg-1, decrease = 400 fg-2, flat = fg-3.
 * `good` adds accent to the arrow only; `caution` swaps in the triangle + hatch underline.
 */
export function DeltaBadge({ value, flat = 0.01, good = false, caution = false, className = '' }: { value: number | null | undefined; flat?: number; good?: boolean; caution?: boolean; className?: string }) {
  const dir = deltaDir(value, flat);
  const cls = dir === 'up' ? 'font-semibold text-fg-1' : dir === 'down' ? 'text-fg-2' : 'text-fg-3';
  return (
    <span className={`inline-flex items-center gap-1 font-mono text-mono-sm ${cls} ${className}`}>
      {caution ? <CautionGlyph /> : <DeltaArrow dir={dir} accent={good && dir !== 'flat'} />}
      <span className={caution ? 'bg-hatch-fg bg-[length:100%_2px] bg-bottom bg-no-repeat pb-px' : ''}>{value == null ? '—' : dir === 'flat' ? '±0%' : fmtPct(value)}</span>
    </span>
  );
}
