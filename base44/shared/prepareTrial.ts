import { getNow } from "./db.ts";
import type { Db } from "./db.ts";
import { listItem, recordPurchase, upsertNeed } from "./logic/closet.ts";
import { createProposal } from "./logic/trade.ts";
import { fitsNow, SIZE_ORDER } from "./sizes.ts";

export async function prepareTrial(db: Db, makeOffer = false) {
  const parents = await db.Parent.list();
  const seller = parents.find(p => p.key === "sam");
  const buyer = parents.find(p => p.key === "jo");
  if (!seller || !buyer) throw new Error("Freja and Olivia must be configured first.");
  const now = await getNow(db);
  const [child] = await db.Child.filter({ parentId: buyer.id });
  const size = child && SIZE_ORDER.find(s => fitsNow(s, child.birthDate, now));
  if (!size) throw new Error("Olivia needs a child profile with a supported clothing size for this demo.");
  let item = (await db.ClothingItem.filter({ trialSample: true })).find(i => i.ownershipHistory.some(h => h.ownerId === seller.id));
  if (!item) {
    item = await recordPurchase(db, { parentId: seller.id, name: "Demo · yellow duck romper", category: "onesie", icon: "item_romper", size, originalPriceCents: 3000, photo: "https://sproutpass-5c025059.base44.app/sprites/item_romper.png" });
    item = await db.ClothingItem.update(item.id, { trialSample: true });
  }
  const proposals = await db.MatchProposal.filter({ itemId: item.id, buyerId: buyer.id });
  const existing = proposals.find(p => ["open", "both_accepted", "paid"].includes(p.status));
  if (existing) return { itemId: item.id, proposalId: existing.id, status: existing.status };
  if (item.currentOwnerId !== seller.id) throw new Error("This sample has already moved to another family.");
  const needs = await db.Need.filter({ parentId: buyer.id });
  if (!needs.some(n => n.shared && n.sizes.includes(item!.size) && (!n.categories?.length || n.categories.includes("onesie")) && (n.maxPriceCents == null || n.maxPriceCents >= 1800))) {
    await upsertNeed(db, { parentId: buyer.id, sizes: [item.size], categories: ["onesie"], maxPriceCents: 2000, shared: true });
  }
  const listing = await listItem(db, { parentId: seller.id, itemId: item.id, photo: item.photos[0], condition: "gently_used", conditionNote: "Staged demonstration garment; illustration, not a real product photograph.", shared: true });
  const proposal = makeOffer ? await createProposal(db, { listingId: listing.id, buyerId: buyer.id, source: "local", reason: "Staged SproutPass demo: this sample meets Olivia’s saved clothing need. Only the buyer approves. Visa payment is simulated.", transcript: [] }) : null;
  return { itemId: item.id, proposalId: proposal?.id, status: proposal?.status ?? "ready" };
}
