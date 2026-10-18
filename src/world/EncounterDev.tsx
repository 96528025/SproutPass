// /dev/encounter: rehearse the whole meeting -> talk -> proposal -> paid loop without GPS, B or C.
// ?as=jo flips the point of view (Jo is the buyer, so the item arcs the other way).
import { useCallback, useEffect, useRef, useState } from "react";
import { EncounterScene } from "@/world/EncounterScene";
import { Celebration } from "@/world/Celebration";
import { PixelButton } from "@/pixel/components/PixelButton";
import { Chip } from "@/pixel/components/Chip";
import { useQueryParent } from "@/world/query";
import { AgentBubbles, JO, MINA, PROPOSAL, SAM, TRANSCRIPT, TradeWindow, type Encounter } from "@/mocks/a5";

const PARENTS = { mina: MINA, jo: JO, sam: SAM };
const TALK_MS = 1500;
const TYPING_MS = 1000;

export function EncounterDev() {
  const asId = useQueryParent();
  const me = PARENTS[asId];
  const peer = asId === "jo" ? MINA : JO;

  const [encounter, setEncounter] = useState<Encounter | null>(null);
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
          bubbles={lines.length > 0 ? <AgentBubbles lines={lines} /> : null}
          onProposed={(id) => {
            setEncounter(null);
            setTrade(id);
          }}
          onClosed={reset}
        />
      )}
      {trade && <TradeWindow proposalId={trade} onClose={reset} />}
      {paid && <Celebration proposal={PROPOSAL} me={me} peer={peer} onDone={reset} />}

      <style>{`
        .encdev__bar { position: fixed; z-index: 25; top: 8px; left: 60px; right: 8px; display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; }
        .encdev__bar .pb { min-height: 32px; min-width: 0; padding: 4px 8px; font-size: 12px; line-height: 16px; box-shadow: 2px 2px 0 var(--ink); }
      `}</style>
    </div>
  );
}
