// OWNER: B5. Pay for a trade both parents accepted (DEMO payment: nothing is charged). When the buyer's rules need
// Face ID, the passkey assertion in body.passkey is verified here first (see below).
// Type-check: npx -y deno@2 check --no-lock --node-modules-dir=none base44/functions/payProposal/entry.ts
// (--node-modules-dir=none: the repo's package.json puts Deno in node_modules mode, and @simplewebauthn/server is a
// Deno-only import that isn't in node_modules. Unverified: that Base44's deploy bundles it as is; check on first deploy.)
import { type AuthenticationResponseJSON, type AuthenticatorTransportFuture, verifyAuthenticationResponse } from "npm:@simplewebauthn/server@13";
import { secrets } from "base44:runtime";
import { wrap } from "../../shared/http.ts";
import { forbidden } from "../../shared/errors.ts";
import { withRetry } from "../../shared/logic/closet.ts";
import { payProposal } from "../../shared/logic/trade.ts";
import { approvePayment, fromB64url, relyingParty } from "../../shared/logic/trust.ts";
import type { PayProposalReq } from "../../shared/types.ts";
import { sendEventTexts } from "../../shared/c/inboxFallback.ts";

/** APP_HOST (the app's own host, also used for pay links) pins the passkey relying party; see trust.ts relyingParty. */
const appHost = () => { try { return secrets.get("APP_HOST") ?? undefined; } catch { return undefined; } };

const NOT_APPROVED = "Face ID approval didn't go through. Nothing was charged. Please try again.";

// When the buyer's mandate needs Face ID approval, body.passkey (a WebAuthn assertion over the challenge from
// passkeyAuthOptions) is verified HERE, and only then does payProposal get opts.passkeyApprovedFor. A client can't set it.
export default wrap(async (raw, body: PayProposalReq, req: Request) => {
  const db = withRetry(raw);
  const approvedFor = await approvePayment(db, body ?? ({} as PayProposalReq), async ({ challenge, passkey }) => {
    if (passkey.mock || !passkey.publicKey) throw forbidden("That passkey can't approve payments here.");
    const { origin } = relyingParty(req.url, req.headers.get("origin"), appHost());
    let result;
    try {
      result = await verifyAuthenticationResponse({
        response: body.passkey as unknown as AuthenticationResponseJSON,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: passkey.rpID,
        credential: {
          id: passkey.credentialId,
          publicKey: fromB64url(passkey.publicKey),
          counter: passkey.counter,
          transports: passkey.transports as AuthenticatorTransportFuture[],
        },
        requireUserVerification: true,
      });
    } catch (e) {
      console.error("[B5] payment approval not verified:", e instanceof Error ? e.message : e);
      throw forbidden(NOT_APPROVED);
    }
    if (!result.verified) throw forbidden(NOT_APPROVED);
    return { newCounter: result.authenticationInfo.newCounter };
  });
  const r = await payProposal(db, body, { delayMs: 1000, passkeyApprovedFor: approvedFor });
  await sendEventTexts(db); // "paid" + the flowers GIF to both parents now, not on the next tick
  return r;
});
