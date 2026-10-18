// A4: ?demo=1 only. While active, calls C's demoWalk every 1 s until an encounter exists, then stops itself.
import { useCallback, useEffect, useState } from "react";
import { demoWalk } from "@/mocks/a4"; // C: swap for the real api when it lands
import type { ParentId } from "@/world/query";

export function useDemoWalk(
  parentId: ParentId,
  toward: ParentId,
  { enabled, encountered }: { enabled: boolean; encountered: boolean },
): { active: boolean; start: () => void; stop: () => void } {
  const [started, setStarted] = useState(false);
  const active = enabled && started && !encountered;

  useEffect(() => {
    if (!active) return;
    const step = () => void demoWalk({ parentId, towardParentId: toward }).catch(() => {});
    step();
    const id = window.setInterval(step, 1000);
    return () => window.clearInterval(id);
  }, [active, parentId, toward]);

  const start = useCallback(() => setStarted(true), []);
  const stop = useCallback(() => setStarted(false), []);
  return { active, start, stop };
}
