import { useEffect, useState } from "react";
import "./kit.css";

export type ToastTone = "paper" | "ink" | "gold" | "red" | "mint" | "lav" | "sky";

export interface ToastProps {
  text: string;
  tone?: ToastTone;
  /** ms before it slides out; 0 = stays until unmounted. */
  duration?: number;
  onHide?: () => void;
}

/** Slides down from the top in 4px steps, auto-hides after 2.4s. */
export function Toast({ text, tone = "paper", duration = 2400, onHide }: ToastProps) {
  const [phase, setPhase] = useState<"in" | "out" | "gone">("in");

  useEffect(() => {
    setPhase("in");
    if (!duration) return;
    const t1 = window.setTimeout(() => setPhase("out"), duration);
    const t2 = window.setTimeout(() => {
      setPhase("gone");
      onHide?.();
    }, duration + 200);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [text, duration, onHide]);

  if (phase === "gone") return null;
  return (
    <div className={`toast toast--${tone} ${phase === "out" ? "toast--out" : ""}`} role="status">
      <div className="toast__body">{text}</div>
    </div>
  );
}
