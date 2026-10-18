// base44/functions/getStats/entry.ts
import { wrap } from "../../shared/http.ts";
import { withRetry } from "../../shared/logic/closet.ts";
import { getStats } from "../../shared/logic/demo.ts";
export default wrap((db) => getStats(withRetry(db)));
