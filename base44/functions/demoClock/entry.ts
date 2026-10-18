// base44/functions/demoClock/entry.ts
import { wrap } from "../../shared/http.ts";
import { withRetry } from "../../shared/logic/closet.ts";
import { demoClock } from "../../shared/logic/demo.ts";
import type { DemoClockReq } from "../../shared/types.ts";
import { sendEventTexts } from "../../shared/c/inboxFallback.ts";
// After the action, send the pet texts it caused right away (accepted / paid + flowers GIF / nudges); best effort.
export default wrap(async (raw, body: DemoClockReq) => {
  const db = withRetry(raw);
  const r = await demoClock(db, body);
  await sendEventTexts(db);
  return r;
});
