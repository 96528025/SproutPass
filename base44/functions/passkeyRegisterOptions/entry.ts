// OWNER: B5. Passkey (Face ID / Touch ID) registration, step 1: WebAuthn creation options with a single-use
// challenge stored on the Parent (5 min). rpID = the app's hostname: APP_HOST, else the page (trust.ts relyingParty).
// Type-check: npx -y deno@2 check --no-lock --node-modules-dir=none base44/functions/passkeyRegisterOptions/entry.ts
// (--node-modules-dir=none: the repo's package.json puts Deno in node_modules mode, and @simplewebauthn/server is a
// Deno-only import that isn't in node_modules. Unverified: that Base44's deploy bundles it as is; check on first deploy.)
import { type AuthenticatorTransportFuture, generateRegistrationOptions } from "npm:@simplewebauthn/server@13";
import { secrets } from "base44:runtime";
import { wrap } from "../../shared/http.ts";
import { withRetry } from "../../shared/logic/closet.ts";
import { fromB64url, relyingParty, RP_NAME, startPasskeyRegistration } from "../../shared/logic/trust.ts";
import type { PasskeyOptionsReq } from "../../shared/types.ts";

/** APP_HOST (the app's own host, also used for pay links) pins the passkey relying party; see trust.ts relyingParty. */
const appHost = () => { try { return secrets.get("APP_HOST") ?? undefined; } catch { return undefined; } };

export default wrap(async (db, body: PasskeyOptionsReq, req: Request) => {
  const { rpID } = relyingParty(req.url, req.headers.get("origin"), appHost());
  const s = await startPasskeyRegistration(withRetry(db), body ?? {});
  return await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: s.userName,
    userDisplayName: s.userDisplayName,
    userID: fromB64url(s.userId),
    challenge: fromB64url(s.challenge), // bytes, so options.challenge === the stored base64url challenge
    attestationType: "none",
    excludeCredentials: s.exclude.map((e) => ({ id: e.id, transports: e.transports as AuthenticatorTransportFuture[] })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
    timeout: 60_000,
  });
});
