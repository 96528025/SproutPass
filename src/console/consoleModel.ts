// B4: the Agent Console's pure model. Which agent sent each protocol message, what engine each side ran on,
// what the agents shared (and a scan proving what they never shared), and the outcome in plain words.
// No React, no I/O: everything here is unit-tested in consoleModel.test.ts.
import type { AgentLogEntry, AgentTurn, Encounter, MatchProposal, ProposalSnapshot } from "../app/types";
import { formatCents, priceRuleText } from "../app/types";
import { MOCK_AGENT_PREFIX, mockAgentAddress, rulesPhraseOf } from "../app/mockWorld";

export type Side = "a" | "b";
export type Engine = AgentLogEntry["by"];

export const ENGINE_LABEL: Record<Engine, string> = {
  fetch: "Fetch.ai uAgent",
  fallback: "Fallback matcher",
  mock: "Mock",
};

export const ENGINE_NOTE: Record<Engine, string> = {
  fetch: "A Fetch.ai uAgent with its own address, participating in the SproutPass matching workflow.",
  fallback: "The agents were offline, so the app's built-in matcher spoke for this pet, using the same rules.",
  mock: "Offline demo: a stand-in agent plays the protocol on this device. The live app uses Fetch.ai uAgents.",
};

const other = (s: Side): Side => (s === "a" ? "b" : "a");

/** "agent1qf3x…9k2d" style: protocol prefix, an ellipsis, the last 4 characters. Non-addresses come back as is. */
export function shortAddress(addr: string | undefined | null): string {
  if (!addr) return "";
  if (!isAddress(addr)) return addr;
  const prefix = /^[a-z]+1q/.exec(addr)?.[0] ?? addr.slice(0, 7);
  return `${prefix}…${addr.slice(-4)}`;
}

/** Looks like a bech32 agent address ("agent1q…", or the mock's "mock1q…"). */
export function isAddress(s: unknown): s is string {
  return typeof s === "string" && /^[a-z]+1q[0-9a-z]{20,}$/.test(s);
}

export const isMockAddress = (s: unknown) => typeof s === "string" && s.startsWith(MOCK_AGENT_PREFIX);

/** "LookingFor" → "Looking for", "TradeAck" → "Trade ack". */
export function typeLabel(type: string): string {
  const words = String(type || "Message").replace(/([a-z])([A-Z])/g, "$1 $2").split(/[\s_]+/).filter(Boolean);
  return words.map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w.toLowerCase())).join(" ");
}

/** Which transcript line (pet bubble) goes with which protocol message, to tell who sent it. */
const KIND_OF_TYPE: Record<string, AgentTurn["kind"]> = {
  LookingFor: "looking_for", HaveListings: "have", NoFit: "no_fit", ProposeTrade: "propose", TradeAck: "ack", Decline: "decline",
};

/** The side that opens: the lexically smaller parent id (the agents' own rule, closet_agent.py / useEncounter). */
export const openerSide = (enc: Pick<Encounter, "aId" | "bId">): Side => (enc.aId < enc.bId ? "a" : "b");

export interface Sides {
  /** Sender side of each log entry, same order as the log. */
  dir: Side[];
  /** Each side's agent address, once known. */
  addr: Partial<Record<Side, string>>;
  /** What spoke for each side (from its messages, else the encounter's negotiatedBy). */
  engine: Partial<Record<Side, Engine>>;
  /** How many messages each side sent. */
  sent: Record<Side, number>;
}

/**
 * Who sent each protocol message. In order of trust: a known address (the mock's stand-in addresses are
 * derivable; Fetch addresses are learned along the way), the pets' matching transcript line (it carries the
 * parentId), then the protocol's turn-taking (the opener speaks first, then the sides alternate).
 */
