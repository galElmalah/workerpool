/**
 * Desktop / tablet rail — design.md §4.2, §5.4f.
 *  ≥1280: 232 ↔ 64 (persisted), width springs with `smooth`, labels fade at 140ms.
 *  768–1279: 64 with icons + tooltips; expands as a glass OVERLAY (doesn't push content).
 * Active item = a pill carrying view-transition-name `nav-pill`, so it glides between items during
 * the route transition; a Motion `layoutId="nav-hover"` pill previews hover (snappy).
 */
import { Link, useRouterState } from '@tanstack/react-router';
import { PanelLeft, PanelLeftClose, Plus, Search } from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useMagnetic } from '@/motion/pointer';
import { spring, tween } from '@/motion/tokens';
import { IconButton } from '@/ui/Button';
import { SyncDot } from '@/ui/domain/Status';
import { Kbd } from '@/ui/Kbd';
import { palette } from '@/ui/palette/registry';
import { Tooltip } from '@/ui/Tooltip';
import { NAV, SETTINGS_NAV, activeNav, type NavItem } from './nav';
import { shortcutKeys } from './shortcuts';
import { syncLabel, useSyncStatus } from './sync';

export const RAIL_EXPANDED = 232;
export const RAIL_COLLAPSED = 64;

export interface RailProps {
  /** Labels visible (wide + expanded, or the tablet overlay is open). */
  expanded: boolean;
  /** Tablet overlay mode (glass, floats over content). */
  overlay: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}

function Label({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { ...tween('fast'), delay: 0.06 } }}
          exit={{ opacity: 0, transition: tween('fast', 'in') }}
          className="min-w-0 flex-1 truncate whitespace-nowrap"
        >
          {children}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

function RailLink({ item, active, expanded, hovered, onHover, onNavigate }: { item: NavItem; active: boolean; expanded: boolean; hovered: boolean; onHover: (to: string | null) => void; onNavigate?: () => void }) {
  const Icon = item.icon;
  const link = (
    <Link
      to={item.to}
      onClick={onNavigate}
      onPointerEnter={() => onHover(item.to)}
      aria-current={active ? 'page' : undefined}
      aria-label={expanded ? undefined : item.label}
      className={cn(
        'relative flex h-9 items-center gap-3 rounded-md px-[11px] text-body outline-none transition-colors duration-(--dur-fast)',
        'focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus',
        active ? 'text-fg-1' : 'text-fg-2 hover:text-fg-1',
      )}
    >
      {hovered && !active && (
        <motion.span layoutId="nav-hover" transition={spring.snappy} className="absolute inset-0 rounded-md bg-surface-2" aria-hidden />
      )}
      {active && (
        <span className="absolute inset-0 rounded-md border border-line-1 bg-surface-3 light:border-line-2 light:bg-surface-1" style={{ viewTransitionName: 'nav-pill' }} aria-hidden />
      )}
      <Icon className="relative size-4 shrink-0" strokeWidth={active ? 2 : 1.75} />
      <span className="relative flex min-w-0 flex-1 items-center">
        <Label show={expanded}>{item.label}</Label>
      </span>
    </Link>
  );
  return expanded ? link : (
    <Tooltip content={item.label} kbd={shortcutKeys(item.shortcut)} side="right">
      {link}
    </Tooltip>
  );
}

