/**
 * EmptyState — design.md §7: 24px icon (fg-3) in a 48px surface-2 rounded-lg tile · title-3 ·
 * body fg-2 (≤ 2 lines) · one secondary action. No illustrations. Enters with the page stagger.
 */
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { pageItem } from '@/motion/PageTransition';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** Compact variant for cards / panels. */
  size?: 'sm' | 'md';
}

export function EmptyState({ icon, title, children, action, className, size = 'md' }: EmptyStateProps) {
  return (
    <motion.div
      variants={pageItem}
      initial="hidden"
      animate="show"
      className={cn('flex flex-col items-center text-center', size === 'md' ? 'gap-4 px-6 py-16' : 'gap-3 px-4 py-8', className)}
    >
      {icon && (
        <div className="flex size-12 items-center justify-center rounded-lg border border-line-2 bg-surface-2 text-fg-3 inset-shadow-hairline [&_svg]:size-6">
          {icon}
        </div>
      )}
      <div className="flex max-w-sm flex-col gap-1.5">
        <h3 className="text-title-3 text-fg-1">{title}</h3>
        {children && <p className="line-clamp-3 text-body text-fg-2">{children}</p>}
      </div>
      {action && <div className="pt-1">{action}</div>}
    </motion.div>
  );
}
