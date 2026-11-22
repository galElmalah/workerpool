/**
 * Hover cards for the calendar (DESIGN_V2 §5: "everything removed is shown in a hover card").
 * One layer per view; cards and week summaries only register intent. Opens after a short delay on
 * mouse hover or keyboard focus, never on touch; closes on leave, blur, pointer-down, scroll and
 * whenever a drag is in progress. The card is pointer-transparent, so it can never block a drag.
 *
 *   const peek = usePeekTrigger({ kind: 'card', key: card.key });   <div {...peek} />
 *   <PeekLayer model={model} />                                        // once per view
 */
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useSyncExternalStore, type FocusEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, RefreshCw, TriangleAlert } from 'lucide-react';
import { INTENSITY_META, type Sport } from '@cadence/core/domain';
import { isoWeekStart } from '@cadence/core/time';
import { cn } from '@/lib/cn';
import {
  distanceParts,
  formatClockTime,
  formatDuration,
  formatInstantTime,
  formatIsoWeek,
  formatIsoWeekRange,
  formatLoad,
  formatPercent,
  formatSigned,
  NBSP,
} from '@/lib/format';
import type { CalendarCard } from '@/lib/queries/training';
import { useUnits } from '@/lib/units';
import { tween } from '@/motion/tokens';
import { ComplianceBar, ComplianceGlyph, complianceLabel } from '@/ui/domain/Compliance';
import { bySportOrder, sportColor, zoneColor } from '@/ui/domain/dataColor';
import { IntensityDot } from '@/ui/domain/Intensity';
import { ShareBar } from '@/ui/domain/ShareBar';
import { KeyStar } from '@/ui/domain/KeyStar';
import { MiniProfile } from '@/ui/domain/MiniProfile';
import { SPORT_SHORT, SportGlyph } from '@/ui/domain/SportGlyph';
import { FORM_ZONE_META } from '@/ui/domain/Status';
import type { CalendarModel, WeekData } from './data';
import { useCal } from './store';

export type PeekTarget = { kind: 'card'; key: string } | { kind: 'week'; key: string };
type PeekState = (PeekTarget & { rect: DOMRect }) | null;

let state: PeekState = null;
const subs = new Set<() => void>();
const setPeek = (s: PeekState) => {
  state = s;
  subs.forEach((f) => f());
};
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};
export const hidePeek = () => state && setPeek(null);

let timer: ReturnType<typeof setTimeout> | undefined;
const OPEN_MS = 450;
const FOCUS_MS = 250;

/** Pointer/focus handlers that open the hover card for `target` over the element they're spread on. */
export function usePeekTrigger(target: PeekTarget) {
  const schedule = (el: HTMLElement, ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!el.isConnected) return;
      setPeek({ ...target, rect: el.getBoundingClientRect() });
    }, ms);
  };
  const cancel = () => {
    clearTimeout(timer);
    hidePeek();
  };
  return {
    onPointerEnter: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'mouse' || e.buttons) return;
      schedule(e.currentTarget, state ? 0 : OPEN_MS);
    },
    onPointerLeave: cancel,
    onPointerDown: cancel,
    onFocus: (e: FocusEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget && !e.currentTarget.contains(e.target)) return;
      const t = e.target as HTMLElement;
      if (t.matches(':focus-visible')) schedule(e.currentTarget, FOCUS_MS);
    },
    onBlur: cancel,
  };
}

const W = 288;
const GAP = 10;

function place(rect: DOMRect, h: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = rect.right + GAP;
  if (left + W > vw - 12) left = rect.left - GAP - W;
  if (left < 12) left = Math.min(vw - W - 12, Math.max(12, rect.left));
  const top = Math.max(12, Math.min(rect.top - 8, vh - h - 12));
  return { left, top };
}

/** The single hover-card layer of a calendar view. */
export function PeekLayer({ model }: { model: CalendarModel }) {
  const peek = useSyncExternalStore(subscribe, () => state, () => null);
  const dragging = useCal((s) => !!s.preview);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!peek) return;
    const off = () => hidePeek();
    window.addEventListener('wheel', off, { passive: true });
    window.addEventListener('scroll', off, { passive: true, capture: true });
    window.addEventListener('keydown', off);
    window.addEventListener('resize', off);
    return () => {
      window.removeEventListener('wheel', off);
      window.removeEventListener('scroll', off, { capture: true });
      window.removeEventListener('keydown', off);
      window.removeEventListener('resize', off);
    };
  }, [peek]);
  useEffect(() => () => void hidePeek(), []);

  const card = peek?.kind === 'card' ? (model.findCard(peek.key)?.card ?? null) : null;
  const week = peek?.kind === 'week' ? model.getWeek(isoWeekStart(peek.key)) : null;
  const open = !!peek && !dragging && (!!card || !!week?.summary);
  const pos = peek ? place(peek.rect, ref.current?.offsetHeight ?? 260) : { left: 0, top: 0 };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          key={`${peek!.kind}:${peek!.key}`}
          role="tooltip"
          initial={{ opacity: 0, y: 4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, transition: tween('fast', 'in') }}
          transition={tween('fast')}
          className="pointer-events-none fixed z-(--z-popover) flex flex-col gap-3 rounded-lg bg-surface-3 p-4 text-fg-1"
          style={{ left: pos.left, top: pos.top, width: W }}
        >
          {card ? <CardPeek card={card} /> : week ? <WeekPeek week={week} /> : null}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

