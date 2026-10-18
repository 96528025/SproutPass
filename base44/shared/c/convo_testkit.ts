// (C) Test support for the iMessage conversation tests (convo_test.ts, webhook_test.ts). Not a test itself.
// A whole demo world on B's in-memory fakeDb (the real seed + the real B handlers via cbridge), a stubbed Photon
// that enforces the spec's required idempotency-key, and a stubbed Base44 InvokeLLM / UploadFile. No network.

// deno-lint-ignore-file no-explicit-any
import { createFakeDb, type FakeDb } from "../testing/fakeDb.ts";
import { applySeed, DEMO_DATES, seedPlan } from "../seed.ts";
import { demoClock } from "../logic/demo.ts";
import { handlePhotonWebhook } from "./inbound.ts";
import { resetOutboundLimiter } from "./imessage.ts";
import { sweepInbox } from "./inboxFallback.ts";
import { signWebhook } from "./photon.ts";

export function assert(c: unknown, msg = "assert"): asserts c { if (!c) throw new Error(msg); }
export function assertEquals(a: unknown, b: unknown, msg = "") {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg ? msg + ": " : ""}expected ${y} got ${x}`);
}
export function assertMatch(s: string | undefined, re: RegExp, msg = "") {
  if (!re.test(s ?? "")) throw new Error(`${msg ? msg + ": " : ""}${JSON.stringify(s)} does not match ${re}`);
}

export const APP_HOST = "sproutpass.test";
export const PHONES = { mina: "+13105550101", jo: "+14245550102", sam: "+16265550103" } as const;
export const LINES = { mina: "pho_usr_line_a", jo: "pho_usr_line_b", sam: "pho_usr_line_c" } as const;
export type Who = keyof typeof PHONES;

export interface Sent { method: string; path: string; body: any; idem: string | null }

export interface Llm {
  /** What the photo guess returns (InvokeLLM with file_urls). null → the call throws (no LLM). */
  photo: Record<string, unknown> | null;
  /** What a free-text chat returns. null → throws. */
  chat: string | null;
  calls: any[];
}

export interface World {
  db: FakeDb;
  base44: any;
  ids: Record<Who, string>;
  llm: Llm;
  sent: Sent[];
  /** Text one iMessage (optionally with photo attachments) from a parent's phone, through the real webhook. */
  text(who: Who, text: string, attachments?: string[]): Promise<{ accepted: number; answered: number }>;
  /** The iMessage texts each parent received since the last call (in order). */
  inbox(who: Who): string[];
  /** All texts a parent received (text messages only), never reset. */
  all(who: Who): string[];
  /** Attachments (images) a parent received. */
  images(who: Who): number;
  setClock(now: string): Promise<number>;
  /** The app's location tick: sweep the inbox (B's events → texts). */
  tick(): Promise<number>;
  convo(who: Who): Promise<any>;
  close(): void;
}

let msgSeq = 0;

/** One Photon message.received event, as the webhook gets it. */
export function inboundEvent(phone: string, line: string, text: string, attachments: string[] = [], userId = `pho_usr_${phone.slice(-4)}`) {
  const content: any[] = [];
  if (text) content.push({ type: "text", format: "plain", text });
  for (const a of attachments) content.push({ type: "attachment", attachmentId: a });
  return {
    type: "message.received",
    apiVersion: "2026-07-01",
    data: { object: { id: `pho_msg_${++msgSeq}`, content, sentBy: { id: userId, handle: phone }, receivedBy: { id: line }, space: { id: `sp_${phone.slice(-4)}` } } },
  };
}

/** Standard Webhooks headers for a body signed with `secret` at `nowMs`. */
export async function signedHeaders(secret: string, body: string, nowMs = Date.now(), id = `msg_${++msgSeq}`) {
  const ts = Math.floor(nowMs / 1000);
  return new Headers({ "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": await signWebhook(secret, id, ts, body) });
}

export async function makeWorld(opts: { imessage?: boolean } = {}): Promise<World> {
  const env: Record<string, string> = { PHOTON_API_KEY: "test_key", PHOTON_PROJECT_ID: "pho_prj_test", APP_HOST };
  const before: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) { before[k] = Deno.env.get(k); Deno.env.set(k, v); }
  for (const k of ["SEED_PHONES", "PHOTON_WEBHOOK_SECRET"]) { before[k] = Deno.env.get(k); Deno.env.delete(k); }
  resetOutboundLimiter();

  const db = createFakeDb();
  const { parentIds } = await applySeed(db, seedPlan({ MINA_PHONE: PHONES.mina, JO_PHONE: PHONES.jo, SAM_PHONE: PHONES.sam }));
  const ids = parentIds as Record<Who, string>;
  // B's fakeDb has no PetLine entity (the in-app pet's lines): give it a bin so sendToParent's mirror lands somewhere.
  const petLines: any[] = [];
  (db as any).PetLine = { create: async (r: any) => (petLines.push(r), r) };
  const [setting] = await db.Setting.filter({ key: "demo" });
  await db.Setting.update(setting.id, { imessage: opts.imessage ?? true, matchVia: "local" });
  // Permissive pet mandates (B5's trusted checkout) so the trade flow is about the conversation, not the rules.
  for (const id of Object.values(ids)) {
    await db.Parent.update(id, { mandate: { maxPriceCents: 100_00, monthlyBudgetCents: 500_00, categories: [], requirePasskey: false, agentMayPropose: true } } as any);
  }

  const llm: Llm = { photo: { condition: "gently_used", note: "Tiny stain on the cuff.", name: "Yellow duck romper", category: "onesie", match: "" }, chat: null, calls: [] };
  const base44 = {
    entities: db,
    integrations: {
      Core: {
        InvokeLLM: async (args: any) => {
          llm.calls.push(args);
          if (args.file_urls?.length) {
            if (!llm.photo) throw new Error("no LLM key");
            return { ...llm.photo };
          }
          if (llm.chat === null) throw new Error("no LLM key");
          return llm.chat;
        },
        UploadFile: async () => ({ file_url: `https://files.${APP_HOST}/up.jpg` }),
      },
    },
  };

  // ---- stub Photon (and the images the pet attaches: the flowers GIF, a trade's product photo) --------------------
  const sent: Sent[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/fx/flowers.gif")) return new Response(new Uint8Array([71, 73, 70, 56]), { status: 200, headers: { "content-type": "image/gif" } });
    if (!url.startsWith("https://api.photon.codes/") && /\.(?:jpe?g|png)$/i.test(new URL(url).pathname)) {
      return new Response(new Uint8Array([255, 216, 255]), { status: 200, headers: { "content-type": "image/jpeg" } });
    }
    if (!url.startsWith("https://api.photon.codes/")) throw new Error(`unexpected fetch ${url}`);
    const path = new URL(url).pathname;
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : {};
    sent.push({ method, path, body, idem: headers.get("idempotency-key") });
    if (method === "POST" && !headers.get("idempotency-key")) return new Response('{"code":"INVALID_REQUEST"}', { status: 400 });
    const id = path.endsWith("/attachments") ? "att_up_1" : path.endsWith("/users") ? `u_${body.handle}` : path.endsWith("/spaces") ? "sp_new" : `msg_${sent.length}`;
    return new Response(JSON.stringify({ id }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const spaceOf = (who: Who) => `sp_${PHONES[who].slice(-4)}`;
  const delivered = (who: Who) => sent.filter((s) => s.path.endsWith("/messages") && s.body.spaceId === spaceOf(who));
  const textsOf = (who: Who) => delivered(who).filter((s) => s.body.content?.type === "text").map((s) => s.body.content.text as string);
  const seen: Record<string, number> = {};

  const world: World = {
    db, base44, ids, llm, sent,
    async text(who, text, attachments = []) {
      const rawBody = JSON.stringify(inboundEvent(PHONES[who], LINES[who], text, attachments));
      const res = await handlePhotonWebhook({
        base44, db, rawBody, headers: new Headers(),
        uploadPhotos: async (aids) => aids.map((a) => `https://files.${APP_HOST}/${a}.jpg`),
      });
      return { accepted: res.accepted, answered: res.answered };
    },
    inbox(who) {
      const all = textsOf(who);
      const out = all.slice(seen[who] ?? 0);
      seen[who] = all.length;
      return out;
    },
    all: (who) => textsOf(who),
    images: (who) => delivered(who).filter((s) => s.body.content?.type === "attachment").length,
    setClock: async (now) => (await demoClock(db, { now })).nudgesCreated,
    tick: async () => (await sweepInbox(base44, db)).handled,
    convo: async (who) => (await db.Parent.get(ids[who])).convo ?? {},
    close() {
      globalThis.fetch = real;
      for (const [k, v] of Object.entries(before)) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
      resetOutboundLimiter();
    },
  };
  return world;
}

/** Every parent texts their pool number "hi" first (a shared line can't send the first message). */
export async function sayHi(w: World, ...who: Who[]) {
  for (const p of who) {
    await w.text(p, "hi");
    w.inbox(p);
  }
}

export { DEMO_DATES };

/** Run `fn` against a fresh world, always restoring fetch and env. */
export async function withWorld(fn: (w: World) => Promise<void>, opts: { imessage?: boolean } = {}) {
  const w = await makeWorld(opts);
  try { await fn(w); } finally { w.close(); }
}
