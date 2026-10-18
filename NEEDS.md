# NEEDS.md — cross-team requests

## C → B (Closet & Trade)

**Entities** (add to `base44/entities/`, template `task.jsonc` format)

1. `PairState` — encounter re-arm/cooldown bookkeeping (one row per unordered pair). C degrades gracefully without it (every pair counts as armed; cooldown falls back to `Encounter.startedAt`), but re-arm after 40 m only works with it.
   ```json
   { "pairKey": "string", "armed": "boolean", "lastEncounterAt": "string", "lastDistanceM": "number" }
   ```
2. `PetLine` — the pet's spoken lines, mirrored from iMessage so `AgentPet` can show the same text in-app. Optional; `AgentPet` falls back to templates.
   ```json
   { "parentId": "string", "text": "string", "imageUrl": "string", "createdAt": "string" }
   ```
3. `Parent` — four optional fields: `photonUserId: string`, `photonSpaceId: string` (Photon ids cached by `sendImessage`), `convo: object` (Deno fallback conversation state), `asiAddress: string` (ASI:One claim). All writes are wrapped in `.catch(() => {})`, so missing fields don't break anything, only slow the first iMessage.
4. `AgentInbox` — three optional fields for debugging: `claimedBy`, `claimedAt`, `doneAt` (strings).

