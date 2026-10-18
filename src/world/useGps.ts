// A4: real GPS (or a simulated fix with ?demo=1) feeding C's updatePresence (B's api → base44/functions/updatePresence).
// - watchPosition high accuracy; "weak" when accuracy > 30 m; `moving` for 1.2 s after a > 1 m change.
// - updatePresence immediately on the first fix, then a keepalive every 10 s while the tab is visible (C's presence
//   counts as gone after 30 s); real GPS also sends early once the fix has moved >= 5 m since the last send (at
//   most every 4 s). One request at a time (never stacked); after a failure (e.g. Base44's rate limit, which the
//   whole team shares) the next one waits longer, up to 20 s.
// - stops on hidden, re-subscribes on visible. `paused` = no fix for 15 s after the status was ok/weak (screen locked?).
// - `heartbeat: false` stops sending (the ?demo=1 walk owns the simulated position meanwhile, see useDemoWalk;
//   WorldScreen also turns it off while a trade is open). A DISCOVERABLE flip still goes out.
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/app/api";

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
  /** Real Parent id (closet.parent.id); null while the closet loads: the sensor runs, nothing is sent yet. */
  parentId: string | null;
  enabled?: boolean;
  /** ?demo=1: skip the sensor and report `simFix` so a laptop works. */
  simulated?: boolean;
  /** The fake fix for ?demo=1 (each family gets its own spot, see world/people.ts demoFix). */
  simFix?: { lat: number; lng: number; accuracyM: number };
  /** A's DISCOVERABLE toggle; rides along in every updatePresence. */
  discoverable?: boolean;
  /** Send updatePresence (default true). False while the demo walk drives this parent's simulated position. */
  heartbeat?: boolean;
}

const WEAK_ACCURACY_M = 30;
const MOVE_THRESHOLD_M = 1;
const MOVING_MS = 1200;
const PRESENCE_MS = 10_000; // keepalive; C's PRESENCE_TTL_MS is 30 s
const MOVE_SEND_M = 5; // real GPS: a move this big goes out before the keepalive ...
const MOVE_GAP_MS = 4000; // ... but never more often than this
const MAX_BACKOFF_MS = 20_000; // < 30 s, so one failure doesn't drop us off the radar
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

export function useGps({
  parentId,
  enabled = true,
  simulated = false,
  simFix = SIM_FIX,
  discoverable = true,
  heartbeat = true,
}: UseGpsOptions): GpsState {
  const [state, setState] = useState<GpsState>(INITIAL);
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState === "visible");

  const fix = useRef<{ lat: number; lng: number; accuracyM: number; at: number } | null>(null);
  const lastSentAt = useRef(0);
  const lastSentFix = useRef<{ lat: number; lng: number } | null>(null);
  const inFlight = useRef(false);
  const flipPending = useRef(false); // a DISCOVERABLE flip that couldn't go out yet (request in flight / no fix)
  const waitMs = useRef(PRESENCE_MS); // grows after failures, back to 3 s after a success
  const movingTimer = useRef<number | undefined>(undefined);
  const live = useRef({ parentId, simulated, discoverable, heartbeat });
  live.current = { parentId, simulated, discoverable, heartbeat };

  /** `force`: send even while the heartbeat is off (a DISCOVERABLE flip must reach the server). */
  const send = useCallback((force = false) => {
    const f = fix.current;
    const { parentId: id, simulated: sim, discoverable: disc, heartbeat: on } = live.current;
    if (!f || !id || (!on && !force) || inFlight.current) return;
    if (force) flipPending.current = false;
    inFlight.current = true;
    lastSentAt.current = Date.now();
    lastSentFix.current = { lat: f.lat, lng: f.lng };
    api
      .updatePresence({ parentId: id, lat: f.lat, lng: f.lng, accuracyM: Math.round(f.accuracyM), simulated: sim, discoverable: disc })
      .then(
        () => {
          waitMs.current = PRESENCE_MS;
        },
        () => {
          waitMs.current = Math.min(MAX_BACKOFF_MS, waitMs.current * 2);
          if (force) flipPending.current = true; // try the flip again on the next tick
        },
      )
      .finally(() => {
        inFlight.current = false;
      });
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
      accept(simFix.lat, simFix.lng, simFix.accuracyM);
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
  }, [enabled, visible, simulated, simFix.lat, simFix.lng, simFix.accuracyM, accept]);

  // Presence heartbeat (10 s keepalive, earlier after a real >= 5 m move) and the "screen locked?" check, while visible.
  useEffect(() => {
    if (!enabled || !visible) return;
    const t = window.setInterval(() => {
      const f = fix.current;
      if (!f) return;
      const age = Date.now() - f.at;
      const since = Date.now() - lastSentAt.current;
      const last = lastSentFix.current;
      const movedFar =
        !live.current.simulated && !!last && waitMs.current === PRESENCE_MS && distanceM(last.lat, last.lng, f.lat, f.lng) >= MOVE_SEND_M;
      const due = since >= waitMs.current - 100 || (movedFar && since >= MOVE_GAP_MS);
      if (flipPending.current && due) send(true);
      else if (age < STALE_MS && due) send();
      const stale = age >= STALE_MS;
      setState((s) => (s.paused === stale ? s : { ...s, paused: stale }));
    }, 1000);
    return () => window.clearInterval(t);
  }, [enabled, visible, send]);

  // The first beat goes out as soon as the parent id arrives.
  useEffect(() => {
    if (fix.current) send();
  }, [parentId, send]);

  // The heartbeat resumes (walk over, trade closed): next beat ~1.5 s later from the tick above, not at once
  // (a Celebration closing on its way to /bag unmounts this screen a moment after the pause ends).
  const wasOn = useRef(heartbeat);
  useEffect(() => {
    if (heartbeat && !wasOn.current) lastSentAt.current = Math.max(lastSentAt.current, Date.now() - waitMs.current + 1500);
    wasOn.current = heartbeat;
  }, [heartbeat]);

  // A DISCOVERABLE flip goes out right away, heartbeat or not (C writes it to Parent.discoverable; a simulated
  // presence keeps its server-owned position, so this never undoes a demo walk).
  const lastDisc = useRef(discoverable);
  useEffect(() => {
    if (lastDisc.current === discoverable) return;
    lastDisc.current = discoverable;
    flipPending.current = true;
    send(true);
  }, [discoverable, send]);

  useEffect(() => () => window.clearTimeout(movingTimer.current), []);

  return state;
}
