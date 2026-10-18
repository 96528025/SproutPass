// OWNER: B6 (trust UI). Face ID / passkey on the client, through @simplewebauthn/browser:
//  - registerPasskey: passkeyRegisterOptions → startRegistration (the phone asks for Face ID) → passkeyRegisterVerify
//  - approvePayment:  passkeyAuthOptions({ proposalId }) → startAuthentication → the response goes to payProposal
// The face or fingerprint never leaves the device; the server only keeps a public key and checks a signature
// over a one-time challenge. On the mock (VITE_USE_MOCK), a browser without a built-in authenticator gets a
// clearly labelled demo stand-in instead, and the person still has to tap to approve.
import {
  browserSupportsWebAuthn, platformAuthenticatorIsAvailable, startAuthentication, startRegistration,
  WebAuthnAbortService,
  type PublicKeyCredentialCreationOptionsJSON, type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { api, USE_MOCK } from "../app/api";
import { parentRef, useApp } from "../app/store";
import type { TrustView } from "../app/types";
import {
  approvalMode, biometricName, demoCredential, deviceLabel, isCancel, newestPasskeyId, type ApprovalMode, type PasskeySupport,
} from "./trustLogic";

export { USE_MOCK };

/** The person cancelled Face ID (or it timed out): nothing happened, nothing was charged. */
export class PasskeyCancelled extends Error {
  constructor() { super("Face ID was cancelled. Nothing was charged."); this.name = "PasskeyCancelled"; }
}

/** This browser can't make or use a passkey (and this isn't the mock). */
export class PasskeyUnavailable extends Error {
  constructor() {
    super("This browser can't use a passkey. Open the app on your phone to approve it there.");
    this.name = "PasskeyUnavailable";
  }
}

const ua = () => (typeof navigator === "undefined" ? "" : navigator.userAgent);

/** "Face ID", "Touch ID", "Windows Hello", "fingerprint" or "passkey", for this device. */
export const biometric = () => biometricName(ua());

let supportP: Promise<PasskeySupport> | null = null;

const SS_FORCE_DEMO = "relay:passkey:demo";

/**
 * Mock only: `?passkey=demo` (remembered for the tab) uses the demo stand-in even on a laptop with Windows Hello or
 * Touch ID, e.g. on stage. `?passkey=device` goes back to the real prompt. Ignored on the real app.
 */
function forcedDemo(): boolean {
  if (!USE_MOCK || typeof window === "undefined") return false;
  try {
    const q = new URLSearchParams(window.location.search).get("passkey");
    if (q === "demo") sessionStorage.setItem(SS_FORCE_DEMO, "1");
    if (q === "device") sessionStorage.removeItem(SS_FORCE_DEMO);
    return sessionStorage.getItem(SS_FORCE_DEMO) === "1";
  } catch {
    return false;
  }
}

/** What this browser can do (checked once per tab). */
export function passkeySupport(): Promise<PasskeySupport> {
  supportP ??= (async (): Promise<PasskeySupport> => {
    try {
      if (forcedDemo()) return "none";
      if (!browserSupportsWebAuthn()) return "none";
      return (await platformAuthenticatorIsAvailable()) ? "platform" : "webauthn";
    } catch {
      return "none";
    }
  })();
  return supportP;
}

/** Stop a Face ID sheet that is still up (the trade window closed, the person left the screen). */
export function cancelPasskeyPrompt(): void {
  try { WebAuthnAbortService.cancelCeremony(); } catch { /* nothing running */ }
}

async function ceremony<T extends Record<string, unknown>>(
  kind: "create" | "get", options: Record<string, unknown>, run: () => Promise<unknown>,
): Promise<{ response: T; via: Exclude<ApprovalMode, "unavailable"> }> {
  const mode = approvalMode(await passkeySupport(), options, USE_MOCK);
  if (mode === "unavailable") throw new PasskeyUnavailable();
  if (mode === "device") {
    try {
      return { response: (await run()) as T, via: "device" };
    } catch (e) {
      if (isCancel(e)) throw new PasskeyCancelled();
      // The mock's options can't always satisfy a real authenticator (e.g. its RP id): use the stand-in there.
      if (!USE_MOCK) throw e;
      console.warn("[trust] passkey ceremony failed on the mock; using the demo stand-in", e);
    }
  }
  return { response: demoCredential(options, kind, window.location.origin) as T, via: "demo" };
}

/**
 * Make a passkey on this device for the current parent. Returns the parent's passkeys afterwards. Saving the first
 * passkey turns on Face ID approval for every payment (the server's rule), so callers reload the TrustView.
 */
export async function registerPasskey(): Promise<{ passkeys: TrustView["passkeys"]; via: "device" | "demo" }> {
  const options = await api.passkeyRegisterOptions(parentRef());
  const { response, via } = await ceremony("create", options, () =>
    startRegistration({ optionsJSON: options as unknown as PublicKeyCredentialCreationOptionsJSON }));
  const label = via === "demo" ? `${deviceLabel(ua())} (demo passkey)` : deviceLabel(ua());
  const res = await api.passkeyRegisterVerify({ ...parentRef(), response, label });
  const added = newestPasskeyId(res.passkeys);
  if (added) rememberHere(added);
  return { passkeys: res.passkeys, via };
}

// ---- which saved passkeys were made in this browser (so /bag/pet can say "This device" and not offer it again)

const hereKey = () => `relay:passkey:here:${useApp.getState().parentKey ?? "-"}`;

function rememberHere(id: string): void {
  try {
    const ids = passkeysMadeHere().filter((x) => x !== id);
    localStorage.setItem(hereKey(), JSON.stringify([...ids, id].slice(-10)));
  } catch { /* private mode: the list just won't know */ }
}

/** Ids of the current parent's passkeys this browser registered (best effort: cleared site data forgets them). */
export function passkeysMadeHere(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(hereKey()) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Ask for Face ID to approve one payment. The response is what payProposal takes as `passkey`. */
export async function approvePayment(proposalId: string): Promise<{ passkey: Record<string, unknown>; via: "device" | "demo" }> {
  const options = await api.passkeyAuthOptions({ ...parentRef(), proposalId });
  const { response, via } = await ceremony("get", options, () =>
    startAuthentication({ optionsJSON: options as unknown as PublicKeyCredentialRequestOptionsJSON }));
  return { passkey: response, via };
}
