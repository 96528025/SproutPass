// OWNER: B4. The app frame: projector "handheld" column, demo panel, routes, bottom tab bar,
// the pet's nudge dialog, toasts and Agent 2's <TradeWatcher/>.
import { useEffect } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { AppRoutes, PUBLIC_PATHS, TradeWatcher } from "./routes";
import { errorText, parentRef, startLiveSync, useApp } from "./store";
import { ParentPicker } from "./ParentPicker";
import { DemoPanel } from "./DemoPanel";
import { PixelButton, PixelPanel, Toast } from "./ui";
import { Guard, optional } from "./optional";
import { api } from "./api";
import { NudgeDialog } from "../closet/NudgeDialog";
import type { AgentNudge } from "./types";

interface AgentPetProps {
  parentId: string;
  pet: { name: string; sprite: string };
  onChoice?: (choice: "sell" | "keep" | "later", nudge: AgentNudge) => void;
  onOpenTrade?: () => void;
}
const AgentPet = optional<AgentPetProps>("../agent/AgentPet.tsx", "AgentPet", () => null);

/** C's pet in the corner (and behind the PET tab). Its nudge answers go through the same resolveNudge as NudgeDialog. */
function Pet() {
  const closet = useApp((s) => s.closet);
  const toast = useApp((s) => s.toast);
  const nav = useNavigate();
  if (!closet) return null;
  const onChoice = async (choice: "sell" | "keep" | "later", nudge: AgentNudge) => {
    try {
      const res = await api.resolveNudge({ ...parentRef(), nudgeId: nudge.id, action: choice === "later" ? "snooze" : choice });
      if (res.next === "open_listing") nav(`/bag/list/${res.itemId}`);
    } catch (e) {
      toast(errorText(e), "red");
    }
  };
  const onOpenTrade = () => {
    const p = closet.proposals.find((x) => x.status === "open" || x.status === "both_accepted");
    if (p) nav(`/trade/${p.id}`);
  };
  return <AgentPet parentId={closet.parent.id} pet={closet.parent.pet} onChoice={onChoice} onOpenTrade={onOpenTrade} />;
}

/** Keep ?as= / ?demo=1 in the URL across navigations (react-router links drop the query). */
function useQuerySync() {
  const parentKey = useApp((s) => s.parentKey);
  const demo = useApp((s) => s.demo);
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => {
    // A navigation is still in flight (this render's location is stale): let the next run handle it.
    if (window.location.pathname !== loc.pathname) return;
    const q = new URLSearchParams(loc.search);
    let changed = false;
    if (parentKey && q.get("as") !== parentKey) { q.set("as", parentKey); changed = true; }
    if (!parentKey && q.has("as")) { q.delete("as"); changed = true; }
    if (demo && q.get("demo") !== "1") { q.set("demo", "1"); changed = true; }
    if (changed) nav({ pathname: loc.pathname, search: `?${q}`, hash: loc.hash }, { replace: true, state: loc.state });
  }, [parentKey, demo, loc.pathname, loc.search, loc.hash, loc.state, nav]);
}

function TabBar() {
  const pet = useApp((s) => s.closet?.parent.pet);
  const toast = useApp((s) => s.toast);
  const tab = ({ isActive }: { isActive: boolean }) => `b-tab${isActive ? " active" : ""}`;
  const openPet = () => {
    // C's pet chat listens for this; until then, a friendly hint.
    const handled = !window.dispatchEvent(new CustomEvent("pet:open", { cancelable: true }));
    if (!handled) toast(`${pet?.name ?? "YOUR PET"} IS NAPPING · CHAT COMING SOON`, "lav");
  };
  return (
    <nav className="b-tabbar" aria-label="Main">
      <NavLink to="/world" className={tab}><span className="b-tab-glyph" aria-hidden>✿</span>WORLD</NavLink>
      <NavLink to="/bag" className={tab}><span className="b-tab-glyph" aria-hidden>▣</span>BAG</NavLink>
      <button type="button" className="b-tab b-tab-pet" onClick={openPet}>
        <span className="b-tab-glyph" aria-hidden>◕</span>{pet?.name ?? "PET"}
      </button>
      <NavLink to="/log" className={tab}><span className="b-tab-glyph" aria-hidden>≡</span>LOG</NavLink>
    </nav>
  );
}

function ScreenCrashed() {
  return (
    <PixelPanel title="OOPS">
      <div className="b-center">
        <p className="b-p">This screen tripped over something.</p>
        <PixelButton onClick={() => window.location.reload()}>RELOAD</PixelButton>
      </div>
    </PixelPanel>
  );
}

export function Shell() {
  useQuerySync();
  const loc = useLocation();
  const parentKey = useApp((s) => s.parentKey);
  const demo = useApp((s) => s.demo);
  const toastMsg = useApp((s) => s.toastMsg);
  const refreshCloset = useApp((s) => s.refreshCloset);

  useEffect(() => startLiveSync(), []);
  useEffect(() => { if (parentKey) void refreshCloset(); }, [parentKey, refreshCloset]);

  const needsParent = !parentKey && !PUBLIC_PATHS.includes(loc.pathname);
  const noDialogHere = loc.pathname.startsWith("/bag/list/") || loc.pathname.startsWith("/trade/");

  return (
    <div className="b-frame">
      <div className="b-handheld">
        {demo && <DemoPanel />}
        <main className="b-main">
          <Guard key={loc.pathname} name="screen" fallback={<ScreenCrashed />}>
            {needsParent ? <ParentPicker /> : <AppRoutes />}
          </Guard>
        </main>
        {!needsParent && <TabBar />}
        {parentKey && !noDialogHere && <Guard name="NudgeDialog" fallback={null}><NudgeDialog /></Guard>}
        {parentKey && <TradeWatcher />}
        {parentKey && !noDialogHere && <Pet />}
      </div>
      {toastMsg && <Toast key={toastMsg.id} text={toastMsg.text} tone={toastMsg.tone} />}
    </div>
  );
}
