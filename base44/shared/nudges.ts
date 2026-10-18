// Nudge scan + message templates. OWNER: B1 (replace the TODO bodies; keep signatures).
// Pure TS: no npm:/base44: imports.
import type { AgentNudge, Child, ClothingItem, ID, ISODate, Listing, NudgeKind } from "./types.ts";

export interface NudgeDraft {
  parentId: ID; itemId: ID; kind: NudgeKind; message: string; createdAt: ISODate; resolved: false;
}

export interface ScanInput {
  items: ClothingItem[];
  listings: Listing[];
  children: Child[];
  parentsById: Record<ID, { name: string; petName: string }>;
  existing: AgentNudge[];   // never duplicate (itemId, kind) while unresolved; never re-nudge outgrow_check for the same owner
  now: ISODate;
}

/**
 * Rules (B1 implements):
 *  - outgrow_check: item.status "in_closet", ownerCount < 3, predictedOutgrowDate set,
 *    now >= predictedOutgrowDate − 14 days.
 *  - listing_reminder: listing active ≥ 30 days.
 *  - never nudge "sell" for ownerCount 3.
 */
export function scanForNudges(_input: ScanInput): NudgeDraft[] {
  return []; // TODO(B1)
}

export interface MessageCtx {
  itemName: string; size: string; petName: string; outgrowDate?: ISODate; priceText?: string;
}

/** ≤ 2 sentences, plain text, works as an iMessage. TODO(B1): warmer variants, keep deterministic. */
export function nudgeMessage(kind: NudgeKind, ctx: MessageCtx): string {
  switch (kind) {
    case "outgrow_check":
      return `The ${ctx.itemName.toLowerCase()} (${ctx.size}) is probably getting snug. Does it still fit, or want to pass it on?`;
    case "listing_reminder":
      return `Your ${ctx.itemName.toLowerCase()} is still waiting for its next home. Keep it listed?`;
    case "new_owner_welcome":
      return `Say hi to the ${ctx.itemName.toLowerCase()}! I'll check in when it's getting small.`;
  }
}
