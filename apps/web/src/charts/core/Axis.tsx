/**
 * Minimal axes & grid (design.md §6.1): no axis lines, mono-sm tick labels in fg-3 outside
 * the plot, horizontal hairline grid only. Ticks crossfade when the domain changes.
 */
import { AnimatePresence, motion } from 'motion/react';
import { scaleLinear } from 'd3-scale';
import { DAY_MS, fmtMonth, fmtMonthDay } from '../format';
import { dur, ease } from '../motion';
import { T } from './tokens';

export interface Tick {
  key: string | number;
  pos: number;
  label: string;
  /** e.g. the first tick of a new month (rendered fg-2). */
  strong?: boolean;
}

const tickFade = { duration: dur.fast, ease: ease.out };

/** Drop ticks whose labels would collide (estimates mono-sm glyph width ≈ 6.6px). */
export function thinTicks(ticks: Tick[], minGap = 10, charW = 6.6): Tick[] {
  const out: Tick[] = [];
  let lastRight = -Infinity;
  for (const t of ticks) {
    const w = t.label.length * charW;
    const left = t.pos - w / 2;
    if (left >= lastRight + minGap) {
      out.push(t);
      lastRight = t.pos + w / 2;
    }
  }
  return out;
}

export function AxisX({ ticks, y, animate = true }: { ticks: Tick[]; y: number; animate?: boolean }) {
  return (
    <g aria-hidden className="select-none">
      <AnimatePresence initial={false}>
        {ticks.map((t) => (
          <motion.text
            key={t.key}
            initial={animate ? { opacity: 0, x: t.pos } : false}
            animate={{ opacity: 1, x: t.pos }}
            exit={{ opacity: 0, transition: tickFade }}
            transition={{ opacity: tickFade, x: { duration: 0 } }}
            y={y}
            textAnchor="middle"
            dominantBaseline="hanging"
            style={{ fill: t.strong ? T.fg2 : T.fg3, fontFamily: T.mono, fontSize: 11, letterSpacing: '0.01em' }}
          >
            {t.label}
          </motion.text>
        ))}
      </AnimatePresence>
    </g>
  );
}

export function AxisY({ ticks, x, align = 'end' }: { ticks: Tick[]; x: number; align?: 'start' | 'end' }) {
  return (
    <g aria-hidden className="select-none">
      <AnimatePresence initial={false}>
        {ticks.map((t) => (
          <motion.text
            key={t.key}
            initial={{ opacity: 0, y: t.pos }}
            animate={{ opacity: 1, y: t.pos }}
            exit={{ opacity: 0, transition: tickFade }}
            transition={{ opacity: tickFade, y: { duration: 0 } }}
            x={x}
            textAnchor={align}
            dominantBaseline="central"
            style={{ fill: T.fg3, fontFamily: T.mono, fontSize: 11, letterSpacing: '0.01em' }}
          >
            {t.label}
          </motion.text>
        ))}
      </AnimatePresence>
    </g>
  );
}

/** Horizontal hairlines at the given y positions. `zero` draws the baseline at line-2. */
export function Grid({ ys, x0, x1, zero }: { ys: { key: string | number; pos: number }[]; x0: number; x1: number; zero?: number }) {
  return (
    <g aria-hidden>
      <AnimatePresence initial={false}>
        {ys.map((t) => (
          <motion.line
            key={t.key}
            x1={x0}
            x2={x1}
            y1={0}
            y2={0}
            initial={{ opacity: 0, y: t.pos }}
            animate={{ opacity: 1, y: t.pos }}
            exit={{ opacity: 0, transition: tickFade }}
            transition={{ opacity: tickFade, y: { duration: 0 } }}
            style={{ stroke: T.line1 }}
            shapeRendering="crispEdges"
          />
        ))}
      </AnimatePresence>
      {zero != null && <line x1={x0} x2={x1} y1={zero} y2={zero} style={{ stroke: T.line3 }} shapeRendering="crispEdges" />}
    </g>
  );
}

/** Linear y ticks (3–5) for a [min,max] domain mapped to [bottom, top]. */
export function linearTicks(domain: [number, number], range: [number, number], count = 4, format: (v: number) => string = (v) => String(v)): Tick[] {
  const s = scaleLinear().domain(domain).range(range);
  return s.ticks(count).map((v) => ({ key: v, pos: s(v), label: format(v) }));
}

/**
 * Date ticks for a [start,end] ms domain over `width` px. Picks weekly (Mondays), monthly or
 * bi/quarterly month starts; the first tick of a new month (or January) is `strong`.
 */
export function dateTicks(x: (ms: number) => number, start: number, end: number, width: number): Tick[] {
  const spanDays = (end - start) / DAY_MS;
  const maxTicks = Math.max(2, Math.floor(width / 64));
  const out: Tick[] = [];
  if (spanDays / 7 <= maxTicks * 1.1) {
    // weekly ticks on Mondays, every k weeks
    const k = Math.max(1, Math.ceil(spanDays / 7 / maxTicks));
    const d0 = new Date(start);
    const dow = (d0.getUTCDay() + 6) % 7;
    let t = start + ((7 - dow) % 7) * DAY_MS;
    let lastMonth = -1;
    let i = 0;
    for (; t <= end; t += 7 * DAY_MS, i++) {
      if (i % k) continue;
      const m = new Date(t).getUTCMonth();
      out.push({ key: t, pos: x(t), label: fmtMonthDay(t), strong: lastMonth !== -1 && m !== lastMonth });
      lastMonth = m;
    }
    return out;
  }
  const months = spanDays / 30.4;
  const step = [1, 2, 3, 6, 12].find((s) => months / s <= maxTicks) ?? 12;
  const d = new Date(start);
  let y = d.getUTCFullYear();
  let m = d.getUTCMonth() + 1;
  if (m > 11) {
    m = 0;
    y++;
  }
  for (;;) {
    const t = Date.UTC(y, m, 1);
    if (t > end) break;
    if (m % step === 0 || step === 1) {
      out.push({ key: t, pos: x(t), label: m === 0 ? fmtMonth(t, true) : fmtMonth(t), strong: m === 0 });
    }
    m++;
    if (m > 11) {
      m = 0;
      y++;
    }
  }
  return out;
}
