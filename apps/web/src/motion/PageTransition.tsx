/**
 * Page enter choreography — design.md §5.4g.
 * The route View Transition crossfades `main`; inside the new page, <PageStagger> reveals the
 * top-level sections (header, stat row, charts, lists): y 8 → 0, opacity 0 → 1, `smooth`,
 * 35ms step, delays capped (items past the 7th share the max).
 *
 *   <PageStagger>
 *     <PageSection>…stat row…</PageSection>
 *     <PageSection>…chart…</PageSection>
 *   </PageStagger>
 *
 * Also: <Crossfade> for skeleton → content swaps in place (both layers share one grid cell so the
 * skeleton must have the exact final box size).
 */
import { AnimatePresence, motion, type HTMLMotionProps, type Variants } from 'motion/react';
import type { ReactNode } from 'react';
import { spring, stagger, tween } from './tokens';

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: stagger.step, delayChildren: 0.04 } },
};
export const pageItem: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: spring.smooth },
};

export function PageStagger({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div variants={container} initial="hidden" animate="show" className={className ?? 'contents'}>
      {children}
    </motion.div>
  );
}

/** A top-level page section that participates in <PageStagger>. */
export function PageSection(props: HTMLMotionProps<'section'>) {
  return <motion.section variants={pageItem} {...props} />;
}

/** Same as PageSection, rendered as a div. */
export function PageItem(props: HTMLMotionProps<'div'>) {
  return <motion.div variants={pageItem} {...props} />;
}

/** Back-compat name used in the brief: a page-level wrapper with enter choreography. */
export const PageTransition = PageStagger;

/** Staggered list entrance for collections (enter only; never on re-sorts or scroll). */
export const listContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: stagger.step, delayChildren: 0 } },
};
export const listItem: Variants = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: spring.smooth },
};

/**
 * Skeleton → content crossfade in place.
 *   <Crossfade loading={isPending} skeleton={<StatTile.Skeleton />}>{<StatTile … />}</Crossfade>
 */
export function Crossfade({
  loading,
  skeleton,
  children,
  className,
}: {
  loading: boolean;
  skeleton: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`grid *:[grid-area:1/1] ${className ?? ''}`}>
      <AnimatePresence initial={false}>
        {loading ? (
          <motion.div key="sk" exit={{ opacity: 0, transition: tween('fast', 'in') }}>
            {skeleton}
          </motion.div>
        ) : (
          <motion.div key="ct" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: tween('base') }}>
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
