// Sprite manifest (A2). Generated art lives in public/sprites/*.png (see tools/art, `npm run art`).
// Shape fixed by the A-team contract: do not rename anything here.

export type SpriteName =
  | "parent_a" | "parent_b" | "parent_c"
  | "pet_a" | "pet_b" | "pet_c"
  | "alert_bubble" | "radar_dot" | "fx_flower" | "fx_petal" | "fx_sparkle"
  | "tile_grass" | "tile_path" | "tile_flowerbed" | "prop_bench" | "prop_tree"
  | "ui_heart_full" | "ui_heart_empty" | "ui_coin" | "ui_cursor";

export type ItemIconName =
  | "item_romper" | "item_onesie" | "item_tee" | "item_pants" | "item_jacket" | "item_dress"
  | "item_set" | "item_hat" | "item_socks" | "item_sweater" | "item_bib" | "item_sleepsack";

export type AnimName = "idle" | "walk" | "cheer" | "talk" | "hop" | "bloom" | "loop";

export interface AnimDef { start: number; len: number; fps: number }
export interface SpriteDef { src: string; frame: 16 | 32; anims: Partial<Record<AnimName, AnimDef>> }

// Strips: parents idle(2) walk(4) cheer(2) = 8 frames; pets idle(2) talk(2) hop(3) = 7.
const parent = (n: string): SpriteDef => ({
  src: `/sprites/${n}.png`,
  frame: 32,
  anims: {
    idle: { start: 0, len: 2, fps: 2 },
    walk: { start: 2, len: 4, fps: 8 },
    cheer: { start: 6, len: 2, fps: 4 },
  },
});
const pet = (n: string): SpriteDef => ({
  src: `/sprites/${n}.png`,
  frame: 16,
  anims: {
    idle: { start: 0, len: 2, fps: 2 },
    talk: { start: 2, len: 2, fps: 6 },
    hop: { start: 4, len: 3, fps: 6 },
    cheer: { start: 4, len: 3, fps: 6 }, // contract name for "wants attention" (C's AgentPet): the hop frames
  },
});
const still = (n: string, frame: 16 | 32 = 16): SpriteDef => ({ src: `/sprites/${n}.png`, frame, anims: {} });
const fx = (n: string, anim: AnimName, len: number, fps: number): SpriteDef => ({
  src: `/sprites/${n}.png`,
  frame: 16,
  anims: { [anim]: { start: 0, len, fps } },
});

export const SPRITES: Record<SpriteName, SpriteDef> = {
  parent_a: parent("parent_a"),
  parent_b: parent("parent_b"),
  parent_c: parent("parent_c"),
  pet_a: pet("pet_a"),
  pet_b: pet("pet_b"),
  pet_c: pet("pet_c"),
  alert_bubble: still("alert_bubble"),
  radar_dot: still("radar_dot"),
  fx_flower: fx("fx_flower", "bloom", 4, 8),
  fx_petal: fx("fx_petal", "loop", 2, 4),
  fx_sparkle: fx("fx_sparkle", "loop", 3, 6),
  tile_grass: still("tile_grass"),
  tile_path: still("tile_path"),
  tile_flowerbed: still("tile_flowerbed"),
  prop_bench: still("prop_bench"),
  prop_tree: still("prop_tree", 32),
  ui_heart_full: still("ui_heart_full"),
  ui_heart_empty: still("ui_heart_empty"),
  ui_coin: still("ui_coin"),
  ui_cursor: still("ui_cursor"),
};

export const ITEM_ICONS: Record<ItemIconName, string> = {
  item_romper: "/sprites/item_romper.png",
  item_onesie: "/sprites/item_onesie.png",
  item_tee: "/sprites/item_tee.png",
  item_pants: "/sprites/item_pants.png",
  item_jacket: "/sprites/item_jacket.png",
  item_dress: "/sprites/item_dress.png",
  item_set: "/sprites/item_set.png",
  item_hat: "/sprites/item_hat.png",
  item_socks: "/sprites/item_socks.png",
  item_sweater: "/sprites/item_sweater.png",
  item_bib: "/sprites/item_bib.png",
  item_sleepsack: "/sprites/item_sleepsack.png",
};

/** Number of frames in a strip (the furthest frame any anim reaches, or 1 for single-frame sprites). */
export function frameCount(def: SpriteDef): number {
  return Math.max(1, ...Object.values(def.anims).map((a) => a.start + a.len));
}
