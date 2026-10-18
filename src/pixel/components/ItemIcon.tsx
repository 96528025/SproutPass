import type { CSSProperties } from "react";
import { ITEM_ICONS, type ItemIconName } from "@/pixel/sprites";
import "./sprite.css";

export interface ItemIconProps {
  icon: ItemIconName;
  /** 1 = 16x16 art at x3 (48px), 2 = at x4 (64px), inside a 4px ink slot. */
  size?: 1 | 2;
  className?: string;
  style?: CSSProperties;
}

export function ItemIcon({ icon, size = 1, className, style }: ItemIconProps) {
  const px = 16 * (size === 2 ? 4 : 3);
  return (
    <span className={["item-icon", className ?? ""].join(" ").trim()} data-icon={icon} style={style}>
      <i style={{ width: px, height: px, backgroundImage: `url(${ITEM_ICONS[icon]})` }} />
    </span>
  );
}
