// FROZEN CONTRACT — shared by every Base44 function (import "../../shared/types.ts")
// and the frontend (src/app/types.ts re-exports this file).
// Changes only through Caesar; announce in NEEDS.md.

export type ID = string;
export type ISODate = string; // ISO 8601, UTC

export type SizeLabel = "0-3M" | "3-6M" | "6-9M" | "9-12M" | "12-18M" | "18-24M" | "2T" | "3T" | "4T";
export type Category = "top" | "bottom" | "onesie" | "outerwear" | "dress" | "set" | "other";
export type Condition = "like_new" | "gently_used" | "well_loved";

// ---------------------------------------------------------------- entities (one Base44 entity each)

export interface Parent {
  id: ID;
  key: string;                       // stable seed key: "mina" | "jo" | "sam"; used by ?as=
  name: string;
  avatar: { sprite: string; palette: string };   // sprite: "parent_a" | "parent_b" | "parent_c"
  pet: { sprite: string; name: string };         // sprite: "pet_a" | "pet_b" | "pet_c"
  phone?: string;                    // E.164; field-level RLS: never readable by clients
  agentAddress?: string;             // Fetch "agent1q…"
  discoverable: boolean;
  photonUserId?: string;             // cache for sendImessage (C)
  photonSpaceId?: string;
  photonLineUserId?: string;         // C: the Photon iMessage line this parent texts; their pet replies from it
  convo?: Record<string, unknown>;   // C's iMessage fallback conversation state (server-only)
  asiAddress?: string;               // C: ASI:One user bound with "claim mina-1234" (server-only)
}

export interface Child {
  id: ID;
  parentId: ID;
  nickname: string;
  birthDate: ISODate;
}

export interface OwnershipEntry { ownerId: ID; from: ISODate; to?: ISODate; priceCents?: number }

export type ItemStatus = "in_closet" | "listed" | "pending_trade" | "transferred_out";

export interface ClothingItem {
  id: ID;
  name: string;                      // "Yellow duck romper"
  category: Category;
  icon: string;                      // sprite key, e.g. "item_romper"
  size: SizeLabel;
  originalPriceCents: number;
  originalPurchaseDate: ISODate;     // first owner's purchase date, never changes
  ownerCount: 1 | 2 | 3;
  currentOwnerId: ID;
  childId: ID;
  photos: string[];                  // latest first
  ownershipHistory: OwnershipEntry[];
  predictedOutgrowDate?: ISODate;
  status: ItemStatus;
}

export interface Listing {
  id: ID;
  itemId: ID;
  sellerId: ID;
  condition: Condition;
  conditionNote: string;
  priceCents: number;                // = priceFor(item) at listing time
  shared: boolean;
  status: "active" | "withdrawn" | "sold";
  createdAt: ISODate;
}

export interface Need {
  id: ID;
  parentId: ID;
  childId: ID;
  sizes: SizeLabel[];
  categories?: Category[];
  maxPriceCents?: number;
  shared: boolean;
  createdAt: ISODate;
}

export interface Presence {          // C owns the logic; server-only reads
  id: ID;
  parentId: ID;
  lat: number;
  lng: number;
  accuracyM: number;
  simulated: boolean;
  updatedAt: ISODate;
}

export interface AgentTurn {
  from: "buyer_agent" | "seller_agent";
  parentId: ID;
  kind: "looking_for" | "have" | "no_fit" | "fit_check" | "propose" | "ack" | "decline";
  text: string;
  at: ISODate;
}

export interface Encounter {         // C owns the logic
  id: ID;
  aId: ID;
  bId: ID;
  band: "<25m";
  simulated: boolean;
  status: "talking" | "proposed" | "no_match";
  startedAt: ISODate;
  transcript: AgentTurn[];
}

export type Decision = "pending" | "accepted" | "declined";
export type ProposalStatus = "open" | "both_accepted" | "paid" | "declined" | "expired" | "payment_failed";

