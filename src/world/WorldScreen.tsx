// A4: /world. A's pixelated real map (Leaflet, follows me at zoom 17; ZONE shows the Los Angeles zone) + radar
// rings at real metres + my avatar + other parents sliding between rings, real GPS feeding C's updatePresence,
// the ?demo=1 walk (C's demoWalk), and A5's EncounterScene with C's <AgentBubbles> when C's useEncounter fires.
// Only my own position is a lat/lng on the map; other parents are placed by bearing + band and never get coordinates.
// Wired to the real backend (W2): "me" is B's closet.parent (real Base44 id; ?as= is the seed key in B's store),
// the peer card comes from getParties (Agent 2's usePublicParent), the proposal from closet.proposals.
// Not mounted here (B's Shell owns them, once for every screen): BottomBar, MuteToggle, the Trade window
// (TradeWatcher pops it for a new open proposal) and the Celebration (shown globally on "trade:paid").
// Rate budget (Base44's Free plan is shared by the whole team): radar every 6 s, presence keepalive every 10 s,
// a demo walk of ~6 calls; and while I have a trade open (or its Celebration is up) every loop here pauses: no radar,
// no presence, no hold ticks, no encounter poll (realtime still listens).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AgentBubbles } from "@/agent/AgentBubbles";
import { useEncounter } from "@/agent/useEncounter";
import type { Encounter } from "@/agent/cApi";
import { useApp } from "@/app/store";
import type { NearbyParent } from "@/app/types";
import { usePublicParent } from "@/trade/tradeKit";
import { EncounterScene } from "@/world/EncounterScene";
import { Chip } from "@/pixel/components/Chip";
import { PixelButton } from "@/pixel/components/PixelButton";
import { Sprite } from "@/pixel/components/Sprite";
import { Toast } from "@/pixel/components/Toast";
import { sfx } from "@/pixel/sfx";
import { HudButton } from "@/world/HudButton";
import { FOLLOW_ZOOM, MapLayer, metersPerPixel } from "@/world/MapLayer";
import { NearbySprites } from "@/world/NearbySprites";
import { Radar } from "@/world/Radar";
import { asSprite, demoFix, demoTargetKey, seedName, seedParent, type ScenePerson } from "@/world/people";
import { band as bandOf, destination } from "../../base44/shared/c/geo.ts";
import { useCelebrationOpen } from "@/world/celebrationOpen";
import { useDemo, useQueryParent } from "@/world/query";
import { useDemoWalk } from "@/world/useDemoWalk";
import { useGps } from "@/world/useGps";
import { BAND_LABEL, useNearby, type NearbyPin } from "@/world/useNearby";
import { useZone } from "@/world/useZone";
import "./world.css";

const HINT_KEY = "relay.worldHint";
const GLIDE_MS = 2500; // = useDemoWalk's step interval: the map pans through a 20 m step instead of hopping

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

/** `value` eased toward each new target over `ms` (linear, ~8 updates a second); null passes straight through. */
function useGlide(value: number | null, ms: number): number | null {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (value === null || start === null || start === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const t0 = Date.now();
    const id = window.setInterval(() => {
      const k = Math.min(1, (Date.now() - t0) / ms);
      from.current = start + (value - start) * k;
      setShown(from.current);
      if (k >= 1) window.clearInterval(id);
    }, 120);
    return () => window.clearInterval(id);
  }, [value, ms]);
  return shown;
}

/** "trade:paid" (B's PayButton / TradeWindow) → true for a few seconds, until the Celebration is up. */
function useJustPaid(ms = 10_000): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let t: number | undefined;
    const onPaid = () => {
      setOn(true);
      window.clearTimeout(t);
      t = window.setTimeout(() => setOn(false), ms);
    };
    window.addEventListener("trade:paid", onPaid);
    return () => {
      window.removeEventListener("trade:paid", onPaid);
      window.clearTimeout(t);
    };
  }, [ms]);
  return on;
}

