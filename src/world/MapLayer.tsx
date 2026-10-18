// The pixelated real map behind the radar: MapLibre GL + OpenFreeMap vector tiles in our own label-free palette style
// (map-style.ts), rendered at pixelRatio 0.5 and upscaled with image-rendering: pixelated so every rendered pixel is a
// 2×2 block. A petal trail marks where I walked, and the Los Angeles city boundary shows only in zone view.
// Follow mode is locked to me at the follow zoom and pans in 4-px steps; zone mode is a fixed zoomed-out fit of the polygon.
// Everything interactive is off and there are no MapLibre controls.
import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// v6 runs its tiles in an ES-module worker. Vite's dev server rewrites that file (injecting its HMR client, which cannot
// run in a worker) and the default lookup resolves inside the pre-bundled deps folder, so hand MapLibre the untouched
// source as a blob instead.
import workerSource from "maplibre-gl/dist/maplibre-gl-worker.mjs?raw";
import { Sprite } from "@/pixel/components/Sprite";
import type { SpriteName } from "@/pixel/sprites";
import type { ZoneData } from "@/world/useZone";
import { mapStyle, ZONE_SOURCE } from "@/world/map-style";
import "./map.css";

maplibregl.setWorkerUrl(URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" })));

/** The follow scale in the old Leaflet (256-px tile) numbering; radar rings are sized from it. */
export const FOLLOW_ZOOM = 17;
/** MapLibre uses 512-px tiles, so the same metres-per-pixel is one zoom level lower. */
const ML_OFFSET = 1;
const ML_FOLLOW_ZOOM = FOLLOW_ZOOM - ML_OFFSET;
const ML_ZONE_MAX_ZOOM = 13 - ML_OFFSET;
const WORLD_PX = 512;
const STEP_PX = 4;
const TICK_MS = 60;
const FALLBACK_CENTRE: [number, number] = [34.0689, -118.4452];
// At zoom 17 a metre is a pixel and my ×5 avatar covers ±80 px, so the trail only shows past ~80 m: bigger petals,
// a long life, and a wide step keep it readable behind a walker (and the demo walk draws the whole 250 m).
const TRAIL_STEP_M = 8;
const TRAIL_TTL_MS = 45_000;
const TRAIL_FADE_MS = 8_000;
const TRAIL_MAX = 60;
const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/** Metres per screen pixel at a latitude and zoom (Web Mercator, 256-px world tiles at zoom 0, i.e. the old Leaflet numbering). */
export function metersPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

export interface MapLayerProps {
  /** My position (real GPS or the demo's simulated one); null = no fix. */
  me: { lat: number; lng: number } | null;
  /** Zone view: zoomed out to the whole polygon, no follow. */
  zoomedOut: boolean;
  zone: ZoneData | null;
  avatar: SpriteName;
  /** Shown as an empty paper map when there is no position and we are not in zone view. */
  noFix?: boolean;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** A point in world pixels at the MapLibre follow zoom (the 4-px grid is measured here). */
function worldPx(lat: number, lng: number): { x: number; y: number } {
  const m = maplibregl.MercatorCoordinate.fromLngLat([lng, lat]);
  const size = WORLD_PX * 2 ** ML_FOLLOW_ZOOM;
  return { x: m.x * size, y: m.y * size };
}

function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371008.8;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Re-render whenever the map moves or zooms, so overlays glued to the ground follow it. */
function useMapTick(map: maplibregl.Map | null): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!map) return;
    const bump = () => setTick((n) => n + 1);
    map.on("move", bump);
    return () => {
      map.off("move", bump);
    };
  }, [map]);
}

