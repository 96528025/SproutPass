// OWNER: B9 (impact + rewards). Pure TS (no npm:/base44: imports): the getImpact function, the frontend mock and
// the tests all run this on the same data.
//
// What it counts, all derived from rows that already exist (nothing is stored, so it can't drift):
//   - hand-offs: every move in an item's ownershipHistory (2nd and 3rd homes). Each one is a garment that went on
//     being worn instead of a new one being bought. Moves recorded before the app (the seed's "earlier families")
//     count too, the same way /log shows their owner chains.
//   - trades completed: proposals that were paid in the app.
//   - money: what each new owner paid against the original price (the relay's 60% / 40% rule when the price of an
//     older move wasn't recorded).
//   - CO2 / water / waste: conservative per-garment estimates (FACTORS, GARMENT_KG), listed in `assumptions`.
//   - Sprout points + badges: fixed rules over the same history (POINTS, BADGES). Same data in, same points out.
import type { Db } from "../db.ts";
import { RESALE_PCT } from "../pricing.ts";
import type {
  AgentNudge, Category, ClothingItem, ID, ISODate, ImpactView, Listing, MatchProposal, Need, Parent, ParentRef,
} from "../types.ts";

const MANY = 1000; // explicit page size: real Base44 pages list()/filter()
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------- environmental factors

/**
 * Typical weight of one baby / toddler garment, kg. Our own conservative estimates (a cotton onesie is about
 * 100 g), not measurements.
 */
export const GARMENT_KG: Record<Category, number> = {
  onesie: 0.1, top: 0.1, bottom: 0.15, dress: 0.15, set: 0.25, outerwear: 0.35, other: 0.06,
};

export const FACTORS = {
  /** kg CO2e per kg of new clothing not made. WRAP 2017: 23.2 over the whole life, most of it from making fibre
   *  and fabric (Table 3, Figure 2). We count only the making, rounded down. */
  co2KgPerKg: 15,
  /** litres per kg of new clothing not made. WRAP 2017: 7,060 m³ per tonne, nearly all from growing and making
   *  fibre (Table 3). Rounded down. */
  waterLPerKg: 7000,
  /** new garments one second-hand garment replaces. Farrant et al. 2010: 100 second-hand garments replace 60 to
   *  85 new ones. We use the low end. */
  displacement: 0.6,
  /** share of discarded textiles that go to landfill. US EPA, 2018: 11.3 of 17.0 million tons. */
  landfillShare: 0.66,
} as const;

/** Plain-language yardsticks for the equivalents on the impact screen. */
export const YARDSTICKS = {
  /** EPA: a typical passenger car emits about 400 g of CO2 per mile. */
  co2KgPerCarMile: 0.4,
  /** A common rule of thumb for drinking water: about 2 litres a day. */
  drinkingLPerDay: 2,
  /** One onesie, by weight (GARMENT_KG.onesie). */
  onesieKg: GARMENT_KG.onesie,
} as const;

export interface Source { name: string; url: string; usedFor: string }

export const SOURCES: Source[] = [
  { name: "WRAP, Valuing Our Clothes: the cost of UK fashion (2017)",
    url: "https://www.sustainabilityexchange.ac.uk/valuing_our_clothes_the_cost_of_uk_fashion",
    usedFor: "Carbon and water per kg of clothing" },
  { name: "Farrant, Olsen & Wangel, Environmental benefits from reusing clothes (Int J LCA, 2010)",
    url: "https://link.springer.com/article/10.1007/s11367-010-0197-y",
    usedFor: "How many new garments a second-hand one replaces" },
  { name: "US EPA, Textiles: material-specific data (2018 figures)",
    url: "https://www.epa.gov/facts-and-figures-about-materials-waste-and-recycling/textiles-material-specific-data",
    usedFor: "Share of textile waste that is landfilled" },
  { name: "US EPA, Greenhouse gas emissions from a typical passenger vehicle",
    url: "https://www.epa.gov/greenvehicles/greenhouse-gas-emissions-typical-passenger-vehicle",
    usedFor: "Car miles equivalent" },
  { name: "Ellen MacArthur Foundation, A New Textiles Economy (2017)",
    url: "https://www.ellenmacarthurfoundation.org/a-new-textiles-economy",
    usedFor: "Context only: textile production emits about 1.2 billion tonnes of greenhouse gases a year" },
];