/** The peer's public card (getParties), else what the radar knows about them, else a neutral stand-in. */
function usePeer(peerId: string | null, nearby: NearbyParent[]): ScenePerson | null {
  const party = usePublicParent(peerId ?? undefined);
  if (!peerId) return null;
  if (party) return party;
  const seen = nearby.find((p) => p.parentId === peerId);
  return {
    id: peerId,
    name: seen?.name ?? "…",
    avatar: { sprite: seen?.sprite ?? "parent_b" },
    pet: { sprite: seen?.pet ?? "pet_b", name: "…" },
  };
}

export function WorldScreen() {
  const meKey = useQueryParent();
  const demo = useDemo();
  const closetParent = useApp((s) => s.closet?.parent ?? null);
  const proposals = useApp((s) => s.closet?.proposals);
  // the closet answers with the real id; until then draw the seed card for ?as= so the screen isn't empty
  const me = closetParent?.key === meKey ? closetParent : null;
  const meId = me?.id ?? null;
  const meCard = me ?? seedParent(meKey);
  const targetKey = demoTargetKey(meKey);

  const [discoverableSet, setDiscoverable] = useState<boolean | null>(null);
  const discoverable = discoverableSet ?? me?.discoverable ?? true;
  const [hint, hideHint] = useFirstEntryHint();
  const [zoomedOut, setZoomedOut] = useState(false);

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

  // A trade of mine is open (the Trade window is up, or one tap away) or was just paid: /world goes quiet.
  const liveTrade =
    !!meId && !!proposals?.some((p) => (p.status === "open" || p.status === "both_accepted") && (p.buyerId === meId || p.sellerId === meId));
  const justPaid = useJustPaid(); // the gap before the Celebration mounts (or if it can't show)
  const celebrating = useCelebrationOpen(); // A's Celebration waits for a tap: quiet for as long as it is up
  const paused = liveTrade || justPaid || celebrating;

  const { encounter, peerId, dismiss } = useEncounter(meId, { paused });
  // The scene's proposal: the MatchProposal created for this encounter (closet.proposals refreshes live).
  const encProposal = encounter ? proposals?.find((p) => p.encounterId === encounter.id) : undefined;
  const proposalId = encProposal?.id;
  // A meeting whose trade is already settled (paid / declined / expired, e.g. seen from a new tab) isn't replayed.
  const settled = !!encProposal && encProposal.status !== "open" && encProposal.status !== "both_accepted";
  useEffect(() => {
    if (settled) dismiss();
  }, [settled, dismiss]);
  const nearbyRef = useRef<NearbyParent[]>([]);
  const walk = useDemoWalk(meId, targetKey, {
    enabled: demo,
    encounter: encounter && !settled ? encounter.status : null,
    paused,
    nearby: nearbyRef,
  });
  // While walking, the radar draws the target from demoWalk's own distance (C starts the walk due north of the
  // target, so it lies at 180°) instead of polling listNearby on top of the walk.
  const pin = useMemo<NearbyPin | null>(() => {
    if (!walk.active || !walk.targetId || walk.distanceM === null) return null;
    const b = bandOf(walk.distanceM);
    if (!b) return null;
    const seed = seedParent(targetKey);
    return {
      parentId: walk.targetId,
      band: b,
      bearingDeg: 180,
      distanceM: Math.round(walk.distanceM / 5) * 5,
      ...(seed ? { name: seed.name, sprite: seed.avatar.sprite, pet: seed.pet.sprite } : {}),
    };
  }, [walk.active, walk.targetId, walk.distanceM, targetKey]);
  const simFix = useMemo(() => demoFix(meKey), [meKey]);
  const gps = useGps({ parentId: meId, simulated: demo, simFix, discoverable, heartbeat: !walk.owns && !paused });

  // My position on the map: the real fix, or in ?demo=1 the simulated one. C's demoWalk starts the walker due north
  // of the target's demo spot and steps straight toward it, so "distanceM north of the target" is where C has me
  // (and where C keeps me after the walk); before any walk it is my family's demo spot.
  const glideM = useGlide(demo ? walk.distanceM : null, GLIDE_MS);
  const here = useMemo(() => {
    if (demo) return glideM !== null ? destination(demoFix(targetKey), 0, glideM) : simFix;
    return gps.lat !== null && gps.lng !== null ? { lat: gps.lat, lng: gps.lng } : null;
  }, [demo, glideM, targetKey, simFix, gps.lat, gps.lng]);
  const mpp = metersPerPixel(here?.lat ?? 34.07, FOLLOW_ZOOM);
  const { zone, inside } = useZone(here);

  const layout = useMemo(() => ({ mpp, halfW: centre.cx - 48, halfH: centre.cy - 56 }), [mpp, centre.cx, centre.cy]);
  const { raw, items } = useNearby(meId, { poll: !paused && !walk.active, pin, layout });
  nearbyRef.current = raw;
  const peer = usePeer(peerId, raw);

  // Facing = last movement direction; the demo walk makes the avatar stride too.
  const [facing, setFacing] = useState<"left" | "right">("right");
  useEffect(() => setFacing(gps.facing), [gps.facing]);
  const moving = gps.moving || walk.active;

  const target = walk.targetId ? raw.find((p) => p.parentId === walk.targetId) : undefined;
  const distM = walk.distanceM ?? target?.distanceM;
  const distLabel = distM !== undefined && distM !== null ? `${distM} M` : target ? BAND_LABEL[target.band] : "…";
  const targetName = seedName(targetKey).toUpperCase();

  // Quiet HUD: a chip only when something needs saying. A good real fix shows nothing; SIMULATED GPS is required
  // by rule 5 whenever positions are simulated. Every chip fits the row's 216px on a 360px phone.
  const noFix = !demo && (gps.status === "denied" || gps.status === "unavailable");
  const gpsChip =
    gps.status === "denied" || gps.status === "unavailable" ? (
      <Chip tone="red">NO GPS</Chip>
    ) : demo ? (
      <Chip tone="lav">SIMULATED GPS</Chip>
    ) : gps.status === "weak" ? (
      <Chip tone="gold">WEAK GPS</Chip>
    ) : gps.status === "ok" ? null : (
      <Chip tone="paper">FINDING GPS…</Chip>
    );

  return (
    <div className="ws" style={{ "--cx": `${centre.cx}px`, "--cy": `${centre.cy}px` } as React.CSSProperties}>
      <div className="ws__stage" ref={stageRef} style={{ "--cx": `${centre.cx}px`, "--cy": `${centre.cy}px` } as React.CSSProperties}>
        <MapLayer
          me={here}
          zoomedOut={zoomedOut}
          zone={zone}
          avatar={asSprite(meCard?.avatar.sprite, "parent_a")}
          noFix={noFix}
        />
        {!zoomedOut && (
          <>
            <Radar mpp={mpp} />
            <NearbySprites items={items} />
            {meCard && (
              <div className={`ws__me ${discoverable ? "" : "ws__me--hidden"}`} data-me={meId ?? meKey}>
                <Sprite name={asSprite(meCard.avatar.sprite, "parent_a")} anim={moving ? "walk" : "idle"} scale={5} facing={facing} />
              </div>
            )}
          </>
        )}
      </div>

      {/* row 1 is exactly 40px; its right 132px belong to the HUD buttons and B's MuteToggle (which sits up in the demo
          panel with ?demo=1, so the HUD moves over by one slot). The zone chip lives in zone view only; the stale-GPS
          chip takes the GPS chip's slot. */}
      <div className="ws__chips">
        {liveTrade ? <Chip tone="lav">RADAR PAUSED</Chip> : gps.paused ? <Chip tone="gold">GPS PAUSED</Chip> : gpsChip}
        {!meId && !gps.paused && !gpsChip && <Chip tone="paper">LOADING…</Chip>}
        {zoomedOut && inside !== null && (inside ? <Chip tone="mint">IN LA</Chip> : <Chip tone="gold">OUTSIDE LA</Chip>)}
      </div>
      <HudButton
        slot={demo ? 0 : 1}
        glyph={discoverable ? "eyeOn" : "eyeOff"}
        on={discoverable}
        label="Show me on the radar"
        onClick={() => setDiscoverable(!discoverable)}
      />
      <HudButton
        slot={demo ? 1 : 2}
        glyph={zoomedOut ? "zoneOut" : "zone"}
        on={zoomedOut}
        label="Los Angeles zone view"
        onClick={() => setZoomedOut((z) => !z)}
      />

      {demo && (
        <div className="ws__walk">
          {!encounter && !walk.active && walk.phase === "idle" && (
            <p className="ws__walk-hint">Your pets meet when you're within 25 m.</p>
          )}
          {/* A walk that ended reads WALK AGAIN (a new walk starts over 120 m out); never while my trade is open. */}
          <PixelButton
            disabled={(!!encounter && !settled) || !meId || (paused && !walk.active)}
            pressed={walk.active}
            onClick={() => (walk.active ? walk.stop() : walk.start())}
          >
            {encounter && !settled
              ? `MET ${(peer?.name && peer.name !== "…" ? peer.name : seedName(targetKey)).toUpperCase()}!`
              : walk.active
                ? `WALKING… ${distLabel}`
                : walk.phase === "idle"
                  ? `WALK TOWARD ${targetName}`
                  : "WALK AGAIN"}
          </PixelButton>
        </div>
      )}

      {/* no location outside demo mode: say so, and offer the same switch the title screen makes */}
      {noFix && (
        <div className="ws__walk">
          <p className="ws__walk-hint">Can't find your location. Turn it on, or take the demo walk.</p>
          <PixelButton onClick={() => useApp.getState().setDemo(true)}>TAKE THE DEMO WALK</PixelButton>
        </div>
      )}

      {hint && !demo && <Toast text="Keep this screen open while you walk." duration={4000} onHide={hideHint} />}

      {encounter && !settled && me && peer && (
        <EncounterLayer key={encounter.id} encounter={encounter} proposalId={proposalId} me={me} peer={peer} onDone={dismiss} />
      )}
    </div>
  );
}