/** Drives follow / zone view on an existing map. */
function useController(map: maplibregl.Map | null, styleReady: boolean, { me, zoomedOut, zone }: Pick<MapLayerProps, "me" | "zoomedOut" | "zone">) {
  const target = useRef<{ x: number; y: number } | null>(null);

  // Target = my position in world pixels, rounded to the 4-px grid so the map only ever rests on whole pixels.
  useEffect(() => {
    if (!me) {
      target.current = null;
      return;
    }
    const p = worldPx(me.lat, me.lng);
    target.current = { x: Math.round(p.x / STEP_PX) * STEP_PX, y: Math.round(p.y / STEP_PX) * STEP_PX };
  }, [me?.lat, me?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // Entering a view: zone = fit the polygon; follow = jump straight onto me.
  useEffect(() => {
    if (!map) return;
    map.resize();
    if (zoomedOut) {
      const [[s, w], [n, e]] = zone?.bounds ?? [FALLBACK_CENTRE, FALLBACK_CENTRE];
      map.fitBounds(
        [
          [w, s],
          [e, n],
        ],
        { animate: false, padding: 8, maxZoom: ML_ZONE_MAX_ZOOM },
      );
    } else {
      const t = target.current;
      const size = WORLD_PX * 2 ** ML_FOLLOW_ZOOM;
      const c = t
        ? new maplibregl.MercatorCoordinate(t.x / size, t.y / size, 0).toLngLat()
        : new maplibregl.LngLat(me?.lng ?? FALLBACK_CENTRE[1], me?.lat ?? FALLBACK_CENTRE[0]);
      map.jumpTo({ center: c, zoom: ML_FOLLOW_ZOOM, bearing: 0, pitch: 0 });
    }
  }, [map, zoomedOut, zone]); // eslint-disable-line react-hooks/exhaustive-deps

  // Follow: walk the centre toward the target in 4-px steps (a jump under reduced motion).
  useEffect(() => {
    if (!map || zoomedOut) return;
    const id = window.setInterval(() => {
      const t = target.current;
      if (!t) return;
      const c = worldPx(map.getCenter().lat, map.getCenter().lng);
      const dx = t.x - c.x;
      const dy = t.y - c.y;
      if (Math.abs(dx) < 0.75 && Math.abs(dy) < 0.75) return;
      const reduce = prefersReducedMotion();
      const sx = reduce ? dx : Math.sign(dx) * Math.min(STEP_PX, Math.abs(dx));
      const sy = reduce ? dy : Math.sign(dy) * Math.min(STEP_PX, Math.abs(dy));
      map.panBy([Math.round(sx), Math.round(sy)], { animate: false });
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [map, zoomedOut]);

  // The Los Angeles outline lives in the style as an empty GeoJSON source; fill it only in zone view.
  useEffect(() => {
    if (!map || !styleReady) return;
    (map.getSource(ZONE_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(zone && zoomedOut ? zone.geojson : EMPTY_FC);
  }, [map, styleReady, zoomedOut, zone]);
}

interface Petal {
  id: number;
  lat: number;
  lng: number;
  at: number;
}

/** Petals dropped where I walked (a bloom trail): one every ~8 m, gone after 45 s, dithered out at the end. */
function Trail({ map, me }: { map: maplibregl.Map | null; me: { lat: number; lng: number } | null }) {
  const [petals, setPetals] = useState<Petal[]>([]);
  const last = useRef<{ lat: number; lng: number } | null>(null);
  const [, setTick] = useState(0);
  useMapTick(map);

  useEffect(() => {
    if (!me) return;
    const l = last.current;
    if (!l) {
      last.current = me; // the first fix is where we stand, not a step
      return;
    }
    if (distanceM(l, me) < TRAIL_STEP_M) return;
    last.current = me;
    // a little sideways jitter (±1.5 m) so the trail doesn't look like a ruler
    const j = () => (Math.random() - 0.5) * 0.00003;
    setPetals((p) => [...p.slice(-(TRAIL_MAX - 1)), { id: Date.now() + Math.random(), lat: me.lat + j(), lng: me.lng + j(), at: Date.now() }]);
  }, [me?.lat, me?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const id = window.setInterval(() => {
      setPetals((p) => p.filter((x) => Date.now() - x.at < TRAIL_TTL_MS));
      setTick((n) => n + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!map || !petals.length) return null;
  const now = Date.now();
  return (
    <>
      {petals.map((p) => {
        const pt = map.project([p.lng, p.lat]);
        const fading = now - p.at > TRAIL_TTL_MS - TRAIL_FADE_MS;
        return (
          <div
            key={p.id}
            className={`map__petal ${fading ? "map__petal--fade" : ""}`}
            style={{ transform: `translate(${Math.round(pt.x) - 16}px, ${Math.round(pt.y) - 16}px)` }}
          >
            <Sprite name="fx_petal" anim="loop" scale={2} />
          </div>
        );
      })}
    </>
  );
}

/** My avatar as a 16-px marker while zoomed out (the big centred avatar is hidden then). */
function ZoneMarker({ map, me, avatar }: { map: maplibregl.Map | null; me: { lat: number; lng: number } | null; avatar: SpriteName }) {
  useMapTick(map);
  if (!map || !me) return null;
  const p = map.project([me.lng, me.lat]);
  return (
    <div className="map__marker" style={{ transform: `translate(${Math.round(p.x) - 8}px, ${Math.round(p.y) - 16}px)` }}>
      <Sprite name={avatar} scale={1} />
    </div>
  );
}

export function MapLayer({ me, zoomedOut, zone, avatar, noFix }: MapLayerProps) {
  const empty = !zoomedOut && (noFix || !me);
  const holder = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const [styleReady, setStyleReady] = useState(false);
  const initial = useRef({ me, zoomedOut });
  initial.current = { me, zoomedOut };

  // One map for as long as there is something to show (the empty paper state has none). Creation is deferred a tick so a
  // StrictMode mount/unmount/mount never builds a map that is torn down at once (MapLibre's shared worker pool does
  // not survive that: its last map leaving terminates the workers).
  useEffect(() => {
    const el = holder.current;
    if (empty || !el) return;
    let m: maplibregl.Map | null = null;
    let ro: ResizeObserver | null = null;
    const timer = window.setTimeout(() => {
      const start = initial.current.me;
      m = new maplibregl.Map({
        container: el,
        style: mapStyle,
        center: start ? [start.lng, start.lat] : [FALLBACK_CENTRE[1], FALLBACK_CENTRE[0]],
        zoom: ML_FOLLOW_ZOOM,
        minZoom: 3,
        maxZoom: ML_FOLLOW_ZOOM,
        bearing: 0,
        pitch: 0,
        maxPitch: 0,
        pixelRatio: 0.5,
        canvasContextAttributes: { antialias: false },
        attributionControl: false,
        fadeDuration: 0,
        renderWorldCopies: false,
        interactive: false,
        dragPan: false,
        scrollZoom: false,
        boxZoom: false,
        dragRotate: false,
        keyboard: false,
        doubleClickZoom: false,
        touchZoomRotate: false,
        touchPitch: false,
        pitchWithRotate: false,
      });
      const made = m;
      const ready = () => {
        if (made.getSource(ZONE_SOURCE)) {
          setStyleReady(true);
          made.off("styledata", ready);
        }
      };
      made.on("styledata", ready);
      ready();
      ro = new ResizeObserver(() => made.resize());
      ro.observe(el);
      setMap(made);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      ro?.disconnect();
      m?.remove();
      setMap(null);
      setStyleReady(false);
    };
  }, [empty]);

  useController(map, styleReady, { me, zoomedOut, zone });

  return (
    <div className="map" data-view={zoomedOut ? "zone" : "follow"}>
      {empty ? (
        <div className="map__empty" />
      ) : (
        <div className="map__view">
          <div ref={holder} className="map__gl" />
          {!zoomedOut && <Trail map={map} me={me} />}
          {zoomedOut && <ZoneMarker map={map} me={me} avatar={avatar} />}
        </div>
      )}
      {!empty && <span className="map__attrib">© OPENFREEMAP · © OPENMAPTILES · © OSM</span>}
    </div>
  );
}
