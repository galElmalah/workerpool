/**
 * Menu / ContextMenu — data-driven, glass popup, radius lg, items h-8 with icon + label + kbd.
 * Destructive items are monochrome (TriangleAlert + fg-1) and execute immediately — the caller
 * shows an undo toast. Submenus for "Set intensity ▸" style choices.
 *
 *   <Menu trigger={<IconButton label="More" icon={<Ellipsis/>} />} items={[
 *     { label: 'Duplicate', icon: <Copy/>, kbd: 'mod+d', onSelect: dup },
 *     { type: 'separator' },
 *     { label: 'Delete', icon: <Trash2/>, destructive: true, onSelect: del },
 *   ]} />
 *   <ContextMenu items={…}><WorkoutCard … /></ContextMenu>
 */
import { ContextMenu as BaseContextMenu } from '@base-ui/react/context-menu';
import { Menu as BaseMenu } from '@base-ui/react/menu';
import { Check, ChevronRight } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Kbd } from './Kbd';

export type MenuEntry =
  | {
      type?: 'item';
      label: ReactNode;
      icon?: ReactNode;
      kbd?: string;
      onSelect: () => void;
      destructive?: boolean;
      disabled?: boolean;
      checked?: boolean;
    }
  | { type: 'separator' }
  | { type: 'label'; label: ReactNode }
  | { type: 'submenu'; label: ReactNode; icon?: ReactNode; items: MenuEntry[] };

const itemCls =
  'flex h-8 cursor-default select-none items-center gap-2 rounded-sm px-2 text-body text-fg-1 outline-none ' +
  'transition-colors duration-(--dur-fast) data-[highlighted]:bg-surface-3 data-[disabled]:opacity-40 ' +
  'data-[popup-open]:bg-surface-3 [&_svg]:size-4 [&_svg]:shrink-0';
const popupCls = 'ui-popup min-w-48 max-w-80 rounded-lg p-1';

type Parts = typeof BaseMenu | typeof BaseContextMenu;

function Entries({ items, P }: { items: MenuEntry[]; P: Parts }) {
  return (
    <>
      {items.map((it, i) => {
        if (it.type === 'separator') return <P.Separator key={i} className="mx-1 my-1 h-px bg-line-1" />;
        if (it.type === 'label')
          return (
            <div key={i} className="px-2 pt-2 pb-1 text-micro uppercase text-fg-3">
              {it.label}
            </div>
          );
        if (it.type === 'submenu')
          return (
            <P.SubmenuRoot key={i}>
              <P.SubmenuTrigger className={itemCls}>
                <span className="flex text-fg-2">{it.icon}</span>
                <span className="flex-1 truncate">{it.label}</span>
                <ChevronRight className="!size-3.5 text-fg-3" />
              </P.SubmenuTrigger>
              <P.Portal>
                <P.Positioner sideOffset={4} alignOffset={-4} className="z-(--z-popover)">
                  <P.Popup className={popupCls}>
                    <Entries items={it.items} P={P} />
                  </P.Popup>
                </P.Positioner>
              </P.Portal>
            </P.SubmenuRoot>
          );
        return (
          <P.Item key={i} onClick={it.onSelect} disabled={it.disabled} className={itemCls}>
            <span className={cn('flex', it.destructive ? 'text-fg-1' : 'text-fg-2')}>{it.icon}</span>
            <span className="flex-1 truncate">{it.label}</span>
            {it.checked && <Check className="!size-3.5 text-fg-1" />}
            {it.kbd && <Kbd keys={it.kbd} className="ml-4" />}
          </P.Item>
        );
      })}
    </>
  );
}

export interface MenuProps {
  trigger: ReactElement;
  items: MenuEntry[];
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
}

export function Menu({ trigger, items, side = 'bottom', align = 'end' }: MenuProps) {
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner side={side} align={align} sideOffset={6} collisionPadding={12} className="z-(--z-popover)">
          <BaseMenu.Popup className={popupCls}>
            <Entries items={items} P={BaseMenu} />
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}

/** Right-click / long-press menu around any element. */
export function ContextMenu({ items, children, className }: { items: MenuEntry[]; children: ReactNode; className?: string }) {
  return (
    <BaseContextMenu.Root>
      <BaseContextMenu.Trigger className={className}>{children}</BaseContextMenu.Trigger>
      <BaseContextMenu.Portal>
        <BaseContextMenu.Positioner className="z-(--z-popover)">
          <BaseContextMenu.Popup className={popupCls}>
            <Entries items={items} P={BaseContextMenu} />
          </BaseContextMenu.Popup>
        </BaseContextMenu.Positioner>
      </BaseContextMenu.Portal>
    </BaseContextMenu.Root>
  );
}
