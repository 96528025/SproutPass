// /dev/encounter: rehearse the whole meeting -> talk -> proposal -> paid loop without GPS or the backend.
// ?as=jo flips the point of view (Jo is the buyer, so the item arcs the other way). Local fixtures only (no
// Base44 ids, nothing written anywhere); the bubbles are C's real <AgentBubbles>.
import { useCallback, useEffect, useRef, useState } from "react";
import { AgentBubbles } from "@/agent/AgentBubbles";
import type { AgentTurn } from "@/app/types";
import { EncounterScene } from "@/world/EncounterScene";
import { Celebration, type CelebrationProposal } from "@/world/Celebration";
import { Modal } from "@/pixel/components/Modal";
import { PixelButton } from "@/pixel/components/PixelButton";
import { Chip } from "@/pixel/components/Chip";
import { sfx } from "@/pixel/sfx";
import { useQueryParent } from "@/world/query";
import type { SceneEncounter, ScenePerson } from "@/world/people";

// ---- fixtures (the seed's three families; ids are the seed keys, this page never talks to the backend) ----------
const MINA: ScenePerson = { id: "mina", name: "Mina", avatar: { sprite: "parent_a" }, pet: { sprite: "pet_a", name: "Button" } };
const JO: ScenePerson = { id: "jo", name: "Jo", avatar: { sprite: "parent_b" }, pet: { sprite: "pet_b", name: "Pip" } };
const SAM: ScenePerson = { id: "sam", name: "Sam", avatar: { sprite: "parent_c" }, pet: { sprite: "pet_c", name: "Moss" } };
const PARENTS = { mina: MINA, jo: JO, sam: SAM };

const PROPOSAL: CelebrationProposal = {
  id: "prop_dev",
  sellerId: "mina",
  buyerId: "jo",
  snapshot: { icon: "item_romper", priceCents: 1800, previousOwners: 1, itemName: "Yellow duck romper" },
};

const turn = (from: AgentTurn["from"], kind: AgentTurn["kind"], text: string): AgentTurn => ({
  from,
  parentId: from === "buyer_agent" ? "jo" : "mina",
  kind,
  text,
  at: "2026-10-18T17:00:00.000Z",
});
const TRANSCRIPT: AgentTurn[] = [
  turn("buyer_agent", "looking_for", "Looking for 6-9M tops or onesies!"),
  turn("seller_agent", "have", "I have a yellow duck romper in 6-9M."),
  turn("buyer_agent", "fit_check", "Gently used, 1 owner — nice."),
  turn("seller_agent", "fit_check", "Your little one fits it for about 4 more weeks."),
  turn("buyer_agent", "propose", "$18.00 — 60% of $30. Shall we?"),
  turn("seller_agent", "ack", "Trade proposal!"),
];

const TALK_MS = 1500;
const TYPING_MS = 1000;

/** Stand-in for B's TradeWindow (the real one needs a real proposal in the closet). */
function TradeWindowStub({ proposalId, onClose }: { proposalId: string; onClose: () => void }) {
  return (
    <Modal title="TRADE" onClose={onClose}>
      <p className="px-label-16" style={{ margin: "0 0 12px" }}>TradeWindow (B) opens here</p>
      <p className="px-label-12" style={{ margin: "0 0 16px" }}>{proposalId}</p>
      <PixelButton block onClick={onClose}>CLOSE</PixelButton>
    </Modal>
  );
}

