// OWNER: B4. Every route in the app. A owns / and /world (+ the dev pages /kit, /dev/art, /dev/encounter),
// Agent 2 owns /trade/:id and /log (mounted from their files, lazily; placeholders if a file crashes).
import { useLayoutEffect } from "react";
import { Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { optional } from "./optional";
import {
  DevPagePlaceholder, RelayLogPlaceholder, TitlePlaceholder, TradeWatcherPlaceholder, TradeWindowPlaceholder,
  WorldPlaceholder,
} from "./placeholders";
import { Chip } from "./ui";
import { Bag } from "../closet/Bag";
import { ListingFlow } from "../closet/ListingFlow";
import { NeedsScreen } from "../closet/NeedsScreen";

const loading = <div className="b-center"><Chip tone="cream">LOADING…</Chip></div>;

export const TitleScreen = optional("../world/TitleScreen.tsx", "TitleScreen", TitlePlaceholder, loading);
export const WorldScreen = optional("../world/WorldScreen.tsx", "WorldScreen", WorldPlaceholder, loading);
// A's dev pages (A's NEEDS: B mounts them): the pixel kit, the art sheet, the encounter rehearsal.
const KitPage = optional("../world/KitPage.tsx", "KitPage", DevPagePlaceholder, loading);
const ArtPage = optional("../world/ArtPage.tsx", "ArtPage", DevPagePlaceholder, loading);
const EncounterDev = optional("../world/EncounterDev.tsx", "EncounterDev", DevPagePlaceholder, loading);
// Hackathon upgrades (lazy; a placeholder until the file exists or if it crashes).
const AgentConsole = optional("../console/AgentConsole.tsx", "AgentConsole", DevPagePlaceholder, loading);
const ImpactScreen = optional("../impact/ImpactScreen.tsx", "ImpactScreen", DevPagePlaceholder, loading);
const PetMandate = optional("../trust/PetMandate.tsx", "PetMandate", DevPagePlaceholder, loading);
const SnapToList = optional("../closet/SnapToList.tsx", "SnapToList", DevPagePlaceholder, loading);
export const TradeWindow = optional<{ proposalId: string; onClose: () => void }>(
  "../trade/TradeWindow.tsx", "TradeWindow", TradeWindowPlaceholder);
export const RelayLog = optional("../trade/RelayLog.tsx", "RelayLog", RelayLogPlaceholder, loading);
// `hold`: the Shell holds the automatic pop while A's EncounterScene is up (the placeholder ignores it).
export const TradeWatcher = optional<{ hold?: boolean }>("../trade/TradeWatcher.tsx", "TradeWatcher", TradeWatcherPlaceholder);

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

/** A new screen opens at its top: the page on phones (b.css), the screen box in the desktop handheld. */
function useTopOnNavigate() {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    (document.scrollingElement ?? document.documentElement).scrollTop = 0;
    document.querySelectorAll<HTMLElement>(".b-main, .hf__scroll").forEach((el) => { el.scrollTop = 0; });
  }, [pathname]);
}

export function AppRoutes() {
  useTopOnNavigate();
  return (
    <Routes>
      <Route path="/" element={<TitleScreen />} />
      <Route path="/world" element={<WorldScreen />} />
      <Route path="/bag" element={<Bag />} />
      <Route path="/bag/needs" element={<NeedsScreen />} />
      <Route path="/bag/list/:itemId" element={<ListingFlow />} />
      <Route path="/bag/add" element={<SnapToList />} />
      <Route path="/bag/pet" element={<PetMandate />} />
      <Route path="/agents" element={<AgentConsole />} />
      <Route path="/impact" element={<ImpactScreen />} />
      <Route path="/trade/:proposalId" element={<TradeRoute />} />
      <Route path="/log" element={<RelayLog />} />
      <Route path="/kit" element={<KitPage />} />
      <Route path="/dev/art" element={<ArtPage />} />
      <Route path="/dev/encounter" element={<EncounterDev />} />
      <Route path="*" element={<Bag />} />
    </Routes>
  );
}

/**
 * Routes that render without a parent picked: the projector end card, A's title screen (it has its own
 * "WHO ARE YOU?" step with B's ParentPicker) and A's dev pages.
 */
export const PUBLIC_PATHS = ["/", "/log", "/agents", "/impact", "/kit", "/dev/art", "/dev/encounter"];
