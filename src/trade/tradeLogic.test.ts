// Pure trade-screen helpers: the other party's name loader and "is this proposal gone?" detection.
import { describe, expect, it, vi } from "vitest";
import type { MatchProposal } from "../app/types";
import {
  HOLD_MAX_MS, confirmedGone, createPartyLoader, doneWithTrade, mandateFit, missingLive, nextLive, ownerSentence, popHeld, reopenLabel,
  reopenTarget, slimParty, tradeBanner, tradeReceipt, tradeToPop, type Party, type WatcherState,
} from "./tradeLogic";

const jo: Party = { id: "p_jo", name: "Olivia", avatar: { sprite: "parent_b", palette: "mint" }, pet: { sprite: "pet_b", name: "Pip" } };
const noSleep = () => Promise.resolve();
const rateLimited = () => Object.assign(new Error("Rate limit exceeded"), { code: "internal" });

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe("createPartyLoader", () => {
  it("retries a rate-limited fetch until it succeeds", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(rateLimited()).mockRejectedValueOnce(rateLimited()).mockResolvedValue(jo);
    const sleep = vi.fn((_ms: number) => noSleep());
    const loader = createPartyLoader({ fetch, sleep, delaysMs: [10, 20, 40] });
    expect(await loader.load("p_jo")).toEqual(jo);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([10, 20]);
    expect(loader.get("p_jo")).toEqual(jo);
  });

  it("gives up after the last retry, and a later load tries again", async () => {
    const fetch = vi.fn().mockRejectedValue(rateLimited());
    const loader = createPartyLoader({ fetch, sleep: noSleep, delaysMs: [1, 1] });
    expect(await loader.load("p_jo")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(3);
    fetch.mockResolvedValue(jo);
    expect(await loader.load("p_jo")).toEqual(jo);
  });

  it("doesn't retry fatal errors (not_found)", async () => {
    const fetch = vi.fn().mockRejectedValue(Object.assign(new Error("parent not found"), { code: "not_found" }));
    const loader = createPartyLoader({ fetch, sleep: noSleep, isFatal: (e) => (e as { code?: string }).code === "not_found" });
    expect(await loader.load("gone")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent loads and caches the result", async () => {
    let resolve!: (p: Party) => void;
    const fetch = vi.fn(() => new Promise<Party>((r) => { resolve = r; }));
    const loader = createPartyLoader({ fetch, sleep: noSleep });
    const a = loader.load("p_jo");
    const b = loader.load("p_jo");
    resolve(jo);
    expect(await a).toEqual(jo);
    expect(await b).toEqual(jo);
    await loader.load("p_jo");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps only public fields, and persists them for the next page load", async () => {
    const storage = memoryStorage();
    const leaky = { ...jo, phone: "+15550000000", photonUserId: "u1", key: "jo" } as unknown as Party;
    const first = createPartyLoader({ fetch: async () => leaky, storage });
    const got = await first.load("p_jo");
    expect(got).toEqual(jo);
    expect(JSON.stringify(got)).not.toContain("+1555");
    expect([...storage.m.values()].join()).not.toContain("+1555");

    const fetch = vi.fn();
    const second = createPartyLoader({ fetch, storage });
    expect(second.get("p_jo")).toEqual(jo);
    expect(await second.load("p_jo")).toEqual(jo);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("survives corrupt or throwing storage", async () => {
    const bad = { getItem: () => "{not json", setItem: () => { throw new Error("quota"); } };
    const loader = createPartyLoader({ fetch: async () => jo, storage: bad });
    expect(await loader.load("p_jo")).toEqual(jo);
  });

  it("fills defaults for a partial profile", () => {
    expect(slimParty({ id: "x", name: "X" } as Party)).toEqual({
      id: "x", name: "X", avatar: { sprite: "parent_a", palette: "peach" }, pet: { sprite: "pet_a", name: "Pet" },
    });
  });
});

const proposal = (id: string, status: MatchProposal["status"], buyerId = "jo", sellerId = "mina") =>
  ({ id, status, buyerId, sellerId }) as MatchProposal;

describe("gone detection", () => {
  const rows = {
    a: proposal("a", "open"),
    b: proposal("b", "both_accepted"),
    c: proposal("c", "paid"),
    d: proposal("d", "open", "sam", "mina"),
  };

  it("missingLive: only this parent's live proposals that the closet left out", () => {
    expect(missingLive(rows, "jo", ["b"])).toEqual(["a"]);
    expect(missingLive(rows, "jo", ["a", "b"])).toEqual([]);
    expect(missingLive(rows, "mina", [])).toEqual(["a", "b", "d"]);
  });

  it("confirmedGone: absent from a closet fetched after we last saw the row", () => {
    const seenAt = new Map([["a", 1000], ["b", 5000]]);
    expect(confirmedGone(["a", "b"], [], seenAt, 3000)).toEqual(["a"]);   // b arrived after the fetch began: stale, keep it
    expect(confirmedGone(["a", "b"], ["a"], seenAt, 9000)).toEqual(["b"]); // a is listed again
  });
});

describe("trade window watcher", () => {
  const fresh: WatcherState = { openId: null, dismissed: new Set() };

  it("pops the newest live trade, but not over an open window, on /trade/:id, or once dismissed", () => {
    expect(tradeToPop(fresh, "a", false)).toBe("a");
    expect(tradeToPop(fresh, null, false)).toBeNull();
    expect(tradeToPop({ ...fresh, openId: "a" }, "a", false)).toBeNull();
    expect(tradeToPop(fresh, "a", true)).toBeNull();
    expect(tradeToPop({ ...fresh, dismissed: new Set(["a"]) }, "a", false)).toBeNull();
  });

  it("SEE IT IN MY BAG on the paid trade closes its window for good; the next trade still pops", () => {
    const after = doneWithTrade({ ...fresh, openId: "a" }, "a");
    expect(after.openId).toBeNull();
    expect(tradeToPop(after, "a", false)).toBeNull();
    expect(tradeToPop(after, "b", false)).toBe("b");
  });

  it("a window that moved on to a newer trade stays up when the older one's celebration ends", () => {
    const before: WatcherState = { ...fresh, openId: "b" };
    const after = doneWithTrade(before, "a");
    expect(after.openId).toBe("b");
    expect(after.dismissed.has("a")).toBe(true);
    expect(before.dismissed.size).toBe(0); // state is replaced, not mutated
  });

  it("holds the pop while the pets' meeting is on screen, and pops once it leaves", () => {
    expect(tradeToPop(fresh, ["a"], false, true)).toBeNull();
    expect(tradeToPop(fresh, ["a"], false, false)).toBe("a");
  });

  it("the hold gives up after 20 s on the wall clock (a stuck scene never hides a trade for good)", () => {
    const t0 = 1_000_000;
    expect(popHeld(true, null, t0)).toBe(true); // the hold starts now
    expect(popHeld(true, t0, t0 + HOLD_MAX_MS - 1)).toBe(true);
    expect(popHeld(true, t0, t0 + HOLD_MAX_MS)).toBe(false);
    expect(popHeld(false, t0, t0 + 1)).toBe(false); // nothing on screen: pop at once
    expect(HOLD_MAX_MS).toBe(20_000);
  });

  it("after the first window is closed, the next live trade this tab hasn't closed pops", () => {
    const live = ["b", "a"]; // newest first
    expect(tradeToPop(fresh, live, false)).toBe("b");
    const afterB = doneWithTrade({ ...fresh, openId: "b" }, "b");
    expect(tradeToPop(afterB, live, false)).toBe("a");
    const afterBoth = doneWithTrade({ ...afterB, openId: "a" }, "a");
    expect(tradeToPop(afterBoth, live, false)).toBeNull();
    expect(nextLive(afterBoth, live)).toBeNull();
  });

  it("never pops a dismissed trade, even when it is the only one live", () => {
    const s: WatcherState = { ...fresh, dismissed: new Set(["a"]) };
    expect(tradeToPop(s, ["a"], false)).toBeNull();
    expect(tradeToPop(s, ["c", "a"], false)).toBe("c");
    expect(tradeToPop(s, [], false)).toBeNull();
  });

  it("the pill counts live trades and walks through them, starting from the newest", () => {
    expect(reopenLabel(1)).toBe("♥ TRADE OFFER · OPEN");
    expect(reopenLabel(2)).toBe("♥ 2 TRADE OFFERS · OPEN");
    const live = ["b", "a"];
    const s: WatcherState = { openId: null, dismissed: new Set(live) };
    expect(reopenTarget(s, live)).toBe("b");
    expect(reopenTarget({ ...s, lastId: "b" }, live)).toBe("a");
    expect(reopenTarget({ ...s, lastId: "a" }, live)).toBe("b"); // wraps round
    expect(reopenTarget({ ...s, lastId: "paid-one" }, live)).toBe("b");
    expect(reopenTarget(s, [])).toBeNull();
    expect(doneWithTrade({ ...s, openId: "b" }, "b").lastId).toBe("b");
  });
});

// ---------------------------------------------------------------- the receipt (trusted checkout)

describe("tradeReceipt", () => {
  it("2nd owner: 60% of the original, saves the rest", () => {
    expect(tradeReceipt({ originalPriceCents: 3000, priceCents: 1800, previousOwners: 1 })).toEqual({
      originalCents: 3000, priceCents: 1800, savedCents: 1200, ownerAfter: 2, pct: 60, finalHome: false,
    });
  });
  it("3rd owner: 40%, and it's the final home", () => {
    expect(tradeReceipt({ originalPriceCents: 3000, priceCents: 1200, previousOwners: 2 })).toMatchObject({
      savedCents: 1800, ownerAfter: 3, pct: 40, finalHome: true,
    });
  });
  it("never shows a negative saving", () => {
    expect(tradeReceipt({ originalPriceCents: 1000, priceCents: 1200, previousOwners: 1 }).savedCents).toBe(0);
  });
});

describe("mandateFit", () => {
  const m = { maxPriceCents: 2500, monthlyBudgetCents: 10000 };
  it("is within the rules and says what's left after paying", () => {
    expect(mandateFit(m, 1800, 1800)).toEqual({ ok: true, withinMax: true, withinBudget: true, maxCents: 2500, leftAfterCents: 6400 });
  });
  it("flags a price over the per-trade max", () => {
    expect(mandateFit(m, 0, 3000)).toMatchObject({ ok: false, withinMax: false, withinBudget: true });
  });
  it("flags a trade that would blow the monthly budget", () => {
    expect(mandateFit(m, 9000, 1800)).toMatchObject({ ok: false, withinMax: true, withinBudget: false, leftAfterCents: 0 });
  });
  it("after paying, spent already includes this trade", () => {
    expect(mandateFit(m, 1800, 1800, true)).toMatchObject({ ok: true, leftAfterCents: 8200 });
  });
});

// ---------------------------------------------------------------- the promise banner

describe("tradeBanner", () => {
  it("explains that only the buyer approves the demo trade", () => {
    expect(tradeBanner("open", "buyer", "Olivia")).toEqual({ text: "Only the buyer approves · demo payment, no real charge", tone: "promise" });
    expect(tradeBanner("open", null, "Olivia").text).toBe("Only the buyer approves · demo payment, no real charge");
  });
  it("after both said yes, tells the buyer it's their tap and the seller who pays", () => {
    expect(tradeBanner("both_accepted", "buyer", "Olivia").text).toBe("You both said yes. Nothing is charged until you tap Pay.");
    expect(tradeBanner("both_accepted", "seller", "Olivia").text).toBe("You both said yes. Waiting for Olivia to pay.");
  });
  it("never repeats the 'until you both accept' promise once it's past", () => {
    for (const s of ["both_accepted", "paid", "declined", "expired", "payment_failed"] as const) {
      for (const r of ["buyer", "seller", null] as const) expect(tradeBanner(s, r, "Olivia").text).not.toMatch(/until you both accept|until both parents accept/i);
    }
  });
  it("says what happened after the trade ends, in sentence case", () => {
    expect(tradeBanner("paid", "seller", "Olivia")).toEqual({ text: "Paid · demo payment, no real charge", tone: "paid" });
    expect(tradeBanner("declined", "buyer", "Olivia")).toEqual({ text: "No trade · nothing was charged", tone: "ended" });
    expect(tradeBanner("expired", "seller", "Olivia").tone).toBe("ended");
    expect(tradeBanner("payment_failed", "buyer", "Olivia").text).toMatch(/nothing was charged/);
    for (const s of ["open", "both_accepted", "paid", "declined", "expired", "payment_failed"] as const) {
      const t = tradeBanner(s, "buyer", "Olivia").text;
      expect(t).not.toBe(t.toUpperCase());
    }
  });
});

describe("ownerSentence", () => {
  it("future before paying, past after", () => {
    expect(ownerSentence("both_accepted", "buyer", "Olivia", 2)).toBe("You become owner 2 of 3.");
    expect(ownerSentence("open", "seller", "Olivia", 3)).toBe("Olivia becomes owner 3 of 3.");
    expect(ownerSentence("paid", "buyer", "Olivia", 2)).toBe("You became owner 2 of 3.");
    expect(ownerSentence("paid", "seller", "Olivia", 2)).toBe("Olivia became owner 2 of 3.");
  });
  it("a trade that didn't happen", () => {
    expect(ownerSentence("declined", "buyer", "Olivia", 2)).toBe("You would have become owner 2 of 3.");
  });
});
