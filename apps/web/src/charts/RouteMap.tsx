/**
 * RouteMap — offline, tile-free monochrome route rendering from lat/lng streams.
 * v2: no graticule or compass chrome — the accent route on the plain surface, a scale bar,
 * a few small km markers, sentence-case start/finish labels, draw-in, optional elevation
 * shading, a position dot driven by the shared stream cursor (MotionValue of seconds, no React
 * renders), selection highlight and hover → cursor.
 */
import { useEffect, useId, useMemo, useRef } from 'react';
import { motion, useReducedMotion, isMotionValue, type MotionValue } from 'motion/react';
import type { ActivityStreams } from '@cadence/core';
import { ChartFrame } from './core/ChartFrame';
import { T, TXT } from './core/tokens';
import { useChartSize } from './core/useChartSize';
import { lowerBound } from './core/lttb';
import { fmtKm } from './format';
import { reducedFade, spring } from './motion';
import type { StreamSelection } from './StreamChart';

export interface RouteMapProps {
  streams: Pick<ActivityStreams, 't' | 'lat' | 'lng' | 'altitude' | 'distance'>;
  /** Shared cursor in seconds (MotionValue for 60 fps sync, or a plain number / null). */
  cursor?: MotionValue<number> | number | null;
  selection?: StreamSelection | null;
  /** Hovering the map reports the nearest sample's time (null on leave). */
  onHoverSec?: (sec: number | null) => void;
  elevationShading?: boolean;
  kmMarkers?: boolean;
  height?: number;
  loading?: boolean;
  className?: string;
}

const M_PER_DEG = 111_320;

export function RouteMap(props: RouteMapProps) {
  const { streams, loading, height = 340, className } = props;
  const [ref, size] = useChartSize<HTMLDivElement>();
  const has = !!streams.lat?.some((v) => v != null);
  const dist = streams.distance?.[streams.distance.length - 1];
  return (
    <div className={`min-w-0 ${className ?? ''}`}>
      <ChartFrame summary={has ? `Route map${dist ? `, ${fmtKm(dist)} km` : ''}.` : 'No GPS track'} loading={loading} empty={!has} emptyTitle="No GPS track" emptyHint="Indoor or GPS-less activity." height={height}>
        <div ref={ref} className="w-full" style={{ height }}>
          {size.width > 0 && <MapInner {...props} width={size.width} height={height} />}
        </div>
      </ChartFrame>
    </div>
  );
}

