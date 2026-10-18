// (C) auth.ts — who is calling a function, and which Base44 client to use.
//
// Three kinds of callers reach C's functions:
//   1. the React app (logged-in or anonymous Base44 user)  → createClientFromRequest(req)
//   2. the Python agents (header `x-agent-key`)             → service role
//   3. Photon webhooks (query `?k=<WEBHOOK_KEY>`)            → service role
// Reads of Presence are server-only (rule 3), so every C function writes and
// reads entities through `asServiceRole`.
//
// Trust model, honestly: the hackathon app is anonymous. It picks a family with
// ?as= (ParentPicker) and sends that `parentId`; app callers are NOT bound to a
// parent, so for updatePresence / listNearby / demoWalk the parentId is a claim.
// What C enforces today:
//   - agent-only doors (agentApi, sendImessage) need `x-agent-key`;
//   - a simulated presence is server-owned (client coordinates ignored);
//   - a real fix can't teleport a parent who is live on real GPS (location.ts
//     MAX_SPEED_MPS), and others only ever get band + 5° bearing (no coordinates).
// Binding a real-GPS caller to its parent (not done yet) needs a per-parent
// token issued by B's getCloset and sent back by A's hooks, or a Base44 login
// tied to the Parent.

// deno-lint-ignore-file no-explicit-any
import { createClientFromRequest } from "npm:@base44/sdk";

let runtimeSecrets: { get(name: string): string | undefined } | null = null;
try {
  // Base44 CLI runtime exposes secrets here; falls back to Deno.env locally.
  // (specifier kept in a variable so `deno check` outside Base44 doesn't try to resolve it)
  const spec = "base44:runtime";
  const mod = await import(spec);
  runtimeSecrets = mod.secrets ?? null;
} catch {
  runtimeSecrets = null;
}

export function secret(name: string): string {
  const v = runtimeSecrets?.get(name) ?? Deno.env.get(name) ?? "";
  return v;
}

export function requireSecret(name: string): string {
  const v = secret(name);
  if (!v) throw new Error(`missing secret ${name}`);
  return v;
}

export type Base44 = any;

export interface Caller {
  base44: Base44; // always the service-role client for entity access
  db: any; // base44.asServiceRole.entities
  kind: "app" | "agent" | "webhook";
  userEmail?: string;
}

/** Constant-time-ish compare (lengths leak, fine for a demo key). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

export async function resolveCaller(
  req: Request,
  opts: { allowWebhook?: boolean } = {},
): Promise<Caller> {
  const base44 = createClientFromRequest(req);
  const sr = base44.asServiceRole;
  const db = sr.entities;

  const agentKey = req.headers.get("x-agent-key");
  if (agentKey) {
    const expected = secret("AGENT_KEY");
    if (!expected || !safeEqual(agentKey, expected)) {
      throw new HttpError(401, "bad agent key");
    }
    return { base44: sr, db, kind: "agent" };
  }

  if (opts.allowWebhook) {
    const k = new URL(req.url).searchParams.get("k") ?? "";
    const expected = secret("WEBHOOK_KEY");
    if (expected && safeEqual(k, expected)) {
      return { base44: sr, db, kind: "webhook" };
    }
    throw new HttpError(401, "bad webhook key");
  }

  // App caller. Anonymous access is fine for the public demo (see the trust
  // model above); if a user is logged in we keep the email for logs only.
  let userEmail: string | undefined;
  try {
    const me = await base44.auth.me();
    userEmail = me?.email;
  } catch {
    userEmail = undefined;
  }
  return { base44: sr, db, kind: "app", userEmail };
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Uniform JSON response + error mapping for every C function. */
export function handle(
  fn: (req: Request) => Promise<unknown>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204 });
    try {
      const data = await fn(req);
      return Response.json(data ?? { ok: true });
    } catch (e) {
      // C's HttpError, or B's (shared/errors.ts, via cbridge): both carry a numeric status.
      const s = (e as { status?: unknown } | null)?.status;
      const status = e instanceof HttpError ? e.status : typeof s === "number" ? s : 500;
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[C] ${status} ${message}`);
      return Response.json({ error: message }, { status });
    }
  };
}

export async function readJson<T = any>(req: Request): Promise<T> {
  if (req.method === "GET") {
    return Object.fromEntries(new URL(req.url).searchParams) as T;
  }
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

/** Setting row (key "demo"): the demo clock, matchVia and imessage flags. */
export interface DemoSetting {
  id?: string;
  key: "demo";
  now: string;
  matchVia: "fetch" | "local";
  imessage: boolean;
  lineUserId?: string;
}

export async function getSetting(db: any): Promise<DemoSetting> {
  const rows = await db.Setting.filter({ key: "demo" }, undefined, 1);
  if (rows?.[0]) return rows[0] as DemoSetting;
  // Defaults when B's seed hasn't run yet; `now` = real clock.
  return {
    key: "demo",
    now: new Date().toISOString(),
    matchVia: "local",
    imessage: false,
  };
}

/** All time logic reads Setting.now (rule 6). */
export async function demoNow(db: any): Promise<Date> {
  const s = await getSetting(db);
  const d = new Date(s.now);
  return isNaN(d.getTime()) ? new Date() : d;
}
