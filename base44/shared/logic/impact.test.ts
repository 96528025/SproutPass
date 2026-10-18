// Impact + rewards: pure rules (computeImpact) and the getImpact handler on the seed, before and after a real trade.
import { beforeEach, describe, expect, it } from "vitest";
import { createFakeDb, type FakeDb } from "../testing/fakeDb.ts";
import { DEMO_DATES } from "../seed.ts";
import type { ClothingItem } from "../types.ts";
import { demoClock, demoReset } from "./demo.ts";
import { listItem, resolveNudge } from "./closet.ts";
import { createProposal, decideProposal, payProposal } from "./trade.ts";
import {
  ASSUMPTIONS, BADGES, computeImpact, daysText, equivalents, FACTORS, floorTo, GARMENT_KG, getImpact, handoffsOf, perGarment,
  POINTS, SOURCES, type ImpactInput,
} from "./impact.ts";

const iso = (d: string) => `${d}T17:00:00.000Z`;

function item(over: Partial<ClothingItem> & Pick<ClothingItem, "id" | "ownershipHistory">): ClothingItem {
  return {
    name: "Thing", category: "onesie", icon: "item_onesie", size: "6-9M", originalPriceCents: 3000,
    originalPurchaseDate: iso("2026-01-01"), ownerCount: over.ownershipHistory.length as 1 | 2 | 3,
    currentOwnerId: over.ownershipHistory[over.ownershipHistory.length - 1].ownerId, childId: "c1", photos: [],
    status: "in_closet", ...over,
  };
}

const parents = [
  { id: "pa", key: "ann", name: "Ann" },
  { id: "pb", key: "bo", name: "Bo" },
  { id: "pc", key: "cy", name: "Cy" },
];
const empty: ImpactInput = { parents, items: [], proposals: [], listings: [], nudges: [], needs: [] };

describe("handoffsOf", () => {
  it("one hand-off per move, at most two per item, with the recorded price or the 60% / 40% rule", () => {
    const items = [
      item({ id: "i1", ownershipHistory: [{ ownerId: "pa", from: iso("2026-01-01") }] }),
      item({ id: "i2", originalPriceCents: 4000, category: "outerwear", ownershipHistory: [
        { ownerId: "x", from: iso("2026-01-01"), to: iso("2026-02-01") },
        { ownerId: "pa", from: iso("2026-02-01"), to: iso("2026-03-01"), priceCents: 2500 },
        { ownerId: "pb", from: iso("2026-03-01") },
      ] }),
    ];
    const h = handoffsOf(items);
    expect(h).toHaveLength(2);
    expect(h[0]).toMatchObject({ itemId: "i2", home: 2, fromId: "x", toId: "pa", priceCents: 2500, priceRecorded: true });
    expect(h[1]).toMatchObject({ itemId: "i2", home: 3, fromId: "pa", toId: "pb", priceCents: 1600, priceRecorded: false });
  });

  it("ignores broken rows: no history, a repeated owner, a 4th entry", () => {
    const items = [
      item({ id: "a", ownershipHistory: [{ ownerId: "pa", from: iso("2026-01-01") }] }),
      { ...item({ id: "b", ownershipHistory: [{ ownerId: "pa", from: iso("2026-01-01") }] }), ownershipHistory: undefined } as unknown as ClothingItem,
      item({ id: "c", ownershipHistory: [{ ownerId: "pa", from: iso("2026-01-01") }, { ownerId: "pa", from: iso("2026-02-01") }] }),
      item({ id: "d", ownershipHistory: [
        { ownerId: "pa", from: iso("2026-01-01") }, { ownerId: "pb", from: iso("2026-02-01"), priceCents: 1800 },
        { ownerId: "pc", from: iso("2026-03-01"), priceCents: 1200 }, { ownerId: "pa", from: iso("2026-04-01"), priceCents: 1 },
      ] as ClothingItem["ownershipHistory"] }),
    ];
    expect(handoffsOf(items).map((h) => `${h.itemId}:${h.home}`)).toEqual(["d:2", "d:3"]);
  });
});

