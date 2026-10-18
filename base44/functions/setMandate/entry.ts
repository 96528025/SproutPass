// OWNER: B5. Change what the parent's pet may do on their behalf. Validated in trust.ts; createProposal and
// payProposal enforce it on the server.
import { wrap } from "../../shared/http.ts";
import { withRetry } from "../../shared/logic/closet.ts";
import { setMandate } from "../../shared/logic/trust.ts";
import type { SetMandateReq } from "../../shared/types.ts";
export default wrap((db, body: SetMandateReq) => setMandate(withRetry(db), body));
