// OWNER: Agent 2 (B5). Pure helpers behind the trade screens (no React, no api import) so vitest can cover them.
import type { MatchProposal, PetMandate, ProposalSnapshot, ProposalStatus, PublicParty } from "../app/types";
import { RESALE_PCT } from "../../base44/shared/pricing.ts";

// ---------------------------------------------------------------- the other party's public profile

/** The only fields the trade window shows about a parent (the contract's PublicParty). Never a phone or any other private field. */
export type Party = PublicParty;

export function slimParty(p: Party): Party {
  return {
    id: p.id, name: p.name,
    avatar: { sprite: p.avatar?.sprite ?? "parent_a", palette: p.avatar?.palette ?? "peach" },
    pet: { sprite: p.pet?.sprite ?? "pet_a", name: p.pet?.name ?? "Pet" },
  };
}

type KV = Pick<Storage, "getItem" | "setItem">;

export interface PartyLoaderOpts {
  fetch(id: string): Promise<Party>;
  /** Backoff between attempts; the number of retries is its length. */
  delaysMs?: number[];
  /** Errors that won't get better by retrying (e.g. not_found). */
  isFatal?(e: unknown): boolean;
  sleep?(ms: number): Promise<void>;
  /** sessionStorage in the browser: a reload mid-demo doesn't refetch names under the rate limit. */
  storage?: KV | null;
  storageKey?: string;
}

export interface PartyLoader {
  get(id: string): Party | null;
  /** Resolves to the party, or null after the last retry failed (a later call tries again). */
  load(id: string): Promise<Party | null>;
}

const MAX_CACHED = 24;

export function createPartyLoader(opts: PartyLoaderOpts): PartyLoader {
  const delays = opts.delaysMs ?? [1000, 2000, 4000, 8000];
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const key = opts.storageKey ?? "relay:trade:parties";
  const cache = new Map<string, Party>();
  const inflight = new Map<string, Promise<Party | null>>();

  try {
    const saved = JSON.parse(opts.storage?.getItem(key) ?? "[]") as Party[];
    for (const p of saved) if (p?.id && p.name) cache.set(p.id, slimParty(p));
  } catch { /* corrupt or unavailable storage: start empty */ }

  const persist = () => {
    try { opts.storage?.setItem(key, JSON.stringify([...cache.values()].slice(-MAX_CACHED))); } catch { /* quota / private mode */ }
  };

  function load(id: string): Promise<Party | null> {
    const hit = cache.get(id);
    if (hit) return Promise.resolve(hit);
    const pending = inflight.get(id);
    if (pending) return pending;
    const run = (async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          const party = slimParty(await opts.fetch(id));
          cache.set(id, party);
          persist();
          return party;
        } catch (e) {
          if (opts.isFatal?.(e) || attempt >= delays.length) return null;
          await sleep(delays[attempt]);
        }
      }
    })().finally(() => inflight.delete(id));
    inflight.set(id, run);
    return run;
  }

  return { get: (id) => cache.get(id) ?? null, load };
}

// ---------------------------------------------------------------- proposals that no longer exist

export const isLive = (p: MatchProposal) => p.status === "open" || p.status === "both_accepted";

/** Live proposals of `meId` that a closet (which always lists every live proposal) left out. */
export function missingLive(rows: Record<string, MatchProposal>, meId: string, listed: Iterable<string>): string[] {
  const inCloset = new Set(listed);
  return Object.values(rows)
    .filter((p) => isLive(p) && (p.buyerId === meId || p.sellerId === meId) && !inCloset.has(p.id))
    .map((p) => p.id);
}

/**
 * Of `ids`, the ones that are really gone: still absent from a closet whose fetch started after we last saw the row.
 * (A closet fetched before a proposal was created is merely stale, not proof of deletion.)
 */
export function confirmedGone(ids: string[], listed: Iterable<string>, seenAt: Map<string, number>, fetchStartedAt: number): string[] {
  const inCloset = new Set(listed);
  return ids.filter((id) => !inCloset.has(id) && (seenAt.get(id) ?? 0) < fetchStartedAt);
}

// ---------------------------------------------------------------- the window over any screen (TradeWatcher)

export interface WatcherState {
  /** The trade whose window is up, if any. */
  openId: string | null;
  /** Trades this tab is done with: they never pop by themselves again (the pill can still reopen a live one). */
  dismissed: ReadonlySet<string>;
}

/** The trade the watcher pops now: the newest live one, unless a window is up, /trade/:id shows it, or it was dismissed. */
export function tradeToPop(s: WatcherState, activeId: string | null, onTradeRoute: boolean): string | null {
  return !activeId || s.openId || onTradeRoute || s.dismissed.has(activeId) ? null : activeId;
}

