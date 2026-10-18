// A4: /world. Lawn + radar + my avatar + other parents sliding between rings, real GPS feeding updatePresence,
// the ?demo=1 walk, and the mount points for A5's EncounterScene / Celebration.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PARENTS, useEncounter, useSimPosition } from "@/mocks/a4"; // C: swap for the real api when it lands
import { AgentBubbles } from "@/mocks/a5"; // C: swap for the real <AgentBubbles>
import { Celebration } from "@/world/Celebration";
import { EncounterScene } from "@/world/EncounterScene";
import { Chip } from "@/pixel/components/Chip";
import { PixelButton } from "@/pixel/components/PixelButton";
import { Sprite } from "@/pixel/components/Sprite";
import { Toast } from "@/pixel/components/Toast";
import { BottomBar } from "@/world/BottomBar";
import { FOLLOW_ZOOM, MapLayer, metersPerPixel } from "@/world/MapLayer";
import { MuteToggle } from "@/world/MuteToggle";
import { NearbySprites } from "@/world/NearbySprites";
import { Radar } from "@/world/Radar";
import { useDemo, useQueryParent, type ParentId } from "@/world/query";
import { useDemoWalk } from "@/world/useDemoWalk";
import { useGps } from "@/world/useGps";
import { BAND_LABEL, useNearby } from "@/world/useNearby";
import { useZone } from "@/world/useZone";
import "./world.css";

const HINT_KEY = "relay.worldHint";

function useFirstEntryHint(): [boolean, () => void] {
  const [show, setShow] = useState(() => {
    try {
      return !sessionStorage.getItem(HINT_KEY);
    } catch {
      return true; // storage blocked: show it every time
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(HINT_KEY, "1");
    } catch {
      /* ignore */
    }
  }, []);
  const hide = useCallback(() => setShow(false), []); // stable, or Toast's timer restarts on every render
  return [show, hide];
}

