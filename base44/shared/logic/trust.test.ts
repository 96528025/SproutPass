// Trusted checkout (B5): the pet's mandate, monthly spending, passkey challenges and the mock passkey flow, on fakeDb.
import { beforeEach, describe, expect, it } from "vitest";
import { createFakeDb, type FakeDb } from "../testing/fakeDb.ts";
import { applySeed, seedPlan, DEMO_DATES } from "../seed.ts";
import { priceFor } from "../pricing.ts";
import { publicParent } from "../db.ts";
import type { ClothingItem, Listing, MatchProposal, Parent } from "../types.ts";
import { getCloset } from "./closet.ts";
import { createProposal, decideProposal, payProposal } from "./trade.ts";
import {
  applyMandatePatch, approvePayment, b64url, CHALLENGE_TTL_MS, challengeOf, checkMandate, consumeChallenge, defaultMandate,
  fromB64url, getTrust, issueChallenge, mandateOf, MAX_PASSKEYS, mockPasskeys, monthTotals, paymentBinding, paymentChallenge,
  passkeysOf, relyingParty, removePasskey, setMandate, startPaymentApproval, trustReset, type StoredPasskey,
} from "./trust.ts";

let db: FakeDb;
let ids: { mina: string; jo: string; sam: string };
let romper: ClothingItem;
let listing: Listing;
const T0 = Date.parse("2026-10-18T17:00:00.000Z");

async function setClock(now: string) {
  const [s] = await db.Setting.filter({ key: "demo" });
  await db.Setting.update(s.id, { now });
}

const parent = (key: "mina" | "jo" | "sam"): Promise<Parent> => db.Parent.get(ids[key]);
const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
/** What @simplewebauthn/browser's startRegistration / startAuthentication hand back (only the parts the mock reads). */
const browserResponse = (id: string, type: "webauthn.create" | "webauthn.get", challenge: string) =>
  ({ id, rawId: id, type: "public-key", response: { clientDataJSON: enc({ type, challenge, origin: "http://localhost:5180" }), transports: ["internal", "hybrid", "bogus"] } });

const fakeKey = (over: Partial<StoredPasskey> = {}): StoredPasskey => ({
  key: "pk_test", credentialId: "cred-1", publicKey: "", counter: 0, transports: [], label: "Test", createdAt: "2026-10-18T00:00:00.000Z",
  rpID: "localhost", ...over,
});

async function bothAccepted(): Promise<MatchProposal> {
  const p = await createProposal(db, { listingId: listing.id, buyerId: ids.jo, reason: "", transcript: [], source: "local" });
  await decideProposal(db, { parentKey: "mina", proposalId: p.id, decision: "accepted" });
  return decideProposal(db, { parentKey: "jo", proposalId: p.id, decision: "accepted" });
}

/** Jo registers a passkey through the mock flow; returns the credential id. */
async function registerJo(id = "cred-jo", label?: string): Promise<string> {
  const opts = await mockPasskeys.registerOptions(db, { parentKey: "jo" }, "localhost", T0);
  await mockPasskeys.registerVerify(db, { parentKey: "jo", response: browserResponse(id, "webauthn.create", opts.challenge as string), label }, "localhost", T0);
  return id;
}

beforeEach(async () => {
  db = createFakeDb();
  const { parentIds } = await applySeed(db, seedPlan());
  ids = parentIds as typeof ids;
  [romper] = await db.ClothingItem.filter({ name: "Yellow duck romper" });
  await setClock(DEMO_DATES.nudge);
  await db.ClothingItem.update(romper.id, { status: "listed" });
  listing = await db.Listing.create({
    itemId: romper.id, sellerId: ids.mina, condition: "gently_used", conditionNote: "", priceCents: priceFor(romper) ?? 0,
    shared: true, status: "active", createdAt: DEMO_DATES.nudge,
  });
  await setClock(DEMO_DATES.meet);
});

// ---------------------------------------------------------------- mandate rules