export function resolveSides(enc: Pick<Encounter, "aId" | "bId" | "transcript" | "negotiatedBy">, log: AgentLogEntry[]): Sides {
  const addr: Partial<Record<Side, string>> = {};
  if (log.some((e) => isMockAddress(e.from) || isMockAddress(e.to))) {
    addr.a = mockAgentAddress(enc.aId);
    addr.b = mockAgentAddress(enc.bId);
  }
  const sideOfParent = (pid: string | undefined): Side | null => (pid === enc.aId ? "a" : pid === enc.bId ? "b" : null);
  const byAddr = (e: AgentLogEntry): Side | null => {
    if (addr.a && e.from === addr.a) return "a";
    if (addr.b && e.from === addr.b) return "b";
    if (addr.a && e.to === addr.a) return "b";
    if (addr.b && e.to === addr.b) return "a";
    return null;
  };
  const turns = Array.isArray(enc.transcript) ? enc.transcript : [];
  const used = new Set<number>();
  const byTranscript = (e: AgentLogEntry): Side | null => {
    const kind = KIND_OF_TYPE[e.type];
    if (!kind) return null;
    const i = turns.findIndex((t, j) => !used.has(j) && t?.kind === kind);
    if (i < 0) return null;
    used.add(i);
    return sideOfParent(turns[i].parentId);
  };

  const dir: (Side | null)[] = log.map((e) => {
    const s = byAddr(e) ?? byTranscript(e);
    if (s) {
      if (isAddress(e.from) && !addr[s]) addr[s] = e.from;
      if (isAddress(e.to) && !addr[other(s)] && e.to !== addr[s]) addr[other(s)] = e.to;
    }
    return s;
  });
  // Second pass with what was learned, then turn-taking for the rest.
  let prev: Side | null = null;
  const out = dir.map((s, i) => {
    const side: Side = s ?? byAddr(log[i]) ?? (prev ? other(prev) : openerSide(enc));
    prev = side;
    return side;
  });
  if (!addr.a || !addr.b) {
    out.forEach((s, i) => {
      if (isAddress(log[i].from) && !addr[s]) addr[s] = log[i].from;
      if (isAddress(log[i].to) && !addr[other(s)] && log[i].to !== addr[s]) addr[other(s)] = log[i].to;
    });
  }

  const engine: Partial<Record<Side, Engine>> = {};
  const sent = { a: 0, b: 0 };
  out.forEach((s, i) => {
    sent[s] += 1;
    engine[s] = log[i].by;
  });
  const fallbackEngine: Engine | undefined = enc.negotiatedBy === "fetch" ? "fetch" : enc.negotiatedBy === "local" ? "fallback" : undefined;
  if (fallbackEngine) {
    engine.a ??= fallbackEngine;
    engine.b ??= fallbackEngine;
  }
  return { dir: out, addr, engine, sent };
}

/** The engine that negotiated this encounter as a whole (its messages first, then negotiatedBy, then the proposal). */
export function encounterEngine(
  enc: Pick<Encounter, "negotiatedBy" | "agentLog">,
  proposal?: Pick<MatchProposal, "source"> | null,
): Engine | null {
  const log = Array.isArray(enc.agentLog) ? enc.agentLog : [];
  if (log.length) return log[log.length - 1].by;
  if (enc.negotiatedBy === "fetch") return "fetch";
  if (enc.negotiatedBy === "local") return "fallback";
  if (proposal?.source === "fetch") return "fetch";
  if (proposal?.source === "local") return "fallback";
  return null;
}

// ---------------------------------------------------------------- privacy

export type PrivateKind = "name" | "phone" | "location" | "birthdate";

export const PRIVATE_LABEL: Record<PrivateKind, string> = {
  name: "a parent's name",
  phone: "a phone number",
  location: "an exact location",
  birthdate: "a birthdate",
};

export interface PrivacyFinding { kind: PrivateKind; where: string }
export interface PrivacyScan { messages: number; lines: number; findings: PrivacyFinding[] }

const PHONE = /\+\d{6,}|\b\d{3}[ .-]?\d{3}[ .-]?\d{4}\b/;
const LOCATION = /-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}|\b(lat|lng|latitude|longitude)\b/i;
const BIRTHDATE = /\b(19|20)\d{2}-\d{2}-\d{2}\b|\bborn\b|\bbirth ?(day|date)\b/i;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Re-checks, on screen, everything the agents said (message types and summaries) and every pet line for the
 * things they must never share: the parents' names, phone numbers, coordinates, birthdates.
 */
