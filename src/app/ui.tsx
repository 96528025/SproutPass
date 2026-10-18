// OWNER: B4. B's one UI import: Person A's real pixel kit (src/pixel/components), plus a thin B layer.
// B / C screens import UI only from "src/app/ui".
//
// The B layer exists because backend data is plain strings: Parent.avatar.sprite, Parent.pet.sprite and
// ClothingItem.icon are `string` in the contract, while A's <Sprite name> / <ItemIcon icon> take the typed
// SpriteName / ItemIconName and index a table with them (an unknown name would throw). So:
//   - Sprite / ItemIcon here are A's components that accept any string and fall back to a known sprite;
//   - asSprite / asItemIcon narrow a string for code that needs the typed name (e.g. A's Celebration props);
//   - Chip also takes B's older tone "cream" (A's kit draws it as "paper", which is what A's Chip does anyway).
// Everything else is A's kit unchanged (DialogBox uses onChoice(value); pass `inline` inside a Modal).
import {
  Chip as KitChip, ItemIcon as KitItemIcon, Sprite as KitSprite,
  type ChipProps, type ChipTone, type ItemIconProps, type SpriteProps,
} from "../pixel/components";
import { ITEM_ICONS, SPRITES, type ItemIconName, type SpriteName } from "../pixel/sprites";

export * from "../pixel/components";
export type { AnimName, ItemIconName, SpriteName } from "../pixel/sprites";

const has = (table: object, key: unknown): boolean =>
  typeof key === "string" && Object.prototype.hasOwnProperty.call(table, key);

export function isSpriteName(v: unknown): v is SpriteName {
  return has(SPRITES, v);
}

export function isItemIconName(v: unknown): v is ItemIconName {
  return has(ITEM_ICONS, v);
}

/** Pets fall back to pet_a, everything else to parent_a. */
function defaultSprite(name: unknown): SpriteName {
  return typeof name === "string" && name.startsWith("pet") ? "pet_a" : "parent_a";
}

/** A backend sprite string as A's SpriteName; unknown or missing names become `fallback`. */
export function asSprite(name: unknown, fallback: SpriteName = defaultSprite(name)): SpriteName {
  return isSpriteName(name) ? name : fallback;
}

/** A backend item icon string as A's ItemIconName; unknown or missing icons become `fallback`. */
export function asItemIcon(icon: unknown, fallback: ItemIconName = "item_tee"): ItemIconName {
  return isItemIconName(icon) ? icon : fallback;
}

export type UiSpriteProps = Omit<SpriteProps, "name"> & { name: string; fallback?: SpriteName };

/** A's Sprite for data strings (pet.sprite, avatar.sprite). */
export function Sprite({ name, fallback, ...rest }: UiSpriteProps) {
  return <KitSprite {...rest} name={asSprite(name, fallback)} />;
}

export type UiItemIconProps = Omit<ItemIconProps, "icon"> & { icon: string; fallback?: ItemIconName };

/** A's ItemIcon for data strings (item.icon, snapshot.icon). */
export function ItemIcon({ icon, fallback, ...rest }: UiItemIconProps) {
  return <KitItemIcon {...rest} icon={asItemIcon(icon, fallback)} />;
}

export type UiChipTone = ChipTone | "cream";
export type UiChipProps = Omit<ChipProps, "tone"> & { tone?: UiChipTone };

/** A's Chip; B's "cream" tone is A's "paper". */
export function Chip({ tone, ...rest }: UiChipProps) {
  return <KitChip {...rest} tone={tone === "cream" ? "paper" : tone} />;
}
