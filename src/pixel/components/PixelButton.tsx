import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";
import { sfx } from "../sfx";
import "./kit.css";

export type ButtonVariant = "primary" | "ghost" | "danger";

export interface PixelButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> {
  variant?: ButtonVariant;
  icon?: ReactNode;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  /** 32px tall variant for chips rows. */
  small?: boolean;
  /** Full width. */
  block?: boolean;
  /** Visually pressed (e.g. toggles). */
  pressed?: boolean;
  /** Skip the "select" sound. */
  silent?: boolean;
}

/** Pressed state drops 4px and loses its shadow. Primary = gold. */
export function PixelButton({
  variant = "primary",
  icon,
  onClick,
  small,
  block,
  pressed,
  silent,
  className,
  children,
  type = "button",
  ...rest
}: PixelButtonProps) {
  const cls = [
    "pb",
    `pb--${variant}`,
    small ? "pb--small" : "",
    block ? "pb--block" : "",
    pressed ? "pb--pressed" : "",
    className ?? "",
  ]
    .join(" ")
    .trim();
  return (
    <button
      type={type}
      className={cls}
      onClick={(e) => {
        if (!silent) sfx.play("select");
        onClick?.(e);
      }}
      {...rest}
    >
      {icon && <span className="pb__icon">{icon}</span>}
      {children}
    </button>
  );
}
