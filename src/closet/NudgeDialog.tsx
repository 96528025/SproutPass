// OWNER: B4. The pet speaks up when the closet has an unresolved nudge (oldest first, one at a time).
// The parent always chooses (rule 3): SELL opens the listing flow, KEEP / LATER just resolve.
import { useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../app/api";
import { DialogBox, Sprite } from "../app/ui";
import { errorText, parentRef, useApp } from "../app/store";
import type { AgentNudge, ResolveNudgeReq } from "../app/types";

type Action = ResolveNudgeReq["action"];

const CHOICES: Record<AgentNudge["kind"], { label: string; value: Action }[]> = {
  outgrow_check: [{ label: "SELL", value: "sell" }, { label: "KEEP", value: "keep" }, { label: "LATER", value: "snooze" }],
  listing_reminder: [{ label: "KEEP LISTED", value: "keep" }, { label: "LATER", value: "snooze" }],
  new_owner_welcome: [{ label: "OK", value: "keep" }],
};

/**
 * A's DialogBox sits position:fixed above the bottom bar. While it's up, pad the screen by its height (--dock-h,
 * read by .b-main) so nothing underneath is unreachable. `key` changes when a different nudge (a new box) shows.
 */
function useDockPadding(key: string | null) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = document.documentElement.style;
    const box = key ? ref.current?.querySelector<HTMLElement>(".dlg") : null;
    if (!box) { root.removeProperty("--dock-h"); return; }
    const measure = () => root.setProperty("--dock-h", `${box.offsetHeight + 8}px`);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => { ro.disconnect(); root.removeProperty("--dock-h"); };
  }, [key]);
  return ref;
}

export function NudgeDialog() {
  const closet = useApp((s) => s.closet);
  const toast = useApp((s) => s.toast);
  const refreshCloset = useApp((s) => s.refreshCloset);
  const nav = useNavigate();
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const nudge = closet?.nudges
    .filter((n) => !n.resolved && !answered.has(n.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  const dockRef = useDockPadding(nudge?.id ?? null);

  if (!closet || !nudge) return null;

  const item = closet.items.find((i) => i.id === nudge.itemId);
  const choices = CHOICES[nudge.kind].filter((c) => c.value !== "sell" || !item || item.ownerCount < 3);

  const choose = async (value: string) => {
    if (busy) return;
    setBusy(true);
    setAnswered((s) => new Set(s).add(nudge.id));
    try {
      const res = await api.resolveNudge({ ...parentRef(), nudgeId: nudge.id, action: value as Action });
      if (res.next === "open_listing") nav(`/bag/list/${res.itemId}`);
      else if (value === "snooze") toast(`${closet.parent.pet.name.toUpperCase()} WILL ASK AGAIN LATER`, "lav");
      void refreshCloset();
    } catch (e) {
      setAnswered((s) => { const n = new Set(s); n.delete(nudge.id); return n; });
      toast(errorText(e), "red");
    } finally {
      setBusy(false);
    }
  };

  const pet = closet.parent.pet;
  // .b-nudge is display:contents (A's .dlg positions itself); C's corner pet hides while it's up (agent.css).
  return (
    <div ref={dockRef} className="b-nudge">
      <DialogBox
        key={nudge.id}
        speaker={{ name: pet.name, sprite: pet.sprite }}
        portrait={<Sprite name={pet.sprite} fallback="pet_a" anim="talk" scale={3} />}
        lines={[nudge.message]}
        choices={choices}
        onChoice={(value) => void choose(value)}
      />
    </div>
  );
}
