/**
 * Table — DESIGN_V2 §4: header `label` fg-3 sentence case, sticky (under the page bar), line-1 rule;
 * rows 44px `body`, line-1 row rules only, never zebra; numeric columns right-aligned sans with
 * tabular figures; row hover surface-2. Sortable headers (animated arrow), rows re-order with
 * `layout` (smooth). Selected row = surface-3 fill (no rail, no accent). Keep it to ≤ 6 columns at
 * 1440 — move the rest to the detail page (`hideBelow` for narrower screens).
 *
 *   <Table rows={acts} rowKey={(a) => a.id} onRowClick={open} defaultSort={{ key: 'date', dir: 'desc' }}
 *     columns={[
 *       { key: 'date', header: 'Date', cell: (a) => formatDayShort(a.localDate), sortValue: (a) => a.localDate },
 *       { key: 'dur', header: 'Time', numeric: true, cell: (a) => formatDuration(a.durationSec), sortValue: (a) => a.durationSec },
 *     ]} />
 */
import { ArrowUp } from 'lucide-react';
import { motion } from 'motion/react';
import { useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { spring } from '@/motion/tokens';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Right-aligned tabular numerals (sans). */
  numeric?: boolean;
  align?: 'left' | 'right' | 'center';
  /** Enables sorting on this column. */
  sortValue?: (row: T) => string | number | null | undefined;
  /** CSS width (e.g. '8rem', '1%'). */
  width?: string;
  /** Hide below this breakpoint. */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export type SortState = { key: string; dir: 'asc' | 'desc' };

export interface TableProps<T> {
  rows: readonly T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  sort?: SortState | null;
  defaultSort?: SortState;
  onSortChange?: (s: SortState) => void;
  /** Footer row (totals). Keys match column keys. */
  totals?: Partial<Record<string, ReactNode>>;
  /** Sticky header offset (default: under the page bar). */
  stickyTop?: string;
  empty?: ReactNode;
  className?: string;
  'aria-label'?: string;
  /** Turn off row reorder animation for very long tables. */
  animateRows?: boolean;
  /** Surface the table sits on (sticky header background). Default 'canvas'. */
  surface?: 'canvas' | 'surface-1' | 'surface-2';
}

const hide = { sm: 'max-sm:hidden', md: 'max-md:hidden', lg: 'max-lg:hidden', xl: 'max-xl:hidden' };

export function Table<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  selectedKey,
  sort: sortProp,
  defaultSort,
  onSortChange,
  totals,
  stickyTop = 'var(--header-h)',
  empty,
  className,
  animateRows = true,
  surface = 'canvas',
  ...aria
}: TableProps<T>) {
  const [inner, setInner] = useState<SortState | null>(defaultSort ?? null);
  const sort = sortProp !== undefined ? sortProp : inner;
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const sv = col.sortValue;
    return [...rows].sort((a, b) => {
      const x = sv(a);
      const y = sv(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      const r = x < y ? -1 : x > y ? 1 : 0;
      return sort.dir === 'asc' ? r : -r;
    });
  }, [rows, columns, sort]);

  const toggle = (key: string) => {
    const next: SortState = sort?.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' };
    setInner(next);
    onSortChange?.(next);
  };

  const alignOf = (c: Column<T>) => c.align ?? (c.numeric ? 'right' : 'left');

  return (
    <div className={cn('w-full', className)}>
      <table className="w-full border-separate border-spacing-0 text-body" aria-label={aria['aria-label']}>
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              const al = alignOf(c);
              return (
                <th
                  key={c.key}
                  scope="col"
                  style={{ width: c.width, top: stickyTop }}
                  aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={cn(
                    'sticky z-(--z-sticky) h-10 border-b border-line-1 px-3 align-middle text-label font-normal text-fg-3 first:pl-4 last:pr-4',
                    al === 'right' ? 'text-right' : al === 'center' ? 'text-center' : 'text-left',
                    surface === 'canvas' ? 'bg-canvas' : surface === 'surface-1' ? 'bg-surface-1' : 'bg-surface-2',
                    c.hideBelow && hide[c.hideBelow],
                    c.className,
                  )}
                >
                  {c.sortValue ? (
                    <button
                      type="button"
                      onClick={() => toggle(c.key)}
                      className={cn('inline-flex items-center gap-1 transition-colors hover:text-fg-1', active && 'text-fg-1', al === 'right' && 'flex-row-reverse')}
                    >
                      {c.header}
                      <motion.span
                        initial={false}
                        animate={{ rotate: active && sort!.dir === 'asc' ? 0 : 180, opacity: active ? 1 : 0.35 }}
                        transition={spring.snappy}
                        className="inline-flex"
                        aria-hidden
                      >
                        <ArrowUp className="size-3" strokeWidth={2} />
                      </motion.span>
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && empty ? (
            <tr>
              <td colSpan={columns.length}>{empty}</td>
            </tr>
          ) : (
            sorted.map((row) => {
              const k = rowKey(row);
              const sel = selectedKey === k;
              return (
                <motion.tr
                  key={k}
                  layout={animateRows ? 'position' : false}
                  transition={spring.smooth}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(row) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  aria-selected={selectedKey !== undefined ? sel : undefined}
                  className={cn(
                    'group/row transition-colors duration-(--dur-fast) focus-inset',
                    onRowClick && !sel && 'cursor-default hover:bg-surface-2',
                    sel && 'bg-surface-3',
                  )}
                >
                  {columns.map((c) => {
                    const al = alignOf(c);
                    return (
                      <td
                        key={c.key}
                        className={cn(
                          'relative h-11 border-b border-line-1 px-3 align-middle first:pl-4 last:pr-4',
                          c.numeric ? 'num text-fg-1' : 'text-fg-1',
                          al === 'right' ? 'text-right' : al === 'center' ? 'text-center' : 'text-left',
                          c.hideBelow && hide[c.hideBelow],
                          c.className,
                        )}
                      >
                        {c.cell(row)}
                      </td>
                    );
                  })}
                </motion.tr>
              );
            })
          )}
        </tbody>
        {totals && (
          <tfoot>
            <tr>
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    'h-11 px-3 align-middle first:pl-4 last:pr-4',
                    c.numeric ? 'num font-medium text-fg-1' : 'text-label font-normal text-fg-3',
                    alignOf(c) === 'right' ? 'text-right' : 'text-left',
                    c.hideBelow && hide[c.hideBelow],
                  )}
                >
                  {totals[c.key]}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
