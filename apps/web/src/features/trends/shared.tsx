/**
 * Shared trends chrome (v2 "quiet"): the page frame (header with ONE control row in the bar, the
 * sub-nav pill that slides across routes, an active-filter summary only while a filter is set),
 * URL-state hooks, the range control, the single "Filter" popover and the section heading link.
 * No bordered chart cards: a section is a `title-3` heading, at most one line of description, and
 * the chart on the canvas.
 */
import { SPORT_META, type Sport } from '@cadence/core';
import { Link, useNavigate, useRouterState, useSearch } from '@tanstack/react-router';
import { ArrowUpRight, Check, RotateCcw, SlidersHorizontal, TriangleAlert } from 'lucide-react';
import { motion } from 'motion/react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { spring } from '@/motion/tokens';
import { useReducedMotionPref } from '@/motion/prefs';
import type { TrendsSearch } from '@/shell/search';
import { Button, Chip, Page, PageHeader, Popover, Segmented, SportGlyph } from '@/ui';
import { COMPARE_LABEL, RANGE_OPTIONS, type CompareKey, type TrendRange } from './data';

// ───────────────────────── URL state ─────────────────────────

export function useTrendsSearch() {
  const search = useSearch({ strict: false }) as TrendsSearch;
  const navigate = useNavigate();
  const set = (patch: Partial<TrendsSearch>) =>
    void navigate({ to: '.', search: (p: TrendsSearch) => ({ ...p, ...patch }), replace: true, resetScroll: false } as never);
  return { search, set };
}

// ───────────────────────── sub-nav ─────────────────────────

const NAV = [
  { to: '/trends', label: 'Overview' },
  { to: '/trends/fitness', label: 'Fitness' },
  { to: '/trends/volume', label: 'Volume' },
  { to: '/trends/intensity', label: 'Intensity' },
  { to: '/trends/peaks', label: 'Peaks' },
  { to: '/trends/wellness', label: 'Wellness' },
] as const;

/** Last pill rect, so the next trends route's pill slides from where the old one was. */
let lastRect: { x: number; width: number } | null = null;

