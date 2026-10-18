// base44/functions/withdrawListing/entry.ts
import { wrap } from "../../shared/http.ts";
import { withdrawListing, withRetry } from "../../shared/logic/closet.ts";
import type { WithdrawListingReq } from "../../shared/types.ts";
export default wrap((db, body: WithdrawListingReq) => withdrawListing(withRetry(db), body));
