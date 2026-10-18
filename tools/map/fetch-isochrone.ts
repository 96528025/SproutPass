// One-shot: fetch the UCLA 10-minute-drive isochrone from the public Valhalla server and commit the result as
// public/map/ucla-10min.json. The app NEVER calls Valhalla at runtime (cold starts); run with `npx tsx tools/map/fetch-isochrone.ts`.
// Lessons from nearby-10min-map: snap the origin to a drivable road first, keep every polygon component and hole.
import { mkdir, writeFile } from "node:fs/promises";

const BASE = "https://valhalla1.openstreetmap.de";
const ORIGIN = { lat: 34.0689, lon: -118.4452 };
const TIMEOUT_MS = 60_000;
const ATTEMPTS = 3; // first try + two retries
const OUT = new URL("../../public/map/ucla-10min.json", import.meta.url);

async function getJson(path: string, payload: object): Promise<any> {
  let lastErr: unknown;
  for (let i = 1; i <= ATTEMPTS; i++) {
    try {
      const res = await fetch(`${BASE}${path}?json=${encodeURIComponent(JSON.stringify(payload))}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "User-Agent": "hand-me-down-relay-hackathon/0.1 (one-shot isochrone fetch)" },
      });
      if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      console.warn(`attempt ${i}/${ATTEMPTS} for ${path} failed:`, (e as Error).message);
    }
  }
  throw lastErr;
}

/** A closed ~3 km circle as a GeoJSON ring (96 vertices), used only when Valhalla is unavailable. */
function circleFeature(lat: number, lon: number, radiusM: number) {
  const ring: [number, number][] = [];
  const n = 96;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    ring.push([lon + (radiusM * Math.sin(a)) / (111_320 * Math.cos((lat * Math.PI) / 180)), lat + (radiusM * Math.cos(a)) / 110_540]);
  }
  ring.push(ring[0]);
  return { type: "Feature" as const, properties: { contour: 10, metric: "time", boundary_mode: "nominal_radius_circle", radius_m: radiusM }, geometry: { type: "Polygon" as const, coordinates: [ring] } };
}

const request = {
  locations: [{ lat: ORIGIN.lat, lon: ORIGIN.lon }],
  costing: "auto",
  contours: [{ time: 10 }],
  polygons: true,
  denoise: 0.3,
};

let snapped = { lat: ORIGIN.lat, lon: ORIGIN.lon };
let snapSource = "raw_point";
let collection: any;
let fallback = false;

try {
  const located = await getJson("/locate", { locations: [{ lat: ORIGIN.lat, lon: ORIGIN.lon }], costing: "auto" });
  const edge = located?.[0]?.edges?.[0];
  if (edge && typeof edge.correlated_lat === "number" && typeof edge.correlated_lon === "number") {
    snapped = { lat: edge.correlated_lat, lon: edge.correlated_lon };
    snapSource = "locate_nearest_edge";
  } else console.warn("locate returned no edges; keeping the raw point");
  const body = { ...request, locations: [{ lat: snapped.lat, lon: snapped.lon }] };
  collection = await getJson("/isochrone", body);
  for (const f of collection.features ?? []) f.properties = { ...f.properties, boundary_mode: "valhalla_isochrone_auto_10min" };
} catch (e) {
  console.error("Valhalla unavailable, writing the nominal 3 km circle fallback:", (e as Error).message);
  fallback = true;
  collection = { type: "FeatureCollection", features: [circleFeature(ORIGIN.lat, ORIGIN.lon, 3000)] };
}

const out = {
  ...collection,
  origin: ORIGIN,
  snappedOrigin: { ...snapped, source: snapSource },
  fetchedUtc: new Date().toISOString(),
  request,
  source: fallback ? "fallback: nominal 3 km circle" : `${BASE}/isochrone`,
};
await mkdir(new URL("./", OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(out));
const g = out.features[0].geometry;
const polys = g.type === "MultiPolygon" ? g.coordinates : [g.coordinates];
console.log(`wrote ${OUT.pathname}: ${out.features.length} feature(s), ${polys.length} polygon(s), ${polys.reduce((n: number, p: any[]) => n + p.length - 1, 0)} hole(s), fallback=${fallback}, snapped=${snapSource}`);
