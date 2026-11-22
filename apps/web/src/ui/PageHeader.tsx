/**
 * Page + PageHeader — the frame of every route (design.md §4.2 / §7 / §5.6).
 *
 *   <Page width="page" header={
 *     <PageHeader title="Trends" eyebrow="Last 12 weeks" back={{ to: '/calendar' }}
 *       actions={<Button>Export</Button>} toolbar={<Segmented … />} meta={<Chip>…</Chip>} />
 *   }>
 *     <Section title="Fitness">…</Section>
 *   </Page>
 *
 * Anatomy (DESIGN_V2 §4): a full-width sticky BAR (52px; transparent at the top, glass + hairline
 * once scrolled; back button, breadcrumb, compact title that fades in when the large title scrolls
 * under it, ONE control row: contextual `toolbar` + `actions`) and a HERO (sentence-case eyebrow in
 * fg-3, `title-1` h1, meta row in fg-2) that scrolls away. Gutters 16/24/48, column 1120 (page) or
 * 720 (prose); sections in <Page> are 48/56/64px apart. `variant="compact"` (calendar, full-bleed tools) shows the title in the bar only.
 * The h1 carries `data-page-title tabIndex=-1`; the shell focuses it after each navigation.
 * `morph` puts the shared names wk-card / wk-glyph / wk-title on the hero (workout & activity pages).
 * Deep children can portal controls into the bar with <HeaderPortal>.
 */
import { Link, useCanGoBack, useRouter, type LinkProps } from '@tanstack/react-router';
import { ArrowLeft, Search } from 'lucide-react';
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { vt } from '@/motion/morph';
import { PageStagger } from '@/motion/PageTransition';
import { IconButton } from './Button';
import { palette } from './palette/registry';

export type PageWidth = 'page' | 'prose' | 'full';
const WidthCtx = createContext<PageWidth>('page');

/** Gutters 16 (mobile) / 24 / 48 (≥1280) around a 1120 (page) or 720 (prose) column; `full` stays full-bleed. */
export const containerCls = (w: PageWidth) =>
  cn(
    'mx-auto w-full px-4 md:px-6',
    w === 'page' && 'max-w-[calc(var(--container-page)+2*1.5rem)] xl:max-w-[calc(var(--container-page)+2*3rem)] xl:px-12',
    w === 'prose' && 'max-w-[calc(var(--container-prose)+2*1.5rem)] xl:max-w-[calc(var(--container-prose)+2*3rem)] xl:px-12',
    w === 'full' && 'xl:px-6',
  );

export interface PageProps {
  header?: ReactNode;
  width?: PageWidth;
  children: ReactNode;
  className?: string;
  /** Stagger top-level children in (default true). */
  stagger?: boolean;
}

/** Route frame: header + width-constrained body with bottom room for the mobile bar. */
export function Page({ header, width = 'page', children, className, stagger = true }: PageProps) {
  return (
    <WidthCtx.Provider value={width}>
      {header}
      {/* Sections are 56 (mobile 48) / 64 (≥1024) apart — DESIGN_V2 §4. */}
      <div className={cn(containerCls(width), 'flex flex-col gap-12 md:gap-14 lg:gap-16 pb-[calc(var(--bottom-bar-h)+6rem)]', className)}>
        {stagger ? <PageStagger>{children}</PageStagger> : children}
      </div>
    </WidthCtx.Provider>
  );
}

// ───────────── header portal slot ─────────────
let slotEl: HTMLElement | null = null;
const slotSubs = new Set<() => void>();
function setSlot(el: HTMLElement | null) {
  slotEl = el;
  slotSubs.forEach((f) => f());
}
/** Portal contextual controls into the current page bar (e.g. from a deeply nested chart). */
export function HeaderPortal({ children }: { children: ReactNode }) {
  const el = useSyncExternalStore(
    (f) => {
      slotSubs.add(f);
      return () => {
        slotSubs.delete(f);
      };
    },
    () => slotEl,
    () => null,
  );
  return el ? createPortal(children, el) : null;
}

export interface Crumb {
  label: ReactNode;
  link?: LinkProps;
}

export interface PageHeaderProps {
  title: ReactNode;
  /** Plain-text title for the compact bar / document.title when `title` is a node. */
  titleText?: string;
  /** Short sentence-case line above the large title (e.g. a date or the parent section). */
  eyebrow?: ReactNode;
  /** Breadcrumb trail shown in the bar (sentence case, fg-3). */
  breadcrumb?: Crumb[];
  /** Back button: history.back() when there is history (so the morph reverses), else this link. */
  back?: LinkProps | true;
  /** Leading glyph next to the large title (e.g. <SportGlyph size={24} />). */
  glyph?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  /** Contextual controls in the bar (view switcher, range). */
  toolbar?: ReactNode;
  /** Right column of the hero (hero stats). */
  aside?: ReactNode;
  variant?: 'hero' | 'compact';
  /** Shared-element names for the workout morph (wk-card / wk-glyph / wk-title). */
  morph?: boolean;
  /** Override the width from <Page>. */
  width?: PageWidth;
  className?: string;
  /** Sets document.title (default true when title is a string). */
  documentTitle?: boolean;
}

