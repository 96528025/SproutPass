// A3: "/" — tap to start: unlock audio, explain + ask for location once, pick a parent (unless ?as= is set), go to /world.
// The parent picker is B's (src/app/ParentPicker): it sets this tab's parent in B's store (which owns ?as=).
import { useCallback, useEffect, useState } from "react";
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
import { geoHelp, useGeoPermission } from "./useGeoPermission";
import "./shell.css";

type Stage = "title" | "consent" | "asking" | "picker" | "location-error";

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
  const [demoChosen, setDemoChosen] = useState(false);

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
      // Tab moves focus (to the projector links); a key pressed on a link or another control (the mute toggle)
      // belongs to that control. Only the tap layer itself starts from the keyboard.
      if (e.key === "Tab" || (e.target instanceof Element && e.target.closest("a, input, button:not(.ts__tap)"))) return;
      start();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, start]);

  const go = (id: ParentId | null, demo: boolean) => {
    const app = useApp.getState();
    if (id && app.parentKey !== id) app.setParent(id);
    app.setDemo(demo);
    navigate(withQuery("/world", { as: id ?? undefined, demo: demo ? "1" : "0" }));
  };

  const onOk = async () => {
    setStage("asking");
    const result = await geo.request();
    if (result !== "granted") return setStage("location-error");
    setDemoChosen(false);
    if (!preset) return setStage("picker");
    go(preset, false);
  };

  const chooseDemo = () => {
    setDemoChosen(true);
    if (preset) go(preset, true);
    else setStage("picker");
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
        <p className="ts__promise">Your agent negotiates. Only the buyer approves the final trade.</p>
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
              We use your location only while this screen is open, to show parents within 300 m. Pets meet at 25 m.
            </p>
            <p className="ts__consent ts__consent--quiet">
              Other parents only see roughly how far away you are, never your exact spot.
            </p>
            <div className="ts__row">
              <PixelButton onClick={() => void onOk()}>ENABLE LOCATION</PixelButton>
              <PixelButton variant="ghost" onClick={chooseDemo}>USE DEMO</PixelButton>
            </div>
          </PixelPanel>
        )}

        {stage === "asking" && <Chip tone="gold">ASKING FOR LOCATION…</Chip>}

        {stage === "location-error" && (
          <PixelPanel title="LOCATION NOT READY" className="ts__panel">
            <p className="ts__consent" role="status">{geoHelp(geo.status)}</p>
            <div className="ts__row">
              <PixelButton onClick={() => void onOk()}>TRY LOCATION AGAIN</PixelButton>
              <PixelButton variant="ghost" onClick={chooseDemo}>USE DEMO</PixelButton>
            </div>
          </PixelPanel>
        )}

        {stage === "picker" && (
          <PixelPanel title="WHO'S PLAYING?" className="ts__panel">
            {demoChosen && <p className="ts__gps"><Chip tone="lav">SIMULATED LOCATION</Chip></p>}
            <ParentPicker onPick={(id) => go(id, demoChosen)} />
            <p className="ts__hint">Tip: open a second tab as another parent to see both phones.</p>
          </PixelPanel>
        )}
      </div>

      {stage === "title" && <button type="button" className="ts__tap" onClick={start} aria-label="Press start" />}
      {/* MuteToggle: B's Shell mounts it once for every screen */}
    </div>
  );
}
