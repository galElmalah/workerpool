/**
 * Mobile (< 768px) glass bottom bar: Today · Calendar · ＋ · Trends · More (product.md §2.3).
 * No top border (glass + blur separate it). Active = surface pill + fg-1; ＋ is NEUTRAL (the accent
 * belongs to each page's own primary action).
 * ＋ opens the create page (a route, so Back closes it). More = a small menu with the rest.
 * The active item carries `nav-pill` (the rail is not rendered on mobile, so names stay unique).
 */
import { Link, useRouter, useRouterState } from '@tanstack/react-router';
import { BookCopy, CalendarDays, ChartSpline, Ellipsis, History, Moon, NotebookPen, Plus, Settings, Sun, Sunrise } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '@/lib/cn';
import { spring } from '@/motion/tokens';
import { Menu } from '@/ui/Menu';
import { activeNav, NAV, SETTINGS_NAV } from './nav';
import { toggleTheme, useTheme } from './theme';

const tabCls =
  'relative flex h-full flex-1 flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium outline-none transition-colors duration-(--dur-fast) focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-focus';

export function MobileBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = activeNav(pathname);
  const router = useRouter();
  const { resolved } = useTheme();
  const moreActive = !!active && !['/today', '/calendar', '/trends'].includes(active.to);

  const Tab = ({ to, label, Icon }: { to: '/today' | '/calendar' | '/trends'; label: string; Icon: typeof Sunrise }) => {
    const on = active?.to === to;
    return (
      <Link to={to} className={cn(tabCls, on ? 'text-fg-1' : 'text-fg-3')} aria-current={on ? 'page' : undefined}>
        {on && <span className="absolute top-1.5 h-8 w-14 rounded-full bg-surface-3" style={{ viewTransitionName: 'nav-pill' }} aria-hidden />}
        <Icon className="relative size-5" strokeWidth={on ? 2 : 1.75} />
        <span className="relative">{label}</span>
      </Link>
    );
  };

  return (
    <nav
      aria-label="Primary"
      className="glass fixed inset-x-0 bottom-0 z-(--z-rail) pb-safe"
    >
      <div className="mx-auto flex h-16 max-w-lg items-stretch px-2">
        <Tab to="/today" label="Today" Icon={Sunrise} />
        <Tab to="/calendar" label="Calendar" Icon={CalendarDays} />
        <div className="flex flex-1 items-center justify-center">
          <motion.span whileTap={{ scale: 0.92 }} transition={spring.snappy} className="block">
            <Link
              to="/workouts/new"
              aria-label="New workout"
              className="flex size-11 items-center justify-center rounded-full bg-surface-active text-fg-1 outline-none active:bg-gray-6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus light:bg-surface-3"
            >
              <Plus className="size-5" strokeWidth={2} />
            </Link>
          </motion.span>
        </div>
        <Tab to="/trends" label="Trends" Icon={ChartSpline} />
        <Menu
          side="top"
          align="end"
          trigger={
            <button type="button" className={cn(tabCls, moreActive ? 'text-fg-1' : 'text-fg-3')} aria-label="More">
              {moreActive && <span className="absolute top-1.5 h-8 w-14 rounded-full bg-surface-3" style={{ viewTransitionName: 'nav-pill' }} aria-hidden />}
              <Ellipsis className="relative size-5" />
              <span className="relative">More</span>
            </button>
          }
          items={[
            ...NAV.filter((n) => !['/today', '/calendar', '/trends'].includes(n.to)).map((n) => ({
              label: n.label,
              icon: n.to === '/activities' ? <History /> : n.to === '/library' ? <BookCopy /> : <NotebookPen />,
              onSelect: () => void router.navigate({ to: n.to }),
            })),
            { label: SETTINGS_NAV.label, icon: <Settings />, onSelect: () => void router.navigate({ to: SETTINGS_NAV.to }) },
            { type: 'separator' as const },
            { label: resolved === 'dark' ? 'Light theme' : 'Dark theme', icon: resolved === 'dark' ? <Sun /> : <Moon />, onSelect: toggleTheme },
          ]}
        />
      </div>
    </nav>
  );
}
