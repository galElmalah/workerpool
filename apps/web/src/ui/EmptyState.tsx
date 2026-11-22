/**
 * EmptyState — a 20px fg-3 icon on a 40px surface-2 disc (no border) · title-3 · body fg-2
 * (≤ 2 lines) · one secondary action. No illustrations, no box around it. Enters with the page stagger.
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
      className={cn('flex flex-col items-center text-center', size === 'md' ? 'gap-4 px-6 py-16' : 'gap-3 px-4 py-10', className)}
    >
      {icon && (
        <div className="flex size-10 items-center justify-center rounded-full bg-surface-2 text-fg-3 [&_svg]:size-5">
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
