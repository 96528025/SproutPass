import type { MatchProposal } from "../types.ts";
import { t } from "./wording.ts";

/** Offers and receipts use the same garment image, including illustrated demo items. */
export function proposalImage(s: Partial<MatchProposal["snapshot"]>, host: string): string {
  const icon = /^item_[a-z_]+$/.test(s.icon ?? "") ? s.icon : "item_romper";
  return s.photo || `https://${host}/sprites/${icon}.png`;
}

/** The same final offer goes to both people; only the private review link differs. */
export function proposalReview(s: MatchProposal["snapshot"], peerPet: string, link: string, host: string, buyer = true) {
  return {
    image: proposalImage(s, host),
    text: `${buyer ? t.proposal(s.itemName, s.priceCents, s.originalPriceCents, s.previousOwners ?? 1, peerPet) : `${peerPet} and I found a buyer for your ${s.itemName}. Final price: $${(s.priceCents / 100).toFixed(2)}. Your shared listing authorizes this offer; waiting for the buyer to approve. No action needed from you. Demo only, no real charge.`}\nBuyer approval runs a simulated Visa payment; no real money moves.\nSize: ${s.size ?? "unknown"}.${s.photo ? "" : " Product illustration; photo not provided."}\n${buyer ? "Approve or Decline" : "View product"}: ${link}`,
  };
}
