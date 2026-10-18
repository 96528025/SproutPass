// base44/functions/upsertNeed/entry.ts
import { wrap } from "../../shared/http.ts";
import { upsertNeed, withRetry } from "../../shared/logic/closet.ts";
import type { UpsertNeedReq } from "../../shared/types.ts";
export default wrap((db, body: UpsertNeedReq) => upsertNeed(withRetry(db), body));
