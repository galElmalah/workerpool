/**
 * App chrome: rail (desktop/tablet) or glass bottom bar (mobile), the `main` view-transition
 * surface, global shortcuts, palette wiring and focus management after navigation.
 */
import { useGarminStatusSync, useSettings, useSettingsSync } from '@/lib/queries/shared';
import { Outlet, useRouter, useRouterState, type ErrorComponentProps } from '@tanstack/react-router';
import { ArrowLeft, Compass, RotateCcw } from 'lucide-react';
import { motion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useIsMobile, useIsWide } from '@/lib/hooks/useMediaQuery';
import { useLocalStorage } from '@/lib/hooks/useLocalStorage';
import { morph } from '@/motion/morph';
import { spring } from '@/motion/tokens';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Page, PageHeader } from '@/ui/PageHeader';
import { CommandPalette } from '@/ui/palette/CommandPalette';
import { palette } from '@/ui/palette/registry';
import { runLatestUndo, toast } from '@/ui/toast';
import { installDefaultCommands } from './commands';
import { MobileBar } from './MobileBar';
import { Rail, RAIL_COLLAPSED, RAIL_EXPANDED } from './Rail';
import { useShortcut } from './shortcuts';
import { syncAccentFromServer, toggleTheme } from './theme';

/** Shared rail toggle so the palette, `[` and the button agree. */
let railToggle: () => void = () => {};

/** Root: palette + focus management for every layout. */
export function RootLayout() {
  const router = useRouter();

  useEffect(() => {
    installDefaultCommands(router, { toggleRail: () => railToggle() });
    return router.subscribe('onResolved', (evt) => {
      if (!evt.fromLocation || !evt.pathChanged) return;
      const fi = (evt.fromLocation.state as { __TSR_index?: number }).__TSR_index;
      const ti = (evt.toLocation.state as { __TSR_index?: number }).__TSR_index;
      const back = fi !== undefined && ti !== undefined && ti < fi;
      requestAnimationFrame(() => {
        const origin = back && morph.target ? document.querySelector<HTMLElement>(`[data-morph-id="${CSS.escape(morph.target)}"]`) : null;
        const target = origin ?? document.querySelector<HTMLElement>('main [data-page-title]') ?? document.querySelector<HTMLElement>('main');
        if (target && !target.contains(document.activeElement)) {
          if (!target.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT)$/.test(target.tagName)) target.setAttribute('tabindex', '-1');
          target.focus({ preventScroll: true });
        }
      });
    });
  }, [router]);

  useShortcut('palette.open', () => palette.toggle(), { allowInInputs: true });
  useShortcut('palette.search', () => palette.open());

  return (
    <>
      <Outlet />
      <CommandPalette />
    </>
  );
}

export function AppShell() {
  const router = useRouter();
  useSettingsSync();
  useGarminStatusSync();
  // The account's accent (Settings.accent) wins over this device's cached copy once settings load.
  const serverAccent = useSettings().data?.accent;
  useEffect(() => syncAccentFromServer(serverAccent), [serverAccent]);
  const mobile = useIsMobile();
  const wide = useIsWide();
  const [pref, setPref] = useLocalStorage<'expanded' | 'collapsed'>('cadence.rail', 'expanded');
  const [overlayOpen, setOverlayOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const expandedInline = wide && pref === 'expanded';
  const railW = mobile ? 0 : expandedInline ? RAIL_EXPANDED : RAIL_COLLAPSED;
  const labels = expandedInline || (!wide && overlayOpen);

  const toggle = useCallback(() => {
    if (wide) setPref((p) => (p === 'expanded' ? 'collapsed' : 'expanded'));
    else setOverlayOpen((o) => !o);
  }, [wide, setPref]);
  railToggle = toggle;

  useLayoutEffect(() => {
    const root = document.documentElement.style;
    root.setProperty('--rail-w', `${railW}px`);
    root.setProperty('--bottom-bar-h', mobile ? '64px' : '0px');
  }, [railW, mobile]);

  useEffect(() => setOverlayOpen(false), [pathname, wide]);

  useShortcut('rail.toggle', toggle);
  useShortcut('nav.today', () => void router.navigate({ to: '/today' }));
  useShortcut('nav.calendar', () => void router.navigate({ to: '/calendar' }));
  useShortcut('nav.trends', () => void router.navigate({ to: '/trends' }));
  useShortcut('nav.activities', () => void router.navigate({ to: '/activities' }));
  useShortcut('nav.library', () => void router.navigate({ to: '/library' }));
  useShortcut('nav.journal', () => void router.navigate({ to: '/journal' }));
  useShortcut('nav.settings', () => void router.navigate({ to: '/settings/profile' }));
  useShortcut('workout.new', () => void router.navigate({ to: '/workouts/new' }));
  useShortcut('shortcuts.open', () => void router.navigate({ to: '/settings/shortcuts' }));
  useShortcut('theme.toggle', toggleTheme);
  useShortcut('undo', () => {
    if (!runLatestUndo()) toast('Nothing to undo');
  });

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-(--z-palette) focus:rounded-md focus:bg-surface-3 focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      {!mobile && <Rail expanded={labels} overlay={!wide && overlayOpen} onToggle={toggle} onNavigate={() => setOverlayOpen(false)} />}
      {!mobile && !wide && overlayOpen && (
        <div className="fixed inset-0 z-[19]" onPointerDown={() => setOverlayOpen(false)} aria-hidden />
      )}
      {/* overflow-x: clip (not hidden) keeps sticky headers working while making sure nothing inside
          a page can ever scroll the body sideways (DESIGN_V2 §9); min-w-0 lets content shrink. */}
      <motion.div layout="position" layoutDependency={railW} transition={spring.smooth} style={{ marginLeft: railW }} className="relative min-w-0 overflow-x-clip">
        <main id="main" data-vt-main className="min-h-dvh min-w-0 outline-none">
          <Outlet />
        </main>
      </motion.div>
      {mobile && <MobileBar />}
    </div>
  );
}

/** Welcome / login: no chrome, centered column. */
export function BareShell() {
  return (
    <main id="main" data-vt-main className="flex min-h-dvh flex-col">
      <Outlet />
    </main>
  );
}

export function NotFound() {
  const router = useRouter();
  return (
    <Page header={<PageHeader title="Not found" back />}>
      <EmptyState
        icon={<Compass />}
        title="This page doesn't exist"
        action={
          <Button icon={<ArrowLeft />} onClick={() => void router.navigate({ to: '/' })}>
            Back to Cadence
          </Button>
        }
      >
        The link may be old, or the item was deleted. Press ⌘K to jump anywhere.
      </EmptyState>
    </Page>
  );
}

export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <Page header={<PageHeader title="Something broke" back />}>
      <Banner
        tone="error"
        title="This page hit an error"
        action={
          <Button
            size="sm"
            icon={<RotateCcw />}
            onClick={() => {
              reset();
              void router.invalidate();
            }}
          >
            Retry
          </Button>
        }
      >
        {error instanceof Error ? error.message : String(error)}
      </Banner>
    </Page>
  );
}
