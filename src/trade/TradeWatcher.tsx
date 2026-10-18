// OWNER: Agent 2 (B5). Mounted once at the app root (Agent 3's Shell). When a new open proposal shows up for
// this parent, the trade window pops over whatever screen they're on, on both phones at once.
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { TradeWindow } from "./TradeWindow";
import { useProposals } from "./useProposals";
import { sfx } from "./tradeKit";
import "./trade.css";

const SS_DISMISSED = "relay:trade:dismissed";

function readDismissed(): Set<string> {
  try { return new Set(JSON.parse(sessionStorage.getItem(SS_DISMISSED) ?? "[]") as string[]); } catch { return new Set(); }
}
function saveDismissed(ids: Set<string>) {
  try { sessionStorage.setItem(SS_DISMISSED, JSON.stringify([...ids].slice(-20))); } catch { /* private mode */ }
}

export function TradeWatcher() {
  // A window whose trade disappears (RESET) closes itself from inside TradeWindow, with a toast.
  const { active } = useProposals();
  const { pathname } = useLocation();
  const onTradeRoute = pathname.startsWith("/trade/");
  const [openId, setOpenId] = useState<string | null>(null);
  const openRef = useRef(openId);
  openRef.current = openId;
  const dismissed = useRef<Set<string>>(readDismissed());

  useEffect(() => {
    if (!active || openId || onTradeRoute || dismissed.current.has(active.id)) return;
    setOpenId(active.id);
    sfx("alert");
  }, [active, openId, onTradeRoute]);

  const close = useCallback(() => {
    const id = openRef.current;
    if (id) { dismissed.current.add(id); saveDismissed(dismissed.current); }
    setOpenId(null);
  }, []);

  if (onTradeRoute) return null;
  if (openId) return <TradeWindow key={openId} proposalId={openId} onClose={close} />;
  if (active) {
    return (
      <button type="button" className="t-reopen" onClick={() => setOpenId(active.id)}>
        ♥ TRADE OFFER · OPEN
      </button>
    );
  }
  return null;
}

export default TradeWatcher;
