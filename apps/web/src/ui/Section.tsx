/**
 * Section — a titled block inside a page (title-2 or micro-caps heading + optional description and
 * right-side actions). Divider — 1px line-1 hairline, horizontal or vertical, optional label.
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { PageSection } from '@/motion/PageTransition';

export interface SectionProps {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** 'title' (title-2, default) or 'micro' (micro caps, for dense asides). */
  variant?: 'title' | 'micro';
  id?: string;
  className?: string;
  children: ReactNode;
  /** Participate in the page stagger (default true). */
  stagger?: boolean;
}

export function Section({ title, description, actions, variant = 'title', id, className, children, stagger = true }: SectionProps) {
  const head = (title || actions) && (
    <header className={cn('flex items-end justify-between gap-4', variant === 'title' ? 'mb-4' : 'mb-3')}>
      <div className="min-w-0">
        {title &&
          (variant === 'title' ? (
            <h2 className="text-title-2 text-fg-1">{title}</h2>
          ) : (
            <h2 className="text-micro text-fg-3">{title}</h2>
          ))}
        {description && <p className="mt-1 text-body text-fg-2">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
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
      <div role="separator" className={cn('flex items-center gap-3 text-micro text-fg-3', className)}>
        <span className="h-px flex-1 bg-line-1" />
        {label}
        <span className="h-px flex-1 bg-line-1" />
      </div>
    );
  return <hr className={cn('h-px border-0 bg-line-1', className)} />;
}
