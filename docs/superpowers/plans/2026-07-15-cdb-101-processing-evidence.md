# CDB-101 Processing Evidence Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a protected, offline, authorization-bound post-import processing evidence validator and require a clean result before the tenant-100 reporting shadow feature flag wrapper can start any external command.

**Architecture:** A standalone evidence module parses a strict protected JSON document, validates chronology and aggregate read-only observations, and exact-binds the pack to the existing schema-v2 reporting authorization. A thin CLI emits only an aggregate receipt. The feature-flag wrapper loads the same protected pack after the existing authorization/FK/maintenance/Worker gates and refuses before Wrangler unless `shadowFlagReady` is true.

**Tech Stack:** TypeScript, Node.js, Zod, Vitest, existing `protected-json-document` and `production-cutover-contract` modules.

## Global Constraints

- Work only on `task/cdb-101-processing-evidence` in `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/cdb-101-processing-evidence`.
- Base commit is `9e2c6c7810b47d9b62056c9fba4c20f168d0134c` from `feature/hms-canonical-data-architecture`.
- Do not modify the original dirty workspace.
- Do not query production or Cloudflare.
- Do not deploy, apply migrations, import data, mutate a feature flag, repair FK rows, export production, invoke Time Travel, push, or merge to `main`.
- Preserve the authoritative 17-blocker, 49-FK, zero-production-write state.
- Use RED-GREEN-REFACTOR and record the expected RED failure before implementation.
- The processing evidence is post-import/pre-shadow and must not gate migrations or import.
- The schema-v2 authorization shape and deterministic command-ID builders remain unchanged.
- Receipts are aggregate-only and omit paths, IDs, hashes, commands, raw output, credentials, PHI, and row-level data.

---

### Task 1: Add the failing evidence contract tests and fixture

**Files:**
- Create: `test/canonical/fixtures/reporting-processing-evidence-fixture.ts`
- Create: `test/canonical/reporting-processing-evidence.test.ts`

**Interfaces:**
- Consumes: `ReportingCutoverAuthorization`, `createReadyReportingAuthorization()`, existing protected-file test patterns.
- Produces: `PROCESSING_EVIDENCE_NOW`, `createReadyReportingProcessingEvidence()`, and the expected public API for the new evidence module.

- [x] **Step 1: Create the ready fixture**

Define `PROCESSING_EVIDENCE_NOW = '2026-07-14T16:25:00.000Z'` and return a `ReportingProcessingEvidence` with:

```ts
{
  schemaVersion: 1,
  authorizationId: authorization.authorizationId,
  evidenceId: 'cdb101-processing-evidence-20260715-01',
  generatedAtUtc: '2026-07-14T16:24:00.000Z',
  scope: {
    productionDatabaseId: authorization.productionDatabase.id,
    tenantId: '100',
    domain: 'reporting',
    stage: 'post_import_pre_shadow',
    migrationCommandId: authorization.migrations.commandId,
    importCommandId: authorization.productionImport.commandId,
    featureFlagCommandId: authorization.featureFlagPlan.commandId,
    featureFlagEffectiveAtUtc: authorization.featureFlagPlan.effectiveAtUtc,
    authorizationExpiresAtUtc: authorization.expiresAtUtc,
    deterministicRunId: authorization.productionImport.deterministicRunId,
    bundleSha256: authorization.productionImport.bundleSha256,
    manifestSha256: authorization.productionImport.manifestSha256,
    sourceExportSha256: authorization.productionImport.sourceExportSha256,
    allowedTables: [...authorization.productionImport.allowedTables],
    migrationsCompletedAtUtc: '2026-07-14T16:02:00.000Z',
    importCompletedAtUtc: '2026-07-14T16:10:00.000Z',
    secondPassCompletedAtUtc: '2026-07-14T16:15:00.000Z',
    observationStartedAtUtc: '2026-07-14T16:16:00.000Z',
    observationEndedAtUtc: '2026-07-14T16:24:00.000Z'
  },
  observedTableNames: [...authorization.productionImport.allowedTables],
  checks: PROCESSING_CHECK_IDS.map((checkId, index) => ({
    checkId,
    observedCount: 0,
    completedAtUtc: [
      '2026-07-14T16:17:00.000Z',
      '2026-07-14T16:18:00.000Z',
      '2026-07-14T16:19:00.000Z',
      '2026-07-14T16:20:00.000Z',
      '2026-07-14T16:21:00.000Z',
      '2026-07-14T16:22:00.000Z',
      '2026-07-14T16:23:00.000Z'
    ][index],
    evidenceId: `cdb101-processing-${checkId}-01`,
    evidenceSha256: ['1', '2', '3', '4', '5', '6', '7'][index].repeat(64)
  })),
  readOnlyProof: {
    queryCount: 14,
    allQueriesReadOnly: true,
    changedDbTrueCount: 0,
    rowsWritten: 0,
    writeStatementCount: 0,
    mutationCount: 0,
    evidenceId: 'cdb101-processing-read-only-01',
    evidenceSha256: 'f'.repeat(64)
  }
}
```

