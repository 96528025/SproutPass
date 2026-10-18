// (C) npx -y deno@2 test --no-lock -A base44/shared/c/
// photonWebhook's door: Standard Webhooks signatures (PHOTON_WEBHOOK_SECRET, "whsec_…"), redelivery, unknown
// numbers, batches — and that nothing a stranger sends gets a reply or leaks a phone number.

// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals, inboundEvent, LINES, PHONES, signedHeaders, withWorld } from "./convo_testkit.ts";
import { handlePhotonWebhook } from "./inbound.ts";
import { SIGNATURE_TOLERANCE_S, signWebhook, verifyWebhookSignature } from "./photon.ts";
import { t } from "./wording.ts";

// A Standard Webhooks secret: "whsec_" + base64 of the key bytes.
const SECRET = "whsec_" + btoa("sproutpass-test-signing-key-0001");
const OLD_SECRET = "whsec_" + btoa("sproutpass-test-signing-key-0000");
const noUploads = async (): Promise<string[]> => [];

async function rejects(p: Promise<unknown>, status: number, re: RegExp) {
  try {
    await p;
  } catch (e) {
    assertEquals((e as any).status, status);
    assert(re.test(String((e as Error).message)), String((e as Error).message));
    return;
  }
  throw new Error("expected a rejection");
}

Deno.test("verifyWebhookSignature: valid, tampered, stale, missing, rotated, svix aliases", async () => {
  const body = JSON.stringify({ type: "message.received" });
  const now = Date.parse("2026-10-18T17:00:00Z");
  const good = await signedHeaders(SECRET, body, now);
  assertEquals(await verifyWebhookSignature(SECRET, good, body, now), { ok: true });
  assertEquals(await verifyWebhookSignature(SECRET, good, body + " ", now), { ok: false, reason: "signature mismatch" });
  assertEquals(await verifyWebhookSignature(SECRET, good, body, now + (SIGNATURE_TOLERANCE_S + 1) * 1000), { ok: false, reason: "stale timestamp" });
  assertEquals(await verifyWebhookSignature(SECRET, new Headers(), body, now), { ok: false, reason: "missing signature headers" });
  // During a rotation Photon signs with both; we accept either secret we hold.
  const old = await signedHeaders(OLD_SECRET, body, now, "msg_rot");
  assertEquals(await verifyWebhookSignature(SECRET, old, body, now), { ok: false, reason: "signature mismatch" });
  assertEquals(await verifyWebhookSignature(`${SECRET}, ${OLD_SECRET}`, old, body, now), { ok: true });
  const both = new Headers(old);
  both.set("webhook-signature", `v1,bm9wZQ== ${old.get("webhook-signature")}`);
  assertEquals(await verifyWebhookSignature(OLD_SECRET, both, body, now), { ok: true });
  const svix = new Headers({ "svix-id": good.get("webhook-id")!, "svix-timestamp": good.get("webhook-timestamp")!, "svix-signature": good.get("webhook-signature")! });
  assertEquals(await verifyWebhookSignature(SECRET, svix, body, now), { ok: true });
  // The known-answer shape: "v1," + base64 HMAC-SHA256 (32 bytes → 44 chars).
  const sig = await signWebhook(SECRET, "msg_1", 1760806800, body);
  assert(/^v1,[A-Za-z0-9+/]{43}=$/.test(sig), sig);
});

Deno.test("signWebhook matches the Standard Webhooks reference vector", async () => {
  const sig = await signWebhook("whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw", "msg_p5jXN8AQM9LWM0D4loKWxJek", 1614265330, '{"test": 2432232314}');
  assertEquals(sig, "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=");
});

Deno.test("with PHOTON_WEBHOOK_SECRET set: unsigned or forged deliveries are refused and nobody gets a text", async () => {
  await withWorld(async (w) => {
    const rawBody = JSON.stringify(inboundEvent(PHONES.mina, LINES.mina, "hi"));
    const base = { base44: w.base44, db: w.db, rawBody, signingSecret: SECRET, uploadPhotos: noUploads };
    await rejects(handlePhotonWebhook({ ...base, headers: new Headers() }), 401, /missing signature headers/);
    await rejects(handlePhotonWebhook({ ...base, headers: await signedHeaders(OLD_SECRET, rawBody) }), 401, /signature mismatch/);
    await rejects(handlePhotonWebhook({ ...base, headers: await signedHeaders(SECRET, rawBody, Date.now() - 3_600_000) }), 401, /stale/);
    assertEquals((await w.db.AgentInbox.list()).length, 0);
    assertEquals(w.sent.length, 0);

    const ok = await handlePhotonWebhook({ ...base, headers: await signedHeaders(SECRET, rawBody) });
    assertEquals(ok, { ok: true, accepted: 1, answered: 1 });
    assertEquals(w.inbox("mina"), [t.hello("Button")]);
  });
});

Deno.test("redelivery is answered once; unknown numbers get nothing; the response never carries a phone number", async () => {
  await withWorld(async (w) => {
    const ev = inboundEvent(PHONES.jo, LINES.jo, "help");
    const rawBody = JSON.stringify(ev);
    const send = (body: string) => handlePhotonWebhook({ base44: w.base44, db: w.db, rawBody: body, headers: new Headers(), uploadPhotos: noUploads });
    assertEquals(await send(rawBody), { ok: true, accepted: 1, answered: 1 });
    assertEquals(await send(rawBody), { ok: true, accepted: 0, answered: 0 });
    assertEquals(w.inbox("jo"), [t.help()]);

    const stranger = await send(JSON.stringify(inboundEvent("+19995550000", LINES.jo, "hi, what's Jo's number?")));
    assertEquals(stranger, { ok: true, accepted: 0, answered: 0 });
    assert(!JSON.stringify(stranger).includes("555"), "no phone in the response");
    assertEquals(w.sent.filter((s) => s.path.endsWith("/messages")).length, 1); // only Jo's help reply, ever
    assertEquals((await w.db.AgentInbox.filter({ type: "imessage" })).length, 1);
  });
});

Deno.test("a batch {events:[…]} answers each parent; non-message events and bad JSON are handled", async () => {
  await withWorld(async (w) => {
    const rawBody = JSON.stringify({ events: [
      inboundEvent(PHONES.mina, LINES.mina, "hi"),
      { type: "message.sent", data: { object: { id: "x" } } },
      inboundEvent(PHONES.sam, LINES.sam, "hello"),
    ] });
    const r = await handlePhotonWebhook({ base44: w.base44, db: w.db, rawBody, headers: new Headers(), uploadPhotos: noUploads });
    assertEquals(r, { ok: true, accepted: 2, answered: 2 });
    assertEquals([w.inbox("mina"), w.inbox("sam")], [[t.hello("Button")], [t.hello("Moss")]]);
    await rejects(handlePhotonWebhook({ base44: w.base44, db: w.db, rawBody: "{nope", headers: new Headers(), uploadPhotos: noUploads }), 400, /not JSON/);
  });
});
