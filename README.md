# SproutPass · LA Hacks 2026

Children outgrow clothes before the clothes wear out. SproutPass helps parents pass those garments to another family with less listing, searching and coordination.

Parents can send clothing photos through iMessage or upload them in the app. Base44 identifies visible garment details, stores the inventory and shared needs, checks matches, and records ownership transfers. The seller authorizes an offer by sharing a listing. **Only the buyer approves the final trade.** Approval runs an explicitly labeled Visa simulation and moves the item into the buyer’s inventory. No real card, Visa API, charge, or funds transfer is involved.

- [Live app](https://sproutpass-5c025059.base44.app)
- [Staged demo and progress](https://sproutpass-5c025059.base44.app/trial)
- [User feedback form](https://sproutpass-5c025059.base44.app/feedback)
- [Demo instructions](docs/submission/demo-script.md)
- [Submission description](docs/submission/devpost.md)
- [Architecture](docs/submission/architecture.md)
- [Challenge mapping](docs/submission/tracks.md)
- [Historical testing record](docs/submission/testing.md)

## Fast demonstration

1. Open `/trial`. Choose **Prepare Sample + Need**. This adds a clearly labeled illustrated children’s garment to Freja’s inventory and a compatible need for Olivia. It preserves existing inventory and reuses the sample on repeated clicks.
2. Choose **Create Demo Offer**, or open both world screens and demonstrate the approach with simulated location. In the world's demo mode, tap another family's character to meet them in one step. At Oct 18 the seeded bags give each pair a match or a deliberate no-match (table and demo order in [docs/TESTING-MATCHES.md](docs/TESTING-MATCHES.md)).
3. Open the buyer’s offer as Olivia. Review the garment and $18 final price, then approve or decline. Approval performs the simulated payment and ownership transfer; decline leaves the item with its seller.
4. Return to `/trial` to verify the saved state. Check both physical phones to verify the iMessage receipt actually arrived.

The staged sample does not demonstrate photo recognition or organic customer demand. To demonstrate photo recognition, send an actual garment photo, confirm the label size and original purchase price when asked, and list it. Have the buyer state a compatible need and confirm it. Select that garment in `/trial`.

## iMessage setup

Each demo participant has an assigned shared Photon number:

| Person | Text the agent at | App identity |
|---|---|---|
| Caesar | +1 (628) 263-4622 | `mina` |
| Freja | +1 (628) 316-6196 | `sam` |
| Olivia | +1 (628) 316-7976 | `jo` |

Text **hi** to the assigned number first. The app learns the private conversation for subsequent offers and receipts. Changing a phone in Base44 or `.env.photon` alone does not create a Photon shared-line assignment. Never commit either file’s secrets.

These shared lines support individual conversations. The real family group-chat workflow requires a dedicated Photon line and has not been verified. ASI:One is not part of the submission target.

## What is real and what is staged

- **Real application behavior:** Base44 persistence, photo analysis through Base44 AI, conversational need extraction, eligibility rules, proposal records, buyer approval, inventory ownership updates, live UI changes and Photon sends when configured.
- **Staged demonstration:** named demo accounts, prefilled sample clothing and needs, and optional simulated locations. The app uses demo identity selectors, not production account isolation.
- **Simulated payment:** a saved Visa simulation record with amount, authorization code, capture timestamp and receipt. No money moves.
- **Receipt evidence:** the trial page distinguishes pending/failed sends from text and image submissions accepted by Photon. Submission is not a delivery or read confirmation; show the physical phones for that.
- **Feedback evidence:** `/feedback` stores actual submissions privately in Base44. Parent/caregiver feedback is distinct from teammate testing. Quotation consent is optional. No interviews or feedback are invented.
- **Matching:** listed-price offers use size, category, budget, current fit and the buyer’s rules. Prices follow the current 60% / 40% resale rules; this is not open-ended price bargaining.

## Run locally

Use Node 22 or later and install dependencies with `npm install`.

```bash
npm run real       # Local frontend connected to the live configured Base44 backend
npm run mock       # Offline demo; does not prove the live iMessage integration
npm run typecheck
npm test
```

The local project is linked by `base44/.app.jsonc`. The real frontend needs `VITE_BASE44_APP_ID` and `VITE_BASE44_APP_BASE_URL` in its environment. Use the public app ID from the linked project; keep all service credentials in ignored environment files or Base44 secrets.

```bash
npx base44 whoami
npx base44 entities push -y
npx base44 functions deploy
npx base44 build
npx base44 site deploy -y
```

Entity synchronization affects the whole configured schema, so check for remote-only entities before pushing. Do not reset live inventory to rehearse. `/trial` creates only its labeled sample and matching need.

## Product feedback

Ask two parents/caregivers to add an item without coaching, then send them `/feedback`. Record whether they finished unaided, what they currently do with outgrown clothes, where they hesitated, whether this would save effort, and the change they want. The `UserFeedback` entity is private; the team can review it through privileged Base44 access. Report the actual response counts and make one observable improvement from the feedback before claiming user validation.

Legacy internal keys and protocol identifiers are retained for data compatibility; the product name is SproutPass.