Use valid distinct hexadecimal hashes; do not reuse a hash.

- [x] **Step 2: Write tests for clean and non-clean audit evidence**

Assert:

```ts
expect(prepareReportingProcessingEvidence(ready, authorization, PROCESSING_EVIDENCE_NOW).receipt)
  .toMatchObject({
    documentReady: true,
    evidenceReady: true,
    authorizationBound: true,
    shadowFlagReady: true,
    checkCount: 7,
    unresolvedCriticalExceptionCount: 0,
    blockedOutboxCount: 0,
    blockedAccountingCount: 0,
    duplicatePublicIdCount: 0,
    unsafeIntegerCount: 0,
    tenantIsolationViolationCount: 0,
    secondPassInsertedRowCount: 0,
    aggregateOnly: true,
    networkRequestPerformed: false,
    productionMutationPerformed: false,
    externalCommandPerformed: false
  });
```

Clone the fixture, set `blocked_outbox` to `2`, and assert `evidenceReady: true`, `authorizationBound: true`, `shadowFlagReady: false`, and `blockedOutboxCount: 2`.

- [x] **Step 3: Write strict evidence validation tests**

Cover exact ordered check IDs, exact table coverage, safe counts, read-only proof, unique IDs/hashes, timestamps, chronology, sensitive fields, unknown fields, duplicate JSON keys, unsafe keys, size/depth limits, protected file modes, in-repository files, symlinks, and hard links.

Expected issue codes include:

```ts
'CDB101_PROCESSING_CHECK_SCOPE_INVALID'
'CDB101_PROCESSING_COUNT_INVALID'
'CDB101_PROCESSING_TABLE_SCOPE_INVALID'
'CDB101_PROCESSING_READ_ONLY_PROOF_INVALID'
'CDB101_PROCESSING_BINDING_INVALID'
'CDB101_PROCESSING_CHRONOLOGY_INVALID'
```

- [x] **Step 4: Write authorization-binding tests**

Mutate one field at a time and assert `authorizationBound: false` for:

```ts
authorizationId
productionDatabaseId
tenantId
domain
migrationCommandId
importCommandId
featureFlagCommandId
deterministicRunId
bundleSha256
manifestSha256
sourceExportSha256
allowedTables
featureFlagPlan.effectiveAtUtc
authorization expiry
```

- [x] **Step 5: Write CLI and redaction tests**

The positive protected CLI must emit a successful aggregate receipt. `--execute`, unknown, duplicate, positional, missing evidence, and missing authorization inputs must fail. Serialized receipts must not contain protected paths, authorization IDs, command IDs, evidence IDs, hashes, run IDs, or table names.

- [x] **Step 6: Write feature-flag zero-child refusal tests**

Run `set-production-canonical-flag.ts` with a fake `pnpm` child marker. Assert no child process for missing, mismatched, expired, or non-clean processing evidence. The wrapper argument contract must require:

```bash
--processing-evidence <protected-processing-evidence.json>
```

- [x] **Step 7: Run RED verification**

Run:

```bash
pnpm vitest run test/canonical/reporting-processing-evidence.test.ts
```

Expected: FAIL because `reporting-processing-evidence.ts`, its CLI, and the wrapper argument/gate do not exist yet. Record the exact failure count.

---

### Task 2: Implement the strict processing evidence module

**Files:**
- Create: `scripts/canonical/reporting-processing-evidence.ts`

**Interfaces:**
- Consumes: `prepareProtectedReportingCutoverAuthorization`, `validateReportingCutoverAuthorization`, `loadProtectedJsonDocument`, `parseStrictJsonDocument`, `containsNormalizedKey`.
- Produces:

