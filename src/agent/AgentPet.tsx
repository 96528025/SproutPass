// C: AgentPet — the pet sprite in the corner of World and Bag.
// It bobs; a pink dot appears when there's an open nudge or proposal; tapping opens
// A's DialogBox with the pet's latest line (mirrors the iMessage thread via PetLine,
// with a template fallback when that entity isn't there yet).
//
// Props:
//   parentId   the viewing parent
//   pet        { name, sprite } from Parent.pet
//   onChoice   optional: ("sell"|"keep"|"later") when the open nudge gets an answer here —
//              B's NudgeDialog owns the real flow; we just forward the choice.
//   onOpenTrade optional: tapped "SEE TRADE" when a proposal is open

import { useCallback, useEffect, useRef, useState } from "react";
import { DialogBox, Sprite } from "../app/ui"; // B's shim today; re-exports A's kit once it lands
import { type AgentNudge, countOpenProposals, listOpenNudges, listPetLines, subscribe } from "./cApi";
import "./agent.css";

export interface AgentPetProps {
  parentId: string;
  pet: { name: string; sprite: "pet_a" | "pet_b" | "pet_c" };
  onChoice?: (choice: "sell" | "keep" | "later", nudge: AgentNudge) => void;
  onOpenTrade?: () => void;
}

// Realtime does the work; the poll is only a backstop (Base44's rate limit is shared by every tab and function).
const POLL_MS = 30_000;
const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

function templateFor(pet: string, nudge: AgentNudge | null, proposals: number): string {
  if (proposals > 0) return "Our pets found a match! Open the trade to decide — nothing is charged until you both accept.";
  if (nudge?.kind === "new_owner_welcome") return nudge.message || "Say hi to your new item! I'll check in when it gets snug.";
  if (nudge?.kind === "outgrow_check") return nudge.message || "Something's probably getting snug — still fit? Want to pass it on?";
  if (nudge?.kind === "listing_reminder") return nudge.message || "That listing's been up a while — keep it shared?";
  return `Hi! I'm ${pet}. I'll ping you when something stops fitting, or when I meet another pet on a walk.`;
}

export function AgentPet({ parentId, pet, onChoice, onOpenTrade }: AgentPetProps) {
  const [open, setOpen] = useState(false);
  const [nudge, setNudge] = useState<AgentNudge | null>(null);
  const [proposals, setProposals] = useState(0);
  const [line, setLine] = useState<string | null>(null);

  // At most one refresh in flight plus one queued: a burst of realtime events costs two reads, not twenty.
  const busy = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const refresh = useCallback(async (): Promise<void> => {
    if (busy.current) { again.current = true; return busy.current; }
    busy.current = (async () => {
      try {
        const [nudges, n, lines] = await Promise.all([listOpenNudges(parentId), countOpenProposals(parentId), listPetLines(parentId, 1)]);
        setNudge(nudges[0] ?? null);
        setProposals(n);
        setLine(lines[0]?.text ?? null);
      } catch {
        /* offline / rate limited: the next event or poll retries */
      }
    })();
    await busy.current;
    busy.current = null;
    if (again.current) { again.current = false; await refresh(); }
  }, [parentId]);

  // The shell's PET tab asks "pet:open"; preventDefault tells it we handled it.
  useEffect(() => {
    const onOpen = (e: Event) => { e.preventDefault(); setOpen(true); };
    window.addEventListener("pet:open", onOpen);
    return () => window.removeEventListener("pet:open", onOpen);
  }, []);

  useEffect(() => {
    void refresh();
    // Only this family's rows matter (the subscription sees every family's changes).
    const mine = (d: any) => !d || d.parentId === parentId || d.buyerId === parentId || d.sellerId === parentId;
    const u1 = subscribe<any>("AgentNudge", (e) => { if (mine(e?.data)) void refresh(); });
    const u2 = subscribe<any>("MatchProposal", (e) => { if (mine(e?.data)) void refresh(); });
    const u3 = subscribe<any>("PetLine", (e) => { if (mine(e?.data)) void refresh(); });
    const t = setInterval(() => { if (visible()) void refresh(); }, POLL_MS);
    const onVisible = () => { if (visible()) void refresh(); };   // phone screen back on: catch up at once
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      u1();
      u2();
      u3();
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, parentId]);

  const attention = Boolean(nudge) || proposals > 0;
  const text = line ?? templateFor(pet.name, nudge, proposals);

  const choices =
    proposals > 0
      ? [{ label: "SEE TRADE", value: "trade" }, { label: "LATER", value: "close" }]
      : nudge?.kind === "outgrow_check"
        ? [{ label: "SELL", value: "sell" }, { label: "KEEP", value: "keep" }, { label: "LATER", value: "later" }]
        : [{ label: "OK", value: "close" }];

  const onPick = (value: string) => {
    setOpen(false);
    if (value === "trade") onOpenTrade?.();
    else if ((value === "sell" || value === "keep" || value === "later") && nudge) onChoice?.(value, nudge);
  };

  return (
    <>
      <button className="c-pet" aria-label={`${pet.name}, your closet pet`} onClick={() => setOpen(true)}>
        <Sprite name={pet.sprite} anim={attention ? "cheer" : "idle"} scale={4} />
        {attention && <span className="c-pet__dot" aria-hidden />}
        {attention && !open && <span className="c-pet__hint">{proposals > 0 ? "TRADE!" : "PSST"}</span>}
      </button>
      {open && (
        <div className="b-dock c-pet__dock" role="dialog" aria-label={`${pet.name} says`}>
          <DialogBox
            speaker={{ name: pet.name, sprite: pet.sprite }}
            lines={[text, "(I said the same thing in iMessage.)"]}
            choices={choices}
            onDone={() => setOpen(false)}
            onChoose={onPick}
          />
        </div>
      )}
    </>
  );
}

export default AgentPet;
