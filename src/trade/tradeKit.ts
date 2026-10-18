// OWNER: Agent 2 (B3/B5). Small helpers shared by the trade screens.
import { useEffect, useState } from "react";
import { api } from "../app/api";
import { useApp } from "../app/store";
import type { ClosetView, Condition, Decision, ISODate, MatchProposal } from "../app/types";

export type PublicParent = ClosetView["parent"];

const parentCache = new Map<string, Promise<PublicParent | null>>();

/** A party's public profile (name, avatar, pet). Never includes the phone: it comes from getCloset's publicParent. */
export function usePublicParent(id: string | undefined): PublicParent | null {
  const mine = useApp((s) => s.closet?.parent ?? null);
  const [other, setOther] = useState<PublicParent | null>(null);
  useEffect(() => {
    if (!id || mine?.id === id) return;
    let live = true;
    let pending = parentCache.get(id);
    if (!pending) {
      pending = api.getCloset({ parentId: id }).then((c) => c.parent).catch(() => { parentCache.delete(id); return null; });
      parentCache.set(id, pending);
    }
    void pending.then((p) => { if (live) setOther(p); });
    return () => { live = false; };
  }, [id, mine?.id]);
  if (!id) return null;
  if (mine?.id === id) return mine;
  return other?.id === id ? other : null;
}

const celebrated = new Set<string>();

/** Fire A's Celebration once per paid proposal per tab. Returns true the first time. */
export function celebrate(p: MatchProposal): boolean {
  if (celebrated.has(p.id)) return false;
  celebrated.add(p.id);
  window.dispatchEvent(new CustomEvent("trade:paid", { detail: p }));
  return true;
}

/** A's sound system listens for these ("accept", "decline", "coin", …). */
export const sfx = (name: string) => window.dispatchEvent(new CustomEvent("sfx", { detail: name }));

/** "Yellow duck romper" → "ROMPER" */
export const shortName = (itemName: string) => (itemName.trim().split(/\s+/).pop() ?? "item").toUpperCase();

export const newHomeText = (p: MatchProposal) => `THE ${shortName(p.snapshot.itemName)} FOUND A NEW HOME!`;

/** "MAY 15" (UTC, so the demo clock reads the same everywhere) */
export const monthDay = (iso: ISODate) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase();

export const CONDITION_TEXT: Record<Condition, { label: string; stars: string }> = {
  like_new: { label: "LIKE NEW", stars: "★★★" },
  gently_used: { label: "GENTLY USED", stars: "★★☆" },
  well_loved: { label: "WELL LOVED", stars: "★☆☆" },
};

export const DECISION_TEXT: Record<Decision, string> = {
  pending: "WAITING…",
  accepted: "ACCEPTED ✓",
  declined: "DECLINED ✗",
};
