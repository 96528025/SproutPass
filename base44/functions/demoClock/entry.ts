// base44/functions/demoClock/entry.ts
import { wrap } from "../../shared/http.ts";
import { withRetry } from "../../shared/logic/closet.ts";
import { demoClock } from "../../shared/logic/demo.ts";
export default wrap((db, body) => demoClock(withRetry(db), body));
