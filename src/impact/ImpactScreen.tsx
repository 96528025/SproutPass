// OWNER: B9. /impact — what the relay has done so far: new homes for outgrown clothes, the carbon / water / waste
// that saves (with plain-language equivalents and every assumption + source listed), money kept in families'
// pockets, and Sprout points, badges and the leaderboard. Works without a parent picked (the projector); with one,
// a "you" card shows their points and the next badge to earn. Refreshes live as trades land. On a wide window
// (a laptop or the projector) it opens as a full-window "big screen" layer like /agents; ?view=phone or PHONE VIEW
// puts it back in the handheld frame.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { api } from "../app/api";
import { errorText, useApp } from "../app/store";
import type { PublicParty } from "../app/types";
import { formatCents } from "../app/types";
import { Chip, PixelButton, PixelPanel, Sprite } from "../app/ui";
import {
  BADGES, MAX_SHARED_NEEDS, POINTS, QUICK_LIST_DAYS, SOURCES, daysText, equivalents, type ImpactDetail,
} from "../../base44/shared/logic/impact.ts";
import { useBigScreen, useBump, useCountUp, useLiveReload, useWideWindow } from "./live";
import "./impact.css";

// Rows the numbers come from. Not Parent: it's written on every inbound iMessage and passkey challenge, and a new
// parent on the board shows up with the next poll.
const WATCH = ["ClothingItem", "MatchProposal", "Listing", "Need", "AgentNudge"] as const;

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export function ImpactScreen() {
  const parentKey = useApp((s) => s.parentKey);
  const [view, setView] = useState<ImpactDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parties, setParties] = useState<Record<string, PublicParty>>({});
  const [big, setBig] = useBigScreen("relay:impact:view");
  const wide = useWideWindow();

  const load = useCallback(async () => {
    try {
      // The view carries a few extras (byCategory, me.savedCents…) on top of the contract's ImpactView.
      setView((await api.getImpact(parentKey ? { parentKey } : {})) as ImpactDetail);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [parentKey]);
  useLiveReload(load, WATCH);

  // Avatars for the leaderboard (public card only: name, avatar, pet).
  const ids = (view?.points ?? []).map((p) => p.parentId).slice(0, 10).join(",");
  useEffect(() => {
    if (!ids) return;
    let alive = true;
    api.getParties({ parentIds: ids.split(",") })
      .then((list) => { if (alive) setParties(Object.fromEntries(list.map((p) => [p.id, p]))); })
      .catch(() => { /* names alone are fine */ });
    return () => { alive = false; };
  }, [ids]);

  const content = view ? (
    <Board view={view} parties={parties} big={big} canToggle={big || wide} onToggle={() => setBig(!big)} />
  ) : (
    <div className={`im${big ? " im--big im--loading" : ""}`}>
      <PixelPanel title="IMPACT">
        <div className="im-center">
          {error ? (
            <>
              <p className="im-p">The impact board didn't load: {error}</p>
              <PixelButton variant="ghost" onClick={() => void load()}>TRY AGAIN</PixelButton>
            </>
          ) : <Chip tone="cream">LOADING…</Chip>}
        </div>
      </PixelPanel>
    </div>
  );

  if (big && typeof document !== "undefined") {
    return (
      <>
        <div className="im-stub">
          <p className="im-p">The impact board is open on the big screen.</p>
          <PixelButton small onClick={() => setBig(false)}>Phone view</PixelButton>
        </div>
        {createPortal(<div className="im-layer">{content}</div>, document.body)}
      </>
    );
  }
  return content;
}

export default ImpactScreen;

function Board({ view, parties, big, canToggle, onToggle }: {
  view: ImpactDetail; parties: Record<string, PublicParty>; big: boolean; canToggle: boolean; onToggle: () => void;
}) {
  const eq = equivalents(view);
  const meRow = view.me ? view.points.find((p) => p.parentId === view.me!.parentId) : undefined;
  const meName = meRow?.name ?? parties[view.me?.parentId ?? ""]?.name ?? "You";

  return (
    <div className={`im${big ? " im--big" : ""}${view.me ? "" : " im--nome"}`}>
      <PixelPanel title="IMPACT" className="im-hero">
        <div className="im-hero-row">
          <Sprite name="fx_sparkle" anim="loop" scale={3} className="im-hero-fx" />
          <Counter value={view.itemsRehomed} className="im-hero-num" label="NEW HOMES" />
          <Sprite name="fx_flower" anim="bloom" scale={3} className="im-hero-fx" />
        </div>
        <p className="im-p im-hero-text">
          {view.itemsRehomed
            ? <>Outgrown clothes that went on to another family instead of a drawer or a bin. {view.tradesCompleted
              ? `${plural(view.tradesCompleted, "of them was", "of them were")} traded in this app.`
              : "The first trade in this app adds to it."}</>
            : <>No hand-me-downs yet. The first trade lights this board up the moment it's paid.</>}
        </p>
        <div className="im-links">
          <Link className="im-link" to="/log">Relay log{"\u00a0"}▸</Link>
          <Link className="im-link" to="/agents">Agent console{"\u00a0"}▸</Link>
          {canToggle && (
            <button type="button" className="im-link im-link--ghost" onClick={onToggle}>
              {big ? "Phone view" : "Big screen"}
            </button>
          )}
        </div>
      </PixelPanel>

      <PixelPanel title="FOR THE PLANET" tone="cream" className="im-planet">
        <div className="im-tiles">
          <Tile tone="mint" value={view.co2SavedKg} decimals={1} unit="kg CO₂e" label="CARBON AVOIDED"
            eq={eq.carMiles ? <>Like not driving <b>{plural(eq.carMiles, "mile")}</b> in an average car.</> : <>Every hand-off adds to this.</>} />
          <Tile tone="sky" value={view.waterSavedL} unit="litres" label="WATER SAVED"
            eq={eq.drinkingDays ? <>About <b>{daysText(eq.drinkingDays)}</b> of drinking water for one person.</> : <>Mostly the water it takes to grow cotton.</>} />
          <Tile tone="lav" value={view.wasteDivertedKg} decimals={2} unit="kg" label="KEPT OUT OF LANDFILL"
            eq={eq.onesies ? <>About the weight of <b>{plural(eq.onesies, "onesie")}</b>.</> : <>Clothes in use aren't in a landfill.</>} />
        </div>
        <p className="im-note">
          Conservative estimates; totals are rounded down.{" "}
          <button type="button" className="im-inline-link"
            onClick={() => document.getElementById("im-how")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
            How we count
          </button>
        </p>
      </PixelPanel>

      <PixelPanel title="FOR FAMILIES" className="im-families">
        <div className="im-money">
          <Money cents={view.dollarsSavedCents} label="SAVED BY BUYERS" text="Paid less than buying the same clothes new." />
          <Money cents={view.dollarsEarnedCents} label="BACK TO SELLERS" text="Earned from clothes their kids outgrew." />
        </div>
        <p className="im-note">The 2nd owner pays 60% of the original price, the 3rd pays 40%. Demo payment · no real charge.</p>
      </PixelPanel>

      {view.me && (
        <PixelPanel title={`YOU · ${meName.toUpperCase()}`} tone="lav" className="im-mine">
          <div className="im-me">
            <Sprite name={parties[view.me.parentId]?.pet.sprite ?? "pet_a"} anim="hop" scale={3} />
            <div className="im-me-points">
              <Counter value={view.me.points} className="im-me-num" label="SPROUT POINTS" />
            </div>
          </div>
          {view.me.badges.length > 0 ? (
            <div className="im-badges" aria-label="Your badges">
              {view.me.badges.map((b) => <Badge key={b} name={b} earned />)}
            </div>
          ) : <p className="im-p">No badges yet. Your first one is close.</p>}
          {view.me.nextBadge && (
            <div className="im-next">
              <span className="im-label">NEXT BADGE</span>
              <Badge name={view.me.nextBadge} />
              <p className="im-p">{BADGES.find((b) => b.name === view.me!.nextBadge)?.how}</p>
            </div>
          )}
          {(view.me.savedCents > 0 || view.me.earnedCents > 0) && (
            <p className="im-p">
              You saved <b>{formatCents(view.me.savedCents)}</b> buying second-hand and got back <b>{formatCents(view.me.earnedCents)}</b> passing clothes on.
            </p>
          )}
        </PixelPanel>
      )}

      <PixelPanel title="SPROUT LEADERBOARD" tone="cream" className="im-leaders">
        {view.points.length ? (
          <ol className="im-board">
            {view.points.map((p, i) => (
              <li key={p.parentId} className={`im-board-row${p.parentId === view.me?.parentId ? " im-board-me" : ""}`}>
                <span className="im-rank">{i + 1}</span>
                <span className="im-avatar">
                  <Sprite name={parties[p.parentId]?.avatar.sprite ?? "parent_a"} anim={i === 0 && p.points > 0 ? "cheer" : "idle"} scale={1} />
                </span>
                <span className="im-board-name">
                  <span className="im-name">{p.name}</span>
                  <span className="im-board-badges">{p.badges.length ? p.badges.join(" · ") : "No badges yet"}</span>
                </span>
                <BoardPoints value={p.points} />
              </li>
            ))}
          </ol>
        ) : <p className="im-p">No parents yet.</p>}
      </PixelPanel>

      <PixelPanel title="HOW TO EARN SPROUT POINTS" className="im-earn">
        <ul className="im-rules">
          <Rule pts={POINTS.sold}>Pass an item on to another family.</Rule>
          <Rule pts={POINTS.bought}>Give a hand-me-down a new home.</Rule>
          <Rule pts={POINTS.quickList}>List it within {QUICK_LIST_DAYS} days of your pet's "still fit?" nudge.</Rule>
          <Rule pts={POINTS.finalHome}>Bonus when an item you pass on reaches its 3rd and final home.</Rule>
          <Rule pts={POINTS.sharedNeed}>Share what your child needs next (up to {MAX_SHARED_NEEDS} needs).</Rule>
        </ul>
        <div className="im-badge-guide">
          {BADGES.map((b) => (
            <div key={b.name} className="im-badge-row">
              <Badge name={b.name} earned={!!view.me?.badges.includes(b.name)} />
              <span className="im-p">{b.how}</span>
            </div>
          ))}
        </div>
        <p className="im-note">Points come only from what happened: the same history always gives the same points. Nobody can buy them.</p>
      </PixelPanel>

      <section id="im-how" className="im-how" aria-labelledby="im-how-title">
        <h2 id="im-how-title" className="im-label">HOW WE COUNT</h2>
        <ul className="im-assumptions">
          {view.assumptions.map((a) => <li key={a}>{a}</li>)}
        </ul>
        {view.byCategory?.length > 0 && (
          <p className="im-p">
            Counted so far: {view.byCategory.map((c) => plural(c.handoffs, ...(CATEGORY_WORD[c.category] ?? [c.category, c.category]))).join(", ")}.
          </p>
        )}
        <h3 className="im-label">SOURCES</h3>
        <ol className="im-sources">
          {SOURCES.map((s) => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noreferrer noopener">{s.name}</a>
              <span className="im-source-use"> — {s.usedFor}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

const CATEGORY_WORD: Record<string, [string, string]> = {
  onesie: ["onesie", "onesies"], top: ["top", "tops"], bottom: ["pair of pants", "pairs of pants"],
  outerwear: ["jacket or sweater", "jackets and sweaters"], dress: ["dress", "dresses"], set: ["outfit set", "outfit sets"],
  other: ["hat, bib or sock pack", "hats, bibs and sock packs"],
};

function fmt(n: number, decimals: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** A big stepped count-up with a "+N" pop when it goes up live. */
function Counter({ value, label, className, decimals = 0 }: { value: number; label: string; className?: string; decimals?: number }) {
  const shown = useCountUp(value);
  const bump = useBump(value);
  return (
    <div className="im-counter">
      <span className={`im-num ${className ?? ""}`.trim()} aria-label={`${fmt(value, decimals)} ${label.toLowerCase()}`}>
        {fmt(decimals ? shown : Math.round(shown), decimals)}
        {bump > 0 && <span className="im-bump" aria-hidden>+{fmt(bump, decimals)}</span>}
      </span>
      <span className="im-label">{label}</span>
    </div>
  );
}

function Tile({ tone, value, decimals = 0, unit, label, eq }:
  { tone: "mint" | "sky" | "lav"; value: number; decimals?: number; unit: string; label: string; eq: ReactNode }) {
  const shown = useCountUp(value);
  const bump = useBump(value);
  return (
    <div className={`im-tile im-tile--${tone}`}>
      <span className="im-label">{label}</span>
      <span className="im-tile-num" aria-label={`${fmt(value, decimals)} ${unit}`}>
        {fmt(decimals ? Math.floor(shown * 10 ** decimals) / 10 ** decimals : Math.round(shown), decimals)}
        <small className="im-unit">{unit}</small>
        {bump > 0 && <span className="im-bump" aria-hidden>+{fmt(bump, decimals)}</span>}
      </span>
      <p className="im-eq">{eq}</p>
    </div>
  );
}

function Money({ cents, label, text }: { cents: number; label: string; text: string }) {
  const shown = useCountUp(cents);
  const bump = useBump(cents);
  return (
    <div className="im-money-cell">
      <span className="im-label">{label}</span>
      <span className="im-money-num">
        <Sprite name="ui_coin" scale={2} className="im-coin" />
        {formatCents(Math.round(shown))}
        {bump > 0 && <span className="im-bump" aria-hidden>+{formatCents(bump)}</span>}
      </span>
      <p className="im-p">{text}</p>
    </div>
  );
}

function BoardPoints({ value }: { value: number }) {
  const shown = useCountUp(value);
  const bump = useBump(value);
  return (
    <span className="im-board-points">
      {Math.round(shown)}
      <small className="im-unit">pts</small>
      {bump > 0 && <span className="im-bump" aria-hidden>+{bump}</span>}
    </span>
  );
}

function Badge({ name, earned }: { name: string; earned?: boolean }) {
  return (
    <span className={`im-badge${earned ? " im-badge--earned" : ""}`} title={BADGES.find((b) => b.name === name)?.how}>
      <span className="im-badge-medal" aria-hidden />
      {name.toUpperCase()}
    </span>
  );
}

function Rule({ pts, children }: { pts: number; children: ReactNode }) {
  return (
    <li className="im-rule">
      <span className="im-rule-pts">+{pts}</span>
      <span className="im-p">{children}</span>
    </li>
  );
}
