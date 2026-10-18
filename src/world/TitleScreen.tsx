// A3: "/" — tap to start: unlock audio, explain + ask for location once, pick a parent (unless ?as= is set), go to /world.
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { PixelPanel } from "@/pixel/components/PixelPanel";
import { PixelButton } from "@/pixel/components/PixelButton";
import { Chip } from "@/pixel/components/Chip";
import { sfx } from "@/pixel/sfx";
import { ParentPicker, Sprite } from "@/mocks/a3"; // TODO: ParentPicker from B, Sprite from A2
import { MuteToggle } from "./MuteToggle";
import { pixelShadow } from "./BottomBar";
import { parseParent, withQuery, type ParentId } from "./query";
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
  const preset = parseParent(search);
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
      start();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, start]);

  const go = (id: ParentId | null, demo: boolean) =>
    navigate(withQuery("/world", { as: id ?? undefined, demo: demo ? "1" : undefined }));

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
    <div className="ts">
      <i className="ts__cloud" aria-hidden style={{ top: 28, left: 24, boxShadow: CLOUD_SHADOW }} />
      <i className="ts__cloud" aria-hidden style={{ top: 404, left: 296, boxShadow: CLOUD_SHADOW }} />

      <h1 className="ts__mark font-wordmark">
        <span className="ts__l1">HAND-ME-DOWN</span>
        <span className="ts__l2">RELAY</span>
        <span className="ts__rule" aria-hidden />
      </h1>
      <p className="ts__tag">pass it on, one park bench at a time</p>

      <div className="ts__grass" aria-hidden />
      <div className="ts__pets" aria-hidden>
        {PETS.map((p) => (
          <div key={p} className="ts__pet">
            <Sprite name={p} anim="idle" scale={4} />
          </div>
        ))}
      </div>

      <div className="ts__action">
        {stage === "title" && <span className="ts__start">PRESS START</span>}

        {stage === "consent" && (
          <PixelPanel className="ts__panel">
            <p className="ts__consent">
              We use your location only while this screen is open, to find parents within 25 m
            </p>
            <div className="ts__row">
              <PixelButton onClick={() => void onOk()}>OK</PixelButton>
            </div>
          </PixelPanel>
        )}

        {stage === "asking" && <Chip tone="gold">ASKING FOR LOCATION…</Chip>}

        {(stage === "picker" || stage === "go") && noGps && <Chip tone="red">NO GPS — DEMO MODE</Chip>}

        {stage === "picker" && (
          <PixelPanel title="WHO ARE YOU?" className="ts__panel">
            <ParentPicker onPick={(id) => go(id, noGps)} />
          </PixelPanel>
        )}
      </div>

      {stage === "title" && <button type="button" className="ts__tap" onClick={start} aria-label="Press start" />}
      <MuteToggle />
    </div>
  );
}
