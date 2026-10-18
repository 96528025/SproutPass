// OWNER: Agent 2 (B5). Mounted once at the app root (Agent 3's Shell). When a new open proposal shows up for
// this parent, the trade window pops over whatever screen they're on, on both phones at once.
// It pops the newest live trade this tab hasn't closed, so a second offer pops once the first window is closed (the
// pill reopens closed ones and counts them). While the pets' meeting is on screen (`hold`: the Shell sees A's
// EncounterScene) the pop waits, so the scene's TRADE PROPOSAL! banner plays on top instead of under the window; it
// pops the moment the scene leaves, or after HOLD_MAX_MS of holding (wall clock) if the scene never does.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { TradeWindow } from "./TradeWindow";
import { useProposals } from "./useProposals";
import { sfx } from "./tradeKit";
import { HOLD_MAX_MS, doneWithTrade, popHeld, reopenLabel, reopenTarget, tradeToPop, type WatcherState } from "./tradeLogic";
import "./trade.css";

const SS_DISMISSED = "relay:trade:dismissed";

function readDismissed(): Set<string> {
  try { return new Set(JSON.parse(sessionStorage.getItem(SS_DISMISSED) ?? "[]") as string[]); } catch { return new Set(); }
}
function saveDismissed(ids: ReadonlySet<string>) {
  try { sessionStorage.setItem(SS_DISMISSED, JSON.stringify([...ids].slice(-20))); } catch { /* private mode */ }
}

export interface TradeWatcherProps {
  /** Hold the automatic pop (the pets' meeting is on screen). The pill and an open window are unaffected. */
  hold?: boolean;
}

export function TradeWatcher({ hold = false }: TradeWatcherProps) {
  // A window whose trade disappears (RESET) closes itself from inside TradeWindow, with a toast.
  const { live } = useProposals();
  const liveIds = useMemo(() => live.map((p) => p.id), [live]);
  const { pathname } = useLocation();
  const onTradeRoute = pathname.startsWith("/trade/");
  const [state, setState] = useState<WatcherState>(() => ({ openId: null, dismissed: readDismissed() }));
  const { openId } = state;

  useEffect(() => saveDismissed(state.dismissed), [state.dismissed]);

  // The trade that would pop now if nothing held it; then the hold, stamped on the wall clock when it starts.
  const candidate = tradeToPop(state, liveIds, onTradeRoute);
  const heldSince = useRef<number | null>(null);
  const [wake, setWake] = useState(0); // re-checks the hold when its safety valve is due
  useEffect(() => {
    if (!candidate) {
      heldSince.current = null;
      return;
    }
    const now = Date.now();
    if (hold && heldSince.current === null) heldSince.current = now;
    if (popHeld(hold, heldSince.current, now)) {
      const t = window.setTimeout(() => setWake((n) => n + 1), Math.max(0, (heldSince.current ?? now) + HOLD_MAX_MS - now));
      return () => window.clearTimeout(t);
    }
    heldSince.current = null;
    setState((s) => (s.openId ? s : { ...s, openId: candidate }));
    sfx("alert");
  }, [candidate, hold, wake]);

  const done = useCallback((id: string) => setState((s) => doneWithTrade(s, id)), []);
  const close = useCallback(() => setState((s) => (s.openId ? doneWithTrade(s, s.openId) : s)), []);

  // The Shell's celebration (SEE IT IN MY BAG) takes the buyer to the bag: the paid trade's window goes too.
  useEffect(() => {
    const onDone = (e: Event) => {
      const id = (e as CustomEvent<unknown>).detail;
      if (typeof id === "string") done(id);
    };
    window.addEventListener("trade:done", onDone);
    return () => window.removeEventListener("trade:done", onDone);
  }, [done]);

  if (onTradeRoute) return null;
  if (openId) return <TradeWindow key={openId} proposalId={openId} onClose={close} />;
  const reopen = reopenTarget(state, liveIds);
  if (reopen) {
    return (
      <button type="button" className="t-reopen" onClick={() => setState((s) => ({ ...s, openId: reopen }))}>
        {reopenLabel(liveIds.length)}
      </button>
    );
  }
  return null;
}

export default TradeWatcher;
