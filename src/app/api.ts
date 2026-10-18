// FROZEN INTERFACE — every screen talks to the backend only through `api`.
// B4 owns this file and api.real.ts / api.mock.ts. B5, A and C import `api` and never call Base44 directly.
import type {
  ClosetView, Condition, DemoClockReq, DemoClockRes, DecideProposalReq, EntityName, ListItemReq, Listing,
  MatchProposal, Need, ParentRef, PayProposalReq, PayProposalRes, RecordPurchaseReq, RelayStats,
  ResolveNudgeReq, ResolveNudgeRes, SelfTestRes, UpsertNeedReq, WithdrawListingReq, ClothingItem,
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
  // B1 — demo + stats
  demoClock(req?: DemoClockReq): Promise<DemoClockRes>;
  demoReset(): Promise<{ ok: true }>;
  getStats(): Promise<RelayStats>;
  selfTest(): Promise<SelfTestRes>;
  // C — frontend-callable helper (C writes the function; B4 wires it)
  suggestCondition(req: { imageUrl: string }): Promise<{ condition?: Condition; note?: string }>;
  // Base44 platform
  uploadPhoto(file: File): Promise<{ url: string }>;
  subscribe<T = unknown>(entity: EntityName, cb: (e: EntityEvent<T>) => void): Unsubscribe;
}

export const USE_MOCK = import.meta.env.VITE_USE_MOCK === "1";
export const api: Api = USE_MOCK ? mockApi : realApi;
