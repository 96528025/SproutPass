// OWNER: B3. Handlers for trade functions. Pure TS (see closet.ts header).
// State machine: open → both_accepted → paid, with exits open → declined | expired and
// both_accepted → payment_failed. Base44 has no transactions, so every handler writes in the order
// that leaves a safe state if a later write fails, and every handler is safe to call twice.
import type { Db, EntityApi } from "../db.ts";
import { getNow, mustGet, publicParent, resolveParent, writeInbox } from "../db.ts";
import type {
  Child, ClothingItem, CreateProposalReq, DecideProposalReq, GetPartiesReq, ID, ISODate, MatchProposal, Parent, PayProposalReq,
  PayProposalRes, ProposalStatus, PublicParty,
} from "../types.ts";
import { bad, forbidden, HttpError, invalid } from "../errors.ts";
import { checkEligibility, reasonLine } from "../match.ts";
import { canResell } from "../pricing.ts";
import { predictOutgrow } from "../sizes.ts";
import { nudgeMessage } from "../nudges.ts";

export const PROPOSAL_TTL_MS = 30 * 60_000;
const LIVE: ProposalStatus[] = ["open", "both_accepted"];
const isLive = (p: MatchProposal) => LIVE.includes(p.status);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Update a row and return the merged result (works whether or not the backend returns the full row). */
async function patch<T extends { id: ID }>(api: EntityApi<T>, row: T, changes: Partial<T>): Promise<T> {
  const saved = await api.update(row.id, changes);
  return { ...row, ...changes, ...(saved && typeof saved === "object" ? saved : {}) };
}

function roleOf(p: MatchProposal, parentId: ID): "buyer" | "seller" | null {
  if (parentId === p.sellerId) return "seller";
  if (parentId === p.buyerId) return "buyer";
  return null;
}

/** Parents by id: `known` rows are reused, the rest read once each (a missing row → absent, never an error). */
async function partiesOf(db: Db, ids: ID[], known: (Parent | null | undefined)[] = []): Promise<Map<ID, Parent>> {
  const out = new Map<ID, Parent>();
  for (const k of known) if (k && ids.includes(k.id)) out.set(k.id, k);
  await Promise.all(ids.filter((id) => !out.has(id)).map(async (id) => {
    const p = await db.Parent.get(id).catch(() => null);
    if (p) out.set(id, p);
  }));
  return out;
}

/** Only set when present, so an event never carries `undefined`. */
const opt = <K extends string, V>(key: K, v: V | null | undefined) => (v == null || v === "" ? {} : { [key]: v }) as { [P in K]?: V };

async function notifyUpdated(db: Db, p: MatchProposal, known: (Parent | null | undefined)[] = []): Promise<void> {
  const base = { proposalId: p.id, status: p.status, sellerDecision: p.sellerDecision, buyerDecision: p.buyerDecision };
  const parties = await partiesOf(db, [p.sellerId, p.buyerId], known);
  await writeInbox(db, p.sellerId, { type: "proposal:updated", role: "seller", ...base, ...opt("otherName", parties.get(p.buyerId)?.name) });
  await writeInbox(db, p.buyerId, { type: "proposal:updated", role: "buyer", ...base, ...opt("otherName", parties.get(p.sellerId)?.name) });
}

/**
 * Put the item back on the market after a proposal ends without a sale (declined / expired / payment_failed).
 * The listing is never touched before payment, so it is still active.
 */
async function relist(db: Db, p: MatchProposal): Promise<void> {
  const item = await mustGet(db.ClothingItem, p.itemId, "item");
  if (item.currentOwnerId === p.sellerId && item.status === "pending_trade") {
    await db.ClothingItem.update(item.id, { status: "listed" });
  }
}

const isExpired = (p: MatchProposal, now: ISODate) => p.status === "open" && new Date(now).getTime() > new Date(p.expiresAt).getTime();

async function expire(db: Db, p: MatchProposal): Promise<MatchProposal> {
  const next = await patch(db.MatchProposal, p, { status: "expired" });
  await relist(db, next);
  await notifyUpdated(db, next);
  return next;
}

const expiredError = () => new HttpError("expired", "This offer timed out.", 409);

async function firstChild(db: Db, parentId: ID): Promise<Child | undefined> {
  const kids = await db.Child.filter({ parentId });
  return [...kids].sort((a, b) => (a.birthDate < b.birthDate ? -1 : 1))[0];
}

// ---------------------------------------------------------------- createProposal (agent-only)

