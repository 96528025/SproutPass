// C: AgentBubbles — the two pets talking, as pixel speech bubbles on A's EncounterScene stage.
// Renders `Encounter.transcript` live: new turns type out at ~40 chars/s with a blip per
// 2 characters. Buyer-side pet on the left, seller-side pet on the right; the "propose"
// bubble is gold, "no_fit"/"decline" peach. Reduced motion → no typewriter.
//
// Props:
//   transcript  AgentTurn[] (from useEncounter().encounter.transcript)
//   me          the viewing parent's id — their own pet's bubbles get the right-hand side
//   petNames    { [parentId]: petName } so "Pip: …" lines aren't double-labelled
//   onBlip      optional: () => play A's `blip` sfx
//   onDone      optional: fired once when the last bubble finished typing

import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentTurn } from "./cApi";
import "./agent.css";

const CHARS_PER_SEC = 40;

export interface AgentBubblesProps {
  transcript: AgentTurn[];
  me?: string;
  petNames?: Record<string, string>;
  onBlip?: () => void;
  onDone?: () => void;
  /** Join a live meeting at its current transcript, rather than replaying a long queue. */
  catchUp?: boolean;
}

function splitWho(turn: AgentTurn, petNames?: Record<string, string>): { who: string; text: string } {
  // Agents write "Pip: Looking for …" so the iMessage mirror reads well; the bubble shows the name as a label.
  const m = /^([A-Za-z][\w' -]{0,16}):\s+(.*)$/s.exec(turn.text);
  if (m) return { who: m[1], text: m[2] };
  return { who: petNames?.[turn.parentId] ?? (turn.from === "buyer_agent" ? "Buyer pet" : "Seller pet"), text: turn.text };
}

export function AgentBubbles({ transcript, me, petNames, onBlip, onDone, catchUp = false }: AgentBubblesProps) {
  const reduced = useMemo(() => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const [shown, setShown] = useState(() => catchUp ? Math.max(0, transcript.length - 1) : 0);
  const [partial, setPartial] = useState(""); // text of the bubble being typed
  const timer = useRef<number | null>(null);
  const doneRef = useRef(false);

  // Type out bubble `shown` whenever a new turn arrives.
  useEffect(() => {
    if (catchUp && transcript.length > shown + 1) {
      setShown(transcript.length - 1);
      setPartial("");
      return;
    }
    if (shown >= transcript.length) {
      if (transcript.length && !doneRef.current) {
        doneRef.current = true;
        onDone?.();
      }
      return;
    }
    doneRef.current = false;
    const full = splitWho(transcript[shown], petNames).text;
    if (reduced) {
      setShown((n) => n + 1);
      return;
    }
    let i = 0;
    setPartial("");
    timer.current = window.setInterval(() => {
      i += 1;
      setPartial(full.slice(0, i));
      if (i % 2 === 0) onBlip?.();
      if (i >= full.length) {
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
        setShown((n) => n + 1);
        setPartial("");
      }
    }, 1000 / CHARS_PER_SEC);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, transcript.length, reduced]);

  const visible = transcript.slice(0, Math.min(transcript.length, shown + 1));
  return (
    <div className="c-bubbles" role="log" aria-live="polite">
      {visible.map((turn, i) => {
        const { who, text } = splitWho(turn, petNames);
        const mine = me ? turn.parentId === me : turn.from === "seller_agent";
        const typing = i === shown && !reduced;
        return (
          <div key={`${turn.at}-${i}`} className={`c-bubble c-bubble--${mine ? "right" : "left"} c-bubble--${turn.kind}`}>
            <span className="c-bubble__who">{who}</span>
            {typing ? partial : text}
            {typing && <span className="c-cursor" aria-hidden />}
          </div>
        );
      })}
      {!transcript.length && (
        <div className="c-bubble c-bubble--left">
          <span className="c-bubble__who">Pets</span>
          Saying hi
          <span className="c-cursor" aria-hidden />
        </div>
      )}
    </div>
  );
}

export default AgentBubbles;
