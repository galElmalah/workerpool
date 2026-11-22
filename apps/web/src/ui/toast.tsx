/**
 * Toasts — design.md §5.4i + product.md §8.3. Destructive actions execute immediately and show an
 * Undo toast; there are NO confirm dialogs. Callable from anywhere (global Base UI toast manager).
 *
 *   toast('Synced 3 activities');
 *   toast.success('Pushed to Garmin');
 *   toast.error("Couldn't save", { description: 'Retrying…' });
 *   toast.undo(<>Moved <b>Threshold 4×8</b> to Thu 19</>, () => revert());   // 10 s, ⌘Z works too
 *   toast.promise(save(), { loading: 'Saving…', success: 'Saved', error: (e) => `Couldn't save: ${e}` });
 *
 * <Toaster/> is mounted once by main.tsx. Max 3 visible; glass, line-2 hairline, radius lg; a quiet
 * neutral countdown (inset 2px track under the content, paused on hover — never an accent edge);
 * enters translateY(16px) scale(.98) with the smooth spring. Success/error are told apart by icon.
 */
import { Toast } from '@base-ui/react/toast';
import { Check, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export const toastManager = Toast.createToastManager();

type Kind = 'default' | 'success' | 'error' | 'loading' | 'undo';
interface ToastData {
  kind: Kind;
  timeout: number;
}
interface Opts {
  description?: ReactNode;
  /** ms; 0 = sticky. */
  timeout?: number;
  action?: { label: string; onClick: () => void };
  id?: string;
}

const DEFAULT_TIMEOUT = 6000;
const UNDO_TIMEOUT = 10000;

/** Undo stack: the latest visible undo toast is what ⌘Z triggers (wired by the shell). */
const undoStack: { id: string; run: () => void }[] = [];

function add(kind: Kind, title: ReactNode, o: Opts = {}): string {
  const timeout = o.timeout ?? (kind === 'undo' ? UNDO_TIMEOUT : kind === 'loading' ? 0 : DEFAULT_TIMEOUT);
  return toastManager.add({
    id: o.id,
    title,
    description: o.description,
    timeout,
    type: kind,
    priority: kind === 'error' ? 'high' : 'low',
    data: { kind, timeout } satisfies ToastData,
    actionProps: o.action ? { children: o.action.label, onClick: o.action.onClick } : undefined,
  });
}

function undo(title: ReactNode, onUndo: () => void, o: Omit<Opts, 'action'> = {}): string {
  let done = false;
  const id: string = add('undo', title, {
    ...o,
    action: {
      label: 'Undo',
      onClick: () => run(),
    },
  });
  const run = () => {
    if (done) return;
    done = true;
    const i = undoStack.findIndex((u) => u.id === id);
    if (i >= 0) undoStack.splice(i, 1);
    onUndo();
    toastManager.close(id);
  };
  undoStack.push({ id, run });
  // Drop from the stack when the toast times out.
  setTimeout(() => {
    const i = undoStack.findIndex((u) => u.id === id);
    if (i >= 0) undoStack.splice(i, 1);
  }, (o.timeout ?? UNDO_TIMEOUT) + 500);
  return id;
}

/** Runs the most recent pending undo (⌘Z). Returns false when there is nothing to undo. */
export function runLatestUndo(): boolean {
  const u = undoStack.at(-1);
  if (!u) return false;
  u.run();
  return true;
}

type PromiseMsg<T> = ReactNode | ((v: T) => ReactNode);
function promise<T>(p: Promise<T>, m: { loading: ReactNode; success: PromiseMsg<T>; error: PromiseMsg<unknown> }): Promise<T> {
  const call = <V,>(x: PromiseMsg<V>, v: V) => (typeof x === 'function' ? (x as (v: V) => ReactNode)(v) : x);
  return toastManager.promise(p, {
    loading: { title: m.loading, type: 'loading', timeout: 0, data: { kind: 'loading', timeout: 0 } as ToastData },
    success: (v: T) => ({ title: call(m.success, v), type: 'success', timeout: DEFAULT_TIMEOUT, data: { kind: 'success', timeout: DEFAULT_TIMEOUT } as ToastData }),
    error: (e: unknown) => ({ title: call(m.error, e), type: 'error', timeout: DEFAULT_TIMEOUT, priority: 'high', data: { kind: 'error', timeout: DEFAULT_TIMEOUT } as ToastData }),
  });
}

export const toast = Object.assign((title: ReactNode, o?: Opts) => add('default', title, o), {
  success: (title: ReactNode, o?: Opts) => add('success', title, o),
  error: (title: ReactNode, o?: Opts) => add('error', title, o),
  loading: (title: ReactNode, o?: Opts) => add('loading', title, o),
  undo,
  promise,
  update: (id: string, title: ReactNode, o?: Opts & { kind?: Kind }) =>
    toastManager.update(id, { title, description: o?.description, type: o?.kind, timeout: o?.timeout, data: o?.kind ? { kind: o.kind, timeout: o.timeout ?? DEFAULT_TIMEOUT } : undefined }),
  dismiss: (id?: string) => toastManager.close(id),
});

function KindIcon({ kind }: { kind: Kind }) {
  if (kind === 'success') return <Check className="size-4 shrink-0 text-fg-1" strokeWidth={2.25} aria-hidden />;
  if (kind === 'error') return <TriangleAlert className="size-4 shrink-0 text-fg-1" aria-hidden />;
  if (kind === 'loading')
    return (
      <span className="flex w-4 shrink-0 items-center justify-center gap-0.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-1 rounded-full bg-fg-2 animate-dot-pulse" style={{ animationDelay: `${i * 160}ms` }} />
        ))}
      </span>
    );
  return null;
}

