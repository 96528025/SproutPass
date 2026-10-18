// base44/functions/listItem/entry.ts
import { wrap } from "../../shared/http.ts";
import { listItem, withRetry } from "../../shared/logic/closet.ts";
import type { ListItemReq } from "../../shared/types.ts";
import { sendEventTexts } from "../../shared/c/inboxFallback.ts";
// After the action, send the pet texts it caused right away (accepted / paid + flowers GIF / nudges); best effort.
export default wrap(async (raw, body: ListItemReq) => {
  const db = withRetry(raw);
  const r = await listItem(db, body);
  await sendEventTexts(db);
  return r;
});
