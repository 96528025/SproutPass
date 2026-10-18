import type { CSSProperties, ReactNode } from "react";
import "./kit.css";

export type PanelTone = "paper" | "cream" | "lav" | "ink";

export interface PixelPanelProps {
  title?: string;
  tone?: PanelTone;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Drop the hard shadow (e.g. when nested). */
  flat?: boolean;
  id?: string;
}

/** 9-slice-look panel: 4px ink outline, stepped corners, hard offset shadow. */
export function PixelPanel({ title, tone = "paper", children, className, style, flat, id }: PixelPanelProps) {
  const cls = ["pp", `pp--${tone}`, title ? "pp--titled" : "", className ?? ""].join(" ").trim();
  return (
    <div className={cls} style={style} id={id}>
      {!flat && <div className="pp__shadow" aria-hidden />}
      {title && <div className="pp__title">{title}</div>}
      <div className="pp__body">{children}</div>
    </div>
  );
}
