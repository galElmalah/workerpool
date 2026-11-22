/**
 * CommandPalette — THE one overlay (design.md §5.4j, product.md §8.1). Glass, radius 28, max-w 640,
 * 14vh from the top; scrim fades; popup enters with scale .96 + blur(4px) via Base UI data
 * attributes. The highlighted row is a Motion `layoutId="cmdk-hl"` pill that glides between rows.
 * Opens with ⌘K / Ctrl+K and `/` (shell shortcuts). Before typing it shows Recent + all static
 * commands; typing fuzzy-filters static commands and runs async sources (debounced, abortable).
 */
import { Dialog } from '@base-ui/react/dialog';
import { CornerDownLeft, Search } from 'lucide-react';
import { LayoutGroup, motion } from 'motion/react';
import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { spring } from '@/motion/tokens';
import { Kbd } from '../Kbd';
import {
  getPaletteSources,
  getRecentIds,
  palette,
  pushRecent,
  scoreCommand,
  usePaletteOpen,
  usePaletteVersion,
  type PaletteCommand,
} from './registry';

const GROUP_ORDER = ['Recent', 'Navigate', 'Create', 'Actions'];

function useAsyncResults(query: string, open: boolean, version: number) {
  const [results, setResults] = useState<Record<string, PaletteCommand[]>>({});
  const [pending, setPending] = useState<string[]>([]);
  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    const srcs = getPaletteSources().filter((s) => s.search && query.trim().length >= (s.minQuery ?? 1));
    if (!srcs.length) {
      setResults({});
      setPending([]);
      return;
    }
    setPending(srcs.map((s) => s.id));
    const t = setTimeout(() => {
      srcs.forEach(async (s) => {
        try {
          const r = await s.search!(query.trim(), ctrl.signal);
          if (ctrl.signal.aborted) return;
          setResults((prev) => ({ ...prev, [s.id]: r.map((c) => ({ ...c, group: c.group || s.group || 'Results' })) }));
        } catch {
          /* aborted or failed: drop silently */
        } finally {
          if (!ctrl.signal.aborted) setPending((p) => p.filter((x) => x !== s.id));
        }
      });
    }, 120);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [query, open, version]);
  return { results, pending };
}

