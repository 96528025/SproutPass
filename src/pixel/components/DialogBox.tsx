import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { sfx } from "../sfx";
import { PixelPanel } from "./PixelPanel";
import "./kit.css";

export interface DialogChoice {
  label: string;
  value: string;
}

export interface DialogBoxProps {
  speaker: { name: string; sprite: string };
  lines: string[];
  /** Fires after the last line is dismissed, or with the chosen value. */
  onDone?: (value?: string) => void;
  /** Fires with the chosen value only (C's AgentPet uses this); onDone still fires too. */
  onChoice?: (value: string) => void;
  choices?: DialogChoice[];
  /** Portrait node (A2's <Sprite>, C's pet). Falls back to a lettered box. */
  portrait?: ReactNode;
  /** Render in flow instead of fixed at the bottom (used by /kit). */
  inline?: boolean;
  /** Chars per second. */
  speed?: number;
  className?: string;
}

// Keys pressed in a field or on another control belong to that control, not to the dialog.
const CONTROL = 'input, textarea, select, button, a[href], [contenteditable]:not([contenteditable="false"])';

const prefersReduced = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** RPG text box: portrait left, typewriter at ~40 chars/s with a blip, blinking ▼, choices as a pixel menu. */
export function DialogBox({
  speaker,
  lines,
  onDone,
  onChoice,
  choices,
  portrait,
  inline,
  speed = 40,
  className,
}: DialogBoxProps) {
  const [lineIdx, setLineIdx] = useState(0);
  const [shown, setShown] = useState(0);
  const [cursor, setCursor] = useState(0);
  const timer = useRef<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const line = lines[lineIdx] ?? "";
  const typing = shown < line.length;
  const last = lineIdx >= lines.length - 1;
  const showChoices = !!choices?.length && last && !typing;
  const linesKey = lines.join("\u0001"); // stable even when the caller passes a fresh array each render
  const choicesKey = choices?.map((c) => c.value).join("\u0001") ?? "";

  // reset when the lines change
  useEffect(() => {
    setLineIdx(0);
    setShown(0);
    setCursor(0);
  }, [linesKey]);

  // a different menu (e.g. C's pet swaps SELL/KEEP/LATER for SEE TRADE/LATER) starts at its first choice,
  // so the cursor never points past the end
  useEffect(() => {
    setCursor(0);
  }, [choicesKey]);

  // typewriter
  useEffect(() => {
    if (timer.current) window.clearInterval(timer.current);
    if (prefersReduced()) {
      setShown(line.length);
      return;
    }
    setShown(0);
    let i = 0;
    const ms = Math.max(10, Math.round(1000 / speed));
    timer.current = window.setInterval(() => {
      i += 1;
      setShown(i);
      if (i % 2 === 0) sfx.play("blip", { volume: 0.4 });
      if (i >= line.length && timer.current) {
        window.clearInterval(timer.current);
        timer.current = null;
      }
    }, ms);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [line, lineIdx, speed]);

  const advance = useCallback(() => {
    if (typing) {
      if (timer.current) {
        window.clearInterval(timer.current);
        timer.current = null;
      }
      setShown(line.length);
      return;
    }
    if (!last) {
      setLineIdx((i) => i + 1);
      return;
    }
    if (choices?.length) return; // wait for a choice
    onDone?.();
  }, [typing, last, line.length, choices, onDone]);

  const pick = useCallback(
    (value: string) => {
      sfx.play("select");
      onChoice?.(value);
      onDone?.(value);
    },
    [onChoice, onDone],
  );

  // keyboard: space/enter advance; arrows move the cursor. Not while typing in a field or pressing another
  // control (a choice button's own Enter/Space click still works), and only one open dialog takes each key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest(CONTROL) && !(e.key.startsWith("Arrow") && root.current?.contains(target))) return;
      if (showChoices && choices) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setCursor((c) => (c + 1) % choices.length);
          sfx.play("blip");
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setCursor((c) => (c - 1 + choices.length) % choices.length);
          sfx.play("blip");
          return;
        }
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          const choice = choices[Math.min(cursor, choices.length - 1)];
          if (choice) pick(choice.value);
          return;
        }
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, pick, showChoices, choices, cursor]);

  return (
    <div ref={root} className={`dlg ${inline ? "dlg--inline" : ""} ${className ?? ""}`.trim()} role="dialog" aria-label={speaker.name}>
      <PixelPanel tone="paper" title={speaker.name}>
        <div className="dlg__box" onClick={advance}>
          <div className="dlg__portrait" data-sprite={speaker.sprite}>
            {portrait ?? speaker.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="dlg__text">
            {line.slice(0, shown)}
            {!typing && !showChoices && <span className="dlg__caret" aria-hidden />}
          </div>
          {showChoices && choices && (
            <div className="dlg__menu" role="menu" onClick={(e) => e.stopPropagation()}>
              {choices.map((c, i) => (
                <button
                  key={c.value}
                  type="button"
                  role="menuitem"
                  className={`dlg__choice ${i === cursor ? "dlg__choice--active" : ""}`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => pick(c.value)}
                >
                  <span className="dlg__cursor">▶</span>
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </PixelPanel>
    </div>
  );
}
