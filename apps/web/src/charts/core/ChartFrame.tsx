/**
 * ChartFrame: the accessible shell every chart renders in. Provides the aria summary, an
 * sr-only data table, the loading skeleton (exact final size, sheen) and the empty state,
 * crossfading skeleton → content.
 */
import { type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { dur, ease } from '../motion';

export interface DataTable {
  caption?: string;
  columns: string[];
  rows: (string | number)[][];
}

export function SrTable({ table }: { table: DataTable }) {
  const rows = table.rows.length > 120 ? table.rows.slice(-120) : table.rows;
  return (
    // Wrapped: a display:table ignores the 1px width of .sr-only and widened the page on mobile.
    <div className="sr-only">
    <table>
      {table.caption && <caption>{table.caption}</caption>}
      <thead>
        <tr>
          {table.columns.map((c) => (
            <th key={c} scope="col">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

export function ChartSkeleton({ height, className = '' }: { height: number; className?: string }) {
  return (
    <div
      aria-hidden
      className={`w-full rounded-md bg-surface-2 bg-[linear-gradient(90deg,transparent,rgb(255_255_255/0.04),transparent)] bg-size-[200%_100%] animate-sheen motion-reduce:animate-none ${className}`}
      style={{ height }}
    />
  );
}

export function ChartEmpty({ height, title = 'No data yet', hint }: { height: number; title?: string; hint?: string }) {
  return (
    <div className="flex w-full flex-col items-center justify-center gap-1 rounded-md text-center" style={{ height }}>
      <span className="text-body-sm text-fg-2">{title}</span>
      {hint && <span className="max-w-72 px-4 text-body-sm text-fg-3">{hint}</span>}
    </div>
  );
}

interface ChartFrameProps {
  /** One-sentence summary read by screen readers ("Fitness 84, up 6 over 6 weeks"). */
  summary: string;
  table?: DataTable;
  loading?: boolean;
  empty?: boolean;
  emptyTitle?: string;
  emptyHint?: string;
  /** Height used by the skeleton / empty states (match the chart's final height). */
  height: number;
  className?: string;
  children: ReactNode;
}

export function ChartFrame({ summary, table, loading, empty, emptyTitle, emptyHint, height, className = '', children }: ChartFrameProps) {
  const state = loading ? 'loading' : empty ? 'empty' : 'ready';
  return (
    <figure className={`relative m-0 grid w-full min-w-0 [&>*]:[grid-area:1/1] ${className}`} aria-label={summary}>
      <AnimatePresence initial={false} mode="popLayout">
        {state === 'loading' && (
          <motion.div key="sk" exit={{ opacity: 0, transition: { duration: dur.fast, ease: ease.in } }}>
            <ChartSkeleton height={height} />
          </motion.div>
        )}
        {state === 'empty' && (
          <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: dur.base, ease: ease.out } }}>
            <ChartEmpty height={height} title={emptyTitle} hint={emptyHint} />
          </motion.div>
        )}
        {state === 'ready' && (
          <motion.div key="ct" className="min-w-0" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: dur.base, ease: ease.out } }}>
            {children}
          </motion.div>
        )}
      </AnimatePresence>
      {state === 'ready' && table && <SrTable table={table} />}
    </figure>
  );
}
