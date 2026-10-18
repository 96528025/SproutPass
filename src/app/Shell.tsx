// OWNER: B4. The app frame. Inside A's <HandheldFrame> (full-bleed on phones, a 430 px handheld ≥ 600 px):
// the demo panel, the routes, and — each mounted ONCE, here — A's <BottomBar> and <MuteToggle>, B's NudgeDialog,
// Agent 2's <TradeWatcher/>, C's pet, toasts, and A's <Celebration> over any screen when a trade is paid.
// Also: ?as= / ?demo= kept in step with the store, B's "sfx" events played through A's sfx, audio unlocked on
// the first tap.
import { useEffect, useRef, useState, type ComponentProps, type RefObject } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AppRoutes, PUBLIC_PATHS, TradeWatcher } from "./routes";
import { errorText, parentRef, startLiveSync, useApp, type ToastTone } from "./store";
import { ParentPicker } from "./ParentPicker";
import { DemoPanel } from "./DemoPanel";
import { PixelButton, PixelPanel, Toast, type ToastTone as KitToastTone } from "./ui";
import { Guard, optional } from "./optional";
import { api } from "./api";
import { NudgeDialog } from "../closet/NudgeDialog";
import { celebrate, tradeDone, usePublicParent } from "../trade/tradeKit";
import { HandheldFrame } from "../world/HandheldFrame";
import { BottomBar } from "../world/BottomBar";
import { MuteToggle } from "../world/MuteToggle";
import { Celebration } from "../world/Celebration";
import { useAudioUnlock } from "../world/useAudioUnlock";
import { sfx, type SfxName } from "../pixel/sfx";
import type { AgentNudge, MatchProposal, ProposalStatus } from "./types";

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

/**
 * Keep ?as= / ?demo=1 and the store in step. A navigation that carries a different ?as= (A's TitleScreen,
 * a withQuery link, a pasted URL) or ?demo=1 wins; otherwise the store's parent is written back into the URL
 * (react-router links drop the query).
 */
function useQuerySync() {
  const parentKey = useApp((s) => s.parentKey);
  const demo = useApp((s) => s.demo);
  const setParent = useApp((s) => s.setParent);
  const setDemo = useApp((s) => s.setDemo);
  const loc = useLocation();
  const nav = useNavigate();
  const lastSearch = useRef<string | null>(null);
  useEffect(() => {
    // A navigation is still in flight (this render's location is stale): let the next run handle it.
    if (window.location.pathname !== loc.pathname) return;
    const q = new URLSearchParams(loc.search);
    if (lastSearch.current !== loc.search) {
      lastSearch.current = loc.search;
      const as = q.get("as");
      const urlDemo = q.get("demo") === "1" || q.get("demo") === "true";
      if (urlDemo && !demo) setDemo(true);
      if (as && as !== parentKey) { setParent(as); return; }
    }
    let changed = false;
    if (parentKey && q.get("as") !== parentKey) { q.set("as", parentKey); changed = true; }
    if (!parentKey && q.has("as")) { q.delete("as"); changed = true; }
    if (demo && q.get("demo") !== "1") { q.set("demo", "1"); changed = true; }
    if (changed) nav({ pathname: loc.pathname, search: `?${q}`, hash: loc.hash }, { replace: true, state: loc.state });
  }, [parentKey, demo, setParent, setDemo, loc.pathname, loc.search, loc.hash, loc.state, nav]);
}

const SFX: ReadonlySet<string> = new Set<SfxName>(["start", "blip", "alert", "select", "accept", "decline", "coin", "jingle", "step"]);

/** B's screens say window.dispatchEvent(new CustomEvent("sfx", { detail: "coin" })); A's player plays it. */
function useSfxBridge() {
  useEffect(() => {
    const onSfx = (e: Event) => {
      const name = (e as CustomEvent<unknown>).detail;
      if (typeof name === "string" && SFX.has(name)) sfx.play(name as SfxName);
    };
    window.addEventListener("sfx", onSfx);
    return () => window.removeEventListener("sfx", onSfx);
  }, []);
}

