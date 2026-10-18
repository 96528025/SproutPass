// (C) deno test --no-lock -A base44/shared/c/imessage_test.ts
// Per-parent iMessage lines: each pet answers from the line its parent texted (Photon's shared pool gives every
// phone its own number, and a shared line can't send the first message). Runs the real recordInbound (webhook)
// and sendToParent against a fake db and a stubbed Photon that enforces the spec's required idempotency-key.
function assert(c: unknown, msg = "assert"): asserts c { if (!c) throw new Error(msg); }
function assertEquals(a: unknown, b: unknown) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`expected ${y} got ${x}`); }
import { inboundParentPatch, senderLineFor } from "./lines.ts";
import { parseInbound } from "./photon.ts";
import { sendToParent } from "./imessage.ts";
import { recordInbound } from "./inbound.ts";

// ---- fakes ------------------------------------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
type Row = Record<string, any> & { id: string };

function fakeDb(parents: Row[], setting: Row) {
  const P = new Map(parents.map((p) => [p.id, { ...p }]));
  const petLines: Row[] = [];
  const inbox: Row[] = [];
  const updates: { id: string; patch: object }[] = [];
  const order: string[] = [];
  return {
    parents: P, petLines, inbox, updates, order, setting,
    Parent: {
      list: async () => [...P.values()].map((p) => ({ ...p })),
      get: async (id: string) => { const p = P.get(id); if (!p) throw new Error("not found"); return { ...p }; },
      update: async (id: string, patch: object) => { order.push("Parent.update"); updates.push({ id, patch }); const p = { ...P.get(id)!, ...patch }; P.set(id, p); return p; },
    },
    Setting: { filter: async () => [setting] },
    PetLine: { create: async (row: Row) => { petLines.push(row); return row; } },
    AgentInbox: {
      filter: async (q: Row) => inbox.filter((r) => r.type === q.type).reverse(),
      create: async (row: object) => { order.push("AgentInbox.create"); const r = { ...row, id: `inb_${inbox.length + 1}` } as Row; inbox.push(r); return r; },
    },
  };
}

interface Sent { method: string; path: string; body: Row; idem: string | null; contentType: string | null }
const IMAGE_URL = "https://sproutpass.example/fx/flowers.gif";

/** Stub fetch for api.photon.codes. Like the real API, a POST without idempotency-key is a 400. */
function stubPhoton(fail?: { path: RegExp; status: number }): { sent: Sent[]; restore: () => void } {
  const sent: Sent[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === IMAGE_URL) return new Response(new Uint8Array([71, 73, 70, 56]), { status: 200, headers: { "content-type": "image/gif" } });
    if (!url.startsWith("https://api.photon.codes/")) throw new Error(`unexpected fetch ${url}`);
    const path = new URL(url).pathname;
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : {};
    sent.push({ method, path, body, idem: headers.get("idempotency-key"), contentType: headers.get("content-type") });
    if (method === "POST" && !headers.get("idempotency-key")) return new Response('{"code":"INVALID_REQUEST"}', { status: 400 });
    if (fail && fail.path.test(path)) return new Response('{"code":"SHARED_LINE_NOT_ASSIGNED"}', { status: fail.status });
    const id = path.endsWith("/attachments") ? "att_up_1" : path.endsWith("/users") ? `u_${body.handle}` : path.endsWith("/spaces") ? `sp_${body.participantIds?.join("+")}` : `msg_${sent.length}`;
    return new Response(JSON.stringify({ id }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { sent, restore: () => { globalThis.fetch = real; } };
}

function withPhotonEnv(extra: Record<string, string> = {}) {
  const vals: Record<string, string> = { PHOTON_API_KEY: "test_key", PHOTON_PROJECT_ID: "pho_prj_test", ...extra };
  const before: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vals)) { before[k] = Deno.env.get(k); Deno.env.set(k, v); }
  if (!("SEED_PHONES" in extra)) { before.SEED_PHONES = Deno.env.get("SEED_PHONES"); Deno.env.delete("SEED_PHONES"); }
  return () => { for (const [k, v] of Object.entries(before)) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v); };
}

async function withPhoton(fn: (sent: Sent[]) => Promise<void>, opts: { env?: Record<string, string>; fail?: { path: RegExp; status: number } } = {}) {
  const restoreEnv = withPhotonEnv(opts.env);
  const photon = stubPhoton(opts.fail);
  try { await fn(photon.sent); } finally { photon.restore(); restoreEnv(); }
}

const MINA = { id: "p_mina", key: "mina", name: "Mina", phone: "+13105550101" };
const JO = { id: "p_jo", key: "jo", name: "Jo", phone: "+14245550102" };
const setting = (extra: Record<string, unknown> = {}): Row => ({ id: "s1", key: "demo", now: "2026-10-18T17:00:00.000Z", matchVia: "local", imessage: true, ...extra });
const messages = (sent: Sent[]) => sent.filter((s) => s.path === "/v1/projects/pho_prj_test/messages");

