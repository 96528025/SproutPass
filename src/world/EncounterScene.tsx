// A5: the meeting cutscene. Full-screen overlay (position: fixed) that A4 mounts over the world.
// Timeline (steps()-timed, see encounter.css): 0.0 s flash + "alert" + "!" pops, 0.4 s parents walk to the centre
// 96 px apart, 1.4 s pets hop out 48 px apart, then talk/idle under C's `bubbles` slot. status "proposed" slams the
// banner and hands over to B after 1.2 s; "no_match" shrugs and asks to close. A ghost × always dismisses.
// me / peer are the real parents (closet.parent, getParties' PublicParty): see world/people.ts.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Sprite } from "@/pixel/components/Sprite";
import { DialogBox } from "@/pixel/components/DialogBox";
import { sfx } from "@/pixel/sfx";
import { asSprite, type SceneEncounter, type ScenePerson } from "@/world/people";
import "./encounter.css";

export interface EncounterSceneProps {
  encounter: SceneEncounter;
  me: ScenePerson;
  peer: ScenePerson;
  /** Slot for C's <AgentBubbles>; rendered centred above the pets. */
  bubbles?: ReactNode;
  /**
   * True while a bubble is typing (pets "talk"). Defaults to encounter.status === "talking". While it is true the
   * "proposed" hand-off waits, so the pets finish their lines before the TRADE PROPOSAL! banner.
   */
  talking?: boolean;
  onProposed: (proposalId: string) => void;
  onClosed: () => void;
}

// geometry in CSS px, relative to the stage anchor (screen centre, 56 % down)
const PARENT_SCALE = 4;
const PET_SCALE = 4;
const PARENT_GAP = 96; // centre to centre
const PET_GAP = 48;
const PEER_START_X = 168; // peer enters from the right, like a dot leaving the radar
const PET_DROP = 76;

const reduced = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

type Phase = 0 | 1 | 2 | 3; // 0 alert · 1 walking · 2 pets hopping out · 3 talk / idle

