// Pure trusted-checkout helpers: the pet's rules form, the spent bar, and how a payment gets approved.
import { describe, expect, it } from "vitest";
import {
  allowedCredentialId, approvalMode, biometricName, budgetBar, DEFAULT_MANDATE, demoCredential, deviceLabel,
  dollarsInput, expectedMode, fullMandate, isCancel, mandateChanges, needsPasskeyError, parseDollars, textToB64url,
} from "./trustLogic";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";
const WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36";

describe("parseDollars / dollarsInput", () => {
  it("reads what people type", () => {
    expect(parseDollars("25")).toBe(2500);
    expect(parseDollars("$25.5")).toBe(2550);
    expect(parseDollars(" 12.50 ")).toBe(1250);
    expect(parseDollars("1,000")).toBe(100000);
    expect(parseDollars(".5")).toBe(50);
  });
  it("rejects empty, zero and junk", () => {
    expect(parseDollars("")).toBeNull();
    expect(parseDollars("0")).toBeNull();
    expect(parseDollars("abc")).toBeNull();
    expect(parseDollars("1.2.3")).toBeNull();
    expect(parseDollars("1.234")).toBeNull();
  });
  it("round-trips cents into the input", () => {
    expect(dollarsInput(2500)).toBe("25");
    expect(dollarsInput(1250)).toBe("12.50");
    expect(parseDollars(dollarsInput(1999))).toBe(1999);
  });
});

describe("fullMandate", () => {
  it("fills missing fields from the default", () => {
    expect(fullMandate(undefined)).toEqual(DEFAULT_MANDATE);
    expect(fullMandate({ maxPriceCents: 1500, requirePasskey: true })).toEqual({ ...DEFAULT_MANDATE, maxPriceCents: 1500, requirePasskey: true });
  });
  it("ignores nonsense numbers", () => {
    expect(fullMandate({ maxPriceCents: -5, monthlyBudgetCents: Number.NaN }).maxPriceCents).toBe(DEFAULT_MANDATE.maxPriceCents);
  });
});

describe("mandateChanges", () => {
  it("lists only what changed (category order doesn't matter)", () => {
    const saved = { ...DEFAULT_MANDATE, categories: ["top", "onesie"] as const };
    expect(mandateChanges({ ...saved, categories: [...saved.categories] }, { ...saved, categories: ["onesie", "top"] })).toEqual({});
    expect(mandateChanges(DEFAULT_MANDATE, { ...DEFAULT_MANDATE, maxPriceCents: 2500, requirePasskey: true }))
      .toEqual({ maxPriceCents: 2500, requirePasskey: true });
  });
});

describe("budgetBar", () => {
  it("fills cells by spend, at least one for any spend", () => {
    expect(budgetBar(0, 10000)).toEqual({ filled: 0, cells: 10, leftCents: 10000, over: false });
    expect(budgetBar(100, 10000).filled).toBe(1);
    expect(budgetBar(1800, 10000)).toMatchObject({ filled: 2, leftCents: 8200, over: false });
    expect(budgetBar(10000, 10000)).toMatchObject({ filled: 10, leftCents: 0, over: false });
  });
  it("caps at the budget and flags overspend", () => {
    expect(budgetBar(12000, 10000)).toMatchObject({ filled: 10, leftCents: 0, over: true });
  });
});

describe("approvalMode", () => {
  const real = { challenge: "abc", rpId: "localhost" };
  it("uses the real ceremony when the device has a built-in authenticator", () => {
    expect(approvalMode("platform", real, false)).toBe("device");
    expect(approvalMode("platform", real, true)).toBe("device");
  });
  it("lets a real server use a roaming passkey (phone over QR), but the mock uses the stand-in", () => {
    expect(approvalMode("webauthn", real, false)).toBe("device");
    expect(approvalMode("webauthn", real, true)).toBe("demo");
  });
  it("never invents an approval on a real server", () => {
    expect(approvalMode("none", real, false)).toBe("unavailable");
    expect(approvalMode("platform", {}, false)).toBe("unavailable");
    expect(approvalMode("none", {}, true)).toBe("demo");
  });
  it("predicts the mode before options arrive", () => {
    expect(expectedMode("platform", false)).toBe("device");
    expect(expectedMode("none", true)).toBe("demo");
    expect(expectedMode("none", false)).toBe("unavailable");
  });
});

describe("device names", () => {
  it("names what the phone will ask for", () => {
    expect(biometricName(IPHONE)).toBe("Face ID");
    expect(biometricName(MAC)).toBe("Touch ID");
    expect(biometricName(WIN)).toBe("Windows Hello");
    expect(biometricName(ANDROID)).toBe("fingerprint");
    expect(biometricName("curl/8")).toBe("passkey");
  });
  it("labels a new passkey by device", () => {
    expect(deviceLabel(IPHONE)).toBe("iPhone");
    expect(deviceLabel(MAC)).toBe("Mac");
    expect(deviceLabel(WIN)).toBe("Windows PC");
    expect(deviceLabel(ANDROID)).toBe("Android phone");
    expect(deviceLabel("")).toBe("This device");
  });
});

describe("errors", () => {
  it("treats a cancelled or aborted sheet as a cancel", () => {
    expect(isCancel(Object.assign(new Error("x"), { name: "NotAllowedError" }))).toBe(true);
    expect(isCancel(Object.assign(new Error("x"), { code: "ERROR_CEREMONY_ABORTED" }))).toBe(true);
    expect(isCancel(Object.assign(new Error("x"), { name: "WebAuthnError", cause: { name: "NotAllowedError" } }))).toBe(true);
    expect(isCancel(Object.assign(new Error("x"), { name: "SecurityError" }))).toBe(false);
    expect(isCancel(null)).toBe(false);
  });
  it("spots a server asking for Face ID", () => {
    expect(needsPasskeyError({ code: "passkey_required", message: "" })).toBe(true);
    expect(needsPasskeyError({ code: "forbidden", message: "This payment needs your passkey." })).toBe(true);
    expect(needsPasskeyError({ code: "forbidden", message: "only the buyer can pay" })).toBe(false);
  });
});

describe("demoCredential", () => {
  const clientData = (c: Record<string, unknown>) => {
    const raw = String((c.response as { clientDataJSON: string }).clientDataJSON).replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(raw), (ch) => ch.charCodeAt(0))));
  };
  it("looks like a WebAuthn assertion for an allowed credential, marked demo", () => {
    const c = demoCredential({ challenge: "ch1", allowCredentials: [{ id: "cred-k1", type: "public-key" }] }, "get", "http://localhost:5186");
    expect(c).toMatchObject({ id: "cred-k1", rawId: "cred-k1", type: "public-key", demo: true });
    expect(clientData(c)).toMatchObject({ type: "webauthn.get", challenge: "ch1", origin: "http://localhost:5186" });
  });
  it("makes up a new credential id for a registration", () => {
    const c = demoCredential({ challenge: "ch2" }, "create", "http://localhost:5186");
    expect(String(c.id)).toMatch(/^demo-/);
    expect(clientData(c)).toMatchObject({ type: "webauthn.create", challenge: "ch2" });
    expect(allowedCredentialId({ allowCredentials: "nope" })).toBeUndefined();
  });
  it("base64url-encodes without padding or + /", () => {
    expect(textToB64url("??>")).toBe("Pz8-");
  });
});