describe("mandate", () => {
  it("defaults: may propose, $50 per item, $100 a month, any category, Face ID off until a passkey exists", () => {
    expect(defaultMandate()).toEqual({ agentMayPropose: true, maxPriceCents: 5000, monthlyBudgetCents: 10_000, categories: [], requirePasskey: false });
    expect(defaultMandate({ passkeys: [] }).requirePasskey).toBe(false);
    expect(defaultMandate({ passkeys: [fakeKey()] }).requirePasskey).toBe(true);
  });

  it("mandateOf merges what's stored over the defaults and drops bad stored values", () => {
    const m = mandateOf({ mandate: { maxPriceCents: -5, monthlyBudgetCents: 2500, categories: ["set", "nope", "top"] } as never });
    expect(m).toEqual({ agentMayPropose: true, maxPriceCents: 5000, monthlyBudgetCents: 2500, categories: ["top", "set"], requirePasskey: false });
    expect(mandateOf({}).requirePasskey).toBe(false);
    // a saved passkey always means Face ID approval
    expect(mandateOf({ mandate: { ...defaultMandate(), requirePasskey: false }, passkeys: [fakeKey()] }).requirePasskey).toBe(true);
    // and none never does: a stale stored "on" can't make a payment wait for a passkey that doesn't exist
    expect(mandateOf({ mandate: { ...defaultMandate(), requirePasskey: true }, passkeys: [] }).requirePasskey).toBe(false);
  });

  it("applyMandatePatch changes only what was sent and validates every field", () => {
    const base = defaultMandate();
    expect(applyMandatePatch(base, { maxPriceCents: 2000 }, { hasPasskeys: false })).toEqual({ ...base, maxPriceCents: 2000 });
    expect(applyMandatePatch(base, { categories: ["dress", "top", "top"] }, { hasPasskeys: false }).categories).toEqual(["top", "dress"]);
    expect(applyMandatePatch(base, { agentMayPropose: false }, { hasPasskeys: false }).agentMayPropose).toBe(false);
    for (const bad of [
      { maxPriceCents: -1 }, { maxPriceCents: 12.5 }, { maxPriceCents: "2000" }, { maxPriceCents: 100_001 },
      { monthlyBudgetCents: 500_001 }, { monthlyBudgetCents: null }, { categories: "top" }, { categories: ["hats"] },
      { agentMayPropose: "yes" }, { requirePasskey: 1 }, { spendEverything: true },
    ]) {
      expect(() => applyMandatePatch(base, bad, { hasPasskeys: false }), JSON.stringify(bad)).toThrow(expect.objectContaining({ code: "bad_request", status: 400 }));
    }
    for (const notObject of [null, undefined, "x", [1]]) {
      expect(() => applyMandatePatch(base, notObject, { hasPasskeys: false })).toThrow(expect.objectContaining({ code: "bad_request" }));
    }
  });

  it("Face ID approval: can't turn on without a passkey, can't turn off while one is saved", () => {
    const base = defaultMandate();
    expect(() => applyMandatePatch(base, { requirePasskey: true }, { hasPasskeys: false })).toThrow(/Add a passkey first/);
    expect(() => applyMandatePatch({ ...base, requirePasskey: true }, { requirePasskey: false }, { hasPasskeys: true })).toThrow(/stays on/);
    expect(applyMandatePatch(base, { requirePasskey: true }, { hasPasskeys: true }).requirePasskey).toBe(true);
    expect(applyMandatePatch(base, { requirePasskey: false }, { hasPasskeys: false }).requirePasskey).toBe(false);
  });

  it("checkMandate: each rule, in order, with plain reasons that don't reveal the buyer's amounts", () => {
    const who = { name: "Jo", petName: "Pip" };
    const offer = { priceCents: 1800, category: "onesie" as const };
    const m = defaultMandate();
    expect(checkMandate(m, offer, 0, who)).toEqual({ ok: true });
    const cases = [
      [{ ...m, agentMayPropose: false }, 0, "agent_may_not_propose"],
      [{ ...m, maxPriceCents: 1799 }, 0, "over_price"],
      [{ ...m, categories: ["outerwear"] }, 0, "category"],
      [{ ...m, monthlyBudgetCents: 3000 }, 1201, "over_budget"],
    ] as const;
    for (const [mandate, committed, rule] of cases) {
      const r = checkMandate(mandate as never, offer, committed, who);
      expect(r).toMatchObject({ ok: false, rule });
      if (r.ok) throw new Error("expected a refusal");
      expect(r.reason).toMatch(/Jo|Pip/);
      expect(r.reason).not.toMatch(/\$|\d/);
    }
    expect(checkMandate({ ...m, maxPriceCents: 1800, monthlyBudgetCents: 3000 }, offer, 1200, who)).toEqual({ ok: true }); // limits are inclusive
    expect(checkMandate({ ...m, categories: ["onesie"] }, offer, 0, who)).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------- getTrust / setMandate

describe("getTrust / setMandate", () => {
  it("a new parent sees the default rules, nothing spent and no passkeys", async () => {
    expect(await getTrust(db, { parentKey: "jo" })).toEqual({ mandate: defaultMandate(), spentThisMonthCents: 0, passkeys: [] });
  });

  it("setMandate saves a partial change and returns the effective rules", async () => {
    const m = await setMandate(db, { parentKey: "jo", mandate: { maxPriceCents: 2500, categories: ["onesie", "top"] } });
    expect(m).toEqual({ ...defaultMandate(), maxPriceCents: 2500, categories: ["top", "onesie"] });
    expect((await parent("jo")).mandate).toEqual(m);
    expect((await getTrust(db, { parentId: ids.jo })).mandate).toEqual(m);
    const again = await setMandate(db, { parentKey: "jo", mandate: { monthlyBudgetCents: 4000 } });
    expect(again).toMatchObject({ maxPriceCents: 2500, monthlyBudgetCents: 4000 });
  });

  it("setMandate rejects bad input and unknown parents without writing", async () => {
    await expect(setMandate(db, { parentKey: "jo", mandate: { maxPriceCents: -1 } })).rejects.toMatchObject({ code: "bad_request" });
    await expect(setMandate(db, { parentKey: "jo" } as never)).rejects.toMatchObject({ code: "bad_request" });
    await expect(setMandate(db, { parentKey: "nobody", mandate: {} })).rejects.toMatchObject({ code: "not_found" });
    expect((await parent("jo")).mandate).toBeUndefined();
  });

  it("spentThisMonthCents counts the buyer's paid trades in the demo clock's month only", async () => {
    const p = await bothAccepted();
    await payProposal(db, { parentKey: "jo", proposalId: p.id }, { delayMs: 0 });
    expect((await getTrust(db, { parentKey: "jo" })).spentThisMonthCents).toBe(1800);
    expect((await getTrust(db, { parentKey: "mina" })).spentThisMonthCents).toBe(0); // the seller didn't spend
    await setClock("2026-11-02T17:00:00.000Z");
    expect((await getTrust(db, { parentKey: "jo" })).spentThisMonthCents).toBe(0);
  });

  it("monthTotals splits paid from still-pending trades and ignores timed-out offers", async () => {
    const snap = { priceCents: 700 } as MatchProposal["snapshot"];
    const row = (over: Partial<MatchProposal>) => db.MatchProposal.create({
      listingId: "l", itemId: "i", sellerId: ids.mina, buyerId: ids.jo, snapshot: snap, reason: "", transcript: [], source: "local",
      sellerDecision: "pending", buyerDecision: "pending", status: "open", handover: "now",
      createdAt: DEMO_DATES.meet, expiresAt: "2026-10-18T17:30:00.000Z", ...over,
    } as Omit<MatchProposal, "id">);
    await row({ status: "paid" });
    await row({ status: "paid", createdAt: "2026-09-30T17:00:00.000Z" });
    await row({ status: "both_accepted" });
    await row({ status: "open" });
    await row({ status: "open", expiresAt: "2026-10-18T16:00:00.000Z" }); // timed out
    await row({ status: "declined" });
    expect(await monthTotals(db, ids.jo, DEMO_DATES.meet)).toEqual({ spentCents: 700, pendingCents: 1400 });
  });
});

// ---------------------------------------------------------------- never to a client

describe("privacy", () => {
  it("publicParent and getCloset never return the mandate, passkeys or the challenge", async () => {
    await registerJo();
    await setMandate(db, { parentKey: "jo", mandate: { maxPriceCents: 2500 } });
    const p = await bothAccepted();
    await startPaymentApproval(db, { parentKey: "jo", proposalId: p.id }, "localhost", T0);
    const jo = await parent("jo");
    expect(jo.passkeys).toHaveLength(1);
    expect(challengeOf(jo)).not.toBeNull();
    for (const view of [publicParent(jo), (await getCloset(db, { parentKey: "jo" })).parent]) {
      for (const k of ["mandate", "passkeys", "passkeyChallenge", "phone"]) expect(view).not.toHaveProperty(k);
      expect(JSON.stringify(view)).not.toContain("cred-jo");
    }
  });

  it("getTrust shows a passkey's label and date, never its credential id or public key", async () => {
    await registerJo("cred-secret-id", "  Jo's   iPhone  ");
    const t = await getTrust(db, { parentKey: "jo" });
    expect(t.passkeys).toEqual([{ id: expect.stringMatching(/^pk_/), label: "Jo's iPhone", createdAt: new Date(T0).toISOString() }]);
    expect(JSON.stringify(t)).not.toContain("cred-secret-id");
    expect(t.mandate.requirePasskey).toBe(true);
  });
});

// ---------------------------------------------------------------- challenges

describe("challenges", () => {
  it("base64url round-trips and rejects junk", () => {
    const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255, 62, 63]);
    expect(Array.from(fromB64url(b64url(bytes)))).toEqual(Array.from(bytes));
    expect(b64url(bytes)).not.toMatch(/[+/=]/);
    expect(() => fromB64url("not base64!")).toThrow();
  });

  it("are single use", async () => {
    const jo = await parent("jo");
    const c = await issueChallenge(db, jo, "register", undefined, T0);
    expect(c.expiresAt).toBe(new Date(T0 + CHALLENGE_TTL_MS).toISOString());
    expect(await consumeChallenge(db, await parent("jo"), "register", undefined, T0)).toBe(c.challenge);
    expect(challengeOf(await parent("jo"))).toBeNull();
    // cleared with {} rather than null: Parent.passkeyChallenge is an object field on Base44
    expect((await parent("jo") as Parent & { passkeyChallenge?: unknown }).passkeyChallenge).toEqual({});
    await expect(consumeChallenge(db, await parent("jo"), "register", undefined, T0)).rejects.toMatchObject({ code: "forbidden", status: 403 });
  });

  it("an empty or blank stored challenge counts as none", async () => {
    for (const passkeyChallenge of [{}, { challenge: "", purpose: "register", expiresAt: "2099-01-01T00:00:00.000Z" }, null]) {
      await db.Parent.update(ids.jo, { passkeyChallenge } as never);
      expect(challengeOf(await parent("jo"))).toBeNull();
      await expect(consumeChallenge(db, await parent("jo"), "register", undefined, T0)).rejects.toMatchObject({ code: "forbidden" });
    }
  });

  it("expire after 5 minutes, and a wrong purpose burns them", async () => {
    await issueChallenge(db, await parent("jo"), "register", undefined, T0);
    await expect(consumeChallenge(db, await parent("jo"), "register", undefined, T0 + CHALLENGE_TTL_MS + 1)).rejects.toThrow(/timed out/);
    await issueChallenge(db, await parent("jo"), "register", undefined, T0);
    await expect(consumeChallenge(db, await parent("jo"), "pay", undefined, T0)).rejects.toMatchObject({ code: "forbidden" });
    expect(challengeOf(await parent("jo"))).toBeNull();
  });

  it("a payment challenge commits to this trade and its price", async () => {
    const p = await bothAccepted();
    const c = await paymentChallenge(p);
    expect(fromB64url(c)).toHaveLength(32);
    expect(Array.from(fromB64url(c).slice(16))).toEqual(Array.from(await paymentBinding(p)));
    expect(c).not.toBe(await paymentChallenge(p)); // random half differs
    expect(Array.from(await paymentBinding({ ...p, snapshot: { ...p.snapshot, priceCents: 1 } }))).not.toEqual(Array.from(await paymentBinding(p)));

    await issueChallenge(db, await parent("jo"), "pay", p, T0);
    const cheaper = { ...p, snapshot: { ...p.snapshot, priceCents: 100 } };
    await expect(consumeChallenge(db, await parent("jo"), "pay", cheaper, T0)).rejects.toThrow(/different trade or price/);
    await issueChallenge(db, await parent("jo"), "pay", p, T0);
    await expect(consumeChallenge(db, await parent("jo"), "pay", { ...p, id: "other" }, T0)).rejects.toMatchObject({ code: "forbidden" });
    const fresh = await issueChallenge(db, await parent("jo"), "pay", p, T0);
    expect(await consumeChallenge(db, await parent("jo"), "pay", p, T0)).toBe(fresh.challenge);
  });
});

describe("relyingParty", () => {
  const fn = "https://fn.example.dev/payProposal";
  it("uses the page's Origin: localhost and the Base44 app host", () => {
    expect(relyingParty(fn, "http://localhost:5180")).toEqual({ rpID: "localhost", origin: "http://localhost:5180" });
    expect(relyingParty(fn, "https://sproutpass-5c025059.base44.app")).toEqual({
      rpID: "sproutpass-5c025059.base44.app", origin: "https://sproutpass-5c025059.base44.app" });
    expect(relyingParty("https://sproutpass-5c025059.base44.app/api/fn", null).rpID).toBe("sproutpass-5c025059.base44.app");
  });
  it("refuses other sites and plain http off localhost", () => {
    expect(() => relyingParty(fn, "https://evil.example.com")).toThrow(expect.objectContaining({ code: "forbidden" }));
    expect(() => relyingParty(fn, "http://sproutpass-5c025059.base44.app")).toThrow(/https/);
    expect(() => relyingParty("nope", "also nope")).toThrow(expect.objectContaining({ code: "bad_request" }));
  });

  describe("pinned to APP_HOST", () => {
    const APP = "sproutpass-5c025059.base44.app";
    const pinned = { rpID: APP, origin: `https://${APP}` };
    it("doesn't depend on the proxy forwarding the browser's Origin", () => {
      expect(relyingParty(fn, null, APP)).toEqual(pinned);                         // no Origin at all
      expect(relyingParty(fn, "null", APP)).toEqual(pinned);                       // opaque Origin
      expect(relyingParty(fn, "https://fn.example.dev", APP)).toEqual(pinned);     // the function's own host (proxy rewrite)
      expect(relyingParty(fn, `https://${APP}`, APP)).toEqual(pinned);             // the app itself
      expect(relyingParty(fn, null, `https://${APP}/`)).toEqual(pinned);           // a full origin works too
      expect(relyingParty(fn, "http://localhost:5180", "localhost:5180")).toEqual({ rpID: "localhost", origin: "http://localhost:5180" });
    });
    it("uses the Origin only as a cross-check: another site is refused", () => {
      expect(() => relyingParty(fn, "https://evil.example.com", APP)).toThrow(expect.objectContaining({ code: "forbidden" }));
      expect(() => relyingParty(fn, "https://other-app.base44.app", APP)).toThrow(/only work on sproutpass-5c025059\.base44\.app/);
      expect(() => relyingParty(fn, "not a url", APP)).toThrow(expect.objectContaining({ code: "bad_request" }));
      expect(() => relyingParty(fn, null, "http://" + APP)).toThrow(/https/);
      expect(relyingParty(fn, "https://sproutpass-5c025059.base44.app", "  ")).toEqual(pinned); // blank = not set
    });
  });
});

// ---------------------------------------------------------------- passkey flow (mock: no signature check)

describe("passkeys (mock flow)", () => {
  it("register options look like @simplewebauthn's and store the challenge", async () => {
    const o = await mockPasskeys.registerOptions(db, { parentKey: "jo" }, "localhost", T0);
    const jo = await parent("jo");
    expect(o).toMatchObject({
      rp: { name: "Hand-Me-Down Relay", id: "localhost" },
      user: { id: b64url(new TextEncoder().encode(ids.jo)), name: "Jo", displayName: "Jo" },
      challenge: challengeOf(jo)?.challenge, attestation: "none", excludeCredentials: [],
      authenticatorSelection: { userVerification: "required" },
    });
    expect(challengeOf(jo)).toMatchObject({ purpose: "register" });
  });

  it("registering saves the credential server-side and turns on Face ID approval", async () => {
    const opts = await mockPasskeys.registerOptions(db, { parentKey: "jo" }, "localhost", T0);
    const res = await mockPasskeys.registerVerify(db, { parentKey: "jo", response: browserResponse("cred-a", "webauthn.create", opts.challenge as string) }, "localhost", T0);
    expect(res).toEqual({ ok: true, passkeys: [{ id: expect.stringMatching(/^pk_/), label: "Passkey 1", createdAt: new Date(T0).toISOString() }] });
    const jo = await parent("jo");
    expect(passkeysOf(jo)).toEqual([expect.objectContaining({ credentialId: "cred-a", counter: 0, transports: ["internal", "hybrid"], rpID: "localhost", mock: true })]);
    expect(mandateOf(jo).requirePasskey).toBe(true);
    expect(jo.mandate?.requirePasskey).toBe(true);
    expect(challengeOf(jo)).toBeNull();
    // the next options exclude it
    const next = await mockPasskeys.registerOptions(db, { parentKey: "jo" }, "localhost", T0);
    expect(next.excludeCredentials).toEqual([{ id: "cred-a", type: "public-key", transports: ["internal", "hybrid"] }]);
  });

  it("a response for another challenge, a replay, a duplicate or the wrong ceremony saves nothing", async () => {
    const opts = await mockPasskeys.registerOptions(db, { parentKey: "jo" }, "localhost", T0);
    await expect(mockPasskeys.registerVerify(db, { parentKey: "jo", response: browserResponse("x", "webauthn.create", "other") }, "localhost", T0))
      .rejects.toMatchObject({ code: "forbidden" });
    // the challenge was used up by that attempt
    await expect(mockPasskeys.registerVerify(db, { parentKey: "jo", response: browserResponse("x", "webauthn.create", opts.challenge as string) }, "localhost", T0))
      .rejects.toMatchObject({ code: "forbidden" });
    const o2 = await mockPasskeys.registerOptions(db, { parentKey: "jo" }, "localhost", T0);
    await expect(mockPasskeys.registerVerify(db, { parentKey: "jo", response: browserResponse("x", "webauthn.get", o2.challenge as string) }, "localhost", T0))
      .rejects.toMatchObject({ code: "forbidden" });
    expect(passkeysOf(await parent("jo"))).toHaveLength(0);
    await registerJo("dup");
    const o3 = await mockPasskeys.registerOptions(db, { parentKey: "jo" }, "localhost", T0);
    await expect(mockPasskeys.registerVerify(db, { parentKey: "jo", response: browserResponse("dup", "webauthn.create", o3.challenge as string) }, "localhost", T0))
      .rejects.toThrow(/already saved/);
    await expect(mockPasskeys.registerVerify(db, { parentKey: "jo", response: {} }, "localhost", T0)).rejects.toMatchObject({ code: "bad_request" });
  });

  it(`at most ${MAX_PASSKEYS} passkeys: one more replaces the oldest, so another device can always be added`, async () => {
    for (let i = 0; i < MAX_PASSKEYS; i++) {
      const opts = await mockPasskeys.registerOptions(db, { parentKey: "jo" }, "localhost", T0 + i);
      await mockPasskeys.registerVerify(db, { parentKey: "jo", response: browserResponse(`c${i}`, "webauthn.create", opts.challenge as string) }, "localhost", T0 + i);
    }
    const opts = await mockPasskeys.registerOptions(db, { parentKey: "jo" }, "localhost", T0 + 10);
    expect(opts.excludeCredentials).toHaveLength(MAX_PASSKEYS);
    await mockPasskeys.registerVerify(db, { parentKey: "jo", response: browserResponse("newest", "webauthn.create", opts.challenge as string) }, "localhost", T0 + 10);
    const keys = passkeysOf(await parent("jo"));
    expect(keys.map((k) => k.credentialId)).toEqual(["c1", "c2", "c3", "c4", "newest"]);
    expect(new Set(keys.map((k) => k.label)).size).toBe(MAX_PASSKEYS); // "Passkey 6", not a second "Passkey 5"
    expect(keys.at(-1)?.label).toBe("Passkey 6");
  });

  it("removePasskey forgets one by its opaque id; the last one turns Face ID off and payments go through", async () => {
    await registerJo("cred-a");
    await registerJo("cred-b");
    const p = await bothAccepted();
    await mockPasskeys.authOptions(db, { parentKey: "jo", proposalId: p.id }, "localhost", T0);
    let t = await getTrust(db, { parentKey: "jo" });
    expect(t.passkeys).toHaveLength(2);
    const first = passkeysOf(await parent("jo")).find((k) => k.credentialId === "cred-a")!;
    t = await removePasskey(db, { parentKey: "jo", passkeyId: first.key });
    expect(t.passkeys).toHaveLength(1);
    expect(t.mandate.requirePasskey).toBe(true);
    expect(passkeysOf(await parent("jo")).map((k) => k.credentialId)).toEqual(["cred-b"]);
    expect(challengeOf(await parent("jo"))).toBeNull();                        // the live challenge went with it
    expect(await removePasskey(db, { parentKey: "jo", passkeyId: "pk_unknown" })).toEqual(t); // unknown id: no change
    t = await removePasskey(db, { parentKey: "jo", passkeyId: t.passkeys[0].id });
    expect(t).toMatchObject({ passkeys: [], mandate: { requirePasskey: false } });
    expect((await parent("jo")).mandate?.requirePasskey).toBe(false);
    expect((await payProposal(db, { parentKey: "jo", proposalId: p.id }, { delayMs: 0 })).proposal.status).toBe("paid");
    await expect(removePasskey(db, { parentKey: "jo" } as never)).rejects.toMatchObject({ code: "bad_request" });
    await expect(removePasskey(db, { parentKey: "nobody", passkeyId: "pk_x" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("payment options: only the buyer, only a live trade, only with a passkey for this site", async () => {
    const p = await bothAccepted();
    await expect(mockPasskeys.authOptions(db, { parentKey: "jo", proposalId: p.id }, "localhost", T0)).rejects.toThrow(/No passkey/);
    await registerJo("cred-jo");
    await expect(mockPasskeys.authOptions(db, { parentKey: "mina", proposalId: p.id }, "localhost", T0)).rejects.toMatchObject({ code: "forbidden" });
    await expect(mockPasskeys.authOptions(db, { parentKey: "jo" }, "localhost", T0)).rejects.toMatchObject({ code: "bad_request" });
    await expect(mockPasskeys.authOptions(db, { parentKey: "jo", proposalId: p.id }, "other.localhost", T0)).rejects.toThrow(/No passkey/);
    const o = await mockPasskeys.authOptions(db, { parentKey: "jo", proposalId: p.id }, "localhost", T0);
    expect(o).toMatchObject({ rpId: "localhost", userVerification: "required", allowCredentials: [{ id: "cred-jo", type: "public-key" }] });
    expect(challengeOf(await parent("jo"))).toMatchObject({ purpose: "pay", proposalId: p.id, challenge: o.challenge });
  });

  it("full flow: Face ID required → approve this trade → paid; nothing moves without it", async () => {
    await registerJo("cred-jo");
    const p = await bothAccepted();
    await expect(payProposal(db, { parentKey: "jo", proposalId: p.id }, { delayMs: 0 }))
      .rejects.toMatchObject({ code: "forbidden", status: 403, message: "Approve with Face ID first" });
    // a client can't approve itself by sending a passkey field without a matching challenge
    const forged = { parentKey: "jo", proposalId: p.id, passkey: browserResponse("cred-jo", "webauthn.get", "made-up") };
    await expect(mockPasskeys.approvePayment(db, forged, T0)).rejects.toMatchObject({ code: "forbidden" });
    expect((await db.ClothingItem.get(romper.id)).currentOwnerId).toBe(ids.mina);
    expect((await db.MatchProposal.get(p.id)).paymentRef).toBeUndefined();

    const o = await mockPasskeys.authOptions(db, { parentKey: "jo", proposalId: p.id }, "localhost", T0);
    const body = { parentKey: "jo", proposalId: p.id, passkey: browserResponse("cred-jo", "webauthn.get", o.challenge as string) };
    const approved = await mockPasskeys.approvePayment(db, body, T0);
    expect(approved).toBe(p.id);
    const res = await payProposal(db, body, { delayMs: 0, passkeyApprovedFor: approved });
    expect(res.proposal.status).toBe("paid");
    expect(res.item.currentOwnerId).toBe(ids.jo);
    // replaying the same approval on the paid trade changes nothing and needs nothing
    expect(await mockPasskeys.approvePayment(db, body, T0)).toBeUndefined();
    expect((await payProposal(db, body, { delayMs: 0 })).proposal.paymentRef).toBe(res.proposal.paymentRef);
  });

  it("an approval is single use, expires, and only works with a saved credential", async () => {
    await registerJo("cred-jo");
    const p = await bothAccepted();
    let o = await mockPasskeys.authOptions(db, { parentKey: "jo", proposalId: p.id }, "localhost", T0);
    const unknown = { parentKey: "jo", proposalId: p.id, passkey: browserResponse("someone-else", "webauthn.get", o.challenge as string) };
    await expect(mockPasskeys.approvePayment(db, unknown, T0)).rejects.toThrow(/isn't saved for Jo/);
    o = await mockPasskeys.authOptions(db, { parentKey: "jo", proposalId: p.id }, "localhost", T0);
    const late = { parentKey: "jo", proposalId: p.id, passkey: browserResponse("cred-jo", "webauthn.get", o.challenge as string) };
    await expect(mockPasskeys.approvePayment(db, late, T0 + CHALLENGE_TTL_MS + 1)).rejects.toThrow(/timed out/);
    await expect(mockPasskeys.approvePayment(db, late, T0)).rejects.toMatchObject({ code: "forbidden" }); // used up
    expect((await db.MatchProposal.get(p.id)).status).toBe("both_accepted");
  });

  it("approvePayment leaves the challenge alone when there is nothing to approve yet", async () => {
    await registerJo("cred-jo");
    const p = await createProposal(db, { listingId: listing.id, buyerId: ids.jo, reason: "", transcript: [], source: "local" });
    const o = await mockPasskeys.authOptions(db, { parentKey: "jo", proposalId: p.id }, "localhost", T0);
    const body = { parentKey: "jo", proposalId: p.id, passkey: browserResponse("cred-jo", "webauthn.get", o.challenge as string) };
    expect(await mockPasskeys.approvePayment(db, body, T0)).toBeUndefined();          // still open: payProposal says why
    expect(await mockPasskeys.approvePayment(db, { parentKey: "jo", proposalId: p.id }, T0)).toBeUndefined(); // no assertion
    expect(challengeOf(await parent("jo"))?.challenge).toBe(o.challenge);
    await decideProposal(db, { parentKey: "mina", proposalId: p.id, decision: "accepted" });
    await decideProposal(db, { parentKey: "jo", proposalId: p.id, decision: "accepted" });
    expect(await mockPasskeys.approvePayment(db, body, T0)).toBe(p.id);
  });

  it("approvePayment stores the authenticator's new signature counter", async () => {
    await db.Parent.update(ids.jo, { passkeys: [fakeKey({ credentialId: "cred-c", counter: 3 })] });
    const p = await bothAccepted();
    const o = await startPaymentApproval(db, { parentKey: "jo", proposalId: p.id }, "localhost", T0);
    const id = await approvePayment(db, { parentKey: "jo", proposalId: p.id, passkey: { id: "cred-c" } }, async ({ challenge, passkey }) => {
      expect(challenge).toBe(o.challenge);
      expect(passkey.counter).toBe(3);
      return { newCounter: 4 };
    }, T0);
    expect(id).toBe(p.id);
    expect(passkeysOf(await parent("jo"))[0].counter).toBe(4);
  });

  it("a parent without passkeys pays as before (no approval asked)", async () => {
    const p = await bothAccepted();
    expect(await approvePayment(db, { parentKey: "jo", proposalId: p.id, passkey: { id: "x" } }, async () => { throw new Error("not called"); }, T0)).toBeUndefined();
    expect((await payProposal(db, { parentKey: "jo", proposalId: p.id }, { delayMs: 0 })).proposal.status).toBe("paid");
  });

  it("setMandate can't turn Face ID off while a passkey is saved (removing the passkeys does)", async () => {
    await registerJo();
    await expect(setMandate(db, { parentKey: "jo", mandate: { requirePasskey: false } })).rejects.toThrow(/stays on.*Remove your passkeys/);
    expect((await setMandate(db, { parentKey: "jo", mandate: { requirePasskey: true, maxPriceCents: 3000 } })).requirePasskey).toBe(true);
  });
});

// ---------------------------------------------------------------- RESET (shared demo parents)

describe("demo reset", () => {
  it("trustReset: default rules, no passkeys, no live challenge ({} not null)", () => {
    expect(trustReset()).toEqual({ mandate: defaultMandate(), passkeys: [], passkeyChallenge: {} });
  });

  it("RESET clears one visitor's rules and passkey so the next visitor starts clean", async () => {
    await registerJo("judge-1-phone");
    await startPaymentApproval(db, { parentKey: "jo", proposalId: (await bothAccepted()).id }, "localhost", T0);
    await setMandate(db, { parentKey: "jo", mandate: { maxPriceCents: 1000, agentMayPropose: false } });
    await applySeed(db, seedPlan());                                            // what demoReset runs
    const jo = await parent("jo");
    expect(jo.id).toBe(ids.jo);                                                 // same row, same id
    expect(passkeysOf(jo)).toEqual([]);
    expect(challengeOf(jo)).toBeNull();
    expect(await getTrust(db, { parentKey: "jo" })).toEqual({ mandate: defaultMandate(), spentThisMonthCents: 0, passkeys: [] });
    expect(publicParent(jo)).not.toHaveProperty("passkeys");
  });
});