export interface ProposalSnapshot {
  itemName: string;
  icon: string;
  photo: string;
  size: SizeLabel;
  originalPurchaseDate: ISODate;
  originalPriceCents: number;
  condition: Condition;
  conditionNote: string;
  previousOwners: number;            // = item.ownerCount at proposal time
  priceCents: number;
  wearWeeksLeft?: number;
}

export interface MatchProposal {
  id: ID;
  listingId: ID;
  itemId: ID;
  sellerId: ID;
  buyerId: ID;
  encounterId?: ID;
  snapshot: ProposalSnapshot;
  reason: string;
  transcript: AgentTurn[];
  source: "fetch" | "local";
  sellerDecision: Decision;
  buyerDecision: Decision;
  status: ProposalStatus;
  handover: "now" | "later";
  handoverNote?: string;
  paymentRef?: string;               // "DEMO-…" mock payment id
  createdAt: ISODate;                // demo-clock time
  expiresAt: ISODate;                // demo-clock time (createdAt + 30 min)
}

export type NudgeKind = "outgrow_check" | "listing_reminder" | "new_owner_welcome";

export interface AgentNudge {
  id: ID;
  parentId: ID;
  itemId: ID;
  kind: NudgeKind;
  message: string;
  createdAt: ISODate;
  resolved: boolean;
}

// Optional fields (C's NEEDS "Event payloads"): what C's agents / iMessage fallback read so they don't have to
// re-read rows that getCloset no longer returns (a declined or paid proposal) — and fewer reads under the rate limit.
export type InboxEvent =
  | { type: "nudge:new"; nudgeId: ID; itemId: ID; kind: NudgeKind; message: string }
  | { type: "proposal:new"; proposalId: ID; role: "buyer" | "seller";
      peerPet?: string }               // the other side's pet name
  | { type: "proposal:updated"; proposalId: ID; role: "buyer" | "seller"; status: ProposalStatus; sellerDecision: Decision; buyerDecision: Decision;
      otherName?: string }             // the other parent's name
  | { type: "trade:completed"; proposalId: ID; role: "buyer" | "seller"; itemId: ID; priceCents: number;
      buyerId?: ID; sellerId?: ID;
      snapshot?: ProposalSnapshot;     // the proposal's snapshot (itemName, size, price…)
      predictedOutgrowDate?: ISODate }; // the item's new date, for the buyer's child

export interface AgentInbox {
  id: ID;
  parentId: ID;
  type: "imessage" | "encounter" | "event";
  payload: Record<string, unknown>;  // InboxEvent when type === "event"
  status: "pending" | "claimed" | "done";
  createdAt: ISODate;                // real time (ordering)
  claimedAt?: ISODate;
}

export interface Setting {
  id: ID;
  key: "demo";
  now: ISODate;                      // demo clock
  matchVia: "fetch" | "local";
  imessage: boolean;
  lineUserId?: string;
}

// ---------------------------------------------------------------- function requests / responses (B)

export type ParentRef = { parentId?: ID; parentKey?: string };   // functions accept either

export interface ClosetView {
  now: ISODate;
  parent: Omit<Parent, "phone" | "photonUserId" | "photonSpaceId" | "photonLineUserId" | "convo" | "asiAddress">;
  child: Child | null;
  childAgeMonths: number | null;
  items: ClothingItem[];             // items currently owned (status != transferred_out)
  passedOn: ClothingItem[];          // items this parent sold (history)
  listings: Listing[];               // this parent's listings (any status)
  needs: Need[];
  nudges: AgentNudge[];              // unresolved
  proposals: MatchProposal[];        // where parent is buyer or seller, not terminal (+ last 5 terminal)
}

