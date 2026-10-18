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
