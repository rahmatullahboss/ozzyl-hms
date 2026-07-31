# Ozzyl HMS Full Stack Upgrade

## Phase A — Safe Minor/Patch Upgrades
- [x] Root [package.json](file:///c:/Users/rahma/Desktop/dev/ozzyl-hms/package.json) — Hono 4.12, wrangler 4.73, workers-types, TS 5.9, Vitest 4.1
- [x] [apps/api/package.json](file:///c:/Users/rahma/Desktop/dev/ozzyl-hms/apps/api/package.json) — all packages updated
- [x] [web/package.json](file:///c:/Users/rahma/Desktop/dev/ozzyl-hms/web/package.json) — Playwright 1.58, react-router 7.13, React 19, Tailwind v4
- [x] `pnpm install` — succeeded ✅

## Phase B — Major Upgrades
- [x] **Vitest v1→v4** (root config — no changes needed, already compatible)
- [x] **Vitest v2→v4** (apps/api — migrated `defineWorkersConfig` → `cloudflareTest()` plugin)
- [x] **Tailwind v3→v4** (CSS `@theme` + `@custom-variant dark`, deleted `tailwind.config.js` & `postcss.config.js`, inlined custom `@apply` refs)
- [x] **React 18→19** (already compatible; fixed `useRef()` → `useRef(undefined)` for `@types/react@19`)
- [x] **Workspace fix** (`pnpm-workspace.yaml`: `apps/*` → `apps/api` to exclude legacy duplicate `apps/web/`)
- [x] **Restored corrupted files** (`AppointmentScheduler.tsx`, `DigitalPrescription.tsx` — null-byte corruption)

## Verification
- [x] `pnpm install` — no peer dep errors ✅
- [x] `pnpm test` — 45 files, 1341 tests pass ✅
- [/] Emergency Dashboard — KPI stats, register patient, triage, finalize, search/filterl pass ✅
- [x] `npx tsc --noEmit` — type check passes ✅
- [x] `pnpm build` — tsc + vite + PWA all succeed ✅
- [x] **Adversarial review** — caught `@variant` → `@custom-variant` fix, re-verified ✅
