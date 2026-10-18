// OWNER: Agent 2 (B3/B5). Small helpers shared by the trade screens.
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../app/api";
import { useApp } from "../app/store";
import type { Condition, Decision, ISODate, MatchProposal } from "../app/types";
import { createPartyLoader, slimParty, type Party } from "./tradeLogic";

export type { Party };

function sessionStore(): Pick<Storage, "getItem" | "setItem"> | null {
  try { return typeof sessionStorage === "undefined" ? null : sessionStorage; } catch { return null; }
}

// The other party's card comes from getParties: only {id, name, avatar, pet} (never phone or C's private
// fields), one Parent read on the server. Retried with backoff under the rate limit, deduped across windows
// and cached per tab.
const parties = createPartyLoader({
  fetch: async (id) => {
    const [party] = await api.getParties({ parentIds: [id] });
    if (!party) throw new ApiError("not_found", "parent not found");   // unknown ids are skipped, not an error
    return party;
  },
  isFatal: (e) => e instanceof ApiError && (e.code === "not_found" || e.code === "bad_request"),
  storage: sessionStore(),
});

/** A party's public profile, or null while it loads (callers show the role, e.g. "SELLER", meanwhile). */
export function usePublicParent(id: string | undefined): Party | null {
  const mine = useApp((s) => s.closet?.parent ?? null);
  const [, loaded] = useState(0);
  useEffect(() => {
    if (!id || mine?.id === id || parties.get(id)) return;
    let live = true;
    void parties.load(id).then(() => { if (live) loaded((n) => n + 1); });
    return () => { live = false; };
  }, [id, mine?.id]);
  const me = useMemo(() => (mine ? slimParty(mine) : null), [mine]);
  if (!id) return null;
  if (me?.id === id) return me;
  return parties.get(id);
}

const celebrated = new Set<string>();

/** Fire A's Celebration once per paid proposal per tab. Returns true the first time. */
export function celebrate(p: MatchProposal): boolean {
  if (celebrated.has(p.id)) return false;
  celebrated.add(p.id);
  window.dispatchEvent(new CustomEvent("trade:paid", { detail: p }));
  return true;
}

/** The celebration's SEE IT IN MY BAG / BACK TO MY BAG: this tab is done with the trade, so TradeWatcher closes its window. */
export const tradeDone = (id: string) => window.dispatchEvent(new CustomEvent("trade:done", { detail: id }));

/** A's sound system listens for these ("accept", "decline", "coin", …). */
export const sfx = (name: string) => window.dispatchEvent(new CustomEvent("sfx", { detail: name }));

/** "Yellow duck romper" → "ROMPER" */
export const shortName = (itemName: string) => (itemName.trim().split(/\s+/).pop() ?? "item").toUpperCase();

/** "The romper found a new home!" (a sentence: toasts and the paid receipt show it as written) */
export const newHomeText = (p: MatchProposal) => `The ${shortName(p.snapshot.itemName).toLowerCase()} found a new home!`;

/** "MAY 15" (UTC, so the demo clock reads the same everywhere) — for uppercase tags */
export const monthDay = (iso: ISODate) => monthDayText(iso).toUpperCase();

/** "May 15" (UTC) — inside sentences */
export const monthDayText = (iso: ISODate) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

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
