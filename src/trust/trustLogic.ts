// OWNER: B6 (trust UI). Pure helpers behind the trusted-checkout screens (no React, no api) so vitest covers them.
import type { Category, PetMandate } from "../app/types";

// ---------------------------------------------------------------- the pet's rules

/** What a parent who never opened /bag/pet gets (the server has the same default). */
export const DEFAULT_MANDATE: PetMandate = {
  maxPriceCents: 5000, monthlyBudgetCents: 10000, categories: [], requirePasskey: false, agentMayPropose: true,
};

export const CATEGORY_LABELS: { value: Category; label: string }[] = [
  { value: "top", label: "TOPS" }, { value: "bottom", label: "BOTTOMS" }, { value: "onesie", label: "ONESIES" },
  { value: "outerwear", label: "OUTERWEAR" }, { value: "dress", label: "DRESSES" }, { value: "set", label: "SETS" },
  { value: "other", label: "OTHER" },
];

/** A mandate from the server with any missing field filled from the default (older rows, placeholders). */
export function fullMandate(m: Partial<PetMandate> | null | undefined): PetMandate {
  return {
    maxPriceCents: num(m?.maxPriceCents, DEFAULT_MANDATE.maxPriceCents),
    monthlyBudgetCents: num(m?.monthlyBudgetCents, DEFAULT_MANDATE.monthlyBudgetCents),
    categories: Array.isArray(m?.categories) ? [...m.categories] : [],
    requirePasskey: typeof m?.requirePasskey === "boolean" ? m.requirePasskey : DEFAULT_MANDATE.requirePasskey,
    agentMayPropose: typeof m?.agentMayPropose === "boolean" ? m.agentMayPropose : DEFAULT_MANDATE.agentMayPropose,
  };
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback);

/** "$25", "25.5", " 40 " → cents; null when empty, not a number, or not above $0. */
export function parseDollars(s: string): number | null {
  const t = s.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$|^\.\d{1,2}$/.test(t)) return null;
  const cents = Math.round(Number(t) * 100);
  return Number.isFinite(cents) && cents > 0 ? cents : null;
}

