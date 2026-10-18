// (C) deno test --no-lock base44/shared/c/c_test.ts
// no jsr dependency so the test runs offline
function assert(c: unknown, msg = "assert"): asserts c { if (!c) throw new Error(msg); }
function assertEquals(a: unknown, b: unknown, msg = "") { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${msg ? msg + ": " : ""}expected ${y} got ${x}`); }
import {
  band, bearingDeg, DEMO_LAWN, demoHome, destination, haversineM, pairKey, roundBearing, roundDemoDistance, stepToward,
  withinEncounter,
} from "./geo.ts";
import { localTranscript } from "./location.ts";
import { normalizePhone, parseInbound } from "./photon.ts";
import { isTradeCommand, mentionsTrade, parseIntent, priceRule, t, tl } from "./wording.ts";

const A = { lat: 34.0709, lng: -118.4446 };

Deno.test("haversine / bearing / band", () => {
  const north120 = stepToward(A, { lat: A.lat + 0.01, lng: A.lng }, 120);
  const d = haversineM(A, north120);
  assert(Math.abs(d - 120) < 0.5, `got ${d}`);
  assertEquals(Math.round(bearingDeg(A, north120)), 0);
  assertEquals(band(d), "100-300m");
  assertEquals(band(60), "25-100m");
  assertEquals(band(25), "<25m");
  assertEquals(band(301), null);
});

Deno.test("demo walk reaches encounter in 5 m steps", () => {
  let p = stepToward(A, { lat: A.lat + 0.01, lng: A.lng }, 120);
  let steps = 0;
  while (haversineM(p, A) > 25 && steps < 100) {
    p = stepToward(p, A, 5);
    steps++;
  }
  assert(steps >= 19 && steps <= 20, `steps=${steps}`);
});

Deno.test("encounter rule: accuracy and simulated", () => {
  const base = { parentId: "a", ...A, accuracyM: 10, simulated: false, updatedAt: new Date().toISOString() };
  const near = { ...base, parentId: "b", lat: A.lat + 0.0001 }; // ~11 m
  assert(withinEncounter(base, near));
  assert(!withinEncounter(base, { ...near, accuracyM: 45 }));
  assert(withinEncounter({ ...base, simulated: true, accuracyM: 999 }, { ...near, simulated: true, accuracyM: 999 }));
  assert(!withinEncounter({ ...base, simulated: true }, { ...near, accuracyM: 45 }));
  assertEquals(pairKey("b", "a"), "a|b");
});

Deno.test("photon inbound parse", () => {
  const ev = {
    id: "evt_1",
    type: "message.received",
    source: "imessage.photon",
    data: {
      object: {
        id: "msg_1",
        sentBy: { handle: "+1 (310) 555-0100", userId: "u_1" },
        receivedBy: { userId: "line_1" },
        spaceId: "sp_1",
        content: [{ type: "text", text: "sell it" }, { type: "attachment", attachmentId: "att_1" }],
      },
    },
  };
  const m = parseInbound(ev)!;
  assertEquals(m.text, "sell it");
  assertEquals(m.attachmentIds, ["att_1"]);
  assertEquals(m.lineUserId, "line_1");
  assertEquals(normalizePhone(m.fromHandle), "13105550100");
  assertEquals(parseInbound({ type: "message.sent" }), null);
});

Deno.test("intents + price rule", () => {
  assertEquals(parseIntent("Sell it"), "sell");
  assertEquals(parseIntent("yes"), "yes");
  assertEquals(parseIntent("I accept"), "accept");
  assertEquals(parseIntent("no thanks"), "decline");
  assertEquals(parseIntent("hi"), "hi");
  // "pass" declines a trade, but "pass it on" (the nudge's own words) sells
  assertEquals(parseIntent("pass it on"), "sell");
  assertEquals(parseIntent("pass on it"), "sell");
  assertEquals(parseIntent("I'll pass"), "decline");
  // opt-out / opt-in / cancel / status
  assertEquals(parseIntent("STOP"), "stop");
  assertEquals(parseIntent("please stop texting me"), "stop");
  assertEquals(parseIntent("unsubscribe"), "stop");
  assertEquals(parseIntent("Start"), "start");
  assertEquals(parseIntent("cancel"), "cancel");
  assertEquals(parseIntent("never mind"), "cancel");
  assertEquals(parseIntent("status"), "status");
  assertEquals(parseIntent("any updates?"), "status");
  assertEquals(parseIntent("what's the weather"), "unknown");
  assertEquals(parseIntent("stop by the park later"), "later");   // not an opt-out: only the clear phrases are
  for (const s of ["STOP please", "please stop", "Stop, thanks", "stop it!", "unsubscribe me", "don’t text me"]) {
    assertEquals(parseIntent(s), "stop", s);
  }
  // A trade is never accepted from a word inside a sentence; refusals and negations come first.
  for (const s of ["accept", "Accept!", "I accept", "yes, accept", "accept the trade", "Deal!", "it’s a deal", "I'll take it", "I’ll take it 👍", "yes to the trade"]) {
    assertEquals(parseIntent(s), "accept", s);
  }
  for (const s of ["no deal", "No deal, thanks", "Not a deal I want", "not a good deal", "I don't accept", "do not accept",
    "can’t accept that", "don't take it", "no thank you", "not interested", "I'll pass on this one", "I’ll pass on it", "nah thanks"]) {
    assertEquals(parseIntent(s), "decline", s);
  }
  for (const s of ["is that a good deal?", "what's the deal", "I'll take a look", "should I take it?", "should I decline?", "Deal?"]) {
    assert(!["accept", "decline"].includes(parseIntent(s)), s);
  }
  assertEquals(parseIntent("I'll take a look later"), "later");
  assertEquals(parseIntent("I'll pass it on"), "sell");
  assertEquals(parseIntent("yes please"), "yes");
  assertEquals(parseIntent("yes!!"), "yes");
  assertEquals(isTradeCommand("I decline"), true);
  assertEquals(isTradeCommand("accept"), true);
  assertEquals(isTradeCommand("no thanks"), false);
  assertEquals(isTradeCommand("Deal!"), false);
  assertEquals(mentionsTrade("is that a good deal?"), true);
  assertEquals(mentionsTrade("I'll take a look"), false);
  assertEquals(priceRule(3000, 1), "2nd owner pays 60% of $30.00");
  assertEquals(priceRule(3000, 2), "3rd owner pays 40% of $30.00");
});

Deno.test("destination / rounding / demo spots", () => {
  const p = destination(A, 47, 60);
  assert(Math.abs(haversineM(A, p) - 60) < 0.01, `got ${haversineM(A, p)}`);
  assertEquals(roundBearing(bearingDeg(A, p)), 45);
  assertEquals(roundBearing(358), 0);
  assertEquals(roundDemoDistance(87.4), 85);
  assertEquals(roundDemoDistance(88), 90);
  // Mina on the lawn, Jo where the walk starts (120 m north), Sam 200 m east: nobody meets on page load.
  const mina = demoHome({ id: "m", key: "mina" }), jo = demoHome({ id: "j", key: "jo" }), sam = demoHome({ id: "s", key: "sam" });
  assert(haversineM(mina, DEMO_LAWN) < 0.01);
  assert(Math.abs(haversineM(jo, mina) - 120) < 0.5);
  assertEquals(Math.round(bearingDeg(mina, jo)), 0);
  for (const [a, b] of [[mina, jo], [mina, sam], [jo, sam]]) assert(haversineM(a, b) > 100);
  // unknown parents get a stable spot 250 m out
  const x = demoHome({ id: "parent_xyz" });
  assertEquals(demoHome({ id: "parent_xyz" }), x);
  assert(Math.abs(haversineM(x, DEMO_LAWN) - 250) < 0.5);
});

Deno.test("local transcript: the pets' lines for the romper", () => {
  const lines = localTranscript("jo", "mina", { listingId: "l", itemName: "Yellow duck romper", size: "6-9M", priceCents: 1800, wearWeeksLeft: 4 }, 0);
  assertEquals(lines.map((l) => l.kind), ["looking_for", "have", "fit_check", "propose", "ack"]);
  assertEquals(lines[3].text, "Trade proposal! $18.00 — nothing is charged until you both accept.");
  assertEquals(lines.map((l) => l.parentId), ["jo", "mina", "jo", "jo", "mina"]);
  // the buyer's pet ran the fit for its own child
  assertEquals(lines[2].text, "My little one fits it for about 4 more weeks.");
});

Deno.test("wording mirrors agents/wording.py", () => {
  assertEquals(tl.hello("Pip"), "Pip: Hi! Anything on your list for your little one?");
  assertEquals(tl.notNeeded("Pip"), "Pip: Thanks, but that won't fit my little one.");
  assertEquals(tl.lookingFor(["6-9M"], ["top", "onesie"], "Pip"), "Pip: Looking for 6-9M top or onesie!");
  assertEquals(t.notYet(), "Both of you need to accept first — nothing is charged until then.");
  assertEquals(t.inTrade("romper"), "The romper already has a trade open — answer that one first.");
  assertEquals(t.alreadyListed("romper", 1800), "The romper is already listed at $18.00. I'll tell you when a friend's pet wants it.");
  assertEquals(t.listFailed("romper"), "I couldn't list the romper just now — try again from the bag.");
  assertEquals(t.busy(), "The app is busy right now — give me a minute and try again.");
  assertEquals(t.expired(), "That trade timed out — $0 charged, and the listing is back up.");
});

Deno.test("iMessage lines: short, plain, and every pay surface says demo payment · no real charge", () => {
  const link = "https://sproutpass.test/trade/p1?as=jo";
  for (const line of [t.approveInApp(link), t.payInApp(link), t.bothAccepted(link)]) {
    assert(line.includes("demo payment · no real charge"), line);
    assert(line.endsWith(link), line);
  }
  assert(t.payInApp(link).startsWith("I never pay by text."));
  assertEquals(t.quote("romper", "gently_used", 1800, 3000, 1, "Tiny stain on the cuff."),
    `That's the romper, gently used (Tiny stain on the cuff). Fair price $18.00 (2nd owner pays 60% of $30.00) — reply "yes" to list it, or tell me a different condition.`);
  assert(t.quote("romper", "well_loved", 1, 1, 1, "x".repeat(200)).includes("x".repeat(79) + "…)"), "long notes are clipped");
  assertEquals(t.status([]), "All quiet: nothing listed and no open trades. Send a photo to pass something on.");
  const all = [
    t.hello("Pip"), t.help(), t.nudge("romper", "6-9M"), t.nudgeWhich(), t.askPhoto("romper"), t.askWhich(), t.photoWhich(),
    t.quote("romper", "like_new", 1800, 3000, 1), t.pickCondition(), t.listedNow("romper", 1800, 3000, 1), t.cancelled(),
    t.nothingToCancel(), t.approveInApp(link), t.payInApp(link), t.stopped(), t.started("Pip"), t.pausedHelp(), t.slowDown(),
    t.status(["romper listed at $18.00"]),
  ];
  for (const line of all) {
    assert(!/[*#`]/.test(line), `no markdown: ${line}`);
    assert(line.split(/[.!?] /).length <= 3, `≤ 2 sentences-ish: ${line}`);
    assert(line.length <= 240, `short: ${line}`);
  }
});
