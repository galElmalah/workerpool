/**
 * Chip / Tag / TagInput — design.md §7: h-6, radius sm, px-2, `label`; optional glyph; removable X.
 * Tones: neutral (surface-2 + line-2), selected (fg-1 text, line-3, surface-3), signal
 * (accent-a2 bg, accent-ink text — only for "done/load/live/key" meanings).
 * New chips enter with @starting-style (scale .9 → 1).
 */
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { useState, type ReactNode, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';
import { spring, tween } from '@/motion/tokens';
import { controlStyles } from './Field';

export type ChipTone = 'neutral' | 'selected' | 'signal' | 'outline';

const tones: Record<ChipTone, string> = {
  neutral: 'border-line-2 bg-surface-2 text-fg-2',
  selected: 'border-line-3 bg-surface-3 text-fg-1',
  signal: 'border-transparent bg-accent-a2 text-accent-ink',
  outline: 'border-dashed border-line-3 bg-transparent text-fg-2',
};

export interface ChipProps {
  children: ReactNode;
  tone?: ChipTone;
  icon?: ReactNode;
  onRemove?: () => void;
  /** Makes the chip a toggle button. */
  onClick?: () => void;
  selected?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  title?: string;
}

export function Chip({ children, tone, icon, onRemove, onClick, selected, size = 'md', className, title }: ChipProps) {
  const t = tone ?? (selected ? 'selected' : 'neutral');
  const cls = cn(
    'enter-pop inline-flex max-w-full shrink-0 select-none items-center gap-1 rounded-sm border text-label whitespace-nowrap',
    size === 'sm' ? 'h-5 px-1.5 text-micro ' : 'h-6 px-2',
    '[&_svg]:size-3.5 [&_svg]:shrink-0',
    tones[t],
    onClick && 'transition-colors duration-(--dur-fast) hover:border-line-3 hover:text-fg-1',
    className,
  );
  const content = (
    <>
      {icon}
      <span className="truncate">{children}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${typeof children === 'string' ? children : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="-mr-1 ml-0.5 flex size-4 items-center justify-center rounded-xs text-fg-3 hover:bg-surface-3 hover:text-fg-1 [&_svg]:!size-3"
        >
          <X />
        </button>
      )}
    </>
  );
  if (onClick)
    return (
      <motion.button type="button" whileTap={{ scale: 0.96 }} transition={spring.snappy} aria-pressed={selected} onClick={onClick} className={cls} title={title}>
        {content}
      </motion.button>
    );
  return (
    <span className={cls} title={title}>
      {content}
    </span>
  );
}

/** Alias: tags are chips. */
export const Tag = Chip;

export interface TagInputProps {
  value: string[];
  onValueChange: (tags: string[]) => void;
  placeholder?: string;
  /** Suggestions shown as quick-add chips under the field. */
  suggestions?: string[];
  className?: string;
  'aria-label'?: string;
}

/** Type and press Enter / comma to add; Backspace on empty removes the last tag. */
export function TagInput({ value, onValueChange, placeholder = 'Add tag…', suggestions, className, ...aria }: TagInputProps) {
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const t = raw.trim().replace(/^#/, '').toLowerCase();
    if (!t || value.includes(t)) return;
    onValueChange([...value, t]);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(draft);
      setDraft('');
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onValueChange(value.slice(0, -1));
    }
  };
  const rest = suggestions?.filter((s) => !value.includes(s)) ?? [];
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div
        className={cn(
          controlStyles('md'),
          'flex h-auto min-h-9 flex-wrap items-center gap-1 px-1.5 py-1 focus-within:outline-2 focus-within:outline-offset-[-1px] focus-within:outline-focus',
        )}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {value.map((t) => (
            <motion.span key={t} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9, transition: tween('fast', 'in') }} transition={spring.snappy}>
              <Chip tone="selected" onRemove={() => onValueChange(value.filter((x) => x !== t))}>
                #{t}
              </Chip>
            </motion.span>
          ))}
        </AnimatePresence>
        <input
          value={draft}
          aria-label={aria['aria-label'] ?? 'Tags'}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (draft) {
              add(draft);
              setDraft('');
            }
          }}
          placeholder={value.length ? '' : placeholder}
          className="h-6 min-w-24 flex-1 bg-transparent px-1.5 text-body text-fg-1 outline-none placeholder:text-fg-4"
        />
      </div>
      {rest.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {rest.map((s) => (
            <Chip key={s} tone="outline" onClick={() => add(s)}>
              #{s}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}