/** Cents → what goes back into a dollar input: 2500 → "25", 1250 → "12.50". */
export function dollarsInput(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

export interface BudgetBar {
  /** Cells to fill out of `cells` (rounded up, so any spend shows at least one). */
  filled: number;
  cells: number;
  leftCents: number;
  over: boolean;
}

/** The spent-this-month bar on /bag/pet. */
export function budgetBar(spentCents: number, budgetCents: number, cells = 10): BudgetBar {
  const spent = Math.max(0, spentCents);
  if (budgetCents <= 0) return { filled: spent > 0 ? cells : 0, cells, leftCents: 0, over: spent > 0 };
  const ratio = Math.min(1, spent / budgetCents);
  return {
    filled: spent > 0 ? Math.max(1, Math.ceil(ratio * cells)) : 0,
    cells,
    leftCents: Math.max(0, budgetCents - spent),
    over: spent > budgetCents,
  };
}

/** Fields that differ between the saved mandate and the form (what setMandate gets). */
export function mandateChanges(saved: PetMandate, next: PetMandate): Partial<PetMandate> {
  const out: Partial<PetMandate> = {};
  if (saved.maxPriceCents !== next.maxPriceCents) out.maxPriceCents = next.maxPriceCents;
  if (saved.monthlyBudgetCents !== next.monthlyBudgetCents) out.monthlyBudgetCents = next.monthlyBudgetCents;
  const a = [...saved.categories].sort().join(","), b = [...next.categories].sort().join(",");
  if (a !== b) out.categories = [...next.categories];
  if (saved.requirePasskey !== next.requirePasskey) out.requirePasskey = next.requirePasskey;
  if (saved.agentMayPropose !== next.agentMayPropose) out.agentMayPropose = next.agentMayPropose;
  return out;
}

// ---------------------------------------------------------------- Face ID / passkey

/** platform = a built-in authenticator (Face ID, Touch ID, Windows Hello); webauthn = WebAuthn but only roaming
 *  authenticators (a security key, or a phone over QR); none = no WebAuthn in this browser. */
export type PasskeySupport = "platform" | "webauthn" | "none";

/** device = the real WebAuthn ceremony; demo = the mock's labelled stand-in (VITE_USE_MOCK only, and the
 *  person still taps to approve); unavailable = this browser can't approve here. */
export type ApprovalMode = "device" | "demo" | "unavailable";

export function hasChallenge(options: unknown): boolean {
  const c = options && typeof options === "object" ? (options as { challenge?: unknown }).challenge : undefined;
  return typeof c === "string" && c.length > 0;
}

/**
 * How this browser makes a passkey or approves a payment. Real WebAuthn when the server sent real options and
 * the device can do it; on the mock, a browser without a built-in authenticator (a laptop without Windows Hello,
 * headless Chrome) gets the demo stand-in instead of a QR prompt nobody can answer.
 */
export function approvalMode(support: PasskeySupport, options: unknown, mock: boolean): ApprovalMode {
  if (hasChallenge(options) && (support === "platform" || (support === "webauthn" && !mock))) return "device";
  return mock ? "demo" : "unavailable";
}

/** The mode before any options are fetched (for button labels). */
export const expectedMode = (support: PasskeySupport, mock: boolean): ApprovalMode =>
  approvalMode(support, { challenge: "-" }, mock);

/** What the person will see the phone ask for: "Face ID", "Touch ID", "Windows Hello", "fingerprint" or "passkey". */
export function biometricName(ua: string): string {
  if (/iPhone|iPad|iPod/i.test(ua)) return "Face ID";
  if (/Macintosh|Mac OS X/i.test(ua) && !/Mobile/i.test(ua)) return "Touch ID";
  if (/Android/i.test(ua)) return "fingerprint";
  if (/Windows/i.test(ua)) return "Windows Hello";
  return "passkey";
}

/** The name a new passkey is listed under: "iPhone", "Mac", "Windows PC", "Android phone" or "This device". */
export function deviceLabel(ua: string): string {
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android phone";
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows PC";
  return "This device";
}

/** The person said no (cancelled the sheet, looked away, timed out) or the ceremony was aborted. */
export function isCancel(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { name?: string; code?: string; cause?: { name?: string } };
  return err.name === "NotAllowedError" || err.name === "AbortError" || err.code === "ERROR_CEREMONY_ABORTED"
    || err.cause?.name === "NotAllowedError" || err.cause?.name === "AbortError";
}

/** This authenticator already holds a passkey for this parent (registration's excludeCredentials matched). */
export function isAlreadyRegistered(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { name?: string; code?: string; cause?: { name?: string } };
  return err.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED" || err.name === "InvalidStateError"
    || err.cause?.name === "InvalidStateError";
}

/** passkeyAuthOptions said no passkey is saved for this site (e.g. the passkey was made on another host). */
export function noPasskeyForSite(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { code?: string; message?: string };
  return (err.code === undefined || err.code === "bad_request") && /no passkey is saved/i.test(err.message ?? "");
}

/** A Face ID / passkey prompt that failed this fast never asked the person: this device has no matching passkey. */
export const QUICK_FAIL_MS = 1500;

/** The newest passkey in a list (the one a registration just added). */
export function newestPasskeyId(keys: { id: string; createdAt: string }[]): string | undefined {
  let best: { id: string; createdAt: string } | undefined;
  for (const k of keys) if (!best || k.createdAt > best.createdAt) best = k;
  return best?.id;
}

/** The server turned a payment down because it needs a passkey approval (any wording B5's handler picks). */
export function needsPasskeyError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { code?: string; message?: string };
  return err.code === "passkey_required" || /passkey|face id|webauthn/i.test(err.message ?? "");
}

/** The first credential id the server will accept (allowCredentials), for the demo stand-in. */
export function allowedCredentialId(options: unknown): string | undefined {
  const list = options && typeof options === "object" ? (options as { allowCredentials?: unknown }).allowCredentials : undefined;
  if (!Array.isArray(list)) return undefined;
  const first = list.find((c) => c && typeof c === "object" && typeof (c as { id?: unknown }).id === "string") as { id: string } | undefined;
  return first?.id;
}

/** UTF-8 text → base64url (no padding), like WebAuthn's clientDataJSON. */
export function textToB64url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * The mock's stand-in for a WebAuthn response, shaped like one so the same request goes through B5's mock check
 * (challenge + ceremony type + origin inside clientDataJSON, and a saved credential id). It carries no signature
 * and is marked `demo: true`; only ever sent when VITE_USE_MOCK is on, and the real functions verify signatures.
 */
export function demoCredential(
  options: unknown, ceremony: "create" | "get", origin: string, credentialId?: string,
): Record<string, unknown> {
  const id = credentialId ?? allowedCredentialId(options) ?? `demo-${Math.random().toString(36).slice(2, 10)}`;
  const challenge = hasChallenge(options) ? (options as { challenge: string }).challenge : "";
  const clientDataJSON = textToB64url(JSON.stringify({ type: `webauthn.${ceremony}`, challenge, origin, crossOrigin: false }));
  return {
    id, rawId: id, type: "public-key", authenticatorAttachment: "platform",
    response: { clientDataJSON, transports: ["internal"] }, clientExtensionResults: {}, demo: true,
  };
}