export const ASSUMPTIONS: string[] = [
  `Each hand-off counts as ${FACTORS.displacement} of a new garment not bought (Farrant et al. 2010 found 100 second-hand garments replace 60 to 85 new ones; we use the low end).`,
  `Carbon: ${FACTORS.co2KgPerKg} kg CO2e per kg of clothing not made. WRAP (2017) puts UK clothing at 23.2 kg over its whole life, mostly from making fibre and fabric; we count only the making, rounded down.`,
  `Water: ${FACTORS.waterLPerKg.toLocaleString("en-US")} litres per kg of clothing not made (WRAP 2017: 7,060 m³ per tonne, nearly all from growing and making fibre).`,
  `Waste: the garment's weight times ${Math.round(FACTORS.landfillShare * 100)}%, the share of US textile waste that is landfilled (EPA, 2018: 11.3 of 17.0 million tons).`,
  "Garment weights are our own conservative estimates for baby and toddler sizes: onesie or top 100 g, pants or dress 150 g, set 250 g, jacket 350 g, hat, bib or socks 60 g.",
  "Money: what each new owner paid against the original price. Older hand-offs without a recorded price use the relay's rule (2nd owner pays 60%, 3rd pays 40%).",
  "Totals are rounded down, never up: carbon to 0.1 kg, water to the litre, waste to 0.01 kg.",
  "These are estimates to show the direction and rough size of the benefit, not a certified footprint.",
];

/** The footprint one re-homed garment of this category avoids (unrounded). */
export function perGarment(category: Category): { co2Kg: number; waterL: number; wasteKg: number } {
  const kg = GARMENT_KG[category] ?? GARMENT_KG.other;
  return {
    co2Kg: kg * FACTORS.co2KgPerKg * FACTORS.displacement,
    waterL: kg * FACTORS.waterLPerKg * FACTORS.displacement,
    wasteKg: kg * FACTORS.landfillShare,
  };
}

// ---------------------------------------------------------------- points + badges

export const POINTS = {
  /** Listed within QUICK_LIST_DAYS of the pet's "still fit?" nudge (once per item). */
  quickList: 25,
  /** Passed an item on (the seller of a hand-off). */
  sold: 50,
  /** Gave a hand-me-down a new home (the buyer of a hand-off). */
  bought: 30,
  /** Passed an item on to its 3rd and final home (on top of `sold`). */
  finalHome: 25,
  /** Each need shared with parents nearby (up to MAX_SHARED_NEEDS). */
  sharedNeed: 10,
} as const;
export const QUICK_LIST_DAYS = 3;
export const MAX_SHARED_NEEDS = 3;
export const REGULAR_HANDOFFS = 3;

export interface BadgeDef { name: string; how: string }

/** In the order a new parent usually earns them; `nextBadge` is the first one not earned yet. */
export const BADGES: BadgeDef[] = [
  { name: "Good Neighbor", how: "Share what your child needs next with parents nearby." },
  { name: "Quick Pass", how: `List an item within ${QUICK_LIST_DAYS} days of your pet's "still fit?" nudge.` },
  { name: "First Pass", how: "Pass on your first item to another family." },
  { name: "New Home", how: "Give a hand-me-down a new home in your closet." },
  { name: "Final Home", how: "Pass an item on to its 3rd and final home." },
  { name: "Relay Regular", how: `Take part in ${REGULAR_HANDOFFS} hand-offs, passing on or taking in.` },
];
const BADGE_ORDER = new Map(BADGES.map((b, i) => [b.name, i]));

export function badgeHow(name: string): string | undefined {
  return BADGES.find((b) => b.name === name)?.how;
}

// ---------------------------------------------------------------- hand-offs

export interface Handoff {
  itemId: ID; itemName: string; icon: string; category: Category;
  /** 2 = the item's 2nd home, 3 = its 3rd and final home. */
  home: 2 | 3;
  fromId: ID; toId: ID; at: ISODate;
  priceCents: number;
  originalPriceCents: number;
  /** false when the price came from the 60% / 40% rule (an older move without a recorded price). */
  priceRecorded: boolean;
}

/** Every move in every item's ownership history, oldest first. At most 2 per item (3 owners max). */
export function handoffsOf(items: ClothingItem[]): Handoff[] {
  const out: Handoff[] = [];
  for (const item of items) {
    const history = Array.isArray(item.ownershipHistory) ? item.ownershipHistory : [];
    for (let k = 1; k < history.length && k <= 2; k++) {
      const prev = history[k - 1], entry = history[k];
      if (!prev?.ownerId || !entry?.ownerId || prev.ownerId === entry.ownerId) continue;
      const original = Math.max(0, Number(item.originalPriceCents) || 0);
      const recorded = typeof entry.priceCents === "number" && Number.isFinite(entry.priceCents) && entry.priceCents >= 0;
      out.push({
        itemId: item.id, itemName: item.name, icon: item.icon, category: item.category,
        home: (k + 1) as 2 | 3,
        fromId: prev.ownerId, toId: entry.ownerId, at: entry.from,
        priceCents: recorded ? entry.priceCents! : Math.round(original * RESALE_PCT[k as 1 | 2]),
        originalPriceCents: original,
        priceRecorded: recorded,
      });
    }
  }
  return out.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? "") || a.itemId.localeCompare(b.itemId) || a.home - b.home);
}

