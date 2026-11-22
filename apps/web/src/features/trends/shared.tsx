/**
 * Shared trends chrome: the page frame (header + sub-nav with an indicator that slides across
 * routes), URL-state hooks, the controls row (range · compare · sport chips) and chart cards.
 */
import { SPORT_META, type Sport } from '@cadence/core';
import { Link, useNavigate, useRouterState, useSearch } from '@tanstack/react-router';
import { ArrowUpRight, RotateCcw, TriangleAlert } from 'lucide-react';
import { motion } from 'motion/react';
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { spring } from '@/motion/tokens';
import { useReducedMotionPref } from '@/motion/prefs';
import type { TrendsSearch } from '@/shell/search';
import { Button, Page, PageHeader, Segmented, SportGlyph } from '@/ui';
import { RANGE_OPTIONS, type CompareKey, type TrendRange } from './data';

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

/** Last indicator rect, so the next trends route's indicator slides from where the old one was. */
let lastRect: { x: number; width: number } | null = null;

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
      <div className="relative flex w-max min-w-full items-center gap-5 border-b border-line-1">
        {NAV.map((it) => (
          <Link
            key={it.to}
            to={it.to}
            search={keep as never}
            ref={(el) => {
              refs.current[it.to] = el;
            }}
            aria-current={active === it.to ? 'page' : undefined}
            className="relative inline-flex h-10 shrink-0 select-none items-center text-label text-fg-2 transition-colors duration-(--dur-fast) hover:text-fg-1 aria-[current=page]:text-fg-1"
          >
            {it.label}
          </Link>
        ))}
        {rect && (
          <motion.span
            aria-hidden
            className="absolute bottom-0 left-0 h-0.5 rounded-full bg-fg-1"
            initial={from && !reduce ? { x: from.x, width: from.width } : false}
            animate={{ x: rect.x, width: rect.width }}
            transition={spring.smooth}
          />
        )}
      </div>
    </nav>
  );
}

// ───────────────────────── frame ─────────────────────────

export function TrendsFrame({
  title,
  eyebrow,
  controls,
  children,
  back,
}: {
  title: string;
  eyebrow?: ReactNode;
  controls?: ReactNode;
  children: ReactNode;
  back?: boolean;
}) {
  return (
    <Page
      width="page"
      header={<PageHeader title={title} eyebrow={eyebrow} back={back ? { to: '/trends' } : undefined} breadcrumb={back ? [{ label: 'Trends', link: { to: '/trends' } }] : undefined} />}
    >
      <div className="-mt-6 flex flex-col gap-4">
        <TrendsNav />
        {controls && <div className="flex flex-wrap items-center gap-x-4 gap-y-3">{controls}</div>}
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

export function CompareControl({ value, onChange }: { value: CompareKey; onChange: (c: CompareKey) => void }) {
  return (
    <Segmented
      aria-label="Compare with"
      size="sm"
      value={value}
      onValueChange={onChange}
      options={[
        { value: 'prev', label: 'vs last week' },
        { value: 'avg', label: 'vs 4-wk avg' },
        { value: 'year', label: 'vs last year' },
      ]}
    />
  );
}

/** Single-select sport filter chips ("All" + sports present). Glyph + label, never colour. */
export function SportChips({ sports, value, onChange }: { sports: Sport[]; value?: Sport; onChange: (s: Sport | undefined) => void }) {
  if (sports.length < 2) return null;
  const item = (key: string, on: boolean, label: ReactNode, click: () => void) => (
    <button
      key={key}
      type="button"
      aria-pressed={on}
      onClick={click}
      className={cn(
        'relative inline-flex h-7 shrink-0 items-center gap-1.5 rounded-sm px-2.5 text-label transition-colors duration-(--dur-fast)',
        on ? 'text-fg-1' : 'text-fg-3 hover:text-fg-1',
      )}
    >
      {on && <motion.span layoutId="trends-sport-chip" className="absolute inset-0 rounded-sm border border-line-3 bg-surface-3" transition={spring.snappy} />}
      <span className="relative inline-flex items-center gap-1.5">{label}</span>
    </button>
  );
  return (
    <div role="group" aria-label="Filter by sport" className="-mx-1 flex items-center gap-0.5 overflow-x-auto px-1 scrollbar-none">
      {item('all', !value, 'All sports', () => onChange(undefined))}
      {sports.map((s) =>
        item(s, value === s, <><SportGlyph sport={s} size={14} />{SPORT_META[s].label}</>, () => onChange(value === s ? undefined : s)),
      )}
    </div>
  );
}

// ───────────────────────── cards ─────────────────────────

/** A chart section card: title (+ link to its deep page), the question it answers, actions. */
export function ChartCard({
  title,
  question,
  to,
  toLabel,
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
    <div className={cn('min-w-0 rounded-xl border border-line-1 bg-surface-1 p-4 md:p-5', className)} style={{ '--chart-bg': 'var(--color-surface-1)' } as CSSProperties}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-title-3 text-fg-1">
            {to ? (
              <Link to={to} search={((p: TrendsSearch) => ({ range: p.range, sport: p.sport })) as never} className="group inline-flex items-center gap-1 hover:text-fg-1">
                {title}
                <ArrowUpRight className="size-4 text-fg-3 transition-transform duration-(--dur-fast) group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-fg-1" aria-label={toLabel ?? 'Open details'} />
              </Link>
            ) : (
              title
            )}
          </h2>
          {question && <p className="mt-1 text-body-sm text-fg-3">{question}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children}
      {aside}
    </div>
  );
}

export function InlineError({ onRetry, children = "Couldn't load this." }: { onRetry?: () => void; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-line-3 px-4 py-3 text-body-sm text-fg-1">
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

/** Micro-caps label + mono value row used in readouts. */
export function Readout({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-0.5', className)}>
      <span className="text-micro uppercase text-fg-3">{label}</span>
      <span className="font-mono text-mono text-fg-1">{children}</span>
    </div>
  );
}
