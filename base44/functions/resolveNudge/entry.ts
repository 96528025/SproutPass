// base44/functions/resolveNudge/entry.ts
import { wrap } from "../../shared/http.ts";
import { resolveNudge, withRetry } from "../../shared/logic/closet.ts";
export default wrap((db, body) => resolveNudge(withRetry(db), body));
