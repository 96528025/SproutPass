// A5: golden-flower celebration. Full-screen overlay B's Shell mounts on "trade:paid".
// 0.0 s cheer + "jingle" + flower bursts over both heads, petals fall, sparkles; 0.8 s the item icon arcs
// seller -> buyer in a 12-step parabola (coin blip on landing); the TRADED! panel is up by 2.6 s and waits for a tap.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Sprite } from "@/pixel/components/Sprite";
import { ItemIcon } from "@/pixel/components/ItemIcon";
import { PixelPanel } from "@/pixel/components/PixelPanel";
import { PixelButton } from "@/pixel/components/PixelButton";
import { Hearts } from "@/pixel/components/Hearts";
import { createBurst } from "@/pixel/particles";
import { sfx } from "@/pixel/sfx";
import { asItemIcon, asSprite, type ScenePerson } from "@/world/people";
import { markCelebrationOpen } from "@/world/celebrationOpen";
import "./celebration.css";

/** The fields Celebration reads; the contract's MatchProposal (e.g. the "trade:paid" event detail) fits. */
export interface CelebrationProposal {
  id: string;
  sellerId: string;
  buyerId: string;
  snapshot: { icon: string; priceCents: number; previousOwners: number; wearWeeksLeft?: number; itemName?: string };
}

export interface CelebrationProps {
  proposal: CelebrationProposal;
  /** closet.parent; peer = the other party (getParties' PublicParty). */
  me: ScenePerson;
  peer: ScenePerson;
  onDone: () => void;
}

const AVATAR_SCALE = 4; // 128 px frames
const AVATAR = 32 * AVATAR_SCALE;
const SIDE = 88; // avatar centre distance from the screen centre
const ARC_STEPS = 12;
const ARC_START = 800;
const ARC_STEP_MS = 100;
const ARC_PEAK = 96;
const ITEM = 72; // ItemIcon size 2: 64 art + 2×4 border

const reduced = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const ordinal = (n: number) => `${n}${n === 1 ? "ST" : n === 2 ? "ND" : n === 3 ? "RD" : "TH"}`;