export function WorldScreen() {
  const meId = useQueryParent();
  const demo = useDemo();
  const me = PARENTS[meId];
  const toward: ParentId = meId === "jo" ? "mina" : "jo";

  const [discoverable, setDiscoverable] = useState(me.discoverable);
  const [hint, hideHint] = useFirstEntryHint();
  const [dismissedEncounter, setDismissedEncounter] = useState<string | null>(null);
  const [dismissedProposal, setDismissedProposal] = useState<string | null>(null);

  // Radar centre in stage coordinates, whole pixels so sprites never land on half-pixels.
  const stageRef = useRef<HTMLDivElement>(null);
  const [centre, setCentre] = useState({ cx: 195, cy: 370 });
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setCentre({ cx: Math.round(el.clientWidth / 2), cy: Math.round(el.clientHeight / 2) });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { encounter, proposal } = useEncounter(meId);
  const gps = useGps({ parentId: meId, simulated: demo, discoverable });

  // My position on the map: the real fix, or the demo's simulated one (which moves while WALK TOWARD runs).
  // Only this is a real lat/lng; other parents are placed by bearing + band and never get coordinates.
  const sim = useSimPosition();
  const here = useMemo(
    () => (demo ? sim : gps.lat !== null && gps.lng !== null ? { lat: gps.lat, lng: gps.lng } : null),
    [demo, sim, gps.lat, gps.lng],
  );
  const mpp = metersPerPixel(here?.lat ?? 34.07, FOLLOW_ZOOM);
  const { zone, inside } = useZone(here);
  const [zoomedOut, setZoomedOut] = useState(false);

  const { raw, items } = useNearby(meId, true, { mpp, halfW: centre.cx - 48, halfH: centre.cy - 56 });
  const walk = useDemoWalk(meId, toward, { enabled: demo, encountered: !!encounter });

  // Facing = last movement direction; the demo walk makes the avatar stride too.
  const [facing, setFacing] = useState<"left" | "right">("right");
  useEffect(() => setFacing(gps.facing), [gps.facing]);
  const moving = gps.moving || walk.active;

  const target = raw.find((p) => p.parentId === toward);
  const distLabel = target ? (target.distanceM !== undefined ? `${target.distanceM} M` : BAND_LABEL[target.band]) : "…";

  const peerId = encounter ? (encounter.parentAId === meId ? encounter.parentBId : encounter.parentAId) : null;
  const showEncounter = !!encounter && !!peerId && dismissedEncounter !== encounter.id;
  const showCelebration = proposal?.status === "paid" && dismissedProposal !== proposal.id;

  const gpsChip =
    gps.status === "denied" || gps.status === "unavailable" ? (
      <Chip tone="red">NO GPS</Chip>
    ) : demo ? (
      <Chip tone="lav">SIMULATED GPS</Chip>
    ) : gps.status === "weak" ? (
      <Chip tone="gold">WEAK GPS — STEP OUTSIDE</Chip>
    ) : gps.status === "ok" && gps.accuracyM !== null ? (
      <Chip tone="mint">GPS ±{Math.round(gps.accuracyM)}M</Chip>
    ) : (
      <Chip tone="paper">FINDING GPS…</Chip>
    );

  return (
    <div className="ws" style={{ "--cx": `${centre.cx}px`, "--cy": `${centre.cy}px` } as React.CSSProperties}>
      <div className="ws__stage" ref={stageRef} style={{ "--cx": `${centre.cx}px`, "--cy": `${centre.cy}px` } as React.CSSProperties}>
        <MapLayer me={here} zoomedOut={zoomedOut} zone={zone} avatar={me.avatar.sprite} noFix={!demo && (gps.status === "denied" || gps.status === "unavailable")} />
        {!zoomedOut && (
          <>
            <Radar mpp={mpp} />
            <NearbySprites items={items} />
            <div className={`ws__me ${discoverable ? "" : "ws__me--hidden"}`} data-me={me.id}>
              <Sprite name={me.avatar.sprite} anim={moving ? "walk" : "idle"} scale={4} facing={facing} />
              <span className="name">{me.name}</span>
            </div>
          </>
        )}
      </div>

      {/* row 1 is exactly 40px and its right 52px belong to A3's MuteToggle; the stale-GPS chip takes the GPS chip's slot */}
      <div className="ws__chips">
        {gps.paused ? <Chip tone="gold">SCREEN LOCKED? GPS PAUSED</Chip> : gpsChip}
        {inside !== null && (inside ? <Chip tone="mint">IN LOS ANGELES</Chip> : <Chip tone="gold">OUTSIDE LA</Chip>)}
      </div>
      <div className="ws__disc">
        <PixelButton small variant={discoverable ? "primary" : "ghost"} aria-pressed={discoverable} onClick={() => setDiscoverable((d) => !d)}>
          DISCOVERABLE
        </PixelButton>
        <PixelButton small variant="ghost" aria-pressed={zoomedOut} pressed={zoomedOut} onClick={() => setZoomedOut((z) => !z)}>
          ZONE
        </PixelButton>
      </div>

      {demo && (
        <div className="ws__walk">
          <PixelButton
            disabled={!!encounter}
            pressed={walk.active}
            onClick={() => (walk.active ? walk.stop() : walk.start())}
          >
            {encounter ? `MET ${PARENTS[toward].name.toUpperCase()}!` : walk.active ? `WALKING… ${distLabel}` : `WALK TOWARD ${PARENTS[toward].name.toUpperCase()}`}
          </PixelButton>
        </div>
      )}

      {hint && <Toast text="KEEP THIS SCREEN OPEN WHILE YOU WALK" duration={4000} onHide={hideHint} />}

      {showEncounter && encounter && peerId && (
        <EncounterScene
          encounter={encounter}
          me={me}
          peer={PARENTS[peerId]}
          bubbles={<AgentBubbles lines={encounter.transcript} />}
          onProposed={() => setDismissedEncounter(encounter.id)}
          onClosed={() => setDismissedEncounter(encounter.id)}
        />
      )}
      {showCelebration && proposal && (
        <Celebration
          proposal={proposal}
          me={me}
          peer={PARENTS[proposal.sellerId === meId ? proposal.buyerId : proposal.sellerId]}
          onDone={() => setDismissedProposal(proposal.id)}
        />
      )}

      <BottomBar />
      <MuteToggle />
    </div>
  );
}