export function scanPrivacy(log: AgentLogEntry[], transcript: AgentTurn[], parentNames: string[]): PrivacyScan {
  const names = parentNames.filter((n) => typeof n === "string" && n.trim().length >= 2);
  const nameRe = names.length ? new RegExp(`\\b(${names.map(escapeRe).join("|")})\\b`) : null;
  const findings: PrivacyFinding[] = [];
  const check = (text: string, where: string) => {
    if (!text) return;
    if (nameRe?.test(text)) findings.push({ kind: "name", where });
    if (PHONE.test(text)) findings.push({ kind: "phone", where });
    if (LOCATION.test(text)) findings.push({ kind: "location", where });
    if (BIRTHDATE.test(text)) findings.push({ kind: "birthdate", where });
  };
  log.forEach((e, i) => check(`${e.type} ${e.summary ?? ""}`, `message ${i + 1}`));
  transcript.forEach((t, i) => check(t?.text ?? "", `pet line ${i + 1}`));
  return { messages: log.length, lines: transcript.length, findings };
}

// ---------------------------------------------------------------- outcome

export type Phase = "talking" | "no_match" | "proposed";

export interface StatusView { label: string; tone: "gold" | "mint" | "sky" | "red" | "lav" | "paper" | "pink"; done: boolean }

export function proposalStatus(p: Pick<MatchProposal, "status" | "sellerDecision" | "buyerDecision">): StatusView {
  switch (p.status) {
    case "open": {
      return { label: p.buyerDecision === "accepted" ? "Buyer approved · preparing payment" : "Open · waiting for buyer approval", tone: "gold", done: false };
    }
    case "both_accepted": return { label: "Buyer approved · simulated payment", tone: "sky", done: false };
    case "paid": return { label: "Complete · simulated payment", tone: "mint", done: true };
    case "declined": return { label: "Declined · nothing charged", tone: "paper", done: true };
    case "expired": return { label: "Expired · nothing charged", tone: "paper", done: true };
    case "payment_failed": return { label: "Payment failed · nothing charged", tone: "red", done: true };
    default: return { label: String(p.status), tone: "paper", done: false };
  }
}

/** The encounter strip's chip: the trade's own status once there is one (open, accepted, paid…), else the encounter's. */
export function encounterChip(
  enc: Pick<Encounter, "status" | "agentLog"> & { noMatchReason?: unknown },
  proposal?: Pick<MatchProposal, "status"> | null,
): { label: string; tone: StatusView["tone"] } {
  if (proposal) {
    switch (proposal.status) {
      case "open": return { label: "Open", tone: "gold" };
      case "both_accepted": return { label: "Accepted", tone: "sky" };
      case "paid": return { label: "Paid", tone: "mint" };
      case "declined": return { label: "Declined", tone: "paper" };
      case "expired": return { label: "Expired", tone: "paper" };
      case "payment_failed": return { label: "Pay failed", tone: "red" };
    }
  }
  if (enc.status === "proposed") return { label: "Proposed", tone: "gold" };
  if (enc.status === "no_match") return refusalOf(enc)?.rules ? { label: "Stopped", tone: "pink" } : { label: "No match", tone: "paper" };
  return { label: "Talking", tone: "sky" };
}

// ---------------------------------------------------------------- refusals (the agents found something, no trade)

export interface Refusal {
  /** Index of the Decline in the log (its sender is the buyer's agent), or -1 when only the encounter says why. */
  at: number;
  /** The buyer's own pet rules stopped it (may propose, price limit, kinds of clothes, monthly budget). */
  rules: boolean;
  /** What stopped it, in a few words: "over the price limit". */
  reason: string;
}

/** A refusal that comes from the buyer's own pet rules (the mock's tag, C's fallback wording, trust.ts's sentences). */
const RULES_RX = /pet rules|price limit|budget|kinds? of clothes|point out matches|for their pet/i;