```ts
export const CDB101_PROCESSING_CHECK_IDS: readonly [
  'unresolved_critical_exceptions',
  'blocked_outbox',
  'blocked_accounting',
  'duplicate_public_ids',
  'unsafe_integer_amounts',
  'tenant_isolation',
  'second_pass_new_rows'
];

export interface ReportingProcessingEvidence {
  schemaVersion: 1;
  authorizationId: string | null;
  evidenceId: string | null;
  generatedAtUtc: string | null;
  scope: {
    productionDatabaseId: string | null;
    tenantId: string | null;
    domain: string | null;
    stage: string | null;
    migrationCommandId: string | null;
    importCommandId: string | null;
    featureFlagCommandId: string | null;
    featureFlagEffectiveAtUtc: string | null;
    authorizationExpiresAtUtc: string | null;
    deterministicRunId: string | null;
    bundleSha256: string | null;
    manifestSha256: string | null;
    sourceExportSha256: string | null;
    allowedTables: string[];
    migrationsCompletedAtUtc: string | null;
    importCompletedAtUtc: string | null;
    secondPassCompletedAtUtc: string | null;
    observationStartedAtUtc: string | null;
    observationEndedAtUtc: string | null;
  };
  observedTableNames: string[];
  checks: Array<{
    checkId: string;
    observedCount: number | null;
    completedAtUtc: string | null;
    evidenceId: string | null;
    evidenceSha256: string | null;
  }>;
  readOnlyProof: {
    queryCount: number | null;
    allQueriesReadOnly: boolean;
    changedDbTrueCount: number | null;
    rowsWritten: number | null;
    writeStatementCount: number | null;
    mutationCount: number | null;
    evidenceId: string | null;
    evidenceSha256: string | null;
  };
}
export interface ReportingProcessingReceipt {
  schemaVersion: 1;
  documentReady: boolean;
  evidenceReady: boolean;
  authorizationBound: boolean;
  shadowFlagReady: boolean;
  issueCount: number;
  issueCodes: ReportingProcessingIssueCode[];
  checkCount: number;
  observedTableCount: number;
  queryCount: number;
  unresolvedCriticalExceptionCount: number;
  blockedOutboxCount: number;
  blockedAccountingCount: number;
  duplicatePublicIdCount: number;
  unsafeIntegerCount: number;
  tenantIsolationViolationCount: number;
  secondPassInsertedRowCount: number;
  aggregateOnly: true;
  networkRequestPerformed: false;
  productionMutationPerformed: false;
  externalCommandPerformed: false;
}
export function parseReportingProcessingEvidenceJson(text: string): ReportingProcessingDocumentResult;
export function prepareReportingProcessingEvidence(
  input: ReportingProcessingEvidence,
  authorization: ReportingCutoverAuthorization,
  atUtc?: string,
): PreparedReportingProcessingEvidence;
export function prepareProtectedReportingProcessingEvidenceForAuthorization(
  evidencePath: string,
  repositoryRoot: string,
  authorization: ReportingCutoverAuthorization,
  atUtc?: string,
): PreparedReportingProcessingEvidence;
export function prepareProtectedReportingProcessingEvidence(
  evidencePath: string,
  authorizationPath: string,
  repositoryRoot: string,
  atUtc?: string,
): PreparedReportingProcessingEvidence;
export function evaluateProtectedReportingProcessingEvidence(...): ReportingProcessingReceipt;
export function parseReportingProcessingEvidenceArgs(args: string[]): ReportingProcessingCliOptions;
```

- [x] **Step 1: Add strict Zod document schemas**

Use `.strict()` for the root and every nested object. Use nullable fields only where repository templates need fail-closed placeholders; ready evidence must require non-null valid values in semantic validation.

- [x] **Step 2: Add protected-document issue mapping and sensitive-key rejection**

Map shared protected JSON errors to `CDB101_PROCESSING_*` issue codes. Reject keys including credentials, headers, cookies, tokens, raw output/body, paths, patient/practitioner identities, and signed URLs.

- [x] **Step 3: Add semantic evidence validation**

Validate exact scope, ordered check registry, non-negative safe counts, exact table registry presence, read-only proof, unique IDs/hashes, and the chronology defined in the design.

Do not reject a document solely because a processing count is non-zero.

- [x] **Step 4: Add authorization binding**

Call `validateReportingCutoverAuthorization(authorization, atUtc)`. Compare every immutable scope field from the design. Require observation end no later than `featureFlagPlan.effectiveAtUtc` and validation no later than `expiresAtUtc`.

- [x] **Step 5: Build the aggregate receipt**

Set:

```ts
const evidenceReady = evidenceIssues.length === 0;
const authorizationBound = authorizationIssues.length === 0;
const allCountsZero = evidence.checks.every((item) => item.observedCount === 0);
const shadowFlagReady = evidenceReady && authorizationBound && allCountsZero;
```

