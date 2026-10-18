import { useEffect, useRef, type ReactNode } from "react";
import { PixelPanel, type PanelTone } from "./PixelPanel";
import "./kit.css";

export interface ModalProps {
  title: string;
  children: ReactNode;
  open?: boolean;
  onClose?: () => void;
  tone?: PanelTone;
  /** Hide the × button (e.g. a blocking trade window). */
  noClose?: boolean;
}

const FOCUSABLE = 'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';

/** PixelPanel over a dithered backdrop. Closes on backdrop tap and Esc; traps focus. */
export function Modal({ title, children, open = true, onClose, tone = "paper", noClose }: ModalProps) {
  const panel = useRef<HTMLDivElement>(null);
  // Callers often pass a fresh onClose each render; it must not re-run the focus effect (that would throw focus
  // back to × on every parent re-render, e.g. a live-sync update).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !noClose) {
        e.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (e.key === "Tab" && panel.current) {
        const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (!items.length) return;
        const a = items[0];
        const z = items[items.length - 1];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          z.focus();
        } else if (!e.shiftKey && document.activeElement === z) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, noClose]);

  if (!open) return null;
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal__backdrop" onClick={noClose ? undefined : onClose} />
      <div className="modal__panel" ref={panel}>
        <PixelPanel title={title} tone={tone}>
          {!noClose && (
            <button type="button" className="modal__close" aria-label="Close" onClick={onClose}>
              ×
            </button>
          )}
          {children}
        </PixelPanel>
      </div>
    </div>
  );
}
