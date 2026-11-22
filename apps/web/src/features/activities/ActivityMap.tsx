/**
 * ActivityMap — interactive MapLibre basemap for outdoor activities (lazy-loaded: this module and
 * maplibre-gl only ever load in their own chunk, via `MapSection`).
 *
 * - The route is drawn immediately on a plain, exactly sized surface (a background-only style), so
 *   it renders with no network at all. The OpenFreeMap vector style for the current theme
 *   (`positron` light / `dark` dark) is fetched in parallel and swapped in when it arrives; if the
 *   style or its tiles cannot load, the plain surface stays and errors are swallowed (no console
 *   noise, no error UI).
 * - Route in the sport's colour over a canvas-coloured casing; start / finish markers; numbered lap
 *   markers when laps are few and spread out; the selected range (chart drag or lap click) is
 *   highlighted and the rest of the route dimmed.
 * - Two-way scrub sync through the shared stream cursor (a MotionValue of seconds): the chart moves
 *   a dot along the route, hovering the route moves the chart's crosshair.
 * - Follows `<html data-theme>` / `data-accent` live.
 */
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { ActivityStreams, Lap, Sport } from '@cadence/core/domain';
import type { MotionValue } from 'motion/react';
import { Maximize, Minus, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { StreamSelection } from '@/charts';
import './ActivityMap.css';

maplibregl.setWorkerUrl(workerUrl);

const STYLE_URL = { light: 'https://tiles.openfreemap.org/styles/positron', dark: 'https://tiles.openfreemap.org/styles/dark' } as const;
const STYLE_TIMEOUT_MS = 6000;
const ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

export interface ActivityMapProps {
  streams: ActivityStreams;
  sport: Sport;
  laps?: Lap[];
  cursor: MotionValue<number>;
  selection: StreamSelection | null;
  height: number;
  /** Called when WebGL is unavailable: the caller renders the SVG route instead. */
  onUnsupported?: () => void;
}

// ───────────────────────────── geometry ─────────────────────────────

interface Geo {
  coords: [number, number][]; // [lng, lat]
  times: number[]; // stream seconds per coord
  bounds: [[number, number], [number, number]];
  /** ≤ 1500 coords for hover hit-testing. */
  probe: { c: [number, number]; t: number }[];
}

function buildGeo(s: ActivityStreams): Geo | null {
  const lat = s.lat ?? [];
  const lng = s.lng ?? [];
  const coords: [number, number][] = [];
  const times: number[] = [];
  let w = Infinity;
  let e = -Infinity;
  let so = Infinity;
  let n = -Infinity;
  for (let i = 0; i < s.t.length; i++) {
    const a = lat[i];
    const b = lng[i];
    if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b) || (a === 0 && b === 0)) continue;
    coords.push([b, a]);
    times.push(s.t[i]!);
    if (b < w) w = b;
    if (b > e) e = b;
    if (a < so) so = a;
    if (a > n) n = a;
  }
  if (coords.length < 2) return null;
  const step = Math.max(1, Math.ceil(coords.length / 1500));
  const probe: Geo['probe'] = [];
  for (let i = 0; i < coords.length; i += step) probe.push({ c: coords[i]!, t: times[i]! });
  return { coords, times, bounds: [[w, so], [e, n]], probe };
}

/** Index of the coord at (or just before) stream second `sec`. */
function indexAt(times: number[], sec: number): number {
  let lo = 0;
  let hi = times.length - 1;
  if (sec <= times[0]!) return 0;
  if (sec >= times[hi]!) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid]! <= sec) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const metres = (a: [number, number], b: [number, number]) => {
  const k = Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180)) * 111_320;
  return Math.hypot((a[0] - b[0]) * k, (a[1] - b[1]) * 111_320);
};

/** Fit padding: room for the start / finish labels at the sides, less on phones. */
const padFor = (w: number) => {
  const side = Math.round(Math.max(28, Math.min(96, w * 0.12)));
  return { top: 44, bottom: 44, left: side, right: side };
};

// ───────────────────────────── colours ─────────────────────────────

interface Palette {
  theme: 'light' | 'dark';
  bg: string;
  route: string;
  casing: string;
  dim: string;
}

