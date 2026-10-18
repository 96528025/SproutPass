// OWNER: B3. Handlers for trade functions. Pure TS (see closet.ts header).
import type { Db } from "../db.ts";
import type { CreateProposalReq, DecideProposalReq, MatchProposal, PayProposalReq, PayProposalRes } from "../types.ts";

const todo = (n: string): never => { throw new Error(`${n}: TODO(B3)`); };

export async function createProposal(_db: Db, _body: CreateProposalReq): Promise<MatchProposal> { return todo("createProposal"); }
export async function decideProposal(_db: Db, _body: DecideProposalReq): Promise<MatchProposal> { return todo("decideProposal"); }
/** opts.delayMs: 1000 in production, 0 in tests/selfTest. */
export async function payProposal(_db: Db, _body: PayProposalReq, _opts: { delayMs?: number } = {}): Promise<PayProposalRes> {
  return todo("payProposal");
}