/** Pill tabs for the trends sub-pages (same look as `NavTabs`), keeping range + sport in the URL. */
export function TrendsNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { search } = useTrendsSearch();
  const reduce = useReducedMotionPref();
  const keep: TrendsSearch = { range: search.range, sport: search.sport };
  const active = NAV.reduce<string | null>((best, it) => ((pathname === it.to || (it.to !== '/trends' && pathname.startsWith(it.to))) && (!best || it.to.length > best.length) ? it.to : best), null);
  const refs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const [rect, setRect] = useState<{ x: number; width: number } | null>(null);
  const [from] = useState(lastRect);
  useLayoutEffect(() => {
    const measure = () => {
      const el = active ? refs.current[active] : null;
      if (!el) return setRect(null);
      const r = { x: el.offsetLeft, width: el.offsetWidth };
      setRect(r);
      lastRect = r;
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [active]);
  return (
    <nav aria-label="Trends sections" className="relative -mx-4 overflow-x-auto px-4 scrollbar-none md:mx-0 md:px-0">
      <div className="relative flex w-max items-center gap-1 md:-ml-3">
        {rect && (
          <motion.span
            aria-hidden
            className="absolute top-0 left-0 h-8 rounded-md bg-surface-2"
            initial={from && !reduce ? { x: from.x, width: from.width } : false}
            animate={{ x: rect.x, width: rect.width }}
            transition={spring.snappy}
          />
        )}
        {NAV.map((it) => (
          <Link
            key={it.to}
            to={it.to}
            search={keep as never}
            activeOptions={{ exact: true, includeSearch: false }}
            ref={(el) => {
              refs.current[it.to] = el;
            }}
            aria-current={active === it.to ? 'page' : undefined}
            className="relative inline-flex h-8 shrink-0 select-none items-center rounded-md px-3 text-body-sm text-fg-3 transition-colors duration-(--dur-fast) hover:text-fg-1 focus-visible:outline-offset-0 aria-[current=page]:font-medium aria-[current=page]:text-fg-1"
          >
            {it.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

// ───────────────────────── frame ─────────────────────────

/**
 * Page frame. `toolbar` = the page's ONE control row (range + Filter), shown in the sticky bar
 * (under the title on phones). `filters` = the active-filter summary, rendered only when non-empty.
 */
export function TrendsFrame({
  title,
  eyebrow,
  toolbar,
  filters,
  children,
  back,
}: {
  title: string;
  eyebrow?: ReactNode;
  toolbar?: ReactNode;
  filters?: ActiveFilter[];
  children: ReactNode;
  back?: boolean;
}) {
  const active = (filters ?? []).filter(Boolean);
  return (
    <Page
      width="page"
      header={
        <PageHeader
          title={title}
          eyebrow={eyebrow}
          toolbar={toolbar}
          back={back ? { to: '/trends' } : undefined}
          breadcrumb={back ? [{ label: 'Trends', link: { to: '/trends' } }] : undefined}
        />
      }
    >
      <div className="-mt-4 flex flex-col gap-4 md:-mt-6">
        <TrendsNav />
        {active.length > 0 && <FilterSummary items={active} />}
      </div>
      {children}
    </Page>
  );
}

// ───────────────────────── controls ─────────────────────────

export function RangeControl({ value, onChange, options = RANGE_OPTIONS }: { value: TrendRange; onChange: (r: TrendRange) => void; options?: typeof RANGE_OPTIONS }) {
  const v = value === '3m' ? '12w' : value;
  return <Segmented aria-label="Range" size="sm" value={v} onValueChange={onChange} options={options.map((o) => ({ value: o.value, label: o.label }))} />;
}

export interface FilterOption<V extends string> {
  value: V;
  label: ReactNode;
  icon?: ReactNode;
}
export interface FilterGroup {
  id: string;
  label: string;
  options: FilterOption<string>[];
  value: string;
  onChange: (v: string) => void;
}
export interface ActiveFilter {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  onClear: () => void;
}

/**
 * The single quiet "Filter" popover: one list per group (single choice, check mark on the current
 * value). The trigger shows the number of active filters; the summary row under the nav lists them.
 */
export function FilterPopover({ groups, active = 0, extra }: { groups: FilterGroup[]; active?: number; extra?: ReactNode }) {
  return (
    <Popover
      title="Filter"
      align="end"
      trigger={
        <Button size="sm" variant="ghost" icon={<SlidersHorizontal />} aria-label={active ? `Filter, ${active} active` : 'Filter'}>
          Filter{active ? <span className="num text-fg-3">{active}</span> : null}
        </Button>
      }
    >
      {(close) => (
        <div className="flex w-60 flex-col gap-3 p-1">
          {groups.map((g) => (
            <div key={g.id} role="group" aria-label={g.label} className="flex flex-col">
              <span className="px-2 pt-1 pb-1.5 text-label font-normal text-fg-3">{g.label}</span>
              {g.options.map((o) => {
                const on = o.value === g.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      g.onChange(o.value);
                      close();
                    }}
                    className={cn(
                      'flex h-8 items-center gap-2 rounded-md px-2 text-left text-body-sm transition-colors duration-(--dur-fast) hover:bg-surface-2 [&_svg]:size-3.5',
                      on ? 'font-medium text-fg-1' : 'text-fg-2',
                    )}
                  >
                    {o.icon && <span className="flex w-4 shrink-0 justify-center text-fg-3">{o.icon}</span>}
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {on && <Check className="text-fg-1" aria-hidden />}
                  </button>
                );
              })}
            </div>
          ))}
          {extra}
        </div>
      )}
    </Popover>
  );
}

/** "Run only ×  vs 4-week avg ×  Clear" — shown only while at least one filter is set. */
export function FilterSummary({ items }: { items: ActiveFilter[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Active filters">
      {items.map((f) => (
        <Chip key={f.key} tone="neutral" icon={f.icon} onRemove={f.onClear}>
          {f.label}
        </Chip>
      ))}
      {items.length > 1 && (
        <button type="button" onClick={() => items.forEach((f) => f.onClear())} className="h-6 rounded-sm px-1.5 text-label text-fg-3 transition-colors hover:text-fg-1">
          Clear all
        </button>
      )}
    </div>
  );
}

/** Filter-group helpers shared by the trends pages. */
export const sportGroup = (sports: Sport[], value: Sport | undefined, onChange: (s: Sport | undefined) => void, allLabel = 'All sports'): FilterGroup => ({
  id: 'sport',
  label: 'Sport',
  options: [{ value: 'all', label: allLabel }, ...sports.map((s) => ({ value: s, label: SPORT_META[s].label, icon: <SportGlyph sport={s} size={14} /> }))],
  value: value ?? 'all',
  onChange: (v) => onChange(v === 'all' ? undefined : (v as Sport)),
});
export const sportFilter = (sport: Sport | undefined, clear: () => void): ActiveFilter | null =>
  sport ? { key: 'sport', label: `${SPORT_META[sport].label} only`, icon: <SportGlyph sport={sport} size={14} />, onClear: clear } : null;

export const compareGroup = (value: CompareKey, onChange: (c: CompareKey) => void): FilterGroup => ({
  id: 'compare',
  label: 'Compare with',
  options: [
    { value: 'prev', label: 'Last week' },
    { value: 'avg', label: '4-week average' },
    { value: 'year', label: 'Same week last year' },
  ],
  value,
  onChange: (v) => onChange(v as CompareKey),
});
export const compareFilter = (value: CompareKey, clear: () => void): ActiveFilter | null =>
  value !== 'prev' ? { key: 'compare', label: COMPARE_LABEL[value].replace(/^vs/, 'Compared with'), onClear: clear } : null;

/** Drop nulls from a filter list. */
export const activeOf = (...xs: (ActiveFilter | null | undefined | false)[]) => xs.filter((x): x is ActiveFilter => !!x);

// ───────────────────────── sections ─────────────────────────

/** A section heading that links to its sub-page (name stays the plain title; arrow appears on hover). */
export function TitleLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} search={((p: TrendsSearch) => ({ range: p.range, sport: p.sport })) as never} className="group inline-flex items-center gap-1 rounded-xs hover:text-fg-1">
      {children}
      <ArrowUpRight aria-hidden className="size-4 text-fg-4 transition-[transform,color] duration-(--dur-fast) group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-fg-1" />
    </Link>
  );
}

export function InlineError({ onRetry, children = "Couldn't load this." }: { onRetry?: () => void; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-1 px-4 py-3 text-body-sm text-fg-1">
      <span className="inline-flex items-center gap-2">
        <TriangleAlert className="size-4" aria-hidden /> {children}
      </span>
      {onRetry && (
        <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

/** Label + value pair used in readouts (sans, tabular). */
export function Readout({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-0.5', className)}>
      <span className="text-label font-normal text-fg-3">{label}</span>
      <span className="text-body text-fg-1">{children}</span>
    </div>
  );
}

/** A plain table in the v2 style (44px rows, line-1 rules, sentence-case `label fg-3` headers). */
export function QuietTable({ head, children, minWidth, className }: { head: { label: ReactNode; numeric?: boolean; className?: string }[]; children: ReactNode; minWidth?: number; className?: string }) {
  return (
    <div className={cn('relative -mx-4 overflow-x-auto px-4 md:mx-0 md:px-0', className)}>
      <table className="w-full text-left" style={minWidth ? { minWidth } : undefined}>
        <thead>
          <tr className="border-b border-line-1">
            {head.map((h, i) => (
              <th key={i} className={cn('h-9 pr-4 text-label font-medium text-fg-3 last:pr-0', h.numeric && 'text-right', h.className)}>
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="num text-body">{children}</tbody>
      </table>
    </div>
  );
}
/** Row + cell classes matching QuietTable. */
export const qtRow = 'h-11 border-b border-line-1 last:border-0';
export const qtCell = (numeric?: boolean) => cn('pr-4 last:pr-0', numeric && 'text-right');

/**
 * A titled chart block in the v2 style: `title-3` heading (optionally a link to its sub-page), one
 * line of description, actions on the right, then the content — on the canvas, no border, no card.
 */
export function ChartCard({
  title,
  question,
  to,
  actions,
  children,
  className,
  aside,
}: {
  title: ReactNode;
  question?: ReactNode;
  to?: string;
  toLabel?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  aside?: ReactNode;
}) {
  return (
    <section className={cn('min-w-0', className)}>
      <header className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 md:mb-5">
        <div className="min-w-0">
          <h2 className="text-title-3 text-fg-1">{to ? <TitleLink to={to}>{title}</TitleLink> : title}</h2>
          {question && <p className="mt-1 max-w-[65ch] text-body text-fg-2">{question}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children}
      {aside}
    </section>
  );
}
