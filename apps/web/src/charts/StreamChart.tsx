/**
 * StreamChart — synced multi-track 1 Hz activity streams on Canvas 2D.
 *
 * - One main canvas (tracks, laps, axes, overview) redrawn only when the view/data/theme
 *   changes; one overlay canvas (crosshair, dots, selection, brush) redrawn per pointer frame.
 * - LTTB per track to 2 × plot width over the visible window (gap aware).
 * - Shared cursor = MotionValue<number> of seconds (no React renders while scrubbing), so a
 *   RouteMap or anything else can follow it at 60 fps.
 * - Drag = select (→ onSelect), ⌘/Ctrl+wheel or pinch = zoom, Shift+wheel / overview drag = pan,
 *   double-click = reset, keyboard: ←/→ cursor, +/− zoom, Z zoom to selection, 0 reset, Esc clear.
 * v2.1 look (DESIGN_V2 §8): every metric keeps one colour (METRIC_COLOR in core/tokens.ts —
 * power blue, heart rate red, pace/speed aqua, cadence violet, elevation a neutral area); the
 * primary track (power when present) gets a ≤ 12% fade; labels and readouts stay ink beside a
 * coloured mark; zone shading uses z1..z7; one quiet gridline per track, sentence-case labels, faint lap rules, a
 * neutral selection wash without edge lines.
 * product.md §5.1 item 6.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { animate, useMotionValue, useReducedMotion, type MotionValue } from 'motion/react';
import type { ActivityStreams, Lap, Sport } from '@cadence/core';
import { ChartFrame } from './core/ChartFrame';
import { ChartSegmented } from './core/controls';
import { useCanvasTokens, type CanvasTokens, type StreamMetric } from './core/tokens';
import { fitCanvas, useChartSize, useRafCallback } from './core/useChartSize';
import { lowerBound, lttbIndices, rollingMeanF64, toF64 } from './core/lttb';
import { useStreamCursor } from './core/hover';
import { fmtHMS, fmtKm, fmtNum, fmtPace } from './format';
import { spring } from './motion';

export type StreamTrack = 'power' | 'hr' | 'speed' | 'cadence' | 'altitude';
export interface StreamSelection {
  startSec: number;
  endSec: number;
}
export type StreamXAxis = 'time' | 'distance';
export type StreamSmoothing = 0 | 5 | 30;

export interface StreamChartProps {
  streams: ActivityStreams;
  laps?: Lap[];
  /** Tracks to show, in order (default: every available of power, hr, speed, cadence, altitude). */
  tracks?: StreamTrack[];
  /** run / swim / row show speed as pace. */
  sport?: Sport;
  /** Threshold power for zone-density shading of the power track. */
  ftp?: number;
  /** Zone upper bounds as fractions of ftp (Coggan default). */
  zoneBounds?: number[];
  xAxis?: StreamXAxis;
  defaultXAxis?: StreamXAxis;
  onXAxisChange?: (x: StreamXAxis) => void;
  smoothing?: StreamSmoothing;
  defaultSmoothing?: StreamSmoothing;
  onSmoothingChange?: (s: StreamSmoothing) => void;
  zoneShading?: boolean;
  defaultZoneShading?: boolean;
  /** Shared cursor (seconds; NaN = none). Create with `useStreamCursor()`. */
  cursor?: MotionValue<number>;
  /** Controlled selection (e.g. a lap row click). */
  selection?: StreamSelection | null;
  onSelect?: (s: StreamSelection | null) => void;
  /** Height of the secondary tracks (power gets 1.33×). */
  trackHeight?: number;
  showControls?: boolean;
  loading?: boolean;
  className?: string;
}

interface Track {
  key: StreamTrack;
  label: string;
  unit: string;
  y: Float64Array;
  raw: Float64Array;
  lo: number;
  hi: number;
  h: number;
  top: number;
  fmt: (v: number) => string;
  ticks: number[];
}

const ZONES_DEFAULT = [0.55, 0.75, 0.9, 1.05, 1.2, 1.5];
const GUTTER = 48;
const RIGHT = 12;
const GAP = 14;
const AXIS_H = 24;
const OVERVIEW_H = 28;

function quantile(a: Float64Array, q: number) {
  const v = Array.from(a).filter((x) => x === x).sort((x, y) => x - y);
  return v.length ? v[Math.min(v.length - 1, Math.floor(q * (v.length - 1)))] : 0;
}

