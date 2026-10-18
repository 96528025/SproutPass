# NEEDS

Requests between owners. Write under your own name; the owner ticks it off.

## A

### A1 (Kit)

- **B:** import `@/pixel/fonts.css` and `@/pixel/tokens.css` once in `src/app/main.tsx` (currently done in the temporary `src/main.tsx`, which B replaces).
- **B:** mount `/kit` → `KitPage` from `@/world/KitPage` in `routes.tsx` (temporary entry has it).
- **B:** the Vite `@` → `src/` alias is set in `vite.config.ts` + `tsconfig.app.json` on the scaffold; keep it when moving into the Base44 template.
- **A2:** `Sprite` and `ItemIcon` are stubbed in `src/mocks/a1.tsx`; `KitPage` and `DialogBox` portrait switch to the real ones after `world-art` merges.
- **A2:** `public/sfx/*.wav` names: start, blip, alert, select, accept, decline, coin, jingle, step. `blip` is played at volume 0.4 and throttled to ~15/s by the player.
- **All:** `DialogBox` sits above the 64px bottom bar (`--bottom-bar` token); A3's `BottomBar` must be exactly that tall.

### A2 (Art)

- **All A:** `world-art` has merged-ready assets. Import `Sprite` from `@/pixel/components/Sprite` and `ItemIcon` from `@/pixel/components/ItemIcon`; names/anims come from `@/pixel/sprites` (`SpriteName`, `ItemIconName`, `AnimName`, `SPRITES`, `ITEM_ICONS`). `Sprite` also takes an optional `once` (play once, hold last frame) and any integer `scale`; it falls back to `idle`, then frame 0, if an anim is missing. `sprites.ts` additionally exports `frameCount(def)`.
- **A1:** after merge, delete the Sprite/ItemIcon stubs in `src/mocks/a1.tsx` and point `KitPage` / `DialogBox` at the real files (props are a superset of your stub; `name` is now typed `SpriteName`, `icon` is `ItemIconName`).
- **All:** every `Sprite` strip is a horizontal PNG, parents 32 px x 8 frames, pets 16 px x 7, `prop_tree` is 32 px, everything else 16 px. Tiles are seamless; `tile_path` has no grass edges (place tiles, no autotiling). Extra file not in the contract: `public/sprites/ui_frame.png` (24x24, 8-px 9-slice).
- **B:** `package.json` gained devDeps `pngjs`, `gifenc`, `tsx`, `@types/pngjs`, `@types/node` and scripts `art` (rebuild every PNG/WAV/GIF from `tools/art`) and `art:check` (palette check). Generated files are committed, so nobody has to run them. Keep these when moving to the Base44 template.
- **B/A3:** `index.html` should link `/icon-180.png` as apple-touch-icon (A3 does that). `public/fx/flowers.gif` is the iMessage GIF for C (390x300, 3 s, 12 fps, under 1 MB).
- **Sound levels:** all wavs are peak-normalised to -3 dBFS except `blip` (-9 dBFS, soft) and `step` (-14 dBFS, quiet) as the brief asks for those to be quiet.
- **Route:** `/dev/art` is added in the `// A:` block of the temporary `src/main.tsx`; B should mount `ArtPage` from `@/world/ArtPage` in `routes.tsx`.

### A3 (Shell)

### A4 (World)

### A5 (Encounter)

## B

## C
