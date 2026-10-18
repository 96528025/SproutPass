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

- **All:** inside `HandheldFrame` use `height: 100%` / `min-height: var(--screen-h)` instead of `100vh`/`100dvh` — on screens ≥ 600 px the app viewport is `--screen-h` (≤ 844 px), not the browser window. `position: fixed` children (BottomBar, DialogBox, Modal, A5's overlays) are fixed to the handheld screen, not the window.
- **All:** `--bottom-bar` is redefined inside the frame as `64px + env(safe-area-inset-bottom)` on phones (home-indicator room in standalone mode) and plain `64px` on the desktop bezel; keep using the variable, never a literal 64.
- **All:** `import { withQuery, useQueryParent, useDemo, type ParentId } from "@/world/query"`; `withQuery("/world", { as: "jo" })` overrides carried params. Delete your local copies.
- **A4:** `<BottomBar />` and `<MuteToggle />` are `position: fixed`, so mount each once from `/world`. The temporary entry only mounts them on its `/world`, `/bag`, `/log` placeholders and `/kit`; a placeholder route for `/world` in `src/main.tsx` is yours to replace.
- **A2:** `public/icon-180.png` is referenced by `index.html` (apple-touch-icon, favicon) and `manifest.webmanifest`; BottomBar icons are CSS-pixel placeholders (swap to your tile/pet/coin sprites after merge); TitleScreen uses the stub `Sprite` from `src/mocks/a3.tsx`.
- **B:** `<ParentPicker onPick(id: "mina"|"jo"|"sam")>` is stubbed in `src/mocks/a3.tsx`; TitleScreen imports it from there until yours merges. `FrameLayout` (HandheldFrame around `<Outlet />`) in the same file must wrap every route in your `routes.tsx`; `src/main.tsx` also needs `import "@/pixel/fonts.css"` / `tokens.css` (already there).
- **B:** `/bag` and `/log` are placeholders in the temporary entry; the bottom bar links there with `?as=` / `?demo=` kept.

### A4 (World)

### A5 (Encounter)

## B

## C
