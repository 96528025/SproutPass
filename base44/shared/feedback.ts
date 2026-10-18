import { bad } from "./errors.ts";
export function feedbackInput(body: Record<string, unknown>) {
  const text = (key: string, required = false) => {
    const v = typeof body[key] === "string" ? body[key].trim() : "";
    if (v.length > 1500 || (required && !v)) throw bad(`Please complete ${key} (up to 1,500 characters).`);
    return v;
  };
  const choice = (key: string, choices: string[]) => {
    const v = text(key, true); if (!choices.includes(v)) throw bad(`Invalid ${key}.`); return v;
  };
  const requestId = text("requestId", true);
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) throw bad("Invalid feedback identifier.");
  return {
    requestId,
    role: choice("role", ["parent_caregiver", "teammate", "other"]),
    outcome: choice("outcome", ["unaided", "needed_help", "could_not_finish", "not_tried"]),
    useful: choice("useful", ["yes", "maybe", "no"]),
    currentProcess: text("currentProcess", true), confusing: text("confusing"), improvement: text("improvement", true),
    quoteConsent: body.quoteConsent === true,
  };
}