export async function createProposal(db: Db, body: CreateProposalReq): Promise<MatchProposal> {
  if (!body?.listingId) throw bad("listingId required");
  if (!body.buyerId) throw bad("buyerId required");
  const now = await getNow(db);
  const listing = await mustGet(db.Listing, body.listingId, "listing");
  const buyer = await mustGet(db.Parent, body.buyerId, "buyer");

  // Idempotent: one live proposal per listing. Lazily expire a stale one first.
  for (const p of await db.MatchProposal.filter({ listingId: listing.id })) {
    if (!isLive(p)) continue;
    if (isExpired(p, now)) { await expire(db, p); continue; }
    if (p.buyerId !== buyer.id) throw new HttpError("already_open", "This item already has an open trade.", 409);
    if (body.encounterId && p.encounterId === body.encounterId) await markEncounterProposed(db, body.encounterId, p.transcript);
    return p;
  }

  const item = await mustGet(db.ClothingItem, listing.itemId, "item");
  const kids = await db.Child.filter({ parentId: buyer.id });
  const needs = (await db.Need.filter({ parentId: buyer.id }))
    .filter((n) => n.shared)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  if (!kids.length) throw new HttpError("not_eligible", "buyer has no child on file", 409);
  if (!needs.length) throw new HttpError("not_eligible", "buyer has no shared need", 409);

  let match: { needId: ID; wearWeeksLeft: number } | null = null;
  let firstReason = "";
  for (const need of needs) {
    const buyerChild = kids.find((c) => c.id === need.childId) ?? kids[0];
    const e = checkEligibility({ listing, item, need, buyerChild, buyerId: buyer.id, now });
    if (e.ok) { match = { needId: need.id, wearWeeksLeft: e.wearWeeksLeft }; break; }
    firstReason ||= e.reason;
  }
  if (!match) throw new HttpError("not_eligible", firstReason, 409);

  let transcript = Array.isArray(body.transcript) ? body.transcript : [];
  if (body.encounterId) {
    const enc = await mustGet(db.Encounter, body.encounterId, "encounter");
    const parties = [enc.aId, enc.bId];
    if (!parties.includes(listing.sellerId) || !parties.includes(buyer.id)) throw forbidden("encounter is between other parents");
    if (enc.status !== "talking") throw invalid(`encounter is ${enc.status}`);
    if (!transcript.length) transcript = enc.transcript ?? [];
  }

  // 1. Proposal first: if a later write fails, the live proposal still blocks a second buyer.
  const proposal = await db.MatchProposal.create({
    listingId: listing.id, itemId: item.id, sellerId: listing.sellerId, buyerId: buyer.id,
    ...(body.encounterId ? { encounterId: body.encounterId } : {}),
    snapshot: {
      itemName: item.name, icon: item.icon, photo: item.photos?.[0] ?? "", size: item.size,
      originalPurchaseDate: item.originalPurchaseDate, originalPriceCents: item.originalPriceCents,
      condition: listing.condition, conditionNote: listing.conditionNote ?? "",
      previousOwners: item.ownerCount, priceCents: listing.priceCents, wearWeeksLeft: match.wearWeeksLeft,
    },
    reason: body.reason?.trim() || reasonLine(buyer.name, item, match.wearWeeksLeft),
    transcript,
    source: body.source === "fetch" ? "fetch" : "local",
    sellerDecision: "pending", buyerDecision: "pending", status: "open", handover: "now",
    createdAt: now, expiresAt: new Date(new Date(now).getTime() + PROPOSAL_TTL_MS).toISOString(),
  });
  // 2. Item off the market.
  await db.ClothingItem.update(item.id, { status: "pending_trade" });
  // 3. Encounter → proposed.
  if (body.encounterId) await markEncounterProposed(db, body.encounterId, transcript);
  // 4. Tell both agents (peerPet = the other side's pet, for the agent's first line).
  const seller = (await partiesOf(db, [proposal.sellerId])).get(proposal.sellerId);
  await writeInbox(db, proposal.sellerId, { type: "proposal:new", proposalId: proposal.id, role: "seller", ...opt("peerPet", buyer.pet?.name) });
  await writeInbox(db, proposal.buyerId, { type: "proposal:new", proposalId: proposal.id, role: "buyer", ...opt("peerPet", seller?.pet?.name) });
  return proposal;
}