/** Summary statistics for a time range of a stream (for selection panels). */
export function streamStats(s: ActivityStreams, startSec: number, endSec: number) {
  const t = s.t;
  const a = lowerBound(t, startSec);
  const b = Math.min(t.length, lowerBound(t, endSec) + 1);
  const avg = (arr?: (number | null)[]) => {
    if (!arr) return null;
    let sum = 0;
    let c = 0;
    for (let i = a; i < b; i++) {
      const v = arr[i];
      if (v != null) {
        sum += v;
        c++;
      }
    }
    return c ? sum / c : null;
  };
  const max = (arr?: (number | null)[]) => {
    if (!arr) return null;
    let m = -Infinity;
    for (let i = a; i < b; i++) if (arr[i] != null && arr[i]! > m) m = arr[i]!;
    return Number.isFinite(m) ? m : null;
  };
  let np: number | null = null;
  if (s.power && b - a >= 30) {
    const p = toF64(s.power.slice(a, b));
    const r = rollingMeanF64(p, 30);
    let s4 = 0;
    let c = 0;
    for (const v of r) if (v === v) {
      s4 += v ** 4;
      c++;
    }
    np = c ? (s4 / c) ** 0.25 : null;
  }
  const d0 = s.distance?.[a] ?? null;
  const d1 = s.distance?.[b - 1] ?? null;
  return {
    durationSec: (t[b - 1] ?? endSec) - (t[a] ?? startSec),
    distanceM: d0 != null && d1 != null ? d1 - d0 : null,
    avgPower: avg(s.power),
    maxPower: max(s.power),
    weightedPower: np,
    avgHr: avg(s.hr),
    maxHr: max(s.hr),
    avgSpeed: avg(s.speed),
    avgCadence: avg(s.cadence),
    elevationGain: (() => {
      if (!s.altitude) return null;
      let g = 0;
      for (let i = a + 1; i < b; i++) {
        const d = (s.altitude[i] ?? 0) - (s.altitude[i - 1] ?? 0);
        if (d > 0) g += d;
      }
      return g;
    })(),
  };
}

export function StreamChart(props: StreamChartProps) {
  const { streams, loading, className, trackHeight = 72 } = props;
  const n = streams.t?.length ?? 0;
  const [ref, size] = useChartSize<HTMLDivElement>();
  const h = trackHeight * 5 + 120;
  const dur = n ? streams.t[n - 1] - streams.t[0] : 0;
  const avgP = streams.power ? fmtNum(streams.power.reduce<number>((a, v) => a + (v ?? 0), 0) / Math.max(1, streams.power.filter((v) => v != null).length)) : null;
  return (
    <div className={`min-w-0 ${className ?? ''}`}>
      <ChartFrame
        summary={n ? `Activity streams, ${fmtHMS(dur)}${avgP ? `, average power ${avgP} W` : ''}. Use arrow keys to scrub, plus and minus to zoom.` : 'Activity streams: none recorded'}
        loading={loading}
        empty={n < 2}
        emptyTitle="No streams"
        emptyHint="This activity has no recorded samples (manual entry or summary-only sync)."
        height={h}
        table={
          n
            ? {
                caption: 'Stream samples every 5 minutes',
                columns: ['Time', 'Power W', 'Heart rate bpm', 'Speed m/s', 'Cadence', 'Altitude m'],
                rows: streams.t.filter((_, i) => i % 300 === 0).map((tt, k) => {
                  const i = k * 300;
                  return [fmtHMS(tt), streams.power?.[i] ?? '', streams.hr?.[i] ?? '', streams.speed?.[i] ?? '', streams.cadence?.[i] ?? '', streams.altitude?.[i] ?? ''];
                }),
              }
            : undefined
        }
      >
        <div ref={ref} className="w-full">
          {size.width > 0 && <StreamInner {...props} width={size.width} trackHeight={trackHeight} />}
        </div>
      </ChartFrame>
    </div>
  );
}