export function EncounterDev() {
  const asId = useQueryParent();
  const me = PARENTS[asId];
  const peer = asId === "jo" ? MINA : JO;

  const [encounter, setEncounter] = useState<SceneEncounter | null>(null);
  const [lines, setLines] = useState<typeof TRANSCRIPT>([]);
  const [typing, setTyping] = useState(false);
  const [paid, setPaid] = useState(false);
  const [trade, setTrade] = useState<string | null>(null);
  const run = useRef(0);
  const timers = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearInterval(t));
    timers.current = [];
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const reset = () => {
    clearTimers();
    setEncounter(null);
    setLines([]);
    setTyping(false);
    setPaid(false);
    setTrade(null);
  };

  const start = () => {
    reset();
    run.current += 1;
    setEncounter({ id: `enc_${run.current}`, status: "meeting" });
  };

  const talk = () => {
    if (!encounter) return;
    clearTimers();
    setLines([]);
    setEncounter({ ...encounter, status: "talking" });
    let i = 0;
    const push = () => {
      const line = TRANSCRIPT[i++];
      if (!line) {
        clearTimers();
        setTyping(false);
        return;
      }
      setLines((l) => [...l, line]);
      setTyping(true);
      timers.current.push(window.setTimeout(() => setTyping(false), TYPING_MS));
    };
    push();
    timers.current.push(window.setInterval(push, TALK_MS));
  };

  const proposed = () => {
    if (!encounter) return;
    clearTimers();
    setTyping(false);
    setEncounter({ ...encounter, status: "proposed", proposalId: PROPOSAL.id });
  };

  const noMatch = () => {
    if (!encounter) return;
    clearTimers();
    setTyping(false);
    setEncounter({ ...encounter, status: "no_match" });
  };

  const pay = () => {
    clearTimers();
    setEncounter(null);
    setTrade(null);
    setPaid(true);
  };

  return (
    <div style={{ padding: "16px 16px calc(var(--bottom-bar) + 16px)", minHeight: "var(--screen-h, 100dvh)" }}>
      <h1 className="font-wordmark" style={{ fontSize: 16, lineHeight: "24px", margin: "0 0 8px" }}>/DEV/ENCOUNTER</h1>
      <p className="px-label-12" style={{ margin: "0 0 12px" }}>
        START ENCOUNTER, then AGENTS TALK, then PROPOSED or NO MATCH. PAID plays the celebration on its own.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Chip tone="sky">AS {me.name.toUpperCase()}</Chip>
        <Chip tone="lav">{encounter ? `ENC ${encounter.status.toUpperCase()}` : paid ? "PAID" : "IDLE"}</Chip>
      </div>

      {/* control strip stays above the overlays so a stuck run can always be driven */}
      <div className="encdev__bar">
        <PixelButton small onClick={start}>START ENCOUNTER</PixelButton>
        <PixelButton small variant="ghost" onClick={talk} disabled={!encounter}>AGENTS TALK</PixelButton>
        <PixelButton small variant="ghost" onClick={proposed} disabled={!encounter}>PROPOSED</PixelButton>
        <PixelButton small variant="ghost" onClick={noMatch} disabled={!encounter}>NO MATCH</PixelButton>
        <PixelButton small variant="ghost" onClick={pay}>PAID</PixelButton>
        <PixelButton small variant="ghost" onClick={reset}>RESET</PixelButton>
      </div>

      {encounter && (
        <EncounterScene
          encounter={encounter}
          me={me}
          peer={peer}
          talking={typing}
          bubbles={
            lines.length > 0 ? (
              // the peer stands on the right, where AgentBubbles puts `me`'s bubbles (same as WorldScreen)
              <AgentBubbles
                transcript={lines}
                me={peer.id}
                petNames={{ [me.id]: me.pet.name, [peer.id]: peer.pet.name }}
                onBlip={() => sfx.play("blip")}
              />
            ) : null
          }
          onProposed={(id) => {
            setEncounter(null);
            setTrade(id);
          }}
          onClosed={reset}
        />
      )}
      {trade && <TradeWindowStub proposalId={trade} onClose={reset} />}
      {paid && <Celebration proposal={PROPOSAL} me={me} peer={peer} onDone={reset} />}

      <style>{`
        .encdev__bar { position: fixed; z-index: 25; top: 8px; left: 60px; right: 8px; display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; }
        .encdev__bar .pb { min-height: 32px; min-width: 0; padding: 4px 8px; font-size: 12px; line-height: 16px; box-shadow: 2px 2px 0 var(--ink); }
      `}</style>
    </div>
  );
}
