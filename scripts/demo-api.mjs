#!/usr/bin/env node
// OWNER: Agent 2 (B3). Backend smoke test: drives the whole demo story over HTTP, one ✓/✗ line per step.
//
//   node scripts/demo-api.mjs                      (AGENT_KEY from the env, else from .env.local)
//   BASE_URL=https://sproutpass.base44.app AGENT_KEY=… node scripts/demo-api.mjs
//
// BASE_URL is whatever comes before /functions/<name>. Default: the Base44 API URL for the app id in
// base44/.app.jsonc (works before the site is published). Exit code 1 on the first failure.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SEP_20 = "2026-09-20T17:00:00.000Z";
const OCT_18 = "2026-10-18T17:00:00.000Z";
const ROMPER = "Yellow duck romper";

function defaultBase() {
  try {
    const raw = readFileSync(fileURLToPath(new URL("../base44/.app.jsonc", import.meta.url)), "utf8");
    const id = raw.match(/"(?:id|appId|app_id)"\s*:\s*"([^"]+)"/)?.[1];
    if (id) return `https://base44.app/api/apps/${id}`;
  } catch { /* no local app link */ }
  return null;
}

/** KEY=value from the gitignored .env.local (never hard-code the agent key). */
function fromEnvLocal(key) {
  try {
    const raw = readFileSync(fileURLToPath(new URL("../.env.local", import.meta.url)), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && m[1] === key) return m[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  } catch { /* no .env.local */ }
  return undefined;
}

const BASE = (process.env.BASE_URL ?? defaultBase() ?? "").replace(/\/+$/, "");
const AGENT_KEY = process.env.AGENT_KEY || fromEnvLocal("AGENT_KEY") || "";
if (!BASE) {
  console.error("✗ set BASE_URL (e.g. https://sproutpass.base44.app) or run from the linked project folder");
  process.exit(1);
}

class StepError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRY_MS = [1500, 3000, 6000, 10000];

/** Every handler is idempotent, so a rate-limited call is simply retried with backoff. */
async function call(name, body = {}, headers = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await callOnce(name, body, headers);
    } catch (e) {
      if (!(e instanceof StepError) || !/rate limit|\b429\b/i.test(e.message) || attempt >= RETRY_MS.length) throw e;
      await sleep(RETRY_MS[attempt]);
    }
  }
}