/** Browsers only start audio inside a gesture: unlock A's sfx on the first tap / key anywhere (A's title does too). */
function useUnlockAudioOnFirstTap() {
  const { unlocked, unlock } = useAudioUnlock();
  useEffect(() => {
    if (unlocked) return;
    const events = ["pointerdown", "touchend", "click", "keydown"] as const;
    const onGesture = () => { void unlock(); };
    events.forEach((t) => window.addEventListener(t, onGesture, { capture: true, passive: true }));
    return () => events.forEach((t) => window.removeEventListener(t, onGesture, { capture: true }));
  }, [unlocked, unlock]);
}

/**
 * True while A's EncounterScene (its root is `.enc`) is on screen inside `root`. The pets' meeting owns the screen
 * and Enter/Space then (its no-match DialogBox too), so the Shell's NudgeDialog and pet step aside. Watched in the
 * DOM so WorldScreen, EncounterDev or any later screen that mounts the scene is covered without wiring a flag.
 */
function useEncounterUp(root: RefObject<HTMLElement | null>): boolean {
  const [up, setUp] = useState(false);
  useEffect(() => {
    const el = root.current;
    if (!el || typeof MutationObserver === "undefined") return;
    const check = () => setUp(!!el.querySelector(".enc"));
    check();
    const mo = new MutationObserver(check);
    mo.observe(el, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      setUp(false);
    };
  }, [root]);
  return up;
}

/**
 * A trade this tab saw open that turns paid celebrates too (e.g. the seller closed the trade window, so its
 * TradeWindow can't). celebrate() fires "trade:paid" at most once per proposal per tab.
 */
function useCelebrateWhenPaid() {
  const closet = useApp((s) => s.closet);
  const seen = useRef<{ parentId: string; status: Map<string, ProposalStatus> } | null>(null);
  useEffect(() => {
    if (!closet) return;
    const prev = seen.current?.parentId === closet.parent.id ? seen.current.status : null;
    if (prev) {
      for (const p of closet.proposals) {
        const was = prev.get(p.id);
        if (p.status === "paid" && was && was !== "paid") celebrate(p);
      }
    }
    seen.current = { parentId: closet.parent.id, status: new Map(closet.proposals.map((p) => [p.id, p.status])) };
  }, [closet]);
}

// ---------------------------------------------------------------- A's Celebration over any screen

type CelPerson = ComponentProps<typeof Celebration>["peer"];

/** The other party until getParties answers: their role as the name, and an avatar that isn't mine. */
function standIn(id: string, role: string, mySprite: string): CelPerson {
  return { id, name: role, avatar: { sprite: mySprite === "parent_b" ? "parent_a" : "parent_b" }, pet: { sprite: "pet_a", name: "Pet" } };
}

/** Renders nothing and calls onGone once (a celebration that can't show must not keep the dialogs hidden). */
function Gone({ onGone }: { onGone: () => void }) {
  const once = useRef(onGone);
  useEffect(() => { once.current(); }, []);
  return null;
}

function PaidCelebration({ proposal, onDone, onSkip }: { proposal: MatchProposal; onDone: () => void; onSkip: () => void }) {
  const me = useApp((s) => s.closet?.parent ?? null);
  const mine = !!me && (me.id === proposal.sellerId || me.id === proposal.buyerId);
  const peerId = me ? (me.id === proposal.sellerId ? proposal.buyerId : proposal.sellerId) : undefined;
  const peer = usePublicParent(mine ? peerId : undefined); // getParties, cached + retried (the trade window loaded it)
  if (!me || !peerId) return null;
  if (!mine) return <Gone onGone={onSkip} />;
  // A's Celebration takes the contract's MatchProposal and data-string sprites as they are (it narrows them).
  return (
    <Guard name="Celebration" fallback={<Gone onGone={onSkip} />}>
      <Celebration
        proposal={proposal}
        me={me}
        peer={peer ?? standIn(peerId, me.id === proposal.sellerId ? "Buyer" : "Seller", me.avatar.sprite)}
        onDone={onDone}
      />
    </Guard>
  );
}

// ---------------------------------------------------------------- frame

function ScreenCrashed() {
  return (
    <PixelPanel title="OOPS">
      <div className="b-center">
        <p className="b-p">This screen tripped over something. Reloading usually fixes it.</p>
        <PixelButton onClick={() => window.location.reload()}>RELOAD</PixelButton>
      </div>
    </PixelPanel>
  );
}

/** B's older toast tones in A's Toast. */
const kitTone = (t: ToastTone): KitToastTone => (t === "pink" ? "lav" : t === "cream" ? "paper" : t);

