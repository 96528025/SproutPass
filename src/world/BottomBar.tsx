// A3: 64px tab bar WORLD · BAG · PET · LOG. Fixed to the bottom of the screen (HandheldFrame keeps it inside the bezel).
// Mount it from each screen that wants it. Icons are CSS pixel glyphs until A2's sprites land.
import { Link, useLocation } from "react-router";
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
  { key: "pet", label: "Pet", to: "/world?pet=1", glyph: ["l..l", "llll", "liil", ".ll."] },
  { key: "log", label: "Log", to: "/log", glyph: ["wwww", "iwww", "wiii", "wwww"] },
];

function activeTab(pathname: string, search: string): TabKey | null {
  if (pathname.startsWith("/bag")) return "bag";
  if (pathname.startsWith("/log")) return "log";
  if (pathname.startsWith("/world")) return new URLSearchParams(search).get("pet") === "1" ? "pet" : "world";
  return null;
}

export function BottomBar() {
  const { pathname, search } = useLocation(); // re-render on navigation so withQuery sees the new ?as=
  const active = activeTab(pathname, search);
  return (
    <nav className="bb" aria-label="Main">
      <div className="bb__tabs">
        {TABS.map((t) => (
          <Link
            key={t.key}
            className="bb__tab"
            to={withQuery(t.to)}
            aria-current={active === t.key ? "page" : undefined}
            onClick={() => sfx.play("select")}
          >
            <span className="bb__icon" aria-hidden>
              <i style={{ boxShadow: pixelShadow(t.glyph, C), background: C[t.glyph[0][0] as keyof typeof C] ?? "transparent" }} />
            </span>
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
