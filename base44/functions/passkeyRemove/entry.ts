// OWNER: B5. Forget one saved passkey, by the opaque id getTrust lists (credential ids never leave the server).
// Removing the last one turns Face ID approval off. Returns the parent's TrustView. Like every door in this anonymous
// demo (?as=jo), it isn't bound to a signed-in person (see shared/c/auth.ts).
import { wrap } from "../../shared/http.ts";
import { withRetry } from "../../shared/logic/closet.ts";
import { removePasskey } from "../../shared/logic/trust.ts";
import type { PasskeyRemoveReq } from "../../shared/types.ts";
export default wrap((db, body: PasskeyRemoveReq) => removePasskey(withRetry(db), body ?? ({} as PasskeyRemoveReq)));
