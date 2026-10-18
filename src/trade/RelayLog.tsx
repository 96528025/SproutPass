// OWNER: Agent 2 (B5). /log — the end card judges see: how fast things get listed, the encounter → trade
// funnel, $0 declines, and every item's owner chain as a pixel timeline.
import { useCallback, useEffect, useState } from "react";
import { api } from "../app/api";
import { errorText } from "../app/store";
import type { RelayStats } from "../app/types";
import { formatCents } from "../app/types";
import { Chip, Hearts, ItemIcon, PixelButton, PixelPanel } from "../app/ui";
import { monthDay } from "./tradeKit";
import "./trade.css";

function median(xs: number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Big number + small unit, readable on a projector: 42 SEC · 12:34 MIN · 3:05 HR · 2 DAYS */
function duration(sec: number): { value: string; unit: string } {
  const s = Math.round(sec);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (s < 60) return { value: String(s), unit: "SEC" };
  if (s < 3600) return { value: `${Math.floor(s / 60)}:${pad(s % 60)}`, unit: "MIN" };
  if (s < 86400) return { value: `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}`, unit: "HR" };
  const d = Math.floor(s / 86400);
  return { value: String(d), unit: d === 1 ? "DAY" : "DAYS" };
}

const lastHandoff = (i: ItemStat) => i.chain[i.chain.length - 1]?.from ?? "";

/** Former owners outside the demo show as "Earlier family"; raw ids never reach the projector. */
const ownerLabel = (name: string) => (name.startsWith("former_") ? "Earlier family" : name);

type ItemStat = RelayStats["items"][number];

export function RelayLog() {
  const [stats, setStats] = useState<RelayStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStats(await api.getStats());
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void load();
    let t: ReturnType<typeof setTimeout> | undefined;
    const kick = () => { clearTimeout(t); t = setTimeout(() => void load(), 300); };
    const offs = (["MatchProposal", "Listing"] as const).map((entity) => {
      try { return api.subscribe(entity, kick); } catch { return () => {}; }
    });
    return () => { clearTimeout(t); offs.forEach((off) => off()); };
  }, [load]);

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

  return (
    <div className="t-log">
      <PixelPanel title="RELAY LOG">
        <div className="t-counter t-counter-hero">
          <span className="t-counter-num">
            {toList ? <>{toList.value}<small className="t-unit">{toList.unit}</small></> : "—"}
          </span>
          <span className="t-label">SECONDS TO LIST · MEDIAN</span>
          <span className="t-label t-muted">FROM "STILL FIT?" TO LISTED{stats.secondsToList.length ? ` · ${stats.secondsToList.length} LISTING${stats.secondsToList.length === 1 ? "" : "S"}` : ""}</span>
        </div>
        <div className="t-funnel">
          <Counter n={stats.encounters} label="ENCOUNTERS" />
          <span className="t-arrow" aria-hidden>▸</span>
          <Counter n={stats.proposals} label="PROPOSALS" />
          <span className="t-arrow" aria-hidden>▸</span>
          <Counter n={stats.trades} label={stats.trades === 1 ? "TRADE" : "TRADES"} tone="gold" />
        </div>
        <div className="t-declined">
          <span className="t-counter-num t-counter-sm">{stats.declinedWithZeroCharge}</span>
          <span className="t-label">DECLINED · $0 CHARGED</span>
        </div>
      </PixelPanel>

      <PixelPanel title="OWNER CHAINS" tone="cream">
        {traded.length ? (
          <ul className="t-chains">{traded.map((i) => <Chain key={i.itemId} item={i} />)}</ul>
        ) : (
          <p className="t-p t-muted">No hand-me-downs yet. The first trade shows up here the moment it's paid.</p>
        )}
        {waiting.length > 0 && (
          <details className="t-how">
            <summary className="t-label">{waiting.length} MORE ITEM{waiting.length === 1 ? "" : "S"} WITH THEIR FIRST FAMILY</summary>
            <ul className="t-chains">{waiting.map((i) => <Chain key={i.itemId} item={i} />)}</ul>
          </details>
        )}
      </PixelPanel>
    </div>
  );
}

export default RelayLog;

function Counter({ n, label, tone }: { n: number; label: string; tone?: "gold" }) {
  return (
    <div className={`t-counter${tone ? ` t-counter-${tone}` : ""}`}>
      <span className="t-counter-num">{n}</span>
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
          </li>
        ))}
      </ol>
    </li>
  );
}
