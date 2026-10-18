// /dev/art — gallery of every A2 asset: sprites with each anim playing, item icons, tiles as 3x3 patches,
// the 9-slice frame, the GIF and a sound button per SfxName. Freja reviews art quality here.
import type { ReactNode } from "react";
import { Sprite } from "@/pixel/components/Sprite";
import { ItemIcon } from "@/pixel/components/ItemIcon";
import { SPRITES, ITEM_ICONS, type AnimName, type SpriteName } from "@/pixel/sprites";
import { sfx, type SfxName } from "@/pixel/sfx";

const SOUNDS: SfxName[] = ["start", "blip", "alert", "select", "accept", "decline", "coin", "jingle", "step"];
const TILES: SpriteName[] = ["tile_grass", "tile_path", "tile_flowerbed"];

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 className="px-label-16" style={{ color: "var(--paper)", marginBottom: 4 }}>{title}</h2>
      {note && <p className="px-label-12" style={{ color: "var(--cream)", marginBottom: 12 }}>{note}</p>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end" }}>{children}</div>
    </section>
  );
}

function Cell({ label, children, bg = "var(--grass)" }: { label: string; children: ReactNode; bg?: string }) {
  return (
    <figure style={{ margin: 0, display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
      <div style={{ background: bg, border: "4px solid var(--ink)", padding: 8, display: "flex", alignItems: "flex-end" }}>{children}</div>
      <figcaption className="px-label-12" style={{ color: "var(--paper)" }}>{label}</figcaption>
    </figure>
  );
}

const btn = {
  font: "inherit", padding: "8px 12px", background: "var(--gold)", border: "4px solid var(--ink)", boxShadow: "var(--shadow-hard)", cursor: "pointer",
} as const;

export function ArtPage() {
  const names = Object.keys(SPRITES) as SpriteName[];
  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px 64px", background: "var(--grass-dark)", minHeight: "100dvh" }}>
      <h1 className="font-wordmark" style={{ fontSize: 16, lineHeight: "24px", color: "var(--paper)", marginBottom: 24 }}>/DEV/ART</h1>

      <Section title="SPRITES" note="every sprite at x4, every anim playing · facing right">
        {names.flatMap((n) => {
          const anims = Object.keys(SPRITES[n].anims) as AnimName[];
          const list: (AnimName | null)[] = anims.length ? anims : [null];
          return list.map((a) => (
            <Cell key={`${n}-${a}`} label={a ? `${n} · ${a}` : n}>
              <Sprite name={n} anim={a ?? "idle"} scale={4} />
            </Cell>
          ));
        })}
        <Cell label="parent_a · facing left">
          <Sprite name="parent_a" anim="walk" scale={4} facing="left" />
        </Cell>
      </Section>

      <Section title="ITEM ICONS" note="<ItemIcon size={1}> (x3) and size={2} (x4)">
        {(Object.keys(ITEM_ICONS) as (keyof typeof ITEM_ICONS)[]).map((k) => (
          <Cell key={k} label={k} bg="var(--paper)">
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <ItemIcon icon={k} size={1} />
              <ItemIcon icon={k} size={2} />
            </div>
          </Cell>
        ))}
      </Section>

      <Section title="TILES" note="3x3 patches at x3 (48 px tiles), how the lawn will use them">
        {TILES.map((t) => (
          <Cell key={t} label={t}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 48px)" }}>
              {Array.from({ length: 9 }, (_, i) => <Sprite key={i} name={t} scale={3} />)}
            </div>
          </Cell>
        ))}
        <Cell label="mixed lawn">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 48px)" }}>
            {Array.from({ length: 15 }, (_, i) => {
              const path = i % 5 === 2 || (i >= 5 && i < 10);
              const bed = i === 0 || i === 14;
              return <Sprite key={i} name={path ? "tile_path" : bed ? "tile_flowerbed" : "tile_grass"} scale={3} />;
            })}
          </div>
        </Cell>
      </Section>

      <Section title="PROPS ON GRASS" note="prop_tree (32) and prop_bench (16) over tile_grass at x3">
        <Cell label="tree + bench + bed">
          <div style={{ position: "relative", width: 240, height: 144, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 48px)", position: "absolute", inset: 0 }}>
              {Array.from({ length: 15 }, (_, i) => <Sprite key={i} name={i === 12 ? "tile_flowerbed" : "tile_grass"} scale={3} />)}
            </div>
            <Sprite name="prop_tree" scale={3} style={{ position: "absolute", left: 16, top: 8 }} />
            <Sprite name="prop_bench" scale={3} style={{ position: "absolute", left: 144, top: 64 }} />
            <Sprite name="parent_a" anim="walk" scale={3} style={{ position: "absolute", left: 100, top: 40 }} />
            <Sprite name="pet_a" anim="hop" scale={3} style={{ position: "absolute", left: 180, top: 16 }} />
          </div>
        </Cell>
      </Section>

      <Section title="UI FRAME" note="/sprites/ui_frame.png as a 9-slice: 8-px source borders shown at x2">
        <Cell label="ui_frame.png" bg="var(--grass)">
          <img src="/sprites/ui_frame.png" width={96} height={96} alt="" />
        </Cell>
        <Cell label="border-image" bg="var(--grass)">
          <div
            style={{
              width: 220, height: 96,
              borderStyle: "solid", borderWidth: 16, borderImage: "url(/sprites/ui_frame.png) 8 fill / 16px / 0 stretch",
              imageRendering: "pixelated", padding: 4, boxSizing: "border-box",
            }}
          >
            <span className="px-label-12">NINE-SLICE PANEL</span>
          </div>
        </Cell>
      </Section>

      <Section title="GIF + ICON" note="public/fx/flowers.gif (390x300, 3 s, 12 fps) and public/icon-180.png">
        <Cell label="flowers.gif"><img src="/fx/flowers.gif" width={390} height={300} alt="golden flowers blooming" style={{ maxWidth: "100%", height: "auto" }} /></Cell>
        <Cell label="icon-180.png"><img src="/icon-180.png" width={180} height={180} alt="app icon" /></Cell>
      </Section>

      <Section title="SOUNDS" note="first tap unlocks audio (Web Audio) — then every button plays its wav">
        {SOUNDS.map((s) => (
          <button key={s} style={btn} className="px-label-16" onClick={async () => { await sfx.unlock(); sfx.play(s); }}>▶ {s}</button>
        ))}
      </Section>
    </main>
  );
}
