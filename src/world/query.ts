// A3: query-string helpers every screen uses. ?as=mina|jo|sam (current parent) and ?demo=1 travel with every navigation.
// B's store (src/app/store.ts) owns ?as= / ?demo=1: it remembers them per tab and Shell writes them back into the URL,
// so the hooks below read the store first and the URL second. withQuery/carryQuery stay for building links.
// ?walk=mina|jo|sam (demo only) picks who /world's demo walk heads for; useWalkTarget remembers it per tab and parent.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useApp } from "@/app/store";
import { demoTargetKey } from "@/world/people";

export type ParentId = "mina" | "jo" | "sam";
export const PARENT_IDS: readonly ParentId[] = ["mina", "jo", "sam"];

export function isParentId(v: unknown): v is ParentId {
  return typeof v === "string" && (PARENT_IDS as readonly string[]).includes(v);
}

/** The ?as= parent from a search string, or null when absent/invalid. */
export function parseParent(search: string): ParentId | null {
  const v = new URLSearchParams(search).get("as");
  return isParentId(v) ? v : null;
}

/** True for ?demo=1 (or ?demo=true). */
export function isDemo(search: string): boolean {
  const v = new URLSearchParams(search).get("demo");
  return v === "1" || v === "true";
}

/**
 * Pure: `path` plus the ?as= / ?demo= found in `search`. Params already on `path` win over the carried ones;
 * `extra` wins over both (an `undefined` value is ignored, so `{ demo: cond ? "1" : undefined }` is safe).
 */
export function carryQuery(path: string, search: string, extra: Record<string, string | undefined> = {}): string {
  const hashAt = path.indexOf("#");
  const hash = hashAt >= 0 ? path.slice(hashAt) : "";
  const noHash = hashAt >= 0 ? path.slice(0, hashAt) : path;
  const qAt = noHash.indexOf("?");
  const pathname = qAt >= 0 ? noHash.slice(0, qAt) : noHash;
  const out = new URLSearchParams(qAt >= 0 ? noHash.slice(qAt + 1) : "");

  const parent = parseParent(search);
  if (parent && !out.has("as")) out.set("as", parent);
  if (isDemo(search) && !out.has("demo")) out.set("demo", "1");
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) out.set(k, v);

  const qs = out.toString();
  return `${pathname}${qs ? `?${qs}` : ""}${hash}`;
}

/** withQuery("/world") -> "/world?as=jo&demo=1" when the current URL (or B's store) has them. */
export function withQuery(path: string, extra?: Record<string, string | undefined>): string {
  const search = typeof window === "undefined" ? "" : window.location.search;
  const { parentKey, demo } = useApp.getState();
  const fromStore: Record<string, string | undefined> = {
    as: !parseParent(search) && isParentId(parentKey) ? parentKey : undefined,
    demo: demo && !isDemo(search) ? "1" : undefined,
  };
  // params already on `path` win over the store's, like carried ones; `extra` wins over everything
  const own = new URLSearchParams(path.split("#")[0].split("?")[1] ?? "");
  for (const k of Object.keys(fromStore)) if (own.has(k)) fromStore[k] = undefined;
  for (const [k, v] of Object.entries(extra ?? {})) if (v !== undefined) fromStore[k] = v;
  return carryQuery(path, search, fromStore);
}

/** Current parent's seed key: B's store (?as=, remembered per tab), else ?as=, else "mina". Re-renders on change. */
export function useQueryParent(): ParentId {
  const key = useApp((s) => s.parentKey);
  const { search } = useLocation();
  return (isParentId(key) ? key : null) ?? parseParent(search) ?? "mina";
}

/** True in demo mode: B's store (?demo=1, remembered per tab) or ?demo=1 on the URL. Re-renders on change. */
export function useDemo(): boolean {
  const demo = useApp((s) => s.demo);
  const { search } = useLocation();
  return demo || isDemo(search);
}

// ---- ?walk= : the demo walk's target ----------------------------------------------------------------------------

/** ?walk= from a search string, when it names a seed family other than `me` (you can't walk to yourself). */
export function parseWalk(search: string, me: string): ParentId | null {
  const v = new URLSearchParams(search).get("walk");
  return isParentId(v) && v !== me ? v : null;
}

const walkStoreKey = (me: string) => `relay:world:walkTo:${me}`;
function readWalk(me: ParentId): ParentId | null {
  try {
    const v = sessionStorage.getItem(walkStoreKey(me));
    return isParentId(v) && v !== me ? v : null;
  } catch {
    return null;
  }
}
function writeWalk(me: ParentId, key: ParentId) {
  try {
    sessionStorage.setItem(walkStoreKey(me), key);
  } catch {
    /* private mode: this mount only */
  }
}

/**
 * Who `me`'s demo walk heads for: ?walk= on the URL, else this tab's last pick for `me` (sessionStorage, one per
 * parent), else people.ts demoTargetKey (Jo → Mina, everyone else → Jo). `pick` remembers the choice, and keeps a
 * ?walk= already on the URL in step (it never adds one: links stay clean).
 */
export function useWalkTarget(me: ParentId): [ParentId, (key: ParentId) => void] {
  const { pathname, search, hash, state } = useLocation();
  const nav = useNavigate();
  const fromUrl = parseWalk(search, me);
  const [picks, setPicks] = useState<Partial<Record<ParentId, ParentId>>>({});
  const stored = useMemo(() => picks[me] ?? readWalk(me), [picks, me]);
  // A ?walk= that arrived on the URL outlives it (in-app links drop the query).
  useEffect(() => {
    if (fromUrl) writeWalk(me, fromUrl);
  }, [fromUrl, me]);
  const pick = useCallback(
    (key: ParentId) => {
      if (key === me) return;
      writeWalk(me, key);
      setPicks((p) => ({ ...p, [me]: key }));
      const q = new URLSearchParams(search);
      if (q.has("walk") && q.get("walk") !== key) {
        q.set("walk", key);
        nav({ pathname, search: `?${q}`, hash }, { replace: true, state });
      }
    },
    [me, search, pathname, hash, state, nav],
  );
  const fallback = demoTargetKey(me);
  return [fromUrl ?? stored ?? (isParentId(fallback) ? fallback : "jo"), pick];
}
