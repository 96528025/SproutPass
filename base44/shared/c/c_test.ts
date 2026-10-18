// (C) deno test --no-lock base44/shared/c/c_test.ts
// no jsr dependency so the test runs offline
function assert(c: unknown, msg = "assert"): asserts c { if (!c) throw new Error(msg); }
function assertEquals(a: unknown, b: unknown) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`expected ${y} got ${x}`); }
import { band, bearingDeg, haversineM, pairKey, stepToward, withinEncounter } from "./geo.ts";
import { normalizePhone, parseInbound } from "./photon.ts";
import { parseIntent, priceRule } from "./wording.ts";

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
