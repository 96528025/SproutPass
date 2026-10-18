// (C) encounter.ts — the encounter rules now live in ./location.ts (pure: no Deno, no npm:), shared by the
// Deno functions and B's in-browser mock. This file keeps the old import path and signatures working.

// deno-lint-ignore-file no-explicit-any
import { type FindMatches, runLocalFallback as runFallback } from "./location.ts";

export {
  detectEncounters,
  type EncounterResult,
  FALLBACK_AFTER_MS,
  type FindMatches,
  type LocalMatch,
  localTranscript,
  resolveEncounter,
  stageEncounter,
} from "./location.ts";

/** Old signature (base44 first); the client isn't needed any more, and the fallback now covers every pair. */
export function runLocalFallback(_base44: any, db: any, _parentId: string, findMatches: FindMatches) {
  return runFallback(db, findMatches);
}
