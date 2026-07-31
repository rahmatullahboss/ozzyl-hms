# CDB-101 Night-0 Preparation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Produce a fully reviewed, offline Night-0 reporting cutover candidate against latest `origin/main`, including a deterministic tenant-100 canonical import bundle, record-level FK repair/waiver preparation, a computable schema-v2 authorization draft, and an aggregate Go/No-Go sheet without any production mutation.

**Architecture:** Work in the isolated `task/cdb-101-night0-preparation-20260715` worktree. Merge the fetched `origin/main` into the canonical program candidate, preserve canonical safety contracts, add a deterministic SQLite-to-DML bundle builder and protected Night-0 package orchestrator, harden the importer with a real idempotent second pass, generate protected artifacts outside Git, and commit only aggregate non-PHI evidence and runbooks.

**Tech Stack:** TypeScript, Node.js `node:sqlite`, Zod, Vitest, Git, Wrangler dry-run, existing canonical authorization/import/evidence contracts.

## Global Constraints

- Production/Cloudflare writes, deployment, migration apply, import, feature-flag mutation, FK repair, export upload, restore, traffic assignment, push, and `main` merge are prohibited.
- Read-only production inspection is allowed; every command must remain aggregate-only and report `changed_db=false`, `rows_written=0` where applicable.
- Original dirty workspace `/Users/rahmatullahzisan/Desktop/Dev/hms` and program-worktree `.ai-bridge/execution-log.jsonl` / `.ai-bridge/session-log.jsonl` modifications remain untouched.
- Protected data-bearing artifacts live only under `<protected-night0-root>`, directory mode `700`, file mode `600`, outside Git.
- Repository artifacts must contain no row identifiers, patient/practitioner identities, raw production rows, SQL repair statements, credentials, tokens, cookies, protected local paths, or PHI.
- Tenant scope is exactly `100`; import table scope is exactly `CDB101_REPORTING_IMPORT_TABLES` in its declared order.
- Production canonical bundle is DML-only, one-row `INSERT OR IGNORE ... VALUES` statements, exact literal `tenant_id='100'`, no SELECT/DDL/PRAGMA/DELETE/REPLACE/UPSERT.
- Authorization remains fail-closed: owner/external fields remain false/null until separately approved; no generated draft constitutes authorization.
- Use RED-GREEN-REFACTOR for every behavior change and fresh verification before each completion or integration claim.

---

### Task 1: Integrate latest origin/main into the isolated candidate

**Files:**
- Modify only conflict-resolved files produced by `git merge origin/main`.
- Create: `docs/database/migration-runs/production/CDB-101-night0-main-integration-review-20260715.md`

**Interfaces:**
- Consumes: program commit `88002c7079439c2a18bed875bf89000f83e9efbf`, fetched `origin/main`.
- Produces: one clean candidate commit containing canonical program changes plus the 63 fetched main commits.

- [x] **Step 1: Record exact merge bases and changed-file overlap**

Run:

```bash
git rev-list --left-right --count HEAD...origin/main
git merge-base HEAD origin/main
git diff --name-only HEAD...origin/main
```

Expected pre-merge divergence: `142 63`.

- [x] **Step 2: Merge without committing**

Run:

```bash
git merge --no-ff --no-commit origin/main
```

If conflicts occur, resolve each by preserving both latest main behavior and canonical safety invariants. Never accept wholesale `ours`/`theirs` for canonical authorization, migration, billing, reporting, or routing files.

- [x] **Step 3: Run conflict-focused checks**

Run `git diff --check`, canonical tests, TypeScript, governance, and migration build. Record exact changed/conflicted files and the chosen resolution in the integration review.

- [x] **Step 4: Commit the integration candidate**

```bash
git commit -m "merge(night0): integrate latest origin main"
```

---

### Task 2: Harden production import SQL parsing and real second pass

**Files:**
- Modify: `scripts/canonical/production-cutover-contract.ts`
- Modify: `scripts/canonical/import-production-canonical-bundle.ts`
- Modify: `test/canonical/production-cutover-contract.test.ts`
- Create: `test/canonical/production-import-second-pass.test.ts`

**Interfaces:**
- Produces: quote-aware one-row INSERT parser and `verifyCanonicalImportSecondPassOutput(text: string): void`.
- Import wrapper executes the same authorized idempotent bundle twice and refuses unless the second execution proves zero rows written.

- [x] **Step 1: Write failing parser tests**

