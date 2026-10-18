// Match eval table: every case is { name, setup, expected }. The base scenario is the demo meet on Oct 18:
// Caesar's romper (6-9M, $18.00, gently used) vs Olivia's shared need for 6-9M tops/onesies, Pea 7 months old.
import { describe, expect, it } from "vitest";
import { checkEligibility, findMatches, reasonLine } from "./match.ts";
import { DEMO_DATES } from "./seed.ts";
import type { Child, ClothingItem, Listing, Need } from "./types.ts";

const MINA = "p_mina", JO = "p_jo", SAM = "p_sam";

interface Scenario { listings: Listing[]; items: ClothingItem[]; needs: Need[]; children: Child[]; buyerId: string; now: string }
type Expected = { ok: true; weeks: number } | { ok: false; reason: string } | { order: string[] };
interface Case { name: string; setup: (s: Scenario) => void; expected: Expected }

const item = (id: string, over: Partial<ClothingItem> = {}): ClothingItem => ({
  id, name: "Yellow duck romper", category: "onesie", icon: "item_romper", size: "6-9M", originalPriceCents: 3000,
  originalPurchaseDate: DEMO_DATES.start, ownerCount: 1, currentOwnerId: MINA, childId: "c_bean", photos: [],
  ownershipHistory: [{ ownerId: MINA, from: DEMO_DATES.start }], status: "listed", ...over,
});
const listing = (id: string, itemId: string, over: Partial<Listing> = {}): Listing => ({
  id, itemId, sellerId: MINA, condition: "gently_used", conditionNote: "", priceCents: 1800, shared: true,
  status: "active", createdAt: DEMO_DATES.nudge, ...over,
});
function base(): Scenario {
  return {
    items: [item("i_romper")],
    listings: [listing("l_romper", "i_romper")],
    needs: [{ id: "n_jo", parentId: JO, childId: "c_pea", sizes: ["6-9M"], categories: ["top", "onesie"], shared: true, createdAt: "2026-10-01T17:00:00.000Z" }],
    children: [{ id: "c_pea", parentId: JO, nickname: "Pea", birthDate: "2026-03-01T00:00:00.000Z" }],
    buyerId: JO,
    now: DEMO_DATES.meet,
  };
}
/** A second eligible listing for ranking cases (same seller, same size unless overridden). */
const addListing = (s: Scenario, id: string, itemOver: Partial<ClothingItem>, listingOver: Partial<Listing>) => {
  s.items.push(item(`i_${id}`, { name: `Item ${id}`, ...itemOver }));
  s.listings.push(listing(`l_${id}`, `i_${id}`, listingOver));
};

const CASES: Case[] = [
  { name: "fits: the demo romper matches Olivia with 4 weeks left", setup: () => {}, expected: { ok: true, weeks: 4 } },
  { name: "size miss", setup: (s) => { s.needs[0].sizes = ["9-12M"]; }, expected: { ok: false, reason: "size not in need" } },
  { name: "category miss", setup: (s) => { s.needs[0].categories = ["bottom"]; }, expected: { ok: false, reason: "category not wanted" } },
  { name: "no categories means any category", setup: (s) => { s.needs[0].categories = undefined; s.items[0].category = "bottom"; }, expected: { ok: true, weeks: 4 } },
  { name: "over max price", setup: (s) => { s.needs[0].maxPriceCents = 1799; }, expected: { ok: false, reason: "over max price" } },
  { name: "exactly at max price is fine", setup: (s) => { s.needs[0].maxPriceCents = 1800; }, expected: { ok: true, weeks: 4 } },
  { name: "listing not shared", setup: (s) => { s.listings[0].shared = false; }, expected: { ok: false, reason: "listing not shared" } },
  { name: "need not shared", setup: (s) => { s.needs[0].shared = false; }, expected: { ok: false, reason: "need not shared" } },
  { name: "own listing", setup: (s) => { s.buyerId = MINA; s.needs[0].parentId = MINA; }, expected: { ok: false, reason: "own listing" } },
  { name: "someone else's need", setup: (s) => { s.needs[0].parentId = SAM; }, expected: { ok: false, reason: "need belongs to someone else" } },
  { name: "third owner (final home)", setup: (s) => { s.items[0].ownerCount = 3; }, expected: { ok: false, reason: "item already has 3 owners" } },
  { name: "withdrawn listing", setup: (s) => { s.listings[0].status = "withdrawn"; }, expected: { ok: false, reason: "listing not active" } },
  { name: "sold listing", setup: (s) => { s.listings[0].status = "sold"; }, expected: { ok: false, reason: "listing not active" } },
  { name: "item already in a trade", setup: (s) => { s.items[0].status = "pending_trade"; }, expected: { ok: false, reason: "item not listed" } },
  { name: "child too young (12-18M for a 7-month-old)", setup: (s) => { s.items[0].size = "12-18M"; s.needs[0].sizes = ["12-18M"]; },
    expected: { ok: false, reason: "child doesn't fit this size now" } },
  { name: "child too old (3-6M for a 7-month-old)", setup: (s) => { s.items[0].size = "3-6M"; s.needs[0].sizes = ["3-6M"]; },
    expected: { ok: false, reason: "child doesn't fit this size now" } },
  { name: "sizing up one month early is allowed (9-12M at 8 months)",
    setup: (s) => { s.children[0].birthDate = "2026-02-15T00:00:00.000Z"; s.items[0].size = "9-12M"; s.needs[0].sizes = ["9-12M"]; },
    expected: { ok: true, weeks: 15 } },
  { name: "two listings ranked by weeks left (9-12M beats 6-9M for an 8-month-old)",
    setup: (s) => {
      s.children[0].birthDate = "2026-02-15T00:00:00.000Z";
      s.needs[0].sizes = ["6-9M", "9-12M"];
      s.listings[0].condition = "like_new";                      // better condition, but fewer weeks
      addListing(s, "big", { size: "9-12M" }, { condition: "well_loved" });
    },
    expected: { order: ["l_big", "l_romper"] } },
  { name: "ties on weeks broken by condition",
    setup: (s) => { addListing(s, "new", {}, { condition: "like_new" }); addListing(s, "worn", {}, { condition: "well_loved" }); },
    expected: { order: ["l_new", "l_romper", "l_worn"] } },
  { name: "ties on weeks and condition broken by date (newest first)",
    setup: (s) => {
      addListing(s, "older", {}, { createdAt: "2026-09-01T17:00:00.000Z" });
      addListing(s, "newer", {}, { createdAt: "2026-10-10T17:00:00.000Z" });
    },
    expected: { order: ["l_newer", "l_romper", "l_older"] } },
  { name: "ineligible listings are left out of the ranking",
    setup: (s) => { addListing(s, "private", {}, { shared: false, condition: "like_new" }); addListing(s, "final", { ownerCount: 3 }, {}); },
    expected: { order: ["l_romper"] } },
  { name: "one candidate per listing even when two needs match it",
    setup: (s) => { s.needs.push({ ...s.needs[0], id: "n_jo2", categories: undefined }); },
    expected: { order: ["l_romper"] } },
];