/** A Photon message.received event (ImessageMessageReceivedEvent) from `handle` to `line` in `space`. */
const inbound = (handle: string, userId: string, line: string, space: string, extra: Record<string, unknown> = {}) => ({
  type: "message.received", apiVersion: "2026-07-01",
  data: { object: {
    id: `m_${handle}_${line}`, content: { type: "text", format: "plain", text: "hi" },
    sentBy: { id: userId, handle }, receivedBy: { id: line, handle: "+18005550000" }, space: { id: space }, ...extra,
  } },
});
const parsed = (ev: unknown) => { const m = parseInbound(ev); assert(m, "parsed"); return m; };
const noUploads = async (): Promise<string[]> => { throw new Error("no attachments expected"); };

// ---- pure helpers --------------------------------------------------------------------------------------------------

Deno.test("inboundParentPatch: only changed ids; the line and space move together", () => {
  assertEquals(inboundParentPatch({}, { fromUserId: "u1", spaceId: "s1", lineUserId: "L1" }),
    { photonUserId: "u1", photonSpaceId: "s1", photonLineUserId: "L1" });
  assertEquals(inboundParentPatch({ photonUserId: "u1", photonSpaceId: "s1", photonLineUserId: "L1" },
    { fromUserId: "u1", spaceId: "s1", lineUserId: "L1" }), {});
  // re-assigned to a new pool number: new space + new line
  assertEquals(inboundParentPatch({ photonUserId: "u1", photonSpaceId: "s1", photonLineUserId: "L1" },
    { fromUserId: "u1", spaceId: "s2", lineUserId: "L2" }), { photonSpaceId: "s2", photonLineUserId: "L2" });
  // missing fields never erase what we know
  assertEquals(inboundParentPatch({ photonLineUserId: "L1" }, {}), {});
});

Deno.test("senderLineFor: the parent's own line only (a shared line can't text first)", () => {
  assertEquals(senderLineFor({ photonLineUserId: "L_mina" }), "L_mina");
  assertEquals(senderLineFor({}), undefined);
  assertEquals(senderLineFor({ photonLineUserId: "" }), undefined);   // cleared on RESET with a new phone
});

// ---- the webhook (recordInbound) -----------------------------------------------------------------------------------

Deno.test("webhook: stores user, space and line on the parent, then queues the message for the agents", async () => {
  const db = fakeDb([MINA, JO], setting());
  const out = await recordInbound(db, parsed(inbound(MINA.phone, "u_mina", "L_A", "sp_mina")), noUploads);
  assertEquals(out.result, "accepted");
  const m = db.parents.get(MINA.id)!;
  assertEquals([m.photonUserId, m.photonSpaceId, m.photonLineUserId], ["u_mina", "sp_mina", "L_A"]);
  assertEquals(db.inbox.map((r) => [r.parentId, r.type, r.status, r.payload.text]), [[MINA.id, "imessage", "pending", "hi"]]);
  assertEquals(db.order, ["Parent.update", "AgentInbox.create"]);   // so the reply to this very "hi" has the line
});

Deno.test("webhook: redelivery is a no-op; unknown numbers are ignored; photos go through the uploader", async () => {
  const db = fakeDb([MINA], setting());
  const ev = parsed(inbound(MINA.phone, "u_mina", "L_A", "sp_mina"));
  await recordInbound(db, ev, noUploads);
  assertEquals((await recordInbound(db, ev, noUploads)).result, "duplicate");
  assertEquals((await recordInbound(db, parsed(inbound("+19995550000", "u_x", "L_A", "sp_x")), noUploads)).result, "unknown_handle");
  assertEquals(db.inbox.length, 1);
  const photo = parsed(inbound(MINA.phone, "u_mina", "L_A", "sp_mina", { id: "m_photo", content: { type: "attachment", attachmentId: "att_1" } }));
  let asked: string[] = [];
  await recordInbound(db, photo, async (ids) => { asked = ids; return ["https://files/romper.jpg"]; });
  assertEquals(asked, ["att_1"]);
  assertEquals(db.inbox[1].payload.photoUrls, ["https://files/romper.jpg"]);
});

// ---- sendToParent ---------------------------------------------------------------------------------------------------

Deno.test("two phones on different pool numbers: each pet replies from its parent's own line", async () => {
  // Production state: Mina texted first, so the old app-wide line is already hers (L_A).
  const db = fakeDb([MINA, JO], setting({ lineUserId: "L_A" }));
  await recordInbound(db, parsed(inbound(MINA.phone, "u_mina", "L_A", "sp_mina")), noUploads);
  await recordInbound(db, parsed(inbound(JO.phone, "u_jo", "L_B", "sp_jo")), noUploads);
  await withPhoton(async (sent) => {
    const a = await sendToParent(db, MINA.id, "Button here! The romper is getting snug.");
    const b = await sendToParent(db, JO.id, "Pip here! Button found a romper for you.");
    assert(a.sent && b.sent, `sent: ${JSON.stringify([a, b])}`);
    assertEquals(messages(sent).map((m) => [m.body.spaceId, m.body.senderId]), [["sp_mina", "L_A"], ["sp_jo", "L_B"]]);
    assertEquals(sent.filter((s) => !s.path.endsWith("/messages")).length, 0);   // ids came with the inbound "hi"
    assertEquals(messages(sent)[0].body.content, { type: "text", format: "plain", text: "Button here! The romper is getting snug." });
    assert(sent.every((s) => s.method !== "POST" || s.idem), "every POST carries idempotency-key");
    assertEquals(new Set(sent.map((s) => s.idem)).size, sent.length);   // a fresh key per send
  });
});

