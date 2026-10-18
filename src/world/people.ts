// A (W2 integration): the small shapes A's world/encounter screens draw, built from B's / C's real data.
// Parents come from the contract (closet.parent, getParties' PublicParty, listNearby rows), whose sprite
// fields are plain strings; A's <Sprite> / <ItemIcon> need a known name, so everything goes through
// asSprite / asItemIcon (unknown names fall back instead of crashing the screen).
import { ITEM_ICONS, SPRITES, type ItemIconName, type SpriteName } from "@/pixel/sprites";
import { DEMO_LAWN, demoHome } from "../../base44/shared/c/geo.ts";
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
  startedAt?: string;
  noMatchReason?: string;
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

/** Who "WALK TOWARD …" heads for by default: Jo walks to Mina (the demo story), everyone else walks to Jo. */
export function demoTargetKey(meKey: string | null | undefined): string {
  return meKey === "jo" ? "mina" : "jo";
}

/** The families /world's WALK TO picker offers (?demo=1): every seed family but me, in seed order. */
export function walkTargets(meKey: string | null | undefined): string[] {
  return SEED.map((s) => s.key).filter((k) => k !== meKey);
}

// ---- simulated GPS (?demo=1) ------------------------------------------------------------------------------------

const M_PER_DEG_LAT = 111_320;

/**
 * Each family's simulated fix: C's own demo spot (geo.ts demoHome: the one demoWalk parks a target on), so the map
 * and the radar agree with the server. Every family needs its own spot: two demo tabs on one fix would "meet" the
 * moment both open /world. Mina stands on the demo lawn; Jo 120 m north of her, exactly where C's
 * demoWalk({ reset: true }) puts a walker headed for Mina; Sam 200 m due east. All within the 300 m radar, > 25 m apart.
 * A key that isn't a seed family stands off to the south-west.
 */
export function demoFix(key: string | null | undefined): { lat: number; lng: number; accuracyM: number } {
  if (key && seedParent(key)) return { ...demoHome({ id: key, key }), accuracyM: 5 };
  const [n, e] = [-200, -120];
  return {
    lat: DEMO_LAWN.lat + n / M_PER_DEG_LAT,
    lng: DEMO_LAWN.lng + e / (M_PER_DEG_LAT * Math.cos((DEMO_LAWN.lat * Math.PI) / 180)),
    accuracyM: 5,
  };
}
