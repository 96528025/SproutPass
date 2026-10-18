// A3: asks for location once (from a user gesture) and records the outcome. Shared module state, so A4 can read it too.
import { useSyncExternalStore } from "react";

export type GeoStatus = "unknown" | "asking" | "granted" | "denied" | "unavailable";

let status: GeoStatus = "unknown";
const listeners = new Set<() => void>();

function set(next: GeoStatus): GeoStatus {
  status = next;
  listeners.forEach((cb) => cb());
  return next;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Calls getCurrentPosition once. Resolves with the final status; never rejects. */
export function requestGeo(): Promise<GeoStatus> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(set("unavailable"));
  set("asking");
  return new Promise((resolve) => {
    // the 10 s timeout doesn't count time spent on the permission prompt, so an ignored (or, in Firefox, clicked-away)
    // prompt would leave this pending forever: give up after 15 s and let the title fall back to the demo walk
    const guard = window.setTimeout(() => resolve(set("unavailable")), 15_000);
    navigator.geolocation.getCurrentPosition(
      () => {
        window.clearTimeout(guard);
        resolve(set("granted"));
      },
      (err) => {
        window.clearTimeout(guard);
        resolve(set(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"));
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
    );
  });
}

export function useGeoPermission(): { status: GeoStatus; request: () => Promise<GeoStatus> } {
  const s = useSyncExternalStore(subscribe, () => status, () => "unknown" as GeoStatus);
  return { status: s, request: requestGeo };
}
