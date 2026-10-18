// A4: polls C's listNearby (B's api → base44/functions/listNearby) every 6 s while the tab is visible and returns
// a smoothed copy where each parent's bearing and radius move toward their target in 4-px steps. A parent missing
// from the list lingers 6 s, then fades out (`fading`) for ~0.8 s and is dropped.
// One request at a time: the next poll is scheduled when the last one answers (never stacked under Base44's rate
// limit), and failures back off up to 20 s. `poll: false` stops the requests (the demo walk is running and reports
// the distance itself, or a trade is open) while the radar keeps drawing what it knows; `pin` moves one parent
// from data the caller already has (the walk's target, from demoWalk's distanceM) without a request.
import { useEffect, useRef, useState } from "react";
import { api } from "@/app/api";
import type { Band, NearbyParent } from "@/app/types";
import type { SpriteName } from "@/pixel/sprites";
import { asSprite } from "@/world/people";

/** Ring radii on a 390-px screen (px): 25 m / 100 m / 300 m. A parent in a band sits on that band's outer ring. */
export const RING_PX = { "<25m": 48, "25-100m": 112, "100-300m": 168 } as const satisfies Record<Band, number>;

export const BAND_LABEL: Record<Band, string> = { "<25m": "<25 M", "25-100m": "25-100 M", "100-300m": "100-300 M" };

export interface SmoothParent {
  parentId: string;
  name: string;
  sprite: SpriteName;
  band: Band;
  distanceM?: number;
  /** Smoothed position relative to the radar centre, snapped to the 4-px grid. */
  x: number;
  y: number;
  fading: boolean;
}

interface Track {
  info: NearbyParent;
  bearing: number; // smoothed, degrees
  radius: number; // smoothed, px
  goneAt: number | null;
  fadingAt: number | null;
}

const POLL_MS = 6000;
const RESUME_MS = 1500; // polling back on (pause over, tab visible again): first poll after this, not at once
const MAX_BACKOFF_MS = 20_000;
const TICK_MS = 60;
const GONE_MS = 6000;
const FADE_MS = 800;
const STEP_PX = 4;

const norm = (d: number) => ((d % 360) + 360) % 360;
const shortest = (from: number, to: number) => ((((to - from) % 360) + 540) % 360) - 180;
const snap4 = (n: number) => Math.round(n / 4) * 4;

function project(bearing: number, radius: number) {
  const r = (bearing * Math.PI) / 180;
  return { x: snap4(Math.sin(r) * radius), y: snap4(-Math.cos(r) * radius) };
}

/** A parent the caller knows better than the last poll: band/bearing/distance replace the polled ones. */
export type NearbyPin = Pick<NearbyParent, "parentId" | "band" | "bearingDeg"> & Partial<NearbyParent>;

export interface UseNearbyOptions {
  /** Send listNearby (default true). */
  poll?: boolean;
  /** See NearbyPin; null = nothing pinned. */
  pin?: NearbyPin | null;
}