describe("computeImpact", () => {
  it("is all zeros with nothing re-homed, and everyone is still on the board", () => {
    const v = computeImpact(empty);
    expect(v).toMatchObject({
      itemsRehomed: 0, tradesCompleted: 0, dollarsSavedCents: 0, dollarsEarnedCents: 0,
      co2SavedKg: 0, waterSavedL: 0, wasteDivertedKg: 0, byCategory: [],
    });
    expect(v.points.map((p) => [p.name, p.points])).toEqual([["Ann", 0], ["Bo", 0], ["Cy", 0]]);
    expect(v.me).toBeUndefined();
    expect(v.assumptions.length).toBeGreaterThan(3);
  });

  it("totals money and footprint per hand-off from the category factors", () => {
    const v = computeImpact({ ...empty, items: [
      item({ id: "i1", category: "onesie", originalPriceCents: 3000, ownershipHistory: [
        { ownerId: "pa", from: iso("2026-01-01"), to: iso("2026-09-20") }, { ownerId: "pb", from: iso("2026-09-20"), priceCents: 1800 },
      ] }),
      item({ id: "i2", category: "outerwear", originalPriceCents: 5000, ownershipHistory: [
        { ownerId: "pc", from: iso("2026-01-01"), to: iso("2026-05-01") }, { ownerId: "pa", from: iso("2026-05-01"), priceCents: 3000 },
      ] }),
    ] });
    const onesie = perGarment("onesie"), jacket = perGarment("outerwear");
    expect(onesie.co2Kg).toBeCloseTo(GARMENT_KG.onesie * FACTORS.co2KgPerKg * FACTORS.displacement);
    expect(v.itemsRehomed).toBe(2);
    expect(v.dollarsSavedCents).toBe(1200 + 2000);
    expect(v.dollarsEarnedCents).toBe(1800 + 3000);
    // 0.9 + 3.15 = 4.05 kg, 420 + 1470 = 1890 L, 0.066 + 0.231 = 0.297 kg: every total rounded DOWN, never up.
    expect(onesie.co2Kg + jacket.co2Kg).toBeCloseTo(4.05, 6);
    expect(v.co2SavedKg).toBe(4);
    expect(v.waterSavedL).toBe(1890);
    expect(v.wasteDivertedKg).toBe(0.29);
    expect(v.byCategory.map((c) => c.category).sort()).toEqual(["onesie", "outerwear"]);
    expect(v.byCategory.find((c) => c.category === "outerwear")).toMatchObject({ co2Kg: 3.1, waterL: 1470, wasteKg: 0.23 });
  });

  it("rounds totals down (as the screen says), never up, and survives float noise", () => {
    expect(floorTo(10.35, 1)).toBe(10.3);
    expect(floorTo(0.759, 2)).toBe(0.75);
    expect(floorTo(0.1 + 0.2, 1)).toBe(0.3); // 0.30000000000000004
    expect(floorTo(2.9999999999, 0)).toBe(3); // float noise, not a real 2.99
    expect(floorTo(1889.6, 0)).toBe(1889);
    expect(floorTo(0, 2)).toBe(0);
    expect(ASSUMPTIONS.join(" ")).toContain("rounded down");
  });

  it("is conservative: a re-homed onesie avoids under 1 kg CO2e and under 500 litres", () => {
    const g = perGarment("onesie");
    expect(g.co2Kg).toBeLessThan(1);
    expect(g.waterL).toBeLessThan(500);
    expect(g.wasteKg).toBeLessThan(GARMENT_KG.onesie);
  });

  it("awards points and badges from the rules, sorted by points, with `me` and the next badge", () => {
    const v = computeImpact({
      ...empty,
      items: [
        item({ id: "i1", ownershipHistory: [
          { ownerId: "pa", from: iso("2026-01-01"), to: iso("2026-10-18") }, { ownerId: "pb", from: iso("2026-10-18"), priceCents: 1800 },
        ] }),
        item({ id: "i2", ownershipHistory: [
          { ownerId: "pc", from: iso("2026-01-01"), to: iso("2026-02-01") },
          { ownerId: "pa", from: iso("2026-02-01"), to: iso("2026-03-01"), priceCents: 1800 },
          { ownerId: "pb", from: iso("2026-03-01"), priceCents: 1200 },
        ] }),
      ],
      proposals: [{ id: "p1", status: "paid" }, { id: "p2", status: "declined" }, { id: "p1", status: "paid" }],
      listings: [
        { id: "l1", itemId: "i1", sellerId: "pa", status: "sold", createdAt: iso("2026-09-21") },
        { id: "l1b", itemId: "i1", sellerId: "pa", status: "active", createdAt: iso("2026-09-21") }, // same item: once
        { id: "l2", itemId: "i9", sellerId: "pc", status: "withdrawn", createdAt: iso("2026-09-20") },
      ],
      nudges: [
        { id: "n1", itemId: "i1", parentId: "pa", kind: "outgrow_check", createdAt: iso("2026-09-20") },
        { id: "n2", itemId: "i9", parentId: "pc", kind: "outgrow_check", createdAt: iso("2026-09-20") },
      ],
      needs: [
        { id: "d1", parentId: "pb", shared: true }, { id: "d2", parentId: "pc", shared: false },
        ...[1, 2, 3, 4].map((i) => ({ id: `e${i}`, parentId: "pc", shared: true })),
      ],
    }, { parentKey: "ann" });

    // Ann: sold i1 (50) + sold i2 into its final home (50 + 25) + bought i2 (30) + quick listing of i1 (25)
    const ann = v.points.find((p) => p.name === "Ann")!;
    expect(ann.points).toBe(POINTS.sold * 2 + POINTS.finalHome + POINTS.bought + POINTS.quickList);
    expect(ann.badges).toEqual(["Quick Pass", "First Pass", "New Home", "Final Home", "Relay Regular"]);
    // Bo: bought twice (60) + one shared need (10)
    expect(v.points.find((p) => p.name === "Bo")).toMatchObject({ points: POINTS.bought * 2 + POINTS.sharedNeed });
    // Cy: sold i2 (50) + shared needs capped at 3 (30); the private need and the withdrawn listing don't count
    expect(v.points.find((p) => p.name === "Cy")).toMatchObject({
      points: POINTS.sold + POINTS.sharedNeed * 3, badges: ["Good Neighbor", "First Pass"],
    });
    expect(v.points.map((p) => p.name)).toEqual(["Ann", "Cy", "Bo"]);
    expect(v.tradesCompleted).toBe(1);
    expect(v.me).toMatchObject({ parentId: "pa", points: ann.points, badges: ann.badges, nextBadge: "Good Neighbor", handoffs: 3 });
    expect(v.me!.earnedCents).toBe(1800 + 1200);
    expect(v.me!.savedCents).toBe(3000 - 1800);
  });

  it("a listing long after the nudge, or before it, is not a quick pass", () => {
    const base = { id: "l", itemId: "i1", sellerId: "pa", status: "active" as const };
    const nudges = [{ id: "n", itemId: "i1", parentId: "pa", kind: "outgrow_check" as const, createdAt: iso("2026-09-20") }];
    const late = computeImpact({ ...empty, nudges, listings: [{ ...base, createdAt: iso("2026-10-18") }] });
    const early = computeImpact({ ...empty, nudges, listings: [{ ...base, createdAt: iso("2026-09-19") }] });
    const ontime = computeImpact({ ...empty, nudges, listings: [{ ...base, createdAt: iso("2026-09-23") }] });
    expect(late.points.find((p) => p.name === "Ann")!.points).toBe(0);
    expect(early.points.find((p) => p.name === "Ann")!.points).toBe(0);
    expect(ontime.points.find((p) => p.name === "Ann")!.points).toBe(POINTS.quickList);
  });

  it("finds `me` by id or key; an unknown parent gets no `me`; a parent with every badge has no next badge", () => {
    expect(computeImpact(empty, { parentId: "pb" }).me?.parentId).toBe("pb");
    expect(computeImpact(empty, { parentKey: "nobody" }).me).toBeUndefined();
    expect(computeImpact(empty, { parentKey: "cy" }).me).toMatchObject({ points: 0, badges: [], nextBadge: BADGES[0].name });
  });

  it("is deterministic: the same rows in any order give the same view", () => {
    const items = [
      item({ id: "i1", ownershipHistory: [{ ownerId: "pa", from: iso("2026-01-01") }, { ownerId: "pb", from: iso("2026-02-01"), priceCents: 1800 }] }),
      item({ id: "i2", ownershipHistory: [{ ownerId: "pb", from: iso("2026-01-01") }, { ownerId: "pc", from: iso("2026-03-01"), priceCents: 1800 }] }),
    ];
    const a = computeImpact({ ...empty, items });
    const b = computeImpact({ ...empty, items: [...items].reverse(), parents: [...parents].reverse() });
    expect(b).toEqual(a);
  });
});

