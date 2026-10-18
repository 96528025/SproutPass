// One-shot: fetch the City of Los Angeles administrative boundary from Nominatim, simplify it (Douglas-Peucker, every
// component and hole kept) and commit it as public/map/la.json. The app NEVER calls Nominatim at runtime.
// Run with `npx tsx tools/map/fetch-la-boundary.ts`. Falls back to a labelled LA County bounding rectangle.
import { mkdir, writeFile } from "node:fs/promises";

const URL_Q = "https://nominatim.openstreetmap.org/search?q=Los+Angeles,+California,+USA&format=geojson&polygon_geojson=1&limit=5";
const UA = "hand-me-down-relay/1.0 (hackathon)";
const TOLERANCE = 0.0005; // degrees
const OUT = new URL("../../public/map/la.json", import.meta.url);

type Pt = [number, number];

/** Iterative Douglas-Peucker on an open polyline. */
function dp(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      let d: number;
      if (len2 === 0) d = Math.hypot(px - ax, py - ay);
      else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      }
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > tol) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Simplify a closed ring; drop it if it collapses (<4 points). Rounds to 5 decimals (~1 m). */
function simplifyRing(ring: Pt[]): Pt[] | null {
  const open = ring.slice(0, -1);
  const s = dp(open, TOLERANCE);
  if (s.length < 3) return null;
  const r = s.map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5] as Pt);
  return [...r, r[0]];
}

function simplifyGeometry(g: any): { type: "MultiPolygon"; coordinates: Pt[][][] } {
  const polys: Pt[][][] = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  const out: Pt[][][] = [];
  for (const poly of polys) {
    const outer = simplifyRing(poly[0]);
    if (!outer) continue; // a speck that vanishes at this tolerance
    const holes = poly.slice(1).map(simplifyRing).filter((r): r is Pt[] => !!r);
    out.push([outer, ...holes]);
  }
  return { type: "MultiPolygon", coordinates: out };
}

let feature: any;
let osmId: number | null = null;
let fallback = false;
let source = URL_Q;

try {
  let json: any;
  for (let i = 1; i <= 3 && !json; i++) {
    try {
      const res = await fetch(URL_Q, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      json = await res.json();
    } catch (e) {
      console.warn(`attempt ${i}/3 failed:`, (e as Error).message);
      if (i === 3) throw e;
    }
  }
  const hit = (json.features ?? []).find(
    (f: any) =>
      f.properties?.osm_type === "relation" &&
      (f.properties?.type === "administrative" || f.properties?.type === "city") &&
      String(f.properties?.display_name ?? "").startsWith("Los Angeles, Los Angeles County") &&
      ["Polygon", "MultiPolygon"].includes(f.geometry?.type),
  );
  if (!hit) throw new Error("no matching administrative relation in the response");
  osmId = hit.properties.osm_id;
  const geometry = simplifyGeometry(hit.geometry);
  feature = {
    type: "Feature",
    properties: { name: "City of Los Angeles", boundary_mode: "osm_admin_relation", osm_id: osmId, display_name: hit.properties.display_name },
    geometry,
  };
  const rawPts = JSON.stringify(hit.geometry.coordinates).split("],[").length;
  console.log(`relation ${osmId}: ${rawPts} raw vertices -> ${geometry.coordinates.reduce((n, p) => n + p.reduce((m, r) => m + r.length, 0), 0)} simplified`);
} catch (e) {
  console.error("Nominatim unavailable, writing the LA County bounding rectangle:", (e as Error).message);
  fallback = true;
  source = "fallback: LA County bbox";
  const ring: Pt[] = [[-118.9517, 33.7037], [-117.6464, 33.7037], [-117.6464, 34.8233], [-118.9517, 34.8233], [-118.9517, 33.7037]];
  feature = { type: "Feature", properties: { name: "Los Angeles County (bbox)", boundary_mode: "bbox_fallback" }, geometry: { type: "MultiPolygon", coordinates: [[ring]] } };
}

const out = { type: "FeatureCollection", features: [feature], source, osmId, fetchedUtc: new Date().toISOString(), simplifyTolerance: TOLERANCE };
await mkdir(new URL("./", OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(out));
const holes = feature.geometry.coordinates.reduce((n: number, p: Pt[][]) => n + p.length - 1, 0);
console.log(`wrote public/map/la.json: ${JSON.stringify(out).length} bytes, ${feature.geometry.coordinates.length} polygon(s), ${holes} hole(s), fallback=${fallback}`);