/** `parentId` is the real Parent id (closet.parent.id); null while the closet loads (no polling yet). */
export function useNearby(parentId: string | null, { poll: enabled = true, pin = null }: UseNearbyOptions = {}): { raw: NearbyParent[]; items: SmoothParent[] } {
  const [raw, setRaw] = useState<NearbyParent[]>([]);
  const [items, setItems] = useState<SmoothParent[]>([]);
  const tracks = useRef(new Map<string, Track>());
  const dirty = useRef(false);
  const polledFor = useRef<string | null>(null); // the parent the first poll already went out for
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");

  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // A different parent (or none yet): forget the old radar.
  useEffect(() => {
    tracks.current.clear();
    dirty.current = true;
    setRaw([]);
  }, [parentId]);

  // Poll: self-scheduling, so a slow answer delays the next poll instead of stacking requests.
  useEffect(() => {
    if (!enabled || !visible || !parentId) return;
    let alive = true;
    let timer: number | undefined;
    let wait = POLL_MS;
    const poll = async () => {
      try {
        const res = await api.listNearby({ parentId });
        if (!alive) return;
        wait = POLL_MS;
        const list = res?.nearby ?? [];
        const now = Date.now();
        const seen = new Set<string>();
        for (const p of list) {
          seen.add(p.parentId);
          const t = tracks.current.get(p.parentId);
          if (t) {
            t.info = p;
            t.goneAt = null;
            t.fadingAt = null;
          } else {
            tracks.current.set(p.parentId, { info: p, bearing: norm(p.bearingDeg), radius: RING_PX[p.band], goneAt: null, fadingAt: null });
          }
        }
        for (const [id, t] of tracks.current) if (!seen.has(id) && t.goneAt === null) t.goneAt = now;
        dirty.current = true;
        setRaw(list);
      } catch {
        wait = Math.min(MAX_BACKOFF_MS, wait * 2); // keep the last list; back off (rate limit / offline)
      }
      if (alive) timer = window.setTimeout(poll, wait);
    };
    // The first poll for a parent goes out at once. A resume waits a beat: the pause that just ended is often a
    // Celebration closing on its way to /bag, which unmounts this screen a moment later.
    const first = polledFor.current === parentId ? RESUME_MS : 0;
    polledFor.current = parentId;
    timer = window.setTimeout(poll, first);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [parentId, enabled, visible]);

  // The pinned parent (the demo walk's target): move it from the caller's data, no request.
  const pinKey = pin ? `${pin.parentId}|${pin.band}|${pin.bearingDeg}|${pin.distanceM ?? ""}` : "";
  const pinRef = useRef(pin);
  pinRef.current = pin;
  useEffect(() => {
    const p = pinRef.current;
    if (!p) return;
    const t = tracks.current.get(p.parentId);
    const info: NearbyParent = t
      ? { ...t.info, band: p.band, bearingDeg: p.bearingDeg, distanceM: p.distanceM }
      : { name: "…", sprite: "parent_b", pet: "pet_b", ...p };
    if (t) {
      t.info = info;
      t.goneAt = null;
      t.fadingAt = null;
    } else {
      tracks.current.set(p.parentId, { info, bearing: norm(info.bearingDeg), radius: RING_PX[info.band], goneAt: null, fadingAt: null });
    }
    dirty.current = true;
    setRaw((list) => [...list.filter((q) => q.parentId !== info.parentId), info]);
  }, [pinKey]);

  // Step the smoothed values toward their targets in 4-px steps (local only: runs while polling is off too).
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now();
      let changed = dirty.current;
      dirty.current = false;
      for (const [pid, t] of tracks.current) {
        if (t.goneAt !== null && t.fadingAt === null && now - t.goneAt >= GONE_MS) {
          t.fadingAt = now;
          changed = true;
        }
        if (t.fadingAt !== null && now - t.fadingAt >= FADE_MS) {
          tracks.current.delete(pid);
          changed = true;
          continue;
        }
        if (t.goneAt !== null) continue;
        const targetR = RING_PX[t.info.band];
        const dr = targetR - t.radius;
        if (dr !== 0) {
          t.radius += Math.sign(dr) * Math.min(STEP_PX, Math.abs(dr));
          changed = true;
        }
        const db = shortest(t.bearing, t.info.bearingDeg);
        if (Math.abs(db) > 0.01) {
          const maxDeg = ((STEP_PX / Math.max(t.radius, 24)) * 180) / Math.PI; // ~4 px of arc per tick
          t.bearing = norm(t.bearing + Math.sign(db) * Math.min(maxDeg, Math.abs(db)));
          changed = true;
        }
      }
      if (!changed) return;
      setItems(
        [...tracks.current.values()].map((t) => ({
          parentId: t.info.parentId,
          name: t.info.name,
          sprite: asSprite(t.info.sprite, "parent_b"),
          band: t.info.band,
          distanceM: t.info.distanceM,
          fading: t.fadingAt !== null,
          ...project(t.bearing, t.radius),
        })),
      );
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  return { raw, items };
}