function MapInner({ streams, cursor, selection, onHoverSec, elevationShading = false, kmMarkers = true, width, height }: RouteMapProps & { width: number; height: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const reduce = useReducedMotion();
  const geo = useMemo(() => {
    const lat = streams.lat ?? [];
    const lng = streams.lng ?? [];
    const n = Math.min(lat.length, lng.length);
    let minLa = Infinity;
    let maxLa = -Infinity;
    let minLo = Infinity;
    let maxLo = -Infinity;
    for (let i = 0; i < n; i++) {
      const a = lat[i];
      const o = lng[i];
      if (a == null || o == null) continue;
      if (a < minLa) minLa = a;
      if (a > maxLa) maxLa = a;
      if (o < minLo) minLo = o;
      if (o > maxLo) maxLo = o;
    }
    const k = Math.cos((((minLa + maxLa) / 2) * Math.PI) / 180);
    return { lat, lng, n, minLa, maxLa, minLo, maxLo, k };
  }, [streams]);

  const pad = 32;
  const proj = useMemo(() => {
    const w = (geo.maxLo - geo.minLo) * geo.k || 1e-6;
    const h = geo.maxLa - geo.minLa || 1e-6;
    const s = Math.min((width - pad * 2) / w, (height - pad * 2) / h);
    const ox = (width - w * s) / 2;
    const oy = (height - h * s) / 2;
    return {
      s,
      x: (lo: number) => ox + (lo - geo.minLo) * geo.k * s,
      y: (la: number) => oy + (geo.maxLa - la) * s,
      lo: (px: number) => geo.minLo + (px - ox) / (geo.k * s),
      la: (py: number) => geo.maxLa - (py - oy) / s,
    };
  }, [geo, width, height]);

  // decimated polyline
  const poly = useMemo(() => {
    const step = Math.max(1, Math.ceil(geo.n / 1800));
    const idx: number[] = [];
    for (let i = 0; i < geo.n; i += step) idx.push(i);
    if (idx[idx.length - 1] !== geo.n - 1) idx.push(geo.n - 1);
    const pts = idx.map((i) => (geo.lat[i] == null || geo.lng[i] == null ? null : ([proj.x(geo.lng[i]!), proj.y(geo.lat[i]!)] as const)));
    let d = '';
    let pen = false;
    pts.forEach((p) => {
      if (!p) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
      pen = true;
    });
    return { idx, pts, d };
  }, [geo, proj]);

  const shaded = useMemo(() => {
    if (!elevationShading || !streams.altitude) return null;
    const alt = streams.altitude;
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of alt) if (v != null) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    const B = 6;
    const ds = Array.from({ length: B }, () => '');
    for (let k = 1; k < poly.idx.length; k++) {
      const a = poly.pts[k - 1];
      const b = poly.pts[k];
      if (!a || !b) continue;
      const v = alt[poly.idx[k]] ?? lo;
      const bin = Math.min(B - 1, Math.floor(((v - lo) / (hi - lo || 1)) * B));
      ds[bin] += `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
    }
    return ds;
  }, [elevationShading, streams.altitude, poly]);

  // scale bar
  const scale = useMemo(() => {
    const mPerPx = M_PER_DEG / proj.s;
    const target = mPerPx * 90;
    const nice = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000].reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
    return { px: nice / mPerPx, label: nice >= 1000 ? `${nice / 1000} km` : `${nice} m` };
  }, [proj]);

  // km markers
  const markers = useMemo(() => {
    const d = streams.distance;
    if (!kmMarkers || !d) return [];
    const total = d[d.length - 1] ?? 0;
    const every = [1000, 2000, 5000, 10000, 20000, 50000].find((e) => total / e <= 6) ?? 50000;
    const out: { km: number; x: number; y: number }[] = [];
    let next = every;
    for (let i = 0; i < d.length; i++) {
      const v = d[i];
      if (v == null || v < next) continue;
      if (total - v > every * 0.4 && geo.lat[i] != null && geo.lng[i] != null) out.push({ km: next / 1000, x: proj.x(geo.lng[i]!), y: proj.y(geo.lat[i]!) });
      next += every;
    }
    return out;
  }, [streams.distance, kmMarkers, geo, proj]);

  const first = poly.pts.find(Boolean);
  const last = [...poly.pts].reverse().find(Boolean);
  const loop = !!first && !!last && Math.hypot(first[0] - last[0], first[1] - last[1]) < 18;
  const side = (p: readonly [number, number]) => (p[0] > width - 90 ? 'left' : 'right');

  // cursor dot (imperative)
  const dotRef = useRef<SVGGElement>(null);
  useEffect(() => {
    const t = streams.t;
    const place = (sec: number | null | undefined) => {
      const el = dotRef.current;
      if (!el) return;
      if (sec == null || !Number.isFinite(sec)) {
        el.style.opacity = '0';
        return;
      }
      let i = Math.min(t.length - 1, lowerBound(t, sec));
      // walk to the nearest sample with a fix
      let j = i;
      while (j > 0 && (geo.lat[j] == null || geo.lng[j] == null)) j--;
      i = j;
      if (geo.lat[i] == null || geo.lng[i] == null) {
        el.style.opacity = '0';
        return;
      }
      el.setAttribute('transform', `translate(${proj.x(geo.lng[i]!).toFixed(1)} ${proj.y(geo.lat[i]!).toFixed(1)})`);
      el.style.opacity = '1';
    };
    if (isMotionValue(cursor)) {
      place(cursor.get());
      return cursor.on('change', place);
    }
    place(cursor as number | null | undefined);
  }, [cursor, streams.t, geo, proj]);

  const selD = useMemo(() => {
    if (!selection) return '';
    const t = streams.t;
    const a = lowerBound(t, selection.startSec);
    const b = Math.min(t.length - 1, lowerBound(t, selection.endSec));
    let d = '';
    let pen = false;
    const step = Math.max(1, Math.ceil((b - a) / 900));
    for (let i = a; i <= b; i += step) {
      if (geo.lat[i] == null || geo.lng[i] == null) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${proj.x(geo.lng[i]!).toFixed(1)} ${proj.y(geo.lat[i]!).toFixed(1)}`;
      pen = true;
    }
    return d;
  }, [selection, streams.t, geo, proj]);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    let best = -1;
    let bd = 24 * 24;
    for (let k = 0; k < poly.pts.length; k++) {
      const p = poly.pts[k];
      if (!p) continue;
      const d = (p[0] - px) ** 2 + (p[1] - py) ** 2;
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    const sec = best >= 0 ? streams.t[poly.idx[best]] : null;
    if (isMotionValue(cursor)) cursor.set(sec ?? Number.NaN);
    onHoverSec?.(sec);
  };
  const onLeave = () => {
    if (isMotionValue(cursor)) cursor.set(Number.NaN);
    onHoverSec?.(null);
  };

  const draw = reduce ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: reducedFade } : { initial: { pathLength: 0 }, animate: { pathLength: 1 }, transition: { ...spring.gentle, visualDuration: 1.1 } };

  return (
    <svg width={width} height={height} className="block touch-pan-y select-none" onPointerMove={onMove} onPointerLeave={onLeave} role="img" aria-label="Route map">
      <defs>
        <mask id={`${uid}-draw`} maskUnits="userSpaceOnUse">
          <motion.path d={poly.d} fill="none" stroke="#fff" strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" {...draw} />
        </mask>
      </defs>
      {/* track */}
      <g mask={`url(#${uid}-draw)`}>
        <path d={poly.d} fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: T.bg, strokeWidth: 6 }} />
        {shaded ? (
          shaded.map((d, b) => <path key={b} d={d} fill="none" strokeLinecap="round" style={{ stroke: T.accent, strokeWidth: 2, opacity: 0.35 + (b / (shaded.length - 1)) * 0.65 }} />)
        ) : (
          <path d={poly.d} fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: T.accent, strokeWidth: 2 }} />
        )}
      </g>
      {selD && <path d={selD} fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: T.fg1, strokeWidth: 3 }} />}
      {/* km markers */}
      <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: reduce ? 0 : 0.9, duration: 0.24 }} aria-hidden>
        {markers.map((m) => (
          <g key={m.km}>
            <circle cx={m.x} cy={m.y} r={2} style={{ fill: T.bg, stroke: T.fg3, strokeWidth: 1.25 }} />
            <text x={m.x + 6} y={m.y - 6} style={{ ...TXT, fill: T.fg3 }}>
              {m.km}
            </text>
          </g>
        ))}
      </motion.g>
      {/* start / finish */}
      {first && (
        <g aria-hidden>
          <circle cx={first[0]} cy={first[1]} r={4} style={{ fill: T.fg1, stroke: T.bg, strokeWidth: 2 }} />
          <text x={side(first) === 'left' ? first[0] - 10 : first[0] + 10} y={first[1] + (loop ? -10 : 4)} textAnchor={side(first) === 'left' ? 'end' : 'start'} style={{ ...TXT, fill: T.fg2 }}>
            {loop ? 'Start · finish' : 'Start'}
          </text>
        </g>
      )}
      {last && !loop && (
        <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: reduce ? 0 : 1.0, duration: 0.24 }} aria-hidden>
          <circle cx={last[0]} cy={last[1]} r={4} style={{ fill: T.bg, stroke: T.fg1, strokeWidth: 1.5 }} />
          <text x={side(last) === 'left' ? last[0] - 10 : last[0] + 10} y={last[1] + 4} textAnchor={side(last) === 'left' ? 'end' : 'start'} style={{ ...TXT, fill: T.fg2 }}>
            Finish
          </text>
        </motion.g>
      )}
      {/* scale bar */}
      <g transform={`translate(12 ${height - 14})`} aria-hidden>
        <path d={`M0 -3V0H${scale.px.toFixed(1)}V-3`} fill="none" style={{ stroke: T.fg4 }} />
        <text x={scale.px + 8} y={0} dominantBaseline="central" style={{ ...TXT, fill: T.fg3 }}>
          {scale.label}
        </text>
      </g>
      {/* cursor */}
      <g ref={dotRef} style={{ opacity: 0 }} pointerEvents="none">
        <circle r={10} style={{ fill: T.a2 }} />
        <circle r={4.5} style={{ fill: T.accent, stroke: T.bg, strokeWidth: 2 }} />
      </g>
    </svg>
  );
}