/**
 * This tab is done with trade `id` (DONE / ✕ in its window, or the celebration's SEE IT IN MY BAG): it is dismissed and
 * its window closes. A window that already moved on to a newer trade stays up.
 */
export function doneWithTrade(s: WatcherState, id: string): WatcherState {
  return { openId: s.openId === id ? null : s.openId, dismissed: new Set(s.dismissed).add(id) };
}

// ---------------------------------------------------------------- the promise banner

export type TradeRole = "buyer" | "seller" | null;

export interface TradeBanner {
  text: string;
  /** promise = nothing charged yet; paid = the demo payment went through; ended = no trade, nothing charged. */
  tone: "promise" | "paid" | "ended";
}

/**
 * The sticky line at the top of the trade window. It follows the trade, so the promise never contradicts the
 * screen: before anyone pays it says what still has to happen; afterwards it says what did (always "nothing
 * charged" for a trade that didn't happen, and "demo payment, no real charge" for one that did).
 */
export function tradeBanner(status: ProposalStatus, role: TradeRole, buyerName: string): TradeBanner {
  switch (status) {
    case "open":
      return { text: role ? "Nothing is charged until you both accept." : "Nothing is charged until both parents accept.", tone: "promise" };
    case "both_accepted":
      if (role === "buyer") return { text: "You both said yes. Nothing is charged until you tap Pay.", tone: "promise" };
      if (role === "seller") return { text: `You both said yes. Waiting for ${buyerName} to pay.`, tone: "promise" };
      return { text: `Both said yes. Nothing is charged until ${buyerName} pays.`, tone: "promise" };
    case "paid":
      return { text: "Paid · demo payment, no real charge", tone: "paid" };
    case "payment_failed":
      return { text: "Payment didn't go through · nothing was charged", tone: "ended" };
    case "declined":
    case "expired":
    default:
      return { text: "No trade · nothing was charged", tone: "ended" };
  }
}

/** "You become owner 2 of 3" before paying, "You became owner 2 of 3" after, "would have become" for a trade that didn't happen. */
export function ownerSentence(status: ProposalStatus, role: TradeRole, buyerName: string, ownerAfter: 2 | 3): string {
  const who = role === "buyer" ? "You" : buyerName;
  const verb = status === "paid" ? "became"
    : status === "declined" || status === "expired" || status === "payment_failed" ? "would have become"
    : role === "buyer" ? "become" : "becomes";
  return `${who} ${verb} owner ${ownerAfter} of 3.`;
}

// ---------------------------------------------------------------- the receipt (trusted checkout)

/** The price rule behind a trade, from the proposal's snapshot (the price itself always comes from the server). */
export interface TradeReceipt {
  originalCents: number;
  priceCents: number;
  /** What the buyer saves against buying it new. */
  savedCents: number;
  /** The buyer becomes owner 2 or owner 3 (of at most 3). */
  ownerAfter: 2 | 3;
  /** % of the original the next owner pays: 60 for the 2nd owner, 40 for the 3rd. */
  pct: number;
  /** Owner 3 is the item's final home: it can never be listed again. */
  finalHome: boolean;
}

export function tradeReceipt(s: Pick<ProposalSnapshot, "originalPriceCents" | "priceCents" | "previousOwners">): TradeReceipt {
  const ownerAfter: 2 | 3 = s.previousOwners >= 2 ? 3 : 2;
  return {
    originalCents: s.originalPriceCents,
    priceCents: s.priceCents,
    savedCents: Math.max(0, s.originalPriceCents - s.priceCents),
    ownerAfter,
    pct: Math.round(RESALE_PCT[ownerAfter === 3 ? 2 : 1] * 100),
    finalHome: ownerAfter === 3,
  };
}

export interface MandateFit {
  ok: boolean;
  withinMax: boolean;
  withinBudget: boolean;
  maxCents: number;
  /** Budget left this month once this trade is paid (0 when over). */
  leftAfterCents: number;
}

/**
 * Is a trade inside the buyer's pet rules? For the receipt only: the server enforces the same rules.
 * `paid`: spentThisMonthCents already includes this trade.
 */
export function mandateFit(
  m: Pick<PetMandate, "maxPriceCents" | "monthlyBudgetCents">, spentThisMonthCents: number, priceCents: number, paid = false,
): MandateFit {
  const spentAfter = Math.max(0, spentThisMonthCents) + (paid ? 0 : priceCents);
  const withinMax = priceCents <= m.maxPriceCents;
  const withinBudget = spentAfter <= m.monthlyBudgetCents;
  return {
    ok: withinMax && withinBudget,
    withinMax,
    withinBudget,
    maxCents: m.maxPriceCents,
    leftAfterCents: Math.max(0, m.monthlyBudgetCents - spentAfter),
  };
}
