/**
 * Tabs — design.md §7: text tabs (`label`, fg-2 → fg-1), 2px fg-1 underline indicator that slides
 * between tabs (Motion layoutId, snappy). Two flavours:
 *  - <Tabs> + <TabList> + <Tab> + <TabPanel>: in-page panels (Base UI Tabs; arrow keys).
 *  - <NavTabs items>: route-linked tabs (Settings sub-nav, Trends sub-pages); active = current route.
 */
import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import { Link, useRouterState } from '@tanstack/react-router';
import { LayoutGroup, motion } from 'motion/react';
import { createContext, useContext, useId, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { spring } from '@/motion/tokens';

const Ctx = createContext<{ value: string; group: string }>({ value: '', group: '' });

export interface TabsProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
  className?: string;
}

export function Tabs({ value, defaultValue, onValueChange, children, className }: TabsProps) {
  const [inner, setInner] = useState(defaultValue ?? '');
  const current = value ?? inner;
  const group = useId();
  return (
    <Ctx.Provider value={{ value: current, group }}>
      <BaseTabs.Root
        value={current}
        onValueChange={(v) => {
          setInner(String(v));
          onValueChange?.(String(v));
        }}
        className={className}
      >
        {children}
      </BaseTabs.Root>
    </Ctx.Provider>
  );
}

export function TabList({ children, className, 'aria-label': ariaLabel }: { children: ReactNode; className?: string; 'aria-label'?: string }) {
  const { group } = useContext(Ctx);
  return (
    <LayoutGroup id={group}>
      <BaseTabs.List aria-label={ariaLabel} className={cn('relative flex items-center gap-5 border-b border-line-1', className)}>
        {children}
      </BaseTabs.List>
    </LayoutGroup>
  );
}

const tabCls =
  'relative inline-flex h-9 select-none items-center gap-1.5 text-label text-fg-2 transition-colors duration-(--dur-fast) ' +
  'hover:text-fg-1 data-[selected]:text-fg-1 aria-[current=page]:text-fg-1 focus-visible:outline-offset-0 [&_svg]:size-3.5';

function Indicator({ inset }: { inset?: boolean }) {
  return (
    <motion.span
      layoutId="tab-indicator"
      transition={spring.snappy}
      className={cn('absolute inset-x-0 h-0.5 rounded-full bg-fg-1', inset ? 'bottom-0' : '-bottom-px')}
      aria-hidden
    />
  );
}

export function Tab({ value, children, count, disabled }: { value: string; children: ReactNode; count?: number; disabled?: boolean }) {
  const ctx = useContext(Ctx);
  return (
    <BaseTabs.Tab value={value} disabled={disabled} className={cn(tabCls, '-mb-px')}>
      {children}
      {count != null && <span className="font-mono text-mono-sm text-fg-3">{count}</span>}
      {ctx.value === value && <Indicator />}
    </BaseTabs.Tab>
  );
}

export function TabPanel({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  return (
    <BaseTabs.Panel value={value} className={cn('outline-none', className)}>
      {children}
    </BaseTabs.Panel>
  );
}

export interface NavTabItem {
  to: string;
  label: ReactNode;
  /** Match only the exact path (default: prefix match). */
  exact?: boolean;
}

/** Route-linked tabs. `to` must be a registered route path without params. */
export function NavTabs({ items, className, 'aria-label': ariaLabel }: { items: NavTabItem[]; className?: string; 'aria-label': string }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const group = useId();
  const active = items.reduce<NavTabItem | undefined>((best, it) => {
    const hit = it.exact ? pathname === it.to : pathname === it.to || pathname.startsWith(it.to + '/');
    return hit && (!best || it.to.length > best.to.length) ? it : best;
  }, undefined);
  return (
    <LayoutGroup id={group}>
      <nav aria-label={ariaLabel} className={cn('relative flex items-center gap-5 overflow-x-auto border-b border-line-1 scrollbar-none', className)}>
        {items.map((it) => (
          <Link key={it.to} to={it.to} className={cn(tabCls, 'shrink-0')} aria-current={active === it ? 'page' : undefined}>
            {it.label}
            {active === it && <Indicator inset />}
          </Link>
        ))}
      </nav>
    </LayoutGroup>
  );
}