function StreamInner({
  streams,
  laps = [],
  tracks: trackKeys,
  sport = 'bike',
  ftp,
  zoneBounds = ZONES_DEFAULT,
  width,
  trackHeight,
  showControls = true,
  cursor: extCursor,
  selection: ctlSel,
  onSelect,
  ...p
}: StreamChartProps & { width: number; trackHeight: number }) {
  const tk = useCanvasTokens();
  const reduce = useReducedMotion();
  const ownCursor = useStreamCursor();
  const cursor = extCursor ?? ownCursor;
  const [xAxisS, setXAxisS] = useState<StreamXAxis>(p.defaultXAxis ?? 'time');
  const xAxis = p.xAxis ?? xAxisS;
  const [smoothS, setSmoothS] = useState<StreamSmoothing>(p.defaultSmoothing ?? 0);
  const smoothing = p.smoothing ?? smoothS;
  const [zonesS, setZonesS] = useState<boolean>(p.defaultZoneShading ?? false);
  const zoneShading = (p.zoneShading ?? zonesS) && !!ftp;
  const [selS, setSelS] = useState<StreamSelection | null>(null);
  const selection = ctlSel !== undefined ? ctlSel : selS;
  const [zoomed, setZoomed] = useState(false);
  const paceSport = sport === 'run' || sport === 'swim' || sport === 'row';
  const pacePer = sport === 'swim' ? 100 : sport === 'row' ? 500 : 1000;

  // ── data ──
  const base = useMemo(() => {
    const n = streams.t.length;
    const t = toF64(streams.t);
    const dist = toF64(streams.distance, n);
    let last = 0;
    for (let i = 0; i < n; i++) {
      if (dist[i] !== dist[i]) dist[i] = last;
      else last = dist[i];
    }
    return {
      n,
      t,
      dist,
      power: streams.power ? toF64(streams.power) : null,
      hr: streams.hr ? toF64(streams.hr) : null,
      speed: streams.speed ? toF64(streams.speed) : null,
      cadence: streams.cadence ? toF64(streams.cadence) : null,
      altitude: streams.altitude ? toF64(streams.altitude) : null,
      hasDist: !!streams.distance,
    };
  }, [streams]);

  const tracks: Track[] = useMemo(() => {
    const want = trackKeys ?? (['power', 'hr', 'speed', 'cadence', 'altitude'] as StreamTrack[]);
    const out: Track[] = [];
    let top = 6;
    for (const k of want) {
      const raw = base[k];
      if (!raw) continue;
      let finite = 0;
      for (let i = 0; i < raw.length; i += 10) if (raw[i] === raw[i]) finite++;
      if (finite < 3) continue;
      const y = k === 'altitude' ? raw : rollingMeanF64(raw, smoothing);
      let lo = 0;
      let hi = 1;
      let fmt = (v: number) => fmtNum(v);
      let label: string = k;
      let unit = '';
      if (k === 'power') {
        hi = quantile(raw, 0.997) * 1.1;
        label = 'Power';
        unit = 'W';
      } else if (k === 'hr') {
        lo = Math.floor(quantile(raw, 0.01) * 0.92);
        hi = quantile(raw, 0.999) * 1.03;
        label = 'Heart rate';
        unit = 'bpm';
      } else if (k === 'speed') {
        lo = paceSport ? quantile(raw, 0.05) * 0.8 : 0;
        hi = quantile(raw, 0.995) * 1.08;
        label = paceSport ? 'Pace' : 'Speed';
        unit = paceSport ? (pacePer === 1000 ? '/km' : pacePer === 100 ? '/100m' : '/500m') : 'km/h';
        fmt = paceSport ? (v) => fmtPace(v, pacePer) : (v) => fmtNum(v * 3.6, 1);
      } else if (k === 'cadence') {
        lo = 40;
        hi = Math.max(lo + 10, quantile(raw, 0.995) * 1.08);
        label = 'Cadence';
        unit = sport === 'run' ? 'spm' : 'rpm';
      } else if (k === 'altitude') {
        const a = quantile(raw, 0);
        const b = quantile(raw, 1);
        lo = a - (b - a) * 0.15;
        hi = b + (b - a) * 0.12;
        label = 'Elevation';
        unit = 'm';
      }
      const h = k === 'power' ? Math.round(trackHeight * 1.33) : k === 'altitude' ? Math.round(trackHeight * 0.8) : trackHeight;
      // One or two quiet reference values per track (DESIGN_V2: few gridlines).
      let ticks: number[] = [];
      for (const div of [1.6, 2.6, 3.6]) {
        const tickStep = niceStep((hi - lo) / div);
        ticks = [];
        for (let v = Math.ceil((lo + (hi - lo) * 0.2) / tickStep) * tickStep; v < hi - (hi - lo) * 0.12; v += tickStep) ticks.push(v);
        if (ticks.length) break;
      }
      if (ticks.length > 2) ticks.splice(0, ticks.length - 2);
      out.push({ key: k, label, unit, y, raw, lo, hi, h, top, fmt, ticks });
      top += h + GAP;
    }
    return out;
  }, [base, trackKeys, smoothing, trackHeight, paceSport, pacePer, sport]);

  /** The one accent track: power when present, else the first track (DESIGN_V2: one accent series). */
  const primaryKey: StreamTrack | undefined = tracks.find((t) => t.key === 'power')?.key ?? tracks.find((t) => t.key !== 'altitude')?.key ?? tracks[0]?.key;
  const xs = xAxis === 'distance' && base.hasDist ? base.dist : base.t;
  const xMin = xs[0];
  const xMax = xs[base.n - 1];
  const tracksH = tracks.length ? tracks[tracks.length - 1].top + tracks[tracks.length - 1].h : 0;
  const axisTop = tracksH + 4;
  const ovTop = axisTop + AXIS_H + 6;
  const H = ovTop + OVERVIEW_H + 2;
  const plotW = Math.max(10, width - GUTTER - RIGHT);

  // ── view (animated domain in x units) ──
  const v0 = useMotionValue(xMin);
  const v1 = useMotionValue(xMax);
  const secToX = useCallback((sec: number) => {
    if (xs === base.t) return sec;
    const i = Math.min(base.n - 1, lowerBound(base.t, sec));
    return xs[i];
  }, [xs, base]);
  const xToSec = useCallback((x: number) => {
    if (xs === base.t) return x;
    const i = Math.min(base.n - 1, lowerBound(xs, x));
    return base.t[i];
  }, [xs, base]);
  // Re-map the view when the x-axis kind changes.
  const prevXs = useRef(xs);
  useEffect(() => {
    if (prevXs.current === xs) return;
    const old = prevXs.current;
    const ia = Math.min(base.n - 1, lowerBound(old, v0.get()));
    const ib = Math.min(base.n - 1, lowerBound(old, v1.get()));
    prevXs.current = xs;
    v0.jump(xs[ia]);
    v1.jump(xs[ib]);
    requestDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xs]);

  const minSpan = xs === base.t ? 30 : 100;
  const setView = useCallback(
    (a: number, b: number, how: 'animate' | 'jump' = 'animate') => {
      let span = Math.max(minSpan, b - a);
      span = Math.min(span, xMax - xMin);
      let s = Math.max(xMin, Math.min(a, xMax - span));
      if (b - a < minSpan) s = Math.max(xMin, Math.min((a + b) / 2 - span / 2, xMax - span));
      const e = s + span;
      setZoomed(span < (xMax - xMin) * 0.999);
      if (how === 'jump' || reduce) {
        v0.jump(s);
        v1.jump(e);
      } else {
        animate(v0, s, spring.gentle);
        animate(v1, e, spring.gentle);
      }
    },
    [minSpan, xMax, xMin, reduce, v0, v1],
  );
  useEffect(() => {
    v0.jump(xMin);
    v1.jump(xMax);
    setZoomed(false);
  }, [streams, v0, v1, xMin, xMax]);

  // ── canvases ──
  const mainRef = useRef<HTMLCanvasElement>(null);
  const overRef = useRef<HTMLCanvasElement>(null);
  const readoutRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const timeRef = useRef<HTMLSpanElement>(null);
  const chipRef = useRef<HTMLDivElement>(null);
  const brush = useRef<{ a: number; b: number } | null>(null);

  const xPx = (x: number, a: number, b: number) => GUTTER + ((x - a) / (b - a)) * plotW;

  const drawMain = useCallback(() => {
    const c = mainRef.current;
    if (!c) return;
    const ctx = fitCanvas(c, width, H);
    ctx.clearRect(0, 0, width, H);
    const a = v0.get();
    const b = v1.get();
    const X = (x: number) => xPx(x, a, b);
    const i0 = Math.max(0, lowerBound(xs, a) - 1);
    const i1 = Math.min(base.n, lowerBound(xs, b) + 2);
    const nPts = Math.max(16, Math.round(plotW * 2));

    // laps (behind tracks): faint hairlines
    ctx.strokeStyle = tk.line1;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const lap of laps) {
      if (lap.index === 0) continue;
      const lx = Math.round(X(secToX(lap.startSec))) + 0.5;
      if (lx < GUTTER || lx > GUTTER + plotW) continue;
      ctx.moveTo(lx, 4);
      ctx.lineTo(lx, tracksH);
    }
    ctx.stroke();

    for (const tr of tracks) {
      const top = tr.top;
      const bot = top + tr.h;
      const Y = (v: number) => bot - ((v - tr.lo) / (tr.hi - tr.lo)) * tr.h;
      // grid + y ticks
      ctx.font = `400 12px ${tk.sans}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (const v of tr.ticks) {
        const yy = Math.round(Y(v)) + 0.5;
        ctx.strokeStyle = tk.line1;
        ctx.beginPath();
        ctx.moveTo(GUTTER, yy);
        ctx.lineTo(GUTTER + plotW, yy);
        ctx.stroke();
        ctx.fillStyle = tk.fg3;
        ctx.fillText(tr.key === 'speed' && paceSport ? fmtPace(v, pacePer) : tr.key === 'speed' ? fmtNum(v * 3.6) : fmtNum(v), GUTTER - 8, yy);
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(GUTTER, top - 2, plotW, tr.h + 2);
      ctx.clip();
      const idx = lttbIndices(xs, tr.y, i0, i1, nPts);
      // path
      const path = new Path2D();
      const fillPath = new Path2D();
      let open = false;
      let firstX = 0;
      let lastX = 0;
      const closeFill = () => {
        if (open) {
          fillPath.lineTo(lastX, bot);
          fillPath.lineTo(firstX, bot);
          fillPath.closePath();
        }
      };
      for (let k = 0; k < idx.length; k++) {
        const i = idx[k];
        if (i < 0) {
          closeFill();
          open = false;
          continue;
        }
        const px = X(xs[i]);
        const py = Y(tr.y[i]);
        if (!open) {
          path.moveTo(px, py);
          fillPath.moveTo(px, bot);
          fillPath.lineTo(px, py);
          firstX = px;
          open = true;
        } else {
          path.lineTo(px, py);
          fillPath.lineTo(px, py);
        }
        lastX = px;
      }
      closeFill();
      if (tr.key === primaryKey) {
        if (tr.key === 'power' && zoneShading && ftp) {
          drawZoneDensity(ctx, idx, xs, tr, X, Y, bot, ftp, zoneBounds, tk);
        } else {
          // soft vertical fade of the metric colour (≤ 12 %)
          const fade = tk.metricFade[tr.key as StreamMetric] ?? [tk.a3, tk.a1];
          const g = ctx.createLinearGradient(0, top, 0, bot);
          g.addColorStop(0, fade[0]);
          g.addColorStop(1, fade[1]);
          ctx.fillStyle = g;
          ctx.fill(fillPath);
        }
        ctx.strokeStyle = tk.metrics[tr.key as StreamMetric] ?? tk.accent;
        ctx.lineWidth = 1.25;
      } else if (tr.key === 'altitude') {
        ctx.fillStyle = tk.s2;
        ctx.fill(fillPath);
        ctx.strokeStyle = tk.fg4;
        ctx.lineWidth = 1;
      } else {
        ctx.strokeStyle = tk.metrics[tr.key as StreamMetric] ?? tk.fg3;
        ctx.lineWidth = tr.key === 'hr' ? 1.25 : 1;
        if (tr.key === 'cadence') ctx.globalAlpha = 0.85;
      }
      ctx.lineJoin = 'round';
      ctx.stroke(path);
      ctx.globalAlpha = 1;
      ctx.restore();

      // label (top-left, inside): sentence case, 12px sans, fg-3 on a soft halo so the line can pass under it
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = `400 12px ${tk.sans}`;
      ctx.fillStyle = tk.fg3;
      ctx.fillText(tr.label, GUTTER + 8, top + 2);
    }

    // lap numbers: small, fg-4, only where they have room
    ctx.font = `400 11px ${tk.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    let lastLapX = -Infinity;
    for (const lap of laps) {
      const lx = X(secToX(lap.startSec + lap.durationSec / 2));
      if (lx < GUTTER + 84 || lx > GUTTER + plotW - 12 || lx - lastLapX < 36) continue;
      const w = X(secToX(lap.startSec + lap.durationSec)) - X(secToX(lap.startSec));
      if (w < 28) continue;
      ctx.fillStyle = tk.fg4;
      ctx.fillText(`${lap.index + 1}`, lx, tracks[0] ? tracks[0].top + 15 : 14);
      lastLapX = lx;
    }

    // x axis
    ctx.font = `400 12px ${tk.sans}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    ctx.fillStyle = tk.fg3;
    const span = b - a;
    const isTime = xs === base.t;
    const steps = isTime ? [10, 30, 60, 120, 300, 600, 900, 1200, 1800, 3600, 7200] : [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    const step = steps.find((s) => (plotW / (span / s)) >= 96) ?? steps[steps.length - 1];
    for (let v = Math.ceil(a / step) * step; v <= b; v += step) {
      const px = X(v);
      if (px < GUTTER + 12 || px > GUTTER + plotW - 12) continue;
      const lbl = isTime ? (span > 3600 || v >= 3600 ? fmtHM2(v) : fmtHMS(v)) : `${fmtKm(v, step < 1000 ? 1 : 0)}`;
      ctx.fillText(lbl, px, axisTop + 6);
    }
    ctx.textAlign = 'right';
    ctx.fillStyle = tk.fg4;
    ctx.fillText(isTime ? 'h:mm' : 'km', GUTTER - 10, axisTop + 6);

    // overview
    const ovX = (x: number) => GUTTER + ((x - xMin) / (xMax - xMin)) * plotW;
    const ovTr = tracks.find((t) => t.key === 'altitude') ?? tracks[0];
    if (ovTr) {
      const oIdx = lttbIndices(xs, ovTr.y, 0, base.n, Math.round(plotW));
      const Y = (v: number) => ovTop + OVERVIEW_H - 2 - ((v - ovTr.lo) / (ovTr.hi - ovTr.lo)) * (OVERVIEW_H - 6);
      ctx.beginPath();
      ctx.moveTo(GUTTER, ovTop + OVERVIEW_H);
      for (const i of oIdx) if (i >= 0) ctx.lineTo(ovX(xs[i]), Y(ovTr.y[i]));
      ctx.lineTo(GUTTER + plotW, ovTop + OVERVIEW_H);
      ctx.closePath();
      ctx.fillStyle = tk.s2;
      ctx.fill();
      // window: the visible range reads brighter; outside is dimmed. Quiet grips only when zoomed.
      const wa = ovX(a);
      const wb = ovX(b);
      if (zoomedRef.current) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(wa, ovTop, Math.max(0, wb - wa), OVERVIEW_H);
        ctx.clip();
        ctx.beginPath();
        ctx.moveTo(GUTTER, ovTop + OVERVIEW_H);
        for (const i of oIdx) if (i >= 0) ctx.lineTo(ovX(xs[i]), Y(ovTr.y[i]));
        ctx.lineTo(GUTTER + plotW, ovTop + OVERVIEW_H);
        ctx.closePath();
        ctx.fillStyle = tk.fg4;
        ctx.globalAlpha = 0.45;
        ctx.fill();
        ctx.restore();
        ctx.globalAlpha = 1;
        ctx.fillStyle = tk.fg3;
        for (const hx of [wa + 2, wb - 2]) {
          roundRect(ctx, hx - 1, ovTop + OVERVIEW_H / 2 - 6, 2, 12, 1);
          ctx.fill();
        }
      }
    }
    positionChip();
    drawOverlay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, H, tracks, xs, base, laps, tk, plotW, zoneShading, ftp, zoneBounds, secToX, tracksH, axisTop, ovTop, xMin, xMax, paceSport, pacePer, primaryKey]);

  const zoomedRef = useRef(false);
  // Background of the card the chart sits on (for the cursor-dot rings).
  const bgRef = useRef('');
  zoomedRef.current = zoomed;
  const selRef = useRef(selection);
  selRef.current = selection;

  const drawOverlay = useCallback(() => {
    const c = overRef.current;
    if (!c) return;
    const ctx = fitCanvas(c, width, H);
    ctx.clearRect(0, 0, width, H);
    const a = v0.get();
    const b = v1.get();
    const X = (x: number) => xPx(x, a, b);
    // selection
    const sel = selRef.current;
    const drawBand = (xa: number, xb: number, handles: boolean) => {
      const l = Math.max(GUTTER, Math.min(xa, xb));
      const r = Math.min(GUTTER + plotW, Math.max(xa, xb));
      if (r <= l) return;
      // soft neutral wash, no edge lines (DESIGN_V2 rule 5)
      ctx.fillStyle = tk.fg1;
      ctx.globalAlpha = tk.theme === 'light' ? 0.05 : 0.06;
      roundRect(ctx, l, 0, r - l, tracksH, 4);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (handles) {
        ctx.fillStyle = tk.fg3;
        for (const hx of [l, r]) {
          roundRect(ctx, hx - 1.5, tracksH / 2 - 10, 3, 20, 1.5);
          ctx.fill();
        }
      }
    };
    if (sel) drawBand(X(secToX(sel.startSec)), X(secToX(sel.endSec)), true);
    if (brush.current) drawBand(X(brush.current.a), X(brush.current.b), false);

    // cursor
    const sec = cursor.get();
    const readouts = readoutRefs.current;
    if (Number.isFinite(sec)) {
      const i = Math.min(base.n - 1, lowerBound(base.t, sec));
      const xv = xs[i];
      const px = X(xv);
      if (px >= GUTTER - 0.5 && px <= GUTTER + plotW + 0.5) {
        const rx = Math.round(px) + 0.5;
        ctx.strokeStyle = tk.fg4;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(rx, 0);
        ctx.lineTo(rx, tracksH);
        ctx.stroke();
        // overview tick
        const ox = GUTTER + ((xv - xMin) / (xMax - xMin)) * plotW;
        ctx.beginPath();
        ctx.moveTo(Math.round(ox) + 0.5, ovTop);
        ctx.lineTo(Math.round(ox) + 0.5, ovTop + OVERVIEW_H);
        ctx.stroke();
        for (const tr of tracks) {
          const v = tr.y[i];
          if (v !== v) continue;
          const py = tr.top + tr.h - ((v - tr.lo) / (tr.hi - tr.lo)) * tr.h;
          ctx.beginPath();
          ctx.arc(px, Math.max(tr.top, Math.min(tr.top + tr.h, py)), 3, 0, Math.PI * 2);
          ctx.fillStyle = tk.metrics[tr.key as StreamMetric] ?? tk.fg3;
          ctx.strokeStyle = bgRef.current || tk.canvas;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.fill();
        }
      }
      for (const tr of tracks) {
        const el = readouts[tr.key];
        if (el) el.textContent = tr.y[i] === tr.y[i] ? tr.fmt(tr.y[i]) : '—';
      }
      if (timeRef.current) timeRef.current.textContent = `${fmtHMS(base.t[i])}${base.hasDist ? ` · ${fmtKm(base.dist[i], 2)} km` : ''}`;
    } else {
      // no cursor: show averages over selection or whole activity
      const s = sel;
      const ia = s ? lowerBound(base.t, s.startSec) : 0;
      const ib = s ? Math.min(base.n, lowerBound(base.t, s.endSec) + 1) : base.n;
      for (const tr of tracks) {
        const el = readouts[tr.key];
        if (!el) continue;
        let sum = 0;
        let cnt = 0;
        for (let i = ia; i < ib; i++) {
          const v = tr.raw[i];
          if (v === v) {
            sum += v;
            cnt++;
          }
        }
        el.textContent = cnt ? tr.fmt(sum / cnt) : '—';
      }
      if (timeRef.current) timeRef.current.textContent = s ? `Average · ${fmtHMS(s.endSec - s.startSec)}` : 'Average · whole activity';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, H, tk, tracks, xs, base, plotW, tracksH, secToX, cursor, xMin, xMax, ovTop, primaryKey]);

  const requestDraw = useRafCallback(drawMain);
  const requestOverlay = useRafCallback(drawOverlay);

  const positionChip = () => {
    const el = chipRef.current;
    const s = selRef.current;
    if (!el || !s) return;
    const a = v0.get();
    const b = v1.get();
    const l = Math.max(GUTTER, xPx(secToX(s.startSec), a, b));
    const r = Math.min(GUTTER + plotW, xPx(secToX(s.endSec), a, b));
    const mid = (l + r) / 2;
    const w = el.offsetWidth;
    el.style.transform = `translateX(${Math.max(0, Math.min(width - w, mid - w / 2))}px)`;
    el.style.opacity = r > l ? '1' : '0';
  };

  useEffect(() => {
    const el = surfRef.current;
    const v = el ? getComputedStyle(el).getPropertyValue('--chart-bg').trim() : '';
    bgRef.current = v && !v.startsWith('var(') ? v : '';
    requestDraw();
  }, [requestDraw, drawMain, tk]);
  useEffect(() => {
    requestOverlay();
  }, [selection, requestOverlay]);
  useEffect(() => {
    const u0 = v0.on('change', requestDraw);
    const u1 = v1.on('change', requestDraw);
    const uc = cursor.on('change', requestOverlay);
    document.fonts?.ready.then(requestDraw);
    return () => {
      u0();
      u1();
      uc();
    };
  }, [v0, v1, cursor, requestDraw, requestOverlay]);

  // ── interaction ──
  const surfRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: 'brush' | 'pan' | 'ov'; startX: number; a0: number; b0: number; moved: boolean } | null>(null);
  const pointers = useRef(new Map<number, number>());
  const pinch = useRef<{ d: number; a: number; b: number; mid: number } | null>(null);

  const relX = (e: { clientX: number }) => e.clientX - (surfRef.current?.getBoundingClientRect().left ?? 0);
  const relY = (e: { clientY: number }) => e.clientY - (surfRef.current?.getBoundingClientRect().top ?? 0);
  const pxToX = (px: number) => {
    const a = v0.get();
    const b = v1.get();
    return a + ((Math.max(GUTTER, Math.min(GUTTER + plotW, px)) - GUTTER) / plotW) * (b - a);
  };
  const commitSel = useCallback(
    (s: StreamSelection | null) => {
      setSelS(s);
      onSelect?.(s);
    },
    [onSelect],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    const x = relX(e);
    const y = relY(e);
    pointers.current.set(e.pointerId, x);
    surfRef.current?.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()];
      pinch.current = { d: Math.abs(p1 - p2), a: v0.get(), b: v1.get(), mid: pxToX((p1 + p2) / 2) };
      drag.current = null;
      brush.current = null;
      return;
    }
    if (y >= ovTop) {
      const ovToX = (px: number) => xMin + ((px - GUTTER) / plotW) * (xMax - xMin);
      const a = v0.get();
      const b = v1.get();
      const xv = ovToX(x);
      if (xv < a || xv > b) setView(xv - (b - a) / 2, xv + (b - a) / 2, 'animate');
      drag.current = { mode: 'ov', startX: x, a0: xv < a || xv > b ? xv - (b - a) / 2 : a, b0: xv < a || xv > b ? xv + (b - a) / 2 : b, moved: false };
      return;
    }
    if (y > tracksH) return;
    drag.current = { mode: 'brush', startX: x, a0: v0.get(), b0: v1.get(), moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const x = relX(e);
    const y = relY(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, x);
    if (pinch.current && pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()];
      const d = Math.max(10, Math.abs(p1 - p2));
      const k = pinch.current.d / d;
      const span = (pinch.current.b - pinch.current.a) * k;
      const f = (pinch.current.mid - pinch.current.a) / (pinch.current.b - pinch.current.a);
      setView(pinch.current.mid - span * f, pinch.current.mid + span * (1 - f), 'jump');
      return;
    }
    const d = drag.current;
    if (d) {
      if (Math.abs(x - d.startX) > 4) d.moved = true;
      if (d.mode === 'ov') {
        const dx = ((x - d.startX) / plotW) * (xMax - xMin);
        setView(d.a0 + dx, d.b0 + dx, 'jump');
        return;
      }
      if (d.mode === 'brush' && d.moved) {
        brush.current = { a: pxToX(d.startX), b: pxToX(x) };
      }
    }
    if (y <= tracksH + 2 || d?.mode === 'brush') {
      cursor.set(xToSec(pxToX(x)));
    }
    requestOverlay();
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const d = drag.current;
    drag.current = null;
    if (d?.mode === 'brush' && d.moved && brush.current) {
      const a = Math.min(brush.current.a, brush.current.b);
      const b = Math.max(brush.current.a, brush.current.b);
      brush.current = null;
      commitSel({ startSec: xToSec(a), endSec: xToSec(b) });
    }
    requestOverlay();
  };
  const onPointerLeave = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' || drag.current) return;
    cursor.set(Number.NaN);
  };
  const resetZoom = useCallback(() => setView(xMin, xMax), [setView, xMin, xMax]);
  const zoomToSel = useCallback(() => {
    const s = selRef.current;
    if (!s) return;
    const a = secToX(s.startSec);
    const b = secToX(s.endSec);
    const pad = (b - a) * 0.06;
    setView(a - pad, b + pad);
  }, [secToX, setView]);
  const onDoubleClick = () => {
    commitSel(null);
    resetZoom();
  };

  useEffect(() => {
    const el = surfRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const a = v0.get();
      const b = v1.get();
      const span = b - a;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const k = Math.exp(Math.max(-0.5, Math.min(0.5, e.deltaY * 0.01)));
        const mx = pxToX(relX(e));
        const f = (mx - a) / span;
        const ns = span * k;
        setView(mx - ns * f, mx + ns * (1 - f), 'jump');
      } else if ((e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) && zoomedRef.current) {
        e.preventDefault();
        const dx = ((e.shiftKey ? e.deltaY : e.deltaX) / plotW) * span;
        setView(a + dx, b + dx, 'jump');
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plotW, setView]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const a = v0.get();
    const b = v1.get();
    const span = b - a;
    const cur = cursor.get();
    const cx = Number.isFinite(cur) ? secToX(cur) : (a + b) / 2;
    let handled = true;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowLeft': {
        const step = span * (e.shiftKey ? 0.1 : 0.01) * (e.key === 'ArrowRight' ? 1 : -1);
        const nx = Math.max(xMin, Math.min(xMax, cx + step));
        cursor.set(xToSec(nx));
        if (nx > b || nx < a) setView(nx - span / 2, nx + span / 2);
        break;
      }
      case '+':
      case '=':
        setView(cx - span * 0.35, cx + span * 0.35);
        break;
      case '-':
      case '_':
        setView(cx - span * 0.75, cx + span * 0.75);
        break;
      case '0':
        resetZoom();
        break;
      case 'z':
      case 'Z':
        zoomToSel();
        break;
      case 'Escape':
        if (selRef.current) commitSel(null);
        else cursor.set(Number.NaN);
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  };

  const selStats = useMemo(() => (selection ? streamStats(streams, selection.startSec, selection.endSec) : null), [selection, streams]);
  useEffect(() => {
    requestAnimationFrame(positionChip);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, selStats]);

  return (
    <div className="relative">
      {showControls && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {base.hasDist && (
              <ChartSegmented
                size="xs"
                ariaLabel="X axis"
                value={xAxis}
                options={[
                  { value: 'time', label: 'Time' },
                  { value: 'distance', label: 'Distance' },
                ]}
                onChange={(v) => {
                  setXAxisS(v);
                  p.onXAxisChange?.(v);
                }}
              />
            )}
            <ChartSegmented
              size="xs"
              ariaLabel="Smoothing"
              value={String(smoothing) as '0' | '5' | '30'}
              options={[
                { value: '0', label: 'Raw' },
                { value: '5', label: '5s' },
                { value: '30', label: '30s' },
              ]}
              onChange={(v) => {
                const s = Number(v) as StreamSmoothing;
                setSmoothS(s);
                p.onSmoothingChange?.(s);
              }}
            />
            {ftp && (
              <button
                type="button"
                aria-pressed={zoneShading}
                onClick={() => setZonesS((z) => !z)}
                className={`h-6 rounded-md px-2.5 text-label transition-colors duration-(--dur-fast) ${zoneShading ? 'bg-surface-active text-fg-1' : 'bg-surface-2 text-fg-2 hover:text-fg-1'}`}
              >
                Zones
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-label text-fg-3 lg:inline">Drag to select · ⌘ scroll to zoom</span>
            <button
              type="button"
              onClick={resetZoom}
              disabled={!zoomed}
              className="h-6 rounded-md px-2.5 text-label text-fg-2 transition-colors duration-(--dur-fast) enabled:hover:bg-surface-2 enabled:hover:text-fg-1 disabled:opacity-40"
            >
              Reset zoom
            </button>
          </div>
        </div>
      )}
      {/* readout row */}
      <div className="mb-3 flex flex-wrap items-end gap-x-7 gap-y-2" aria-hidden>
        <div className="flex min-w-36 flex-col gap-0.5">
          <span className="text-label text-fg-3">Cursor</span>
          <span ref={timeRef} className="num text-body-sm text-fg-2">
            Average · whole activity
          </span>
        </div>
        {tracks.map((tr) => (
          <div key={tr.key} className="flex flex-col gap-0.5">
            <span className="flex items-center gap-1.5 text-label text-fg-3">
              <span className="h-0.5 w-2.5 rounded-full" style={{ background: tk.metrics[tr.key as StreamMetric] ?? tk.fg4 }} />
              {tr.label}
            </span>
            <span className="flex items-baseline gap-1">
              <span ref={(el) => void (readoutRefs.current[tr.key] = el)} className={`num min-w-[4ch] ${tr.key === primaryKey ? 'text-stat-sm text-fg-1' : 'text-body-lg text-fg-2'}`}>
                —
              </span>
              <span className="text-label text-fg-3">{tr.unit}</span>
            </span>
          </div>
        ))}
      </div>
      <div
        ref={surfRef}
        className="relative touch-pan-y select-none rounded-xs focus-visible:outline-offset-4"
        style={{ height: H, cursor: 'crosshair' }}
        tabIndex={0}
        role="application"
        aria-roledescription="activity streams"
        aria-label="Activity streams. Left and right arrows move the cursor, plus and minus zoom, Z zooms to the selection, 0 resets."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
      >
        <canvas ref={mainRef} className="absolute inset-0" aria-hidden />
        <canvas ref={overRef} className="absolute inset-0" aria-hidden />
        {selection && selStats && (
          <div ref={chipRef} className="absolute left-0 top-1.5 z-(--z-popover) flex items-center gap-2 rounded-md bg-surface-3 py-1 pl-3 pr-1 opacity-0" onPointerDown={(e) => e.stopPropagation()}>
            <span className="num whitespace-nowrap text-label text-fg-1">
              {fmtHMS(selStats.durationSec)}
              {selStats.avgPower != null && <span> · {fmtNum(selStats.avgPower)} W</span>}
              {selStats.avgHr != null && <span className="text-fg-2"> · {fmtNum(selStats.avgHr)} bpm</span>}
            </span>
            <button type="button" onClick={zoomToSel} className="h-6 rounded-sm px-2 text-label text-fg-1 hover:bg-surface-active">
              Zoom
            </button>
            <button type="button" aria-label="Clear selection" onClick={() => commitSel(null)} className="grid size-6 place-items-center rounded-sm text-fg-2 hover:bg-surface-active hover:text-fg-1">
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function drawZoneDensity(ctx: CanvasRenderingContext2D, idx: Int32Array, xs: Float64Array, tr: Track, X: (x: number) => number, Y: (v: number) => number, bot: number, ftp: number, bounds: number[], tk: CanvasTokens) {
  const paths = tk.zones.map(() => new Path2D());
  let prev = -1;
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k];
    if (i < 0) {
      prev = -1;
      continue;
    }
    if (prev >= 0) {
      const v = (tr.y[prev] + tr.y[i]) / 2;
      const f = v / ftp;
      let z = 0;
      while (z < bounds.length && f >= bounds[z]) z++;
      const x0 = X(xs[prev]);
      const x1 = X(xs[i]);
      const p = paths[Math.min(6, z)];
      p.moveTo(x0, bot);
      p.lineTo(x0, Y(tr.y[prev]));
      p.lineTo(x1, Y(tr.y[i]));
      p.lineTo(x1, bot);
      p.closePath();
    }
    prev = i;
  }
  paths.forEach((p, z) => {
    ctx.fillStyle = tk.zones[z];
    ctx.fill(p);
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function niceStep(raw: number) {
  const p = 10 ** Math.floor(Math.log10(Math.max(1e-9, raw)));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

function fmtHM2(sec: number) {
  const m = Math.round(sec / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}