/** Full-screen screens (A's title and world) get the whole screen; B's screens get the padded column. */
function routeKind(path: string): "title" | "world" | "screen" {
  if (path === "/") return "title";
  if (path === "/world" || path.startsWith("/world/")) return "world";
  return "screen";
}

export function Shell() {
  useQuerySync();
  useSfxBridge();
  useUnlockAudioOnFirstTap();
  useCelebrateWhenPaid();
  const loc = useLocation();
  const nav = useNavigate();
  const parentKey = useApp((s) => s.parentKey);
  const demo = useApp((s) => s.demo);
  const toastMsg = useApp((s) => s.toastMsg);
  const toast = useApp((s) => s.toast);
  const petName = useApp((s) => s.closet?.parent.pet.name);
  const refreshCloset = useApp((s) => s.refreshCloset);
  const [paid, setPaid] = useState<MatchProposal | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const encounterUp = useEncounterUp(mainRef);

  useEffect(() => startLiveSync(), []);
  useEffect(() => { if (parentKey) void refreshCloset(); }, [parentKey, refreshCloset]);

  // B's PayButton / TradeWindow fire "trade:paid" (detail: MatchProposal) once per trade per tab.
  useEffect(() => {
    const onPaid = (e: Event) => {
      const p = (e as CustomEvent<MatchProposal | undefined>).detail;
      if (p?.id && p.status === "paid") setPaid(p);
    };
    window.addEventListener("trade:paid", onPaid);
    return () => window.removeEventListener("trade:paid", onPaid);
  }, []);
  useEffect(() => { setPaid(null); }, [parentKey]);

  const path = loc.pathname;
  const kind = routeKind(path);
  // A's title has its own "who are you?" step; /log is the projector end card.
  const needsParent = !parentKey && kind !== "title" && !PUBLIC_PATHS.includes(path);
  // The projector views (agent console, impact board) are for the big screen: no phone popups, pill or pet on them.
  const projector = path === "/agents" || path === "/impact";
  // The dev pages (/kit, /dev/*) run their own DialogBoxes, EncounterScene and Celebration.
  const noDialogHere =
    kind === "title" || projector || path.startsWith("/bag/list/") || path.startsWith("/trade/") ||
    path === "/kit" || path.startsWith("/dev/");
  const showDemo = demo && kind !== "title";
  const calm = !paid && !encounterUp; // nothing pops over the celebration or the pets' meeting
  const route = kind === "screen" ? (path.split("/")[1] || "bag") : kind;

  const onPetUnhandled = () =>
    toast(petName ? `Finish up here first. ${petName} is waiting.` : "Pick a parent first.", "lav");
  const doneCelebrating = () => {
    if (paid) tradeDone(paid.id); // the trade window under the celebration closes, so the bag shows
    setPaid(null);
    nav("/bag");
  };

  return (
    <HandheldFrame>
      <div className={`b-app${showDemo ? "" : " b-app--no-demo"}`}>
        {showDemo && <DemoPanel />}
        <main ref={mainRef} className={`b-main${kind === "screen" ? "" : " b-main--bleed"}`}>
          <Guard key={path} name="screen" fallback={<ScreenCrashed />}>
            {needsParent ? <ParentPicker /> : <AppRoutes />}
          </Guard>
        </main>
      </div>
      {/* display:contents: everything below is position:fixed to the handheld screen. */}
      <div className="b-overlays" data-route={route}>
        {!needsParent && kind !== "title" && <BottomBar petName={petName} onPetUnhandled={onPetUnhandled} />}
        <MuteToggle />
        {parentKey && !noDialogHere && calm && <Guard name="NudgeDialog" fallback={null}><NudgeDialog /></Guard>}
        {/* The trade window waits until the player is past the title; it pops on the next screen. */}
        {parentKey && !projector && kind !== "title" && <TradeWatcher />}
        {parentKey && !noDialogHere && calm && <Pet />}
        {paid && <PaidCelebration key={paid.id} proposal={paid} onDone={doneCelebrating} onSkip={() => setPaid(null)} />}
        {toastMsg && <Toast key={toastMsg.id} text={toastMsg.text} tone={kitTone(toastMsg.tone)} />}
      </div>
    </HandheldFrame>
  );
}
