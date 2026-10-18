// A3: 64px tab bar WORLD · BAG · PET · LOG. Fixed to the bottom of the screen (HandheldFrame keeps it inside the bezel).
// Mounted ONCE, by B's Shell (screens don't mount it). Icons are CSS pixel glyphs.
// PET is not a route: it dispatches the cancelable window event "pet:open"; C's AgentPet calls preventDefault()
// and opens its dialog. Nobody handled it → `onPetUnhandled` (the Shell toasts), else A's old /world?pet=1.
import { Link, useLocation, useNavigate } from "react-router";
import { sfx } from "@/pixel/sfx";
import { withQuery } from "./query";
import "./shell.css";

/** Paint a grid of 4px pixels with box-shadow. Rows are strings; `.` is empty, other chars index `colors`. */
export function pixelShadow(rows: string[], colors: Record<string, string>): string {
  const out: string[] = [];
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch !== "." && colors[ch]) out.push(`${x * 4}px ${y * 4}px 0 ${colors[ch]}`);
    });
  });
  return out.join(",");
}

type TabKey = "world" | "bag" | "pet" | "log";

const C = { i: "var(--ink)", g: "var(--grass)", d: "var(--grass-dark)", p: "var(--peach)", l: "var(--lav)", s: "var(--sky)", w: "var(--paper)", y: "var(--gold)" };

const TABS: { key: TabKey; label: string; to: string; glyph: string[] }[] = [
  { key: "world", label: "World", to: "/world", glyph: [".gg.", "gggg", ".ii.", ".ii."] },
  { key: "bag", label: "Bag", to: "/bag", glyph: [".ii.", "pppp", "pyyp", "pppp"] },
  { key: "pet", label: "Pet", to: "/world?pet=1", glyph: ["l..l", "llll", "liil", ".ll."] }, // `to` = fallback only
  { key: "log", label: "Log", to: "/log", glyph: ["wwww", "iwww", "wiii", "wwww"] },
];

/** Ask C's pet to open. True when a listener handled it (called preventDefault). */
export function requestPetOpen(): boolean {
  return !window.dispatchEvent(new CustomEvent("pet:open", { cancelable: true }));
}

export interface BottomBarProps {
  /** Label for the PET tab, e.g. the pet's name ("Button"). Defaults to "Pet". */
  petName?: string;
  /** Called when nobody handled "pet:open" (no pet mounted on this screen). */
  onPetUnhandled?: () => void;
}

function activeTab(pathname: string, search: string): TabKey | null {
  if (pathname.startsWith("/bag")) return "bag";
  if (pathname.startsWith("/log")) return "log";
  if (pathname.startsWith("/world")) return new URLSearchParams(search).get("pet") === "1" ? "pet" : "world";
  return null;
}

export function BottomBar({ petName, onPetUnhandled }: BottomBarProps = {}) {
  const { pathname, search } = useLocation(); // re-render on navigation so withQuery sees the new ?as=
  const navigate = useNavigate();
  const active = activeTab(pathname, search);
  const openPet = (to: string) => {
    sfx.play("select");
    if (requestPetOpen()) return;
    if (onPetUnhandled) onPetUnhandled();
    else navigate(withQuery(to));
  };
  return (
    <nav className="bb" aria-label="Main">
      <div className="bb__tabs">
        {TABS.map((t) => {
          const icon = (
            <span className="bb__icon" aria-hidden>
              <i style={{ boxShadow: pixelShadow(t.glyph, C), background: C[t.glyph[0][0] as keyof typeof C] ?? "transparent" }} />
            </span>
          );
          if (t.key === "pet") {
            return (
              <button key={t.key} type="button" className="bb__tab bb__tab--pet" onClick={() => openPet(t.to)}
                aria-current={active === t.key ? "page" : undefined} aria-label={petName ? `${petName}, your pet` : "Pet"}>
                {icon}
                <span className="bb__label">{petName || t.label}</span>
              </button>
            );
          }
          return (
            <Link
              key={t.key}
              className="bb__tab"
              to={withQuery(t.to)}
              aria-current={active === t.key ? "page" : undefined}
              onClick={() => sfx.play("select")}
            >
              {icon}
              <span className="bb__label">{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
