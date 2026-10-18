import { withRetry } from "../../shared/logic/closet.ts";
import { wrap } from "../../shared/http.ts";
import { prepareTrial } from "../../shared/prepareTrial.ts";
import { sendEventTexts } from "../../shared/c/inboxFallback.ts";
export default wrap(async (raw, body: { makeOffer?: boolean }) => {
  const db = withRetry(raw);
  const result = await prepareTrial(db, body.makeOffer === true);
  if (body.makeOffer === true) await sendEventTexts(db);
  return result;
});