describe("match eval table", () => {
  it("has 15+ cases", () => expect(CASES.length).toBeGreaterThanOrEqual(15));

  for (const c of CASES) {
    it(c.name, () => {
      const s = base();
      c.setup(s);
      const matches = findMatches({ listings: s.listings, items: s.items, needs: s.needs, buyerChildren: s.children,
        buyerId: s.buyerId, buyerName: "Olivia", now: s.now });
      const e = c.expected;
      if ("order" in e) {
        expect(matches.map((m) => m.listingId)).toEqual(e.order);
        return;
      }
      const r = checkEligibility({ listing: s.listings[0], item: s.items[0], need: s.needs[0], buyerChild: s.children[0], buyerId: s.buyerId, now: s.now });
      if (e.ok) {
        expect(r).toEqual({ ok: true, wearWeeksLeft: e.weeks });
        expect(matches).toHaveLength(1);
        expect(matches[0]).toMatchObject({ listingId: "l_romper", needId: s.needs[0].id, wearWeeksLeft: e.weeks });
      } else {
        expect(r).toEqual({ ok: false, reason: e.reason });
        expect(matches).toEqual([]);
      }
    });
  }
});

describe("findMatches output", () => {
  it("carries a reason line and a score that orders like the ranking keys", () => {
    const s = base();
    addListing(s, "new", {}, { condition: "like_new" });
    const m = findMatches({ listings: s.listings, items: s.items, needs: s.needs, buyerChildren: s.children, buyerId: JO, buyerName: "Olivia", now: s.now });
    expect(m[0].score).toBeGreaterThan(m[1].score);
    expect(m[1].reason).toBe(reasonLine("Olivia", s.items[0], 4));
  });
});

describe("reasonLine", () => {
  it("is deterministic, plain, and names the buyer, size and weeks", () => {
    const romper = { name: "Yellow duck romper", size: "6-9M" as const };
    const line = reasonLine("Olivia", romper, 4);
    expect(reasonLine("Olivia", romper, 4)).toBe(line);
    expect(line).toMatch(/Olivia/);
    expect(line).toMatch(/6-9M/);
    expect(line).toMatch(/yellow duck romper/);
    expect(line).toMatch(/about 4 more weeks/);
    expect(reasonLine("Olivia", romper, 1)).toMatch(/about 1 more week\b/);
    expect(reasonLine("Olivia", romper, 0)).toMatch(/fits right now/);
  });

  it("varies across matches", () => {
    const lines = new Set<string>();
    for (const buyer of ["Olivia", "Freja", "Caesar", "Ana", "Lee", "Kai"]) {
      for (const weeks of [1, 2, 3, 4, 5]) lines.add(reasonLine(buyer, { name: "Mint onesie", size: "6-9M" }, weeks).replace(buyer, "X").replace(/\d+ more weeks?/, "N"));
    }
    expect(lines.size).toBeGreaterThan(1);
  });
});
