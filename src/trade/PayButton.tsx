// OWNER: B6 (trust UI; was Agent 2 / B5). Buyer-only pay button, shown once both sides accepted. Demo payment,
// no real money. When the buyer's pet rules say "require Face ID to pay", the payment is approved on this device
// first (passkeyAuthOptions → startAuthentication → payProposal({ passkey })): the pet can find and propose,
// only the person can pay.
import { useEffect, useRef, useState } from "react";
import { api } from "../app/api";
import { errorCode, errorText, parentRef, useApp } from "../app/store";
import type { MatchProposal } from "../app/types";
import { formatCents } from "../app/types";
import { Chip, PixelButton } from "../app/ui";
import {
  approvePayment, biometric, cancelPasskeyPrompt, passkeySupport, PasskeyCancelled, PasskeyUnavailable,
  registerPasskey, USE_MOCK,
} from "../trust/passkey";
import {
  expectedMode, isAlreadyRegistered, needsPasskeyError, noPasskeyForSite, QUICK_FAIL_MS, type ApprovalMode,
  type PasskeySupport,
} from "../trust/trustLogic";
import { loadTrust, markApproved, patchTrust, useTrust, type Approval } from "../trust/useTrust";
import { celebrate, newHomeText, sfx } from "./tradeKit";
import "./trade.css";
import "../trust/trust.css";

const MIN_SPIN_MS = 1000;

type Phase = "idle" | "approving" | "paying" | "setup";
/** Why the last approval didn't happen, when adding a passkey on this device could fix it. */
type Retry = "no_key" | "cancelled" | null;

const DemoChip = () => <Chip tone="cream" plain>Demo payment · no real charge</Chip>;

