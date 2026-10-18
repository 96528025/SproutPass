// scanForNudges rules + nudgeMessage wording (pure; no db).
import { describe, expect, it } from "vitest";
import { nudgeMessage, scanForNudges, shortDate, type ScanInput } from "./nudges.ts";
import { DEMO_DATES } from "./seed.ts";
import type { AgentNudge, ClothingItem, Listing } from "./types.ts";

const MINA = "p_mina", JO = "p_jo";
const romper = (over: Partial<ClothingItem> = {}): ClothingItem => ({
  id: "i_romper", name: "Yellow duck romper", category: "onesie", icon: "item_romper", size: "6-9M",
  originalPriceCents: 3000, originalPurchaseDate: DEMO_DATES.start, ownerCount: 1, currentOwnerId: MINA, childId: "c_bean",
  photos: [], ownershipHistory: [{ ownerId: MINA, from: DEMO_DATES.start }],
  predictedOutgrowDate: "2026-08-27T00:00:00.000Z", status: "in_closet", ...over,
});
const listing = (over: Partial<Listing> = {}): Listing => ({
  id: "l_1", itemId: "i_romper", sellerId: MINA, condition: "gently_used", conditionNote: "", priceCents: 1800,
  shared: true, status: "active", createdAt: DEMO_DATES.nudge, ...over,
});
const nudge = (over: Partial<AgentNudge>): AgentNudge => ({
  id: "n_1", parentId: MINA, itemId: "i_romper", kind: "outgrow_check", message: "", createdAt: DEMO_DATES.nudge, resolved: false, ...over,
});
const scan = (over: Partial<ScanInput>) => scanForNudges({
  items: [romper()], listings: [], existing: [], now: DEMO_DATES.nudge,
  children: [{ id: "c_bean", parentId: MINA, nickname: "Bean", birthDate: "2025-12-10T00:00:00.000Z" }],
  parentsById: { [MINA]: { name: "Mina", petName: "Button" }, [JO]: { name: "Jo", petName: "Pip" } },
  ...over,
});

describe("scanForNudges: outgrow_check", () => {
  it("nudges an in-closet item once now ≥ outgrow − 14 days", () => {
    const [d, ...rest] = scan({});
    expect(rest).toEqual([]);
    expect(d).toEqual({ parentId: MINA, itemId: "i_romper", kind: "outgrow_check", createdAt: DEMO_DATES.nudge, resolved: false,
      message: "Button here! The yellow duck romper (6-9M) is probably getting snug — still fit, or want to pass it on?" });
  });

  it("boundary: exactly 14 days before is in, one ms earlier is out", () => {
    expect(scan({ now: "2026-08-13T00:00:00.000Z" })).toHaveLength(1);
    expect(scan({ now: "2026-08-12T23:59:59.999Z" })).toHaveLength(0);
    expect(scan({ now: DEMO_DATES.start })).toHaveLength(0);
  });

  it("only in_closet items (not listed / pending_trade / transferred_out)", () => {
    for (const status of ["listed", "pending_trade", "transferred_out"] as const) {
      expect(scan({ items: [romper({ status })] }), status).toEqual([]);
    }
  });

  it("never for a third-owner item", () => {
    expect(scan({ items: [romper({ ownerCount: 3 })] })).toEqual([]);
  });

  it("never twice for the same owner, even after it was resolved (keep / later)", () => {
    expect(scan({ existing: [nudge({ resolved: true })] })).toEqual([]);
    expect(scan({ existing: [nudge({ resolved: false })] })).toEqual([]);
  });

  it("a new owner gets their own outgrow nudge for the same item", () => {
    const moved = romper({ currentOwnerId: JO, ownerCount: 2, childId: "c_pea", predictedOutgrowDate: "2026-11-17T00:00:00.000Z" });
    const [d] = scan({ items: [moved], existing: [nudge({ resolved: true })], now: "2026-11-05T00:00:00.000Z" });
    expect(d).toMatchObject({ parentId: JO, kind: "outgrow_check" });
    expect(d.message).toMatch(/^Pip here!/);
  });

  it("falls back to the owner's child when predictedOutgrowDate is missing", () => {
    expect(scan({ items: [romper({ predictedOutgrowDate: undefined })] })).toHaveLength(1);
    expect(scan({ items: [romper({ predictedOutgrowDate: null as never })], now: DEMO_DATES.start })).toHaveLength(0);
    expect(scan({ items: [romper({ predictedOutgrowDate: undefined, childId: "unknown" })] })).toEqual([]);
  });

  it("is deterministic", () => {
    const input = { items: [romper(), romper({ id: "i_2", name: "Mint onesie" })] };
    expect(scan(input)).toEqual(scan(input));
    expect(scan(input).map((d) => d.itemId)).toEqual(["i_romper", "i_2"]);
  });
});