export function Celebration({ proposal, me, peer, onDone }: CelebrationProps) {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [arc, setArc] = useState(0); // 0..ARC_STEPS
  const [panel, setPanel] = useState(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  // /world pauses its polling while this is up (see celebrationOpen.ts).
  useEffect(() => markCelebrationOpen(), []);

  // measure the overlay (it is fixed to the handheld screen, not the window)
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const w = size?.w ?? 0;
  const h = size?.h ?? 0;
  const ready = w > 0 && h > 0;
  // avatar frame top: 40% down, raised on short screens so the TRADED! panel (~254 px + 24) clears the name tags
  // and pets; never above 180, so the item's arc stays on screen
  const top = Math.round(Math.min(h * 0.4, Math.max(180, h - 492)) / 4) * 4;
  const meX = Math.round(w / 2 - SIDE);
  const peerX = Math.round(w / 2 + SIDE);

  // keep the canvas buffer 1:1 with CSS px (setting width clears it; the engine redraws on its next tick)
  useEffect(() => {
    const c = canvas.current;
    if (!c || !ready) return;
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
  }, [w, h, ready]);

  const sellerIsMe = proposal.sellerId === me.id;
  const fromX = sellerIsMe ? meX : peerX;
  const toX = sellerIsMe ? peerX : meX;

  // the whole sequence runs once per proposal, never because a parent re-rendered
  useEffect(() => {
    if (!ready || !canvas.current) return;
    const c = canvas.current;
    const quick = reduced();
    const timers: number[] = [];
    const stops: { stop(): void }[] = [];
    const at = (fn: () => void, ms: number) => void timers.push(window.setTimeout(fn, ms));
    const headY = top + 24;

    at(() => {
      sfx.play("jingle");
      stops.push(createBurst(c, { x: meX, y: headY, kind: "flowers", count: 24 }));
      stops.push(createBurst(c, { x: peerX, y: headY, kind: "flowers", count: 24 }));
      stops.push(createBurst(c, { x: w / 2, y: -8, kind: "petals", count: 40 }));
      stops.push(createBurst(c, { x: meX, y: headY, kind: "sparkle", count: 6 }));
      stops.push(createBurst(c, { x: peerX, y: headY, kind: "sparkle", count: 6 }));
    }, 0);
    if (!quick) {
      at(() => {
        stops.push(createBurst(c, { x: meX, y: top + 56, kind: "sparkle", count: 6 }));
        stops.push(createBurst(c, { x: peerX, y: top + 56, kind: "sparkle", count: 6 }));
      }, 900);
    }

    if (quick) {
      at(() => {
        setArc(ARC_STEPS);
        sfx.play("coin");
      }, 400);
      at(() => setPanel(true), 800);
    } else {
      for (let i = 1; i <= ARC_STEPS; i++) {
        at(() => {
          setArc(i);
          if (i === ARC_STEPS) sfx.play("coin");
        }, ARC_START + i * ARC_STEP_MS);
      }
      at(() => setPanel(true), ARC_START + ARC_STEPS * ARC_STEP_MS + 600); // 2.6 s
    }

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      stops.forEach((s) => s.stop());
    };
    // geometry is derived from w/h; the id is what identifies "this celebration"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal.id, ready]);

  // item arc: integer 4-px positions along a parabola
  const t = arc / ARC_STEPS;
  const ix = Math.round((fromX + (toX - fromX) * t) / 4) * 4;
  const iy = Math.round((top - 44 - ARC_PEAK * 4 * t * (1 - t)) / 4) * 4;
  const owners = Math.min(3, Math.max(1, proposal.snapshot.previousOwners + 1)) as 1 | 2 | 3;
  // the name as written (plurals and brand capitals stay right); the headline needs no is/are
  const thing = proposal.snapshot.itemName || "your item";

  return (
    <div className="cel" ref={root} role="dialog" aria-modal="true" aria-label="Trade complete">
      {ready && (
        <>
          <Avatar who={me} x={meX} top={top} />
          <Avatar who={peer} x={peerX} top={top} />
          <div
            hidden={arc === 0}
            className={`cel__item ${arc === ARC_STEPS ? "is-landed" : ""}`}
            style={{ left: ix - ITEM / 2, top: iy - ITEM / 2 } as CSSProperties}
          >
            <ItemIcon icon={asItemIcon(proposal.snapshot.icon)} size={2} />
          </div>
          <canvas ref={canvas} className="cel__canvas" aria-hidden />
        </>
      )}

      {panel && (
        <div className="cel__panel">
          <PixelPanel title="TRADED!" tone="paper">
            <p className="cel__headline">
              {sellerIsMe ? `Now in ${peer.name}'s bag: ${thing}.` : `Now in your bag: ${thing}.`}
            </p>
            <div className="cel__row">
              <div className="cel__price">{money(proposal.snapshot.priceCents)}</div>
              <div className="cel__owner">
                <Hearts filled={owners} />
                <span className="px-label-12">{ordinal(owners)} OWNER OF 3</span>
              </div>
            </div>
            <p className="cel__note">Demo payment · no real charge</p>
            <PixelButton block autoFocus onClick={() => onDoneRef.current()}>
              {sellerIsMe ? "BACK TO MY BAG" : "SEE IT IN MY BAG"}
            </PixelButton>
          </PixelPanel>
        </div>
      )}
    </div>
  );
}

function Avatar({ who, x, top }: { who: ScenePerson; x: number; top: number }) {
  return (
    <div className="cel__avatar" style={{ left: x - AVATAR / 2, top, width: AVATAR }}>
      <Sprite name={asSprite(who.avatar.sprite, "parent_a")} anim="cheer" scale={AVATAR_SCALE} />
      <div className="cel__pet">
        <Sprite name={asSprite(who.pet.sprite, "pet_a")} anim="hop" scale={3} />
      </div>
      <div className="cel__name px-label-12">{who.name}</div>
    </div>
  );
}
