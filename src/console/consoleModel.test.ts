import { describe, expect, it } from "vitest";
import type { AgentLogEntry, AgentTurn } from "../app/types";
import { declineSummary, mockAgentAddress, RULE_PHRASE } from "../app/mockWorld";
import {
  ago, capital, CLOSING_TYPES, encounterChip, encounterEngine, encParam, exchangeMs, priceRule, proposalStatus, refusalOf,
  resolveSides, scanPrivacy, selectEncounter, shortAddress, stripEncounters, typeLabel, withEncParam, withPinned,
} from "./consoleModel";

const A = "agent1qf3xk7v0d8s2l4m9n6p5r3t1w0y8u7i6o5a4s3d2f1g0h9j8k7";
const B = "agent1qz9y8x7w6v5u4t3s2r1q0p9o8n7m6l5k4j3h2g1f0d9s8a7p6";
const at = (s: number) => new Date(Date.UTC(2026, 9, 18, 12, 0, s)).toISOString();
const entry = (p: Partial<AgentLogEntry>): AgentLogEntry => ({ at: at(0), from: "", to: "", type: "LookingFor", summary: "", by: "fetch", ...p });
const turn = (parentId: string, kind: AgentTurn["kind"], text = ""): AgentTurn => ({ from: "buyer_agent", parentId, kind, text, at: at(0) });

describe("addresses + labels", () => {
  it("shortens agent addresses as agent1q…last4, leaves other ids alone", () => {
    expect(shortAddress(A)).toBe("agent1q…j8k7");
    expect(shortAddress(mockAgentAddress("p1"))).toMatch(/^mock1q…[0-9a-z]{4}$/);
    expect(shortAddress("fallback")).toBe("fallback");
    expect(shortAddress(undefined)).toBe("");
  });

  it("turns protocol types into words", () => {
    expect(typeLabel("LookingFor")).toBe("Looking for");
    expect(typeLabel("HaveListings")).toBe("Have listings");
    expect(typeLabel("TradeAck")).toBe("Trade ack");
    expect(typeLabel("NoFit")).toBe("No fit");
  });
});

describe("resolveSides", () => {
  it("Fetch: learns each agent's address from the pets' matching lines", () => {
    // bId is the lexically smaller id, but here aId's pet spoke first (the transcript says so)
    const enc = { aId: "p2", bId: "p1", transcript: [turn("p2", "looking_for"), turn("p1", "have"), turn("p2", "propose"), turn("p1", "ack")] };
    const log = [
      entry({ from: A, to: B, type: "LookingFor" }),
      entry({ from: B, to: A, type: "HaveListings" }),
      entry({ from: A, to: B, type: "ProposeTrade" }),
      entry({ from: B, to: A, type: "TradeAck" }),
    ];
    const s = resolveSides(enc, log);
    expect(s.dir).toEqual(["a", "b", "a", "b"]);
    expect(s.addr).toEqual({ a: A, b: B });
    expect(s.engine).toEqual({ a: "fetch", b: "fetch" });
    expect(s.sent).toEqual({ a: 2, b: 2 });
  });

  it("mock: stand-in addresses are derived from the parent ids", () => {
    const enc = { aId: "jo", bId: "mina", transcript: [] };
    const log = [
      entry({ from: mockAgentAddress("mina"), to: mockAgentAddress("jo"), by: "mock" }),
      entry({ from: mockAgentAddress("jo"), to: mockAgentAddress("mina"), by: "mock", type: "NoFit" }),
    ];
    const s = resolveSides(enc, log);
    expect(s.dir).toEqual(["b", "a"]);
    expect(s.engine).toEqual({ a: "mock", b: "mock" });
  });

  it("no addresses and no lines (fallback): the opener speaks first, then turns alternate", () => {
    const enc = { aId: "z9", bId: "a1", transcript: [], negotiatedBy: "local" as const };
    const log = [entry({ from: "fallback", to: "fallback", by: "fallback" }), entry({ from: "fallback", to: "fallback", by: "fallback", type: "NoFit" })];
    expect(resolveSides(enc, log).dir).toEqual(["b", "a"]);
    // nothing said yet: the engine comes from negotiatedBy
    expect(resolveSides(enc, []).engine).toEqual({ a: "fallback", b: "fallback" });
    expect(resolveSides({ ...enc, negotiatedBy: undefined }, []).engine).toEqual({});
  });
});

