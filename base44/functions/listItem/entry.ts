// base44/functions/listItem/entry.ts
import { wrap } from "../../shared/http.ts";
import { listItem, withRetry } from "../../shared/logic/closet.ts";
export default wrap((db, body) => listItem(withRetry(db), body));
