// FROZEN INTERFACE — every screen talks to the backend only through `api`.
// B4 owns this file and api.real.ts / api.mock.ts. B5, A and C import `api` and never call Base44 directly.
import type {
  ClosetView, Condition, DemoClockReq, DemoClockRes, DecideProposalReq, EntityName, ListItemReq, Listing,
  MatchProposal, Need, ParentRef, PayProposalReq, PayProposalRes, RecordPurchaseReq, RelayStats,
  ResolveNudgeReq, ResolveNudgeRes, SelfTestRes, UpsertNeedReq, WithdrawListingReq, ClothingItem,
  GetPartiesReq, PublicParty, UpdatePresenceReq, UpdatePresenceRes, ListNearbyReq, ListNearbyRes, DemoWalkReq,
  DemoWalkRes, TrustView, SetMandateReq, PetMandate, PasskeyOptionsReq, PasskeyVerifyReq, AnalyzeItemPhotoReq,
  ItemPhotoGuess, ImpactView,
} from "./types";
import { mockApi } from "./api.mock";
import { realApi } from "./api.real";

export type Unsubscribe = () => void;
export interface EntityEvent<T> { type: "create" | "update" | "delete"; id: string; data: T }

/** Error thrown by every api call on a non-2xx: mirrors the functions' { error: { code, message } }. */
export class ApiError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export interface Api {
  // B2 — closet
  getCloset(ref: ParentRef): Promise<ClosetView>;
  recordPurchase(req: RecordPurchaseReq): Promise<ClothingItem>;
  listItem(req: ListItemReq): Promise<Listing>;
  withdrawListing(req: WithdrawListingReq): Promise<Listing>;
  upsertNeed(req: UpsertNeedReq): Promise<Need>;
  resolveNudge(req: ResolveNudgeReq): Promise<ResolveNudgeRes>;
  // B3 — trade
  decideProposal(req: DecideProposalReq): Promise<MatchProposal>;
  payProposal(req: PayProposalReq): Promise<PayProposalRes>;
  /** Public name/avatar/pet for trade parties (≤ 10 ids; unknown ids are skipped). Added with Caesar's OK. */
  getParties(req: GetPartiesReq): Promise<PublicParty[]>;
  // B1 — demo + stats
  demoClock(req?: DemoClockReq): Promise<DemoClockRes>;
  demoReset(): Promise<{ ok: true }>;
  getStats(): Promise<RelayStats>;
  selfTest(): Promise<SelfTestRes>;
  // C — frontend-callable helper (C writes the function; B4 wires it)
  suggestCondition(req: { imageUrl: string }): Promise<{ condition?: Condition; note?: string }>;
  // C — location, for A's /world (added with Caesar's OK, 00:30)
  updatePresence(req: UpdatePresenceReq): Promise<UpdatePresenceRes>;
  listNearby(req: ListNearbyReq): Promise<ListNearbyRes>;
  demoWalk(req: DemoWalkReq): Promise<DemoWalkRes>;
  // Trusted checkout (Visa track): the pet's spending rules + passkey (Face ID) approval of payments.
  // WebAuthn options/responses are the JSON shapes of @simplewebauthn (PublicKeyCredential*OptionsJSON / *ResponseJSON).
  getTrust(ref: ParentRef): Promise<TrustView>;
  setMandate(req: SetMandateReq): Promise<PetMandate>;
  passkeyRegisterOptions(req: PasskeyOptionsReq): Promise<Record<string, unknown>>;
  passkeyRegisterVerify(req: PasskeyVerifyReq): Promise<{ ok: true; passkeys: TrustView["passkeys"] }>;
  passkeyAuthOptions(req: PasskeyOptionsReq): Promise<Record<string, unknown>>;
  // AI snap-to-list: a photo of the item (or its tag) → what the AI thinks it is.
  analyzeItemPhoto(req: AnalyzeItemPhotoReq): Promise<ItemPhotoGuess>;
  // Impact + rewards for everyone (and `me` when a parent is given).
  getImpact(ref?: ParentRef): Promise<ImpactView>;
  // Base44 platform
  uploadPhoto(file: File): Promise<{ url: string }>;
  subscribe<T = unknown>(entity: EntityName, cb: (e: EntityEvent<T>) => void): Unsubscribe;
}

export const USE_MOCK = import.meta.env.VITE_USE_MOCK === "1";
export const api: Api = USE_MOCK ? mockApi : realApi;