export function PageHeader({
  title,
  titleText,
  eyebrow,
  breadcrumb,
  back,
  glyph,
  meta,
  actions,
  toolbar,
  aside,
  variant = 'hero',
  morph,
  width: widthProp,
  className,
  documentTitle = true,
}: PageHeaderProps) {
  const ctxWidth = useContext(WidthCtx);
  const width = widthProp ?? ctxWidth;
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const [slot, setSlotEl] = useState<HTMLDivElement | null>(null);
  const text = titleText ?? (typeof title === 'string' ? title : undefined);

  useEffect(() => {
    setSlot(slot);
    return () => {
      if (slotEl === slot) setSlot(null);
    };
  }, [slot]);
  useEffect(() => {
    if (documentTitle && text) document.title = `${text} · cadence`;
  }, [documentTitle, text]);

  const onBack = () => {
    if (canGoBack) router.history.back();
    else if (back && back !== true) void router.navigate(back);
    else void router.navigate({ to: '/' });
  };

  const compact = variant === 'compact';

  return (
    // Fragment, not a wrapper: the sticky bar must be a direct child of the page so it stays
    // pinned for the whole scroll (a sticky element can't leave its parent box).
    <>
      <div className="page-bar glass-blur sticky top-0 z-(--z-sticky) border-b" data-solid={compact || undefined}>
        <div className={cn(containerCls(width), 'flex h-(--header-h) items-center gap-2')}>
          {back && <IconButton label="Back" icon={<ArrowLeft />} size="sm" onClick={onBack} className="-ml-1.5" />}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {breadcrumb && breadcrumb.length > 0 && (
              <nav aria-label="Breadcrumb" className={cn('flex min-w-0 items-center gap-1.5 text-body-sm text-fg-3', !compact && 'max-md:hidden')}>
                {breadcrumb.map((c, i) => (
                  <span key={i} className="flex min-w-0 items-center gap-1.5">
                    {i > 0 && <span className="text-fg-4">/</span>}
                    {c.link ? (
                      <Link {...c.link} className="truncate transition-colors hover:text-fg-1">
                        {c.label}
                      </Link>
                    ) : (
                      <span className="truncate">{c.label}</span>
                    )}
                  </span>
                ))}
                {!compact && <span className="text-fg-4">/</span>}
              </nav>
            )}
            {compact ? (
              <h1 data-page-title tabIndex={-1} className="truncate text-title-3 text-fg-1 outline-none" style={vt(!!morph, 'title')}>
                {title}
              </h1>
            ) : (
              <span className="page-bar-title truncate text-body font-medium text-fg-1" aria-hidden>
                {text ?? title}
              </span>
            )}
          </div>
          <div ref={setSlotEl} className="flex shrink-0 items-center gap-2 empty:hidden" />
          {toolbar && <div className="flex shrink-0 items-center gap-2 max-sm:hidden">{toolbar}</div>}
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
          <IconButton label="Search" icon={<Search />} size="sm" className="md:hidden" onClick={() => palette.open()} />
        </div>
      </div>
      {!compact && (
        // Title block: 32–40 above (the 52px bar sits on top of that), 32 below.
        <header className={cn(containerCls(width), 'pt-6 pb-8 md:pt-10', className)}>
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between" style={vt(!!morph, 'card')}>
            <div className="page-hero-title flex min-w-0 flex-col gap-1.5">
              {eyebrow && <div className="text-body-sm text-fg-3">{eyebrow}</div>}
              <div className="flex min-w-0 items-center gap-3">
                {glyph && (
                  <span className="flex shrink-0 text-fg-1" style={vt(!!morph, 'glyph')}>
                    {glyph}
                  </span>
                )}
                <h1 data-page-title tabIndex={-1} className="min-w-0 text-title-2 [overflow-wrap:anywhere] text-fg-1 outline-none md:text-title-1" style={vt(!!morph, 'title')}>
                  {title}
                </h1>
              </div>
              {meta && <div className="mt-1 flex flex-wrap items-center gap-2 text-body text-fg-2">{meta}</div>}
            </div>
            {aside && <div className="shrink-0">{aside}</div>}
          </div>
          {toolbar && <div className="mt-6 flex items-center gap-2 overflow-x-auto scrollbar-none sm:hidden">{toolbar}</div>}
        </header>
      )}
    </>
  );
}