async function markEncounterProposed(db: Db, encounterId: ID, transcript: MatchProposal["transcript"]): Promise<void> {
  const enc = await mustGet(db.Encounter, encounterId, "encounter");
  if (enc.status !== "talking") return;
  await db.Encounter.update(enc.id, { status: "proposed", ...(transcript.length ? { transcript } : {}) });
}

// ---------------------------------------------------------------- decideProposal

export async function decideProposal(db: Db, body: DecideProposalReq): Promise<MatchProposal> {
  const parent = await resolveParent(db, body);
  if (body.decision !== "accepted" && body.decision !== "declined") throw bad("decision must be accepted or declined");
  if (body.handover != null && body.handover !== "now" && body.handover !== "later") throw bad("handover must be now or later");
  const p = await mustGet(db.MatchProposal, body.proposalId, "proposal");
  const role = roleOf(p, parent.id);
  if (!role) throw forbidden("only the buyer or the seller can decide");
  const now = await getNow(db);

  if (p.status === "expired") throw expiredError();
  if (isExpired(p, now)) { await expire(db, p); throw expiredError(); }

  const key = role === "seller" ? "sellerDecision" : "buyerDecision";
  const handoverPatch: Partial<MatchProposal> = {};
  if (body.handover && body.handover !== p.handover) handoverPatch.handover = body.handover;
  if (body.handoverNote != null && body.handoverNote !== (p.handoverNote ?? "")) handoverPatch.handoverNote = body.handoverNote;

  // Same decision again → unchanged (only a handover tweak is applied while the trade is live).
  if (p[key] === body.decision) {
    if (isLive(p) && Object.keys(handoverPatch).length) return patch(db.MatchProposal, p, handoverPatch);
    return p;
  }
  if (p.status !== "open") throw invalid(`this trade is already ${p.status.replace("_", " ")}`);
  if (p[key] !== "pending") throw invalid("you already decided on this trade");

  if (body.decision === "declined") {
    // Proposal first so nothing can be paid, then the item goes back on the market. No payment is created.
    const next = await patch(db.MatchProposal, p, { [key]: "declined", status: "declined", ...handoverPatch } as Partial<MatchProposal>);
    await relist(db, next);
    await notifyUpdated(db, next, [parent]);
    return next;
  }

  const other = role === "seller" ? p.buyerDecision : p.sellerDecision;
  const status: ProposalStatus = other === "accepted" ? "both_accepted" : "open";
  const next = await patch(db.MatchProposal, p, { [key]: "accepted", status, ...handoverPatch } as Partial<MatchProposal>);
  await notifyUpdated(db, next, [parent]);
  return next;
}

// ---------------------------------------------------------------- payProposal

const REF_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function demoRef(): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += REF_CHARS[Math.floor(Math.random() * REF_CHARS.length)];
  return `DEMO-${s}`;
}

async function current(db: Db, p: MatchProposal): Promise<PayProposalRes> {
  return { proposal: p, item: await mustGet(db.ClothingItem, p.itemId, "item") };
}

