// base44/functions/resolveNudge/entry.ts
import { wrap } from "../../shared/http.ts";
import { resolveNudge, withRetry } from "../../shared/logic/closet.ts";
import type { ResolveNudgeReq } from "../../shared/types.ts";
export default wrap((db, body: ResolveNudgeReq) => resolveNudge(withRetry(db), body));