Expose only counts and booleans.

- [x] **Step 6: Run focused tests**

Run:

```bash
pnpm vitest run test/canonical/reporting-processing-evidence.test.ts
```

Expected: module-level tests pass; CLI/wrapper tests may remain red until later tasks.

---

### Task 3: Add the offline CLI and package script

**Files:**
- Create: `scripts/canonical/validate-reporting-processing-evidence.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `parseReportingProcessingEvidenceArgs`, `evaluateProtectedReportingProcessingEvidence`.
- Produces: `canonical:validate-reporting-processing-evidence`.

- [x] **Step 1: Implement the CLI entry point**

Use:

```ts
const options = parseReportingProcessingEvidenceArgs(process.argv.slice(2));
const receipt = evaluateProtectedReportingProcessingEvidence(
  options.evidencePath,
  options.authorizationPath,
  process.cwd(),
  options.atUtc,
);
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
process.exitCode = receipt.shadowFlagReady ? 0 : 2;
```

Catch argument errors, write a bounded `CDB-101 processing evidence validation failed: ...` message to stderr, and exit `1`.

- [x] **Step 2: Register the package script**

Add:

```json
"canonical:validate-reporting-processing-evidence": "tsx scripts/canonical/validate-reporting-processing-evidence.ts"
```

- [x] **Step 3: Run CLI-focused tests**

Run the focused test file and confirm positive status `0`, valid non-clean status `2`, and refusal status `1`.

---

### Task 4: Gate the production shadow flag wrapper

**Files:**
- Modify: `scripts/canonical/set-production-canonical-flag.ts`
- Modify: `scripts/canonical/reporting-cutover-operations.ts`
- Modify: `scripts/canonical/production-cutover-contract.ts`
- Test: `test/canonical/reporting-processing-evidence.test.ts`
- Test: `test/canonical/production-cutover-contract.test.ts`

**Interfaces:**
- Consumes: `prepareProtectedReportingProcessingEvidenceForAuthorization`.
- Produces: required `processingEvidencePath` in `ProductionReportingFlagCliOptions`.

- [x] **Step 1: Extend exact CLI parsing**

Add `--processing-evidence` to the accepted argument set, reject duplicates consistently, and include it in the required-input error.

- [x] **Step 2: Add the pre-request gate**

After the Worker build/version evidence gate and before `runWrangler(['d1', 'info', ...])`, call:

```ts
const processingPreflight = prepareProtectedReportingProcessingEvidenceForAuthorization(
  options.processingEvidencePath,
  process.cwd(),
  authorization,
  authorizationCheckedAtUtc,
);
if (!processingPreflight.receipt.shadowFlagReady) {
  process.stdout.write(`${JSON.stringify(processingPreflight.receipt, null, 2)}\n`);
  process.exitCode = 2;
  return;
}
```

- [x] **Step 3: Run zero-child tests**

Assert fake `pnpm` is never invoked for every invalid processing-evidence case.

- [x] **Step 4: Run related existing tests**

Run:

```bash
pnpm vitest run \
  test/canonical/reporting-processing-evidence.test.ts \
  test/canonical/reporting-worker-build-version-evidence.test.ts \
  test/canonical/reporting-maintenance-recovery-evidence.test.ts \
  test/canonical/reporting-fk-disposition-evidence.test.ts \
  test/canonical/production-cutover-contract.test.ts