describe("engine + outcome", () => {
  it("the encounter's engine: its messages, then negotiatedBy, then the proposal's source", () => {
    expect(encounterEngine({ agentLog: [entry({ by: "mock" })] })).toBe("mock");
    expect(encounterEngine({ negotiatedBy: "fetch" })).toBe("fetch");
    expect(encounterEngine({}, { source: "local" })).toBe("fallback");
    expect(encounterEngine({})).toBeNull();
  });

  it("proposal status in words; nothing charged on every dead end", () => {
    expect(proposalStatus({ status: "open", sellerDecision: "pending", buyerDecision: "pending" }).label).toBe("Open · waiting for both parents");
    expect(proposalStatus({ status: "open", sellerDecision: "accepted", buyerDecision: "pending" }).label).toBe("Open · 1 of 2 accepted");
    expect(proposalStatus({ status: "paid", sellerDecision: "accepted", buyerDecision: "accepted" }).label).toMatch(/demo payment/);
    for (const status of ["declined", "expired", "payment_failed"] as const) {
      expect(proposalStatus({ status, sellerDecision: "pending", buyerDecision: "pending" }).label).toMatch(/nothing charged/);
    }
  });

  it("the 60% / 40% rule from the snapshot", () => {
    expect(priceRule({ previousOwners: 1, originalPriceCents: 3000, priceCents: 1800 })).toBe("2nd owner pays 60% of $30.00 = $18.00");
    expect(priceRule({ previousOwners: 2, originalPriceCents: 3000, priceCents: 1200 })).toBe("3rd owner pays 40% of $30.00 = $12.00");
  });

  it("the strip chip follows the trade once there is one: a paid trade never reads 'Proposed'", () => {
    const proposed = { status: "proposed" as const, agentLog: [] };
    expect(encounterChip(proposed, { status: "paid" })).toEqual({ label: "Paid", tone: "mint" });
    expect(encounterChip(proposed, { status: "both_accepted" }).label).toBe("Accepted");
    expect(encounterChip(proposed, { status: "open" }).label).toBe("Open");
    expect(encounterChip(proposed, { status: "declined" }).label).toBe("Declined");
    expect(encounterChip(proposed, { status: "expired" }).label).toBe("Expired");
    expect(encounterChip(proposed).label).toBe("Proposed"); // its proposal not read yet
    expect(encounterChip({ status: "talking" }).label).toBe("Talking");
    expect(encounterChip({ status: "no_match", agentLog: [entry({ type: "NoFit" })] }).label).toBe("No match");
    const stopped = { status: "no_match" as const, agentLog: [entry({ type: "Decline", summary: declineSummary({ rule: "over_price", phrase: RULE_PHRASE.over_price }) })] };
    expect(encounterChip(stopped)).toEqual({ label: "Stopped", tone: "pink" });
  });

  it("refusals: the buyer's pet rules (mock tag, C's fallback wording, noMatchReason), another rule, or none", () => {
    const decline = (summary: string) => ({ status: "no_match" as const, agentLog: [entry({}), entry({ type: "HaveListings" }), entry({ type: "Decline", summary })] });
    expect(refusalOf(decline(declineSummary({ rule: "over_price", phrase: RULE_PHRASE.over_price }))))
      .toEqual({ at: 2, rules: true, reason: "over the price limit" });
    expect(refusalOf(decline("Buyer side declines: over the budget the buyer set for their pet. Nothing was proposed.")))
      .toEqual({ at: 2, rules: true, reason: "over the budget the buyer set for their pet" });
    expect(refusalOf(decline(declineSummary({ rule: null, phrase: "another trade is already open on it" }))))
      .toEqual({ at: 2, rules: false, reason: "another trade is already open on it" });
    expect(refusalOf({ status: "no_match", agentLog: [], noMatchReason: "It costs more than the price limit Jo set for Pip." }))
      .toEqual({ at: -1, rules: true, reason: "It costs more than the price limit Jo set for Pip" });
    expect(refusalOf({ status: "no_match", agentLog: [entry({}), entry({ type: "NoFit" })] })).toBeNull();
    expect(refusalOf({ status: "proposed", agentLog: [entry({ type: "Decline" })] })).toBeNull();
    expect(CLOSING_TYPES.has("Decline") && CLOSING_TYPES.has("NoFit") && !CLOSING_TYPES.has("HaveListings")).toBe(true);
    expect(capital("over the price limit")).toBe("Over the price limit");
  });
});

