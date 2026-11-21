/**
 * InlineEdit — click-to-edit text with autosave tick (product.md §2.1 "edit in place"). The input
 * inherits the display text's font so nothing shifts. Enter / blur commits, Esc cancels.
 * `onSave` may return a promise; the SaveIndicator tick morphs in on success.
 *
 *   <InlineEdit value={title} onSave={(t) => patch({ title: t })} variant="title" aria-label="Workout title" />
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { SaveIndicator, type SaveStatus } from './SaveIndicator';

export interface InlineEditProps {
  value: string;
  onSave: (value: string) => Promise<unknown> | void;
  placeholder?: string;
  variant?: 'title' | 'heading' | 'body';
  multiline?: boolean;
  /** Reject empty strings (reverts). Default true for titles. */
  required?: boolean;
  className?: string;
  'aria-label': string;
  /** Rendered next to the text (e.g. a tag). */
  adornment?: ReactNode;
  /** Additional styles for the title text (e.g. view-transition names). */
  textStyle?: React.CSSProperties;
}

const variantCls = {
  title: 'text-title-1',
  heading: 'text-title-3',
  body: 'text-body',
};

export function InlineEdit({ value, onSave, placeholder = 'Untitled', variant = 'body', multiline, required, className, adornment, textStyle, ...aria }: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const mustHave = required ?? variant !== 'body';

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);
  useEffect(() => {
    if (editing) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [editing]);

  const commit = async () => {
    setEditing(false);
    const next = multiline ? draft : draft.trim();
    if (next === value || (mustHave && !next)) {
      setDraft(value);
      return;
    }
    setStatus('saving');
    try {
      await onSave(next);
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2000);
    } catch {
      setStatus('error');
    }
  };

  const shared = cn(
    variantCls[variant],
    'w-full rounded-sm bg-transparent px-1.5 -mx-1.5 py-0.5 -my-0.5 text-fg-1 outline-none',
  );

  return (
    <div className={cn('group/ie flex min-w-0 items-center gap-2', className)}>
      {editing ? (
        multiline ? (
          <textarea
            ref={ref}
            value={draft}
            aria-label={aria['aria-label']}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setDraft(value);
                setEditing(false);
              }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit();
            }}
            rows={Math.max(2, draft.split('\n').length)}
            className={cn(shared, 'resize-none bg-surface-2 ring-2 ring-focus')}
          />
        ) : (
          <input
            ref={ref}
            value={draft}
            aria-label={aria['aria-label']}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                setDraft(value);
                setEditing(false);
              }
            }}
            className={cn(shared, 'bg-surface-2 ring-2 ring-focus')}
          />
        )
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`${aria['aria-label']}: ${value || placeholder}. Click to edit`}
          className={cn(
            shared,
            'min-w-0 cursor-text truncate text-left transition-colors duration-(--dur-fast) hover:bg-surface-2',
            multiline && 'whitespace-pre-wrap',
            !value && 'text-fg-4',
          )}
        >
          <span style={textStyle}>{value || placeholder}</span>
        </button>
      )}
      {adornment}
      <SaveIndicator status={status} className="shrink-0" />
    </div>
  );
}
