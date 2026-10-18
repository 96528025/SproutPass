// A (W2 integration): the small shapes A's world/encounter screens draw, built from B's / C's real data.
// Parents come from the contract (closet.parent, getParties' PublicParty, listNearby rows), whose sprite
// fields are plain strings; A's <Sprite> / <ItemIcon> need a known name, so everything goes through
// asSprite / asItemIcon (unknown names fall back instead of crashing the screen).
import { ITEM_ICONS, SPRITES, type ItemIconName, type SpriteName } from "@/pixel/sprites";
import { seedPlan } from "../../base44/shared/seed.ts";

/** A parent as the scenes draw them: closet.parent and PublicParty (getParties) both fit. */
export interface ScenePerson {
  id: string;
  name: string;
  avatar: { sprite: string; palette?: string };
  pet: { sprite: string; name: string };
  /** Not drawn; accepted so a full Parent row fits as-is. */
  discoverable?: boolean;
}

/** What EncounterScene needs from C's Encounter row (+ the MatchProposal found for it). */
export interface SceneEncounter {
  id: string;
  status: "meeting" | "talking" | "proposed" | "no_match";
  proposalId?: string;
}

export function asSprite(name: string | undefined | null, fallback: SpriteName): SpriteName {
  return name && Object.prototype.hasOwnProperty.call(SPRITES, name) ? (name as SpriteName) : fallback;
}

export function asItemIcon(name: string | undefined | null, fallback: ItemIconName = "item_tee"): ItemIconName {
  return name && Object.prototype.hasOwnProperty.call(ITEM_ICONS, name) ? (name as ItemIconName) : fallback;
}

// ---- seed lookups (demo only: the three demo families) ---------------------------------------------------------

const SEED = seedPlan().parents;

/** Seed parent card for a key ("mina" | "jo" | "sam"), or null. No ids: those live in Base44. */
export function seedParent(key: string | null | undefined): { key: string; name: string; avatar: { sprite: string }; pet: { sprite: string; name: string } } | null {
  const p = SEED.find((s) => s.key === key);
  return p ? { key: p.key, name: p.name, avatar: { sprite: p.avatar.sprite }, pet: { sprite: p.pet.sprite, name: p.pet.name } } : null;
}

/** "jo" → "Jo" (falls back to the key, upper-cased first letter). */
export function seedName(key: string): string {
  return seedParent(key)?.name ?? key.charAt(0).toUpperCase() + key.slice(1);
}

/** Who "WALK TOWARD …" heads for: Jo walks to Mina (the demo story), everyone else walks to Jo. */
export function demoTargetKey(meKey: string | null | undefined): string {
  return meKey === "jo" ? "mina" : "jo";
}

// ---- simulated GPS (?demo=1) ------------------------------------------------------------------------------------

/** C's demo lawn (base44/functions/demoWalk DEMO_LAWN): a simulated target with no presence is parked here. */
const DEMO_LAWN = { lat: 34.0709, lng: -118.4446 };
const M_PER_DEG_LAT = 111_320;

/**
 * Per-family offsets on the demo lawn, in metres (north, east). Every family needs its own spot: two demo
 * tabs on one fix would "meet" the moment both open /world. Mina stands on the lawn itself; Jo starts 120 m
 * north of her, exactly where C's demoWalk({ reset: true }) puts the walker; Sam watches from the east.
 * All three stay within the 300 m radar, and > 25 m apart.
 */
const DEMO_SPOTS: Record<string, [number, number]> = { mina: [0, 0], jo: [120, 0], sam: [-60, 170] };

export function demoFix(key: string | null | undefined): { lat: number; lng: number; accuracyM: number } {
  const [n, e] = DEMO_SPOTS[key ?? ""] ?? [-200, -120];
  return {
    lat: DEMO_LAWN.lat + n / M_PER_DEG_LAT,
    lng: DEMO_LAWN.lng + e / (M_PER_DEG_LAT * Math.cos((DEMO_LAWN.lat * Math.PI) / 180)),
    accuracyM: 5,
  };
}