Deno.test("a parent who hasn't texted their number: skipped with zero Photon calls (even with an app-wide line)", async () => {
  const db = fakeDb([MINA], setting({ lineUserId: "L_someone_else" }));
  await withPhoton(async (sent) => {
    const r = await sendToParent(db, MINA.id, "hello");
    assertEquals(r.sent, false);
    assert(/text your assigned Photon number 'hi' first/.test(r.skipped ?? ""), r.skipped);
    assertEquals(sent.length, 0);
    assertEquals(db.petLines.map((l) => l.text), ["hello"]);   // the in-app pet still says it
  });
});

Deno.test("line known but no space yet: a 2-party space [line, user] keyed on both, and only new ids written back", async () => {
  const db = fakeDb([{ ...MINA, photonLineUserId: "L_A" }], setting());
  await withPhoton(async (sent) => {
    const r = await sendToParent(db, MINA.id, "hello");
    assert(r.sent, JSON.stringify(r));
    const users = sent.find((s) => s.path.endsWith("/users"))!;
    assertEquals([users.body, users.idem], [{ handle: MINA.phone, platform: "imessage" }, "user:13105550101"]);
    const space = sent.find((s) => s.path.endsWith("/spaces"))!;
    assertEquals([space.body.participantIds, space.idem], [["L_A", `u_${MINA.phone}`], `space:L_A:u_${MINA.phone}`]);
    assertEquals(messages(sent)[0].body.senderId, "L_A");
    assertEquals(db.updates.map((u) => Object.keys(u.patch).sort()), [["photonSpaceId", "photonUserId"]]);   // never the line
  });
});

Deno.test("user known, space missing: only the new space is written back (never the user or the line)", async () => {
  const db = fakeDb([{ ...MINA, photonLineUserId: "L_A", photonUserId: "u_mina" }], setting());
  await withPhoton(async (sent) => {
    assert((await sendToParent(db, MINA.id, "hello")).sent);
    assertEquals(sent.filter((s) => s.path.endsWith("/users")).length, 0);
    assertEquals(db.updates.map((u) => u.patch), [{ photonSpaceId: "sp_L_A+u_mina" }]);
  });
});

Deno.test("the flowers GIF: uploaded (multipart, own key) and sent from the same line and space as the text", async () => {
  const db = fakeDb([{ ...MINA, photonLineUserId: "L_A", photonSpaceId: "sp_mina", photonUserId: "u_mina" }], setting());
  await withPhoton(async (sent) => {
    assert((await sendToParent(db, MINA.id, "The romper found a new home!", IMAGE_URL)).sent);
    const up = sent.find((s) => s.path.endsWith("/attachments"))!;
    assert(up.idem && /^multipart\/related; boundary=/.test(up.contentType ?? ""), JSON.stringify(up));
    const msgs = messages(sent);
    assertEquals(msgs.map((m) => [m.body.spaceId, m.body.senderId, m.body.content.type]), [["sp_mina", "L_A", "text"], ["sp_mina", "L_A", "attachment"]]);
    assertEquals(msgs[1].body.content.attachmentId, "att_up_1");
    assertEquals(new Set(sent.map((s) => s.idem)).size, sent.length);
  });
});

Deno.test("Photon refuses (e.g. assignment expired): reported as not sent instead of throwing", async () => {
  const db = fakeDb([{ ...MINA, photonLineUserId: "L_A", photonSpaceId: "sp", photonUserId: "u" }], setting());
  await withPhoton(async () => {
    assertEquals(await sendToParent(db, MINA.id, "hello"), { sent: false, skipped: "photon 403" });
  }, { fail: { path: /\/messages$/, status: 403 } });
});

Deno.test("guards still win: iMessage off, phone not in SEED_PHONES", async () => {
  const known = { ...MINA, photonLineUserId: "L_A", photonSpaceId: "sp", photonUserId: "u" };
  const off = fakeDb([known], setting({ imessage: false }));
  const on = fakeDb([known], setting());
  await withPhoton(async (sent) => {
    assertEquals((await sendToParent(off, MINA.id, "x")).skipped, "Setting.imessage=false");
    assertEquals((await sendToParent(on, MINA.id, "x")).skipped, "phone not in SEED_PHONES");
    assertEquals(sent.length, 0);
  }, { env: { SEED_PHONES: JO.phone } });
});
