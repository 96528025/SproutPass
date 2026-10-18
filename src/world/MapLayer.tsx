// The pixelated real map behind the radar: Leaflet + OpenStreetMap tiles (z-1 tiles shown at ×2 so every source pixel
// is a 2×2 block), the Los Angeles city boundary on top. Follow mode is locked to me at zoom 17 and pans in 4-px steps;
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
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Keeps Leaflet's size in sync with the stage, and drives follow / zone view. */
function Controller({ me, zoomedOut, zone }: Pick<MapLayerProps, "me" | "zoomedOut" | "zone">) {
  const map = useMap();
  const target = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize({ animate: false }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);

  // Target = my position at the follow zoom, rounded to the 4-px grid so the map only ever rests on whole pixels.
  useEffect(() => {
    if (!me) {
      target.current = null;
      return;
    }
    const p = map.project(L.latLng(me.lat, me.lng), FOLLOW_ZOOM);
    target.current = { x: Math.round(p.x / STEP_PX) * STEP_PX, y: Math.round(p.y / STEP_PX) * STEP_PX };
  }, [map, me?.lat, me?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

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

export function MapLayer({ me, zoomedOut, zone, avatar, noFix }: MapLayerProps) {
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
          <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" tileSize={512} zoomOffset={-1} maxNativeZoom={17} keepBuffer={2} />
          {zone && <GeoJSON key={zone.boundaryMode} data={zone.geojson} style={ZONE_STYLE} />}
          <Controller me={me} zoomedOut={zoomedOut} zone={zone} />
          {zoomedOut && <ZoneMarker me={me} avatar={avatar} />}
        </MapContainer>
      )}
      {!empty && <span className="map__attrib">© OPENSTREETMAP</span>}
    </div>
  );
}
