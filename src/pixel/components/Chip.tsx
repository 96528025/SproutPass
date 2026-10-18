import type { CSSProperties, ReactNode } from "react";
import "./kit.css";

export type ChipTone = "ink" | "gold" | "red" | "mint" | "lav" | "sky" | "paper" | "pink";

export interface ChipProps {
  tone?: ChipTone;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  title?: string;
  /** Keep the caller's casing (sentence-like chips: "Demo payment · no real charge"). Default: uppercase tag. */
  plain?: boolean;
}

/** Short tag in the bold readable face, uppercase, 32px tall: GPS ±12M, SIMULATED GPS, 6-9M. `plain` keeps casing. */
export function Chip({ tone = "paper", children, className, style, title, plain }: ChipProps) {
  return (
    <span className={`chip chip--${tone}${plain ? " chip--plain" : ""} ${className ?? ""}`.trim()} style={style} title={title}>
      {children}
    </span>
  );
}
