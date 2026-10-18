import { wrap } from "../../shared/http.ts";
import { withRetry } from "../../shared/logic/closet.ts";
import { decideProposal } from "../../shared/logic/trade.ts";
import type { DecideProposalReq } from "../../shared/types.ts";
export default wrap((db, body: DecideProposalReq) => decideProposal(withRetry(db), body));
