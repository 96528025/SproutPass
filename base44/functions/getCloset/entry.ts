// base44/functions/getCloset/entry.ts
import { wrap } from "../../shared/http.ts";
import { getCloset, withRetry } from "../../shared/logic/closet.ts";
export default wrap((db, body) => getCloset(withRetry(db), body));