/** "Buyer side declines: over the price limit…. Nothing was proposed." → "over the price limit…". */
const tidyReason = (s: string) =>
  s.replace(/^(won't propose it|buyer side declines|declines?)\s*:?\s*/i, "")
    .replace(/\s*nothing was proposed( or charged)?\.?\s*$/i, "")
    .trim()
    .replace(/\.$/, "")
  || "the agents declined";

/**
 * Why an encounter ended without a trade although the agents found something: the buyer's agent's Decline (the
 * mock writes the pet-rules phrase into it, see mockWorld declineSummary), else the encounter's noMatchReason.
 * Null for a plain "nothing fits" (NoFit) or an encounter that isn't over.
 */
export function refusalOf(enc: Pick<Encounter, "status" | "agentLog"> & { noMatchReason?: unknown }): Refusal | null {
  if (enc.status !== "no_match") return null;
  const log = Array.isArray(enc.agentLog) ? enc.agentLog : [];
  for (let at = log.length - 1; at >= 0; at--) {
    if (log[at]?.type !== "Decline") continue;
    const summary = log[at].summary ?? "";
    const phrase = rulesPhraseOf(summary);
    return phrase ? { at, rules: true, reason: phrase } : { at, rules: RULES_RX.test(summary), reason: tidyReason(summary) };
  }
  const why = typeof enc.noMatchReason === "string" ? enc.noMatchReason.trim() : "";
  return why ? { at: -1, rules: RULES_RX.test(why), reason: tidyReason(why) } : null;
}

/** A finished exchange ends in one of these; until the shown log does, a "no match" outcome is still being told. */
export const CLOSING_TYPES = new Set(["NoFit", "Decline", "TradeAck"]);

/** First letter up: "over the price limit" → "Over the price limit". */
export const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "2nd owner pays 60% of $30.00 = $18.00" from the proposal's snapshot (the price the server fixed). */
export function priceRule(s: Pick<ProposalSnapshot, "previousOwners" | "originalPriceCents" | "priceCents">): string {
  const owners = s.previousOwners;
  if ((owners === 1 || owners === 2) && s.originalPriceCents > 0) {
    return priceRuleText({ ownerCount: owners, originalPriceCents: s.originalPriceCents });
  }
  return `${formatCents(s.priceCents)}, fixed by the relay's price rule`;
}

export function decisionLabel(d: MatchProposal["sellerDecision"]): string {
  return d === "accepted" ? "Accepted" : d === "declined" ? "Declined" : "Deciding";
}

// ---------------------------------------------------------------- time

export function ago(iso: string | number | undefined | null, nowMs: number = Date.now()): string {
  const t = typeof iso === "number" ? iso : Date.parse(iso ?? "");
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? "day" : "days"} ago`;
}

/** Total time the agents took, first to last message (ms), or null with fewer than two. */
export function exchangeMs(log: AgentLogEntry[]): number | null {
  if (log.length < 2) return log.length === 1 && typeof log[0].ms === "number" ? log[0].ms : null;
  const first = Date.parse(log[0].at) - (typeof log[0].ms === "number" ? log[0].ms : 0);
  const last = Date.parse(log[log.length - 1].at);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
  return Math.max(0, last - first);
}

// ---------------------------------------------------------------- deep link: /agents?enc=<encounterId>

/**
 * The encounter a link asks for (/agents?enc=<id>: the pets' meeting scene, the pet's AGENTS' CHAT), or null.
 * Base44 ids and the mock's ("enc_1x2y") are letters, digits, "_" and "-"; anything else is ignored.
 */
export function encParam(search: string): string | null {
  const v = new URLSearchParams(search).get("enc")?.trim() ?? "";
  return /^[\w-]{1,64}$/.test(v) ? v : null;
}

/** `search` with ?enc= set to `id` (null: removed, i.e. follow live), every other param kept (?as=, ?demo=, ?view=). */
export function withEncParam(search: string, id: string | null): string {
  const q = new URLSearchParams(search);
  if (id) q.set("enc", id);
  else q.delete("enc");
  const qs = q.toString();
  return qs ? `?${qs}` : "";
}

/**
 * The encounter on screen. No pin (follow live): the newest. A pin: that encounter while it is in the list, else
 * the newest (a link to an encounter that is gone, or one still being read).
 */
export function selectEncounter<T extends { id: string }>(encounters: T[], pinnedId: string | null): T | null {
  if (!encounters.length) return null;
  return (pinnedId ? encounters.find((e) => e.id === pinnedId) : undefined) ?? encounters[0];
}

/** The strip's tabs: the newest `max`, plus the one on screen when it is older (a deep link to an old encounter). */
export function stripEncounters<T extends { id: string }>(encounters: T[], selectedId: string | null, max = 10): T[] {
  const head = encounters.slice(0, max);
  if (!selectedId || head.some((e) => e.id === selectedId)) return head;
  const sel = encounters.find((e) => e.id === selectedId);
  return sel ? [...head.slice(0, Math.max(0, max - 1)), sel] : head;
}

/** The recent list plus a pinned encounter read on its own (older than the list), newest first, no duplicates. */
export function withPinned<T extends { id: string; startedAt: string }>(encounters: T[], pinned: T | null): T[] {
  if (!pinned || encounters.some((e) => e.id === pinned.id)) return encounters;
  return [...encounters, pinned].sort((a, b) => (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0));
}
