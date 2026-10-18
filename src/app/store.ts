// OWNER: B4. App state: who's playing (?as=), their closet, toasts. Screens read it with useApp().
import { create } from "zustand";
import { api, ApiError } from "./api";
import type { EntityEvent } from "./api";
import type { ClosetView, EntityName, ParentRef } from "./types";
import type { ToastTone as KitToastTone } from "../pixel/components";

/** A's Toast tones, plus B's older "pink" / "cream" (the Shell draws them as "lav" / "paper"). */
export type ToastTone = KitToastTone | "pink" | "cream";
export interface ToastMsg { id: number; text: string; tone: ToastTone }

interface AppState {
  /** Seed key from ?as= ("mina" | "jo" | "sam"); null shows the ParentPicker. */
  parentKey: string | null;
  /** ?demo=1: shows the DemoPanel. */
  demo: boolean;
  closet: ClosetView | null;
  closetStatus: "idle" | "loading" | "ready" | "error";
  closetError: string | null;
  toastMsg: ToastMsg | null;
  setParent(key: string | null): void;
  /** Turn ?demo=1 on for this tab (a link or the title screen carried it). */
  setDemo(on: boolean): void;
  refreshCloset(): Promise<ClosetView | null>;
  toast(text: string, tone?: ToastTone): void;
}

const SS_AS = "relay:as";
const SS_DEMO = "relay:demo";

function readSession(k: string): string | null {
  try { return sessionStorage.getItem(k); } catch { return null; }
}
function writeSession(k: string, v: string | null) {
  try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch { /* private mode */ }
}

/** ?as= wins and is remembered for this tab, so navigations that drop the query keep the parent. */
function initialQuery(): { parentKey: string | null; demo: boolean } {
  if (typeof window === "undefined") return { parentKey: null, demo: false };
  const q = new URLSearchParams(window.location.search);
  const as = q.get("as");
  if (as) writeSession(SS_AS, as);
  const demoQ = q.get("demo");
  if (demoQ !== null) writeSession(SS_DEMO, demoQ === "1" ? "1" : null);
  return { parentKey: as ?? readSession(SS_AS), demo: (demoQ ?? readSession(SS_DEMO)) === "1" };
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

export function errorCode(e: unknown): string | null {
  return e instanceof ApiError ? e.code : null;
}

let toastSeq = 0;
let running: Promise<ClosetView | null> | null = null;
let queued: Promise<ClosetView | null> | null = null;

async function fetchCloset(): Promise<ClosetView | null> {
  const { parentKey: key, closet } = useApp.getState();
  if (!key) return null;
  if (closet?.parent.key !== key) useApp.setState({ closetStatus: "loading" });
  try {
    const next = await api.getCloset({ parentKey: key });
    if (useApp.getState().parentKey === key) useApp.setState({ closet: next, closetStatus: "ready", closetError: null });
    return next;
  } catch (e) {
    if (useApp.getState().parentKey === key) useApp.setState({ closetStatus: "error", closetError: errorText(e) });
    return null;
  }
}

export const useApp = create<AppState>()((set, get) => ({
  ...initialQuery(),
  closet: null,
  closetStatus: "idle",
  closetError: null,
  toastMsg: null,

  setParent(key) {
    writeSession(SS_AS, key);
    set({ parentKey: key, closet: null, closetStatus: "idle", closetError: null }); // Shell refreshes on parentKey change
  },

  setDemo(on) {
    writeSession(SS_DEMO, on ? "1" : null);
    set({ demo: on });
  },

  // At most one getCloset in flight plus one queued (Base44 rate-limits; event bursts must not fan out).
  refreshCloset() {
    if (!running) {
      running = fetchCloset().finally(() => { running = null; });
      return running;
    }
    queued ??= running.then(() => { queued = null; return get().refreshCloset(); });
    return queued;
  },

  toast(text, tone = "mint") {
    const id = ++toastSeq;
    set({ toastMsg: { id, text, tone } });
    setTimeout(() => { if (get().toastMsg?.id === id) set({ toastMsg: null }); }, 2600);
  },
}));

/** The ParentRef every api call takes, for the parent currently playing. */
export function parentRef(): ParentRef {
  return { parentKey: useApp.getState().parentKey ?? undefined };
}

// ---------------------------------------------------------------- live sync

const WATCHED: EntityName[] = ["ClothingItem", "Listing", "AgentNudge", "MatchProposal", "Setting", "Need", "Parent"];

function touchesMe(entity: EntityName, e: EntityEvent<Record<string, unknown>>): boolean {
  const { parentKey, closet } = useApp.getState();
  if (!parentKey) return false;
  if (!closet || e.type === "delete" || !e.data) return true;
  const me = closet.parent.id;
  const d = e.data;
  switch (entity) {
    case "ClothingItem":
      return d.currentOwnerId === me || closet.items.some((i) => i.id === e.id) || closet.passedOn.some((i) => i.id === e.id);
    case "Listing": return d.sellerId === me;
    case "AgentNudge": return d.parentId === me;
    case "Need": return d.parentId === me;
    case "Parent": return e.id === me;
    case "MatchProposal": return d.buyerId === me || d.sellerId === me;
    default: return true; // Setting: the demo clock moved
  }
}

/** Subscribe once to the entities the bag shows; refresh the closet (debounced 200 ms) on changes for this parent. */
export function startLiveSync(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const kick = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void useApp.getState().refreshCloset(), 200);
  };
  const unsubs = WATCHED.map((entity) => {
    try {
      return api.subscribe<Record<string, unknown>>(entity, (e) => { if (touchesMe(entity, e)) kick(); });
    } catch (e) {
      console.warn(`[relay] subscribe(${entity}) failed:`, e);
      return () => {};
    }
  });
  return () => {
    clearTimeout(timer);
    unsubs.forEach((u) => u());
  };
}
