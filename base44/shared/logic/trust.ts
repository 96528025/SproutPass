// OWNER: B5 (trusted checkout). Pure TS: no npm:/base44: imports, so vitest, the frontend mock and the Deno
// entry files all run the same rules.
//
// What lives here:
//   - PetMandate: what a parent's pet agent may do on their behalf (propose at all, price limit, monthly budget,
//     categories, Face ID approval). createProposal (trade.ts) enforces the BUYER's mandate on the server.
//   - getTrust / setMandate: the parent's view of those rules and how much they spent this month.
//   - Passkey (WebAuthn) bookkeeping: single-use challenges stored on the Parent (5 min, bound to one trade and its
//     price), stored credentials (never returned to clients; at most 5, the newest replaces the oldest; removable),
//     the approval step payProposal's entry runs, and trustReset() for demoReset (shared demo parents start clean).
// The signature checks themselves live in the Deno entry files (npm:@simplewebauthn/server@13). The MOCK section at the
// bottom is the localhost stand-in: it checks the challenge and credential id but NOT the signature.
import type { Db } from "../db.ts";
import { getNow, mustGet, resolveParent } from "../db.ts";
import { bad, forbidden, HttpError, invalid } from "../errors.ts";
import type {
  Category, ID, ISODate, MatchProposal, Parent, ParentRef, PasskeyOptionsReq, PasskeyRemoveReq, PasskeyVerifyReq, PayProposalReq,
  PetMandate, ProposalStatus, SetMandateReq, TrustView,
} from "../types.ts";

export const CATEGORIES: Category[] = ["top", "bottom", "onesie", "outerwear", "dress", "set", "other"];
export const RP_NAME = "Hand-Me-Down Relay";
export const CHALLENGE_TTL_MS = 5 * 60_000;
/** Saved passkeys per parent. Adding one more replaces the oldest, so "add this device" always works. */
export const MAX_PASSKEYS = 5;
export const LIMITS = { maxPriceCents: 100_000, monthlyBudgetCents: 500_000 } as const;
const LIVE: ProposalStatus[] = ["open", "both_accepted"];
const TRANSPORTS = ["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"];
const MANDATE_KEYS: (keyof PetMandate)[] = ["maxPriceCents", "monthlyBudgetCents", "categories", "requirePasskey", "agentMayPropose"];

// ---------------------------------------------------------------- stored shapes (server-only Parent fields)

/** One WebAuthn credential on Parent.passkeys. Admin-only RLS; clients only ever see passkeyViews(). */
export interface StoredPasskey {
  key: string;                       // our own opaque id: the only id clients see
  credentialId: string;              // base64url WebAuthn credential id
  publicKey: string;                 // base64url COSE public key ("" for a mock passkey)
  counter: number;                   // signature counter (clone detection)
  transports: string[];
  label: string;
  createdAt: ISODate;                // real time
  rpID: string;                      // the site it was made for; assertions must come from the same one
  mock?: true;                       // made by the localhost mock, signature never checked
}

/** Parent.passkeyChallenge: the one live challenge (admin-only RLS). Cleared on first use. */
export interface StoredChallenge {
  challenge: string;                 // base64url
  purpose: "register" | "pay";
  proposalId?: ID;                   // "pay": the trade it approves
  expiresAt: ISODate;                // real time, issue + 5 min
}

type ParentRow = Parent & { passkeyChallenge?: Partial<StoredChallenge> | null };

function isStoredPasskey(v: unknown): v is StoredPasskey {
  const k = v as StoredPasskey | null;
  return !!k && typeof k === "object" && typeof k.key === "string" && typeof k.credentialId === "string";
}

export function passkeysOf(parent: Pick<Parent, "passkeys">): StoredPasskey[] {
  return Array.isArray(parent.passkeys) ? parent.passkeys.filter(isStoredPasskey) : [];
}

export const hasPasskeys = (parent: Pick<Parent, "passkeys">) => passkeysOf(parent).length > 0;

