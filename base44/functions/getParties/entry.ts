import { wrap } from "../../shared/http.ts";
import { withRetry } from "../../shared/logic/closet.ts";
import { getParties } from "../../shared/logic/trade.ts";
import type { GetPartiesReq } from "../../shared/types.ts";
export default wrap((db, body: GetPartiesReq) => getParties(withRetry(db), body));
