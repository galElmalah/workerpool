import { BookCopy, CalendarDays, ChartSpline, History, NotebookPen, Settings, Sunrise, type LucideIcon } from 'lucide-react';

export interface NavItem {
  to: '/today' | '/calendar' | '/trends' | '/activities' | '/library' | '/journal' | '/settings/profile';
  label: string;
  icon: LucideIcon;
  /** Shortcut id from the registry. */
  shortcut: string;
  /** Path prefixes that make this item active. */
  match: string[];
}

/** Desktop rail (ARCHITECTURE.md "UI decisions"). */
export const NAV: NavItem[] = [
  { to: '/today', label: 'Today', icon: Sunrise, shortcut: 'nav.today', match: ['/today'] },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays, shortcut: 'nav.calendar', match: ['/calendar', '/week', '/season', '/events', '/workouts'] },
  { to: '/trends', label: 'Trends', icon: ChartSpline, shortcut: 'nav.trends', match: ['/trends'] },
  { to: '/activities', label: 'Activities', icon: History, shortcut: 'nav.activities', match: ['/activities'] },
  { to: '/library', label: 'Library', icon: BookCopy, shortcut: 'nav.library', match: ['/library'] },
  { to: '/journal', label: 'Journal', icon: NotebookPen, shortcut: 'nav.journal', match: ['/journal'] },
];

export const SETTINGS_NAV: NavItem = { to: '/settings/profile', label: 'Settings', icon: Settings, shortcut: 'nav.settings', match: ['/settings'] };

export function activeNav(pathname: string, items: NavItem[] = [...NAV, SETTINGS_NAV]): NavItem | undefined {
  return items.find((it) => it.match.some((m) => pathname === m || pathname.startsWith(m + '/')));
}
