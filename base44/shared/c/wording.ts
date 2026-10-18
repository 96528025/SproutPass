// (C) wording.ts — the pet's voice, template edition (rule 10: works without an LLM).
// Mirrors agents/wording.py; keep the two in sync so iMessage sounds the same
// whether the Python agent or the Deno fallback answered.

export const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export const PCT_BY_OWNER: Record<number, number> = { 1: 60, 2: 40 };

export function priceRule(originalPriceCents: number, ownerCount: number): string {
  const pct = PCT_BY_OWNER[ownerCount];
  if (!pct) return "This one has reached its final home.";
  const nth = ownerCount === 1 ? "2nd" : "3rd";
  return `${nth} owner pays ${pct}% of ${dollars(originalPriceCents)}`;
}

export const t = {
  hello: (pet: string) => `Hi! I'm ${pet}, your closet pet. Text "bag" to see what's in the closet, or "help".`,
  help: () => `I understand: sell · keep · later · yes · accept · decline · pay · bag · help. Short and sweet!`,
  nudge: (item: string, size: string) =>
    `The ${item} (${size}) is probably getting snug — still fit? Want to pass it on?`,
  askPhoto: (item: string) => `Great! Snap a photo of the ${item} and I'll suggest a condition.`,
  askCondition: (condition: string) => `Looks ${label(condition)} — right? Reply "yes" or tell me a different one.`,
  listed: (priceCents: number, originalPriceCents: number, ownerCount: number) =>
    `Listed at ${dollars(priceCents)} — ${priceRule(originalPriceCents, ownerCount)}.`,
  keep: () => `Keeping it! I'll check again in a couple of weeks.`,
  later: () => `No rush — I'll ask again later.`,
  proposal: (item: string, priceCents: number, originalPriceCents: number, ownerCount: number, peerPet: string) =>
    `${peerPet} and I found a match: the ${item} for ${dollars(priceCents)} (${priceRule(originalPriceCents, ownerCount)}). Nothing is charged until you both accept — reply "accept" or "decline".`,
  accepted: (other: string) => `You accepted! Waiting on ${other} now.`,
  bothAccepted: (payLink: string) => `Both of you said yes! Tap to pay (demo payment · no real charge): ${payLink}`,
  declined: () => `Declined — $0 charged, and the listing is back up.`,
  expired: () => `That trade timed out — $0 charged, and the listing is back up.`,
  paymentFailed: () => `The demo payment didn't go through — $0 charged, and the listing is back up.`,
  notYet: () => `Both of you need to accept first — nothing is charged until then.`,
  inTrade: (item: string) => `The ${item} already has a trade open — answer that one first.`,
  alreadyListed: (item: string, priceCents: number) =>
    `The ${item} is already listed at ${dollars(priceCents)}. I'll tell you when a friend's pet wants it.`,
  listFailed: (item: string) => `I couldn't list the ${item} just now — try again from the bag.`,
  busy: () => `The app is busy right now — give me a minute and try again.`,
  completed: (item: string, until: string) =>
    `Say hi to the ${item}! It should fit until ~${until}. I'll check in then.`,
  sold: (item: string, priceCents: number) => `The ${item} found its next home for ${dollars(priceCents)}. Flowers all round!`,
  noFit: () => `Nothing fits today — maybe next walk!`,
  unknown: () => `Hmm, I didn't catch that. Try "bag" or "help".`,
  finalHome: (item: string) => `The ${item} is on its 3rd owner — that's its final home, so no selling. 💛`,
  nothingDue: () => `Nothing's due to be passed on right now — text "bag" to see the closet.`,
  otherAccepted: (other: string) => `${other} accepted — your turn! Reply "accept" or "decline".`,
  noOpenProposal: () => `There's no open trade right now. Walk around — your pet will find one!`,
  bag: (lines: string[]) => lines.length ? `In the bag: ${lines.join(" · ")}` : `The bag is empty — text me when you buy something!`,
};

