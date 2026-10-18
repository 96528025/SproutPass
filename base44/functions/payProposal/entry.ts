import { wrap } from "../../shared/http.ts";
import { withRetry } from "../../shared/logic/closet.ts";
import { payProposal } from "../../shared/logic/trade.ts";
import type { PayProposalReq } from "../../shared/types.ts";
export default wrap((db, body: PayProposalReq) => payProposal(withRetry(db), body, { delayMs: 1000 }));
