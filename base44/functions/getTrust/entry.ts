// OWNER: B5. The parent's pet rules (mandate), what they spent this demo-clock month and their saved passkeys
// (label + date only: credential ids and public keys never leave the server). Honest limit: the demo has no sign-in
// (?as=jo picks a parent, see shared/c/auth.ts), so whoever names a parent can read that parent's rules here. Binding
// this to a signed-in person is the next step; not_eligible reasons never carry amounts either way.
import { wrap } from "../../shared/http.ts";
import { withRetry } from "../../shared/logic/closet.ts";
import { getTrust } from "../../shared/logic/trust.ts";
import type { ParentRef } from "../../shared/types.ts";
export default wrap((db, body: ParentRef) => getTrust(withRetry(db), body ?? {}));
