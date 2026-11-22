/** Calendar header controls: view switcher (sliding thumb), ‹ Today ›, + New. */
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { spring, tween } from '@/motion/tokens';
import { links } from '@/shell/links';
import { Button, ButtonLink, IconButton } from '@/ui/Button';
import { Segmented } from '@/ui/Segmented';

export type CalView = 'month' | 'week' | 'agenda';

export function ViewSwitcher({ value, onChange }: { value: CalView; onChange: (v: CalView) => void }) {
  return (
    <Segmented
      aria-label="Calendar view"
      size="sm"
      value={value}
      onValueChange={onChange}
      options={[
        { value: 'month', label: 'Month' },
        { value: 'week', label: 'Week' },
        { value: 'agenda', label: 'Agenda' },
      ]}
    />
  );
}

export function PagingControls({ onPrev, onNext, onToday, prevLabel, nextLabel }: { onPrev: () => void; onNext: () => void; onToday: () => void; prevLabel: string; nextLabel: string }) {
  return (
    <div className="flex items-center gap-0.5">
      <IconButton label={prevLabel} icon={<ChevronLeft />} size="sm" onClick={onPrev} />
      <Button size="sm" variant="secondary" onClick={onToday} kbd="t" className="max-sm:!px-2">
        Today
      </Button>
      <IconButton label={nextLabel} icon={<ChevronRight />} size="sm" onClick={onNext} />
    </div>
  );
}

export function NewButton({ date }: { date?: string }) {
  return (
    <ButtonLink {...links.newWorkout(date ? { date } : {})} variant="primary" size="sm" icon={<Plus />} className="max-sm:!px-2">
      <span className="max-sm:sr-only">New</span>
    </ButtonLink>
  );
}

/** Title that rolls vertically when the visible month changes. */
export function RollingTitle({ text, dir }: { text: ReactNode; dir: number }) {
  return (
    <span className="relative inline-flex h-[1.625rem] min-w-[11ch] overflow-hidden align-bottom">
      <AnimatePresence mode="popLayout" initial={false} custom={dir}>
        <motion.span
          key={String(text)}
          custom={dir}
          initial={{ y: dir >= 0 ? 14 : -14, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: dir >= 0 ? -14 : 14, opacity: 0, transition: tween('fast', 'in') }}
          transition={spring.snappy}
          className="whitespace-nowrap"
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
