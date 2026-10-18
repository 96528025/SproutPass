# B contract pack — commit this before starting B1–B5

Copy these paths into the Base44 project repo (created with `base44 create` → React template), merge
`package.json` devDependencies/scripts into the template's, then commit to `main`.

```
base44/entities/*.json                 11 entity schemas (Base44 JSON-schema format + rls)
base44/shared/types.ts                 FROZEN contract types (entities + B function requests/responses)
base44/shared/pricing.ts               priceFor (the only price implementation) + rule text
base44/shared/sizes.ts                 SIZE_RANGES, ageInMonths, predictOutgrow, wearWeeksLeft, fitsNow
base44/shared/errors.ts                HttpError + helpers (pure)
base44/shared/db.ts                    typed Db, mustGet, resolveParent, getNow, writeInbox, publicParent
base44/shared/http.ts                  wrap(handler) for entry.ts — the only file importing npm:/base44:
base44/shared/match.ts                 checkEligibility (done) + findMatches/reasonLine (B1 hardens)
base44/shared/nudges.ts                scanForNudges (B1) + nudgeMessage templates
base44/shared/seed.ts                  seedPlan + applySeed (B1 adds items)
base44/shared/logic/closet.ts          B2 handler stubs
base44/shared/logic/trade.ts           B3 handler stubs
base44/shared/logic/demo.ts            B1 handler stubs
base44/shared/testing/fakeDb.ts        in-memory entities (tests + frontend mock)
base44/shared/contract.test.ts         smoke tests (pricing, outgrow seed dates, eligibility)
src/app/types.ts                       re-exports the contract for the frontend
src/app/api.ts                         FROZEN Api interface + mock/real switch (VITE_USE_MOCK=1)
src/app/api.mock.ts                    starter mock (fakeDb + seed) — B4 upgrades
src/app/api.real.ts                    real adapter stub — B4 implements
src/app/api.mock.test.ts               mock story test (nudge → $18 → proposal → pay → Jo owns it)
src/app/ui.tsx                         pixel-kit shim with A's component names — swapped when A merges
NEEDS.md                               cross-agent requests
```

Verified here: `tsc --strict` clean; `vitest run` 4/4 pass
(romper $18.00, outgrow 2026-08-27 / 2026-11-17, 4 weeks left on Oct 18, full mock story).

tsconfig for the app must allow importing `../../base44/shared/*.ts` from `src/`:
`"allowImportingTsExtensions": true, "moduleResolution": "bundler", "noEmit": true` and include `base44/shared`.
Exclude `base44/shared/http.ts` from the frontend tsconfig (it imports `npm:`/`base44:` modules that only Deno resolves).
