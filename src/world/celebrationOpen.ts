// A5 (W2): is a Celebration on screen right now? A's <Celebration> marks itself open while mounted (B's Shell
// shows it over any screen on "trade:paid" and it waits for a tap), so /world can keep its polling loops quiet
// underneath it (Base44's rate limit is shared by the whole team).
import { useSyncExternalStore } from "react";

let open = 0;
const listeners = new Set<() => void>();

/** Call on mount; returns the unmount cleanup. */
export function markCelebrationOpen(): () => void {
  open += 1;
  listeners.forEach((l) => l());
  let done = false;
  return () => {
    if (done) return;
    done = true;
    open -= 1;
    listeners.forEach((l) => l());
  };
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useCelebrationOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open > 0, () => false);
}
