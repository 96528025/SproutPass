// OWNER: B4. /agents — the Agent Console: the judge-facing live screen that shows two AI agents negotiating on
// behalf of two parents. Two agent cards (pet, parent's first name, agent address, what engine spoke), the
// protocol messages flying between them (type, plain summary, latency), the pets' own lines, a privacy panel that
// re-checks every message on screen, and the outcome (price, the 60% / 40% rule, both parents' decisions).
//
// Works without a parent picked (it's a PUBLIC_PATH), so it can sit on a projector. On a wide screen it opens as
// a full-screen layer over the handheld frame ("big screen"); PHONE VIEW puts it back inside the frame, where it
// reads top to bottom on a phone (one agent card per row, then the messages, the outcome, the pets' talk).
// /agents?enc=<id> opens one encounter pinned (the pets' meeting scene and the pet's AGENTS' CHAT link here);
// picking a tab writes ?enc=, FOLLOW LIVE removes it. Each pet's personality (traits, blurb) is on its card.
// Agents never decide here: the console only shows what they proposed and what each parent chose.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { USE_MOCK } from "../app/api";
import type { AgentLogEntry, AgentTurn, Encounter, MatchProposal, PublicParty } from "../app/types";
import { formatCents } from "../app/types";
import { Chip, ItemIcon, PixelButton, Sprite, type AnimName, type ChipTone } from "../app/ui";
import { withQuery } from "../world/query";
import { personalityOf } from "../../base44/shared/c/personality.ts";
import {
  ago, capital, CLOSING_TYPES, decisionLabel, encounterChip, encounterEngine, encParam, ENGINE_LABEL, ENGINE_NOTE, exchangeMs,
  priceRule, PRIVATE_LABEL, proposalStatus, refusalOf, resolveSides, scanPrivacy, selectEncounter, shortAddress, stripEncounters,
  typeLabel, withEncParam, type Engine, type Refusal, type Side, type Sides,
} from "./consoleModel";
import { useAgentConsole } from "./useAgentConsole";
import "./console.css";

// ---------------------------------------------------------------- small hooks

function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

const VIEW_KEY = "relay:console:view";

/** Big screen on wide windows (or ?view=big), the handheld frame otherwise; the viewer's choice is remembered. */
function useBigScreen(): [boolean, (big: boolean) => void] {
  const [big, setBigState] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const q = new URLSearchParams(window.location.search).get("view");
    if (q === "big" || q === "phone") return q === "big";
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved === "big" || saved === "phone") return saved === "big";
    } catch { /* storage blocked */ }
    return typeof matchMedia === "function" && matchMedia("(min-width: 1024px)").matches;
  });
  const setBig = (v: boolean) => {
    setBigState(v);
    try { localStorage.setItem(VIEW_KEY, v ? "big" : "phone"); } catch { /* storage blocked */ }
  };
  return [big, setBig];
}

/**
 * Messages appear one by one (≈ 0.45 s apart) so a whole exchange that lands at once still reads as a
 * conversation. Opening an older encounter shows its log at once.
 */
function useReveal(key: string, total: number, instant: boolean): number {
  const [state, setState] = useState({ key, shown: instant ? total : 0 });
  const shown = state.key === key ? state.shown : instant ? total : 0;
  useEffect(() => {
    if (state.key !== key) {
      setState({ key, shown: instant ? total : 0 });
      return;
    }
    if (shown >= total) return;
    const t = setTimeout(() => setState({ key, shown: Math.min(total, shown + 1) }), shown === 0 ? 200 : 450);
    return () => clearTimeout(t);
  }, [key, shown, total, instant, state.key]);
  return Math.min(shown, total);
}

// ---------------------------------------------------------------- helpers

const TYPE_TONE: Record<string, ChipTone> = {
  LookingFor: "sky", HaveListings: "lav", ProposeTrade: "gold", TradeAck: "mint", NoFit: "pink", Decline: "red",
};
const ENGINE_TONE: Record<Engine, ChipTone> = { fetch: "mint", fallback: "gold", mock: "lav" };

