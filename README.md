# SproutPass (Hand-Me-Down Relay) — LA Hacks 2026

This folder is the repo root. What's here so far:

| Path | What it is | Owner |
|---|---|---|
| `docs/TEAM-BUILD-PROMPTS.md` | Team plan v4: Part 0 (general) + Part D (pixel design system) + Parts A / B / C | everyone |
| `docs/B-AGENT-PROMPTS.md` | Person B split into 3 parallel agents sharing this folder: shared preamble + one section each | Caesar (B) |
| `CONTRACT-PACK.md` | What the B contract pack contains and how it fits the Base44 project | B |
| `base44/entities/*.json` | 11 Base44 entity schemas | B1 |
| `base44/shared/*` | Frozen types, pricing, sizes, db helpers, http wrapper, match, nudges, seed, fake DB, logic stubs | B (frozen parts) / B1–B3 |
| `src/app/*` | Frontend contract: types re-export, `Api` interface, starter mock, real-adapter stub, pixel-kit shim | B4 |
| `NEEDS.md` | Cross-agent / cross-person requests | everyone |
| `docs/reference/fetch-a2a/` | Tested Fetch.ai example: chat + agent-to-agent + payment protocols (uagents 0.26.1) | C (reference only) |

## Setup (once, before launching agents)

1. **Base44 project files.** `base44 create` → React template (Node ≥ 20.19, `npm i -g base44@latest`).
   - If it won't create into this non-empty folder, create it in `C:\sproutpass-template` and copy the template's files in here without overwriting ours: `package.json` (merge), `index.html`, `vite.config.*`, `src/main.*`, `src/api/*`, `base44/config.jsonc`, `base44/.app.jsonc`.
   - Delete the sample `base44/entities/task.jsonc`.
2. **Merge `package.json`.** Add our devDependencies (`vitest`, `typescript`) and the scripts `"test": "vitest run"` and `"typecheck": "tsc -p tsconfig.check.json"`.
3. **tsconfig.** The app's tsconfig needs `"allowImportingTsExtensions": true`, `"moduleResolution": "bundler"`, `"noEmit": true`, and must include `base44/shared` (excluding `base44/shared/http.ts`).
4. **Verify.** Run `git init && git add -A && git commit -m "contract pack"`, then `npm i && npx vitest run`. Expect 4 tests passing.
5. **Publish and open it up.**
   - Run `base44 deploy --build -y` once to publish. Always build through the CLI (`base44 build` / `--build`); a bare `npm run build` leaves `VITE_BASE44_APP_ID` unset and every API call fails.
   - Run `npx base44 visibility public`.
   - Open `https://<slug>.base44.app` on both iPhones and add it to the Home Screen.
6. **Start Agents 1–3.** Follow the top of `docs/B-AGENT-PROMPTS.md`: three sessions in this same folder (no worktrees), each given the shared preamble + its own section.