/** What a client may see about a saved passkey: an opaque id, its label and when it was added. */
export function passkeyViews(parent: Pick<Parent, "passkeys">): TrustView["passkeys"] {
  return passkeysOf(parent).map((k) => ({ id: k.key, createdAt: k.createdAt, label: k.label }));
}

// ---------------------------------------------------------------- mandate

/** The rules a pet starts with. Face ID approval is off until the parent saves a passkey. */
export function defaultMandate(parent?: Pick<Parent, "passkeys">): PetMandate {
  return {
    agentMayPropose: true,
    maxPriceCents: 5000,
    monthlyBudgetCents: 10_000,
    categories: [],
    requirePasskey: parent ? hasPasskeys(parent) : false,
  };
}

const isCents = (v: unknown, max: number): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;
const isCategory = (v: unknown): v is Category => typeof v === "string" && (CATEGORIES as string[]).includes(v);
const canonical = (cats: Category[]) => CATEGORIES.filter((c) => cats.includes(c));

/**
 * The parent's effective mandate: what's stored, over the defaults (bad stored values fall back to the default).
 * requirePasskey follows the saved passkeys: on while one is saved (every payment uses it), off when none is, whatever
 * was stored. So a payment never waits for a passkey that doesn't exist, and removing the last one turns it off.
 */
export function mandateOf(parent: Pick<Parent, "mandate" | "passkeys">): PetMandate {
  const d = defaultMandate(parent);
  const s = (parent.mandate && typeof parent.mandate === "object" ? parent.mandate : {}) as Partial<Record<keyof PetMandate, unknown>>;
  return {
    agentMayPropose: typeof s.agentMayPropose === "boolean" ? s.agentMayPropose : d.agentMayPropose,
    maxPriceCents: isCents(s.maxPriceCents, LIMITS.maxPriceCents) ? s.maxPriceCents : d.maxPriceCents,
    monthlyBudgetCents: isCents(s.monthlyBudgetCents, LIMITS.monthlyBudgetCents) ? s.monthlyBudgetCents : d.monthlyBudgetCents,
    categories: Array.isArray(s.categories) ? canonical(s.categories.filter(isCategory)) : d.categories,
    requirePasskey: hasPasskeys(parent),
  };
}

/**
 * demoReset (seed.ts upsertParents): every judge plays the same parents (?as=jo), so RESET puts the pet's rules back
 * to the defaults and forgets the saved passkeys and any live challenge. Otherwise one visitor's price limit or
 * passkey would follow every later visitor.
 */
export function trustReset(): Partial<Parent> {
  return { mandate: defaultMandate(), passkeys: [], passkeyChallenge: noChallenge() } as Partial<Parent>;
}

/** True when this parent's payments need a passkey (Face ID) approval. */
export const passkeyRequired = (parent: Pick<Parent, "mandate" | "passkeys">) => mandateOf(parent).requirePasskey;

/**
 * Apply a partial update to a mandate. Throws bad_request with a plain sentence for anything invalid; never
 * silently ignores a field the parent asked to change.
 */
