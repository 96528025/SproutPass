// base44/functions/listItem/entry.ts
import { wrap } from "../../shared/http.ts";
import { listItem, withRetry } from "../../shared/logic/closet.ts";
import type { ListItemReq } from "../../shared/types.ts";
export default wrap((db, body: ListItemReq) => listItem(withRetry(db), body));