describe("scanForNudges: listing_reminder", () => {
  const listed = romper({ status: "listed" });
  const day = (n: number) => new Date(Date.parse(DEMO_DATES.nudge) + n * 86_400_000).toISOString();

  it("after 30 days active, with the price", () => {
    expect(scan({ items: [listed], listings: [listing()], now: day(29) })).toEqual([]);
    const [d] = scan({ items: [listed], listings: [listing()], now: day(30) });
    expect(d).toMatchObject({ kind: "listing_reminder", parentId: MINA, itemId: "i_romper", createdAt: day(30) });
    expect(d.message).toBe("Button here! Your yellow duck romper is still waiting for its next home at $18.00 — keep it listed, or bring it back to the closet?");
  });

  it("not while one is unresolved, and at most one per 30 days", () => {
    const open = nudge({ kind: "listing_reminder", createdAt: day(30) });
    expect(scan({ items: [listed], listings: [listing()], existing: [open], now: day(40) })).toEqual([]);
    const resolved = { ...open, resolved: true };
    expect(scan({ items: [listed], listings: [listing()], existing: [resolved], now: day(40) })).toEqual([]);
    expect(scan({ items: [listed], listings: [listing()], existing: [resolved], now: day(60) })).toHaveLength(1);
  });

  it("not for withdrawn or sold listings, or an item already in a trade", () => {
    expect(scan({ items: [listed], listings: [listing({ status: "withdrawn" })], now: day(31) })).toEqual([]);
    expect(scan({ items: [listed], listings: [listing({ status: "sold" })], now: day(31) })).toEqual([]);
    expect(scan({ items: [romper({ status: "pending_trade" })], listings: [listing()], now: day(31) })).toEqual([]);
  });
});

describe("nudgeMessage", () => {
  const ctx = { itemName: "Yellow duck romper", size: "6-9M", petName: "Pip" };
  const sentences = (s: string) => s.split(/(?<=[.!?])\s+/).filter(Boolean).length;

  it("every kind: ≤ 2 sentences, plain text, names the pet, deterministic", () => {
    for (const kind of ["outgrow_check", "listing_reminder", "new_owner_welcome"] as const) {
      for (const extra of [{}, { outgrowDate: "2026-11-17T00:00:00.000Z", priceText: "$18.00" }]) {
        const m = nudgeMessage(kind, { ...ctx, ...extra });
        expect(sentences(m), m).toBeLessThanOrEqual(2);
        expect(m).toContain("Pip");
        expect(m).not.toMatch(/[<>*_#`]/);
        expect(nudgeMessage(kind, { ...ctx, ...extra })).toBe(m);
      }
    }
  });

  it("welcome tells the new owner when it should fit until", () => {
    expect(nudgeMessage("new_owner_welcome", { ...ctx, outgrowDate: "2026-11-17T00:00:00.000Z" }))
      .toBe("Pip here — say hi to the yellow duck romper! It should fit until ~Nov 17, and I'll check in before then.");
    expect(nudgeMessage("new_owner_welcome", ctx)).toBe("Pip here — say hi to the yellow duck romper! I'll check in when it starts getting snug.");
  });

  it("copes with a missing pet name", () => {
    expect(nudgeMessage("outgrow_check", { ...ctx, petName: "" })).toMatch(/^Your pet here!/);
    expect(nudgeMessage("outgrow_check", { ...ctx, petName: "your pet" })).toMatch(/^Your pet here!/);
  });

  it("shortDate is UTC", () => {
    expect(shortDate("2026-11-17T00:00:00.000Z")).toBe("Nov 17");
    expect(shortDate("2026-08-27T23:30:00.000Z")).toBe("Aug 27");
  });
});
