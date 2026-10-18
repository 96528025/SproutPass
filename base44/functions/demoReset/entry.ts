import { wrap } from "../../shared/http.ts";
import { secrets } from "base44:runtime";
import { withRetry } from "../../shared/logic/closet.ts";
import { demoReset } from "../../shared/logic/demo.ts";
const k = ["MINA_PHONE","JO_PHONE","SAM_PHONE","MINA_AGENT","JO_AGENT","SAM_AGENT"] as const;
const get = (n: string) => { try { return secrets.get(n) ?? undefined; } catch { return undefined; } };  // secrets may be unset
export default wrap((db) => demoReset(withRetry(db), Object.fromEntries(k.map((n) => [n, get(n)]))));
