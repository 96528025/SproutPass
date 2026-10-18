import { withRetry } from "../../shared/logic/closet.ts";
import { wrap } from "../../shared/http.ts";
import { trialStatus } from "../../shared/trial.ts";
export default wrap(async (db, body: { itemId?: string }) => trialStatus(withRetry(db), typeof body.itemId === "string" ? body.itemId.slice(0, 100) : undefined));
