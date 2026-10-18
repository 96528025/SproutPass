// OWNER: Agent 2 (B5). The trade window both phones see: a modal over any screen (TradeWatcher) and the
// route /trade/:proposalId (Agent 3's TradeRoute renders it with { proposalId, onClose }).
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../app/api";
import { errorCode, errorText, parentRef, useApp } from "../app/store";
import type { Decision, MatchProposal, ProposalStatus } from "../app/types";
import { formatCents } from "../app/types";
import { RESALE_PCT } from "../../base44/shared/pricing.ts";
import { Chip, DialogBox, Hearts, ItemIcon, Modal, PixelButton, PriceReceipt, Sprite } from "../app/ui";
import { PayButton } from "./PayButton";
import { useProposals } from "./useProposals";
import {
  CONDITION_TEXT, DECISION_TEXT, celebrate, monthDay, newHomeText, sfx, usePublicParent, type Party as PartyInfo,
} from "./tradeKit";
import "./trade.css";

const CLOSE_AFTER_PAID_MS = 1500;
const CLOSE_AFTER_DECLINE_MS = 2500;

export function TradeWindow({ proposalId, onClose }: { proposalId: string; onClose: () => void }) {
  // Callers re-render with new onClose functions; timers must call it at most once.
  const closed = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const close = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    onCloseRef.current();
  }, []);
  return (
    <Modal title="TRADE PROPOSAL!" onClose={close}>
      <TradeBody proposalId={proposalId} close={close} />
    </Modal>
  );
}

export default TradeWindow;

