// A3: wraps the whole router outlet. < 600px full-bleed (100dvh, safe areas); >= 600px a centred 430px handheld
// with a 16px ink bezel, stepped cream panel and the app at exactly 390px. Pure CSS in shell.css.
//
// Inside the frame, use `var(--screen-h)` (or height:100%) instead of 100vh/100dvh: on wide screens the app
// viewport is shorter than the browser window. position:fixed children are fixed to the screen, not the window.
import type { ReactNode } from "react";
import "./shell.css";

const GRILLE = Array.from({ length: 18 }, (_, i) => i);

export function HandheldFrame({ children }: { children: ReactNode }) {
  return (
    <div className="hf">
      <div className="hf__status" aria-hidden />
      <div className="hf__body">
        <div className="hf__panel">
          <div className="hf__screen">
            <div className="hf__scroll">{children}</div>
          </div>
        </div>
        <div className="hf__chin" aria-hidden>
          <div className="hf__keys">
            <span className="hf__key" />
            <span className="hf__key" />
          </div>
          <div className="hf__grille">
            {GRILLE.map((i) => (
              <i key={i} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
