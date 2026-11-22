/**
 * Placeholder page used by the initial `features/<feature>/pages.tsx` files. Feature agents
 * replace those files wholesale; nothing else should import this.
 */
import { Link } from '@tanstack/react-router';
import { LayoutGrid } from 'lucide-react';
import type { ReactNode } from 'react';
import { buttonStyles } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Page, PageHeader, type PageHeaderProps, type PageWidth } from '@/ui/PageHeader';

export interface PlaceholderProps {
  title: string;
  eyebrow?: ReactNode;
  icon: ReactNode;
  /** What this page will hold (one or two sentences, product.md copy). */
  children: ReactNode;
  back?: PageHeaderProps['back'];
  breadcrumb?: PageHeaderProps['breadcrumb'];
  width?: PageWidth;
  variant?: PageHeaderProps['variant'];
  /** Rendered above the placeholder (e.g. section tabs). */
  top?: ReactNode;
}

export function PlaceholderPage({ title, eyebrow, icon, children, back, breadcrumb, width = 'page', variant, top }: PlaceholderProps) {
  return (
    <Page width={width} header={<PageHeader title={title} eyebrow={eyebrow} back={back} breadcrumb={breadcrumb} variant={variant} />}>
      {top}
      <div className="rounded-lg bg-surface-1">
        <EmptyState
          icon={icon}
          title="Coming together"
          action={
            <Link to="/dev/gallery" className={buttonStyles({ variant: 'ghost', size: 'sm' })}>
              <LayoutGrid className="size-3.5" />
              Browse the design system
            </Link>
          }
        >
          {children}
        </EmptyState>
      </div>
    </Page>
  );
}
