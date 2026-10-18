// A4: polls C's listNearby every 2 s while the tab is visible and returns a smoothed copy where each parent's
// bearing and radius move toward their target in 4-px steps. A parent missing from the list lingers 6 s, then
// fades out (`fading`) for ~0.8 s and is dropped.
import { useEffect, useRef, useState } from "react";
import { listNearby, type Band, type NearbyParent } from "@/mocks/a4"; // C: swap for the real api when it lands
import type { SpriteName } from "@/pixel/sprites";
import type { ParentId } from "@/world/query";

/** Ring radii on a 390-px screen (px): 25 m / 100 m / 300 m. A parent in a band sits on that band's outer ring. */
export const RING_PX = { "<25m": 48, "25-100m": 112, "100-300m": 168 } as const satisfies Record<Band, number>;

export const BAND_LABEL: Record<Band, string> = { "<25m": "<25 M", "25-100m": "25-100 M", "100-300m": "100-300 M" };

export interface SmoothParent {
  parentId: ParentId;
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

const POLL_MS = 2000;
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

export function useNearby(parentId: ParentId, enabled = true): { raw: NearbyParent[]; items: SmoothParent[] } {
  const [raw, setRaw] = useState<NearbyParent[]>([]);
  const [items, setItems] = useState<SmoothParent[]>([]);
  const tracks = useRef(new Map<ParentId, Track>());
  const dirty = useRef(false);
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");

  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Poll.
  useEffect(() => {
    if (!enabled || !visible) return;
    let alive = true;
    const poll = async () => {
      try {
        const list = await listNearby({ parentId });
        if (!alive) return;
        const now = Date.now();
        const seen = new Set<ParentId>();
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
        /* keep the last list; the next poll may succeed */
      }
    };
    void poll();
    const id = window.setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [parentId, enabled, visible]);

  // Step the smoothed values toward their targets in 4-px steps.
  useEffect(() => {
    if (!enabled) return;
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
          sprite: t.info.sprite,
          band: t.info.band,
          distanceM: t.info.distanceM,
          fading: t.fadingAt !== null,
          ...project(t.bearing, t.radius),
        })),
      );
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [enabled]);

  return { raw, items };
}
