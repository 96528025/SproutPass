// A3: query-string helpers every screen uses. ?as=mina|jo|sam (current parent) and ?demo=1 travel with every navigation.
import { useLocation } from "react-router";

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

/** withQuery("/world") -> "/world?as=jo&demo=1" when the current URL has them. */
export function withQuery(path: string, extra?: Record<string, string | undefined>): string {
  const search = typeof window === "undefined" ? "" : window.location.search;
  return carryQuery(path, search, extra);
}

/** Current parent from ?as= (default "mina"). Re-renders on navigation. */
export function useQueryParent(): ParentId {
  const { search } = useLocation();
  return parseParent(search) ?? "mina";
}

/** True when ?demo=1 is set. Re-renders on navigation. */
export function useDemo(): boolean {
  const { search } = useLocation();
  return isDemo(search);
}
