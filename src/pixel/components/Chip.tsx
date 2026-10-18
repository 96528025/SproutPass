import type { CSSProperties, ReactNode } from "react";
import "./kit.css";

export type ChipTone = "ink" | "gold" | "red" | "mint" | "lav" | "sky" | "paper" | "pink";

export interface ChipProps {
  tone?: ChipTone;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

/** Silkscreen uppercase label, 24px tall. e.g. GPS ±12M, SIMULATED GPS, DEMO PAYMENT. */
export function Chip({ tone = "paper", children, className, style, title }: ChipProps) {
  return (
    <span className={`chip chip--${tone} ${className ?? ""}`.trim()} style={style} title={title}>
      {children}
    </span>
  );
}
