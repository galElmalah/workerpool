/**
 * Banner — inline info / error / success message inside a page (never a modal). Monochrome:
 *  info    surface-2, line-2, Info icon
 *  error   transparent, DASHED fg-1 border, TriangleAlert (errors are never red)
 *  success accent-a2 wash, accent-ink icon (done / synced)
 */
import { Check, Info, TriangleAlert, X } from 'lucide-react';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { pageItem } from '@/motion/PageTransition';

export interface BannerProps {
  tone?: 'info' | 'error' | 'success';
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

export function Banner({ tone = 'info', title, children, action, onDismiss, className }: BannerProps) {
  const Icon = tone === 'error' ? TriangleAlert : tone === 'success' ? Check : Info;
  return (
    <motion.div
      variants={pageItem}
      initial="hidden"
      animate="show"
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-3 rounded-lg border px-4 py-3',
        tone === 'info' && 'border-line-2 bg-surface-2',
        tone === 'error' && 'border-dashed border-fg-2 bg-transparent',
        tone === 'success' && 'border-accent-a4 bg-accent-a1',
        className,
      )}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', tone === 'success' ? 'text-accent-ink' : 'text-fg-1')} aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <div className="text-body font-[560] text-fg-1">{title}</div>}
        {children && <div className={cn('text-body text-fg-2', title && 'mt-0.5')}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
      {onDismiss && (
        <button type="button" aria-label="Dismiss" onClick={onDismiss} className="-mr-1 flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-3 hover:bg-surface-3 hover:text-fg-1">
          <X className="size-3.5" />
        </button>
      )}
    </motion.div>
  );
}