// ---------------------------------------------------------------- the view

export interface ImpactMe {
  parentId: ID; points: number; badges: string[]; nextBadge?: string;
  /** Hand-offs this parent took part in (either side). */
  handoffs: number;
  /** As a buyer: original prices minus what they paid. */
  savedCents: number;
  /** As a seller: what they got back. */
  earnedCents: number;
}

export interface CategoryImpact { category: Category; handoffs: number; co2Kg: number; waterL: number; wasteKg: number }

/** ImpactView plus a few extras the impact screen uses (optional for any other reader). */
export interface ImpactDetail extends ImpactView {
  byCategory: CategoryImpact[];
  me?: ImpactMe;
}

export interface ImpactInput {
  parents: Pick<Parent, "id" | "key" | "name">[];
  items: ClothingItem[];
  proposals: Pick<MatchProposal, "id" | "status">[];
  listings: Pick<Listing, "id" | "itemId" | "sellerId" | "status" | "createdAt">[];
  nudges: Pick<AgentNudge, "id" | "itemId" | "parentId" | "kind" | "createdAt">[];
  needs: Pick<Need, "id" | "parentId" | "shared">[];
}

/** Rounds down (never up) to `places` decimals: the screen says "rounded down". The tiny epsilon keeps float noise
 *  (0.3 * 10 = 2.9999…) from dropping a whole step. */
export const floorTo = (n: number, places: number) => {
  const f = 10 ** places;
  return Math.floor(n * f + 1e-9) / f;
};
const time = (iso: string | undefined) => (iso ? new Date(iso).getTime() : NaN);

interface Tally { points: number; badges: Set<string>; handoffs: number; savedCents: number; earnedCents: number }

/** Pure: the whole impact view from rows. `meRef` picks the parent for `me` (by id or seed key); unknown → no `me`. */
export function computeImpact(input: ImpactInput, meRef: ParentRef = {}): ImpactDetail {
  const handoffs = handoffsOf(input.items ?? []);

  // Totals.
  let co2 = 0, water = 0, waste = 0, saved = 0, earned = 0;
  const cats = new Map<Category, CategoryImpact>();
  for (const h of handoffs) {
    const g = perGarment(h.category);
    co2 += g.co2Kg; water += g.waterL; waste += g.wasteKg;
    saved += Math.max(0, h.originalPriceCents - h.priceCents);
    earned += h.priceCents;
    const c = cats.get(h.category) ?? { category: h.category, handoffs: 0, co2Kg: 0, waterL: 0, wasteKg: 0 };
    c.handoffs++; c.co2Kg += g.co2Kg; c.waterL += g.waterL; c.wasteKg += g.wasteKg;
    cats.set(h.category, c);
  }
  const tradesCompleted = new Set((input.proposals ?? []).filter((p) => p.status === "paid").map((p) => p.id)).size;

  // Points + badges, only for parents in the app (earlier families are not on the board).
  const tally = new Map<ID, Tally>();
  for (const p of input.parents ?? []) tally.set(p.id, { points: 0, badges: new Set(), handoffs: 0, savedCents: 0, earnedCents: 0 });
  const award = (id: ID, points: number, badge?: string) => {
    const t = tally.get(id);
    if (!t) return;
    t.points += points;
    if (badge) t.badges.add(badge);
  };

  for (const h of handoffs) {
    const seller = tally.get(h.fromId), buyer = tally.get(h.toId);
    if (seller) { seller.handoffs++; seller.earnedCents += h.priceCents; }
    if (buyer) { buyer.handoffs++; buyer.savedCents += Math.max(0, h.originalPriceCents - h.priceCents); }
    award(h.fromId, POINTS.sold, "First Pass");
    award(h.toId, POINTS.bought, "New Home");
    if (h.home === 3) award(h.fromId, POINTS.finalHome, "Final Home");
  }

  // Quick pass: a listing (not withdrawn) made within QUICK_LIST_DAYS of the pet's outgrow nudge, on the demo clock.
  const outgrow = (input.nudges ?? []).filter((n) => n.kind === "outgrow_check");
  const quick = new Set<string>();
  for (const l of input.listings ?? []) {
    if (l.status === "withdrawn") continue;
    const key = `${l.sellerId}|${l.itemId}`;
    if (quick.has(key)) continue;
    const lt = time(l.createdAt);
    const hit = outgrow.some((n) => {
      if (n.itemId !== l.itemId || n.parentId !== l.sellerId) return false;
      const d = lt - time(n.createdAt);
      return Number.isFinite(d) && d >= 0 && d <= QUICK_LIST_DAYS * DAY_MS;
    });
    if (hit) { quick.add(key); award(l.sellerId, POINTS.quickList, "Quick Pass"); }
  }

  // Shared needs (private needs never count: they'd show up on the board).
  const sharedByParent = new Map<ID, number>();
  for (const n of input.needs ?? []) if (n.shared) sharedByParent.set(n.parentId, (sharedByParent.get(n.parentId) ?? 0) + 1);
  for (const [id, count] of sharedByParent) award(id, POINTS.sharedNeed * Math.min(count, MAX_SHARED_NEEDS), "Good Neighbor");

  for (const t of tally.values()) if (t.handoffs >= REGULAR_HANDOFFS) t.badges.add("Relay Regular");

  const sortedBadges = (s: Set<string>) => [...s].sort((a, b) => (BADGE_ORDER.get(a) ?? 99) - (BADGE_ORDER.get(b) ?? 99));
  const names = new Map((input.parents ?? []).map((p) => [p.id, p.name]));
  const points = [...tally.entries()]
    .map(([parentId, t]) => ({ parentId, name: names.get(parentId) ?? "Parent", points: t.points, badges: sortedBadges(t.badges) }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name) || a.parentId.localeCompare(b.parentId));

  const view: ImpactDetail = {
    itemsRehomed: handoffs.length,
    tradesCompleted,
    dollarsSavedCents: saved,
    dollarsEarnedCents: earned,
    co2SavedKg: floorTo(co2, 1),
    waterSavedL: floorTo(water, 0),
    wasteDivertedKg: floorTo(waste, 2),
    points,
    assumptions: ASSUMPTIONS,
    byCategory: [...cats.values()]
      .map((c) => ({ ...c, co2Kg: floorTo(c.co2Kg, 1), waterL: floorTo(c.waterL, 0), wasteKg: floorTo(c.wasteKg, 2) }))
      .sort((a, b) => b.handoffs - a.handoffs || a.category.localeCompare(b.category)),
  };

  const meParent = meRef.parentId
    ? (input.parents ?? []).find((p) => p.id === meRef.parentId)
    : meRef.parentKey ? (input.parents ?? []).find((p) => p.key === meRef.parentKey) : undefined;
  if (meParent) {
    const t = tally.get(meParent.id)!;
    const badges = sortedBadges(t.badges);
    const next = BADGES.find((b) => !t.badges.has(b.name))?.name;
    view.me = {
      parentId: meParent.id, points: t.points, badges,
      ...(next ? { nextBadge: next } : {}),
      handoffs: t.handoffs, savedCents: t.savedCents, earnedCents: t.earnedCents,
    };
  }
  return view;
}