export function PayButton({ proposal, onDone, onGone }: {
  proposal: MatchProposal; onDone?: (p: MatchProposal) => void; /** the trade was deleted (RESET) */ onGone?: () => void;
}) {
  const demo = useApp((s) => s.demo);
  const toast = useApp((s) => s.toast);
  const myName = useApp((s) => s.closet?.parent.name ?? null);
  const { trust, parentKey, reload } = useTrust();
  const [phase, setPhase] = useState<Phase>("idle");
  const [support, setSupport] = useState<PasskeySupport | null>(null);
  /** The server asked for Face ID even though the rules we loaded didn't (rules changed on another phone). */
  const [forced, setForced] = useState(false);
  const [retry, setRetry] = useState<Retry>(null);
  const busy = useRef(false); // a double tap pays once

  useEffect(() => {
    let live = true;
    void passkeySupport().then((s) => { if (live) setSupport(s); });
    return () => { live = false; cancelPasskeyPrompt(); };
  }, []);

  const needsPasskey = forced || !!trust?.mandate.requirePasskey;
  const hasPasskey = (trust?.passkeys.length ?? 0) > 0;
  const mode: ApprovalMode | null = support ? expectedMode(support, USE_MOCK) : null;
  const name = mode === "demo" ? "demo passkey" : biometric();
  const price = formatCents(proposal.snapshot.priceCents);
  const forWhom = myName ? ` for ${myName}` : "";

  async function pay(fail: boolean) {
    if (busy.current) return;
    busy.current = true;
    try { await payOnce(fail); } finally { busy.current = false; }
  }

  async function payOnce(fail: boolean) {
    let approval: { passkey: Record<string, unknown>; via: Approval } | null = null;
    // The rules may not have loaded yet (first tap right after the window opened): ask once, from the cache.
    const rules = trust ?? (parentKey ? await loadTrust(parentKey) : null);
    if (forced || rules?.mandate.requirePasskey) {
      setPhase("approving");
      setRetry(null);
      const started = Date.now();
      try {
        approval = await approvePayment(proposal.id);
      } catch (e) {
        setPhase("idle");
        const keysSaved = (rules?.passkeys.length ?? 0) > 0;
        if (e instanceof PasskeyCancelled) {
          // Failing at once means the prompt never asked: the saved passkey lives on another phone or computer.
          const quick = Date.now() - started < QUICK_FAIL_MS;
          toast(quick ? `This device has no saved passkey${forWhom} · nothing charged` : `${biometric()} cancelled · nothing charged`, "lav");
          if (keysSaved) setRetry(quick ? "no_key" : "cancelled");
        } else if (e instanceof PasskeyUnavailable) {
          toast("This browser can't use a passkey · nothing charged", "red");
        } else if (errorCode(e) === "not_found" && onGone) {
          onGone();
        } else if (noPasskeyForSite(e)) {
          toast(`No passkey${forWhom} is saved for this site yet · nothing charged`, "lav");
          setRetry("no_key");
        } else {
          toast(errorText(e), "red");
        }
        return;
      }
    }
    setPhase("paying");
    // Recorded before the call: the other phone's realtime "paid" can land before our own reply does.
    markApproved(proposal.id, approval?.via ?? "tap");
    try {
      const [res] = await Promise.all([
        api.payProposal({
          ...parentRef(), proposalId: proposal.id,
          ...(fail ? { fail: true } : {}),
          ...(approval ? { passkey: approval.passkey } : {}),
        }),
        new Promise((r) => setTimeout(r, MIN_SPIN_MS)),
      ]);
      if (res.proposal.status === "paid") {
        sfx("coin");
        if (celebrate(res.proposal)) toast(newHomeText(res.proposal), "gold");
        void reload(); // spent this month moved
      } else if (res.proposal.status === "payment_failed") {
        toast("Payment didn't go through · nothing was charged", "red");
      }
      onDone?.(res.proposal);
    } catch (e) {
      if (errorCode(e) === "not_found" && onGone) onGone();
      else if (!approval && needsPasskeyError(e)) {
        setForced(true);
        void reload();
        toast(`This payment needs ${name} · nothing charged`, "lav");
      } else toast(errorText(e), "red");
    } finally {
      setPhase("idle");
    }
  }

  /** Make a passkey on this device. Returns true when one was saved. */
  async function setUp(): Promise<boolean> {
    if (busy.current) return false;
    busy.current = true;
    setPhase("setup");
    try {
      const { passkeys, via } = await registerPasskey();
      if (parentKey) patchTrust(parentKey, { passkeys, ...(trust ? { mandate: { ...trust.mandate, requirePasskey: true } } : {}) });
      await reload(); // the first passkey turns Face ID approval on
      toast(via === "demo" ? "Demo passkey ready" : `${biometric()} ready on this device`, "mint");
      return true;
    } catch (e) {
      if (e instanceof PasskeyCancelled) toast("Set-up cancelled · nothing changed", "lav");
      else if (isAlreadyRegistered(e)) toast(`This device already has a passkey${forWhom}. Tap Pay to use it.`, "lav");
      else toast(errorText(e), "red");
      return false;
    } finally {
      busy.current = false;
      setPhase("idle");
    }
  }

  /** The saved passkey is on another device: add one here, then approve this payment with it. */
  async function addHereAndPay() {
    if (await setUp()) {
      setRetry(null);
      await pay(false);
    } else {
      setRetry(null);
    }
  }

  // ---- the busy states
  if (phase === "approving" || phase === "paying" || phase === "setup") {
    const text = phase === "approving" ? `Waiting for ${name}…`
      : phase === "setup" ? `Setting up ${name}…`
      : `Paying ${price}…`;
    return (
      <div className="t-pay">
        <div className="t-paying" role="status" aria-live="polite">
          <span className="t-spinner" aria-hidden><i /><i /><i /><i /></span>
          <span className="tr-status-text">{text}</span>
        </div>
        {phase === "approving" && (
          <p className="tr-why">Approve this one payment of {price} on this device. Cancel and nothing is charged.</p>
        )}
        <DemoChip />
      </div>
    );
  }

  // ---- Face ID rule on, but this browser can't approve (real server only; the mock has the demo passkey)
  if (needsPasskey && mode === "unavailable") {
    return (
      <div className="t-pay">
        <p className="tr-why tr-why-warn">
          Your pet's rules say every payment needs Face ID or a passkey, and this browser can't use one.
          Open the app on your phone to pay{hasPasskey ? "." : ", or turn that rule off in your pet's rules."}
        </p>
        <DemoChip />
      </div>
    );
  }

  // ---- Face ID rule on, no passkey yet: set one up right here
  if (needsPasskey && trust && !hasPasskey) {
    return (
      <div className="t-pay">
        <p className="tr-why">
          Your pet's rules say every payment needs {name}. Set it up once on this {mode === "demo" ? "browser" : "device"},
          then approve the payment.
        </p>
        <PixelButton variant="primary" onClick={() => void setUp()}>SET UP {name.toUpperCase()}</PixelButton>
        <DemoChip />
      </div>
    );
  }

  return (
    <div className="t-pay">
      <PixelButton variant="primary" onClick={() => void pay(false)}>
        {needsPasskey ? `PAY ${price} WITH ${name.toUpperCase()}` : `PAY ${price}`}
      </PixelButton>
      {needsPasskey ? (
        <p className="tr-why">
          {mode === "demo"
            ? "This browser has no built-in passkey, so the demo uses a stand-in. You still approve it yourself."
            : `${biometric()} approves this one payment. Your pet can propose trades, but only you can pay.`}
        </p>
      ) : (
        <p className="tr-why">Only you can pay. Your pet found the trade; you decide.</p>
      )}
      {retry && (
        <div className="tr-retry" role="status">
          <p className="tr-why">
            {retry === "no_key" ? `This device has no saved passkey${forWhom}.` : `${biometric()} didn't finish.`}{" "}
            If your passkey is on another phone or computer, add one on this device and pay from here.
          </p>
          <PixelButton variant="ghost" onClick={() => void addHereAndPay()}>ADD THIS DEVICE, THEN PAY</PixelButton>
        </div>
      )}
      <DemoChip />
      {demo && (
        <details className="tr-demo-tools">
          <summary>Demo tools</summary>
          <button type="button" className="tr-demo-btn" onClick={() => void pay(true)}>Simulate a failed payment</button>
        </details>
      )}
    </div>
  );
}
