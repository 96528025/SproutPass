// (C) geo.ts — haversine distance, bearing, distance bands.
// Pure functions, no Base44 imports, so they can be unit-tested with `deno test`.
//
// Design decision: everything is in metres and degrees. Bands are the ONLY thing
// that leaves the server (rule 3: others never receive coordinates).

export type Band = "<25m" | "25-100m" | "100-300m";

export const ENCOUNTER_M = 25; // encounter fires at ≤ 25 m (rule 4)
export const REARM_M = 40; // pair re-arms after > 40 m
export const MAX_ACCURACY_M = 30; // both GPS accuracies must be ≤ 30 m
export const PRESENCE_TTL_MS = 30_000; // presence counts as gone after 30 s
export const VISIBLE_M = 300; // beyond 300 m you are not on anyone's radar
export const COOLDOWN_MS = 10 * 60_000; // once per pair per 10 min
export const COOLDOWN_DEMO_MS = 2 * 60_000; // 2 min in demo mode

const R = 6_371_000; // earth radius, metres
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export interface LatLng {
  lat: number;
  lng: number;
}

/** Great-circle distance in metres. */
export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, 0–360, 0 = north, clockwise. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) -
    Math.sin(la1) * Math.cos(la2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Distance band, or null when out of radar range (> 300 m). */
export function band(distanceM: number): Band | null {
  if (distanceM <= ENCOUNTER_M) return "<25m";
  if (distanceM <= 100) return "25-100m";
  if (distanceM <= VISIBLE_M) return "100-300m";
  return null;
}

/**
 * Move `from` `stepM` metres toward `to` along the great circle.
 * Used by demoWalk (5 m per call). Never overshoots.
 */
export function stepToward(from: LatLng, to: LatLng, stepM: number): LatLng {
  const d = haversineM(from, to);
  if (d <= stepM || d === 0) return { ...to };
  const brg = toRad(bearingDeg(from, to));
  const la1 = toRad(from.lat);
  const lo1 = toRad(from.lng);
  const ad = stepM / R;
  const la2 = Math.asin(
    Math.sin(la1) * Math.cos(ad) + Math.cos(la1) * Math.sin(ad) * Math.cos(brg),
  );
  const lo2 = lo1 + Math.atan2(
    Math.sin(brg) * Math.sin(ad) * Math.cos(la1),
    Math.cos(ad) - Math.sin(la1) * Math.sin(la2),
  );
  return { lat: toDeg(la2), lng: ((toDeg(lo2) + 540) % 360) - 180 };
}

/** Stable key for an unordered pair, so (a,b) and (b,a) share one record. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export interface PresenceLike {
  parentId: string;
  lat: number;
  lng: number;
  accuracyM: number;
  simulated: boolean;
  updatedAt: string;
}

export function isFresh(p: PresenceLike, nowMs: number): boolean {
  return nowMs - Date.parse(p.updatedAt) <= PRESENCE_TTL_MS;
}

/**
 * The encounter rule in one place (rule 4):
 * ≤ 25 m, both accuracies ≤ 30 m. When BOTH sides are simulated we skip the
 * accuracy check (a simulated fix has no meaningful accuracy); when only one is
 * simulated the real side still needs a decent fix.
 */
export function withinEncounter(a: PresenceLike, b: PresenceLike): boolean {
  const d = haversineM(a, b);
  if (d > ENCOUNTER_M) return false;
  if (a.simulated && b.simulated) return true;
  const accA = a.simulated ? 0 : a.accuracyM;
  const accB = b.simulated ? 0 : b.accuracyM;
  return accA <= MAX_ACCURACY_M && accB <= MAX_ACCURACY_M;
}