/* ---------- agent-to-agent transcript lines (pixel bubbles in the app) ----------
 * Same text as agents/wording.py t_*. The Python agents prefix the pet's name ("Pip: …"); C's local fallback
 * doesn't know the names, so it passes no pet and AgentBubbles labels the line from the parent id instead. */

const said = (pet: string | undefined, text: string) => (pet ? `${pet}: ${text}` : text);

export const tl = {
  hello: (pet?: string) => said(pet, `Hi! Anything on your list for your little one?`),
  /** Python says "anything" for a need with no categories; C's fallback doesn't know the need (undefined → bare). */
  lookingFor: (sizes: string[], categories?: string[], pet?: string) =>
    said(pet, `Looking for ${sizes.join("/")}${categories ? ` ${categories.length ? categories.join(" or ") : "anything"}` : ""}!`),
  have: (item: string, size: string, pet?: string) => said(pet, `I have a ${item} in ${size}.`),
  noFit: (pet?: string) => said(pet, `Nothing in my closet fits today.`),
  /** Said by the BUYER's pet (it ran B's fit for its own child). */
  fitCheck: (weeks: number | null | undefined, pet?: string) =>
    said(pet, weeks == null ? `Size looks right for my little one.` : `My little one fits it for about ${weeks} more weeks.`),
  propose: (priceCents: number, pet?: string) =>
    said(pet, `Trade proposal! ${dollars(priceCents)} — nothing is charged until you both accept.`),
  ack: (pet?: string) => said(pet, `Sounds good — over to the humans!`),
  notNeeded: (pet?: string) => said(pet, `Thanks, but that won't fit my little one.`),
  decline: (why: string, pet?: string) => said(pet, `Not this one — ${why}`),
};

export function label(condition: string): string {
  return ({ like_new: "like new", gently_used: "gently used", well_loved: "well loved" } as Record<string, string>)[condition] ?? condition;
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* ---------- intents (shared with agents/intents.py) ---------- */

export type Intent =
  | "hi" | "help" | "bag" | "sell" | "keep" | "later" | "yes" | "no"
  | "accept" | "decline" | "pay" | "condition" | "unknown";

const RULES: [Intent, RegExp][] = [
  ["accept", /\b(accept|deal|take it|i'?ll take|yes to the trade)\b/i],
  ["decline", /\b(decline|pass|no thanks|not this time|reject)\b/i],
  ["pay", /\b(pay|checkout|buy now)\b/i],
  ["sell", /\b(sell|list|pass it on|pass on|give away)\b/i],
  ["keep", /\b(keep|still fits|fits fine)\b/i],
  ["later", /\b(later|not now|remind me|tomorrow)\b/i],
  ["bag", /\b(bag|closet|inventory|what do i have)\b/i],
  ["help", /\b(help|commands|what can you do)\b/i],
  ["condition", /\b(like new|gently used|well loved)\b/i],
  ["yes", /^\s*(y|yes|yep|yeah|yup|sure|ok|okay|correct|right|👍)\s*[.!]?\s*$/i],
  ["no", /^\s*(n|no|nope|nah|wrong)\s*[.!]?\s*$/i],
  ["hi", /^\s*(hi|hello|hey|yo|hiya|good (morning|afternoon|evening))\b/i],
];

export function parseIntent(text: string): Intent {
  const s = (text ?? "").trim();
  if (!s) return "unknown";
  for (const [intent, re] of RULES) if (re.test(s)) return intent;
  return "unknown";
}

export function parseCondition(text: string): "like_new" | "gently_used" | "well_loved" | null {
  const s = (text ?? "").toLowerCase();
  if (/like[\s-]?new/.test(s)) return "like_new";
  if (/gently/.test(s)) return "gently_used";
  if (/well[\s-]?loved|worn/.test(s)) return "well_loved";
  return null;
}
