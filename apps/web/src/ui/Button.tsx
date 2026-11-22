/**
 * Button / IconButton / ButtonLink — DESIGN_V2 §5.
 *  - primary: accent fill, on-accent text (≥ 4.5:1 in every theme × accent). MAX ONE per page —
 *    the page's single primary action. Never in the rail, never in lists.
 *  - secondary (default): surface-2 fill, no border, fg-1 text. Use this for almost everything.
 *  - ghost: fg-2 text only, hover surface-2. Toolbars, inline and tertiary actions.
 *  - outline: line-2 hairline, transparent — only where a fill would sit on an identical fill.
 *  - danger: monochrome (secondary look + TriangleAlert) — there is no red anywhere.
 * Every pressable: whileTap scale .97 (snappy); hover changes background only.
 */
import { createLink, type LinkComponent } from '@tanstack/react-router';
import { TriangleAlert } from 'lucide-react';
import { motion, type HTMLMotionProps } from 'motion/react';
import type { ReactElement, ReactNode, Ref } from 'react';
import { cn } from '@/lib/cn';
import { spring } from '@/motion/tokens';
import { Kbd } from './Kbd';
import { Tooltip } from './Tooltip';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
export type ButtonSize = 'sm' | 'md' | 'lg';

const base =
  'relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-md ' +
  'transition-[background-color,color,border-color,opacity] duration-(--dur-fast) ease-out ' +
  'disabled:pointer-events-none disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40 ' +
  'pointer-coarse:min-h-11 [&_svg]:shrink-0';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover active:bg-accent-press',
  secondary: 'bg-surface-2 text-fg-1 hover:bg-surface-3 active:bg-surface-active aria-pressed:bg-surface-active',
  outline: 'border border-line-2 bg-transparent text-fg-1 hover:border-line-3 hover:bg-surface-2 active:bg-surface-3',
  ghost: 'text-fg-2 hover:bg-surface-2 hover:text-fg-1 active:bg-surface-3 aria-pressed:bg-surface-3 aria-pressed:text-fg-1',
  danger: 'bg-surface-2 text-fg-1 hover:bg-surface-3 active:bg-surface-active',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-7 gap-1.5 px-2.5 text-label [&_svg]:size-3.5',
  md: 'h-9 px-3.5 text-body-sm font-medium [&_svg]:size-4',
  lg: 'h-11 px-5 text-body font-medium [&_svg]:size-4',
};

/** Class string for any element styled as a button (e.g. a raw <a> or a Base UI trigger). */
export function buttonStyles(opts?: { variant?: ButtonVariant; size?: ButtonSize; className?: string }) {
  return cn(base, variants[opts?.variant ?? 'secondary'], sizes[opts?.size ?? 'md'], opts?.className);
}

function Dots() {
  return (
    <span className="absolute inset-0 flex items-center justify-center gap-1" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-1 rounded-full bg-current animate-dot-pulse" style={{ animationDelay: `${i * 160}ms` }} />
      ))}
    </span>
  );
}

export interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon (lucide element). `danger` gets TriangleAlert by default. */
  icon?: ReactNode;
  /** Trailing icon. */
  iconRight?: ReactNode;
  /** Shortcut hint shown at the right ('mod+enter'). */
  kbd?: string;
  loading?: boolean;
  children?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  kbd,
  loading,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const lead = icon ?? (variant === 'danger' ? <TriangleAlert aria-hidden /> : null);
  return (
    <motion.button
      type={type}
      whileTap={disabled || loading ? undefined : { scale: 0.97 }}
      transition={spring.snappy}
      disabled={disabled}
      aria-busy={loading || undefined}
      className={buttonStyles({ variant, size, className })}
      {...rest}
    >
      <span className={cn('inline-flex items-center gap-2 transition-opacity duration-(--dur-base)', loading && 'opacity-0')}>
        {lead}
        {children}
        {iconRight}
        {kbd && <Kbd keys={kbd} tone={variant === 'primary' ? 'subtle' : 'default'} className="-mr-1 ml-1" />}
      </span>
      {loading && <Dots />}
    </motion.button>
  );
}

export interface IconButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  /** Required accessible label; also the tooltip text. */
  label: string;
  icon: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'ghost' | 'secondary' | 'primary' | 'outline';
  /** Shortcut hint shown in the tooltip. */
  kbd?: string;
  tooltip?: boolean;
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right';
  /** Toggle buttons: sets aria-pressed (renders the pressed surface). */
  pressed?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

const iconSizes = { sm: 'size-7 [&_svg]:size-3.5', md: 'size-9 [&_svg]:size-4', lg: 'size-11 [&_svg]:size-5' };

export function IconButton({
  label,
  icon,
  size = 'md',
  variant = 'ghost',
  kbd,
  tooltip = true,
  tooltipSide = 'bottom',
  pressed,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const btn = (
    <motion.button
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      whileTap={{ scale: 0.94 }}
      transition={spring.snappy}
      className={cn(base, variants[variant], iconSizes[size], 'px-0 pointer-coarse:min-w-11', className)}
      {...rest}
    >
      {icon}
    </motion.button>
  );
  return tooltip ? (
    <Tooltip content={label} kbd={kbd} side={tooltipSide}>
      {btn as ReactElement}
    </Tooltip>
  ) : (
    btn
  );
}

/** Anchor styled as a button; wrapped with createLink so it takes typed `to/params/search`. */
interface ButtonAnchorProps extends Omit<HTMLMotionProps<'a'>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconRight?: ReactNode;
  kbd?: string;
  children?: ReactNode;
  ref?: Ref<HTMLAnchorElement>;
}
function ButtonAnchor({ variant = 'secondary', size = 'md', icon, iconRight, kbd, className, children, ...rest }: ButtonAnchorProps) {
  return (
    <motion.a whileTap={{ scale: 0.97 }} transition={spring.snappy} className={buttonStyles({ variant, size, className })} {...rest}>
      {icon}
      {children}
      {iconRight}
      {kbd && <Kbd keys={kbd} tone={variant === 'primary' ? 'subtle' : 'default'} className="-mr-1 ml-1" />}
    </motion.a>
  );
}

/** `<ButtonLink to="/workouts/new" search={{ date }} variant="primary">New workout</ButtonLink>` */
export const ButtonLink: LinkComponent<typeof ButtonAnchor> = createLink(ButtonAnchor);
