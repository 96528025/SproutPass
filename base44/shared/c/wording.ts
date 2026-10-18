// (C) wording.ts — the pet's voice, template edition (rule 10: works without an LLM).
// Mirrors agents/wording.py + agents/intents.py; keep them in sync (parity_test.ts runs the Python side and
// compares) so iMessage sounds the same whether the Python agent or the Deno side answered.
//
// House style for iMessage lines: warm, short (≤ 2 sentences), plain text (iMessage shows markdown raw),
// commands in quotes, and every pay surface says "demo payment · no real charge". Pure: no Deno / npm imports.

export const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export const PCT_BY_OWNER: Record<number, number> = { 1: 60, 2: 40 };

export function priceRule(originalPriceCents: number, ownerCount: number): string {
  const pct = PCT_BY_OWNER[ownerCount];
  if (!pct) return "This one has reached its final home.";
  const nth = ownerCount === 1 ? "2nd" : "3rd";
  return `${nth} owner pays ${pct}% of ${dollars(originalPriceCents)}`;
}

/** The AI's condition note, trimmed to fit one iMessage line: " (tiny stain on the cuff)" or "". */
export function noteBit(note?: string): string {
  const n = String(note ?? "").replace(/\s+/g, " ").trim().replace(/[.!]+$/, "");
  if (!n) return "";
  return ` (${n.length > 80 ? `${n.slice(0, 79).trimEnd()}…` : n})`;
}

export const t = {
  hello: (pet: string) =>
    `Hi! I'm ${pet}, your closet pet. Send me a photo or text "sell" to pass something on, or "help" for the rest.`,
  help: () =>
    `Text "sell" (or just send a photo), "bag", "status", "accept", "decline", "pay" or "stop". I never decide or pay for you: a trade needs both of you to accept, and payments happen in the app.`,
  nudge: (item: string, size: string) =>
    `The ${item} (${size}) is probably getting snug — still fit? Text "keep", or send a photo and I'll help pass it on.`,
  nudgeWhich: () => `Just to be sure: text "keep" if it still fits, or "sell" to pass it on.`,
  askPhoto: (item: string) => `Great! Send a photo of the ${item} and I'll suggest its condition and a fair price.`,
  askWhich: () => `Which one? Send a photo, or text "sell" plus its name, like "sell the romper".`,
  photoWhich: () => `Cute! I couldn't tell which item that is. Text "sell" plus its name, like "sell the romper".`,
  askCondition: (condition: string) => `Looks ${label(condition)} — right? Reply "yes" or tell me a different one.`,
  /** After a photo: the item, the AI's condition guess and the fair price (pricing.ts priceFor, the 60/40 rule). */
  quote: (item: string, condition: string, priceCents: number, originalPriceCents: number, ownerCount: number, note = "") =>
    `That's the ${item}, ${label(condition)}${noteBit(note)}. Fair price ${dollars(priceCents)} (${priceRule(originalPriceCents, ownerCount)}) — reply "yes" to list it, or tell me a different condition.`,
  pickCondition: () => `Okay — tell me "like new", "gently used" or "well loved".`,
  listed: (priceCents: number, originalPriceCents: number, ownerCount: number) =>
    `Listed at ${dollars(priceCents)} — ${priceRule(originalPriceCents, ownerCount)}.`,
  listedNow: (item: string, priceCents: number, originalPriceCents: number, ownerCount: number) =>
    `Listed! The ${item} is up for ${dollars(priceCents)} (${priceRule(originalPriceCents, ownerCount)}). I'll text you when a friend's pet wants it.`,
  cancelled: () => `Okay, I stopped there — nothing was listed.`,
  nothingToCancel: () => `Nothing's in progress. To turn down a trade, reply "decline".`,
  keep: () => `Keeping it! I'll check again in a couple of weeks.`,
  later: () => `No rush — I'll ask again later.`,
  proposal: (item: string, priceCents: number, originalPriceCents: number, ownerCount: number, peerPet: string) =>
    `${peerPet} and I found a match: the ${item} for ${dollars(priceCents)} (${priceRule(originalPriceCents, ownerCount)}). Nothing is charged until you both accept — reply "accept" or "decline".`,
  accepted: (other: string) => `You accepted! Waiting on ${other} now.`,
  bothAccepted: (payLink: string) => `Both of you said yes! Tap to pay (demo payment · no real charge): ${payLink}`,
  /**
   * Both accepted, to the buyer: never pay by text — approve in the app. "with Face ID" only when the buyer's pet
   * rules really ask for it (B5's mandate: a saved passkey or requirePasskey); otherwise it's a tap on Pay.
   */
  approveInApp: (payLink: string, faceId = false) =>
    `Both of you said yes! Approve the payment in the app${faceId ? " with Face ID" : ""} (demo payment · no real charge): ${payLink}`,
  payInApp: (payLink: string, faceId = false) =>
    `I never pay by text. Approve it in the app${faceId ? " with Face ID" : ""} (demo payment · no real charge): ${payLink}`,
  /** A text about the trade that isn't a clear answer: ask, never guess. */
  acceptOrDecline: () => `Just to be sure: reply "accept" or "decline". Nothing is charged until you both accept.`,
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
  status: (parts: string[]) =>
    parts.length ? `Here's where things stand: ${parts.join(" · ")}.` : `All quiet: nothing listed and no open trades. Send a photo to pass something on.`,
  stopped: () => `Okay, I'll stop texting. Text "start" anytime to turn me back on — your closet is still in the app.`,
  started: (pet: string) => `${pet} is back! Text "help" to see what I can do.`,
  pausedHelp: () => `I'm paused because you texted "stop". Text "start" to turn me back on.`,
  slowDown: () => `That's a lot of texts at once! Give me a minute and I'll catch up.`,
};

