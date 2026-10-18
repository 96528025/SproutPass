// OWNER: B4. The pet speaks up when the closet has an unresolved nudge (oldest first, one at a time).
// The parent always chooses (rule 3): SELL opens the listing flow, KEEP / LATER just resolve.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../app/api";
import { DialogBox } from "../app/ui";
import { errorText, parentRef, useApp } from "../app/store";
import type { AgentNudge, ResolveNudgeReq } from "../app/types";

type Action = ResolveNudgeReq["action"];

const CHOICES: Record<AgentNudge["kind"], { label: string; value: Action }[]> = {
  outgrow_check: [{ label: "SELL", value: "sell" }, { label: "KEEP", value: "keep" }, { label: "LATER", value: "snooze" }],
  listing_reminder: [{ label: "KEEP LISTED", value: "keep" }, { label: "LATER", value: "snooze" }],
  new_owner_welcome: [{ label: "OK", value: "keep" }],
};

/** While the dialog is docked, pad the screen by its height (--dock-h) so nothing underneath is unreachable. */
function useDockPadding() {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = document.documentElement.style;
    if (!el) { root.removeProperty("--dock-h"); return; }
    const measure = () => root.setProperty("--dock-h", `${el.offsetHeight + 12}px`);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => { ro.disconnect(); root.removeProperty("--dock-h"); };
  }, [el]);
  return setEl;
}

export function NudgeDialog() {
  const closet = useApp((s) => s.closet);
  const toast = useApp((s) => s.toast);
  const refreshCloset = useApp((s) => s.refreshCloset);
  const nav = useNavigate();
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const dockRef = useDockPadding();

  if (!closet) return null;
  const nudge = closet.nudges
    .filter((n) => !n.resolved && !answered.has(n.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (!nudge) return null;

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

  return (
    <div ref={dockRef} className="b-dock" role="dialog" aria-label={`${closet.parent.pet.name} says`}>
      <DialogBox
        key={nudge.id}
        speaker={{ name: closet.parent.pet.name, sprite: closet.parent.pet.sprite }}
        lines={[nudge.message]}
        choices={choices}
        onChoose={choose}
      />
    </div>
  );
}
