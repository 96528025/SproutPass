import { getNow } from "./db.ts";
import { checkEligibility } from "./match.ts";
import type { ClothingItem, MatchProposal, Need } from "./types.ts";

export interface TrialView {
  checkedAt: string;
  families: { name: string; connected: boolean }[];
  garments: { id: string; name: string }[];
  item: Pick<ClothingItem, "id" | "name" | "size" | "category" | "photos" | "currentOwnerId" | "originalPriceCents" | "trialSample"> | null;
  buyerId: string;
  proposal: Pick<MatchProposal, "id" | "status" | "paymentRef" | "visaSimulation" | "snapshot"> | null;
  steps: { label: string; done: boolean; detail: string }[];
}

// Read-only evidence for the configured demo pair; never creates a match or marks a step complete manually.
// deno-lint-ignore no-explicit-any
export async function trialStatus(db: any, itemId?: string): Promise<TrialView> {
  const parents = await db.Parent.list();
  const seller = parents.find((p: { key: string }) => p.key === "sam");
  const buyer = parents.find((p: { key: string }) => p.key === "jo");
  if (!seller || !buyer) throw new Error("Freja and Olivia must be configured first.");
  const [items, needs, listings, proposals, children, now] = await Promise.all([
    db.ClothingItem.list("-created_date", 200), db.Need.filter({ parentId: buyer.id }),
    db.Listing.filter({ sellerId: seller.id }), db.MatchProposal.filter({ sellerId: seller.id, buyerId: buyer.id }),
    db.Child.filter({ parentId: buyer.id }), getNow(db),
  ]);
  const garments: ClothingItem[] = items.filter((i: ClothingItem) => i.photos?.length &&
    (i.currentOwnerId === seller.id || i.ownershipHistory?.some(h => h.ownerId === seller.id)));
  const item = (itemId ? garments.find(i => i.id === itemId) : garments[0]) ?? null;
  const listing = item && listings.find((l: { itemId: string; status: string }) => l.itemId === item.id && l.status === "active");
  const proposal: MatchProposal | undefined = item && proposals.filter((p: MatchProposal) => p.itemId === item.id)
    .sort((a: MatchProposal, b: MatchProposal) => b.createdAt.localeCompare(a.createdAt))[0];
  const fit = item && listing && needs.find((n: Need) => {
    const child = children.find((c: { id: string }) => c.id === n.childId) ?? children[0];
    return child && checkEligibility({ listing, item, need: n, buyerChild: child, buyerId: buyer.id, now }).ok;
  });
  const receipts = proposal?.paymentRef ? await Promise.all([seller, buyer].map(async p => {
    const lines = await db.PetLine.filter({ parentId: p.id }, "-createdAt", 50);
    const line = lines.find((l: { text: string; deliveryStatus?: string; imageSubmitted?: boolean }) => l.text?.includes(proposal.paymentRef!) && l.deliveryStatus === "submitted" && l.imageSubmitted);
    return { name: p.name, sent: !!line };
  })) : [];
  const transferred = proposal?.status === "paid" && item?.currentOwnerId === buyer.id;
  return {
    checkedAt: new Date().toISOString(),
    families: [seller, buyer].map(p => ({ name: p.name, connected: !!p.photonLineUserId })),
    garments: garments.map(i => ({ id: i.id, name: i.name })),
    item: item ? { id: item.id, name: item.name, size: item.size, category: item.category, photos: item.photos, currentOwnerId: item.currentOwnerId, originalPriceCents: item.originalPriceCents, trialSample: item.trialSample } : null,
    buyerId: buyer.id,
    proposal: proposal ? { id: proposal.id, status: proposal.status, paymentRef: proposal.paymentRef, visaSimulation: proposal.visaSimulation, snapshot: proposal.snapshot } : null,
    steps: [
      { label: item?.trialSample ? "Sample garment saved in Freja’s inventory" : "Photo saved to Freja’s inventory", done: !!item?.sourceMessageId || !!item?.trialSample, detail: item?.trialSample ? "Staged sample with an illustration; no real photo upload or AI recognition is claimed." : item?.sourceMessageId ? item.name : "Send a garment photo, or prepare a clearly labeled demo sample." },
      { label: "Garment ready to share", done: !!listing || !!proposal, detail: listing || proposal ? "Shared listing saved." : "Confirm the label size and original price, then list the garment for sale." },
      { label: "Olivia’s need fits", done: !!fit || !!proposal, detail: fit || proposal ? "The backend found an eligible need for this garment." : "Olivia: describe the clothing type, size and budget, then reply yes to save the need." },
      { label: "Agents produce the offer", done: !!proposal, detail: proposal ? `Offer saved · ${proposal.status.replaceAll("_", " ")}` : "Open both world screens and approach each other. For the demonstration, explicitly choose simulated location." },
      { label: "Buyer approves and inventory transfers", done: !!transferred, detail: transferred ? `Olivia owns the garment · ${proposal?.paymentRef ?? "receipt saved"}` : "Only Olivia approves. Visa payment is simulated; inventory ownership really changes." },
      { label: "Photo and receipt submitted to both iMessage chats", done: receipts.length === 2 && receipts.every(r => r.sent), detail: receipts.length ? receipts.map(r => `${r.name}: ${r.sent ? "submitted to Photon" : "not confirmed"}`).join(" · ") + ". Confirm arrival on both physical phones." : "No completion receipts yet. Submitted means Photon accepted the send, not that a person read it." },
    ],
  };
}
