// OWNER: B5. Passkey registration, step 2: verify the attestation against the stored challenge (used once), then
// save the credential id, public key, counter and transports on Parent.passkeys (admin-only). Returns labels only.
// Type-check: npx -y deno@2 check --no-lock --node-modules-dir=none base44/functions/passkeyRegisterVerify/entry.ts
// (--node-modules-dir=none: the repo's package.json puts Deno in node_modules mode, and @simplewebauthn/server is a
// Deno-only import that isn't in node_modules. Unverified: that Base44's deploy bundles it as is; check on first deploy.)
import { type RegistrationResponseJSON, verifyRegistrationResponse } from "npm:@simplewebauthn/server@13";
import { secrets } from "base44:runtime";
import { wrap } from "../../shared/http.ts";
import { forbidden } from "../../shared/errors.ts";
import { withRetry } from "../../shared/logic/closet.ts";
import { b64url, finishPasskeyRegistration, relyingParty } from "../../shared/logic/trust.ts";
import type { PasskeyVerifyReq } from "../../shared/types.ts";

/** APP_HOST (the app's own host, also used for pay links) pins the passkey relying party; see trust.ts relyingParty. */
const appHost = () => { try { return secrets.get("APP_HOST") ?? undefined; } catch { return undefined; } };

const NOT_VERIFIED = "That passkey couldn't be verified. Please try again.";

export default wrap(async (db, body: PasskeyVerifyReq, req: Request) => {
  const { rpID, origin } = relyingParty(req.url, req.headers.get("origin"), appHost());
  return await finishPasskeyRegistration(withRetry(db), body ?? ({} as PasskeyVerifyReq), async (expectedChallenge) => {
    let result;
    try {
      result = await verifyRegistrationResponse({
        response: body.response as unknown as RegistrationResponseJSON,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
    } catch (e) {
      console.error("[B5] passkey registration not verified:", e instanceof Error ? e.message : e);
      throw forbidden(NOT_VERIFIED);
    }
    if (!result.verified) throw forbidden(NOT_VERIFIED);
    const c = result.registrationInfo.credential;
    return { credentialId: c.id, publicKey: b64url(c.publicKey), counter: c.counter, transports: c.transports ?? [], rpID };
  });
});
