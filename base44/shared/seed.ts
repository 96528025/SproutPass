// Demo seed. OWNER: B1 (add 10–15 more items with icons; keep the romper, Jo's need and Sam's 3rd-owner item).
// applySeed works against real Base44 entities (demoReset) and the in-memory fakeDb (frontend mock, tests).
// Pure TS: no npm:/base44: imports.
import type { Db } from "./db.ts";
import type { Category, Child, ClothingItem, EntityName, ISODate, Listing, Need, Parent, Setting, SizeLabel } from "./types.ts";
import { predictOutgrow } from "./sizes.ts";

export interface SeedEnv {
  MINA_PHONE?: string; JO_PHONE?: string; SAM_PHONE?: string;
  MINA_AGENT?: string; JO_AGENT?: string; SAM_AGENT?: string;
}

export interface SeedItem {
  ownerKey: string; name: string; category: Category; icon: string; size: SizeLabel;
  originalPriceCents: number; originalPurchaseDate: ISODate; ownerCount: 1 | 2 | 3;
  photos?: string[];
  formerOwners?: { ownerId: string; from: ISODate; to: ISODate; priceCents?: number }[];  // for ownerCount > 1
  ownedSince?: ISODate;  // when the current owner got it (defaults to originalPurchaseDate)
}

export interface SeedPlan {
  parents: Omit<Parent, "id">[];
  children: (Omit<Child, "id" | "parentId"> & { parentKey: string })[];
  items: SeedItem[];
  listings: (Omit<Listing, "id" | "itemId" | "sellerId"> & { itemName: string })[];
  needs: (Omit<Need, "id" | "parentId" | "childId"> & { parentKey: string })[];
  setting: Omit<Setting, "id">;
}

export const DEMO_DATES = {
  start: "2026-05-15T17:00:00.000Z",
  nudge: "2026-09-20T17:00:00.000Z",
  meet: "2026-10-18T17:00:00.000Z",
} as const;

export function seedPlan(env: SeedEnv = {}): SeedPlan {
  return {
    parents: [
      { key: "mina", name: "Mina", avatar: { sprite: "parent_a", palette: "peach" }, pet: { sprite: "pet_a", name: "Button" },
        phone: env.MINA_PHONE, agentAddress: env.MINA_AGENT, discoverable: true },
      { key: "jo", name: "Jo", avatar: { sprite: "parent_b", palette: "mint" }, pet: { sprite: "pet_b", name: "Pip" },
        phone: env.JO_PHONE, agentAddress: env.JO_AGENT, discoverable: true },
      { key: "sam", name: "Sam", avatar: { sprite: "parent_c", palette: "lav" }, pet: { sprite: "pet_c", name: "Moss" },
        phone: env.SAM_PHONE, agentAddress: env.SAM_AGENT, discoverable: true },
    ],
    children: [
      { parentKey: "mina", nickname: "Bean", birthDate: "2025-12-10T00:00:00.000Z" },
      { parentKey: "jo", nickname: "Pea", birthDate: "2026-03-01T00:00:00.000Z" },
      { parentKey: "sam", nickname: "Sprout", birthDate: "2025-06-01T00:00:00.000Z" },
    ],
    items: [
      { ownerKey: "mina", name: "Yellow duck romper", category: "onesie", icon: "item_romper", size: "6-9M",
        originalPriceCents: 3000, originalPurchaseDate: "2026-05-15T17:00:00.000Z", ownerCount: 1 },
      { ownerKey: "mina", name: "Striped long-sleeve tee", category: "top", icon: "item_tee", size: "3-6M",
        originalPriceCents: 1400, originalPurchaseDate: "2026-02-01T17:00:00.000Z", ownerCount: 1 },
      { ownerKey: "jo", name: "Mint onesie three-pack", category: "onesie", icon: "item_onesie", size: "3-6M",
        originalPriceCents: 2400, originalPurchaseDate: "2026-04-10T17:00:00.000Z", ownerCount: 1 },
      { ownerKey: "sam", name: "Oatmeal knit cardigan", category: "outerwear", icon: "item_sweater", size: "12-18M",
        originalPriceCents: 4000, originalPurchaseDate: "2025-09-01T17:00:00.000Z", ownerCount: 3,
        formerOwners: [
          { ownerId: "former_ana", from: "2025-09-01T17:00:00.000Z", to: "2026-01-20T17:00:00.000Z" },
          { ownerId: "former_lee", from: "2026-01-20T17:00:00.000Z", to: "2026-04-02T17:00:00.000Z", priceCents: 2400 },
        ],
        ownedSince: "2026-04-02T17:00:00.000Z" },
      // TODO(B1): 10–15 more believable items across sizes (icons from Part D list), spread over mina/jo/sam.
    ],
    listings: [],
    needs: [
      { parentKey: "jo", sizes: ["6-9M"], categories: ["top", "onesie"], shared: true, createdAt: "2026-10-01T17:00:00.000Z" },
    ],
    setting: { key: "demo", now: DEMO_DATES.start, matchVia: "fetch", imessage: true },
  };
}

const ALL: EntityName[] = [
  "AgentInbox", "AgentNudge", "MatchProposal", "Encounter", "Presence", "Listing", "Need",
  "ClothingItem", "Child", "Parent", "Setting",
];

/** Wipe every entity, then create the plan. Returns key → id maps. */
export async function applySeed(db: Db, plan: SeedPlan) {
  for (const e of ALL) {
    const rows = await db[e].list();
    for (const r of rows) await db[e].delete(r.id);
  }
  const parentIds: Record<string, string> = {};
  for (const p of plan.parents) parentIds[p.key] = (await db.Parent.create(p)).id;

  const childByParent: Record<string, Child> = {};
  for (const c of plan.children) {
    const { parentKey, ...rest } = c;
    childByParent[parentKey] = await db.Child.create({ ...rest, parentId: parentIds[parentKey] });
  }

  const itemIds: Record<string, string> = {};
  for (const it of plan.items) {
    const ownerId = parentIds[it.ownerKey];
    const child = childByParent[it.ownerKey];
    const since = it.ownedSince ?? it.originalPurchaseDate;
    const history = [...(it.formerOwners ?? []), { ownerId, from: since }];
    const row: Omit<ClothingItem, "id"> = {
      name: it.name, category: it.category, icon: it.icon, size: it.size,
      originalPriceCents: it.originalPriceCents, originalPurchaseDate: it.originalPurchaseDate,
      ownerCount: it.ownerCount, currentOwnerId: ownerId, childId: child.id,
      photos: it.photos ?? [], ownershipHistory: history,
      predictedOutgrowDate: predictOutgrow(it.size, child.birthDate, since),
      status: "in_closet",
    };
    itemIds[it.name] = (await db.ClothingItem.create(row)).id;
  }

  for (const l of plan.listings) {
    const { itemName, ...rest } = l;
    const item = await db.ClothingItem.get(itemIds[itemName]);
    await db.Listing.create({ ...rest, itemId: item.id, sellerId: item.currentOwnerId });
    await db.ClothingItem.update(item.id, { status: "listed" });
  }

  for (const n of plan.needs) {
    const { parentKey, ...rest } = n;
    await db.Need.create({ ...rest, parentId: parentIds[parentKey], childId: childByParent[parentKey].id });
  }

  await db.Setting.create(plan.setting);
  return { parentIds, itemIds };
}
