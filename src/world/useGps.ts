// A4: real GPS (or a simulated fix with ?demo=1) feeding C's updatePresence.
// - watchPosition high accuracy; "weak" when accuracy > 30 m; `moving` for 1.2 s after a > 1 m change.
// - updatePresence immediately on the first fix, then every ~3 s while the tab is visible.
// - stops on hidden, re-subscribes on visible. `paused` = no fix for 15 s after the status was ok/weak (screen locked?).
import { useCallback, useEffect, useRef, useState } from "react";
import { updatePresence } from "@/mocks/a4"; // C: swap for the real api when it lands
import type { ParentId } from "@/world/query";

export type GpsStatus = "idle" | "ok" | "weak" | "denied" | "unavailable";

export interface GpsState {
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  moving: boolean;
  /** Direction of the last horizontal movement (east = right). */
  facing: "left" | "right";
  status: GpsStatus;
  /** No fix for 15 s while the tab is visible and status was ok/weak. */
  paused: boolean;
}

export interface UseGpsOptions {
  parentId: ParentId;
  enabled?: boolean;
  /** ?demo=1: skip the sensor and report a fixed fake fix (±12 m) so a laptop works. */
  simulated?: boolean;
  discoverable?: boolean;
}

const WEAK_ACCURACY_M = 30;
const MOVE_THRESHOLD_M = 1;
const MOVING_MS = 1200;
const PRESENCE_MS = 3000;
const STALE_MS = 15_000;
const SIM_FIX = { lat: 34.0689, lng: -118.4452, accuracyM: 12 };

function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLng = (bLng - aLng) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const INITIAL: GpsState = { lat: null, lng: null, accuracyM: null, moving: false, facing: "right", status: "idle", paused: false };

export function useGps({ parentId, enabled = true, simulated = false, discoverable = true }: UseGpsOptions): GpsState {
  const [state, setState] = useState<GpsState>(INITIAL);
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState === "visible");

  const fix = useRef<{ lat: number; lng: number; accuracyM: number; at: number } | null>(null);
  const lastSentAt = useRef(0);
  const movingTimer = useRef<number | undefined>(undefined);
  const live = useRef({ parentId, simulated, discoverable });
  live.current = { parentId, simulated, discoverable };

  const send = useCallback(() => {
    const f = fix.current;
    if (!f) return;
    lastSentAt.current = Date.now();
    const { parentId: id, simulated: sim, discoverable: disc } = live.current;
    void updatePresence({ parentId: id, lat: f.lat, lng: f.lng, accuracyM: f.accuracyM, simulated: sim, discoverable: disc }).catch(() => {});
  }, []);

  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Accept a fix: update state, flag movement, and send immediately if it is the first one.
  const accept = useCallback(
    (lat: number, lng: number, accuracyM: number) => {
      const prev = fix.current;
      const first = !prev;
      fix.current = { lat, lng, accuracyM, at: Date.now() };
      const moved = prev ? distanceM(prev.lat, prev.lng, lat, lng) > MOVE_THRESHOLD_M : false;
      setState((s) => ({
        ...s,
        lat,
        lng,
        accuracyM,
        status: accuracyM > WEAK_ACCURACY_M ? "weak" : "ok",
        paused: false,
        moving: moved ? true : s.moving,
        facing: moved && prev && lng !== prev.lng ? (lng > prev.lng ? "right" : "left") : s.facing,
      }));
      if (moved) {
        window.clearTimeout(movingTimer.current);
        movingTimer.current = window.setTimeout(() => setState((s) => ({ ...s, moving: false })), MOVING_MS);
      }
      if (first) send();
    },
    [send],
  );

  // The sensor: only while enabled and visible. Hidden => clearWatch; visible again => fresh watch.
  useEffect(() => {
    if (!enabled || !visible) return;
    if (simulated) {
      accept(SIM_FIX.lat, SIM_FIX.lng, SIM_FIX.accuracyM);
      // keep the fake fix "fresh" so the staleness chip stays off
      const t = window.setInterval(() => {
        if (fix.current) fix.current.at = Date.now();
      }, 1000);
      return () => window.clearInterval(t);
    }
    if (!("geolocation" in navigator)) {
      setState((s) => ({ ...s, status: "unavailable" }));
      return;
    }
    fix.current = fix.current ? { ...fix.current, at: Date.now() } : null; // don't count time spent hidden as "no fix"
    const id = navigator.geolocation.watchPosition(
      (pos) => accept(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setState((s) => ({ ...s, status: "denied" }));
        else if (!fix.current) setState((s) => ({ ...s, status: "unavailable" }));
        // otherwise keep the last status: the 15 s staleness check below turns it into the "paused" chip
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled, visible, simulated, accept]);

  // Presence heartbeat (~3 s) and the "screen locked?" check, while visible.
  useEffect(() => {
    if (!enabled || !visible) return;
    const t = window.setInterval(() => {
      const f = fix.current;
      if (!f) return;
      const age = Date.now() - f.at;
      if (age < STALE_MS && Date.now() - lastSentAt.current >= PRESENCE_MS - 100) send();
      const stale = age >= STALE_MS;
      setState((s) => (s.paused === stale ? s : { ...s, paused: stale }));
    }, 1000);
    return () => window.clearInterval(t);
  }, [enabled, visible, send]);

  // A discoverable flip goes out right away.
  useEffect(() => {
    if (fix.current) send();
  }, [discoverable, send]);

  useEffect(() => () => window.clearTimeout(movingTimer.current), []);

  return state;
}
