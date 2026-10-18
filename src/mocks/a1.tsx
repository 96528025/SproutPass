// A1 stubs for things A2 owns. Delete after A2 (world-art) merges and import from
// "@/pixel/components/Sprite" / "@/pixel/components/ItemIcon" instead.
import type { CSSProperties } from "react";

const COLORS: Record<string, string> = {
  parent_a: "var(--peach)",
  parent_b: "var(--sky)",
  parent_c: "var(--mint)",
  pet_a: "var(--lav)",
  pet_b: "var(--lav)",
  pet_c: "var(--lav)",
};

export interface SpriteProps {
  name: string;
  anim?: "idle" | "walk" | "cheer" | "talk" | "hop";
  scale?: 3 | 4;
  facing?: "left" | "right";
  className?: string;
  style?: CSSProperties;
}

/** Placeholder: a coloured box with an ink outline, 32px (parents) or 16px (pets) × scale. */
export function Sprite({ name, scale = 3, facing = "right", className, style }: SpriteProps) {
  const base = name.startsWith("pet_") ? 16 : 32;
  const px = base * scale;
  return (
    <div
      className={className}
      data-sprite={name}
      style={{
        width: px,
        height: px,
        background: COLORS[name] ?? "var(--path)",
        border: "4px solid var(--ink)",
        transform: facing === "left" ? "scaleX(-1)" : undefined,
        display: "inline-block",
        ...style,
      }}
    />
  );
}

export interface ItemIconProps {
  icon: string;
  size?: 1 | 2;
  className?: string;
}

/** Placeholder: 16×16 at ×3 or ×4 in a 4px ink slot. */
export function ItemIcon({ icon, size = 1, className }: ItemIconProps) {
  const px = 16 * (size === 1 ? 3 : 4);
  return (
    <div
      className={className}
      data-icon={icon}
      style={{
        width: px + 8,
        height: px + 8,
        border: "4px solid var(--ink)",
        background: "var(--gold)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--font-label)",
        fontSize: 12,
        textTransform: "uppercase",
      }}
    >
      {icon.replace("item_", "").slice(0, 3)}
    </div>
  );
}
