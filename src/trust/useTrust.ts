// OWNER: B6 (trust UI). The current parent's TrustView (their pet's rules, spent this month, passkeys), shared by
// /bag/pet, the trade window's receipt and the pay button: one getTrust per parent, refreshed after a save,
// a new passkey or a payment. Also remembers which payments this tab approved with Face ID (for the badge).
import { useCallback, useEffect } from "react";
import { create } from "zustand";
import { api } from "../app/api";
import { errorText, useApp } from "../app/store";
import type { MatchProposal, PetMandate, TrustView } from "../app/types";
import { fullMandate } from "./trustLogic";

/** device = Face ID / a real passkey; demo = the mock's demo passkey; tap = the buyer tapped PAY (no Face ID rule). */
export type Approval = "device" | "demo" | "tap";

interface TrustState {
  byKey: Record<string, TrustView>;
  errorByKey: Record<string, string>;
  /** proposalId → how this tab's buyer approved it. */
  approvals: Record<string, Approval>;
}

const SS_APPROVALS = "relay:trust:approvals";

function readApprovals(): Record<string, Approval> {
  try { return JSON.parse(sessionStorage.getItem(SS_APPROVALS) ?? "{}") as Record<string, Approval>; } catch { return {}; }
}

const useTrustStore = create<TrustState>()(() => ({ byKey: {}, errorByKey: {}, approvals: readApprovals() }));
const inflight = new Map<string, Promise<TrustView | null>>();

function normal(t: TrustView): TrustView {
  return {
    mandate: fullMandate(t?.mandate),
    spentThisMonthCents: Math.max(0, Number(t?.spentThisMonthCents) || 0),
    passkeys: Array.isArray(t?.passkeys) ? t.passkeys : [],
  };
}

/** Fetch (or re-fetch with force) a parent's TrustView. Never throws: null + an error string on failure. */
export function loadTrust(parentKey: string, force = false): Promise<TrustView | null> {
  const have = useTrustStore.getState().byKey[parentKey];
  if (have && !force) return Promise.resolve(have);
  const running = inflight.get(parentKey);
  if (running) return running;
  const p = (async () => {
    try {
      const t = normal(await api.getTrust({ parentKey }));
      useTrustStore.setState((s) => ({
        byKey: { ...s.byKey, [parentKey]: t },
        errorByKey: { ...s.errorByKey, [parentKey]: "" },
      }));
      return t;
    } catch (e) {
      useTrustStore.setState((s) => ({ errorByKey: { ...s.errorByKey, [parentKey]: errorText(e) } }));
      return null;
    } finally {
      inflight.delete(parentKey);
    }
  })();
  inflight.set(parentKey, p);
  return p;
}

/** Put a fresh piece of the TrustView in place (after setMandate / passkeyRegisterVerify). */
export function patchTrust(parentKey: string, change: { mandate?: PetMandate; passkeys?: TrustView["passkeys"] }) {
  useTrustStore.setState((s) => {
    const was = s.byKey[parentKey];
    if (!was) return s;
    const next: TrustView = {
      ...was,
      ...(change.mandate ? { mandate: fullMandate(change.mandate) } : {}),
      ...(change.passkeys ? { passkeys: change.passkeys } : {}),
    };
    return { byKey: { ...s.byKey, [parentKey]: next } };
  });
}

/**
 * The current parent's TrustView. `trust` is null while it loads or when the server has no trust functions
 * yet (then `error` says why, and screens fall back to the plain flow: the server still enforces the rules).
 */
export function useTrust(): {
  trust: TrustView | null; error: string | null; parentKey: string | null; reload: () => Promise<TrustView | null>;
} {
  const parentKey = useApp((s) => s.parentKey);
  const trust = useTrustStore((s) => (parentKey ? s.byKey[parentKey] ?? null : null));
  const error = useTrustStore((s) => (parentKey ? s.errorByKey[parentKey] || null : null));
  useEffect(() => { if (parentKey) void loadTrust(parentKey); }, [parentKey]);
  const reload = useCallback(() => (parentKey ? loadTrust(parentKey, true) : Promise.resolve(null)), [parentKey]);
  return { trust, error, parentKey, reload };
}

/** Remember how this tab's buyer approved `proposalId` (Face ID, the mock's demo passkey, or a plain tap). */
export function markApproved(proposalId: string, via: Approval): void {
  useTrustStore.setState((s) => {
    const approvals = { ...s.approvals, [proposalId]: via };
    try {
      const keep = Object.fromEntries(Object.entries(approvals).slice(-20));
      sessionStorage.setItem(SS_APPROVALS, JSON.stringify(keep));
    } catch { /* private mode */ }
    return { approvals };
  });
}

/**
 * How a paid proposal was approved: this tab's own record, or the proposal's `approvedWith` when the server
 * writes one (so the seller sees the badge too).
 */
export function useApproval(p: MatchProposal): Approval | null {
  const mine = useTrustStore((s) => s.approvals[p.id] ?? null);
  if (mine) return mine;
  const server = (p as MatchProposal & { approvedWith?: unknown }).approvedWith;
  if (server === "passkey" || server === "device") return "device";
  if (server === "demo") return "demo";
  if (server === "tap") return "tap";
  return null;
}