export function EncounterScene({ encounter, me, peer, bubbles, talking, onProposed, onClosed }: EncounterSceneProps) {
  const [phase, setPhase] = useState<Phase>(0);
  const [banner, setBanner] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [flash, setFlash] = useState(false);
  const status = encounter.status;

  // latest props in refs so timers survive the Encounter row updating on every push
  const onProposedRef = useRef(onProposed);
  const onClosedRef = useRef(onClosed);
  onProposedRef.current = onProposed;
  onClosedRef.current = onClosed;
  const proposalIdRef = useRef(encounter.proposalId);
  proposalIdRef.current = encounter.proposalId;

  const timers = useRef<number[]>([]);
  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);
  const fired = useRef({ proposed: false });

  // opening sequence: once per encounter id, never on re-render
  useEffect(() => {
    setPhase(0);
    setBanner(false);
    setCelebrate(false);
    setFlash(false);
    fired.current = { proposed: false };
    const quick = reduced();
    later(() => sfx.play("alert"), 0);
    if (!quick) {
      later(() => setFlash(true), 0);
      later(() => setFlash(false), 300); // unmounted afterwards so it can never linger
    }
    if (quick) {
      later(() => setPhase(3), 0);
    } else {
      later(() => setPhase(1), 400);
      later(() => setPhase(2), 1400);
      later(() => setPhase(3), 2200); // hop-out takes 0.8 s
    }
    return () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
  }, [encounter.id, later]);

  const isTalking = talking ?? status === "talking";

  // status transitions (not renders): "proposed" waits for the pets to be out and done talking
  useEffect(() => {
    if (status !== "proposed" || phase < 3 || isTalking || fired.current.proposed) return;
    fired.current.proposed = true;
    setBanner(true);
    setCelebrate(true);
    sfx.play("accept");
    later(() => setCelebrate(false), 1000);
    later(() => onProposedRef.current(proposalIdRef.current ?? ""), 1200);
  }, [status, phase, isTalking, later]);

  // Esc dismisses too, so a stuck demo can always recover
  useEffect(() => {
    if (status === "no_match") return; // DialogBox owns the keyboard there
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClosedRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status]);

  const petAnim = phase === 2 || celebrate ? "hop" : isTalking && status !== "no_match" && !banner ? "talk" : "idle";
  const walking = phase === 1;
  const out = phase >= 1;
  const petsOut = phase >= 2;
  const noMatch = status === "no_match" && phase >= 3;

  const meX = -PARENT_GAP / 2;
  const peerX = PARENT_GAP / 2;
  const style = {
    "--me-from": "0px",
    "--me-to": `${meX}px`,
    "--me-steps": Math.round(Math.abs(meX) / 4),
    "--peer-from": `${PEER_START_X}px`,
    "--peer-to": `${peerX}px`,
    "--peer-steps": Math.round((PEER_START_X - peerX) / 4),
    "--me-pet-x": `${-PET_GAP / 2}px`,
    "--peer-pet-x": `${PET_GAP / 2}px`,
    "--pet-y": `${PET_DROP}px`,
    "--pet-steps": Math.round(PET_DROP / 4),
    "--parent-h": `${32 * PARENT_SCALE}px`,
    "--pet-h": `${16 * PET_SCALE}px`,
  } as CSSProperties;

  return (
    <div className="enc" style={style} role="dialog" aria-label={`${me.name} meets ${peer.name}`}>
      {flash && <div className="enc__flash" aria-hidden />}

      <div className="enc__stage">
        <div className="enc__path" aria-hidden />

        {/* parents */}
        <ParentSprite
          who={me}
          side="me"
          out={out}
          anim={walking ? "walk" : "idle"}
          facing={walking || !out ? "left" : "right"}
          alert={phase < 2}
        />
        <ParentSprite
          who={peer}
          side="peer"
          out={out}
          anim={walking ? "walk" : "idle"}
          facing="left"
          alert={phase < 2}
        />

        {/* pets */}
        <PetSprite who={me} side="me" out={petsOut} anim={petAnim} shrug={noMatch} />
        <PetSprite who={peer} side="peer" out={petsOut} anim={petAnim} shrug={noMatch} />

        {phase >= 3 && !noMatch && bubbles && <div className="enc__bubbles">{bubbles}</div>}
      </div>

      {banner && (
        <div className="enc__banner font-wordmark" aria-live="polite">
          TRADE PROPOSAL!
        </div>
      )}

      <button type="button" className="enc__close" aria-label="Close" onClick={() => onClosedRef.current()}>
        ×
      </button>

      {noMatch && (
        <DialogBox
          speaker={{ name: me.pet.name, sprite: asSprite(me.pet.sprite, "pet_a") }}
          lines={["Nothing fits today — maybe next walk!"]}
          choices={[{ label: "OK", value: "ok" }]}
          portrait={<Sprite name={asSprite(me.pet.sprite, "pet_a")} anim="idle" scale={3} />}
          onDone={() => onClosedRef.current()}
        />
      )}
    </div>
  );
}

function ParentSprite({
  who,
  side,
  out,
  anim,
  facing,
  alert,
}: {
  who: ScenePerson;
  side: "me" | "peer";
  out: boolean;
  anim: "walk" | "idle";
  facing: "left" | "right";
  alert: boolean;
}) {
  return (
    <div className={`enc__parent enc__parent--${side} ${out ? "is-out" : ""}`}>
      {alert && (
        <div className="enc__alert" aria-hidden>
          <Sprite name="alert_bubble" scale={1} />
        </div>
      )}
      <Sprite name={asSprite(who.avatar.sprite, side === "me" ? "parent_a" : "parent_b")} anim={anim} scale={PARENT_SCALE} facing={facing} />
      <div className="enc__name px-label-12">{who.name}</div>
    </div>
  );
}

function PetSprite({
  who,
  side,
  out,
  anim,
  shrug,
}: {
  who: ScenePerson;
  side: "me" | "peer";
  out: boolean;
  anim: "hop" | "talk" | "idle";
  shrug: boolean;
}) {
  return (
    <div className={`enc__pet enc__pet--${side} ${out ? "is-out" : ""}`}>
      <div className={shrug ? "enc__shrug" : undefined}>
        <Sprite name={asSprite(who.pet.sprite, side === "me" ? "pet_a" : "pet_b")} anim={anim} scale={PET_SCALE} facing={side === "me" ? "right" : "left"} />
      </div>
      <div className="enc__name enc__name--pet px-label-12">{who.pet.name}</div>
    </div>
  );
}