/**
 * A5's EncounterScene fed by C's Encounter row, with C's <AgentBubbles> in its bubbles slot. The pets "talk"
 * while a bubble is still typing, and the scene waits for the last bubble before its TRADE PROPOSAL! hand-off
 * (C's local fallback writes the whole transcript together with status "proposed").
 */
function EncounterLayer({
  encounter,
  proposalId,
  me,
  peer,
  onDone,
}: {
  encounter: Encounter;
  proposalId: string | undefined;
  me: ScenePerson;
  peer: ScenePerson;
  onDone: () => void;
}) {
  const turns = useMemo(() => encounter.transcript ?? [], [encounter.transcript]);
  const [typed, setTyped] = useState(0);
  const typing = turns.length > typed;
  // insurance: never let a stuck bubble hold the hand-off for more than 15 s
  useEffect(() => {
    if (encounter.status !== "proposed") return;
    const t = window.setTimeout(() => setTyped(Number.MAX_SAFE_INTEGER), 15_000);
    return () => window.clearTimeout(t);
  }, [encounter.status]);
  const petNames = useMemo(() => ({ [me.id]: me.pet.name, [peer.id]: peer.pet.name }), [me.id, me.pet.name, peer.id, peer.pet.name]);

  return (
    <EncounterScene
      encounter={{ id: encounter.id, status: encounter.status, proposalId }}
      me={me}
      peer={peer}
      talking={typing || (encounter.status === "talking" && turns.length === 0)}
      bubbles={
        // AgentBubbles puts `me`'s bubbles on the right; on this stage I stand on the left and the peer on
        // the right, so the peer is passed as `me` to keep every bubble over the pet that says it.
        <AgentBubbles
          transcript={turns}
          me={peer.id}
          petNames={petNames}
          onBlip={() => sfx.play("blip")}
          onDone={() => setTyped(turns.length)}
        />
      }
      // B's TradeWatcher opens the Trade window for the new proposal on its own: just leave the scene.
      onProposed={onDone}
      onClosed={onDone}
    />
  );
}