async function callOnce(name, body, headers) {
  let res;
  try {
    res = await fetch(`${BASE}/functions/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new StepError(`${name}: network error (${e.cause?.code ?? e.message})`);
  }
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok || data?.error) {
    const err = data?.error;
    throw new StepError(`${name} → ${res.status} ${err ? `${err.code}: ${err.message}` : text.slice(0, 160)}`);
  }
  return data;
}

function expect(cond, msg) { if (!cond) throw new StepError(msg); }
const money = (c) => `$${(c / 100).toFixed(2)}`;

const ctx = {};
const steps = [
  ["demoReset", async () => {
    const r = await call("demoReset");
    expect(r?.ok === true, `expected { ok: true }, got ${JSON.stringify(r)}`);
    return "seeded";
  }],
  ["demoClock Sep 20", async () => {
    const r = await call("demoClock", { now: SEP_20 });
    expect(r.now?.startsWith("2026-09-20"), `clock is ${r.now}`);
    expect(r.nudgesCreated >= 1, `nudgesCreated = ${r.nudgesCreated}, want ≥ 1`);
    return `${r.nudgesCreated} nudge${r.nudgesCreated === 1 ? "" : "s"} created`;
  }],
  ["getCloset mina (nudge)", async () => {
    const c = await call("getCloset", { parentKey: "mina" });
    expect(!("phone" in (c.parent ?? {})), "closet leaks parent.phone");
    const romper = c.items?.find((i) => i.name === ROMPER);
    expect(romper, `${ROMPER} not in Mina's closet`);
    const nudge = c.nudges?.find((n) => n.kind === "outgrow_check" && n.itemId === romper.id);
    expect(nudge, "no outgrow_check nudge for the romper");
    Object.assign(ctx, { mina: c.parent, romper, nudge });
    return `“${nudge.message}”`;
  }],
  ["resolveNudge sell", async () => {
    const r = await call("resolveNudge", { parentKey: "mina", nudgeId: ctx.nudge.id, action: "sell" });
    expect(r.next === "open_listing", `next = ${r.next}`);
    expect(r.itemId === ctx.romper.id, "resolveNudge returned a different item");
    return "next: open_listing";
  }],
  ["listItem ($18.00)", async () => {
    const l = await call("listItem", {
      parentKey: "mina", itemId: ctx.romper.id, photo: "/sprites/item_romper.png",
      condition: "gently_used", conditionNote: "tiny stain on the cuff", shared: true,
    });
    expect(l.priceCents === 1800, `priceCents = ${l.priceCents}, want 1800`);
    expect(l.status === "active", `listing is ${l.status}`);
    ctx.listing = l;
    return `listed at ${money(l.priceCents)}`;
  }],
  ["demoClock Oct 18", async () => {
    const r = await call("demoClock", { now: OCT_18 });
    expect(r.now?.startsWith("2026-10-18"), `clock is ${r.now}`);
    const jo = await call("getCloset", { parentKey: "jo" });
    ctx.jo = jo.parent;
    return `now ${r.now.slice(0, 10)}`;
  }],
  ["createProposal (agent key)", async () => {
    expect(AGENT_KEY, "AGENT_KEY not set (env or .env.local; must match the AGENT_KEY secret on Base44)");
    const p = await call("createProposal", {
      listingId: ctx.listing.id, buyerId: ctx.jo.id, reason: "", transcript: [], source: "local",
    }, { "x-agent-key": AGENT_KEY });
    expect(p.status === "open", `status ${p.status}`);
    expect(p.snapshot?.priceCents === 1800, `snapshot price ${p.snapshot?.priceCents}`);
    expect(p.snapshot?.wearWeeksLeft === 4, `wearWeeksLeft ${p.snapshot?.wearWeeksLeft}, want 4`);
    ctx.proposal = p;
    return `open · ${money(p.snapshot.priceCents)} · fits ~${p.snapshot.wearWeeksLeft} wk`;
  }],
  ["decideProposal mina accept", async () => {
    const p = await call("decideProposal", { parentKey: "mina", proposalId: ctx.proposal.id, decision: "accepted" });
    expect(p.sellerDecision === "accepted" && p.status === "open", `seller ${p.sellerDecision}, status ${p.status}`);
    return "seller ✓ · waiting for buyer";
  }],
  ["decideProposal jo accept", async () => {
    const p = await call("decideProposal", { parentKey: "jo", proposalId: ctx.proposal.id, decision: "accepted" });
    expect(p.status === "both_accepted", `status ${p.status}`);
    return "both_accepted";
  }],
  ["payProposal", async () => {
    const r = await call("payProposal", { parentKey: "jo", proposalId: ctx.proposal.id });
    expect(r.proposal?.status === "paid", `status ${r.proposal?.status}`);
    expect(/^DEMO-/.test(r.proposal.paymentRef ?? ""), `paymentRef ${r.proposal.paymentRef}`);
    expect(r.item?.ownerCount === 2 && r.item.currentOwnerId === ctx.jo.id, `item ownerCount ${r.item?.ownerCount}, owner ${r.item?.currentOwnerId}`);
    ctx.paid = r.proposal;
    return `paid ${r.proposal.paymentRef} · ownerCount 2`;
  }],
  ["payProposal again (idempotent)", async () => {
    const r = await call("payProposal", { parentKey: "jo", proposalId: ctx.proposal.id });
    expect(r.proposal.paymentRef === ctx.paid.paymentRef, "second pay changed the payment ref");
    expect(r.item.ownerCount === 2 && r.item.ownershipHistory?.length === 2, `ownerCount ${r.item.ownerCount}, history ${r.item.ownershipHistory?.length}`);
    return "no second transfer";
  }],
  ["getCloset jo", async () => {
    const c = await call("getCloset", { parentKey: "jo" });
    const romper = c.items?.find((i) => i.id === ctx.romper.id);
    expect(romper, "romper not in Jo's closet");
    expect(c.nudges?.some((n) => n.kind === "new_owner_welcome" && n.itemId === romper.id), "no new_owner_welcome nudge for Jo");
    return `romper in Jo's bag · ♥♥ · welcome nudge`;
  }],
];

console.log(`demo-api → ${BASE}`);
let failed = false;
for (const [name, run] of steps) {
  const t0 = Date.now();
  try {
    const detail = await run();
    console.log(`✓ ${name}${detail ? ` — ${detail}` : ""} (${Date.now() - t0} ms)`);
  } catch (e) {
    console.log(`✗ ${name} — ${e instanceof StepError ? e.message : e?.stack ?? e}`);
    failed = true;
    break;
  }
}
console.log(failed ? "\nSMOKE TEST FAILED" : "\nALL ✓ — backend is demo-ready");
process.exit(failed ? 1 : 0);
