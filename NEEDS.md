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

### A3 (Shell)

### A4 (World)

### A5 (Encounter)

## B

## C
