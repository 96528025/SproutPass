// OWNER: B2. Handlers for closet functions. Pure TS (no npm:/base44: imports) so tests, selfTest and the
// frontend mock can run them on fakeDb. Each Base44 function's entry.ts is: export default wrap(handler).
import type { Db } from "../db.ts";
import type {
  ClosetView, ClothingItem, Listing, ListItemReq, Need, ParentRef, RecordPurchaseReq, ResolveNudgeReq,
  ResolveNudgeRes, UpsertNeedReq, WithdrawListingReq,
} from "../types.ts";

const todo = (n: string): never => { throw new Error(`${n}: TODO(B2)`); };

export async function getCloset(_db: Db, _body: ParentRef): Promise<ClosetView> { return todo("getCloset"); }
export async function recordPurchase(_db: Db, _body: RecordPurchaseReq): Promise<ClothingItem> { return todo("recordPurchase"); }
export async function listItem(_db: Db, _body: ListItemReq): Promise<Listing> { return todo("listItem"); }
export async function withdrawListing(_db: Db, _body: WithdrawListingReq): Promise<Listing> { return todo("withdrawListing"); }
export async function upsertNeed(_db: Db, _body: UpsertNeedReq): Promise<Need> { return todo("upsertNeed"); }
export async function resolveNudge(_db: Db, _body: ResolveNudgeReq): Promise<ResolveNudgeRes> { return todo("resolveNudge"); }
