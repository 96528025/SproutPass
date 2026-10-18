// base44/functions/getImpact/entry.ts — OWNER: B9. Impact + Sprout points for everyone; `me` when a parent is given.
// Read-only and public (the projector shows it without a parent picked): it returns names, counts and points only.
import { wrap } from "../../shared/http.ts";
import { withRetry } from "../../shared/logic/closet.ts";
import { getImpact } from "../../shared/logic/impact.ts";
import type { ParentRef } from "../../shared/types.ts";
export default wrap((db, body: ParentRef) => getImpact(withRetry(db), body ?? {}));
