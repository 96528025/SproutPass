// Request location directly from a tap; never turn a failed request into demo consent.
import { useSyncExternalStore } from "react";

export type GeoStatus = "unknown" | "asking" | "granted" | "denied" | "unavailable" | "timeout" | "insecure" | "blocked";
let status: GeoStatus = "unknown";
let pending: Promise<GeoStatus> | null = null;
const listeners = new Set<() => void>();
function set(next: GeoStatus): GeoStatus {
  status = next;
  listeners.forEach(cb => cb());
  return next;
}
function subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }

export function geoHelp(s: GeoStatus): string {
  if (s === "denied") return "Location access is blocked. Allow Location for this website in your browser’s site settings, and enable Location Services for your browser in phone settings. Then try again.";
  if (s === "timeout") return "Your phone hasn't returned a location yet. Check Location Services and try again, preferably near a window or outdoors.";
  if (s === "insecure") return "Location needs a secure connection. Open the published HTTPS app link in Safari or Chrome.";
  if (s === "blocked") return "This page is not allowed to request location. Open the published app directly in Safari or Chrome, outside an embedded preview.";
  if (s === "unavailable") return "Your browser couldn't get a location. Check that Location Services are on, then try again.";
  return "Use your location to find nearby families. Your browser will ask for permission if you haven't already chosen.";
}

export function requestGeo(): Promise<GeoStatus> {
  if (pending) return pending;
  if (typeof window !== "undefined" && window.isSecureContext === false) return Promise.resolve(set("insecure"));
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(set("unavailable"));
  const policy = typeof document === "undefined" ? undefined : (document as Document & { permissionsPolicy?: { allowsFeature(s: string): boolean }; featurePolicy?: { allowsFeature(s: string): boolean } });
  if ((policy?.permissionsPolicy ?? policy?.featurePolicy)?.allowsFeature("geolocation") === false) return Promise.resolve(set("blocked"));
  set("asking");
  pending = new Promise<GeoStatus>((resolve) => {
    let done = false;
    const finish = (result: GeoStatus) => {
      if (done) return; // a late callback from a timed-out request cannot overwrite a retry
      done = true;
      clearTimeout(guard);
      resolve(set(result));
    };
    const guard = setTimeout(() => finish("timeout"), 30_000);
    try {
      navigator.geolocation.getCurrentPosition(
        () => finish("granted"),
        err => finish(err.code === 1 ? "denied" : err.code === 3 ? "timeout" : "unavailable"),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
      );
    } catch { finish("unavailable"); }
  }).finally(() => { pending = null; });
  return pending;
}

export function useGeoPermission() {
  const s = useSyncExternalStore(subscribe, () => status, () => "unknown" as GeoStatus);
  return { status: s, request: requestGeo };
}
