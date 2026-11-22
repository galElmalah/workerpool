/** Context-menu entries for a card or an empty day (right-click / long-press). */
import { ArrowUpRight, BookmarkPlus, CalendarArrowDown, CalendarPlus, ClipboardPaste, Copy, Gauge, Star, Trash2, Watch, Ban, Plus, CalendarDays } from 'lucide-react';
import { INTENSITY_CLASSES, INTENSITY_META, type LocalDate } from '@cadence/core/domain';
import { addDays } from '@cadence/core/time';
import { formatDayShort } from '@/lib/format';
import type { CalendarCard } from '@/lib/queries/training';
import type { MenuEntry } from '@/ui/Menu';
import { SKIP_LABELS, type CardActions, type SkipReason } from './actions';
import { calStore } from './store';

export function cardMenu(card: CalendarCard, date: LocalDate, a: CardActions): MenuEntry[] {
  const planned = !!card.workout && !card.activity;
  const w = card.workout;
  const onWatch = w?.garmin.syncState === 'synced' || w?.garmin.syncState === 'pending';
  const items: MenuEntry[] = [{ label: 'Open', icon: <ArrowUpRight />, kbd: 'enter', onSelect: () => a.open(card) }];
  if (planned) {
    items.push(
      { label: 'Duplicate to next day', icon: <Copy />, kbd: 'mod+d', onSelect: () => a.duplicate(card, addDays(date, 1)) },
      { label: 'Copy', icon: <ClipboardPaste />, kbd: 'mod+c', onSelect: () => calStore.set({ clipboard: [card.key] }) },
      {
        type: 'submenu',
        label: 'Move to…',
        icon: <CalendarArrowDown />,
        items: [
          { label: `Next day · ${formatDayShort(addDays(date, 1))}`, onSelect: () => a.move(card, addDays(date, 1)) },
          { label: `Previous day · ${formatDayShort(addDays(date, -1))}`, onSelect: () => a.move(card, addDays(date, -1)) },
          { label: `Next week · ${formatDayShort(addDays(date, 7))}`, onSelect: () => a.move(card, addDays(date, 7)) },
          { label: `Last week · ${formatDayShort(addDays(date, -7))}`, onSelect: () => a.move(card, addDays(date, -7)) },
        ],
      },
    );
  }
  items.push({ type: 'separator' }, { label: card.model.isKey ? 'Unmark key' : 'Mark key', icon: <Star />, kbd: 'k', onSelect: () => a.toggleKey(card), checked: card.model.isKey });
  items.push({
    type: 'submenu',
    label: 'Set intensity',
    icon: <Gauge />,
    items: INTENSITY_CLASSES.map((c) => ({
      label: INTENSITY_META[c].label,
      kbd: c === 'race' ? undefined : String(INTENSITY_META[c].level),
      checked: card.model.intensity === c,
      onSelect: () => a.setIntensity(card, c),
    })),
  });
  if (w && !card.activity) {
    items.push({
      type: 'submenu',
      label: w.status === 'skipped' ? 'Skipped' : 'Skip',
      icon: <Ban />,
      items: [
        ...(w.status === 'skipped' ? [{ label: 'Unskip', onSelect: () => a.skip(card, null) } as MenuEntry, { type: 'separator' } as MenuEntry] : []),
        ...(Object.keys(SKIP_LABELS) as SkipReason[]).map((r) => ({ label: SKIP_LABELS[r], checked: w.skipReason === r, onSelect: () => a.skip(card, r) })),
      ],
    });
    items.push(
      { type: 'separator' },
      { label: onWatch ? 'Remove from watch' : 'Send to watch', icon: <Watch />, onSelect: () => a.garmin(card, !onWatch) },
      { label: 'Save to library', icon: <BookmarkPlus />, onSelect: () => a.saveToLibrary(card) },
      { type: 'separator' },
      { label: 'Delete', icon: <Trash2 />, kbd: 'backspace', destructive: true, onSelect: () => a.remove([card]) },
    );
  }
  return items;
}

export function dayMenu(date: LocalDate, a: CardActions, opts: { paste: CalendarCard[]; openDay: () => void; newWorkout: () => void }): MenuEntry[] {
  const items: MenuEntry[] = [
    { label: 'Quick add here', icon: <Plus />, kbd: 'c', onSelect: () => calStore.set({ composer: date, cursor: date }) },
    { label: 'New workout…', icon: <CalendarPlus />, onSelect: opts.newWorkout },
  ];
  if (opts.paste.length) items.push({ label: `Paste ${opts.paste.length === 1 ? opts.paste[0]!.model.title : `${opts.paste.length} workouts`}`, icon: <ClipboardPaste />, kbd: 'mod+v', onSelect: () => a.paste(opts.paste, date) });
  items.push({ type: 'separator' }, { label: `Open ${formatDayShort(date)}`, icon: <CalendarDays />, kbd: 'd', onSelect: opts.openDay });
  return items;
}
