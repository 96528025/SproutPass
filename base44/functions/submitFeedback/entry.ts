import { withRetry } from "../../shared/logic/closet.ts";
import { wrap } from "../../shared/http.ts";
import { feedbackInput } from "../../shared/feedback.ts";
export default wrap(async (raw, body: Record<string, unknown>) => {
  const db = withRetry(raw);
  const input = feedbackInput(body);
  const [existing] = await db.UserFeedback.filter({ requestId: input.requestId });
  if (existing) return { ok: true, id: existing.id };
  const row = await db.UserFeedback.create({ ...input, createdAt: new Date().toISOString() });
  return { ok: true, id: row.id };
});
