// A3 stubs and temporary-entry glue. Delete the stubs (Sprite, ParentPicker) when A2 / B merge and import the real ones.
import type { CSSProperties } from "react";
import { Outlet } from "react-router";
import { PixelButton } from "@/pixel/components/PixelButton";
import { Chip } from "@/pixel/components/Chip";
import { BottomBar } from "@/world/BottomBar";
import { HandheldFrame } from "@/world/HandheldFrame";
import { KitPage } from "@/world/KitPage";
import { MuteToggle } from "@/world/MuteToggle";
import { useDemo, useQueryParent, type ParentId } from "@/world/query";

// ---- A2 stub: <Sprite> (same props as the contract) -------------------------------------------------------------
const BOX: Record<string, string> = {
  parent_a: "var(--peach)",
  parent_b: "var(--sky)",
  parent_c: "var(--mint)",
  pet_a: "var(--lav)",
  pet_b: "var(--pink)",
  pet_c: "var(--mint)",
};

export interface SpriteProps {
  name: string;
  anim?: string;
  scale?: 3 | 4;
  facing?: "left" | "right";
  className?: string;
  style?: CSSProperties;
}

/** Placeholder: a coloured box, 16 px (pets) or 32 px (parents) × scale. The caller supplies any bobbing. */
export function Sprite({ name, scale = 3, facing = "right", className, style }: SpriteProps) {
  const px = (name.startsWith("pet_") ? 16 : 32) * scale;
  return (
    <div
      className={className}
      data-sprite={name}
      style={{
        width: px,
        height: px,
        background: BOX[name] ?? "var(--path)",
        border: "4px solid var(--ink)",
        transform: facing === "left" ? "scaleX(-1)" : undefined,
        ...style,
      }}
    />
  );
}

// ---- B stub: <ParentPicker onPick(id)> --------------------------------------------------------------------------
export function ParentPicker({ onPick }: { onPick: (id: ParentId) => void }) {
  return (
    <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
      <PixelButton onClick={() => onPick("mina")}>Mina</PixelButton>
      <PixelButton onClick={() => onPick("jo")}>Jo</PixelButton>
      <PixelButton onClick={() => onPick("sam")}>Sam</PixelButton>
    </div>
  );
}

// ---- Temporary-entry glue (B replaces main.tsx / routes.tsx) -------------------------------------------------------
export function FrameLayout() {
  return (
    <HandheldFrame>
      <Outlet />
    </HandheldFrame>
  );
}

/** Stands in for A4's /world (and B's /bag, /log) so the tab bar can be tested. */
export function TabPlaceholder({ label }: { label: string }) {
  const me = useQueryParent();
  const demo = useDemo();
  return (
    <div style={{ padding: "56px 16px calc(var(--bottom-bar) + 16px)", display: "flex", gap: 8, flexWrap: "wrap" }}>
      <Chip tone="gold">{label}</Chip>
      <Chip tone="sky">AS {me.toUpperCase()}</Chip>
      {demo && <Chip tone="lav">SIMULATED GPS</Chip>}
      <BottomBar />
      <MuteToggle />
    </div>
  );
}

export function KitWithChrome() {
  return (
    <>
      <KitPage />
      <BottomBar />
      <MuteToggle />
    </>
  );
}
