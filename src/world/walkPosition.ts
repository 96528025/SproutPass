import type { DemoPosition } from "@/app/types";

/** Late heartbeat responses must never replace a newer walk position. */
export function latestPosition(a?: DemoPosition | null, b?: DemoPosition | null): DemoPosition | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return Date.parse(b.updatedAt) > Date.parse(a.updatedAt) ? b : a;
}
