// base44/functions/getCloset/entry.ts
import { wrap } from "../../shared/http.ts";
import { getCloset, withRetry } from "../../shared/logic/closet.ts";
import type { ParentRef } from "../../shared/types.ts";
export default wrap((db, body: ParentRef) => getCloset(withRetry(db), body));