/** Resolve a CSS colour token to an rgba() string MapLibre can parse (tokens may be oklch / color-mix). */
function resolveColor(expr: string, host: HTMLElement): string {
  const probe = document.createElement('span');
  probe.style.color = expr;
  probe.style.display = 'none';
  host.appendChild(probe);
  const css = getComputedStyle(probe).color;
  probe.remove();
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return css;
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgba(${r}, ${g}, ${b}, ${((a ?? 255) / 255).toFixed(3)})`;
}

const SPORT_VAR: Partial<Record<Sport, string>> = {
  bike: '--color-sport-bike',
  run: '--color-sport-run',
  swim: '--color-sport-swim',
  walk: '--color-sport-walk',
  hike: '--color-sport-hike',
  row: '--color-sport-row',
  ski: '--color-sport-ski',
  strength: '--color-sport-strength',
};

function readPalette(host: HTMLElement, sport: Sport): Palette {
  const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  return {
    theme,
    bg: resolveColor('var(--color-surface-1)', host),
    route: resolveColor(`var(${SPORT_VAR[sport] ?? '--color-fg-2'})`, host),
    casing: resolveColor('var(--color-canvas)', host),
    dim: resolveColor('var(--color-fg-4)', host),
  };
}

// ───────────────────────────── style ─────────────────────────────

type GeoData = Parameters<GeoJSONSource['setData']>[0];
const EMPTY = { type: 'FeatureCollection', features: [] } as unknown as GeoData;
const lineOf = (coordinates: [number, number][]) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }) as unknown as GeoData;

function composeStyle(base: StyleSpecification | null, geo: Geo, pal: Palette): StyleSpecification {
  const line = lineOf(geo.coords);
  const plain: StyleSpecification = { version: 8, sources: {}, layers: [{ id: 'cad-bg', type: 'background', paint: { 'background-color': pal.bg } }] };
  const b = base ?? plain;
  const tiles = !!base;
  return {
    ...b,
    sources: {
      ...b.sources,
      'cad-route': { type: 'geojson', data: line },
      'cad-sel': { type: 'geojson', data: EMPTY },
    },
    layers: [
      ...b.layers,
      {
        id: 'cad-route-casing',
        type: 'line',
        source: 'cad-route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': pal.casing, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 4, 14, 7, 18, 10], 'line-opacity': tiles ? 0.85 : 0.6 },
      },
      {
        id: 'cad-route',
        type: 'line',
        source: 'cad-route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': pal.route, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 14, 3.5, 18, 6] },
      },
      {
        id: 'cad-sel-casing',
        type: 'line',
        source: 'cad-sel',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': pal.casing, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 7, 14, 10, 18, 14] },
      },
      {
        id: 'cad-sel',
        type: 'line',
        source: 'cad-sel',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': pal.route, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 4, 14, 6, 18, 9] },
      },
    ],
  };
}

const styleCache = new Map<string, Promise<StyleSpecification | null>>();

/** Fetch an OpenFreeMap style once per session; null when offline / blocked / slow. */
function fetchStyle(url: string): Promise<StyleSpecification | null> {
  let p = styleCache.get(url);
  if (!p) {
    p = (async () => {
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), STYLE_TIMEOUT_MS);
        const res = await fetch(url, { signal: ctl.signal });
        clearTimeout(timer);
        if (!res.ok) return null;
        const json = (await res.json()) as StyleSpecification;
        return json && Array.isArray(json.layers) ? json : null;
      } catch {
        return null;
      }
    })();
    styleCache.set(url, p);
    void p.then((v) => v === null && styleCache.delete(url)); // retry on the next mount
  }
  return p;
}

// ───────────────────────────── markers ─────────────────────────────

function markerEl(kind: 'start' | 'finish' | 'both' | 'lap' | 'cursor', text?: string): HTMLElement {
  const el = document.createElement('div');
  el.className = `cad-mk cad-mk-${kind}`;
  if (kind === 'lap') el.textContent = text ?? '';
  else if (kind !== 'cursor') {
    const dot = document.createElement('span');
    dot.className = 'cad-mk-dot';
    const label = document.createElement('span');
    label.className = 'cad-mk-label';
    label.textContent = kind === 'start' ? 'Start' : kind === 'finish' ? 'Finish' : 'Start · finish';
    el.appendChild(dot);
    el.appendChild(label);
  }
  el.setAttribute('aria-hidden', 'true');
  return el;
}

// ───────────────────────────── component ─────────────────────────────

export default function ActivityMap({ streams, sport, laps, cursor, selection, height, onUnsupported }: ActivityMapProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const geo = useMemo(() => buildGeo(streams), [streams]);
  const [moved, setMoved] = useState(false);
  const [tiles, setTiles] = useState(false);
  const selRef = useRef(selection);
  selRef.current = selection;

  // create the map once per route
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !geo) return;
    let pal = readPalette(host, sport);
    let base: StyleSpecification | null = null;
    let disposed = false;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: host,
        style: composeStyle(null, geo, pal),
        bounds: geo.bounds,
        fitBoundsOptions: { padding: padFor(host.clientWidth), maxZoom: 16 },
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        maxZoom: 18,
        fadeDuration: 0,
        cancelPendingTileRequestsWhileZooming: true,
      });
    } catch {
      onUnsupported?.();
      return;
    }
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.on('error', () => {
      /* tiles / glyphs / sprites unreachable: keep the plain surface, no console noise */
    });
    let attributed = false;

    // start / finish / laps
    const first = geo.coords[0]!;
    const last = geo.coords[geo.coords.length - 1]!;
    const markers: maplibregl.Marker[] = [];
    if (metres(first, last) < 120) markers.push(new maplibregl.Marker({ element: markerEl('both'), anchor: 'left', offset: [-7, 0] }).setLngLat(first));
    else {
      markers.push(new maplibregl.Marker({ element: markerEl('start'), anchor: 'left', offset: [-7, 0] }).setLngLat(first));
      // the finish label goes left of its dot when the finish lies west of the start (start label is right)
      const labelLeft = last[0] < first[0];
      const fin = markerEl('finish');
      if (labelLeft) fin.style.flexDirection = 'row-reverse';
      markers.push(new maplibregl.Marker({ element: fin, anchor: labelLeft ? 'right' : 'left', offset: [labelLeft ? 7 : -7, 0] }).setLngLat(last));
    }
    if (laps && laps.length > 1 && laps.length <= 30) {
      const pts = laps.slice(1).map((l) => geo.coords[indexAt(geo.times, l.startSec)]!);
      let minGap = Infinity;
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) minGap = Math.min(minGap, metres(pts[i]!, pts[j]!));
      for (const p of pts) minGap = Math.min(minGap, metres(p, first), metres(p, last));
      if (minGap > 250 || pts.length === 1) pts.forEach((p, i) => markers.push(new maplibregl.Marker({ element: markerEl('lap', String(i + 2)) }).setLngLat(p)));
    }
    for (const m of markers) m.addTo(map);
    const cursorEl = markerEl('cursor');
    cursorEl.style.visibility = 'hidden';
    const cursorMk = new maplibregl.Marker({ element: cursorEl }).setLngLat(first).addTo(map);

    const applySelection = () => {
      const src = map.getSource('cad-sel') as GeoJSONSource | undefined;
      if (!src) return;
      const s = selRef.current;
      if (!s) {
        src.setData(EMPTY);
        if (map.getLayer('cad-route')) map.setPaintProperty('cad-route', 'line-opacity', 1);
        return;
      }
      const a = indexAt(geo.times, s.startSec);
      const z = indexAt(geo.times, s.endSec);
      const seg = geo.coords.slice(a, Math.max(a + 2, z + 1));
      src.setData(lineOf(seg));
      if (map.getLayer('cad-route')) map.setPaintProperty('cad-route', 'line-opacity', 0.5);
    };
    map.on('style.load', applySelection);

    const restyle = () => {
      pal = readPalette(host, sport);
      host.style.background = pal.bg;
      map.setStyle(composeStyle(base, geo, pal), { diff: false });
    };
    const loadTiles = () => {
      const want = pal.theme;
      void fetchStyle(STYLE_URL[want]).then((json) => {
        if (disposed || !json || pal.theme !== want) return;
        base = json;
        setTiles(true);
        restyle();
        if (!attributed) {
          attributed = true;
          map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: ATTRIBUTION }), 'bottom-right');
        }
      });
    };
    host.style.background = pal.bg;
    loadTiles();

    // theme / accent changes
    const mo = new MutationObserver(() => {
      const next = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
      const themeChanged = next !== pal.theme;
      if (themeChanged) {
        base = null;
        setTiles(false);
      }
      restyle();
      if (themeChanged) loadTiles();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent'] });

    // chart → map: move the dot along the route
    const showCursor = (sec: number) => {
      if (!Number.isFinite(sec)) {
        cursorEl.style.visibility = 'hidden';
        return;
      }
      cursorMk.setLngLat(geo.coords[indexAt(geo.times, sec)]!);
      cursorEl.style.visibility = 'visible';
    };
    const unsub = cursor.on('change', showCursor);
    showCursor(cursor.get());

    // map → chart: hovering near the route sets the shared cursor
    let hovering = false;
    const onMove = (e: maplibregl.MapMouseEvent) => {
      let best = Infinity;
      let bt = NaN;
      for (const p of geo.probe) {
        const q = map.project(p.c);
        const d = (q.x - e.point.x) ** 2 + (q.y - e.point.y) ** 2;
        if (d < best) {
          best = d;
          bt = p.t;
        }
      }
      if (best <= 22 * 22) {
        hovering = true;
        cursor.set(bt);
        map.getCanvas().style.cursor = 'crosshair';
      } else if (hovering) {
        hovering = false;
        cursor.set(Number.NaN);
        map.getCanvas().style.cursor = '';
      }
    };
    const onOut = () => {
      if (hovering) cursor.set(Number.NaN);
      hovering = false;
    };
    map.on('mousemove', onMove);
    map.on('mouseout', onOut);
    const onUser = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) setMoved(true);
    };
    map.on('movestart', onUser);

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(host);

    return () => {
      disposed = true;
      unsub();
      mo.disconnect();
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo, sport, laps]);

  // selection → highlight
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !geo) return;
    const run = () => {
      const src = map.getSource('cad-sel') as GeoJSONSource | undefined;
      if (!src) return;
      if (!selection) {
        src.setData(EMPTY);
        if (map.getLayer('cad-route')) map.setPaintProperty('cad-route', 'line-opacity', 1);
        return;
      }
      const a = indexAt(geo.times, selection.startSec);
      const z = indexAt(geo.times, selection.endSec);
      src.setData(lineOf(geo.coords.slice(a, Math.max(a + 2, z + 1))));
      if (map.getLayer('cad-route')) map.setPaintProperty('cad-route', 'line-opacity', 0.5);
    };
    if (map.isStyleLoaded()) run();
    else map.once('idle', run);
  }, [selection, geo]);

  const zoom = (d: number) => mapRef.current?.easeTo({ zoom: mapRef.current.getZoom() + d, duration: 220 });
  const fit = () => {
    const map = mapRef.current;
    if (!map || !geo) return;
    if (selection) {
      const a = indexAt(geo.times, selection.startSec);
      const z = indexAt(geo.times, selection.endSec);
      const seg = geo.coords.slice(a, z + 1);
      if (seg.length > 1) {
        const b = seg.reduce((acc, c) => acc.extend(c), new maplibregl.LngLatBounds(seg[0]!, seg[0]!));
        map.fitBounds(b, { padding: 48, maxZoom: 17, duration: 450 });
        return;
      }
    }
    map.fitBounds(geo.bounds, { padding: padFor(hostRef.current?.clientWidth ?? 800), maxZoom: 16, duration: 450 });
    setMoved(false);
  };

  return (
    <div className="cad-map relative h-full w-full" style={{ height }}>
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} role="application" aria-label={`Route map${tiles ? '' : ' (no basemap)'}. Drag to pan, scroll or use the buttons to zoom.`} />
      <div className="absolute top-3 right-3 z-10 flex flex-col gap-1">
        <MapButton label="Zoom in" onClick={() => zoom(1)}>
          <Plus />
        </MapButton>
        <MapButton label="Zoom out" onClick={() => zoom(-1)}>
          <Minus />
        </MapButton>
        <MapButton label={selection ? 'Fit selection' : 'Fit route'} onClick={fit} dim={!moved && !selection}>
          <Maximize />
        </MapButton>
      </div>
    </div>
  );
}

function MapButton({ label, onClick, children, dim }: { label: string; onClick: () => void; children: React.ReactNode; dim?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-md bg-surface-2/90 text-fg-2 backdrop-blur-sm transition-colors duration-(--dur-fast) hover:bg-surface-3 hover:text-fg-1 focus-visible:outline-2 focus-visible:outline-focus [&_svg]:size-4"
      style={dim ? { opacity: 0.75 } : undefined}
    >
      {children}
    </button>
  );
}
