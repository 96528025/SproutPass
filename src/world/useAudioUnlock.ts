// A3: thin wrapper over A1's sfx so the title (and anything else) can unlock audio on the first gesture.
import { useCallback } from "react";
import { sfx, useSfx } from "@/pixel/sfx";

export function useAudioUnlock(): { unlocked: boolean; unlock: () => Promise<void> } {
  const { unlocked } = useSfx();
  // Call synchronously inside the tap handler: iOS only allows the AudioContext to start from a gesture.
  const unlock = useCallback(() => sfx.unlock(), []);
  return { unlocked, unlock };
}
