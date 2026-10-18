// OWNER: B4. Temporary pixel-kit shim with the SAME names and props as A's kit (Part D).
// B4/B5 import UI only from "src/app/ui". When A's kit merges (~10:30 PM), replace this file's body with:
//   export * from "../pixel/components";
import type { CSSProperties, ReactNode } from "react";

const ink = "var(--ink, #2B2140)";
const box = (bg: string): CSSProperties => ({
  background: bg, border: `4px solid ${ink}`, boxShadow: `4px 4px 0 ${ink}`, padding: 12,
  fontFamily: "'Pixelify Sans', monospace", color: ink, imageRendering: "pixelated",
});
const TONES: Record<string, string> = {
  paper: "var(--paper, #FFF4D6)", cream: "var(--cream, #FFE8B8)", lav: "var(--lav, #B9A3FF)",
  gold: "var(--gold, #FFC83D)", pink: "var(--pink, #FF8FAB)", mint: "var(--mint, #8EE3C8)", red: "var(--red, #E85D5D)",
};

export function PixelPanel(p: { title?: string; tone?: "paper" | "cream" | "lav"; children?: ReactNode }) {
  return (
    <section style={box(TONES[p.tone ?? "paper"])}>
      {p.title && <h3 style={{ margin: "0 0 8px", fontFamily: "Silkscreen, monospace", fontSize: 16 }}>{p.title}</h3>}
      {p.children}
    </section>
  );
}

export function PixelButton(p: { variant?: "primary" | "ghost" | "danger"; icon?: ReactNode; onClick?: () => void; disabled?: boolean; children?: ReactNode }) {
  const bg = p.variant === "danger" ? TONES.red : p.variant === "ghost" ? TONES.paper : TONES.gold;
  return (
    <button onClick={p.onClick} disabled={p.disabled}
      style={{ ...box(bg), cursor: "pointer", fontFamily: "Silkscreen, monospace", textTransform: "uppercase", opacity: p.disabled ? 0.5 : 1 }}>
      {p.icon} {p.children}
    </button>
  );
}

export function DialogBox(p: { speaker: { name: string; sprite: string }; lines: string[]; onDone?: () => void;
  choices?: { label: string; value: string }[]; onChoose?: (value: string) => void }) {
  return (
    <div style={box(TONES.paper)}>
      <strong style={{ fontFamily: "Silkscreen, monospace" }}>{p.speaker.name}</strong>
      {p.lines.map((l, i) => <p key={i} style={{ margin: "6px 0" }}>{l}</p>)}
      {p.choices && (
        <div style={{ display: "flex", gap: 8 }}>
          {p.choices.map((c) => <PixelButton key={c.value} variant="ghost" onClick={() => p.onChoose?.(c.value)}>{c.label}</PixelButton>)}
        </div>
      )}
      {!p.choices && p.onDone && <PixelButton variant="ghost" onClick={p.onDone}>▼</PixelButton>}
    </div>
  );
}

export function Chip(p: { tone?: keyof typeof TONES; children?: ReactNode }) {
  return <span style={{ ...box(TONES[p.tone ?? "cream"]), padding: "2px 8px", fontFamily: "Silkscreen, monospace", fontSize: 12, textTransform: "uppercase" }}>{p.children}</span>;
}

export function Hearts(p: { filled: 1 | 2 | 3 }) {
  return <span aria-label={`${p.filled} of 3 owners`}>{"♥".repeat(p.filled)}{"♡".repeat(3 - p.filled)}</span>;
}

export function FitBar(p: { until: string; now: string; from?: string }) {
  const start = new Date(p.from ?? p.now).getTime(), end = new Date(p.until).getTime(), now = new Date(p.now).getTime();
  const left = Math.max(0, Math.min(1, (end - now) / Math.max(1, end - start || 1)));
  const label = new Date(p.until).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <div>
      <div style={{ border: `4px solid ${ink}`, height: 12, background: TONES.cream }}>
        <div style={{ width: `${Math.round(left * 100)}%`, height: "100%", background: "var(--grass, #7BC96F)" }} />
      </div>
      <small style={{ fontFamily: "Silkscreen, monospace" }}>FITS UNTIL ~{label.toUpperCase()}</small>
    </div>
  );
}

export function ItemIcon(p: { icon: string; size?: 1 | 2 }) {
  const px = (p.size ?? 1) * 48;
  return <img src={`/sprites/${p.icon}.png`} alt={p.icon} width={px} height={px}
    style={{ imageRendering: "pixelated", background: TONES.cream, border: `4px solid ${ink}` }}
    onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }} />;
}

export function Sprite(p: { name: string; anim?: "idle" | "walk" | "cheer"; scale?: 3 | 4; facing?: "left" | "right" }) {
  return <div title={p.name} style={{ width: 32 * (p.scale ?? 3), height: 32 * (p.scale ?? 3), background: TONES.lav, border: `4px solid ${ink}` }} />;
}

/** Render conditionally from the caller: {open && <Modal …/>} (A's kit has no `open` prop). */
export function Modal(p: { title: string; onClose?: () => void; children?: ReactNode }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(43,33,64,.6)", display: "grid", placeItems: "center", zIndex: 50 }} onClick={p.onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(92vw, 400px)" }}>
        <PixelPanel title={p.title}>{p.children}</PixelPanel>
      </div>
    </div>
  );
}

export function Toast(p: { text: string; tone?: keyof typeof TONES }) {
  return <div style={{ position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 60 }}><Chip tone={p.tone ?? "mint"}>{p.text}</Chip></div>;
}

/** Part D names: original / price are cents. */
export function PriceReceipt(p: { original: number; pct: number; price: number; ownerAfter: 2 | 3 }) {
  const f = (c: number) => `$${(c / 100).toFixed(2)}`;
  return (
    <div style={{ ...box("#fff"), fontFamily: "Silkscreen, monospace", fontSize: 14 }}>
      <div>ORIGINAL {f(p.original)}</div>
      <div>{p.ownerAfter === 2 ? "2ND" : "3RD"} OWNER PAYS {Math.round(p.pct * 100)}%</div>
      <div style={{ borderTop: `4px dashed ${ink}`, marginTop: 6, paddingTop: 6 }}>= {f(p.price)}</div>
    </div>
  );
}
