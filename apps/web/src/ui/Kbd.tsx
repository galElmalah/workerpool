import { Fragment } from 'react';
import { cn } from '@/lib/cn';

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const GLYPH: Record<string, string> = {
  mod: isMac ? '⌘' : 'Ctrl',
  cmd: '⌘',
  meta: isMac ? '⌘' : 'Win',
  ctrl: isMac ? '⌃' : 'Ctrl',
  alt: isMac ? '⌥' : 'Alt',
  option: '⌥',
  shift: '⇧',
  enter: '↵',
  return: '↵',
  esc: 'Esc',
  escape: 'Esc',
  tab: 'Tab',
  space: 'Space',
  backspace: '⌫',
  delete: 'Del',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  pageup: 'PgUp',
  pagedown: 'PgDn',
};

/**
 * Splits a shortcut spec into display steps: 'mod+k' → [['⌘','K']]; 'g c' → [['G'],['C']].
 * Combos use '+', sequences use a space.
 */
export function shortcutSteps(spec: string): string[][] {
  return spec
    .trim()
    .split(/\s+/)
    .map((step) =>
      step
        .split('+')
        .filter(Boolean)
        .map((k) => GLYPH[k.toLowerCase()] ?? (k.length === 1 ? k.toUpperCase() : k[0]!.toUpperCase() + k.slice(1))),
    );
}

/** Human label for aria / tooltips: 'mod+k' → '⌘K' (mac) or 'Ctrl+K'. */
export function shortcutLabel(spec: string): string {
  return shortcutSteps(spec)
    .map((s) => s.join(isMac ? '' : '+'))
    .join(' then ');
}

export interface KbdProps {
  /** Shortcut spec ('mod+k', 'g c', '?') — or pass children for a single literal key. */
  keys?: string;
  children?: React.ReactNode;
  className?: string;
  /** `subtle` drops the key cap background (for use inside buttons / on accent). */
  tone?: 'default' | 'subtle';
}

const cap =
  'inline-flex h-5 min-w-5 items-center justify-center rounded-xs px-1 font-mono text-mono-sm leading-none text-fg-2';

export function Kbd({ keys, children, className, tone = 'default' }: KbdProps) {
  const capCls = cn(cap, tone === 'default' ? 'border border-line-2 bg-surface-3' : 'border border-current/25 bg-transparent !text-current opacity-70');
  if (!keys)
    return (
      <kbd className={cn(capCls, className)}>
        {children}
      </kbd>
    );
  const steps = shortcutSteps(keys);
  return (
    <span className={cn('inline-flex items-center gap-1', className)} aria-label={shortcutLabel(keys)}>
      {steps.map((combo, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-mono-sm text-fg-4" aria-hidden>then</span>}
          <span className="inline-flex items-center gap-0.5" aria-hidden>
            {combo.map((k, j) => (
              <kbd key={j} className={capCls}>
                {k}
              </kbd>
            ))}
          </span>
        </Fragment>
      ))}
    </span>
  );
}
