// Contract pack smoke tests (vitest). B1 adds the full eval table in match.test.ts / nudges.test.ts.
import { describe, expect, it } from "vitest";
import { priceFor, priceRuleText } from "./pricing.ts";
import { predictOutgrow, wearWeeksLeft, ageInMonths } from "./sizes.ts";
import { checkEligibility } from "./match.ts";
import { createFakeDb } from "./testing/fakeDb.ts";
import { applySeed, seedPlan, DEMO_DATES } from "./seed.ts";

describe("pricing", () => {
  it("60% / 40% / none", () => {
    expect(priceFor({ ownerCount: 1, originalPriceCents: 3000 })).toBe(1800);
    expect(priceFor({ ownerCount: 2, originalPriceCents: 3000 })).toBe(1200);
    expect(priceFor({ ownerCount: 3, originalPriceCents: 3000 })).toBeNull();
    expect(priceRuleText({ ownerCount: 1, originalPriceCents: 3000 })).toBe("2nd owner pays 60% of $30.00 = $18.00");
  });
});

describe("outgrow (seed checks)", () => {
  it("Caesar's romper ≈ Aug 27, Olivia's ≈ Nov 17, ~4 weeks left on Oct 18", () => {
    expect(predictOutgrow("6-9M", "2025-12-10T00:00:00.000Z", "2026-05-15T17:00:00.000Z").slice(0, 10)).toBe("2026-08-27");
    expect(predictOutgrow("6-9M", "2026-03-01T00:00:00.000Z", DEMO_DATES.meet).slice(0, 10)).toBe("2026-11-17");
    expect(wearWeeksLeft("6-9M", "2026-03-01T00:00:00.000Z", DEMO_DATES.meet)).toBe(4);
    expect(ageInMonths("2026-03-01T00:00:00.000Z", DEMO_DATES.meet)).toBe(7);
  });
});

describe("seed + eligibility on fakeDb", () => {
  it("romper listed by Caesar is eligible for Olivia's need on Oct 18", async () => {
    const db = createFakeDb();
    const { parentIds } = await applySeed(db, seedPlan());
    const [romper] = await db.ClothingItem.filter({ name: "Yellow duck romper" });
    await db.ClothingItem.update(romper.id, { status: "listed" });
    const listing = await db.Listing.create({ itemId: romper.id, sellerId: parentIds.mina, condition: "gently_used",
      conditionNote: "", priceCents: 1800, shared: true, status: "active", createdAt: DEMO_DATES.nudge });
    const [need] = await db.Need.filter({ parentId: parentIds.jo });
    const [joChild] = await db.Child.filter({ parentId: parentIds.jo });
    const e = checkEligibility({ listing, item: { ...romper, status: "listed" }, need, buyerChild: joChild, buyerId: parentIds.jo, now: DEMO_DATES.meet });
    expect(e).toEqual({ ok: true, wearWeeksLeft: 4 });
    const [cardigan] = await db.ClothingItem.filter({ name: "Oatmeal knit cardigan" });
    expect(priceFor(cardigan)).toBeNull();
  });
});