const clean = (md: string) =>
  md
    .replace(/[#*_>`]/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ');

const GARMIN: Record<'pending' | 'synced' | 'error', { icon: typeof Check; text: string }> = {
  pending: { icon: RefreshCw, text: 'Sending to your watch' },
  synced: { icon: Check, text: 'On your watch' },
  error: { icon: TriangleAlert, text: "Couldn't send to your watch" },
};

function Figure({ value, unit }: { value: string; unit?: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-fg-1">{value}</span>
      {unit && <span className="text-fg-3">{NBSP}{unit}</span>}
    </span>
  );
}

function CardPeek({ card }: { card: CalendarCard }) {
  const units = useUnits();
  const m = card.model;
  const w = card.workout;
  const a = card.activity;
  const state = m.compliance?.state ?? (m.kind === 'activity' ? 'unplanned' : 'planned');
  const dist = m.distanceM ? distanceParts(m.distanceM, m.sport, units) : null;
  const time = a ? formatInstantTime(a.startedAt, a.utcOffsetMin) : w?.startTime ? formatClockTime(w.startTime) : null;
  const note = a?.postNote || w?.preNote || w?.description;
  const garmin = w && !a && w.garmin.syncState !== 'none' ? GARMIN[w.garmin.syncState] : null;
  const planDist = w?.plannedDistanceM ? distanceParts(w.plannedDistanceM, w.sport, units) : null;
  const sep = <span className="text-fg-4"> · </span>;
  return (
    <>
      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-1.5 text-label text-fg-3">
          <SportGlyph sport={m.sport} subSport={m.subSport} size={14} />
          {SPORT_SHORT[m.sport as Sport]}
          {time && (
            <>
              {sep}
              {time}
            </>
          )}
          {m.intensity && (
            <>
              {sep}
              <IntensityDot intensity={m.intensity} />
              {INTENSITY_META[m.intensity].label}
            </>
          )}
        </span>
        <span className="flex items-start gap-2">
          <span className={cn('min-w-0 flex-1 text-body font-semibold', state === 'missed' && 'text-fg-3 line-through decoration-fg-4')}>{m.title}</span>
          {m.isKey && <KeyStar pressed readOnly size="sm" className="mt-1" />}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-body-sm num">
        <Figure value={formatDuration(m.durationSec)} />
        {dist && <Figure value={dist.value} unit={dist.unit} />}
        {m.load != null && <Figure value={formatLoad(m.load)} unit="load" />}
      </div>
      {state !== 'planned' && (
        <div className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1.5 text-body-sm text-fg-2">
            <ComplianceGlyph state={state} />
            {complianceLabel(state, w?.skipReason)}
            {m.compliance?.ratio != null && (
              <span className="text-fg-3 num">
                {sep}
                {Math.round(m.compliance.ratio * 100)}% of plan
              </span>
            )}
          </span>
          {m.compliance?.ratio != null && <ComplianceBar ratio={m.compliance.ratio} state={state} />}
          {a && w && (
            <span className="text-label text-fg-3 num">
              Planned {formatDuration(w.plannedDurationSec)}
              {planDist && ` · ${planDist.value}${NBSP}${planDist.unit}`}
              {w.plannedLoad != null && ` · ${formatLoad(w.plannedLoad)} load`}
            </span>
          )}
        </div>
      )}
      {m.sparkline && m.sparkline.length > 1 && <MiniProfile values={m.sparkline} height={28} aria-label="Step profile" />}
      {note && <p className="line-clamp-3 text-body-sm text-fg-2">{clean(note)}</p>}
      {garmin && (
        <span className="flex items-center gap-1.5 text-label text-fg-3">
          <garmin.icon className="size-3" strokeWidth={2} aria-hidden />
          {garmin.text}
        </span>
      )}
    </>
  );
}

const pct = (n: number, t: number) => (t > 0 ? Math.round((n / t) * 100) : 0);
const DIST = new Set(['bike', 'run', 'swim', 'row', 'walk', 'hike', 'ski']);

function WeekPeek({ week }: { week: WeekData }) {
  const units = useUnits();
  const s = week.summary!;
  const sports = s.bySport
    .filter((x) => x.plannedCount + x.doneCount > 0)
    .sort((a, b) => b.plannedSec + b.doneSec - (a.plannedSec + a.doneSec))
    .slice(0, 4)
    .sort((a, b) => bySportOrder(a.sport, b.sport)); // legend order = stack order
  const it = s.intensitySec;
  const itT = it.easy + it.moderate + it.hard;
  const proj = s.isProjected;
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-fg-3">{label}</span>
      <span className="text-right text-fg-2 num">{value}</span>
    </div>
  );
  return (
    <>
      <div className="flex flex-col gap-0.5">
        <span className="text-body font-semibold">
          {formatIsoWeek(week.isoWeek)}
          {week.phase && <span className="font-normal text-fg-3"> · {week.phase.phase.label}, week {week.phase.index} of {week.phase.count}</span>}
        </span>
        <span className="text-label text-fg-3">{formatIsoWeekRange(week.isoWeek, true)}</span>
      </div>
      <div className="flex flex-col gap-1 text-body-sm">
        {row(
          'Hours',
          <>
            <span className="text-fg-1">{formatDuration(s.doneSec)}</span> of {formatDuration(s.plannedSec)}
            {s.wowSec != null && Number.isFinite(s.wowSec) && <span className="text-fg-3"> · {formatPercent(s.wowSec, { signed: true })}</span>}
          </>,
        )}
        {row(
          'Load',
          <>
            <span className="text-fg-1">{formatLoad(s.doneLoad)}</span> of {formatLoad(s.plannedLoad)}
            {s.wowLoad != null && Number.isFinite(s.wowLoad) && <span className="text-fg-3"> · {formatPercent(s.wowLoad, { signed: true })}</span>}
          </>,
        )}
        {(s.keyPlanned > 0 || s.keyDone > 0) &&
          row(
            'Key sessions',
            <>
              <span className="text-fg-1">{s.keyDone}</span> of {Math.max(s.keyPlanned, s.keyDone)}
            </>,
          )}
        {itT > 0 && row('Easy · moderate · hard', `${pct(it.easy, itT)} · ${pct(it.moderate, itT)} · ${pct(it.hard, itT)}%`)}
        {itT > 0 && (
          <ShareBar
            height={4}
            className="mt-0.5"
            parts={[
              { key: 'easy', value: it.easy, color: zoneColor(2), label: `Easy ${pct(it.easy, itT)}%` },
              { key: 'moderate', value: it.moderate, color: zoneColor(3), label: `Moderate ${pct(it.moderate, itT)}%` },
              { key: 'hard', value: it.hard, color: zoneColor(5), label: `Hard ${pct(it.hard, itT)}%` },
            ]}
          />
        )}
      </div>
      {sports.length > 0 && (
        <div className="flex flex-col gap-1 text-body-sm">
          {sports.some((x) => x.doneSec > 0) && (
            <ShareBar
              height={4}
              className="mb-1"
              parts={sports.map((x) => ({ key: x.sport, value: x.doneSec, color: sportColor(x.sport), label: `${SPORT_SHORT[x.sport]} ${formatDuration(x.doneSec)}` }))}
            />
          )}
          {sports.map((x) => {
            const useDist = DIST.has(x.sport) && (x.plannedDistanceM > 0 || x.doneDistanceM > 0);
            const fmtSport = x.sport === 'swim' && Math.max(x.doneDistanceM, x.plannedDistanceM) >= 1000 ? 'run' : x.sport;
            const d = distanceParts(x.doneDistanceM, fmtSport, units, fmtSport === 'swim' ? undefined : 1);
            const p = distanceParts(x.plannedDistanceM, fmtSport, units, fmtSport === 'swim' ? undefined : 1);
            return (
              <div key={x.sport} className="flex items-center gap-2">
                <SportGlyph sport={x.sport} size={14} />
                <span className="flex-1 text-fg-3">{SPORT_SHORT[x.sport]}</span>
                <span className="text-fg-2 num">
                  {useDist ? (
                    <>
                      <span className="text-fg-1">{x.doneDistanceM > 0 ? d.value : '0'}</span>
                      {x.plannedDistanceM > 0 && ` of ${p.value}`}
                      {NBSP}
                      {d.unit}
                    </>
                  ) : (
                    <>
                      <span className="text-fg-1">{x.doneCount}</span> of {x.plannedCount}
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <div className="flex flex-col gap-1 text-body-sm">
        <span className="text-label text-fg-3">End of week{proj ? ' (projected)' : ''}</span>
        <span className="text-fg-2 num">
          Fitness <span className="text-fg-1">{Math.round(s.fitness)}</span> <span className="text-fg-3">({formatSigned(s.fitnessDelta, 0)})</span> · Fatigue{' '}
          <span className="text-fg-1">{Math.round(s.fatigue)}</span> · Form <span className="text-fg-1">{formatSigned(s.form, 0)}</span>
        </span>
        {s.formZone && <span className="text-label text-fg-3">{FORM_ZONE_META[s.formZone].label}: {FORM_ZONE_META[s.formZone].tip}</span>}
      </div>
    </>
  );
}
