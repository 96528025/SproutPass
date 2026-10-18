// Nudge scan + message templates. OWNER: B1.
// Pure TS: no npm:/base44: imports.
import type { AgentNudge, Child, ClothingItem, ID, ISODate, Listing, NudgeKind } from "./types.ts";
import { canResell, formatCents } from "./pricing.ts";
import { OUTGROW_BUFFER_DAYS, predictOutgrow } from "./sizes.ts";

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

const DAY_MS = 86_400_000;
export const LISTING_REMINDER_DAYS = 30;

/** When the owner got the item: the open history entry, else the original purchase. */
function ownedSince(item: ClothingItem): ISODate {
  const open = [...(item.ownershipHistory ?? [])].reverse().find((h) => h.ownerId === item.currentOwnerId && !h.to);
  return open?.from ?? item.originalPurchaseDate;
}

/**
 * Rules:
 *  - outgrow_check: item "in_closet", ownerCount < 3, now ≥ predictedOutgrowDate − 14 days, and no
 *    outgrow_check was ever created for this item with this owner (keep / later / sell all count).
 *    predictedOutgrowDate falls back to the owner's child if it's missing.
 *  - listing_reminder: listing active ≥ 30 days on a still-listed item, no unresolved reminder for the item,
 *    and at most one reminder per 30 days.
 *  - never nudge "sell" for ownerCount 3.
 * Deterministic: same input → same drafts in the same order.
 */
export function scanForNudges(input: ScanInput): NudgeDraft[] {
  const now = new Date(input.now).getTime();
  const out: NudgeDraft[] = [];
  const taken = new Set<string>();
  const pet = (parentId: ID) => input.parentsById[parentId]?.petName ?? "";

  for (const item of input.items) {
    if (item.status !== "in_closet" || !canResell(item)) continue;
    let outgrow = item.predictedOutgrowDate ?? undefined;
    if (!outgrow) {
      const child = input.children.find((c) => c.id === item.childId);
      if (!child) continue;
      outgrow = predictOutgrow(item.size, child.birthDate, ownedSince(item));
    }
    if (now < new Date(outgrow).getTime() - OUTGROW_BUFFER_DAYS * DAY_MS) continue;
    const owner = item.currentOwnerId;
    const key = `${item.id}|outgrow_check|${owner}`;
    if (taken.has(key)) continue;
    if (input.existing.some((n) => n.itemId === item.id && n.kind === "outgrow_check" && n.parentId === owner)) continue;
    taken.add(key);
    out.push({ parentId: owner, itemId: item.id, kind: "outgrow_check", createdAt: input.now, resolved: false,
      message: nudgeMessage("outgrow_check", { itemName: item.name, size: item.size, petName: pet(owner), outgrowDate: outgrow }) });
  }

  for (const listing of input.listings) {
    if (listing.status !== "active") continue;
    if (now - new Date(listing.createdAt).getTime() < LISTING_REMINDER_DAYS * DAY_MS) continue;
    const item = input.items.find((i) => i.id === listing.itemId);
    if (!item || item.status !== "listed" || !canResell(item)) continue;
    const key = `${item.id}|listing_reminder`;
    if (taken.has(key)) continue;
    const reminders = input.existing.filter((n) => n.itemId === item.id && n.kind === "listing_reminder");
    if (reminders.some((n) => !n.resolved)) continue;
    if (reminders.some((n) => now - new Date(n.createdAt).getTime() < LISTING_REMINDER_DAYS * DAY_MS)) continue;
    taken.add(key);
    out.push({ parentId: listing.sellerId, itemId: item.id, kind: "listing_reminder", createdAt: input.now, resolved: false,
      message: nudgeMessage("listing_reminder", { itemName: item.name, size: item.size, petName: pet(listing.sellerId),
        priceText: formatCents(listing.priceCents) }) });
  }
  return out;
}

export interface MessageCtx {
  itemName: string; size: string; petName: string; outgrowDate?: ISODate; priceText?: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Nov 17" (UTC, so every server and phone agrees). */
export function shortDate(iso: ISODate): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** ≤ 2 sentences, plain text, works as an iMessage. Deterministic; the pet introduces itself by name. */
export function nudgeMessage(kind: NudgeKind, ctx: MessageCtx): string {
  const name = ctx.petName?.trim() || "your pet";
  const pet = name[0].toUpperCase() + name.slice(1);
  const item = ctx.itemName.trim().toLowerCase();
  switch (kind) {
    case "outgrow_check":
      return `${pet} here! The ${item} (${ctx.size}) is probably getting snug — still fit, or want to pass it on?`;
    case "listing_reminder":
      return `${pet} here! Your ${item} is still waiting for its next home${ctx.priceText ? ` at ${ctx.priceText}` : ""} — keep it listed, or bring it back to the closet?`;
    case "new_owner_welcome":
      return ctx.outgrowDate
        ? `${pet} here — say hi to the ${item}! It should fit until ~${shortDate(ctx.outgrowDate)}, and I'll check in before then.`
        : `${pet} here — say hi to the ${item}! I'll check in when it starts getting snug.`;
  }
}
