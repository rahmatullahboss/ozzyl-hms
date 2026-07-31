# P00 Planning Baseline — HMS Canonical Data Architecture

**Date:** 2026-07-13  
**Task:** CDB-001 — Freeze and verify the planning baseline  
**Workspace:** `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/reagent-stock-main-integration`  
**Workspace ID:** `ws_19c4cc122963f11e21c34e9d`  
**Program branch:** `feature/hms-canonical-data-architecture`
**Base branch:** `main` at `9985adb59`
**Production state:** Untouched

## Approved scope

The complete HMS data architecture is in scope: identity, patient, appointment/encounter, OPD, IPD, diagnostics, service catalog, billing, payments, deposits, refunds, practitioner compensation, pharmacy, inventory, expense, payroll, cash custody, accounting, reporting, and later local-server synchronization.

The implementation strategy is additive and phased:

```text
expand → shadow/dual-write → backfill → reconcile → cut over → observe → retire
```

No production migration, Cloudflare resource change, deployment, local-server activation, or application source-code implementation occurred while creating this planning baseline.

## Production context recorded from owner approval

- One hospital is currently live.
- Current production operation is cloud-only on Cloudflare D1.
- A local server exists but is currently disabled.
- The local server must remain disconnected until task CDB-110.
- A nightly full maintenance/read-only window is available.
- A full production export may be copied into an isolated, access-controlled staging D1 for rehearsal.
- Production mutation is not authorized in P00 or the read-only identity-inspection task CDB-010.

## Planning artifacts

| Artifact | SHA-256 |
|---|---|
| `docs/superpowers/specs/2026-07-13-hms-canonical-data-architecture-design.md` | `3869c6768a795054a3dc81b6720d0f0abe8af1b0433fc7e6c6ab8694ef260bd5` |
| `docs/superpowers/specs/2026-07-13-hms-canonical-data-architecture-spec.md` | `59d0a156ec07f5756edb6c27d07516cba443f47865eae85967c94d6477251408` |
| `docs/superpowers/plans/2026-07-13-hms-canonical-data-architecture-master-plan.md` | `9fba57ecc02ef14b9e17245514a4421530e9bcdf10ef008737b856e989d46673` |
| `docs/superpowers/plans/2026-07-13-hms-canonical-data-architecture-implementation-plan.md` | `c05a4b32aa7fa9b49fe075d4e9f7092cdc5fe8c8ae2689207d2bdfc36f83ec15` |
| `task-progress.yaml` | Living tracker; current state is committed separately after the initial planning commit |

Continuity files:

- `.ai-bridge/current-plan.md`
- `.ai-bridge/decisions.md`
- `.ai-bridge/open-questions.md`
- `.ai-bridge/execution-log.jsonl`
- `.ai-bridge/session-log.jsonl`

## Planning commit

Initial planning package commit: `172dda38` — `docs: plan canonical HMS data architecture`
Audit handoff commit: `9bc88b73` — `docs: hand off canonical database audit`

Both commits are preserved on `feature/hms-canonical-data-architecture`. After fetching origin, local `main` was aligned with `origin/main` at `9985adb59`; no commit was deleted or reverted.

## Verification performed

Command:

```bash
pnpm build:migrations
```

Result: **PASS**

Observed output:

- 432 conforming migrations were written to `src/data/schema-migrations.generated.ts`.
- The compressed migration manifest was generated.
- Nine pre-existing non-conforming utility/seed migration filenames were skipped by the existing manifest builder.
- No new migration was created and no database was contacted.

## Workspace isolation

The canonical planning package is preserved on `feature/hms-canonical-data-architecture` in the dedicated worktree. Every CDB task must branch from the current program branch and integrate back into it after review. The unrelated dirty workspace at `/Users/rahmatullahzisan/Desktop/Dev/hms` must remain untouched by all CDB tasks.

Expected planning changes are limited to:

- the four canonical design/spec/plan documents;
- `task-progress.yaml`;
- this P00 baseline;
- current `.ai-bridge` handoff, decisions, verification queue, and automatically appended session/execution logs.

## Safety gates carried forward

1. CDB-010 may identify production configuration but may not execute SQL or modify Cloudflare resources.
2. CDB-011 must prove production and staging database identities differ before export/import.
3. CDB-012 must establish actual live schema/data truth and classify every unexplained variance.
4. Canonical schema work may begin only after P01 clone and baseline gates pass.
5. Production financial cutover requires zero unexplained variance.
6. Ambiguous historical records must be placed in an exception registry; no agent may guess.
7. Legacy tables are not dropped in the first cutover wave.
8. Production cutover, destructive retirement, and local-server activation each require explicit owner authorization.

## Exact next task

CDB-001 is complete and the initial planning package is committed. The next unblocked task is:

**CDB-010 — Identify the live D1 database without mutation.**

CDB-010 must produce a redacted record of the exact production Wrangler environment, D1 binding, database name, database ID, account context, and deployed migration-manifest identity. It must not execute SQL, create a clone, apply a migration, or change a Cloudflare resource.
