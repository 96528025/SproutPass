// A3: "/" — tap to start: unlock audio, explain + ask for location once, pick a parent (unless ?as= is set), go to /world.
// The parent picker is B's (src/app/ParentPicker): it sets this tab's parent in B's store (which owns ?as=).
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { PixelPanel } from "@/pixel/components/PixelPanel";
import { PixelButton } from "@/pixel/components/PixelButton";
import { Chip } from "@/pixel/components/Chip";
import { sfx } from "@/pixel/sfx";
import { ParentPicker } from "@/app/ParentPicker";
import { useApp } from "@/app/store";
import { Sprite } from "@/pixel/components/Sprite";
import { pixelShadow } from "./BottomBar";
import { isParentId, parseParent, withQuery, type ParentId } from "./query";
import { useAudioUnlock } from "./useAudioUnlock";
import { useGeoPermission } from "./useGeoPermission";
import "./shell.css";

type Stage = "title" | "consent" | "asking" | "picker" | "go";

const CLOUD = ["..ww....", "wwwwww..", "wwwwwwww"];
const CLOUD_SHADOW = pixelShadow(CLOUD, { w: "var(--paper)" });
const PETS = ["pet_a", "pet_b", "pet_c"] as const;

export function TitleScreen() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const storeKey = useApp((s) => s.parentKey);
  const preset = (isParentId(storeKey) ? storeKey : null) ?? parseParent(search);
  const { unlock } = useAudioUnlock();
  const geo = useGeoPermission();
  const [stage, setStage] = useState<Stage>("title");
  const [noGps, setNoGps] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const start = useCallback(() => {
    if (stage !== "title") return;
    const unlocking = unlock(); // started synchronously inside the gesture (iOS)
    setStage("consent");
    void unlocking.then(() => sfx.play("start"));
  }, [stage, unlock]);

  useEffect(() => {
    if (stage !== "title") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Tab moves focus (to the projector links); a key pressed on a link follows the link.
      if (e.key === "Tab" || (e.target instanceof Element && e.target.closest(".ts__links"))) return;
      start();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, start]);

  const go = (id: ParentId | null, demo: boolean) => {
    const app = useApp.getState();
    if (id && app.parentKey !== id) app.setParent(id);
    if (demo && !app.demo) app.setDemo(true); // no GPS: demo mode sticks for this tab (B's store keeps ?demo=1)
    navigate(withQuery("/world", { as: id ?? undefined, demo: demo ? "1" : undefined }));
  };

  const onOk = async () => {
    setStage("asking");
    const result = await geo.request();
    const denied = result !== "granted";
    setNoGps(denied);
    if (!preset) return setStage("picker");
    if (!denied) return go(preset, false);
    setStage("go"); // show the chip for a beat, then continue in demo mode
    timer.current = window.setTimeout(() => go(preset, true), 1500);
  };

  return (
    <div className={`ts ts--${stage}`}>
      <i className="ts__cloud" aria-hidden style={{ top: 28, left: 24, boxShadow: CLOUD_SHADOW }} />
      <i className="ts__cloud" aria-hidden style={{ top: 404, left: 296, boxShadow: CLOUD_SHADOW }} />

      <h1 className="ts__mark font-wordmark">
        <span className="ts__l1">HAND-ME-DOWN</span>
        <span className="ts__l2">RELAY</span>
        <span className="ts__rule" aria-hidden />
      </h1>
      <div className="ts__intro">
        <p className="ts__tag">Your pixel pet passes outgrown kids' clothes to families you walk past.</p>
        <p className="ts__promise">Nothing changes hands until both parents say yes.</p>
      </div>

      <div className="ts__grass" aria-hidden />
      <div className="ts__pets" aria-hidden>
        {PETS.map((p) => (
          <div key={p} className="ts__pet">
            <Sprite name={p} anim="idle" scale={4} />
          </div>
        ))}
      </div>

      <div className="ts__action">
        {stage === "title" && (
          <div className="ts__start">
            <span className="ts__start-label">PRESS START</span>
            <span className="ts__sub">Tap anywhere to begin</span>
          </div>
        )}
        {stage === "title" && (
          // The projector views, for a judge on a laptop. They sit above the tap-anywhere layer.
          <nav className="ts__links" aria-label="Big-screen views">
            <Link className="ts__link" to="/agents">Watch the agents</Link>
            <Link className="ts__link" to="/impact">Our impact</Link>
          </nav>
        )}

        {stage === "consent" && (
          <PixelPanel title="BEFORE WE START" className="ts__panel">
            <p className="ts__consent">
              We use your location only while this screen is open, to find parents within 25 m.
            </p>
            <p className="ts__consent ts__consent--quiet">
              Other parents only see roughly how far away you are, never your exact spot.
            </p>
            <div className="ts__row">
              <PixelButton onClick={() => void onOk()}>OK</PixelButton>
            </div>
          </PixelPanel>
        )}

        {stage === "asking" && <Chip tone="gold">ASKING FOR LOCATION…</Chip>}

        {stage === "go" && noGps && <Chip tone="red">NO GPS · DEMO WALK</Chip>}

        {stage === "picker" && (
          <PixelPanel title="WHO'S PLAYING?" className="ts__panel">
            {noGps && (
              // The panel's first row, so it never sits on the title tab or the pets.
              <p className="ts__gps">
                <Chip tone="red">NO GPS</Chip>
                <span>You'll take a demo walk instead.</span>
              </p>
            )}
            <ParentPicker onPick={(id) => go(id, noGps)} />
            <p className="ts__hint">Tip: open a second tab as another parent to see both phones.</p>
          </PixelPanel>
        )}
      </div>

      {stage === "title" && <button type="button" className="ts__tap" onClick={start} aria-label="Press start" />}
      {/* MuteToggle: B's Shell mounts it once for every screen */}
    </div>
  );
}