/** Handler for the getImpact function (and the mock): everyone's impact, plus `me` when a parent is given. */
export async function getImpact(db: Db, ref: ParentRef = {}): Promise<ImpactDetail> {
  const [parents, items, proposals, listings, nudges, needs] = await Promise.all([
    db.Parent.list(undefined, MANY),
    db.ClothingItem.list(undefined, MANY),
    db.MatchProposal.filter({ status: "paid" }, undefined, MANY),
    db.Listing.list(undefined, MANY),
    db.AgentNudge.filter({ kind: "outgrow_check" }, undefined, MANY),
    db.Need.list(undefined, MANY),
  ]);
  // Only what the rules need: phones and other private Parent fields never enter the computation.
  return computeImpact({
    parents: parents.map((p) => ({ id: p.id, key: p.key, name: p.name })),
    items, proposals, listings, nudges, needs,
  }, { parentId: ref?.parentId, parentKey: ref?.parentKey });
}

// ---------------------------------------------------------------- plain-language equivalents

export interface Equivalents {
  /** "2 miles not driven" */
  carMiles: number;
  /** days of one person's drinking water */
  drinkingDays: number;
  /** onesies, by weight */
  onesies: number;
}

export function equivalents(v: Pick<ImpactView, "co2SavedKg" | "waterSavedL" | "wasteDivertedKg">): Equivalents {
  return {
    carMiles: Math.floor((v.co2SavedKg || 0) / YARDSTICKS.co2KgPerCarMile),
    drinkingDays: Math.floor((v.waterSavedL || 0) / YARDSTICKS.drinkingLPerDay),
    onesies: Math.floor((v.wasteDivertedKg || 0) / YARDSTICKS.onesieKg),
  };
}

/** "210 days" · "1 year and 2 months" style wording for drinking-water days. */
export function daysText(days: number): string {
  const d = Math.max(0, Math.floor(days));
  if (d < 60) return `${d} day${d === 1 ? "" : "s"}`;
  if (d < 730) { const m = Math.floor(d / 30.4); return `${m} months`; }
  const y = Math.floor(d / 365);
  return `${y} years`;
}
