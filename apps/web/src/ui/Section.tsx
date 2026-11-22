/**
 * Section — a titled block inside a page: `title-3` heading (16 semibold, fg-1) + optional fg-2
 * description and right-side actions, 16px above the content. Sections are spaced 48–64px apart by
 * <Page>, so never add dividers or cards just to separate them. `variant="micro"` = a 12px fg-3
 * sentence-case heading for dense asides.
 * Divider — 1px line-1 hairline, horizontal or vertical, optional label. Prefer a gap.
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { PageSection } from '@/motion/PageTransition';

export interface SectionProps {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** 'title' (title-3, default) or 'micro' (12px fg-3 sentence case, for dense asides). */
  variant?: 'title' | 'micro';
  id?: string;
  className?: string;
  children: ReactNode;
  /** Participate in the page stagger (default true). */
  stagger?: boolean;
}

export function Section({ title, description, actions, variant = 'title', id, className, children, stagger = true }: SectionProps) {
  const head = (title || actions) && (
    // Wraps on narrow screens: the actions drop under the title instead of pushing it (DESIGN_V2 §9).
    <header className={cn('flex flex-wrap items-end justify-between gap-x-4 gap-y-3', variant === 'title' ? 'mb-4 md:mb-5' : 'mb-3')}>
      <div className="min-w-0">
        {title &&
          (variant === 'title' ? (
            <h2 className="text-title-3 text-fg-1">{title}</h2>
          ) : (
            <h2 className="text-label text-fg-3">{title}</h2>
          ))}
        {description && <p className="mt-1 max-w-[65ch] text-body text-fg-2">{description}</p>}
      </div>
      {actions && <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
  const body = (
    <>
      {head}
      {children}
    </>
  );
  return stagger ? (
    <PageSection id={id} aria-labelledby={undefined} className={cn('scroll-mt-20', className)}>
      {body}
    </PageSection>
  ) : (
    <section id={id} className={cn('scroll-mt-20', className)}>
      {body}
    </section>
  );
}

export function Divider({ orientation = 'horizontal', label, className }: { orientation?: 'horizontal' | 'vertical'; label?: ReactNode; className?: string }) {
  if (orientation === 'vertical') return <span role="separator" aria-orientation="vertical" className={cn('inline-block w-px self-stretch bg-line-1', className)} />;
  if (label)
    return (
      <div role="separator" className={cn('flex items-center gap-3 text-label font-normal text-fg-3', className)}>
        <span className="h-px flex-1 bg-line-1" />
        {label}
        <span className="h-px flex-1 bg-line-1" />
      </div>
    );
  return <hr className={cn('h-px border-0 bg-line-1', className)} />;
}