export function Rail({ expanded, overlay, onToggle, onNavigate }: RailProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = activeNav(pathname);
  const [hover, setHover] = useState<string | null>(null);
  const sync = useSyncStatus();
  const mag1 = useMagnetic();
  const mag2 = useMagnetic();
  const width = expanded ? RAIL_EXPANDED : RAIL_COLLAPSED;

  return (
    <motion.aside
      initial={false}
      animate={{ width }}
      transition={spring.smooth}
      aria-label="Primary"
      className={cn(
        'fixed inset-y-0 left-0 z-(--z-rail) flex flex-col overflow-hidden border-r border-line-1 px-3 pt-3 pb-3',
        overlay ? 'glass border-line-2' : 'bg-canvas',
      )}
    >
      {/* Wordmark + collapse */}
      <div className="group/top flex h-9 items-center justify-between pl-2.5">
        <AnimatePresence initial={false} mode="popLayout">
          {expanded ? (
            <motion.div key="wm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: tween('fast', 'in') }}>
              <Link to="/" className="rounded-sm text-[0.9375rem] font-[600] tracking-[-0.02em] text-fg-1 outline-none focus-visible:outline-2 focus-visible:outline-focus">
                cadence
              </Link>
            </motion.div>
          ) : null}
        </AnimatePresence>
        <IconButton
          label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
          kbd="["
          tooltipSide="right"
          size="sm"
          icon={expanded ? <PanelLeftClose /> : <PanelLeft />}
          onClick={onToggle}
          className={cn(!expanded && '-ml-[3px]', expanded && 'opacity-0 group-hover/top:opacity-100 focus-visible:opacity-100')}
        />
      </div>

      {/* Search + New workout */}
      <div className="mt-4 flex flex-col gap-2">
        <Tooltip content="Search" kbd="mod+k" side="right" disabled={expanded}>
          <motion.button
            type="button"
            onClick={() => palette.open()}
            style={{ x: mag1.x, y: mag1.y }}
            onPointerMove={mag1.onPointerMove}
            onPointerLeave={mag1.onPointerLeave}
            whileTap={{ scale: 0.97 }}
            transition={spring.snappy}
            aria-label="Search (⌘K)"
            className="flex h-9 items-center gap-3 rounded-md border border-line-2 bg-surface-1 px-[11px] text-body text-fg-3 transition-colors duration-(--dur-fast) hover:border-line-3 hover:text-fg-2"
          >
            <Search className="size-4 shrink-0" />
            <Label show={expanded}>
              <span className="flex items-center justify-between">
                Search
                <Kbd keys="mod+k" />
              </span>
            </Label>
          </motion.button>
        </Tooltip>
        <Tooltip content="New workout" kbd="n" side="right" disabled={expanded}>
          <motion.span style={{ x: mag2.x, y: mag2.y }} onPointerMove={mag2.onPointerMove} onPointerLeave={mag2.onPointerLeave} className="block">
            <Link
              to="/workouts/new"
              onClick={onNavigate}
              aria-label="New workout"
              className="flex h-9 items-center gap-3 rounded-md bg-accent px-[11px] text-label font-[560] text-on-accent outline-none transition-colors duration-(--dur-fast) hover:bg-accent-hover active:bg-accent-press focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <Plus className="size-4 shrink-0" strokeWidth={2.25} />
              <Label show={expanded}>
                <span className="flex items-center justify-between">
                  New workout
                  <Kbd keys="n" tone="subtle" />
                </span>
              </Label>
            </Link>
          </motion.span>
        </Tooltip>
      </div>

      {/* Primary nav */}
      <LayoutGroup id="rail-nav">
        <nav className="mt-5 flex flex-col gap-0.5" onPointerLeave={() => setHover(null)}>
          {NAV.map((it) => (
            <RailLink key={it.to} item={it} active={active === it} expanded={expanded} hovered={hover === it.to} onHover={setHover} onNavigate={onNavigate} />
          ))}
        </nav>

        <div className="flex-1" />

        {/* Bottom: sync + settings */}
        <div className="flex flex-col gap-0.5" onPointerLeave={() => setHover(null)}>
          <Tooltip content={syncLabel(sync)} side="right" disabled={expanded}>
            <Link
              to="/settings/sync"
              onClick={onNavigate}
              aria-label={syncLabel(sync)}
              className="flex h-8 items-center gap-3 rounded-md px-[15px] text-body-sm text-fg-3 outline-none transition-colors hover:text-fg-1 focus-visible:outline-2 focus-visible:outline-focus"
            >
              <SyncDot state={sync.state} />
              <Label show={expanded}>{syncLabel(sync)}</Label>
            </Link>
          </Tooltip>
          <RailLink item={SETTINGS_NAV} active={active === SETTINGS_NAV} expanded={expanded} hovered={hover === SETTINGS_NAV.to} onHover={setHover} onNavigate={onNavigate} />
        </div>
      </LayoutGroup>
    </motion.aside>
  );
}