export function applyMandatePatch(current: PetMandate, patch: unknown, opts: { hasPasskeys: boolean }): PetMandate {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw bad("mandate must be an object");
  const p = patch as Record<string, unknown>;
  for (const k of Object.keys(p)) {
    if (!(MANDATE_KEYS as string[]).includes(k)) throw bad(`Unknown rule '${k}'.`);
  }
  const next: PetMandate = { ...current, categories: [...current.categories] };
  if ("maxPriceCents" in p) {
    if (!isCents(p.maxPriceCents, LIMITS.maxPriceCents)) throw bad("The price limit must be a whole number of cents from $0 to $1,000.");
    next.maxPriceCents = p.maxPriceCents;
  }
  if ("monthlyBudgetCents" in p) {
    if (!isCents(p.monthlyBudgetCents, LIMITS.monthlyBudgetCents)) throw bad("The monthly budget must be a whole number of cents from $0 to $5,000.");
    next.monthlyBudgetCents = p.monthlyBudgetCents;
  }
  if ("categories" in p) {
    if (!Array.isArray(p.categories)) throw bad("categories must be a list (empty means any).");
    const unknown = p.categories.find((c) => !isCategory(c));
    if (unknown !== undefined) throw bad(`Unknown category '${String(unknown)}'.`);
    next.categories = canonical(p.categories as Category[]);
  }
  if ("agentMayPropose" in p) {
    if (typeof p.agentMayPropose !== "boolean") throw bad("agentMayPropose must be true or false.");
    next.agentMayPropose = p.agentMayPropose;
  }
  if ("requirePasskey" in p) {
    if (typeof p.requirePasskey !== "boolean") throw bad("requirePasskey must be true or false.");
    if (p.requirePasskey && !opts.hasPasskeys) throw bad("Add a passkey first, then turn on Face ID approval.");
    if (!p.requirePasskey && opts.hasPasskeys) throw bad("Face ID approval stays on while a passkey is saved. Remove your passkeys to turn it off.");
    next.requirePasskey = p.requirePasskey;
  }
  return next;
}

export type MandateRule = "agent_may_not_propose" | "over_price" | "category" | "over_budget";
export type MandateCheck = { ok: true } | { ok: false; rule: MandateRule; reason: string };

/**
 * Would this offer fit the buyer's rules? `committedCents` = paid + still-pending trades this month.
 * Reasons are plain sentences without amounts: the seller's side may see them, the buyer's limits stay private.
 */
