// The pixelated real map behind the radar: Leaflet + Esri's "World Light Gray Base" canvas (no street names, no key;
// z-1 tiles shown at ×2 so every source pixel is a 2×2 block) tinted cream/green, a petal trail where I walked, and the Los Angeles city
// boundary only in zone view. Follow mode is locked to me at zoom 17 and pans in 4-px steps;
// zone mode is a fixed zoomed-out fit of the polygon. Leaflet's own controls and attribution are off.
import { useEffect, useRef, useState } from "react";
import { GeoJSON, MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Sprite } from "@/pixel/components/Sprite";
import type { SpriteName } from "@/pixel/sprites";
import type { ZoneData } from "@/world/useZone";
import "./map.css";

export const FOLLOW_ZOOM = 17;
const ZONE_MAX_ZOOM = 13;
const STEP_PX = 4;
const TICK_MS = 60;
// smoothFactor 0 = no simplification of the routed boundary (a Polyline option that setStyle forwards)
const ZONE_STYLE = { className: "map__zone", smoothFactor: 0, lineCap: "butt", lineJoin: "miter", dashArray: "8 8", weight: 4 } as L.PathOptions;
const FALLBACK_CENTRE: [number, number] = [34.0689, -118.4452];
// Esri's light-gray canvas has no labels (they live in a separate reference layer) and needs no key. Note {y}/{x}.
const TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}";
// At zoom 17 a metre is a pixel and my ×5 avatar covers ±80 px, so the trail only shows past ~80 m: bigger petals,
// a long life, and a wide step keep it readable behind a walker (and the demo walk draws the whole 250 m).
const TRAIL_STEP_M = 8;
const TRAIL_TTL_MS = 45_000;
const TRAIL_FADE_MS = 8_000;
const TRAIL_MAX = 60;

/** Metres per screen pixel at a latitude and zoom (Web Mercator, 256-px world tiles). */
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
  /**
   * Follow mode: my avatar (the radar centre) stands this many px above the map's centre, a multiple of 4. /world?demo=1
   * raises it over the walk controls; 0 (default) = the stage centre.
   */
  liftPx?: number;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Keeps Leaflet's size in sync with the stage, and drives follow / zone view. */
