// base44/functions/recordPurchase/entry.ts
import { wrap } from "../../shared/http.ts";
import { recordPurchase, withRetry } from "../../shared/logic/closet.ts";
import type { RecordPurchaseReq } from "../../shared/types.ts";
export default wrap((db, body: RecordPurchaseReq) => recordPurchase(withRetry(db), body));