export function checkMandate(
  m: PetMandate,
  offer: { priceCents: number; category: Category },
  committedCents: number,
  who: { name: string; petName: string },
): MandateCheck {
  if (!m.agentMayPropose) {
    return { ok: false, rule: "agent_may_not_propose", reason: `${who.name} asked ${who.petName} to only point out matches, not propose trades.` };
  }
  if (offer.priceCents > m.maxPriceCents) {
    return { ok: false, rule: "over_price", reason: `It costs more than the price limit ${who.name} set for ${who.petName}.` };
  }
  if (m.categories.length && !m.categories.includes(offer.category)) {
    return { ok: false, rule: "category", reason: `It isn't one of the kinds of clothes ${who.name} asked ${who.petName} to look for.` };
  }
  if (committedCents + offer.priceCents > m.monthlyBudgetCents) {
    return { ok: false, rule: "over_budget", reason: `It would go over ${who.name}'s monthly budget for ${who.petName}.` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------- spending (demo-clock month)

const monthOf = (iso: ISODate) => {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? "" : new Date(t).toISOString().slice(0, 7);
};

/** This demo-clock month's paid trades for a buyer, and live (open / both accepted, not timed out) ones. One read. */
export async function monthTotals(db: Db, buyerId: ID, now: ISODate): Promise<{ spentCents: number; pendingCents: number }> {
  const month = monthOf(now);
  const nowMs = new Date(now).getTime();
  let spentCents = 0;
  let pendingCents = 0;
  for (const p of await db.MatchProposal.filter({ buyerId }, undefined, 1000)) {
    if (p.buyerId !== buyerId || monthOf(p.createdAt) !== month) continue;
    const cents = Number(p.snapshot?.priceCents) || 0;
    if (p.status === "paid") spentCents += cents;
    else if (LIVE.includes(p.status) && !(p.status === "open" && new Date(p.expiresAt).getTime() < nowMs)) pendingCents += cents;
  }
  return { spentCents, pendingCents };
}

/** createProposal's gate: throws not_eligible (409) with a plain reason when the buyer's rules say no. */
export async function enforceMandate(db: Db, buyer: Parent, offer: { priceCents: number; category: Category }, now: ISODate): Promise<void> {
  const m = mandateOf(buyer);
  const who = { name: buyer.name, petName: buyer.pet?.name || "their pet" };
  // Cheap rules first; the budget needs one read.
  const quick = checkMandate(m, offer, 0, who);
  if (!quick.ok && quick.rule !== "over_budget") throw new HttpError("not_eligible", quick.reason, 409);
  const { spentCents, pendingCents } = await monthTotals(db, buyer.id, now);
  const full = checkMandate(m, offer, spentCents + pendingCents, who);
  if (!full.ok) throw new HttpError("not_eligible", full.reason, 409);
}

// ---------------------------------------------------------------- getTrust / setMandate

export async function getTrust(db: Db, ref: ParentRef): Promise<TrustView> {
  const parent = await resolveParent(db, ref ?? {});
  const { spentCents } = await monthTotals(db, parent.id, await getNow(db));
  return { mandate: mandateOf(parent), spentThisMonthCents: spentCents, passkeys: passkeyViews(parent) };
}

export async function setMandate(db: Db, req: SetMandateReq): Promise<PetMandate> {
  const parent = await resolveParent(db, req ?? {});
  const next = applyMandatePatch(mandateOf(parent), req?.mandate, { hasPasskeys: hasPasskeys(parent) });
  await db.Parent.update(parent.id, { mandate: next });
  return mandateOf({ mandate: next, passkeys: parent.passkeys });
}

// ---------------------------------------------------------------- base64url + random (no Buffer: runs everywhere)

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string) {
  if (typeof s !== "string" || !/^[A-Za-z0-9_-]*={0,2}$/.test(s)) throw bad("expected base64url");
  const norm = s.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(norm + "=".repeat((4 - (norm.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const utf8 = (s: string) => new TextEncoder().encode(s);
const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

/** sha-256 of the trade's identity and price: a payment challenge commits to exactly this trade. First 16 bytes. */
export async function paymentBinding(p: Pick<MatchProposal, "id" | "buyerId" | "sellerId" | "itemId" | "snapshot">): Promise<Uint8Array> {
  const text = `relay-pay|${p.id}|${p.buyerId}|${p.sellerId}|${p.itemId}|${p.snapshot?.priceCents}`;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(text)));
  return digest.slice(0, 16);
}

/** A payment challenge = 16 random bytes + paymentBinding(trade). The passkey signs both. */
export async function paymentChallenge(p: Parameters<typeof paymentBinding>[0]): Promise<string> {
  const bytes = new Uint8Array(32);
  bytes.set(randomBytes(16), 0);
  bytes.set(await paymentBinding(p), 16);
  return b64url(bytes);
}

async function bindingMatches(challenge: string, p: Parameters<typeof paymentBinding>[0]): Promise<boolean> {
  let bytes: Uint8Array;
  try { bytes = fromB64url(challenge); } catch { return false; }
  if (bytes.length !== 32) return false;
  const want = await paymentBinding(p);
  return want.every((b, i) => bytes[16 + i] === b);
}

// ---------------------------------------------------------------- challenges (single use, 5 min)

/**
 * What Parent.passkeyChallenge holds when no challenge is live: an empty object, not null, because the entity field
 * is declared {"type":"object"} and Base44's schema check may refuse null. challengeOf() reads it as "none".
 */
export const noChallenge = (): Record<string, never> => ({});

export function challengeOf(parent: Parent): StoredChallenge | null {
  const c = (parent as ParentRow).passkeyChallenge;
  return c && typeof c === "object" && typeof c.challenge === "string" && c.challenge !== "" ? (c as StoredChallenge) : null;
}

/** Store a fresh challenge on the Parent (replacing any older one) and return it. */
export async function issueChallenge(
  db: Db, parent: Parent, purpose: StoredChallenge["purpose"], proposal?: MatchProposal, nowMs = Date.now(),
): Promise<StoredChallenge> {
  const c: StoredChallenge = {
    challenge: purpose === "pay" && proposal ? await paymentChallenge(proposal) : b64url(randomBytes(32)),
    purpose,
    ...(purpose === "pay" && proposal ? { proposalId: proposal.id } : {}),
    expiresAt: new Date(nowMs + CHALLENGE_TTL_MS).toISOString(),
  };
  await db.Parent.update(parent.id, { passkeyChallenge: c } as Partial<Parent>);
  return c;
}

/**
 * Use the parent's challenge once: it is cleared before anything is checked, so a replay always fails.
 * Returns the challenge string the signed response must carry.
 */
export async function consumeChallenge(
  db: Db, parent: Parent, purpose: StoredChallenge["purpose"], proposal?: MatchProposal, nowMs = Date.now(),
): Promise<string> {
  const c = challengeOf(parent);
  if (c) await db.Parent.update(parent.id, { passkeyChallenge: noChallenge() } as Partial<Parent>);
  // A payment approval shows up as a toast in the trade window: say what to tap and that no money moved.
  const again = purpose === "pay" ? "Tap Pay to try again · nothing charged." : "Try again.";
  if (!c || c.purpose !== purpose) throw forbidden(`That approval isn't valid any more. ${again}`);
  if (new Date(c.expiresAt).getTime() < nowMs) throw forbidden(`That approval timed out after 5 minutes. ${again}`);
  if (purpose === "pay") {
    if (!proposal || c.proposalId !== proposal.id || !(await bindingMatches(c.challenge, proposal))) {
      throw forbidden("That approval was for a different trade or price. Approve again · nothing charged.");
    }
  }
  return c.challenge;
}

// ---------------------------------------------------------------- relying party (which site the passkey belongs to)

const PASSKEY_HOSTS = [/^localhost$/, /\.localhost$/, /\.base44\.app$/, /\.base44\.com$/];
const isLocalHost = (h: string) => h === "localhost" || h.endsWith(".localhost") || h === "127.0.0.1" || h === "[::1]";

/** APP_HOST is a bare host ("sproutpass-5c025059.base44.app", as the pay links use it); a full origin works too. */
function appOrigin(appHost: string): URL {
  const s = appHost.trim().replace(/\/+$/, "");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return new URL(s);
  return new URL(`${isLocalHost(s.replace(/:\d+$/, "")) ? "http" : "https"}://${s}`);
}

/**
 * Which site a passkey belongs to: rpID = the app's hostname, origin = the app's origin.
 *  - appHost given (the entries pass the APP_HOST secret): the app is PINNED to it, so the result never depends on
 *    whether Base44's function proxy forwards the browser's Origin header. That header is only a cross-check: an
 *    Origin naming another site is refused; none, "null", or the function's own host (a proxy's rewrite) is ignored.
 *  - no appHost (localhost, tests): the request's Origin header, else the function's own URL.
 * Without a pinned host only the app's own hosts (localhost, *.base44.app, *.base44.com) may use passkeys; https is
 * required everywhere except localhost. (@simplewebauthn then also checks the origin inside each signed response.)
 */
export function relyingParty(requestUrl: string, originHeader?: string | null, appHost?: string | null): { rpID: string; origin: string } {
  let own = "";
  try { own = new URL(requestUrl).hostname; } catch { /* no own host */ }
  const header = originHeader && originHeader !== "null" ? originHeader : "";
  let page: URL;
  if (appHost?.trim()) {
    try { page = appOrigin(appHost); } catch { throw bad("The app's address (APP_HOST) isn't a valid host."); }
    let from: URL | null = null;
    try { from = header ? new URL(header) : null; } catch { throw bad("Can't tell which site this request came from."); }
    if (from && from.hostname !== page.hostname && from.hostname !== own) {
      throw forbidden(`Passkeys only work on ${page.hostname}, not ${from.hostname}.`);
    }
  } else {
    try { page = new URL(header || requestUrl); } catch { throw bad("Can't tell which site this request came from."); }
    if (page.hostname !== own && !PASSKEY_HOSTS.some((r) => r.test(page.hostname))) throw forbidden(`Passkeys can't be used from ${page.hostname}.`);
  }
  const host = page.hostname;
  if (page.protocol !== "https:" && !isLocalHost(host)) throw forbidden("Passkeys need a secure (https) page.");
  return { rpID: host, origin: page.origin };
}

// ---------------------------------------------------------------- passkey flows (crypto-agnostic; entries plug in @simplewebauthn)

export interface CredentialDescriptor { id: string; transports: string[] }
const descriptor = (k: StoredPasskey): CredentialDescriptor => ({ id: k.credentialId, transports: k.transports });

/** Register step 1: who is registering, and a fresh challenge. */
export async function startPasskeyRegistration(db: Db, req: PasskeyOptionsReq, nowMs = Date.now()) {
  const parent = await resolveParent(db, req ?? {});
  const keys = passkeysOf(parent);
  // No cap here: at MAX_PASSKEYS the new one replaces the oldest (finishPasskeyRegistration), so a visitor on another
  // device can always add theirs. Registering needs no approval: like every door in this anonymous demo (?as=jo),
  // it isn't bound to a signed-in person (see shared/c/auth.ts); a real app would ask for a sign-in first.
  const c = await issueChallenge(db, parent, "register", undefined, nowMs);
  return {
    parent,
    challenge: c.challenge,
    userId: b64url(utf8(parent.id)),
    userName: parent.name,
    userDisplayName: parent.name,
    exclude: keys.map(descriptor),
  };
}

/** What a verified registration yields (the entry fills it from @simplewebauthn's registrationInfo). */
export type VerifiedCredential = Pick<StoredPasskey, "credentialId" | "publicKey" | "counter" | "transports" | "rpID"> & { mock?: true };

const cleanLabel = (label: unknown, n: number) => {
  const s = typeof label === "string" ? label.replace(/\s+/g, " ").trim().slice(0, 40) : "";
  return s || `Passkey ${n}`;
};

/** "Passkey N" for an unlabelled passkey: one past the highest N in use (labels stay distinct after a replacement). */
const nextNumber = (keys: StoredPasskey[]) =>
  keys.reduce((n, k) => Math.max(n, Number(/^Passkey (\d+)$/.exec(k.label)?.[1] ?? 0)), keys.length) + 1;

const oldestFirst = (keys: StoredPasskey[]) => [...keys].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));

/**
 * Register step 2: use the challenge once, let `verify` check the attestation against it, then save the credential.
 * Saving the first passkey turns on Face ID approval for payments. At MAX_PASSKEYS the oldest one makes room.
 */
export async function finishPasskeyRegistration(
  db: Db, req: PasskeyVerifyReq, verify: (expectedChallenge: string) => Promise<VerifiedCredential>, nowMs = Date.now(),
): Promise<{ ok: true; passkeys: TrustView["passkeys"] }> {
  const parent = await resolveParent(db, req ?? {});
  const response = req?.response;
  if (!response || typeof response !== "object" || typeof (response as { id?: unknown }).id !== "string") {
    throw bad("response must be the passkey's registration response");
  }
  const challenge = await consumeChallenge(db, parent, "register", undefined, nowMs);
  const cred = await verify(challenge);
  const keys = passkeysOf(parent);
  if (keys.some((k) => k.credentialId === cred.credentialId)) throw bad("This passkey is already saved.");
  const kept = keys.length >= MAX_PASSKEYS ? oldestFirst(keys).slice(keys.length - MAX_PASSKEYS + 1) : keys;
  const stored: StoredPasskey = {
    key: `pk_${b64url(randomBytes(9))}`,
    credentialId: cred.credentialId,
    publicKey: cred.publicKey,
    counter: Number.isInteger(cred.counter) && cred.counter >= 0 ? cred.counter : 0,
    transports: (cred.transports ?? []).filter((t) => TRANSPORTS.includes(t)),
    label: cleanLabel(req.label, nextNumber(keys)),
    createdAt: new Date(nowMs).toISOString(),
    rpID: cred.rpID,
    ...(cred.mock ? { mock: true as const } : {}),
  };
  const passkeys = [...kept, stored];
  const mandate = { ...mandateOf(parent), requirePasskey: true };
  await db.Parent.update(parent.id, { passkeys, mandate });
  return { ok: true, passkeys: passkeyViews({ passkeys }) };
}

/**
 * Forget one saved passkey, by the opaque id getTrust lists. Removing the last one turns Face ID approval off; the
 * live challenge is dropped too (it may name the removed credential). Safe to call twice: an unknown id changes
 * nothing. Like registering, it isn't bound to a signed-in person in this anonymous demo (a real app would ask for
 * a sign-in or the passkey itself first).
 */
export async function removePasskey(db: Db, req: PasskeyRemoveReq): Promise<TrustView> {
  const parent = await resolveParent(db, req ?? {});
  if (typeof req?.passkeyId !== "string" || !req.passkeyId) throw bad("passkeyId required");
  const keys = passkeysOf(parent);
  if (keys.some((k) => k.key === req.passkeyId)) {
    const passkeys = keys.filter((k) => k.key !== req.passkeyId);
    const mandate = { ...mandateOf(parent), requirePasskey: passkeys.length > 0 };
    await db.Parent.update(parent.id, { passkeys, mandate, passkeyChallenge: noChallenge() } as Partial<Parent>);
  }
  return getTrust(db, { parentId: parent.id });
}

/** Pay step 1 (passkeyAuthOptions): the buyer of a live trade gets a challenge bound to that trade and its price. */
export async function startPaymentApproval(db: Db, req: PasskeyOptionsReq, rpID: string, nowMs = Date.now()) {
  const parent = await resolveParent(db, req ?? {});
  if (!req?.proposalId) throw bad("proposalId required");
  const p = await mustGet(db.MatchProposal, req.proposalId, "proposal");
  if (p.buyerId !== parent.id) throw forbidden("Only the buyer approves a payment.");
  if (!LIVE.includes(p.status)) throw invalid(`this trade is ${p.status.replace("_", " ")}`);
  const keys = passkeysOf(parent).filter((k) => k.rpID === rpID);
  if (!keys.length) throw bad("No passkey is saved for this site yet. Add one in your pet's rules first.");
  const c = await issueChallenge(db, parent, "pay", p, nowMs);
  return { parent, proposal: p, challenge: c.challenge, allow: keys.map(descriptor) };
}

/**
 * Pay step 2, run by payProposal's ENTRY before payProposal: verifies the passkey assertion in `body.passkey` and
 * returns the proposal id it approves (passed to payProposal as opts.passkeyApprovedFor; a client can't set that).
 * Returns undefined (payProposal then decides) when there is nothing to approve: no assertion sent, no approval
 * needed, not the buyer, or the trade isn't waiting for payment. The challenge is only used when it is.
 */
export async function approvePayment(
  db: Db,
  body: PayProposalReq,
  verify: (a: { challenge: string; passkey: StoredPasskey }) => Promise<{ newCounter: number }>,
  nowMs = Date.now(),
): Promise<ID | undefined> {
  const assertion = body?.passkey;
  if (!assertion) return undefined;
  const parent = await resolveParent(db, body);
  if (!passkeyRequired(parent)) return undefined;
  const p = await mustGet(db.MatchProposal, body.proposalId, "proposal");
  if (p.buyerId !== parent.id || p.status !== "both_accepted") return undefined;
  const credentialId = (assertion as { id?: unknown }).id;
  if (typeof credentialId !== "string" || !credentialId) throw bad("passkey must be the passkey's authentication response");
  const challenge = await consumeChallenge(db, parent, "pay", p, nowMs);
  const passkey = passkeysOf(parent).find((k) => k.credentialId === credentialId);
  if (!passkey) throw forbidden(`That passkey isn't saved for ${parent.name}.`);
  const { newCounter } = await verify({ challenge, passkey });
  if (Number.isInteger(newCounter) && newCounter !== passkey.counter) {
    const passkeys = passkeysOf(parent).map((k) => (k.key === passkey.key ? { ...k, counter: newCounter } : k));
    await db.Parent.update(parent.id, { passkeys });
  }
  return p.id;
}

// ---------------------------------------------------------------- MOCK ONLY (localhost demo, src/app/api.mock.ts)
// The browser really creates and uses a passkey, but these helpers do NOT verify signatures: they check the challenge
// (inside clientDataJSON), the ceremony type, the origin and the credential id. The real Base44 functions verify the
// attestation and every assertion with @simplewebauthn/server. Never import this section from an entry.ts.

type ClientData = { type?: string; challenge?: string; origin?: string };

function readClientData(response: unknown): ClientData {
  const raw = (response as { response?: { clientDataJSON?: unknown } } | null)?.response?.clientDataJSON;
  if (typeof raw !== "string") throw bad("the passkey response has no clientDataJSON");
  try { return JSON.parse(new TextDecoder().decode(fromB64url(raw))) as ClientData; } catch { throw bad("clientDataJSON isn't readable"); }
}

const pageLocation = () => (globalThis as { location?: { hostname?: string; origin?: string } }).location;

function mockCheck(cd: ClientData, type: string, challenge: string) {
  if (cd.type !== type) throw forbidden("That passkey response is for a different step.");
  if (cd.challenge !== challenge) throw forbidden("That passkey response doesn't match this request.");
  const origin = pageLocation()?.origin;
  if (origin && cd.origin && cd.origin !== origin) throw forbidden("That passkey response came from another site.");
}

export const mockPasskeys = {
  /** PublicKeyCredentialCreationOptionsJSON, as @simplewebauthn/server would build it. */
  async registerOptions(db: Db, req: PasskeyOptionsReq, rpID = pageLocation()?.hostname || "localhost", nowMs = Date.now()) {
    const s = await startPasskeyRegistration(db, req, nowMs);
    return {
      rp: { name: RP_NAME, id: rpID },
      user: { id: s.userId, name: s.userName, displayName: s.userDisplayName },
      challenge: s.challenge,
      pubKeyCredParams: [-8, -7, -257].map((alg) => ({ alg, type: "public-key" })),
      timeout: 60_000,
      attestation: "none",
      excludeCredentials: s.exclude.map((e) => ({ id: e.id, type: "public-key", transports: e.transports })),
      authenticatorSelection: { residentKey: "preferred", requireResidentKey: false, userVerification: "required" },
      extensions: { credProps: true },
    } as Record<string, unknown>;
  },

  /** MOCK: saves the browser's credential after checking challenge + type + origin. No attestation check. */
  async registerVerify(db: Db, req: PasskeyVerifyReq, rpID = pageLocation()?.hostname || "localhost", nowMs = Date.now()) {
    return finishPasskeyRegistration(db, req, async (challenge) => {
      mockCheck(readClientData(req.response), "webauthn.create", challenge);
      const r = req.response as { id: string; response?: { transports?: unknown } };
      const transports = Array.isArray(r.response?.transports) ? (r.response!.transports as unknown[]).filter((t): t is string => typeof t === "string") : [];
      return { credentialId: r.id, publicKey: "", counter: 0, transports, rpID, mock: true };
    }, nowMs);
  },

  /** PublicKeyCredentialRequestOptionsJSON for approving one trade. */
  async authOptions(db: Db, req: PasskeyOptionsReq, rpID = pageLocation()?.hostname || "localhost", nowMs = Date.now()) {
    const s = await startPaymentApproval(db, req, rpID, nowMs);
    return {
      challenge: s.challenge,
      timeout: 60_000,
      rpId: rpID,
      allowCredentials: s.allow.map((e) => ({ id: e.id, type: "public-key", transports: e.transports })),
      userVerification: "required",
    } as Record<string, unknown>;
  },

  /** MOCK: approvePayment with the challenge/type/origin check instead of a signature check. */
  async approvePayment(db: Db, body: PayProposalReq, nowMs = Date.now()) {
    return approvePayment(db, body, async ({ challenge, passkey }) => {
      mockCheck(readClientData(body.passkey), "webauthn.get", challenge);
      return { newCounter: passkey.counter };
    }, nowMs);
  },
};
