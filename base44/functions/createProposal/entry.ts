import { wrap } from "../../shared/http.ts";
import { withRetry } from "../../shared/logic/closet.ts";
import { createProposal } from "../../shared/logic/trade.ts";
import type { CreateProposalReq } from "../../shared/types.ts";
import { sendEventTexts } from "../../shared/c/inboxFallback.ts";
export default wrap(async (raw, body: CreateProposalReq) => {
  const db = withRetry(raw);
  const proposal = await createProposal(db, body);
  await sendEventTexts(db);
  return proposal;
}, { agentOnly: true });