function ToastList() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((t) => {
    const data = (t.data ?? { kind: 'default', timeout: DEFAULT_TIMEOUT }) as ToastData;
    return (
      <Toast.Root
        key={t.id}
        toast={t}
        swipeDirection={['down', 'left']}
        className={cn(
          'ui-toast glass overflow-hidden rounded-lg border border-line-2',
        )}
        style={{ ['--toast-timeout' as string]: `${data.timeout}ms` }}
      >
        <Toast.Content className="ui-toast-content flex min-h-12 items-center gap-3 py-2.5 pr-2 pl-4">
          <KindIcon kind={data.kind} />
          <div className="flex min-w-0 flex-1 flex-col">
            <Toast.Title className="text-body text-fg-1 [&_b]:font-semibold [&_strong]:font-semibold" />
            <Toast.Description className="text-body-sm text-fg-2 empty:hidden" />
          </div>
          <Toast.Action className="h-8 shrink-0 rounded-md bg-surface-3 px-3 text-label font-semibold text-fg-1 transition-colors duration-(--dur-fast) hover:bg-surface-active empty:hidden" />
          {data.kind !== 'loading' && (
            <Toast.Close aria-label="Dismiss" className="flex size-7 shrink-0 items-center justify-center rounded-md text-fg-3 transition-colors hover:bg-surface-3 hover:text-fg-1">
              <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" aria-hidden>
                <path d="M3 3l6 6M9 3l-6 6" />
              </svg>
            </Toast.Close>
          )}
        </Toast.Content>
        {data.timeout > 0 && (
          <span key={t.updateKey} className="ui-toast-countdown absolute inset-x-4 bottom-1.5 h-0.5 rounded-full bg-line-2" aria-hidden />
        )}
      </Toast.Root>
    );
  });
}

/** Mount once near the root. */
export function Toaster({ children }: { children?: ReactNode }) {
  return (
    <Toast.Provider toastManager={toastManager} limit={3}>
      {children}
      <Toast.Portal>
        <Toast.Viewport
          className={cn(
            'fixed z-(--z-toast) outline-none',
            'bottom-[calc(var(--bottom-bar-h)+env(safe-area-inset-bottom)+0.75rem)] left-4 right-4',
            'md:right-auto md:bottom-6 md:left-[calc(var(--rail-w)+1.5rem)] md:w-[24rem]',
          )}
        >
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}