export interface RecordPurchaseReq extends ParentRef {
  childId?: ID; name: string; category: Category; icon: string; size: SizeLabel;
  originalPriceCents: number; purchaseDate?: ISODate; photo?: string;
}
export interface ListItemReq extends ParentRef { itemId: ID; photo: string; condition: Condition; conditionNote: string; shared: boolean }
export interface WithdrawListingReq extends ParentRef { listingId: ID }
export interface UpsertNeedReq extends ParentRef { needId?: ID; childId?: ID; sizes: SizeLabel[]; categories?: Category[]; maxPriceCents?: number; shared: boolean }
export interface ResolveNudgeReq extends ParentRef { nudgeId: ID; action: "sell" | "keep" | "snooze" }
export interface ResolveNudgeRes { nudge: AgentNudge; next: "open_listing" | "none"; itemId: ID }

export interface CreateProposalReq {   // internal: x-agent-key (C's agentApi / encounter fallback)
  encounterId?: ID; listingId: ID; buyerId: ID; reason: string; wearWeeksLeft?: number;
  transcript: AgentTurn[]; source: "fetch" | "local";
}
export interface DecideProposalReq extends ParentRef { proposalId: ID; decision: "accepted" | "declined"; handover?: "now" | "later"; handoverNote?: string }
export interface PayProposalReq extends ParentRef { proposalId: ID; fail?: boolean }

// ---------------------------------------------------------------- C's location functions (app-callable)
// Added to the Api with Caesar's OK (00:30) so A's /world can drop its stubs. C owns the handlers.
export type Band = "<25m" | "25-100m" | "100-300m";
export interface UpdatePresenceReq {
  parentId: ID; lat: number; lng: number; accuracyM: number; simulated?: boolean;
  discoverable?: boolean;            // A's DISCOVERABLE toggle; C writes it to Parent.discoverable
}
export interface UpdatePresenceRes { ok: true; encounters: { id: ID; peerId: ID }[]; fallback: ID[] }
export interface ListNearbyReq { parentId: ID }
export interface NearbyParent {
  parentId: ID; name: string; sprite: string; pet: string; band: Band;
  bearingDeg: number;                // rounded to 5°
  distanceM?: number;                // demo only (both sides simulated), rounded to 5 m — A's "WALKING… 85 M"
}
export interface ListNearbyRes { me: { accuracyM: number; simulated: boolean; fresh: boolean } | null; nearby: NearbyParent[] }
export interface DemoWalkReq { parentId: ID; targetParentId: ID; stepM?: number; reset?: boolean }
export interface DemoWalkRes { ok: true; distanceM: number; encounters: { id: ID; peerId: ID }[]; fallback: ID[] }

/** Public card for a trade party: never phone, Photon ids, convo or ASI address (approved by Caesar, 00:10). */
export type PublicParty = Pick<Parent, "id" | "name" | "avatar" | "pet">;
export interface GetPartiesReq { parentIds: ID[] }   // ≤ 10 ids; unknown ids are skipped, not an error
export interface PayProposalRes { proposal: MatchProposal; item: ClothingItem }

export interface DemoClockReq { now?: ISODate }            // omit to read
export interface DemoClockRes { now: ISODate; nudgesCreated: number }

export interface RelayStats {
  secondsToList: number[];           // per listing: listing.createdAt − nudge.createdAt (demo clock)
  encounters: number; proposals: number; trades: number;
  declinedWithZeroCharge: number;
  items: { itemId: ID; name: string; icon: string; ownerCount: number; chain: { ownerName: string; from: ISODate; to?: ISODate; priceCents?: number }[] }[];
}

export interface SelfTestRes { results: { name: string; pass: boolean; detail?: string }[]; passed: number; failed: number }

// Standard error body from every function: { error: { code: string, message: string } }
export type ErrorCode =
  | "bad_request" | "not_found" | "forbidden" | "invalid_transition" | "not_resellable"
  | "not_eligible" | "already_open" | "expired" | "payment_failed" | "internal";

export type EntityName =
  | "Parent" | "Child" | "ClothingItem" | "Listing" | "Need" | "Presence" | "Encounter"
  | "MatchProposal" | "AgentNudge" | "AgentInbox" | "Setting";
