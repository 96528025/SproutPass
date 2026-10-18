// OWNER: B9 (was Agent 2 / B5). /log — the relay's hub and the end card judges see: links to the impact board and
// the agent console, how fast things get listed after the pet's nudge, the encounter → trade funnel, $0 declines,
// and every item's owner chain as a pixel timeline. Refreshes live (realtime + a slow poll as a safety net), batched
// and spaced out so a projector left on /log doesn't eat into Base44's rate limit.
import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../app/api";
import { errorText } from "../app/store";
import type { ImpactView, RelayStats } from "../app/types";
import { formatCents } from "../app/types";
import { Chip, Hearts, ItemIcon, PixelButton, PixelPanel, Sprite } from "../app/ui";
import { monthDay } from "./tradeKit";
import { QUICK_LIST_DAYS } from "../../base44/shared/logic/impact.ts";
import { duration, useBump, useCountUp, useLiveReload, type ReloadWhy } from "../impact/live";
import "./trade.css";
import "../impact/impact.css";

function median(xs: number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

const lastHandoff = (i: ItemStat) => i.chain[i.chain.length - 1]?.from ?? "";

/** Former owners outside the demo show as "Earlier family"; raw ids never reach the projector. */
const ownerLabel = (name: string) => (name.startsWith("former_") ? "Earlier family" : name);

type ItemStat = RelayStats["items"][number];

// What the log counts: trades and listings, items changing hands, the "still fit?" nudges. Not Encounter: it's
// written on every pet bubble, and a meeting that matters shows up as a MatchProposal anyway (the poll catches
// the rest).
const WATCH = ["MatchProposal", "Listing", "ClothingItem", "AgentNudge"] as const;
/** Only these can move the hub's impact numbers; other changes reload the stats alone. */
const IMPACT_TRIGGERS = ["MatchProposal", "Listing"] as const;

export function RelayLog() {
  const [stats, setStats] = useState<RelayStats | null>(null);
  const [impact, setImpact] = useState<ImpactView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (why?: ReloadWhy) => {
    const withImpact = !why || why.initial || why.poll || IMPACT_TRIGGERS.some((e) => why.changed.has(e));
    const [s, i] = await Promise.allSettled([api.getStats(), withImpact ? api.getImpact({}) : Promise.resolve(null)]);
    if (s.status === "fulfilled") { setStats(s.value); setError(null); } else setError(errorText(s.reason));
    if (i.status === "fulfilled" && i.value) setImpact(i.value); // the hub card just shows less without it
  }, []);
  const updatedAt = useLiveReload(load, WATCH);

  if (!stats) {
    return (
      <PixelPanel title="RELAY LOG">
        <div className="t-center">
          {error ? (
            <>
              <p className="t-p">The log didn't load: {error}</p>
              <PixelButton variant="ghost" onClick={() => void load()}>TRY AGAIN</PixelButton>
            </>
          ) : <Chip tone="cream">LOADING…</Chip>}
        </div>
      </PixelPanel>
    );
  }

  const med = median(stats.secondsToList);
  const toList = med == null ? null : duration(med);
  // The trade that just happened leads the list.
  const traded = stats.items.filter((i) => i.chain.length > 1)
    .sort((a, b) => lastHandoff(b).localeCompare(lastHandoff(a)) || a.name.localeCompare(b.name));
  const waiting = stats.items.filter((i) => i.chain.length <= 1);
  const listed = stats.secondsToList.length;
  const quick = stats.secondsToList.filter((x) => x <= QUICK_LIST_DAYS * 86400).length;

  return (
    <div className="t-log">
      <nav className="im-hub" aria-label="More from the relay">
        <Link to="/impact" className="im-hub-card im-hub-card--impact">
          <Sprite name="fx_sparkle" anim="loop" scale={2} />
          <span className="im-hub-title">IMPACT</span>
          {impact ? (
            <>
              <span className="im-hub-big">
                {impact.co2SavedKg.toLocaleString("en-US", { maximumFractionDigits: 1 })}
                <small className="im-unit">kg CO₂e</small>
              </span>
              <p className="im-hub-text">Carbon avoided across {impact.itemsRehomed} new {impact.itemsRehomed === 1 ? "home" : "homes"}, plus points and badges.</p>
            </>
          ) : <p className="im-hub-text">Carbon, water and money saved, plus points and badges.</p>}
          <span className="im-hub-go">Open impact{"\u00a0"}▸</span>
        </Link>
        <Link to="/agents" className="im-hub-card im-hub-card--agents">
          <Sprite name="pet_b" anim="talk" scale={2} />
          <span className="im-hub-title">AGENTS</span>
          <span className="im-hub-big">{stats.encounters}</span>
          <p className="im-hub-text">{stats.encounters === 1 ? "Meeting" : "Meetings"} so far. Watch the pets negotiate, message by message.</p>
          <span className="im-hub-go">Open console{"\u00a0"}▸</span>
        </Link>
      </nav>

      <PixelPanel title="RELAY LOG">
        <div className="im-live">
          <Chip tone="paper"><span className="im-live-dot" aria-hidden />LIVE</Chip>
          {updatedAt && <span className="t-label t-muted">UPDATED {clock(updatedAt)}</span>}
        </div>
        <div className="t-counter t-counter-hero">
          <span className="t-counter-num" aria-label={toList ? toList.words : "no listings yet"}>
            {toList ? <>{toList.value}<small className="t-unit">{toList.unit}</small></> : "—"}
          </span>
          <span className="t-label">TIME TO LIST · MEDIAN</span>
          <p className="im-sub">
            {listed
              ? `From the pet's "still fit?" to listed, across ${listed} ${listed === 1 ? "listing" : "listings"}.`
              : `From the pet's "still fit?" to listed. Shows up after the first listing.`}
          </p>
          {listed > 0 && (
            <p className="im-sub"><b>{quick} of {listed}</b> listed within {QUICK_LIST_DAYS} days of the nudge.</p>
          )}
        </div>
        <div className="t-funnel">
          <Counter n={stats.encounters} label={stats.encounters === 1 ? "ENCOUNTER" : "ENCOUNTERS"} />
          <span className="t-arrow" aria-hidden>▸</span>
          <Counter n={stats.proposals} label={stats.proposals === 1 ? "PROPOSAL" : "PROPOSALS"} />
          <span className="t-arrow" aria-hidden>▸</span>
          <Counter n={stats.trades} label={stats.trades === 1 ? "TRADE" : "TRADES"} tone="gold" />
        </div>
        <div className="t-declined">
          <span className="t-counter-num t-counter-sm">{stats.declinedWithZeroCharge}</span>
          <span className="t-label">DECLINED · $0 CHARGED</span>
        </div>
        <p className="im-sub">Nothing is charged until both parents accept. Demo payment · no real charge.</p>
      </PixelPanel>

      <PixelPanel title="OWNER CHAINS" tone="cream">
        {traded.length ? (
          <ul className="t-chains">{traded.map((i) => <Chain key={i.itemId} item={i} />)}</ul>
        ) : (
          <p className="im-p">No hand-me-downs yet. The first trade shows up here the moment it's paid.</p>
        )}
        {waiting.length > 0 && (
          <details className="t-how">
            <summary className="im-summary">
              {waiting.length} more {waiting.length === 1 ? "item" : "items"} still with {waiting.length === 1 ? "its" : "their"} first family
            </summary>
            <ul className="t-chains">{waiting.map((i) => <Chain key={i.itemId} item={i} />)}</ul>
          </details>
        )}
      </PixelPanel>
    </div>
  );
}

