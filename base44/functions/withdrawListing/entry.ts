// base44/functions/withdrawListing/entry.ts
import { wrap } from "../../shared/http.ts";
import { withdrawListing, withRetry } from "../../shared/logic/closet.ts";
export default wrap((db, body) => withdrawListing(withRetry(db), body));