export function CommandPalette() {
  const open = usePaletteOpen();
  const version = usePaletteVersion();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const keyboardNav = useRef(false);

  useEffect(() => {
    if (open) {
      setQuery(palette.initialQuery);
      setActive(0);
    }
  }, [open]);

  const { results: asyncResults, pending } = useAsyncResults(query, open, version);

  const groups = useMemo(() => {
    const statics: PaletteCommand[] = [];
    for (const s of getPaletteSources()) {
      const list = typeof s.commands === 'function' ? s.commands() : (s.commands ?? []);
      for (const c of list) statics.push({ ...c, group: c.group || s.group || 'Actions' });
    }
    const q = query.trim();
    let items: PaletteCommand[];
    if (!q) {
      const byId = new Map(statics.map((c) => [c.id, c]));
      const recent = getRecentIds()
        .map((id) => byId.get(id))
        .filter((c): c is PaletteCommand => !!c)
        .slice(0, 4)
        .map((c) => ({ ...c, group: 'Recent' }));
      const recentIds = new Set(recent.map((c) => c.id));
      items = [...recent, ...statics.filter((c) => !recentIds.has(c.id))];
    } else {
      items = statics
        .map((c) => ({ c, s: scoreCommand(q, c) + (c.priority ?? 0) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .map((x) => x.c)
        .slice(0, 30);
      for (const list of Object.values(asyncResults)) items.push(...list);
    }
    const map = new Map<string, PaletteCommand[]>();
    for (const c of items) {
      const g = map.get(c.group) ?? [];
      g.push(c);
      map.set(c.group, g);
    }
    const order = (g: string) => {
      const i = GROUP_ORDER.indexOf(g);
      return i < 0 ? GROUP_ORDER.length : i;
    };
    // With a query, keep the best match's group first.
    const entries = [...map.entries()];
    if (!q) entries.sort((a, b) => order(a[0]) - order(b[0]));
    return entries;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, asyncResults, version, open]);

  const flat = useMemo(() => groups.flatMap(([, cs]) => cs), [groups]);
  const activeCmd = flat[Math.min(active, flat.length - 1)];

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    if (!keyboardNav.current || !activeCmd) return;
    listRef.current?.querySelector(`[data-cmd="${CSS.escape(activeCmd.id)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeCmd]);

  const run = async (c: PaletteCommand) => {
    pushRecent(c.id);
    if (!c.keepOpen) palette.close();
    await c.perform();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault();
      keyboardNav.current = true;
      setActive((i) => (flat.length ? (i + 1) % flat.length : 0));
    } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault();
      keyboardNav.current = true;
      setActive((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0));
    } else if (e.key === 'Enter' && activeCmd) {
      e.preventDefault();
      void run(activeCmd);
    } else if (e.key === 'Home' && e.ctrlKey) {
      setActive(0);
    }
  };

  let index = -1;
  return (
    <Dialog.Root open={open} onOpenChange={(o) => (o ? palette.open() : palette.close())}>
      <Dialog.Portal>
        <Dialog.Backdrop className="ui-palette-backdrop fixed inset-0 z-(--z-palette)" />
        <Dialog.Viewport className="fixed inset-0 z-(--z-palette) flex items-start justify-center px-3 pt-[10vh] md:pt-[14vh]">
          <Dialog.Popup
            initialFocus={inputRef}
            aria-label="Command palette"
            className="ui-palette glass flex max-h-[min(36rem,calc(100dvh-6rem))] w-full max-w-palette flex-col overflow-hidden rounded-2xl border border-line-3 inset-shadow-hairline outline-none"
          >
            <div className="flex items-center gap-3 border-b border-line-1 px-5">
              <Search className="size-[18px] shrink-0 text-fg-3" aria-hidden />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.currentTarget.value)}
                onKeyDown={onKeyDown}
                role="combobox"
                aria-expanded
                aria-controls={listId}
                aria-activedescendant={activeCmd ? `${listId}-${activeCmd.id}` : undefined}
                aria-autocomplete="list"
                placeholder="Search or jump to…"
                spellCheck={false}
                autoComplete="off"
                className="h-14 min-w-0 flex-1 bg-transparent text-body-lg text-fg-1 outline-none placeholder:text-fg-4"
              />
              {pending.length > 0 && (
                <span className="flex gap-0.5" aria-label="Searching">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="size-1 rounded-full bg-fg-3 animate-dot-pulse" style={{ animationDelay: `${i * 160}ms` }} />
                  ))}
                </span>
              )}
              <Kbd>esc</Kbd>
            </div>
            <div
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label="Results"
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 [scroll-padding-block:8px]"
              onPointerMove={() => (keyboardNav.current = false)}
            >
              {flat.length === 0 ? (
                <div className="flex flex-col items-center gap-1 px-4 py-12 text-center">
                  <span className="text-body text-fg-2">{pending.length ? 'Searching…' : `No results for “${query}”`}</span>
                  <span className="text-body-sm text-fg-3">Try a page name, a date like “dec 24”, or “new run”.</span>
                </div>
              ) : (
                <LayoutGroup id="cmdk">
                  {groups.map(([group, cmds]) => (
                    <Fragment key={group}>
                      <div role="presentation" className="px-3 pt-3 pb-1.5 text-micro text-fg-3 first:pt-1">
                        {group}
                      </div>
                      {cmds.map((c) => {
                        index++;
                        const i = index;
                        const on = activeCmd?.id === c.id && flat[i] === activeCmd;
                        return (
                          <div
                            key={`${group}-${c.id}`}
                            id={`${listId}-${c.id}`}
                            data-cmd={c.id}
                            role="option"
                            aria-selected={on}
                            onPointerEnter={() => !keyboardNav.current && setActive(i)}
                            onPointerMove={() => active !== i && setActive(i)}
                            onClick={() => void run(c)}
                            className={cn(
                              'relative flex h-10 cursor-default select-none items-center gap-3 rounded-md px-3 text-body transition-colors duration-(--dur-fast)',
                              on ? 'text-fg-1' : 'text-fg-2',
                            )}
                          >
                            {on && (
                              <motion.span
                                layoutId="cmdk-hl"
                                transition={spring.snappy}
                                className="absolute inset-0 -z-0 rounded-md bg-surface-3 light:bg-surface-active"
                                aria-hidden
                              />
                            )}
                            <span className={cn('relative flex size-4 shrink-0 items-center justify-center [&_svg]:size-4', on ? 'text-fg-1' : 'text-fg-3')}>{c.icon}</span>
                            <span className="relative min-w-0 flex-1 truncate">
                              {c.title}
                              {c.subtitle && <span className="ml-2 text-body-sm text-fg-3">{c.subtitle}</span>}
                            </span>
                            {c.kbd && <Kbd keys={c.kbd} className="relative" />}
                            {on && !c.kbd && <CornerDownLeft className="relative size-3.5 text-fg-3" aria-hidden />}
                          </div>
                        );
                      })}
                    </Fragment>
                  ))}
                </LayoutGroup>
              )}
            </div>
            <div className="flex items-center gap-4 border-t border-line-1 px-5 py-2.5 text-body-sm text-fg-3 max-md:hidden">
              <span className="inline-flex items-center gap-1.5">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> navigate
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Kbd>↵</Kbd> open
              </span>
              <span className="ml-auto inline-flex items-center gap-1.5">
                <Kbd keys="?" /> shortcuts
              </span>
            </div>
            <Dialog.Close className="sr-only">Close</Dialog.Close>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