describe("equivalents + wording", () => {
  it("turns totals into car miles, days of drinking water and onesies (rounded down)", () => {
    expect(equivalents({ co2SavedKg: 9.5, waterSavedL: 4410, wasteDivertedKg: 0.69 })).toEqual({ carMiles: 23, drinkingDays: 2205, onesies: 6 });
    expect(equivalents({ co2SavedKg: 0, waterSavedL: 0, wasteDivertedKg: 0 })).toEqual({ carMiles: 0, drinkingDays: 0, onesies: 0 });
  });
  it("words days, months and years", () => {
    expect(daysText(1)).toBe("1 day");
    expect(daysText(45)).toBe("45 days");
    expect(daysText(210)).toBe("6 months");
    expect(daysText(2205)).toBe("6 years");
  });
  it("lists its sources and states the assumptions behind every factor", () => {
    expect(SOURCES.length).toBeGreaterThanOrEqual(4);
    for (const s of SOURCES) expect(s.url).toMatch(/^https:\/\//);
    const text = ASSUMPTIONS.join(" ");
    for (const word of ["WRAP", "Farrant", "EPA", "estimates"]) expect(text).toContain(word);
  });
});

// ---------------------------------------------------------------- the handler on the demo seed

describe("getImpact (seed + a real trade)", () => {
  let db: FakeDb;
  beforeEach(async () => {
    db = createFakeDb();
    await demoReset(db, { MINA_PHONE: "+15555550101" });
  });

  it("before the demo: the seed's earlier hand-offs, Freja leads, no in-app trades, and no phone anywhere", async () => {
    const v = await getImpact(db);
    // sweater Freja → Caesar, sailor set → Olivia, cardigan → Lee → Freja (the last one priced by the 40% rule)
    expect(v.itemsRehomed).toBe(4);
    expect(v.tradesCompleted).toBe(0);
    expect(v.dollarsSavedCents).toBe(1440 + 1280 + 1600 + 2400);
    expect(v.dollarsEarnedCents).toBe(2160 + 1920 + 2400 + 1600);
    expect(v.co2SavedKg).toBeGreaterThan(0);
    // Each includes POINTS.sharedNeed per seeded shared need: Olivia has 2 (top/onesie, outerwear), Caesar and Freja 1 each.
    expect(v.points.map((p) => [p.name, p.points])).toEqual([["Freja", 90], ["Olivia", 50], ["Caesar", 40]]);
    expect(v.me).toBeUndefined();
    expect(JSON.stringify(v)).not.toMatch(/phone|\+1555/);
  });

  it("after the romper trade: +1 hand-off, Caesar gets the seller and quick-pass points and tops the board", async () => {
    const before = await getImpact(db);
    await demoClock(db, { now: DEMO_DATES.nudge });
    const [nudge] = await db.AgentNudge.filter({ kind: "outgrow_check" });
    await resolveNudge(db, { parentKey: "mina", nudgeId: nudge.id, action: "sell" });
    const listing = await listItem(db, { parentKey: "mina", itemId: nudge.itemId, photo: "romper.jpg", condition: "gently_used",
      conditionNote: "", shared: true });
    await demoClock(db, { now: DEMO_DATES.meet });
    const [jo] = await db.Parent.filter({ key: "jo" });
    const [mina] = await db.Parent.filter({ key: "mina" });
    const p = await createProposal(db, { listingId: listing.id, buyerId: jo.id, reason: "", transcript: [], source: "local" });
    await decideProposal(db, { parentId: mina.id, proposalId: p.id, decision: "accepted" });
    await decideProposal(db, { parentId: jo.id, proposalId: p.id, decision: "accepted" });

    // Accepted but not paid: nothing changes yet.
    expect((await getImpact(db)).itemsRehomed).toBe(before.itemsRehomed);

    await payProposal(db, { parentId: jo.id, proposalId: p.id }, { delayMs: 0 });
    const v = await getImpact(db, { parentKey: "mina" });
    expect(v.itemsRehomed).toBe(before.itemsRehomed + 1);
    expect(v.tradesCompleted).toBe(1);
    expect(v.dollarsSavedCents - before.dollarsSavedCents).toBe(3000 - 1800);
    expect(v.dollarsEarnedCents - before.dollarsEarnedCents).toBe(1800);
    expect(v.co2SavedKg).toBeGreaterThan(before.co2SavedKg);
    expect(v.points[0]).toMatchObject({ name: "Caesar", points: 40 + POINTS.sold + POINTS.quickList });
    // Caesar's seeded 9-12M outerwear need earns Good Neighbor, so the next one is Final Home.
    expect(v.me).toMatchObject({ parentId: mina.id, badges: ["Good Neighbor", "Quick Pass", "First Pass", "New Home"], nextBadge: "Final Home" });
    expect(v.points.find((x) => x.name === "Olivia")!.points).toBe(50 + POINTS.bought);
  });
});