function TradeBody({ proposalId, close }: { proposalId: string; close: () => void }) {
  const { byId, me, upsert } = useProposals();
  const p = byId[proposalId];
  const refreshCloset = useApp((s) => s.refreshCloset);
  const toast = useApp((s) => s.toast);
  const [missing, setMissing] = useState(false);

  // The trade vanished under an open window: RESET deleted it (a delete event, or a closet that no longer
  // lists it), RESET re-seeded this parent with a new id, or the server answered not_found. Close it.
  const lastStatus = useRef<ProposalStatus | null>(null);
  const gone = useCallback(() => {
    if (lastStatus.current !== "paid") toast("THIS TRADE WAS CLEARED · NOTHING CHARGED", "lav");
    close();
  }, [toast, close]);
  const shown = useRef(false);
  const involved = !!(p && me && (p.buyerId === me || p.sellerId === me));
  if (p) lastStatus.current = p.status;
  useEffect(() => {
    if (involved) { shown.current = true; return; }
    if (shown.current && (!p || me)) gone();
  }, [involved, p, me, gone]);

  // Opened by URL before the closet knew about it: refresh once, then give up.
  useEffect(() => {
    if (p) return;
    let live = true;
    const t = setTimeout(() => {
      void refreshCloset().then((c) => {
        if (live && !c?.proposals.some((x) => x.id === proposalId)) setMissing(true);
      });
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [p, proposalId, refreshCloset]);

  if (!p) {
    return (
      <div className="t-center">
        {missing && !shown.current ? (
          <>
            <p className="t-p">We couldn't find this trade.</p>
            <PixelButton variant="ghost" onClick={close}>CLOSE</PixelButton>
          </>
        ) : <Chip tone="cream">LOADING…</Chip>}
      </div>
    );
  }
  return <TradeDetails p={p} me={me} upsert={upsert} close={close} gone={gone} />;
}

function TradeDetails({ p, me, upsert, close, gone }: {
  p: MatchProposal; me: string | null; upsert: (p: MatchProposal) => void; close: () => void; gone: () => void;
}) {
  const toast = useApp((s) => s.toast);
  const myPet = useApp((s) => s.closet?.parent.pet ?? null);
  const seller = usePublicParent(p.sellerId);
  const buyer = usePublicParent(p.buyerId);
  const role = me === p.sellerId ? "seller" : me === p.buyerId ? "buyer" : null;
  const other = role === "seller" ? buyer : seller;
  const otherName = other?.name ?? (role === "seller" ? "the buyer" : "the seller");
  const myDecision: Decision | null = role === "seller" ? p.sellerDecision : role === "buyer" ? p.buyerDecision : null;
  const s = p.snapshot;

  // ---- live transitions: celebrate / close
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeLater = useCallback((ms: number) => {
    if (timer.current) return;
    timer.current = setTimeout(close, ms);
  }, [close]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const prevStatus = useRef(p.status);
  const myClickAt = useRef(0); // the other side's ✓ gets a sound; our own click already made one
  useEffect(() => {
    const was = prevStatus.current;
    prevStatus.current = p.status;
    if (was === p.status) return;
    if (p.status === "paid") {
      if (celebrate(p)) {
        toast(role === "seller" ? `SOLD TO ${otherName.toUpperCase()} · ${formatCents(s.priceCents)}` : newHomeText(p), "gold");
      }
      closeLater(CLOSE_AFTER_PAID_MS);
    } else if (p.status === "declined") {
      if (Date.now() - myClickAt.current > 2000) sfx("decline");
      closeLater(CLOSE_AFTER_DECLINE_MS);
    } else if (p.status === "both_accepted") {
      if (Date.now() - myClickAt.current > 2000) sfx("accept");
    }
  }, [p, role, otherName, s.priceCents, toast, closeLater]);

  // ---- decide
  const [busy, setBusy] = useState<Decision | null>(null);
  const [later, setLater] = useState(p.handover === "later");
  const [note, setNote] = useState(p.handoverNote ?? "");
  async function decide(decision: "accepted" | "declined") {
    if (busy) return;
    setBusy(decision);
    myClickAt.current = Date.now();
    sfx(decision === "accepted" ? "accept" : "decline");
    const handoverChanged = later !== (p.handover === "later") || (later && note.trim() !== (p.handoverNote ?? ""));
    try {
      const next = await api.decideProposal({
        ...parentRef(), proposalId: p.id, decision,
        ...(handoverChanged ? { handover: later ? "later" as const : "now" as const, handoverNote: later ? note.trim() : "" } : {}),
      });
      upsert(next);
    } catch (e) {
      if (errorCode(e) === "not_found") gone();
      else toast(errorText(e), "red");
    } finally {
      setBusy(null);
    }
  }

  const pct = RESALE_PCT[(s.previousOwners >= 2 ? 2 : 1) as 1 | 2];
  const ownerAfter = (Math.min(3, s.previousOwners + 1) >= 3 ? 3 : 2) as 2 | 3;
  const hearts = Math.max(1, Math.min(3, s.previousOwners)) as 1 | 2 | 3;
  const cond = CONDITION_TEXT[s.condition] ?? CONDITION_TEXT.gently_used;
  const speaker = myPet ?? seller?.pet ?? { name: "PET", sprite: "pet_a" };
  const petOf = (parentId: string, from: string) =>
    (parentId === p.sellerId ? seller?.pet.name : parentId === p.buyerId ? buyer?.pet.name : undefined)
    ?? (from === "seller_agent" ? "SELLER'S PET" : "BUYER'S PET");

  return (
    <div className="t-scroll">
      <div className="t-banner" role="note">NOTHING IS CHARGED UNTIL YOU BOTH ACCEPT.</div>

      <div className="t-header">
        <PartyCard who={seller} label="SELLER" you={role === "seller"} />
        <div className="t-mid">
          <div className="t-item-slot">
            <ItemIcon icon={s.icon} size={2} />
            {s.photo && (
              <img className="t-thumb" src={s.photo} alt="" width={40} height={40}
                onError={(e) => { e.currentTarget.style.display = "none"; }} />
            )}
          </div>
          <span className="t-swap" aria-hidden>⇄</span>
        </div>
        <PartyCard who={buyer} label="BUYER" you={role === "buyer"} />
      </div>

      <section className="t-details">
        <div className="t-row-between">
          <h2 className="t-item-name">{s.itemName}</h2>
          <Chip tone="cream">{s.size}</Chip>
        </div>
        <p className="t-label">BOUGHT {monthDay(s.originalPurchaseDate)} · {formatCents(s.originalPriceCents)}</p>
        <p className="t-p">
          <span className="t-stars" aria-label={cond.label}>{cond.stars}</span> <span className="t-label">{cond.label}</span>
          {s.conditionNote && <span className="t-note"> · “{s.conditionNote}”</span>}
        </p>
        <div className="t-row">
          <Hearts filled={hearts} />
          <span className="t-label">{s.previousOwners} PREVIOUS OWNER{s.previousOwners === 1 ? "" : "S"}</span>
        </div>
        <PriceReceipt original={s.originalPriceCents} pct={pct} price={s.priceCents} ownerAfter={ownerAfter} />
        <DialogBox speaker={{ name: speaker.name, sprite: speaker.sprite }} lines={[p.reason]} />
        {s.wearWeeksLeft != null && (
          <div><Chip tone="mint">FITS ~{s.wearWeeksLeft} MORE WEEK{s.wearWeeksLeft === 1 ? "" : "S"}</Chip></div>
        )}
        <details className="t-how">
          <summary className="t-label">HOW OUR PETS FOUND THIS</summary>
          {p.transcript?.length ? (
            <ol className="t-transcript">
              {p.transcript.map((t, i) => (
                <li key={i} className={t.from === "seller_agent" ? "t-turn t-turn-seller" : "t-turn t-turn-buyer"}>
                  <span className="t-label">{petOf(t.parentId, t.from)}</span> {t.text}
                </li>
              ))}
            </ol>
          ) : (
            <p className="t-p t-muted">Your pets passed each other nearby, compared notes and found a fit.</p>
          )}
        </details>
      </section>

      <div className="t-status" aria-live="polite">
        <SideStatus name={seller?.name ?? "SELLER"} decision={p.sellerDecision} you={role === "seller"} />
        <SideStatus name={buyer?.name ?? "BUYER"} decision={p.buyerDecision} you={role === "buyer"} />
      </div>

      {p.handover === "later" && (
        <p className="t-label t-handover">HAND OVER LATER{p.handoverNote ? ` · ${p.handoverNote}` : ""}</p>
      )}

      <div className="t-actions-area">
        {p.status === "open" && role && myDecision === "pending" && (
          <div className="t-stack">
            <label className="t-check">
              <input type="checkbox" checked={later} onChange={(e) => setLater(e.target.checked)} />
              <span className="t-label">HAND OVER LATER</span>
            </label>
            {later && (
              <input className="t-input" value={note} maxLength={80} placeholder="Saturday at the park bench"
                onChange={(e) => setNote(e.target.value)} aria-label="Handover note" />
            )}
            <div className="t-actions">
              <PixelButton variant="primary" disabled={!!busy} onClick={() => void decide("accepted")}>
                {busy === "accepted" ? "…" : "ACCEPT"}
              </PixelButton>
              <PixelButton variant="danger" disabled={!!busy} onClick={() => void decide("declined")}>
                {busy === "declined" ? "…" : "DECLINE"}
              </PixelButton>
            </div>
          </div>
        )}
        {p.status === "open" && myDecision === "accepted" && (
          <p className="t-wait t-label">YOU ACCEPTED ✓ · WAITING FOR {otherName.toUpperCase()}…</p>
        )}
        {p.status === "open" && !role && <p className="t-wait t-label">VIEWING ONLY</p>}

        {p.status === "both_accepted" && role === "buyer" && (
          <PayButton proposal={p} onGone={gone} onDone={(next) => { upsert(next); if (next.status === "paid") closeLater(CLOSE_AFTER_PAID_MS); }} />
        )}
        {p.status === "both_accepted" && role !== "buyer" && (
          <div className="t-stack">
            <p className="t-wait t-label">BOTH ACCEPTED ✓ · WAITING FOR {(buyer?.name ?? "THE BUYER").toUpperCase()} TO PAY…</p>
            <Chip tone="cream">DEMO PAYMENT · NO REAL CHARGE</Chip>
          </div>
        )}

        {p.status === "paid" && (
          <div className="t-final t-final-paid">
            <p className="t-big">{role === "seller" ? `SOLD · ${formatCents(s.priceCents)}` : newHomeText(p)}</p>
            <p className="t-label">PAID ✓ {p.paymentRef ?? ""} · DEMO PAYMENT · NO REAL CHARGE</p>
          </div>
        )}
        {p.status === "declined" && (
          <div className="t-final t-final-declined">
            <p className="t-big">NO TRADE · $0 CHARGED</p>
            <PixelButton variant="ghost" onClick={close}>CLOSE</PixelButton>
          </div>
        )}
        {p.status === "expired" && (
          <div className="t-final">
            <p className="t-big">THIS OFFER TIMED OUT</p>
            <p className="t-label">NOTHING CHARGED</p>
            <PixelButton variant="ghost" onClick={close}>CLOSE</PixelButton>
          </div>
        )}
        {p.status === "payment_failed" && (
          <div className="t-final t-final-declined">
            <p className="t-big">PAYMENT DIDN'T GO THROUGH · NOTHING CHARGED · TRY AGAIN</p>
            <p className="t-p t-muted">The {s.itemName.toLowerCase()} is back on the shelf for the next time your pets meet.</p>
            <PixelButton variant="ghost" onClick={close}>CLOSE</PixelButton>
          </div>
        )}
      </div>
    </div>
  );
}

function PartyCard({ who, label, you }: { who: PartyInfo | null; label: string; you: boolean }) {
  return (
    <div className="t-party">
      <Sprite name={who?.avatar.sprite ?? "parent_a"} anim="idle" scale={3} />
      {/* Until the name loads (retried under the rate limit), the role stands in for it. */}
      <span className="t-party-name">{who?.name ?? label}</span>
      {(who || you) && <span className="t-label t-muted">{you ? `${label} · YOU` : label}</span>}
    </div>
  );
}

function SideStatus({ name, decision, you }: { name: string; decision: Decision; you: boolean }) {
  return (
    <div className={`t-side t-side-${decision}`}>
      <span className="t-label">{name.toUpperCase()}{you ? " (YOU)" : ""}</span>
      <strong className="t-side-text">{DECISION_TEXT[decision]}</strong>
    </div>
  );
}