Add tests proving a valid INSERT containing `)` and commas inside quoted text passes, while multi-row VALUES, SELECT, UPSERT, tenant drift, and trailing SQL fail.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm vitest run test/canonical/production-cutover-contract.test.ts
```

Expected: quoted-parenthesis INSERT currently fails due regex parsing.

- [x] **Step 3: Implement quote-aware INSERT parsing**

Replace the single regex tuple extraction with balanced, quote-aware helpers that parse exactly one column tuple and one value tuple, then require only optional semicolon/whitespace after the statement.

- [x] **Step 4: Write failing second-pass tests**

Test accepted Wrangler JSON only when every envelope reports `rows_written=0` and `changed_db=false`; reject any positive writes, malformed JSON, or missing metadata. Add a fake-Wrangler wrapper test proving the bundle command runs twice before read-only row-count verification.

- [x] **Step 5: Implement and verify second pass**

After the first successful import, execute the same command again, call `verifyCanonicalImportSecondPassOutput`, then run the existing row-count verification. Output `secondPassCompleted=true`, `secondPassChangedDb=false`, `secondPassRowsWritten=0` only after proof.

---

### Task 3: Build deterministic tenant-100 canonical DML bundle

**Files:**
- Create: `scripts/canonical/build-production-canonical-bundle.ts`
- Create: `test/canonical/production-canonical-bundle-builder.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes:
  - protected read-only SQLite source;
  - protected source-export SQL file;
  - exact authorization ID;
  - exact deterministic run ID;
  - exact output directory.
- Produces:
  - `tenant-100-canonical-import.sql`;
  - `tenant-100-canonical-import-manifest.json` matching `ProductionCanonicalImportManifest`;
  - aggregate receipt with hashes/counts and no local paths or row data.

- [x] **Step 1: Write failing builder tests**

Use a temporary SQLite fixture with allowed tables, tenant `100` and another tenant, text containing quotes/commas/parentheses/newlines, nulls, integers, reals, and blobs. Assert exact tenant filtering, declared table order, deterministic primary-key order, explicit columns, safe SQL literals, `INSERT OR IGNORE`, exact row counts, valid bundle SQL, and identical bytes across two runs with identical inputs.

- [x] **Step 2: Verify RED**

```bash
pnpm vitest run test/canonical/production-canonical-bundle-builder.test.ts
```

Expected: module missing.

- [x] **Step 3: Implement builder**

Use `DatabaseSync` opened read-only. Validate exact source tables and `tenant_id` columns. Read `pragma_table_info`, order rows by declared primary-key columns (fallback `rowid`), serialize SQLite values without lossy conversion, and render one-row INSERT statements. Hash bundle and source export, derive a stable run ID when requested, write mode-600 files atomically in a mode-700 directory, and refuse overwrite/symlink/hard-link/inside-repository paths.

- [x] **Step 4: Validate generated artifacts offline**

Parse the manifest and call `validateCanonicalImportBundleSql`. Apply migrations `0423`-`0433` to an empty temporary SQLite DB, apply the bundle twice, and prove first-pass row counts match and second-pass inserts equal zero.

- [x] **Step 5: Register CLI**

Add:

```json
"canonical:build-production-bundle": "tsx scripts/canonical/build-production-canonical-bundle.ts"
```

The CLI refuses `--execute` and performs no network action.

---

### Task 4: Build protected FK preparation package

**Files:**
- Create/extend inside: `scripts/canonical/prepare-reporting-night0.ts`
- Test: `test/canonical/reporting-night0-preparation.test.ts`

**Interfaces:**
- Consumes protected legacy source SQLite and repository root.
- Produces protected:
  - `active-fk-repair-plan.json` with exact row keys and guarded repair SQL;
  - `archival-fk-waiver-candidate.json` with static no-writer/import/reporting attestations;
  - aggregate receipt only.

- [x] **Step 1: Write failing active-FK tests**

Fixture four `billing_deposits -> bills` and four `income -> bills` orphans. Require exact counts, no exact replacement candidate, nullable-FK strategy `clear_orphan_reference_preserve_row`, guarded SQL predicates binding row ID, tenant ID, and original orphan reference, `hardDelete=false`, and expected remaining count zero after planned execution.

- [x] **Step 2: Write failing archival tests**

Require exact aggregate groups `26` and `15`, `_old_0391` archival naming, exclusion from `CDB101_REPORTING_IMPORT_TABLES`, zero runtime writer matches, zero canonical reporting query matches, removal phase `legacy_retirement_p11`, and `approved=false` pending owner approval.

- [x] **Step 3: Implement protected package**

Read the source DB strictly read-only, write row-level details only outside Git, emit no row IDs/SQL in stdout, and refuse if observed counts differ from `4/4/26/15` or an exact replacement candidate creates ambiguity requiring manual review.

---

### Task 5: Generate candidate/build evidence and authorization draft

