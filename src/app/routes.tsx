// OWNER: B4. Every route in the app. A owns / and /world, Agent 2 owns /trade/:id and /log
// (mounted from their files as soon as they exist; placeholders until then).
import { Route, Routes, useNavigate, useParams } from "react-router-dom";
import { optional } from "./optional";
import {
  RelayLogPlaceholder, TitlePlaceholder, TradeWatcherPlaceholder, TradeWindowPlaceholder, WorldPlaceholder,
} from "./placeholders";
import { Chip } from "./ui";
import { Bag } from "../closet/Bag";
import { ListingFlow } from "../closet/ListingFlow";
import { NeedsScreen } from "../closet/NeedsScreen";

const loading = <div className="b-center"><Chip tone="cream">LOADING…</Chip></div>;

export const TitleScreen = optional("../world/TitleScreen.tsx", "TitleScreen", TitlePlaceholder, loading);
export const WorldScreen = optional("../world/WorldScreen.tsx", "WorldScreen", WorldPlaceholder, loading);
export const TradeWindow = optional<{ proposalId: string; onClose: () => void }>(
  "../trade/TradeWindow.tsx", "TradeWindow", TradeWindowPlaceholder);
export const RelayLog = optional("../trade/RelayLog.tsx", "RelayLog", RelayLogPlaceholder, loading);
export const TradeWatcher = optional("../trade/TradeWatcher.tsx", "TradeWatcher", TradeWatcherPlaceholder);

function TradeRoute() {
  const { proposalId = "" } = useParams();
  const nav = useNavigate();
  const close = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) nav(-1); else nav("/bag", { replace: true });
  };
  return (
    <>
      <Bag />
      <TradeWindow proposalId={proposalId} onClose={close} />
    </>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<TitleScreen />} />
      <Route path="/world" element={<WorldScreen />} />
      <Route path="/bag" element={<Bag />} />
      <Route path="/bag/needs" element={<NeedsScreen />} />
      <Route path="/bag/list/:itemId" element={<ListingFlow />} />
      <Route path="/trade/:proposalId" element={<TradeRoute />} />
      <Route path="/log" element={<RelayLog />} />
      <Route path="*" element={<Bag />} />
    </Routes>
  );
}

/** Routes that render without a parent picked (the projector end card). */
export const PUBLIC_PATHS = ["/log"];
