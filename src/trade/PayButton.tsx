// OWNER: Agent 2 (B5). Buyer-only pay button, shown once both sides accepted. Demo payment, no real money.
import { useState } from "react";
import { api } from "../app/api";
import { errorCode, errorText, parentRef, useApp } from "../app/store";
import type { MatchProposal } from "../app/types";
import { formatCents } from "../app/types";
import { Chip, PixelButton } from "../app/ui";
import { celebrate, newHomeText, sfx } from "./tradeKit";
import "./trade.css";

const MIN_SPIN_MS = 1000;

export function PayButton({ proposal, onDone, onGone }: {
  proposal: MatchProposal; onDone?: (p: MatchProposal) => void; /** the trade was deleted (RESET) */ onGone?: () => void;
}) {
  const demo = useApp((s) => s.demo);
  const toast = useApp((s) => s.toast);
  const [paying, setPaying] = useState(false);

  async function pay(fail: boolean) {
    if (paying) return;
    setPaying(true);
    try {
      const [res] = await Promise.all([
        api.payProposal({ ...parentRef(), proposalId: proposal.id, ...(fail ? { fail: true } : {}) }),
        new Promise((r) => setTimeout(r, MIN_SPIN_MS)),
      ]);
      if (res.proposal.status === "paid") {
        sfx("coin");
        if (celebrate(res.proposal)) toast(newHomeText(res.proposal), "gold");
      } else if (res.proposal.status === "payment_failed") {
        toast("PAYMENT DIDN'T GO THROUGH · NOTHING CHARGED", "red");
      }
      onDone?.(res.proposal);
    } catch (e) {
      if (errorCode(e) === "not_found" && onGone) onGone();
      else toast(errorText(e), "red");
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="t-pay">
      {paying ? (
        <div className="t-paying" role="status" aria-live="polite">
          <span className="t-spinner" aria-hidden><i /><i /><i /><i /></span>
          <span className="t-label">PAYING {formatCents(proposal.snapshot.priceCents)}…</span>
        </div>
      ) : (
        <PixelButton variant="primary" onClick={() => void pay(false)}>
          PAY {formatCents(proposal.snapshot.priceCents)}
        </PixelButton>
      )}
      <Chip tone="cream">DEMO PAYMENT · NO REAL CHARGE</Chip>
      {demo && !paying && (
        <button type="button" className="t-link" onClick={() => void pay(true)}>SIMULATE FAILURE</button>
      )}
    </div>
  );
}
