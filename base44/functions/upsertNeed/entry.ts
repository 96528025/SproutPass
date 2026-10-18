// base44/functions/upsertNeed/entry.ts
import { wrap } from "../../shared/http.ts";
import { upsertNeed, withRetry } from "../../shared/logic/closet.ts";
export default wrap((db, body) => upsertNeed(withRetry(db), body));