export default RelayLog;

/** "3:05 PM" in the viewer's time (real time, not the demo clock). */
function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function Counter({ n, label, tone }: { n: number; label: string; tone?: "gold" }) {
  const shown = useCountUp(n, 800);
  const bump = useBump(n);
  return (
    <div className={`t-counter${tone ? ` t-counter-${tone}` : ""}`}>
      <span className="t-counter-num" style={{ position: "relative" }}>
        {Math.round(shown)}
        {bump > 0 && <span className="im-bump" aria-hidden>+{bump}</span>}
      </span>
      <span className="t-label">{label}</span>
    </div>
  );
}

function Chain({ item }: { item: ItemStat }) {
  const hearts = Math.max(1, Math.min(3, item.ownerCount)) as 1 | 2 | 3;
  return (
    <li className="t-chain">
      <div className="t-row">
        <ItemIcon icon={item.icon} size={1} />
        <span className="t-chain-name">{item.name}</span>
        <Hearts filled={hearts} />
      </div>
      <ol className="t-timeline" aria-label={`${item.name} owners`}>
        {item.chain.map((c, k) => (
          <li key={k} className={`t-node${c.to ? "" : " t-node-now"}`}>
            <span className="t-node-name">{ownerLabel(c.ownerName)}</span>
            <span className="t-label">{monthDay(c.from)}{c.to ? ` → ${monthDay(c.to)}` : " → NOW"}</span>
            {(c.priceCents != null || k === 0) && (
              <span className="t-label t-node-price">{c.priceCents != null ? `PAID ${formatCents(c.priceCents)}` : "BOUGHT NEW"}</span>
            )}
            {!c.to && item.ownerCount >= 3 && <span className="t-label">FINAL HOME</span>}
          </li>
        ))}
      </ol>
    </li>
  );
}
