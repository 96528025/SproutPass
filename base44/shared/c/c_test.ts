// (C) deno test --no-lock base44/shared/c/c_test.ts
// no jsr dependency so the test runs offline
function assert(c: unknown, msg = "assert"): asserts c { if (!c) throw new Error(msg); }
function assertEquals(a: unknown, b: unknown) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`expected ${y} got ${x}`); }
import {
  band, bearingDeg, DEMO_LAWN, demoHome, destination, haversineM, pairKey, roundBearing, roundDemoDistance, stepToward,
  withinEncounter,
} from "./geo.ts";
import { localTranscript } from "./location.ts";
import { normalizePhone, parseInbound } from "./photon.ts";
import { parseIntent, priceRule, t, tl } from "./wording.ts";

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