```

Update existing wrapper command fixtures to supply the new required argument without weakening their original refusal assertions.

---

### Task 5: Add fail-closed templates and operational documentation

**Files:**
- Create: `docs/database/migration-runs/production/CDB-101-reporting-processing-evidence-template.json`
- Create: `docs/database/migration-runs/production/CDB-101-reporting-processing-evidence.md`
- Modify: `docs/database/migration-runs/production/CDB-101-reporting-operational-readiness.md`
- Modify: `docs/database/migration-runs/production/CDB-101-reporting-execution-evidence-template.json`

**Interfaces:**
- Produces: exact operator-facing protected evidence contract and future invocation shape.

- [x] **Step 1: Add the repository template**

Use every exact schema key, preserve the ordered check registry, and use `null`, `false`, zero, or empty arrays so the template parses but is never `evidenceReady` or `shadowFlagReady`.

- [x] **Step 2: Add the operator report**

Document the post-import/pre-shadow boundary, protected modes, offline command, chronology, all seven zero-count requirements, receipt semantics, and the fact that no live evidence was captured.

- [x] **Step 3: Update operational readiness**

Add the new scripts/template to prepared tooling, add `--processing-evidence` to the future flag command, update the pre-request order, and replace the processing blocker action with the exact protected evidence command.

- [x] **Step 4: Update execution evidence template**

Add a `processingEvidence` section with fail-closed placeholders for evidence readiness, authorization binding, shadow-flag readiness, check counts, table coverage, and the seven aggregate findings. Do not include protected IDs, hashes, or paths in the aggregate execution receipt section.

- [x] **Step 5: Validate JSON**

Run:

```bash
node -e "JSON.parse(require('node:fs').readFileSync('docs/database/migration-runs/production/CDB-101-reporting-processing-evidence-template.json','utf8')); JSON.parse(require('node:fs').readFileSync('docs/database/migration-runs/production/CDB-101-reporting-execution-evidence-template.json','utf8')); console.log('json templates parsed')"
```

Expected: `json templates parsed`.

---

### Task 6: Review, verify, and prepare integration

**Files:**
- Modify checklist status in this plan.
- Update task-owned evidence/report files only before merge.

**Interfaces:**
- Produces: clean task commit ready for serial program-branch integration.

- [x] **Step 1: Perform adversarial review**

Check specifically for:

- circular migration/import dependency;
- evidence substitution across authorization/import runs;
- non-zero evidence incorrectly marked ready for flag execution;
- authorization expiry bypass;
- table/check reordering acceptance;
- receipt leakage;
- child process starting before the new gate;
- existing wrapper tests silently weakened.

Add a failing regression test before any review fix.

- [x] **Step 2: Run focused verification**

```bash
pnpm vitest run test/canonical/reporting-processing-evidence.test.ts
```

Expected: all processing tests pass.

- [x] **Step 3: Run full canonical verification**

```bash
pnpm vitest run test/canonical/
pnpm exec tsc --noEmit
pnpm canonical:check
pnpm build:migrations
```

Expected: zero failures, zero TypeScript errors, zero governance issues, and migration manifest remains `443`.

- [x] **Step 4: Run manual protected CLI matrix**

Using synthetic mode-`700`/`600` files outside the repository, verify:

- clean pack: exit `0`, `shadowFlagReady: true`;
- valid non-clean pack: exit `2`, `evidenceReady: true`, `authorizationBound: true`, `shadowFlagReady: false`;
- insecure evidence or authorization file: exit `2`;
- `--execute`: exit `1`;
- no network, production mutation, or external command flags.

Remove temporary artifacts after verification.

- [x] **Step 5: Review diff and commit**

Run `git diff --check`, inspect the complete diff, then commit with:

```bash
git add \
  scripts/canonical/reporting-processing-evidence.ts \
  scripts/canonical/validate-reporting-processing-evidence.ts \
  scripts/canonical/set-production-canonical-flag.ts \
  scripts/canonical/reporting-cutover-operations.ts \
  scripts/canonical/production-cutover-contract.ts \
  test/canonical/reporting-processing-evidence.test.ts \
  test/canonical/fixtures/reporting-processing-evidence-fixture.ts \
  test/canonical/production-cutover-contract.test.ts \
  test/canonical/reporting-authorization-document.test.ts \
  test/canonical/reporting-fk-disposition-evidence.test.ts \
  test/canonical/reporting-maintenance-recovery-evidence.test.ts \
  test/canonical/reporting-worker-build-version-evidence.test.ts \
  docs/database/migration-runs/production/CDB-101-reporting-processing-evidence-template.json \
  docs/database/migration-runs/production/CDB-101-reporting-processing-evidence.md \
  docs/database/migration-runs/production/CDB-101-reporting-operational-readiness.md \
  docs/database/migration-runs/production/CDB-101-reporting-execution-evidence-template.json \
  docs/superpowers/specs/2026-07-15-cdb-101-processing-evidence-design.md \
  docs/superpowers/plans/2026-07-15-cdb-101-processing-evidence.md \
  package.json

git commit -m "feat(canonical): gate reporting shadow on processing evidence"
```

- [x] **Step 6: Integrate only into the program branch**

Acquire `/Users/rahmatullahzisan/Desktop/Dev/hms/.git/ozzyl-main-merge.lock`, merge with `--no-ff` into `feature/hms-canonical-data-architecture`, rerun focused/TypeScript/governance verification, update shared trackers in a separate evidence commit, release the lock, remove the task worktree, prune, and delete the merged task branch.

Do not push or merge to `main`.
