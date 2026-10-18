import { wrap } from "../../shared/http.ts";
import { withRetry } from "../../shared/logic/closet.ts";
import { createProposal } from "../../shared/logic/trade.ts";
import type { CreateProposalReq } from "../../shared/types.ts";
export default wrap((db, body: CreateProposalReq) => createProposal(withRetry(db), body), { agentOnly: true });
