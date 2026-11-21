/**
 * MiniProfile — micro bar chart from number[] (0..1; larger values are normalized). Used for card
 * step-profile sparklines (planned structure or actual effort, ≤ 48 bars) and StatTile sparklines.
 * tone: 'zone' (fill density by height, the intensity ladder), 'accent', or 'fg'.
 * No animation on scroll; bars only re-render on data change.
 */
import { cn } from '@/lib/cn';

export interface MiniProfileProps {
  values: readonly number[];
  height?: number;
  tone?: 'zone' | 'accent' | 'fg';
  /** Gap between bars in px (in viewBox units; default 1). */
  gap?: number;
  className?: string;
  'aria-label'?: string;
}

const zoneVar = (v: number) =>
  v < 0.2 ? 'var(--color-z1)' : v < 0.4 ? 'var(--color-z2)' : v < 0.55 ? 'var(--color-z3)' : v < 0.7 ? 'var(--color-z4)' : v < 0.85 ? 'var(--color-z5)' : v < 0.95 ? 'var(--color-z6)' : 'var(--color-z7)';

export function MiniProfile({ values, height = 20, tone = 'zone', gap = 1, className, ...aria }: MiniProfileProps) {
  if (!values.length) return null;
  const max = Math.max(1, ...values);
  const n = values.length;
  const barW = 4;
  const w = n * barW + (n - 1) * gap;
  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      className={cn('block w-full', className)}
      style={{ height }}
      role={aria['aria-label'] ? 'img' : undefined}
      aria-label={aria['aria-label']}
      aria-hidden={aria['aria-label'] ? undefined : true}
    >
      {values.map((raw, i) => {
        const v = Math.max(0, raw / max);
        const h = Math.max(1.5, v * height);
        const fill = tone === 'zone' ? zoneVar(v) : tone === 'accent' ? 'var(--color-accent)' : 'var(--color-fg-3)';
        return <rect key={i} x={i * (barW + gap)} y={height - h} width={barW} height={h} rx={0.75} fill={fill} />;
      })}
    </svg>
  );
}