/** Pet lines are written "Pip: Looking for…" for iMessage; the bubble already names the pet. */
function lineText(t: AgentTurn): string {
  const m = /^([A-Za-z][\w' -]{0,16}):\s+(.*)$/s.exec(t?.text ?? "");
  return m ? m[2] : t?.text ?? "";
}

const firstName = (p?: PublicParty) => (p?.name ?? "").split(/\s+/)[0] || "A parent";
const petName = (p?: PublicParty) => p?.pet?.name || "Pet";
const logOf = (e: Encounter | null | undefined): AgentLogEntry[] => (Array.isArray(e?.agentLog) ? e!.agentLog! : []);

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Phone view: scroll a section into view, clear of the demo strip when b.css sticks it to the top of the page. */
function jumpTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const strip = document.querySelector<HTMLElement>(".b-demo");
  const stuck = strip && getComputedStyle(strip).position === "sticky" ? strip.getBoundingClientRect().height : 0;
  el.style.scrollMarginTop = `${Math.round(stuck) + 8}px`;
  el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
}

const SECTION = { messages: "ac-messages", outcome: "ac-outcome", talk: "ac-talk" } as const;

// ---------------------------------------------------------------- pieces

/** Realtime up and a read in the last 40 s (the backstop poll runs every 15 s while the page is visible). */
function LiveBadge({ live, error, lastAt, lastSyncAt, now }: {
  live: boolean; error: string | null; lastAt: number | null; lastSyncAt: number | null; now: number;
}) {
  const stale = lastSyncAt != null && now - lastSyncAt > 40_000;
  const bad = !!error || !live || stale;
  return (
    <div className={`ac-live${bad ? " ac-live--bad" : ""}`} role="status" aria-live="polite">
      <span className="ac-live__dot" aria-hidden />
      <span className="ac-live__label">{bad ? "Reconnecting" : "Live"}</span>
      {lastAt != null && <span className="ac-live__ago">Updated {ago(lastAt, now)}</span>}
    </div>
  );
}

function AgentCard({
  party, side, sides, role, anim, align, big,
}: {
  party?: PublicParty;
  side: Side;
  sides: Sides;
  role: string | null;
  anim: AnimName;
  align: "left" | "right";
  /** Big screen: the two cards face each other across the messages; phone view stacks them, pets facing their text. */
  big: boolean;
}) {
  const addr = sides.addr[side];
  const engine = sides.engine[side];
  const [copied, setCopied] = useState<"" | "ok" | "fail">("");
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(""), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  const sent = sides.sent[side];
  // How this pet talks (base44/shared/c/personality.ts): its agent speaks in that voice, the offer stays the same.
  const persona = personalityOf(party?.pet?.name);
  return (
    <section className={`ac-agent ac-agent--${align}`} aria-label={`${petName(party)}, ${firstName(party)}'s closet agent`}>
      <div className="ac-agent__pet">
        <Sprite name={party?.pet?.sprite ?? "pet_a"} anim={anim} scale={5} facing={!big || align === "left" ? "right" : "left"} />
      </div>
      <div className="ac-agent__who">
        <h3 className="ac-agent__name">{petName(party)}</h3>
        <p className="ac-agent__parent">{firstName(party)}'s closet agent</p>
      </div>
      {persona && (
        <div className="ac-agent__persona">
          <Chip tone="lav" plain title={`${persona.pet}'s personality: how its agent talks, never what it offers`}>{persona.traits}</Chip>
          <p className="ac-agent__blurb">{persona.blurb}</p>
        </div>
      )}
      <div className="ac-agent__chips">
        {engine ? (
          <Chip tone={ENGINE_TONE[engine]} title={ENGINE_NOTE[engine]}>{ENGINE_LABEL[engine]}</Chip>
        ) : (
          <Chip tone="paper">Waiting</Chip>
        )}
        {role && <Chip tone="ink">{role}</Chip>}
      </div>
      <div className="ac-agent__addr">
        {addr ? (
          <>
            <code title={addr}>{shortAddress(addr)}</code>
            <PixelButton
              small
              variant="ghost"
              silent
              onClick={() => { void copyText(addr).then((ok) => setCopied(ok ? "ok" : "fail")); }}
              aria-label={`Copy ${petName(party)}'s agent address`}
            >
              {copied === "ok" ? "Copied" : copied === "fail" ? "Can't copy" : "Copy"}
            </PixelButton>
          </>
        ) : (
          <span className="ac-agent__noaddr">{engine === "fallback" ? "No agent address: the built-in matcher spoke." : "Address shows with its first message."}</span>
        )}
      </div>
      <p className="ac-agent__sent">{sent ? `${sent} ${sent === 1 ? "message" : "messages"} sent` : "No messages yet"}</p>
    </section>
  );
}

function Timeline({
  enc, log, sides, shown, left, parties,
}: {
  enc: Encounter;
  log: AgentLogEntry[];
  sides: Sides;
  shown: number;
  left: Side;
  parties: Record<string, PublicParty>;
}) {
  const partyOf = (s: Side) => parties[s === "a" ? enc.aId : enc.bId];
  const visible = log.slice(0, shown);
  const total = exchangeMs(visible);
  return (
    <section className="ac-timeline" id={SECTION.messages} aria-label="Messages between the two agents">
      <header className="ac-timeline__head">
        <span className="ac-label">SproutPass agent conversation</span>
        <span className="ac-timeline__stats">
          {visible.length} {visible.length === 1 ? "message" : "messages"}
          {total != null && visible.length > 1 ? ` · ${(total / 1000).toFixed(1)} s` : ""}
        </span>
      </header>
      <ol className="ac-timeline__list" role="log" aria-live="polite">
        {visible.map((e, i) => {
          const from = sides.dir[i];
          const ltr = from === left;
          const sender = partyOf(from);
          const receiver = partyOf(from === "a" ? "b" : "a");
          const newest = i === visible.length - 1;
          return (
            <li key={`${i}-${e.at}`} className={`ac-msg ${ltr ? "ac-msg--ltr" : "ac-msg--rtl"}${newest ? " ac-msg--newest" : ""}`}>
              <div className="ac-msg__track" aria-hidden>
                <Sprite name={(ltr ? sender : receiver)?.pet?.sprite ?? "pet_a"} scale={2} anim={newest && ltr ? "talk" : "idle"} />
                <span className="ac-msg__wire">
                  <span className="ac-msg__packet" />
                  <span className="ac-msg__head" />
                </span>
                <Sprite name={(ltr ? receiver : sender)?.pet?.sprite ?? "pet_b"} scale={2} anim={newest && !ltr ? "talk" : "idle"} facing="left" />
              </div>
              <div className="ac-msg__meta">
                <Chip tone={TYPE_TONE[e.type] ?? "paper"}>{typeLabel(e.type)}</Chip>
                <span className="ac-msg__route">{petName(sender)} → {petName(receiver)}</span>
                {typeof e.ms === "number" && <span className="ac-msg__ms">+{Math.round(e.ms)} ms</span>}
                {sides.engine[from] !== e.by && <Chip tone={ENGINE_TONE[e.by]}>{ENGINE_LABEL[e.by]}</Chip>}
              </div>
              <p className="ac-msg__summary">{e.summary || typeLabel(e.type)}</p>
            </li>
          );
        })}
        {shown < log.length && (
          <li className="ac-msg ac-msg--pending" aria-hidden>
            <span className="ac-typing"><i /><i /><i /></span>
          </li>
        )}
        {!log.length && (
          <li className="ac-timeline__empty">
            {enc.status === "talking" ? (
              <>
                <span className="ac-typing" aria-hidden><i /><i /><i /></span>
                <span>Waiting for the first message between the agents…</span>
              </>
            ) : (
              <span>No protocol log on this encounter (it ran before the console logged messages). The pets' lines are below.</span>
            )}
          </li>
        )}
      </ol>
    </section>
  );
}

function PetTalk({ enc, parties, left }: { enc: Encounter; parties: Record<string, PublicParty>; left: Side }) {
  const lines = Array.isArray(enc.transcript) ? enc.transcript : [];
  const leftId = left === "a" ? enc.aId : enc.bId;
  const voiced = [enc.aId, enc.bId].some((id) => personalityOf(parties[id]?.pet?.name));
  return (
    <section className="ac-card ac-talk" id={SECTION.talk} aria-label="What the pets said">
      <h3 className="ac-card__title">The pets' conversation</h3>
      {voiced && <p className="ac-card__lede">Each pet talks in its own voice. The items, prices and rules stay the same.</p>}
      {!lines.length && <p className="ac-muted">The pets haven't said anything yet.</p>}
      <ol className="ac-talk__list">
        {lines.map((t, i) => {
          const p = parties[t.parentId];
          const onLeft = t.parentId === leftId;
          return (
            <li key={`${i}-${t.at}`} className={`ac-bubble ${onLeft ? "ac-bubble--left" : "ac-bubble--right"} ac-bubble--${t.kind}`}>
              <Sprite name={p?.pet?.sprite ?? "pet_a"} scale={2} facing={onLeft ? "right" : "left"} />
              <div className="ac-bubble__body">
                <span className="ac-bubble__who">{petName(p)}</span>
                <p className="ac-bubble__text">{lineText(t)}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Privacy({ enc, log, parties }: { enc: Encounter; log: AgentLogEntry[]; parties: Record<string, PublicParty> }) {
  const names = [parties[enc.aId]?.name, parties[enc.bId]?.name].filter((n): n is string => !!n);
  const scan = scanPrivacy(log, Array.isArray(enc.transcript) ? enc.transcript : [], names);
  const checked = scan.messages + scan.lines;
  return (
    <section className="ac-card ac-privacy" aria-label="Privacy">
      <h3 className="ac-card__title">Privacy</h3>
      <p className="ac-card__lede">What the agents shared, and what they never shared.</p>
      <div className="ac-privacy__cols">
        <div>
          <span className="ac-label ac-label--ok">Shared</span>
          <ul className="ac-list ac-list--ok">
            <li>Shared listings: item, size, condition, price</li>
            <li>Shared needs: sizes and categories</li>
            <li>The child's age in months</li>
          </ul>
        </div>
        <div>
          <span className="ac-label ac-label--no">Never shared</span>
          <ul className="ac-list ac-list--no">
            <li>Names</li>
            <li>Phone numbers</li>
            <li>Exact location (only "within 25 m")</li>
            <li>Birthdates</li>
          </ul>
        </div>
      </div>
      {checked > 0 && (
        scan.findings.length === 0 ? (
          <p className="ac-scan ac-scan--ok">
            Checked {scan.messages} agent {scan.messages === 1 ? "message" : "messages"} and {scan.lines} pet{" "}
            {scan.lines === 1 ? "line" : "lines"} on this screen: no names, phone numbers, coordinates or birthdates.
          </p>
        ) : (
          <div className="ac-scan ac-scan--bad" role="alert">
            <p>Something on this screen looks private:</p>
            <ul>
              {scan.findings.map((f, i) => <li key={i}>{PRIVATE_LABEL[f.kind]} in {f.where}</li>)}
            </ul>
          </div>
        )
      )}
      <p className="ac-foot">Names on this screen come from the app's public cards, not from the agents.</p>
    </section>
  );
}

function Outcome({
  enc, proposal, parties, engine, refusal, decliner, telling,
}: {
  enc: Encounter;
  proposal: MatchProposal | undefined;
  parties: Record<string, PublicParty>;
  engine: Engine | null;
  /** The agents found something but there is no trade: why (the buyer's pet rules, or another rule). */
  refusal: Refusal | null;
  /** The parent whose agent declined (the buyer). */
  decliner?: PublicParty;
  /** The messages are still being shown and haven't reached how it ended: don't give the ending away yet. */
  telling: boolean;
}) {
  let body: ReactNode;
  if (enc.status === "talking" || (enc.status === "no_match" && telling)) {
    body = (
      <div className="ac-outcome__state">
        <span className="ac-typing" aria-hidden><i /><i /><i /></span>
        <p className="ac-outcome__big-text">Negotiating…</p>
      </div>
    );
  } else if (enc.status === "no_match" && refusal) {
    const whose = decliner ? `${firstName(decliner)}'s` : "the buyer's";
    body = (
      <div className="ac-outcome__state">
        <p className="ac-outcome__big-text">{refusal.rules ? `Stopped by ${whose} pet rules` : "No trade this time"}</p>
        <p>{capital(refusal.reason)}. Nothing was proposed or charged.</p>
        {refusal.rules && (
          <p className="ac-muted">
            Each parent sets their own pet's rules (price limit, budget, kinds of clothes). The agents follow them; only the
            parent can change them.
          </p>
        )}
      </div>
    );
  } else if (enc.status === "no_match") {
    body = (
      <div className="ac-outcome__state">
        <p className="ac-outcome__big-text">No match this time</p>
        <p>Nothing on either shared list fits. No proposal was made and nothing was charged.</p>
      </div>
    );
  } else if (!proposal) {
    body = (
      <div className="ac-outcome__state">
        <p className="ac-outcome__big-text">Trade proposed</p>
        <p>Both parents see it on their phones.</p>
      </div>
    );
  } else {
    const s = proposal.snapshot;
    const status = proposalStatus(proposal);
    const buyer = parties[proposal.buyerId];
    const seller = parties[proposal.sellerId];
    const via = engine === "mock" ? "Mock agents (offline demo)" : proposal.source === "fetch" ? "Fetch.ai agents" : "Fallback matcher";
    body = (
      <>
        <div className="ac-outcome__item">
          <div className="ac-outcome__icon"><ItemIcon icon={s?.icon ?? "item_tee"} size={1} /></div>
          <div>
            <p className="ac-outcome__name">{s?.itemName ?? "Item"}</p>
            <p className="ac-muted">Size {s?.size ?? "?"}{s?.condition ? ` · ${s.condition.replace(/_/g, " ")}` : ""}</p>
          </div>
        </div>
        <div className="ac-outcome__pricing">
          <span className="ac-outcome__price">{formatCents(s?.priceCents ?? 0)}</span>
          {s && <p className="ac-outcome__rule">{priceRule(s)}</p>}
        </div>
        <div className="ac-outcome__status">
          <Chip tone={status.tone}>{status.label}</Chip>
        </div>
        <ul className="ac-decisions" aria-label="Listing and buyer approval">
          <li><span>{firstName(seller)} (selling)</span><b className={`ac-dec ac-dec--${proposal.sellerDecision}`}>Shared listing</b></li>
          <li><span>{firstName(buyer)} (buying)</span><b className={`ac-dec ac-dec--${proposal.buyerDecision}`}>{decisionLabel(proposal.buyerDecision)}</b></li>
        </ul>
        <p className="ac-muted">Proposed by: {via} · source "{proposal.source}"</p>
        <div className="ac-outcome__actions">
          <Link className="ac-link" to={`/trade/${proposal.id}`}>Open the trade →</Link>
          <Chip tone="paper">Demo payment · no real charge</Chip>
        </div>
      </>
    );
  }
  return (
    <section className="ac-card ac-outcome" id={SECTION.outcome} aria-label="Outcome">
      <h3 className="ac-card__title">Outcome</h3>
      {body}
      <p className="ac-rule-line">Agents propose. Parents decide. Only the buyer approves. Payment is simulated.</p>
    </section>
  );
}

function EncounterStrip({
  encounters, selectedId, follow, parties, proposals, now, onPick, onFollow,
}: {
  encounters: Encounter[];
  selectedId: string | null;
  follow: boolean;
  parties: Record<string, PublicParty>;
  proposals: Record<string, MatchProposal>;
  now: number;
  onPick: (id: string) => void;
  onFollow: () => void;
}) {
  return (
    <nav className="ac-strip" aria-label="Recent encounters">
      <PixelButton small variant={follow ? "primary" : "ghost"} pressed={follow} onClick={onFollow} aria-pressed={follow}>
        Follow live
      </PixelButton>
      <ol className="ac-strip__list">
        {encounters.map((e) => {
          const a = parties[e.aId], b = parties[e.bId];
          const p = proposals[e.id];
          const st = encounterChip(e, p); // the trade's own status once there is one (open, accepted, paid…)
          const on = e.id === selectedId;
          return (
            <li key={e.id}>
              <button type="button" className={`ac-tab${on ? " ac-tab--on" : ""}`} onClick={() => onPick(e.id)} aria-current={on}>
                <span className="ac-tab__pets" aria-hidden>
                  <Sprite name={a?.pet?.sprite ?? "pet_a"} scale={2} />
                  <Sprite name={b?.pet?.sprite ?? "pet_b"} scale={2} facing="left" />
                </span>
                <span className="ac-tab__text">
                  <span className="ac-tab__names">{firstName(a)} &amp; {firstName(b)}</span>
                  <span className="ac-tab__when">{ago(e.startedAt, now)}{p ? ` · ${formatCents(p.snapshot?.priceCents ?? 0)}` : ""}</span>
                </span>
                <Chip tone={st.tone}>{st.label}</Chip>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function EmptyState() {
  return (
    <section className="ac-card ac-empty">
      <h3 className="ac-card__title">No encounters yet</h3>
      <p className="ac-card__lede">This screen lights up the moment two parents' pets meet. To make that happen:</p>
      <ol className="ac-steps">
        <li>As Caesar, put something up for hand-me-down from her bag{USE_MOCK ? " (demo: move the clock to Sep 20, answer the romper nudge with Sell, list it, then move the clock to Oct 18)" : ""}.</li>
        <li>Open Olivia's world in demo mode and tap <b>Walk toward Caesar</b> (or walk within 25 m for real).</li>
        <li>Within 25 m their agents meet, and the conversation shows up here, live.</li>
      </ol>
      <div className="ac-empty__actions">
        <a className="ac-link" href="/world?as=jo&demo=1" target="_blank" rel="noreferrer">Open Olivia's world →</a>
        <a className="ac-link" href="/bag?as=mina&demo=1" target="_blank" rel="noreferrer">Open Caesar's bag →</a>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="ac-how" aria-label="How it works">
      <div><span className="ac-how__n">1</span><p><b>Nearby.</b> Within 25 m, each agent learns only the other agent's address. No names, no location.</p></div>
      <div><span className="ac-how__n">2</span><p><b>Negotiate.</b> Looking for → Have listings → Propose trade → Trade ack, priced by the relay's rule.</p></div>
      <div><span className="ac-how__n">3</span><p><b>Decide.</b> The seller shares a listing. Only the buyer approves; simulated payment and inventory transfer follow.</p></div>
    </section>
  );
}

// ---------------------------------------------------------------- screen

export function AgentConsole() {
  const loc = useLocation();
  const nav = useNavigate();
  // The URL holds the pin (?enc=), so a reload or a shared link opens the same encounter; no pin = follow live.
  const pinId = encParam(loc.search);
  const follow = !pinId;
  const data = useAgentConsole(pinId);
  const [big, setBig] = useBigScreen();
  const now = useNow(1000);

  const selected = useMemo(() => selectEncounter(data.encounters, pinId), [data.encounters, pinId]);
  const setPin = (id: string | null) => {
    if (id === pinId) return;
    nav({ pathname: loc.pathname, search: withEncParam(loc.search, id), hash: loc.hash }, { replace: true });
  };

  // Opening an encounter that ended a while ago shows its log at once; a fresh one plays message by message.
  const firstSeen = useRef(new Map<string, number>());
  if (selected && !firstSeen.current.has(selected.id)) firstSeen.current.set(selected.id, Date.now());
  const instant = !!selected && (firstSeen.current.get(selected.id) ?? 0) - (Date.parse(selected.startedAt) || 0) > 60_000;

  const log = logOf(selected);
  const shown = useReveal(selected?.id ?? "", log.length, instant);
  const sides = useMemo(() => resolveSides(selected ?? { aId: "", bId: "", transcript: [] }, log), [selected, log]);
  const proposal = selected ? data.proposals[selected.id] : undefined;
  const engine = selected ? encounterEngine(selected, proposal) : null;
  const refusal = selected && !proposal ? refusalOf(selected) : null;
  const declinerSide: Side | null = refusal && refusal.at >= 0 ? sides.dir[refusal.at] ?? null : null;
  // Still revealing the messages and not yet at how it ended: the outcome waits for the timeline.
  const telling = shown < log.length && !CLOSING_TYPES.has(log[shown - 1]?.type ?? "");

  // Buyer on the left once known; else whoever spoke first; else the opener.
  const left: Side = !selected ? "a"
    : proposal ? (proposal.buyerId === selected.aId ? "a" : "b")
    : sides.dir[0] ?? (selected.aId < selected.bId ? "a" : "b");
  const right: Side = left === "a" ? "b" : "a";
  const partyOf = (s: Side) => (selected ? data.parties[s === "a" ? selected.aId : selected.bId] : undefined);
  const roleOf = (s: Side): string | null => {
    if (!selected || !proposal) return null;
    const pid = s === "a" ? selected.aId : selected.bId;
    return pid === proposal.buyerId ? "Buying" : pid === proposal.sellerId ? "Selling" : null;
  };
  const lastFrom = shown > 0 ? sides.dir[shown - 1] : null;
  const animOf = (s: Side): AnimName => {
    if (proposal && (proposal.status === "paid" || proposal.status === "both_accepted")) return "hop";
    if (selected?.status === "talking" || shown < log.length) return lastFrom === s ? "talk" : "idle";
    return "idle";
  };

  /** Picking the newest encounter is "follow live"; an older one pins it until FOLLOW LIVE. */
  const pick = (id: string) => setPin(id === data.encounters[0]?.id ? null : id);
  // A link to one encounter that is still being read: wait for it rather than flash the newest.
  const opening = data.pin === "loading";

  const content = (
    <div className={`ac${big ? " ac--big" : ""}`}>
      <div className="ac-top">
        <Link className="ac-back" to={withQuery("/world")}>‹ Back to the game</Link>
        <PixelButton small variant="ghost" onClick={() => setBig(!big)}>{big ? "Phone view" : "Big screen"}</PixelButton>
      </div>
      <header className="ac-head">
        <div className="ac-head__title">
          <h1 className="ac-wordmark">Agent console</h1>
          <p className="ac-head__sub">Two pets' AI agents negotiate a hand-me-down for two parents, live.</p>
        </div>
        <div className="ac-head__right">
          <LiveBadge
            live={data.live}
            error={data.error}
            lastAt={Math.max(data.lastEventAt ?? 0, data.lastSyncAt ?? 0) || null}
            lastSyncAt={data.lastSyncAt}
            now={now}
          />
          {USE_MOCK && <Chip tone="lav" title="Offline demo on this device: no real agents, no real money">Mock world</Chip>}
        </div>
      </header>

      {data.status === "loading" && <p className="ac-loading">Loading encounters…</p>}
      {opening && data.status === "ready" && <p className="ac-loading">Opening that encounter…</p>}
      {data.pin === "missing" && data.status === "ready" && (
        <p className="ac-note" role="status">That encounter isn't on the relay any more, so here's the newest one.</p>
      )}
      {data.status === "error" && !data.encounters.length && (
        <section className="ac-card">
          <h3 className="ac-card__title">Can't reach the relay</h3>
          <p className="ac-card__lede">{data.error}</p>
          <PixelButton small onClick={data.reload}>Try again</PixelButton>
        </section>
      )}
      {data.status === "ready" && !selected && <EmptyState />}

      {selected && !opening && (
        <>
          <EncounterStrip
            encounters={stripEncounters(data.encounters, selected.id, 10)}
            selectedId={selected.id}
            follow={follow}
            parties={data.parties}
            proposals={data.proposals}
            now={now}
            onPick={pick}
            onFollow={() => setPin(null)}
          />
          <p className="ac-enc-line">
            <span>Met {ago(selected.startedAt, now)}</span>
            <span>{selected.simulated ? "Demo walk (simulated GPS)" : "Real GPS · within 25 m"}</span>
            {engine && <span>Negotiated by: {ENGINE_LABEL[engine]}</span>}
          </p>
          {!big && (
            <nav className="ac-jump" aria-label="Jump to">
              <button type="button" onClick={() => jumpTo(SECTION.messages)}>Agents' messages</button>
              <button type="button" onClick={() => jumpTo(SECTION.talk)}>Pets' chat</button>
              <button type="button" onClick={() => jumpTo(SECTION.outcome)}>Outcome</button>
            </nav>
          )}
          <div className="ac-stage">
            <AgentCard party={partyOf(left)} side={left} sides={sides} role={roleOf(left)} anim={animOf(left)} align="left" big={big} />
            <Timeline enc={selected} log={log} sides={sides} shown={shown} left={left} parties={data.parties} />
            <AgentCard party={partyOf(right)} side={right} sides={sides} role={roleOf(right)} anim={animOf(right)} align="right" big={big} />
          </div>
          <div className="ac-lower">
            <Outcome
              enc={selected}
              proposal={proposal}
              parties={data.parties}
              engine={engine}
              refusal={refusal}
              decliner={declinerSide ? partyOf(declinerSide) : undefined}
              telling={telling}
            />
            <PetTalk enc={selected} parties={data.parties} left={left} />
            <Privacy enc={selected} log={log.slice(0, shown)} parties={data.parties} />
          </div>
          {engine && <p className="ac-engine-note">{ENGINE_NOTE[engine]}</p>}
        </>
      )}
      <HowItWorks />
    </div>
  );

  if (big && typeof document !== "undefined") {
    return (
      <>
        <div className="ac-stub">
          <p>The agent console is open on the big screen.</p>
          <PixelButton small onClick={() => setBig(false)}>Phone view</PixelButton>
        </div>
        {createPortal(<div className="ac-layer">{content}</div>, document.body)}
      </>
    );
  }
  return content;
}
