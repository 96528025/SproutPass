import { wrap } from "../../shared/http.ts";
import { withRetry } from "../../shared/logic/closet.ts";
import { decideProposal } from "../../shared/logic/trade.ts";
import type { DecideProposalReq } from "../../shared/types.ts";
import { sendEventTexts } from "../../shared/c/inboxFallback.ts";
// After the action, send the pet texts it caused right away (accepted / paid + flowers GIF / nudges); best effort.
export default wrap(async (raw, body: DecideProposalReq) => {
  const db = withRetry(raw);
  const r = await decideProposal(db, body);
  await sendEventTexts(db);
  return r;
});
