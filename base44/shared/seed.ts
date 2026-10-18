// Demo seed. OWNER: B1 (add 10–15 more items with icons; keep the romper, Jo's need and Sam's 3rd-owner item).
// applySeed works against real Base44 entities (demoReset) and the in-memory fakeDb (frontend mock, tests).
// Pure TS: no npm:/base44: imports.
import type { Db, EntityApi } from "./db.ts";
import type { Category, Child, ClothingItem, EntityName, ISODate, Listing, Need, Parent, Setting, SizeLabel } from "./types.ts";
import { predictOutgrow } from "./sizes.ts";
import { trustReset } from "./logic/trust.ts";

export interface SeedEnv {
  MINA_PHONE?: string; JO_PHONE?: string; SAM_PHONE?: string;
  MINA_AGENT?: string; JO_AGENT?: string; SAM_AGENT?: string;
}

export interface SeedItem {
  ownerKey: string; name: string; category: Category; icon: string; size: SizeLabel;
  originalPriceCents: number; originalPurchaseDate: ISODate; ownerCount: 1 | 2 | 3;
  photos?: string[];
  formerOwners?: { ownerId: string; from: ISODate; to: ISODate; priceCents?: number }[];  // for ownerCount > 1; a parent key ("sam") maps to that parent's id
  ownedSince?: ISODate;  // when the current owner got it (defaults to originalPurchaseDate)
  paidCents?: number;    // what the current owner paid (second-hand items)
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
    // Only the romper may enter its outgrow window (outgrow − 14 days) by Sep 20 or Oct 18, so the demo
    // clock creates exactly one nudge. Everything else is a current-or-next size for its child.
    items: [
      // Mina · Bean (born 2025-12-10)
      { ownerKey: "mina", name: "Yellow duck romper", category: "onesie", icon: "item_romper", size: "6-9M",
        originalPriceCents: 3000, originalPurchaseDate: "2026-05-15T17:00:00.000Z", ownerCount: 1 },
      { ownerKey: "mina", name: "Striped long-sleeve tee", category: "top", icon: "item_tee", size: "9-12M",
        originalPriceCents: 1400, originalPurchaseDate: "2026-04-20T17:00:00.000Z", ownerCount: 1 },
      { ownerKey: "mina", name: "Navy corduroy pants", category: "bottom", icon: "item_pants", size: "9-12M",
        originalPriceCents: 2200, originalPurchaseDate: "2026-03-14T17:00:00.000Z", ownerCount: 1 },
      { ownerKey: "mina", name: "Fox-ear knit hat", category: "other", icon: "item_hat", size: "9-12M",
        originalPriceCents: 1200, originalPurchaseDate: "2026-01-05T17:00:00.000Z", ownerCount: 1 },
      { ownerKey: "mina", name: "Gingham bib trio", category: "other", icon: "item_bib", size: "9-12M",
        originalPriceCents: 900, originalPurchaseDate: "2026-02-22T17:00:00.000Z", ownerCount: 1 },
      { ownerKey: "mina", name: "Cloud sleep sack", category: "other", icon: "item_sleepsack", size: "12-18M",
        originalPriceCents: 3800, originalPurchaseDate: "2026-05-02T17:00:00.000Z", ownerCount: 1 },
      { ownerKey: "mina", name: "Knit bear sweater", category: "top", icon: "item_sweater", size: "9-12M",
        originalPriceCents: 3600, originalPurchaseDate: "2025-08-15T17:00:00.000Z", ownerCount: 2,
        formerOwners: [{ ownerId: "sam", from: "2025-08-15T17:00:00.000Z", to: "2026-04-28T17:00:00.000Z" }],
        ownedSince: "2026-04-28T17:00:00.000Z", paidCents: 2160 },

      // Jo · Pea (born 2026-03-01)
      { ownerKey: "jo", name: "Mint onesie three-pack", category: "onesie", icon: "item_onesie", size: "6-9M",
        originalPriceCents: 2400, originalPurchaseDate: "2026-04-10T17:00:00.000Z", ownerCount: 1 },
      { ownerKey: "jo", name: "Sage cotton joggers", category: "bottom", icon: "item_pants", size: "6-9M",
        originalPriceCents: 1600, originalPurchaseDate: "2026-04-10T17:00:00.000Z", ownerCount: 1 },
      { ownerKey: "jo", name: "Dino sock four-pack", category: "other", icon: "item_socks", size: "6-9M",
        originalPriceCents: 1000, originalPurchaseDate: "2026-03-28T17:00:00.000Z", ownerCount: 1 },
      { ownerKey: "jo", name: "Yellow rain jacket", category: "outerwear", icon: "item_jacket", size: "9-12M",
        originalPriceCents: 4500, originalPurchaseDate: "2026-05-01T17:00:00.000Z", ownerCount: 1 },
      { ownerKey: "jo", name: "Little sailor set", category: "set", icon: "item_set", size: "9-12M",
        originalPriceCents: 3200, originalPurchaseDate: "2025-11-12T17:00:00.000Z", ownerCount: 2,
        formerOwners: [{ ownerId: "former_kai", from: "2025-11-12T17:00:00.000Z", to: "2026-04-18T17:00:00.000Z" }],
        ownedSince: "2026-04-18T17:00:00.000Z", paidCents: 1920 },

      // Sam · Sprout (born 2025-06-01)
      { ownerKey: "sam", name: "Oatmeal knit cardigan", category: "outerwear", icon: "item_sweater", size: "12-18M",
        originalPriceCents: 4000, originalPurchaseDate: "2025-09-01T17:00:00.000Z", ownerCount: 3,
        formerOwners: [
          { ownerId: "former_ana", from: "2025-09-01T17:00:00.000Z", to: "2026-01-20T17:00:00.000Z" },
          { ownerId: "former_lee", from: "2026-01-20T17:00:00.000Z", to: "2026-04-02T17:00:00.000Z", priceCents: 2400 },
        ],
        ownedSince: "2026-04-02T17:00:00.000Z" },
      { ownerKey: "sam", name: "Denim overall dress", category: "dress", icon: "item_dress", size: "12-18M",
        originalPriceCents: 2800, originalPurchaseDate: "2026-03-08T17:00:00.000Z", ownerCount: 1 },
      { ownerKey: "sam", name: "Rainbow tee two-pack", category: "top", icon: "item_tee", size: "12-18M",
        originalPriceCents: 1800, originalPurchaseDate: "2026-02-15T17:00:00.000Z", ownerCount: 1 },
      { ownerKey: "sam", name: "Berry puffer jacket", category: "outerwear", icon: "item_jacket", size: "18-24M",
        originalPriceCents: 5200, originalPurchaseDate: "2026-04-25T17:00:00.000Z", ownerCount: 1 },
      { ownerKey: "sam", name: "Sunflower sun hat", category: "other", icon: "item_hat", size: "18-24M",
        originalPriceCents: 1400, originalPurchaseDate: "2026-05-09T17:00:00.000Z", ownerCount: 1 },
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

// Real Base44 entity handlers also have deleteMany / bulkCreate (one request instead of one per row, which
// matters under the per-app rate limit). fakeDb doesn't, so both helpers fall back to per-row calls.
type Bulky = {
  deleteMany?: (query: Record<string, unknown>) => Promise<unknown>;
  bulkCreate?: (rows: unknown[]) => Promise<unknown>;
};

// Person C's tables (not in EntityName / fakeDb): wiped when the db has them, skipped otherwise.
const EXTRA = ["PairState", "PetLine"] as const;

/** Delete every row of every entity (except `keep`). Loops because real Base44 pages list() results. */
async function wipe(db: Db, keep: readonly string[] = []) {
  const report: string[] = [];
  const tables = db as unknown as Record<string, EntityApi<{ id: string }> | undefined>;
  for (const e of [...EXTRA, ...ALL] as string[]) {
    if (keep.includes(e)) continue;
    const table = tables[e];
    if (!table || typeof table.list !== "function") continue;                // e.g. fakeDb has no PairState
    const optional = (EXTRA as readonly string[]).includes(e);
    const api = table as unknown as Bulky;
    let bulk = typeof api.deleteMany === "function";
    let tried: Set<string> | null = null;
    for (let pass = 0; pass < 50; pass++) {
      let rows: { id: string }[];
      try { rows = await table.list(undefined, 500); }
      catch (err) { if (optional) break; throw err; }                        // C's entity not pushed yet: skip it
      if (!rows.length) break;
      if (tried && rows.some((r) => tried!.has(r.id))) bulk = false;          // deleteMany didn't take: go per row
      if (bulk) {
        tried = new Set(rows.map((r) => r.id));
        try { await api.deleteMany!({ id: { $in: [...tried] } }); continue; } catch { bulk = false; }
      }
      for (let i = 0; i < rows.length; i += 10) {
        await Promise.all(rows.slice(i, i + 10).map((r) => table.delete(r.id).catch(() => undefined)));
      }
    }
    if (tried) report.push(`${e}:${bulk ? "bulk" : "rows"}`);
  }
  if (report.length && typeof console !== "undefined") console.log(`[seed] wipe ${report.join(" ")}`);
}

/** Create rows (bulk when the backend supports it) and index the results by `key`. */
async function createAll<T extends { id: string }>(api: EntityApi<T>, rows: Omit<T, "id">[], key: (r: T | Omit<T, "id">) => string) {
  const bulk = (api as unknown as Bulky).bulkCreate;
  let out: T[] = [];
  if (typeof bulk === "function" && rows.length > 1) {
    const res = await bulk.call(api, rows);
    if (Array.isArray(res)) out = res as T[];
  }
  if (out.length !== rows.length || rows.some((r) => !out.some((o) => key(o) === key(r)))) {
    out = [];
    for (const r of rows) out.push(await api.create(r));
  }
  return Object.fromEntries(out.map((o) => [key(o), o])) as Record<string, T>;
}

/** Oldest first: Base44 created_date, then list position (fakeDb keeps insertion order). */
function oldestFirst<T extends { id: string }>(rows: T[]): T[] {
  const at = (r: T) => (r as T & { created_date?: string }).created_date ?? "";
  return rows.map((r, i) => ({ r, i })).sort((a, b) => at(a.r).localeCompare(at(b.r)) || a.i - b.i).map((x) => x.r);
}

/**
 * RESET keeps each seeded parent's row (and id) and rewrites it to the seed values, so ids cached by C's agents,
 * PairState keys and open tabs stay valid. Identity bindings survive: an agentAddress registered by an agent
 * (unless a *_AGENT secret overrides it), a phone when no *_PHONE secret is set, Photon ids and the ASI:One claim.
 * Demo state goes: the iMessage conversation (`convo`) restarts, and the pet's rules, saved passkeys and passkey
 * challenge go back to the defaults. Duplicates and unknown parents are removed.
 */
async function upsertParents(db: Db, seed: SeedPlan["parents"]): Promise<Record<string, string>> {
  const existing = oldestFirst(await db.Parent.list(undefined, 500));
  const ids: Record<string, string> = {};
  const create: SeedPlan["parents"] = [];
  const kept = new Set<string>();
  for (const p of seed) {
    const row = existing.find((r) => r.key === p.key);
    if (!row) { create.push(p); continue; }
    kept.add(row.id);
    const defined = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as Partial<Parent>;
    // A new phone for this parent (the *_PHONE secret changed): the old phone's Photon user, space and iMessage
    // line belong to someone else now, so drop them; the new phone's first "hi" fills them in again.
    // Same rule as C's photonWebhook matching (shared/c/photon.ts normalizePhone): a 10-digit US number gets its 1.
    const digits = (s?: string) => { const d = (s ?? "").replace(/\D/g, ""); return d.length === 10 ? `1${d}` : d; };
    const newPhone = defined.phone !== undefined && digits(defined.phone) !== digits(row.phone);
    const photonReset = newPhone ? { photonUserId: "", photonSpaceId: "", photonLineUserId: "" } : {};
    // B5: everyone plays the same parents, so RESET also restores the pet's rules and forgets passkeys (trust.ts trustReset).
    await db.Parent.update(row.id, { ...defined, ...photonReset, convo: { step: "idle", ...(row.convo?.optedOut ? { optedOut: true } : {}) }, ...trustReset() });   // keep STOP
    ids[p.key] = row.id;
  }
  for (const r of existing) if (!kept.has(r.id)) await db.Parent.delete(r.id).catch(() => undefined);
  if (create.length) {
    const made = await createAll(db.Parent, create, (p) => p.key);
    for (const [k, p] of Object.entries(made)) ids[k] = p.id;
  }
  return ids;
}

/** Same for children: each seeded parent keeps its first child row (and id), rewritten to the seed. */
async function upsertChildren(db: Db, seed: SeedPlan["children"], parentIds: Record<string, string>): Promise<Record<string, Child>> {
  const existing = oldestFirst(await db.Child.list(undefined, 500));
  const out: Record<string, Child> = {};
  const create: Omit<Child, "id">[] = [];
  const kept = new Set<string>();
  for (const { parentKey, ...rest } of seed) {
    const parentId = parentIds[parentKey];
    const row = existing.find((c) => c.parentId === parentId && !kept.has(c.id));
    if (!row) { create.push({ ...rest, parentId }); continue; }
    kept.add(row.id);
    await db.Child.update(row.id, rest);
    out[parentKey] = { ...row, ...rest, parentId };
  }
  for (const c of existing) if (!kept.has(c.id)) await db.Child.delete(c.id).catch(() => undefined);
  if (create.length) {
    const made = await createAll(db.Child, create, (c) => c.parentId);
    for (const { parentKey } of seed) if (!out[parentKey]) out[parentKey] = made[parentIds[parentKey]];
  }
  return out;
}

/** Wipe every entity (parents and children are kept and rewritten in place), then create the plan. Returns key → id maps. */
export async function applySeed(db: Db, plan: SeedPlan) {
  await wipe(db, ["Parent", "Child"]);
  const parentIds = await upsertParents(db, plan.parents);
  const childByParent = await upsertChildren(db, plan.children, parentIds);

  const rows: Omit<ClothingItem, "id">[] = plan.items.map((it) => {
    const ownerId = parentIds[it.ownerKey];
    const child = childByParent[it.ownerKey];
    const since = it.ownedSince ?? it.originalPurchaseDate;
    const former = (it.formerOwners ?? []).map((h) => ({ ...h, ownerId: parentIds[h.ownerId] ?? h.ownerId }));
    const current = it.paidCents != null ? { ownerId, from: since, priceCents: it.paidCents } : { ownerId, from: since };
    return {
      name: it.name, category: it.category, icon: it.icon, size: it.size,
      originalPriceCents: it.originalPriceCents, originalPurchaseDate: it.originalPurchaseDate,
      ownerCount: it.ownerCount, currentOwnerId: ownerId, childId: child.id,
      photos: it.photos ?? [], ownershipHistory: [...former, current],
      predictedOutgrowDate: predictOutgrow(it.size, child.birthDate, since),
      status: "in_closet",
    };
  });
  const items = await createAll(db.ClothingItem, rows, (i) => i.name);
  const itemIds: Record<string, string> = Object.fromEntries(Object.entries(items).map(([k, i]) => [k, i.id]));

  for (const l of plan.listings) {
    const { itemName, ...rest } = l;
    const item = items[itemName];
    await db.Listing.create({ ...rest, itemId: item.id, sellerId: item.currentOwnerId });
    await db.ClothingItem.update(item.id, { status: "listed" });
  }

  if (plan.needs.length) {
    await createAll(db.Need, plan.needs.map(({ parentKey, ...rest }) =>
      ({ ...rest, parentId: parentIds[parentKey], childId: childByParent[parentKey].id })), (n) => `${n.parentId}|${n.createdAt}`);
  }

  await db.Setting.create(plan.setting);
  return { parentIds, itemIds };
}
