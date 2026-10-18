import type { CSSProperties } from "react";
import { frameCount, SPRITES, type AnimName, type SpriteName } from "@/pixel/sprites";
import "./sprite.css";

export interface SpriteProps {
  name: SpriteName;
  anim?: AnimName;
  /** Integer pixel scale (default 3). */
  scale?: number;
  facing?: "left" | "right";
  /** Play the anim once and hold the last frame (e.g. bloom). */
  once?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** One sprite from a horizontal strip: a div with a pixelated background that steps through the anim's frames. */
export function Sprite({ name, anim = "idle", scale = 3, facing = "right", once, className, style }: SpriteProps) {
  const def = SPRITES[name];
  const fs = def.frame * scale;
  const frames = frameCount(def);
  // fall back to idle, then to the first anim the sprite has, then to a still frame 0
  const a = def.anims[anim] ?? def.anims.idle ?? Object.values(def.anims)[0];
  const x0 = -(a?.start ?? 0) * fs;
  const animated = !!a && a.len > 1;
  const css: Record<string, string | number> = {
    width: fs,
    height: fs,
    backgroundImage: `url(${def.src})`,
    backgroundSize: `${frames * fs}px ${fs}px`,
    "--x0": `${x0}px`,
  };
  if (animated) {
    css["--x1"] = `${x0 - a.len * fs}px`;
    css["--n"] = a.len;
    css.animationDuration = `${a.len / a.fps}s`;
  }
  const cls = ["spr", animated ? "spr--anim" : "", animated && once ? "spr--once" : "", facing === "left" ? "spr--flip" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  return <div className={cls} data-sprite={name} data-anim={anim} style={{ ...css, ...style } as CSSProperties} />;
}
