/**
 * Banner — inline info / error / success message inside a page (never a modal). Monochrome, no
 * border, no coloured edge (DESIGN_V2 rule 5): a surface fill + an icon carry the meaning.
 *  info    surface-1, Info icon fg-2
 *  error   surface-2, TriangleAlert fg-1, title semibold (errors are never red); role=alert
 *  success surface-1, Check icon fg-1 (done is neutral)
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
        'flex items-start gap-3 rounded-lg px-4 py-3.5',
        tone === 'error' ? 'bg-surface-2' : 'bg-surface-1',
        className,
      )}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', tone === 'info' ? 'text-fg-2' : 'text-fg-1')} aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <div className={cn('text-body text-fg-1', tone === 'error' ? 'font-semibold' : 'font-medium')}>{title}</div>}
        {children && <div className={cn('text-body text-fg-2', title && 'mt-0.5')}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
      {onDismiss && (
        <button type="button" aria-label="Dismiss" onClick={onDismiss} className="-mr-1 flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-3 transition-colors duration-(--dur-fast) hover:bg-surface-3 hover:text-fg-1">
          <X className="size-3.5" />
        </button>
      )}
    </motion.div>
  );
}
