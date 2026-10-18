// The UCLA 10-minute-drive zone: loads the committed isochrone (public/map/ucla-10min.json, fetched once offline by
// tools/map/fetch-isochrone.ts; the app never calls Valhalla) and answers "is this point inside?".
// Every polygon component and ring is kept; a point inside a hole counts as outside.
import { useEffect, useState } from "react";

type Ring = [number, number][]; // GeoJSON [lng, lat]
type PolygonCoords = Ring[]; // [outer, ...holes]

export interface ZoneData {
  /** The whole FeatureCollection, ready for Leaflet's GeoJSON layer. */
  geojson: GeoJSON.FeatureCollection;
  polygons: PolygonCoords[];
  /** [[south, west], [north, east]] */
  bounds: [[number, number], [number, number]];
  boundaryMode: string;
}

let cache: Promise<ZoneData> | null = null;

function polygonsOf(fc: GeoJSON.FeatureCollection): PolygonCoords[] {
  const out: PolygonCoords[] = [];
  for (const f of fc.features) {
    const g = f.geometry;
    if (g.type === "Polygon") out.push(g.coordinates as PolygonCoords);
    else if (g.type === "MultiPolygon") out.push(...(g.coordinates as PolygonCoords[]));
  }
  return out;
}

function boundsOf(polygons: PolygonCoords[]): ZoneData["bounds"] {
  let s = 90;
  let w = 180;
  let n = -90;
  let e = -180;
  for (const poly of polygons)
    for (const [lng, lat] of poly[0]) {
      s = Math.min(s, lat);
      n = Math.max(n, lat);
      w = Math.min(w, lng);
      e = Math.max(e, lng);
    }
  return [
    [s, w],
    [n, e],
  ];
}

export function loadZone(): Promise<ZoneData> {
  cache ??= fetch(`${import.meta.env.BASE_URL}map/ucla-10min.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`zone json ${r.status}`);
      return r.json() as Promise<GeoJSON.FeatureCollection>;
    })
    .then((geojson) => {
      const polygons = polygonsOf(geojson);
      const mode = (geojson.features[0]?.properties as { boundary_mode?: string } | null)?.boundary_mode ?? "unknown";
      return { geojson, polygons, bounds: boundsOf(polygons), boundaryMode: mode };
    });
  cache.catch(() => {
    cache = null; // allow a retry on the next mount
  });
  return cache;
}

/** Ray casting against one ring. */
function inRing(ring: Ring, lng: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Inside any polygon's outer ring and outside every one of that polygon's holes. */
export function pointInZone(polygons: PolygonCoords[], lat: number, lng: number): boolean {
  return polygons.some((poly) => inRing(poly[0], lng, lat) && !poly.slice(1).some((hole) => inRing(hole, lng, lat)));
}

export interface UseZone {
  zone: ZoneData | null;
  /** null until the zone has loaded or while there is no point. */
  inside: boolean | null;
}

export function useZone(point: { lat: number; lng: number } | null): UseZone {
  const [zone, setZone] = useState<ZoneData | null>(null);
  useEffect(() => {
    let alive = true;
    loadZone()
      .then((z) => alive && setZone(z))
      .catch(() => {
        /* no zone: the map still works, the chip just stays hidden */
      });
    return () => {
      alive = false;
    };
  }, []);
  const inside = zone && point ? pointInZone(zone.polygons, point.lat, point.lng) : null;
  return { zone, inside };
}