**Files:**
- Continue: `scripts/canonical/prepare-reporting-night0.ts`
- Test: `test/canonical/reporting-night0-preparation.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces protected:
  - `candidate-build-manifest.json`;
  - `reporting-authorization-candidate.json` exact schema v2;
  - `night0-go-no-go.json` protected detailed form;
- Produces aggregate repository Go/No-Go JSON separately in Task 6.

- [x] **Step 1: Write failing candidate tests**

Require clean full 40-character candidate commit, exact migration manifest SHA-256, dry-run Worker bundle SHA-256, repository route fingerprint, import bundle/manifest/source-export hashes, deterministic run ID, and exact 24-table counts.

- [x] **Step 2: Write failing authorization-draft tests**

Require every computable field populated while all approval/live fields remain false/null: no owner approval, no candidate Worker version, no authenticated route evidence, no maintenance window, no fresh export/bookmark, no FK completion/approval, no mutation authorization, and command IDs null because immutable external inputs are incomplete.

- [x] **Step 3: Implement orchestrator**

The CLI accepts explicit protected input/output paths and candidate metadata, calls the bundle/FK builders, creates the exact schema-v2 draft, validates it structurally, runs semantic evaluation expecting fail-closed, and emits an aggregate receipt with no protected path or row data.

- [x] **Step 4: Register CLI**

```json
"canonical:prepare-reporting-night0": "tsx scripts/canonical/prepare-reporting-night0.ts"
```

Reject `--execute`; no network or production mutation.

---

### Task 6: Build and execute the Night-0 candidate package

**Files:**
- Create protected artifacts outside Git.
- Create: `docs/database/migration-runs/production/CDB-101-night0-preparation-20260715.md`
- Create: `docs/database/migration-runs/production/CDB-101-night0-go-no-go-20260715.json`
- Modify: `docs/database/migration-runs/production/CDB-101-reporting-operational-readiness.md`

**Interfaces:**
- Protected source canonical DB: `<protected-canonical-source.sqlite>`.
- Protected legacy source DB: `<protected-legacy-source.sqlite>`.
- Protected source export: `<protected-source-export.sql>`.
- Protected output directory: `<protected-night0-root>`.

- [x] **Step 1: Run full build and Worker dry-run**

Run `pnpm build`, then `pnpm exec wrangler deploy --dry-run --outdir <protected-dir>/worker-dry-run`. Hash deterministic build outputs and create the candidate build manifest. No upload/deploy.

- [x] **Step 2: Generate protected Night-0 artifacts**

Run `canonical:prepare-reporting-night0` with explicit source DB/export/output paths and the frozen candidate commit. Validate modes, hashes, exact row counts, bundle SQL, second-pass rehearsal, authorization structure, FK counts, and fail-closed semantic receipt.

- [x] **Step 3: Run fresh read-only production inspection**

Run `canonical:inspect-production`, `canonical:preflight-reporting`, migration list, D1 identity, enabled reporting flag count, and manifest-object lookup only. Record aggregate results; assert no changed DB and no rows written.

- [x] **Step 4: Create aggregate reports**

Commit only candidate commit/hashes, test/build outcomes, aggregate row counts, prepared/not-prepared gate booleans, authoritative production counts, and `decision=no_go`. Omit protected paths, row keys, SQL, owner IDs, evidence IDs, and PHI.

---

### Task 7: Adversarial review and final verification

**Files:**
- All task-owned files.

- [x] **Step 1: Review attack list**

Check merge regression, cross-tenant leakage, SQL literal/parser escapes, non-determinism, table-order drift, missing/extra columns, source mutation, symlink/hard-link/overwrite, bundle comments/DDL/SELECT, second-pass false proof, FK auto-remap without exact evidence, archival writer false-negative, authorization accidentally enabled, protected data leakage, and child/network/production mutation paths.

- [x] **Step 2: Add RED regressions for every finding**

No review fix without a failing regression first.

- [x] **Step 3: Fresh verification**

Run:

```bash
pnpm vitest run test/canonical/
pnpm exec tsc --noEmit
pnpm canonical:check
pnpm build:migrations
pnpm build
```

Also run protected CLI positive/refusal matrix, `git diff --check`, JSON/YAML parse assertions, repository secret/PHI/path scan, and planner/preflight fail-closed assertions.

- [x] **Step 4: Commit and integrate only to the program branch**

Commit task changes, acquire `/Users/rahmatullahzisan/Desktop/Dev/hms/.git/ozzyl-main-merge.lock`, merge `--no-ff` into `feature/hms-canonical-data-architecture`, rerun focused/full required checks, update shared trackers in a separate evidence commit, release lock, remove worktree, prune, and delete task branch. Do not push or merge to `main`.
