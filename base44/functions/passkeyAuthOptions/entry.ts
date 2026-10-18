// OWNER: B5. Approving a payment with Face ID, step 1: WebAuthn request options for { proposalId }. The challenge is
// single use, expires in 5 min and commits to this trade and its price (trust.ts paymentChallenge). Step 2 is
// payProposal with body.passkey.
// Type-check: npx -y deno@2 check --no-lock --node-modules-dir=none base44/functions/passkeyAuthOptions/entry.ts
// (--node-modules-dir=none: the repo's package.json puts Deno in node_modules mode, and @simplewebauthn/server is a
// Deno-only import that isn't in node_modules. Unverified: that Base44's deploy bundles it as is; check on first deploy.)
import { type AuthenticatorTransportFuture, generateAuthenticationOptions } from "npm:@simplewebauthn/server@13";
import { secrets } from "base44:runtime";
import { wrap } from "../../shared/http.ts";
import { withRetry } from "../../shared/logic/closet.ts";
import { fromB64url, relyingParty, startPaymentApproval } from "../../shared/logic/trust.ts";
import type { PasskeyOptionsReq } from "../../shared/types.ts";

/** APP_HOST (the app's own host, also used for pay links) pins the passkey relying party; see trust.ts relyingParty. */
const appHost = () => { try { return secrets.get("APP_HOST") ?? undefined; } catch { return undefined; } };

export default wrap(async (db, body: PasskeyOptionsReq, req: Request) => {
  const { rpID } = relyingParty(req.url, req.headers.get("origin"), appHost());
  const s = await startPaymentApproval(withRetry(db), body ?? {}, rpID);
  return await generateAuthenticationOptions({
    rpID,
    challenge: fromB64url(s.challenge),
    allowCredentials: s.allow.map((e) => ({ id: e.id, transports: e.transports as AuthenticatorTransportFuture[] })),
    userVerification: "required",
    timeout: 60_000,
  });
});
