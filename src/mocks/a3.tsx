// A3 stubs and temporary-entry glue. Sprite now comes from A2; delete ParentPicker when B merges.
import { Outlet } from "react-router";
import { PixelButton } from "@/pixel/components/PixelButton";
import { Chip } from "@/pixel/components/Chip";
import { BottomBar } from "@/world/BottomBar";
import { HandheldFrame } from "@/world/HandheldFrame";
import { KitPage } from "@/world/KitPage";
import { MuteToggle } from "@/world/MuteToggle";
import { useDemo, useQueryParent, type ParentId } from "@/world/query";

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