**`_lib/match.ts` exports C imports** (stub with the same signatures: `_lib/match.c-stub.ts` — `cp match.c-stub.ts match.ts` if yours isn't there yet):

```ts
export async function findMatches(db, { buyerId, sellerId }): Promise<{ listingId; itemId; itemName; size; category; priceCents; condition; wearWeeksLeft?; reason }[]>
export function predictOutgrow(item, child, now: Date): Date
```

**Event payloads** your functions write to `AgentInbox{type:"event"}` — C's agents read these fields:

| event | payload fields C reads |
|---|---|
| `nudge:new` | `nudgeId` |
| `proposal:new` | `proposalId`, `peerPet` (other side's pet name, optional) |
| `proposal:updated` | `proposalId`, **`status`** (getCloset only returns open proposals, so C can't look up a declined one), `otherName` |
| `trade:completed` | `proposalId`, `itemId`, `buyerId`, `sellerId`, `snapshot`, `predictedOutgrowDate`, `role: "buyer"\|"seller"` |

**`getCloset` shape C relies on:** `{ parent, child: {…, ageMonths}, items[], listings[], needs[], nudges[] (open), proposals[] (open + both_accepted) }`.

**`createProposal` args C sends:** `{ listingId, sellerId, buyerId, encounterId, reason, transcript, source: "fetch"|"local" }`. Returns the proposal (or `{error}`).

**`decideProposal` args:** `{ proposalId, parentId, decision: "accepted"|"declined" }`. **`payProposal`:** `{ proposalId, parentId }`. **`listItem`:** `{ itemId, sellerId, condition, conditionNote, photos[], shared }` → `{ listing, item }`. **`resolveNudge`:** `{ nudgeId, decision }`.

**`src/app/api.ts`:** `export { base44 }` (the client) — `src/agent/cApi.ts` imports it. Please add a `// C:` block calling `updatePresence`, `listNearby`, `demoWalk` if you wrap all functions (A uses them).

**Secrets** (Base44 app settings → environment variables): `AGENT_KEY`, `WEBHOOK_KEY`, `PHOTON_API_KEY`, `PHOTON_PROJECT_ID`, `SEED_PHONES` (comma-separated, optional allow-list), `APP_HOST` (e.g. `hand-me-down-relay.base44.app`, used in pay links / flowers GIF URL).

## C → A (World & Art)

1. `DialogBox` needs an `onChoice?: (value: string) => void` prop (Part D lists `choices` but no callback). `AgentPet` uses it.
2. `Sprite` with `anim: "cheer"` for the pet when it wants attention (listed in Part D, just confirming).
3. `public/fx/flowers.gif` — C sends it over iMessage after `trade:completed` (`https://<APP_HOST>/fx/flowers.gif`).
4. `EncounterScene`: mount `<AgentBubbles transcript={encounter.transcript} me={parentId} onBlip={() => sfx("blip")} />` from `src/agent`. `useEncounter(parentId)` gives you `{ encounter, peerId, myRole, dismiss }`.
5. WorldScreen: call `updatePresence` every ~3 s with `{ parentId, lat, lng, accuracyM, simulated }`; `listNearby` returns `{ me: { accuracyM, simulated, fresh }, nearby: [{ parentId, name, sprite, pet, band, bearingDeg }] }`; `demoWalk` takes `{ parentId, targetParentId, stepM?, reset? }` and returns `{ distanceM, encounters, fallback }`.

## A → … / B → …

(add yours below)

---

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

- **All:** inside `HandheldFrame` use `height: 100%` / `min-height: var(--screen-h)` instead of `100vh`/`100dvh` — on screens ≥ 600 px the app viewport is `--screen-h` (≤ 844 px), not the browser window. `position: fixed` children (BottomBar, DialogBox, Modal, A5's overlays) are fixed to the handheld screen, not the window.
- **All:** `--bottom-bar` is redefined inside the frame as `64px + env(safe-area-inset-bottom)` on phones (home-indicator room in standalone mode) and plain `64px` on the desktop bezel; keep using the variable, never a literal 64.
- **All:** `import { withQuery, useQueryParent, useDemo, type ParentId } from "@/world/query"`; `withQuery("/world", { as: "jo" })` overrides carried params. Delete your local copies.
- **A4:** `<BottomBar />` and `<MuteToggle />` are `position: fixed`, so mount each once from `/world`. The temporary entry only mounts them on its `/world`, `/bag`, `/log` placeholders and `/kit`; a placeholder route for `/world` in `src/main.tsx` is yours to replace.
- **A2:** `public/icon-180.png` is referenced by `index.html` (apple-touch-icon, favicon) and `manifest.webmanifest`; BottomBar icons are CSS-pixel placeholders (swap to your tile/pet/coin sprites after merge); TitleScreen uses the stub `Sprite` from `src/mocks/a3.tsx`.
- **B:** `<ParentPicker onPick(id: "mina"|"jo"|"sam")>` is stubbed in `src/mocks/a3.tsx`; TitleScreen imports it from there until yours merges. `FrameLayout` (HandheldFrame around `<Outlet />`) in the same file must wrap every route in your `routes.tsx`; `src/main.tsx` also needs `import "@/pixel/fonts.css"` / `tokens.css` (already there).
- **B:** `/bag` and `/log` are placeholders in the temporary entry; the bottom bar links there with `?as=` / `?demo=` kept.

### A4 (World)

- **C:** `listNearby` result: please add an optional `distanceM: number` per parent (the demo button reads "WALKING… 84 M"; without it the label falls back to the band, e.g. "100-300 M").
- **C/B:** `updatePresence` payload gets one extra optional field, `discoverable: boolean`, driven by the DISCOVERABLE toggle on /world. B's `Parent.discoverable` update should go through C's function; today the toggle only flips a local flag that rides along in each `updatePresence` call.
- **C:** `demoWalk({ parentId, towardParentId })` is called once a second from the web while ?demo=1 "WALK TOWARD …" is active, until `useEncounter(parentId).encounter` is non-null. The stub in `src/mocks/a4.tsx` models "each call moves them ~12 m closer"; the real one should end by creating the encounter when they are < 25 m apart.
- **C:** `useEncounter(parentId)` -> `{ encounter, proposal }`; /world mounts `<EncounterScene>` when `encounter` is set (and not dismissed) and `<Celebration>` when `proposal.status === "paid"`. The `bubbles` slot is passed `null`: drop C's `<AgentBubbles>` in `WorldScreen.tsx` where the comment says so.
- **A5 / Freja:** when `world-encounter` merges, in `src/world/WorldScreen.tsx` change the `@/mocks/a4` import for `EncounterScene` / `Celebration` to `@/world/EncounterScene` / `@/world/Celebration`. Props already match the contract. The HUD (chips, discoverable, walk button) uses z-index 4, below `--z-overlay` (10), so A5's `position: fixed` overlays must use `z-index: var(--z-overlay)` or higher to cover it.
- **C/B (when real):** replace the imports of `updatePresence` / `listNearby` / `demoWalk` / `useEncounter` (+ the types) from `@/mocks/a4` in `useGps.ts`, `useNearby.ts`, `useDemoWalk.ts`, `WorldScreen.tsx`, `NearbySprites` types, then delete `src/mocks/a4.tsx`.
- **B:** `src/main.tsx` `/world` now renders `WorldScreen` (one route line plus its import, in the `// A:` block). It mounts `<BottomBar />` and `<MuteToggle />` itself, so `/world` must not be wrapped with them again.

### A5 (Encounter)

- **A4:** mount `<EncounterScene encounter me peer bubbles onProposed onClosed />` and `<Celebration proposal me peer onDone />` straight from `@/world/EncounterScene` / `@/world/Celebration`; both are `position: fixed; inset: 0; z-index: var(--z-overlay)` and cover the bottom bar. Types `Encounter`, `MatchProposal`, `Parent` are temporarily exported from `src/mocks/a5.tsx`; swap them for C's/B's real ones when they land (shape used: `encounter {id, status: "meeting"|"talking"|"proposed"|"no_match", proposalId?}`).
- **A4:** `EncounterScene` has one optional extra prop beyond the contract, `talking?: boolean` (pets switch to "talk" while a bubble types; defaults to `encounter.status === "talking"`). Peers enter from the right edge; no world positions are passed.
- **C:** drop `<AgentBubbles>` into the `bubbles` prop (any ReactNode; slot is 358 px wide, centred above the parents, bottom-anchored). Pass `talking` while a bubble types if you want the pets to move their mouths.
- **C/B:** the scene calls `onProposed(encounter.proposalId)` 1.2 s after status becomes "proposed" (the pets must already be out, so ≥ 2.2 s after mount at worst); `Celebration` plays once per `proposal.id` and its button calls `onDone`.
- **Files beyond the contract list:** `src/world/encounter.css` and `src/world/celebration.css` (styles for A5's components). `/dev/encounter?as=jo` flips the point of view (Jo as buyer).

## B

## C
