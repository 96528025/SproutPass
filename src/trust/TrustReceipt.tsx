// OWNER: B6 (trust UI). The trade window's transparent receipt: what the item cost new, the owner number and
// the 60/40 rule, what the buyer saves, who gets paid, whether it fits the buyer's pet rules, and after paying
// the payment reference and how it was approved. Everything here is read from the proposal (server numbers)
// and the buyer's own TrustView; nothing is recomputed into a price.
import type { ReactNode } from "react";
import type { MatchProposal } from "../app/types";
import { formatCents } from "../app/types";
import { mandateFit, ownerSentence, tradeReceipt } from "../trade/tradeLogic";
import { biometric } from "./passkey";
import { useApproval, useTrust } from "./useTrust";
import "./trust.css";

const ORD: Record<2 | 3, string> = { 2: "2nd", 3: "3rd" };

export function TrustReceipt({ p, role, sellerName, buyerName, onEditRules }: {
  p: MatchProposal;
  role: "buyer" | "seller" | null;
  sellerName: string;
  buyerName: string;
  /** Opens /bag/pet (closes the trade window first). */
  onEditRules?: () => void;
}) {
  const r = tradeReceipt(p.snapshot);
  const paid = p.status === "paid";
  const ended = p.status === "declined" || p.status === "expired" || p.status === "payment_failed";

  return (
    <section className="tr-receipt" aria-label="Receipt">
      <div className="tr-receipt-head">
        <span className="tr-tag">Receipt</span>
        {paid && <span className="tr-tag tr-tag-paid">{p.visaSimulation ? "Simulated ✓" : "Paid ✓"}</span>}
      </div>
      <dl className="tr-lines">
        {role === "seller" ? (
          <>
            <Line label={p.visaSimulation ? paid ? "Simulated seller credit" : "Simulated sale amount" : paid ? "You were paid" : "You get"} value={formatCents(r.priceCents)} strong />
            <Line label={`${buyerName} ${paid ? "saved" : "saves"} vs new`} value={formatCents(r.savedCents)} />
            <Line label="Paid to" value="You" />
          </>
        ) : (
          <>
            <Line label={paid ? "You saved vs new" : "You save vs new"} value={`${formatCents(r.savedCents)} (${100 - r.pct}% off)`} strong />
            <Line label="Paid to" value={`${sellerName}, the seller`} />
            {role === "buyer" && !ended && <RulesLine price={r.priceCents} paid={paid} onEditRules={onEditRules} />}
          </>
        )}
        {paid && p.paymentRef && <Line label="Payment ref" value={<code className="tr-ref">{p.paymentRef}</code>} />}
        {paid && <ApprovedLine p={p} />}
        {ended && <Line label="Charged" value="$0.00 · nothing was charged" />}
      </dl>
      <p className="tr-rule">
        {ownerSentence(p.status, role, buyerName, r.ownerAfter)} {ORD[r.ownerAfter]} owners pay {r.pct}% of the original {formatCents(r.originalCents)}
        {r.finalHome
          ? ". This is its final home: after 3 owners it can't be sold again."
          : ", 3rd owners pay 40%, and after 3 owners it stays in its final home."}
      </p>
      <VisaPayment p={p} />
      <p className="tr-fine">SproutPass simulation · no Visa API · no real charge or funds transfer · no card required.</p>
    </section>
  );
}

function VisaPayment({ p }: { p: MatchProposal }) {
  const v = p.visaSimulation;
  // Historical receipts retain their original payment description.
  if (!v && p.status !== "open" && p.status !== "both_accepted") return null;
  const authorized = !!v?.authorizedAt;
  const captured = v?.status === "captured";
  return (
    <div className="tr-visa" aria-label="Visa payment simulation" aria-live="polite">
      <div className="tr-receipt-head"><strong>VISA</strong><span className="tr-tag">SIMULATION</span></div>
      <p>{formatCents(v?.amountCents ?? p.snapshot.priceCents)} USD · {v ? ({ authorizing: "Authorizing…", authorized: "Finishing trade…", captured: "Complete", declined: "Authorization declined" }[v.status]) : "Starts after buyer approval"}</p>
      <ol className="tr-visa-steps">
        <li>{v ? "✓" : "○"} Demo payment token</li>
        <li>{authorized ? "✓" : v?.status === "declined" ? "✕" : "○"} Simulated authorization</li>
        <li>{captured ? "✓" : "○"} Simulated capture & seller credit</li>
      </ol>
      {v?.authorizationCode && <p className="tr-fine">Authorization: {v.authorizationCode}</p>}
      {v?.capturedAt && <p className="tr-fine">Receipt saved · {new Date(v.capturedAt).toLocaleString()}</p>}
      {v?.status === "declined" && <p className="tr-fine">Nothing charged. The item remains with the seller.</p>}
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className={strong ? "tr-line tr-line-strong" : "tr-line"}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** "Within your pet's rules ✓ (up to $25.00 a trade, $82.00 left this month)". Buyer only (their rules are private). */
function RulesLine({ price, paid, onEditRules }: { price: number; paid: boolean; onEditRules?: () => void }) {
  const { trust, error } = useTrust();
  if (!trust) {
    // No trust functions on this server yet: say nothing rather than guess. The server still enforces them.
    return error ? null : <Line label="Your pet's rules" value={<span className="tr-muted">Checking…</span>} />;
  }
  const fit = mandateFit(trust.mandate, trust.spentThisMonthCents, price, paid);
  const left = `${formatCents(fit.leftAfterCents)} left this month${paid ? "" : " after this"}`;
  const value = fit.ok ? (
    <span className="tr-ok">✓ Within your pet's rules (up to {formatCents(fit.maxCents)} a trade, {left})</span>
  ) : (
    <span className="tr-bad">
      ✗ {fit.withinMax ? "Over this month's budget" : `Over your ${formatCents(fit.maxCents)}-a-trade limit`}
      {onEditRules && <> · <button type="button" className="tr-inline-link" onClick={onEditRules}>Edit your pet's rules</button></>}
    </span>
  );
  return <Line label="Your pet's rules" value={value} />;
}

function ApprovedLine({ p }: { p: MatchProposal }) {
  const how = useApproval(p);
  if (!how) return null;
  const text = how === "device" ? `${biometric()} on this device` : how === "demo" ? "Demo passkey (stand-in for Face ID)" : "Buyer approval";
  return <Line label="Approved with" value={text} />;
}

/** "Approved with Face ID ✓" under a paid trade, when the payment was approved with a passkey. */
export function ApprovalBadge({ p }: { p: MatchProposal }) {
  const how = useApproval(p);
  if (how !== "device" && how !== "demo") return null;
  return (
    <span className="tr-badge" role="status">
      {how === "device" ? `Approved with ${biometric()} ✓` : "Approved with the demo passkey ✓"}
    </span>
  );
}
