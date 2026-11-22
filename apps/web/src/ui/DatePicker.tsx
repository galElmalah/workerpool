/**
 * DatePicker — a popover with a small month grid (Mon-first). Today = accent circle with on-accent
 * numeral; selected = fg-1 fill. Arrow keys move by day/week, PageUp/PageDown by month, Enter picks.
 * Months slide with the page-next/prev direction (smooth). Value is a LocalDate string.
 *
 *   <DatePicker label="Date" value={date} onValueChange={setDate} />
 *   <MonthGrid value={d} onSelect={…} />   // the bare grid (for inline use)
 */
import { addDays, isoWeekday, weekStart } from '@cadence/core/time';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { formatDateMedium, formatMonthYearLong } from '@/lib/format';
import { localToday } from '@/lib/hooks/useToday';
import { spring, tween } from '@/motion/tokens';
import { Field, controlStyles } from './Field';
import { Popover } from './Popover';

const monthOf = (d: string) => d.slice(0, 7);
const addMonths = (ym: string, n: number) => {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, '0')}`;
};
const daysInMonth = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
const clampDay = (ym: string, day: number) => `${ym}-${String(Math.min(day, daysInMonth(ym))).padStart(2, '0')}`;

export interface MonthGridProps {
  value: string | null;
  onSelect: (date: string) => void;
  today?: string;
  /** Dates outside [min, max] are disabled. */
  min?: string;
  max?: string;
  className?: string;
}

export function MonthGrid({ value, onSelect, today = localToday(), min, max, className }: MonthGridProps) {
  const [month, setMonth] = useState(monthOf(value ?? today));
  const [focus, setFocus] = useState(value ?? today);
  const [dir, setDir] = useState(0);
  const gridRef = useRef<HTMLDivElement>(null);
  const keyNav = useRef(false);

  const go = (n: number) => {
    setDir(n);
    setMonth((m) => addMonths(m, n));
    setFocus((f) => clampDay(addMonths(monthOf(f), n), Number(f.slice(8, 10))));
  };

  useEffect(() => {
    if (!keyNav.current) return;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${focus}"]`)?.focus();
  }, [focus, month]);

  const first = `${month}-01`;
  const start = weekStart(first);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const rows = cells[35]!.slice(0, 7) === month ? 6 : 5;
  const disabled = (d: string) => (min != null && d < min) || (max != null && d > max);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let next: string | null = null;
    if (e.key in step) next = addDays(focus, step[e.key]!);
    else if (e.key === 'PageUp') next = clampDay(addMonths(monthOf(focus), e.shiftKey ? -12 : -1), Number(focus.slice(8, 10)));
    else if (e.key === 'PageDown') next = clampDay(addMonths(monthOf(focus), e.shiftKey ? 12 : 1), Number(focus.slice(8, 10)));
    else if (e.key === 'Home') next = addDays(focus, 1 - isoWeekday(focus));
    else if (e.key === 'End') next = addDays(focus, 7 - isoWeekday(focus));
    if (!next) return;
    e.preventDefault();
    keyNav.current = true;
    if (monthOf(next) !== month) {
      setDir(next > focus ? 1 : -1);
      setMonth(monthOf(next));
    }
    setFocus(next);
  };

  return (
    <div className={cn('w-[17.5rem] select-none', className)}>
      <div className="flex items-center justify-between px-1 pb-2">
        <span className="text-body font-[560] text-fg-1">{formatMonthYearLong(month)}</span>
        <div className="flex gap-0.5">
          <button type="button" aria-label="Previous month" onClick={() => go(-1)} className="flex size-7 items-center justify-center rounded-md text-fg-2 hover:bg-surface-3 hover:text-fg-1">
            <ChevronLeft className="size-4" />
          </button>
          <button type="button" aria-label="Next month" onClick={() => go(1)} className="flex size-7 items-center justify-center rounded-md text-fg-2 hover:bg-surface-3 hover:text-fg-1">
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 pb-1 text-center text-mono-sm text-fg-3" aria-hidden>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={i} className="h-6 leading-6">
            {d}
          </span>
        ))}
      </div>
      <div className="relative overflow-hidden" style={{ height: rows * 36 }}>
        <AnimatePresence initial={false} custom={dir} mode="popLayout">
          <motion.div
            key={month}
            ref={gridRef}
            role="grid"
            aria-label={formatMonthYearLong(month)}
            custom={dir}
            variants={{
              enter: (d: number) => ({ opacity: 0, y: d * 24 }),
              center: { opacity: 1, y: 0 },
              exit: (d: number) => ({ opacity: 0, y: d * -24, transition: tween('fast', 'in') }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={spring.smooth}
            className="grid grid-cols-7 gap-y-0.5"
            onKeyDown={onKeyDown}
          >
            {cells.slice(0, rows * 7).map((d) => {
              const inMonth = monthOf(d) === month;
              const isSel = d === value;
              const isToday = d === today;
              return (
                <button
                  key={d}
                  type="button"
                  data-date={d}
                  role="gridcell"
                  aria-selected={isSel}
                  aria-current={isToday ? 'date' : undefined}
                  aria-label={formatDateMedium(d, true)}
                  tabIndex={d === focus ? 0 : -1}
                  disabled={disabled(d)}
                  onClick={() => onSelect(d)}
                  onFocus={() => setFocus(d)}
                  className={cn(
                    'mx-auto flex size-[34px] items-center justify-center rounded-full text-mono outline-none transition-colors duration-(--dur-fast)',
                    'focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus disabled:opacity-30',
                    inMonth ? 'text-fg-1' : 'text-fg-4',
                    !isSel && !isToday && 'hover:bg-surface-3',
                    isToday && !isSel && 'bg-accent font-[600] text-on-accent',
                    isSel && 'bg-fg-1 font-[600] text-canvas',
                    isSel && isToday && 'ring-2 ring-accent ring-offset-2 ring-offset-surface-1',
                  )}
                >
                  {Number(d.slice(8, 10))}
                </button>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

export interface DatePickerProps {
  value: string | null;
  onValueChange: (date: string) => void;
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  hideLabel?: boolean;
  placeholder?: string;
  min?: string;
  max?: string;
  className?: string;
  size?: 'sm' | 'md';
}

export function DatePicker({ value, onValueChange, label, hint, error, hideLabel, placeholder = 'Pick a date', min, max, className, size = 'md' }: DatePickerProps) {
  return (
    <Field label={label} hint={hint} error={error} hideLabel={hideLabel} className={className}>
      <Popover
        title="Choose date"
        trigger={
          <button type="button" className={cn(controlStyles(size), 'flex items-center gap-2 text-left data-[popup-open]:border-gray-8')}>
            <CalendarDays className="size-4 shrink-0 text-fg-3" />
            <span className={cn('flex-1 truncate', !value && 'text-fg-4')}>{value ? formatDateMedium(value, true) : placeholder}</span>
          </button>
        }
      >
        {(close) => (
          <MonthGrid
            value={value}
            min={min}
            max={max}
            onSelect={(d) => {
              onValueChange(d);
              close();
            }}
          />
        )}
      </Popover>
    </Field>
  );
}