/** opts.delayMs: 1000 in production, 0 in tests/selfTest. */
export async function payProposal(db: Db, body: PayProposalReq, opts: { delayMs?: number } = {}): Promise<PayProposalRes> {
  const delayMs = Math.max(0, opts.delayMs ?? 1000);
  const parent = await resolveParent(db, body);
  let p = await mustGet(db.MatchProposal, body.proposalId, "proposal");
  if (p.buyerId !== parent.id) throw forbidden("only the buyer can pay");
  if (p.status === "paid") return current(db, p);
  if (p.status !== "both_accepted") {
    throw invalid(p.status === "open" ? "Both of you need to accept before paying." : `this trade is ${p.status.replace("_", " ")}`);
  }

  // Claim the payment before waiting, so a double tap transfers once: the last claim wins and the
  // other request just waits for the result.
  const ref = demoRef();
  await db.MatchProposal.update(p.id, { paymentRef: ref });
  await sleep(delayMs);
  p = await mustGet(db.MatchProposal, p.id, "proposal");
  if (p.paymentRef !== ref || p.status !== "both_accepted") return settle(db, p, delayMs);

  if (body.fail) {
    const next = await patch(db.MatchProposal, p, { status: "payment_failed" });
    await relist(db, next);
    await notifyUpdated(db, next, [parent]);
    return current(db, next);
  }

  const now = await getNow(db);
  // 1. Move the item (skipped if a crashed earlier attempt already moved it).
  let item = await mustGet(db.ClothingItem, p.itemId, "item");
  if (item.currentOwnerId !== p.buyerId) {
    if (item.currentOwnerId !== p.sellerId) throw invalid("the seller no longer owns this item");
    if (!canResell(item)) throw new HttpError("not_resellable", "Final home: this item has had its 3 owners.", 409);
    const buyerChild = await firstChild(db, p.buyerId);
    if (!buyerChild) throw invalid("buyer has no child on file");
    const history = item.ownershipHistory.map((h) => (h.ownerId === p.sellerId && !h.to ? { ...h, to: now } : h));
    history.push({ ownerId: p.buyerId, from: now, priceCents: p.snapshot.priceCents });
    item = await patch(db.ClothingItem, item, {
      ownershipHistory: history,
      ownerCount: Math.min(3, item.ownerCount + 1) as ClothingItem["ownerCount"],
      currentOwnerId: p.buyerId,
      childId: buyerChild.id,
      predictedOutgrowDate: predictOutgrow(item.size, buyerChild.birthDate, now),
      status: "in_closet",
    });
  }
  // 2. Listing sold.
  const listing = await mustGet(db.Listing, p.listingId, "listing");
  if (listing.status !== "sold") await db.Listing.update(listing.id, { status: "sold" });
  // 3. Proposal paid.
  const paid = await patch(db.MatchProposal, p, { status: "paid", paymentRef: ref });
  // 4. Welcome nudge for the buyer (once).
  const buyer = await mustGet(db.Parent, p.buyerId, "buyer");
  const existing = await db.AgentNudge.filter({ parentId: p.buyerId, itemId: item.id, kind: "new_owner_welcome" });
  const nudge = existing[0] ?? await db.AgentNudge.create({
    parentId: p.buyerId, itemId: item.id, kind: "new_owner_welcome",
    message: nudgeMessage("new_owner_welcome", { itemName: item.name, size: item.size, petName: buyer.pet?.name ?? "your pet",
      outgrowDate: item.predictedOutgrowDate }),
    createdAt: now, resolved: false,
  });
  // 5. Tell both agents (C's agents word the "sold" / "welcome" lines from the snapshot, no extra reads).
  const done = {
    type: "trade:completed" as const, proposalId: paid.id, itemId: item.id, priceCents: paid.snapshot.priceCents,
    buyerId: paid.buyerId, sellerId: paid.sellerId, snapshot: paid.snapshot, ...opt("predictedOutgrowDate", item.predictedOutgrowDate),
  };
  await writeInbox(db, paid.sellerId, { ...done, role: "seller" });
  await writeInbox(db, paid.buyerId, { ...done, role: "buyer" });
  if (!existing.length) {
    await writeInbox(db, paid.buyerId, { type: "nudge:new", nudgeId: nudge.id, itemId: item.id, kind: nudge.kind, message: nudge.message });
  }
  return { proposal: paid, item };
}

/** A concurrent pay request owns this payment: wait for it to finish and return what it produced. */
async function settle(db: Db, p: MatchProposal, delayMs: number): Promise<PayProposalRes> {
  const step = Math.max(50, Math.min(500, delayMs / 2));
  for (let i = 0; i < 20 && p.status === "both_accepted"; i++) {
    await sleep(step);
    p = await mustGet(db.MatchProposal, p.id, "proposal");
  }
  return current(db, p);
}

// ---------------------------------------------------------------- getParties (the trade window's name cards)

export const MAX_PARTY_IDS = 10;

/**
 * Public cards for the parents in a trade: only id, name, avatar and pet (never phone, Photon ids, convo or ASI
 * address). Unknown ids are skipped. One Parent read whatever the count, to stay cheap under the rate limit.
 */
export async function getParties(db: Db, body: GetPartiesReq): Promise<PublicParty[]> {
  const raw = body?.parentIds;
  if (!Array.isArray(raw) || raw.some((id) => typeof id !== "string" || !id)) throw bad("parentIds must be a list of ids");
  const ids = [...new Set(raw)];
  if (!ids.length) throw bad("parentIds must not be empty");
  if (ids.length > MAX_PARTY_IDS) throw bad(`at most ${MAX_PARTY_IDS} parentIds`);
  const byId = new Map((await db.Parent.list(undefined, 500)).map((p) => [p.id, p]));
  return ids.flatMap((id) => {
    const p = byId.get(id);
    if (!p) return [];
    const { name, avatar, pet } = publicParent(p);
    return [{ id: p.id, name, avatar, pet }];
  });
}