describe("privacy scan", () => {
  it("passes clean protocol messages and pet lines", () => {
    const log = [entry({ summary: "Looking for size 6-9M (top, onesie) for a 7-month-old." }),
      entry({ summary: "Proposes the Yellow duck romper at $18.00 (60% of $30.00, 2nd owner)." })];
    const scan = scanPrivacy(log, [turn("p", "propose", "Pip: How about $18.00?")], ["Mina", "Jo"]);
    expect(scan).toEqual({ messages: 2, lines: 1, findings: [] });
  });

  it("flags names, phones, coordinates and birthdates, saying where", () => {
    const log = [
      entry({ summary: "Jo's kid wants it" }),
      entry({ summary: "call +13105551234" }),
      entry({ summary: "meet at 34.06891, -118.44520" }),
      entry({ summary: "child born 2025-12-10" }),
    ];
    const kinds = scanPrivacy(log, [], ["Jo"]).findings.map((f) => `${f.kind}@${f.where}`);
    expect(kinds).toEqual(["name@message 1", "phone@message 2", "location@message 3", "birthdate@message 4"]);
    // "Joggers" is not "Jo"
    expect(scanPrivacy([entry({ summary: "Sage cotton joggers. Joggers!" })], [], ["Jo"]).findings).toEqual([]);
  });
});

describe("time", () => {
  it("ago + the exchange's length", () => {
    const now = Date.parse(at(0)) + 90_000;
    expect(ago(at(0), now)).toBe("1 min ago");
    expect(ago(at(0), Date.parse(at(3)))).toBe("just now");
    expect(exchangeMs([entry({ at: at(1), ms: 300 }), entry({ at: at(2), ms: 400 })])).toBe(1300);
    expect(exchangeMs([])).toBeNull();
  });
});

describe("deep link: /agents?enc=<id>", () => {
  const enc = (id: string, s: number) => ({ id, startedAt: at(s) });
  const list = [enc("enc_new", 50), enc("enc_mid", 30), enc("enc_old", 10)]; // newest first, like the hook

  it("reads ?enc= next to the carried params, ignores junk", () => {
    expect(encParam("?as=jo&demo=1&enc=enc_mid")).toBe("enc_mid");
    expect(encParam("?enc=6650f0c2a1b2c3d4e5f60718")).toBe("6650f0c2a1b2c3d4e5f60718"); // a Base44 id
    expect(encParam("?enc=%20enc_mid%20")).toBe("enc_mid");
    expect(encParam("?as=jo")).toBeNull();
    expect(encParam("?enc=")).toBeNull();
    expect(encParam("?enc=<script>")).toBeNull();
    expect(encParam(`?enc=${"x".repeat(65)}`)).toBeNull();
  });

  it("picking writes ?enc=, follow live removes it; ?as= / ?demo= / ?view= stay", () => {
    expect(withEncParam("?as=jo&demo=1", "enc_mid")).toBe("?as=jo&demo=1&enc=enc_mid");
    expect(withEncParam("?as=jo&enc=enc_old&view=big", "enc_mid")).toBe("?as=jo&enc=enc_mid&view=big");
    expect(withEncParam("?as=jo&demo=1&enc=enc_mid", null)).toBe("?as=jo&demo=1");
    expect(withEncParam("?enc=enc_mid", null)).toBe("");
  });

  it("a pin opens that encounter (even the newest: follow live is off); no pin follows the newest", () => {
    expect(selectEncounter(list, "enc_mid")?.id).toBe("enc_mid");
    expect(selectEncounter(list, "enc_new")?.id).toBe("enc_new");
    expect(selectEncounter(list, null)?.id).toBe("enc_new");
    // a new meeting arrives: the pin holds, following moves on
    const more = [enc("enc_newer", 60), ...list];
    expect(selectEncounter(more, "enc_mid")?.id).toBe("enc_mid");
    expect(selectEncounter(more, null)?.id).toBe("enc_newer");
  });

  it("a pin that isn't in the list (gone, or still being read) shows the newest; nothing at all shows nothing", () => {
    expect(selectEncounter(list, "enc_gone")?.id).toBe("enc_new");
    expect(selectEncounter([], "enc_mid")).toBeNull();
  });

  it("an older pinned encounter joins the list in date order and keeps its tab in the strip", () => {
    const old = enc("enc_ancient", 1);
    const merged = withPinned(list, old);
    expect(merged.map((e) => e.id)).toEqual(["enc_new", "enc_mid", "enc_old", "enc_ancient"]);
    expect(withPinned(list, enc("enc_mid", 30))).toBe(list); // already there: unchanged
    expect(withPinned(list, null)).toBe(list);
    expect(stripEncounters(merged, "enc_ancient", 2).map((e) => e.id)).toEqual(["enc_new", "enc_ancient"]);
    expect(stripEncounters(merged, "enc_new", 2).map((e) => e.id)).toEqual(["enc_new", "enc_mid"]);
    expect(stripEncounters(merged, null, 2).map((e) => e.id)).toEqual(["enc_new", "enc_mid"]);
  });
});