/** The parts of a STATUS reply (joined with " · " by t.status). */
export const st = {
  decide: (item: string, priceCents: number) => `${item} for ${dollars(priceCents)}, your turn (reply "accept" or "decline")`,
  waiting: (item: string, other: string) => `${item}, waiting on ${other}`,
  pay: (item: string) => `${item}, ready to approve in the app (text "pay" for the link)`,
  toPay: (item: string) => `${item}, waiting for the buyer to pay`,
  listed: (item: string, priceCents: number) => `${item} listed at ${dollars(priceCents)}`,
  nudge: (item: string) => `${item} may be getting snug`,
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

/* ---------- privacy: never echo a phone number ---------- */

const URL_RE = /https?:\/\/\S+/g;
// US numbers in any common format (+1 (310) 555-0100, 310.555.0100, 13105550100) and long international ones.
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b|\+\d[\d\s().-]{8,}\d|\b\d{10,15}\b/g;

/** Replace anything that looks like a phone number with "[number hidden]" (links are left alone). */
export function redactPhones(text: string): string {
  const urls: string[] = [];
  const masked = String(text ?? "").replace(URL_RE, (u) => `\u0000${urls.push(u) - 1}\u0000`);
  return masked.replace(PHONE_RE, "[number hidden]").replace(/\u0000(\d+)\u0000/g, (_, i) => urls[Number(i)]);
}

/* ---------- intents (shared with agents/intents.py) ---------- */

export type Intent =
  | "hi" | "help" | "bag" | "sell" | "keep" | "later" | "yes" | "no"
  | "accept" | "decline" | "pay" | "condition" | "status" | "stop" | "start" | "cancel" | "unknown";

// A trade decision is never guessed from a word inside a sentence: ACCEPT only matches when it is the whole text
// ("accept", "I accept", "Deal!", "I'll take it"), refusals and negations are checked BEFORE it ("no deal",
// "I don't accept", "not interested", "I'll pass on this one"), and anything else that talks about the trade
// ("is that a good deal?", "should I take it?") gets "reply accept or decline" from inboxFallback, never a decision.
const RULES: [Intent, RegExp][] = [
  // Opt-out first, so "stop" always works: the whole text with polite words around it ("STOP please", "please
  // stop", "stop it"), or a clear "stop texting me" anywhere.
  ["stop", /^\s*(?:please[\s,]+)?(?:stop|stop ?all|quit|end|opt[\s-]?out|unsubscribe)(?:[\s,]+(?:please|pls|now|thanks|thank you|thx|it|all))*\s*[.!]*\s*$|\b(?:stop (?:texting|messaging)|unsubscribe|leave me alone|don'?t (?:text|message) me)\b/i],
  ["start", /^\s*(?:please[\s,]+)?(?:start|unstop|resume|subscribe|opt[\s-]?in)(?:[\s,]+(?:please|pls|again|now|thanks|thank you))*\s*[.!]*\s*$/i],
  ["cancel", /^\s*(cancel|never ?mind|nvm|forget it)\s*[.!]*\s*$/i],
  // Refusals and negations before ACCEPT; a question ("should I decline?") is never one. "pass" declines, but
  // "pass it on" / a bare "pass on it" sells.
  ["decline", new RegExp(String.raw`^(?![\s\S]*\?)[\s\S]*?(?:` + [
    String.raw`\b(?:decline|reject)\b`,
    String.raw`\b(?:no|nah|nope)[\s,]+(?:deal|thanks|thank you|thx)\b`,
    String.raw`\bnot (?:interested|this (?:time|one)|a (?:good )?deal|for (?:me|us))\b`,
    String.raw`\b(?:don'?t|do not|can'?t|cannot|won'?t|will not|wouldn'?t|not going to|not gonna)\s+(?:want|accept|take|buy|do)\b`,
    String.raw`\bpass on (?:this|that|it) one\b`,
    String.raw`\b(?:i'?ll|i will|i'?d|we'?ll|we will|gonna|going to)\s+pass\b(?!\s+(?:it|them|this|that)\s+on\b)`,
    String.raw`\bpass\b(?!\s+(?:(?:it|them|this|that)\s+)?on\b)`,
  ].join("|") + ")", "i")],
  // Only an explicit, whole-text yes to the trade.
  ["accept", /^\s*(?:(?:yes|yep|yeah|ok|okay|sure)[\s,!]+)?(?:i\s+)?(?:accept(?:ed)?(?:\s+(?:it|this|that|the (?:trade|deal|offer)))?|deal|it'?s a deal|i'?ll take it|we'?ll take it|yes to the trade)(?:[\s,]+(?:please|thanks|thank you|thx))?(?:\s*(?:[.!]|👍))*\s*$/i],
  ["pay", /\b(pay|checkout|buy now)\b/i],
  ["sell", /\b(sell|list|pass it on|pass on|give away)\b/i],
  ["keep", /\b(keep|still fits|fits fine)\b/i],
  ["later", /\b(later|not now|remind me|tomorrow)\b/i],
  ["bag", /\b(bag|closet|inventory|what do i have)\b/i],
  ["status", /\b(status|where are we|what'?s (new|happening|going on)|any (news|updates?)|updates?)\b/i],
  ["help", /\b(help|commands|what can you do)\b/i],
  ["condition", /\b(like new|gently used|well loved)\b/i],
  ["yes", /^\s*(?:y|yes|yep|yeah|yup|sure|ok|okay|correct|right|👍)(?:[\s,]+(?:please|pls))?(?:\s*(?:[.!]|👍))*\s*$/i],
  ["no", /^\s*(?:n|no|nope|nah|wrong)\s*[.!]*\s*$/i],
  ["hi", /^\s*(hi|hello|hey|yo|hiya|good (morning|afternoon|evening))\b/i],
];

/** iPhones type curly apostrophes ("I’ll pass", "don’t accept"): read them as straight ones. */
const plain = (text: string) => String(text ?? "").replace(/[‘’ʼ]/g, "'").trim();

export function parseIntent(text: string): Intent {
  const s = plain(text);
  if (!s) return "unknown";
  for (const [intent, re] of RULES) if (re.test(s)) return intent;
  return "unknown";
}

/**
 * True when an accept / decline is the trade command itself ("accept", "I decline", "reject", "yes to the trade"),
 * so it answers the open proposal whatever was asked last. Softer ones ("Deal!", "no thanks", "I'll pass") answer
 * the newest question instead: after a selling quote, "no thanks" stops the listing, it doesn't decline a trade.
 */
export function isTradeCommand(text: string): boolean {
  return /^\s*(?:(?:yes|ok|okay)[\s,!]+)?(?:i\s+)?(?:accept|decline|reject)\b|\byes to the trade\b/i.test(plain(text));
}

/** Talks about the trade without deciding it ("is that a good deal?", "should I take it?"). */
export function mentionsTrade(text: string): boolean {
  return /\b(?:accept|decline|reject|deal|take it|trade|offer|pass)\b/i.test(plain(text));
}

export function parseCondition(text: string): "like_new" | "gently_used" | "well_loved" | null {
  const s = (text ?? "").toLowerCase();
  if (/like[\s-]?new/.test(s)) return "like_new";
  if (/gently/.test(s)) return "gently_used";
  if (/well[\s-]?loved|worn/.test(s)) return "well_loved";
  return null;
}
