// OWNER: Agent 2 (B5). Mounted once at the app root (Agent 3's Shell). When a new open proposal shows up for
// this parent, the trade window pops over whatever screen they're on, on both phones at once.
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { TradeWindow } from "./TradeWindow";
import { useProposals } from "./useProposals";
import { sfx } from "./tradeKit";
import { doneWithTrade, tradeToPop, type WatcherState } from "./tradeLogic";
import "./trade.css";

const SS_DISMISSED = "relay:trade:dismissed";

function readDismissed(): Set<string> {
  try { return new Set(JSON.parse(sessionStorage.getItem(SS_DISMISSED) ?? "[]") as string[]); } catch { return new Set(); }
}
function saveDismissed(ids: ReadonlySet<string>) {
  try { sessionStorage.setItem(SS_DISMISSED, JSON.stringify([...ids].slice(-20))); } catch { /* private mode */ }
}

export function TradeWatcher() {
  // A window whose trade disappears (RESET) closes itself from inside TradeWindow, with a toast.
  const { active } = useProposals();
  const { pathname } = useLocation();
  const onTradeRoute = pathname.startsWith("/trade/");
  const [state, setState] = useState<WatcherState>(() => ({ openId: null, dismissed: readDismissed() }));
  const { openId } = state;

  useEffect(() => saveDismissed(state.dismissed), [state.dismissed]);

  useEffect(() => {
    const id = tradeToPop(state, active?.id ?? null, onTradeRoute);
    if (!id) return;
    setState((s) => ({ ...s, openId: id }));
    sfx("alert");
  }, [state, active, onTradeRoute]);

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
  if (active) {
    return (
      <button type="button" className="t-reopen" onClick={() => setState((s) => ({ ...s, openId: active.id }))}>
        ♥ TRADE OFFER · OPEN
      </button>
    );
  }
  return null;
}

export default TradeWatcher;