function Controller({ me, zoomedOut, zone, liftPx = 0 }: Pick<MapLayerProps, "me" | "zoomedOut" | "zone" | "liftPx">) {
  const map = useMap();
  const target = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize({ animate: false }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);

  // Target = my position at the follow zoom, rounded to the 4-px grid so the map only ever rests on whole pixels; the
  // map's centre sits liftPx below me, so I stand liftPx above it (on the raised radar centre).
  useEffect(() => {
    if (!me) {
      target.current = null;
      return;
    }
    const p = map.project(L.latLng(me.lat, me.lng), FOLLOW_ZOOM);
    target.current = { x: Math.round(p.x / STEP_PX) * STEP_PX, y: Math.round(p.y / STEP_PX) * STEP_PX + liftPx };
  }, [map, me?.lat, me?.lng, liftPx]); // eslint-disable-line react-hooks/exhaustive-deps

  // Entering a view: zone = fit the polygon; follow = jump straight onto me.
  useEffect(() => {
    map.invalidateSize({ animate: false });
    if (zoomedOut) {
      const b = zone?.bounds ?? [FALLBACK_CENTRE, FALLBACK_CENTRE];
      map.fitBounds(b, { animate: false, padding: [8, 8], maxZoom: ZONE_MAX_ZOOM });
    } else {
      const t = target.current;
      const c = t ? map.unproject([t.x, t.y], FOLLOW_ZOOM) : L.latLng(me?.lat ?? FALLBACK_CENTRE[0], me?.lng ?? FALLBACK_CENTRE[1]);
      map.setView(c, FOLLOW_ZOOM, { animate: false });
    }
  }, [map, zoomedOut, zone]); // eslint-disable-line react-hooks/exhaustive-deps

  // Follow: walk the centre toward the target in 4-px steps (a jump under reduced motion).
  useEffect(() => {
    if (zoomedOut) return;
    const id = window.setInterval(() => {
      const t = target.current;
      if (!t) return;
      const c = map.project(map.getCenter(), map.getZoom());
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

  return null;
}

interface Petal {
  id: number;
  lat: number;
  lng: number;
  at: number;
}

/** Petals dropped where I walked (a bloom trail): one every ~8 m, gone after 45 s, dithered out at the end. */
function Trail({ me }: { me: { lat: number; lng: number } | null }) {
  const map = useMap();
  const [petals, setPetals] = useState<Petal[]>([]);
  const last = useRef<{ lat: number; lng: number } | null>(null);
  const [, setTick] = useState(0);
  useMapEvents({ move: () => setTick((n) => n + 1) });

  useEffect(() => {
    if (!me) return;
    const l = last.current;
    if (!l) {
      last.current = me; // the first fix is where we stand, not a step
      return;
    }
    if (map.distance([l.lat, l.lng], [me.lat, me.lng]) < TRAIL_STEP_M) return;
    last.current = me;
    // a little sideways jitter (±1.5 m) so the trail doesn't look like a ruler
    const j = () => (Math.random() - 0.5) * 0.00003;
    setPetals((p) => [...p.slice(-(TRAIL_MAX - 1)), { id: Date.now() + Math.random(), lat: me.lat + j(), lng: me.lng + j(), at: Date.now() }]);
  }, [map, me?.lat, me?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const id = window.setInterval(() => {
      setPetals((p) => p.filter((x) => Date.now() - x.at < TRAIL_TTL_MS));
      setTick((n) => n + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!petals.length) return null;
  const now = Date.now();
  return (
    <>
      {petals.map((p) => {
        const pt = map.latLngToContainerPoint([p.lat, p.lng]);
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
function ZoneMarker({ me, avatar }: { me: { lat: number; lng: number } | null; avatar: SpriteName }) {
  const map = useMap();
  const [, setTick] = useState(0);
  useMapEvents({ move: () => setTick((n) => n + 1), zoom: () => setTick((n) => n + 1) });
  if (!me) return null;
  const p = map.latLngToContainerPoint([me.lat, me.lng]);
  return (
    <div className="map__marker" style={{ transform: `translate(${Math.round(p.x) - 8}px, ${Math.round(p.y) - 16}px)` }}>
      <Sprite name={avatar} scale={1} />
    </div>
  );
}

export function MapLayer({ me, zoomedOut, zone, avatar, noFix, liftPx = 0 }: MapLayerProps) {
  const empty = !zoomedOut && (noFix || !me);
  const start = me ? ([me.lat, me.lng] as [number, number]) : FALLBACK_CENTRE;
  return (
    <div className="map" data-view={zoomedOut ? "zone" : "follow"}>
      {empty ? (
        <div className="map__empty" />
      ) : (
        <MapContainer
          className="map__leaflet"
          center={start}
          zoom={FOLLOW_ZOOM}
          minZoom={8}
          maxZoom={FOLLOW_ZOOM}
          zoomControl={false}
          attributionControl={false}
          dragging={false}
          touchZoom={false}
          doubleClickZoom={false}
          scrollWheelZoom={false}
          boxZoom={false}
          keyboard={false}
          zoomAnimation={false}
          fadeAnimation={false}
          markerZoomAnimation={false}
          inertia={false}
          zoomSnap={1}
        >
          {/* z-1 tiles at tileSize 512: each 256-px source pixel is a 2×2 block, same ground scale as normal z17 */}
          <TileLayer url={TILE_URL} tileSize={512} zoomOffset={-1} maxNativeZoom={17} keepBuffer={2} />
          {zone && zoomedOut && <GeoJSON key={zone.boundaryMode} data={zone.geojson} style={ZONE_STYLE} />}
          <Controller me={me} zoomedOut={zoomedOut} zone={zone} liftPx={liftPx} />
          {!zoomedOut && <Trail me={me} />}
          {zoomedOut && <ZoneMarker me={me} avatar={avatar} />}
        </MapContainer>
      )}
      {!empty && <span className="map__attrib">© ESRI · © OPENSTREETMAP</span>}
    </div>
  );
}
