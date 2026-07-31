# Canonical Admission Deposit Atomic Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make reception admission deposit collection commit the conditional legacy admission and the canonical deposit in one strict D1 batch with fail-closed row-count assertions.

**Architecture:** Add a generic ephemeral canonical financial batch assertion table and helper. Refactor `POST /reception/admit-with-deposit` so each critical legacy statement is immediately guarded by SQLite `changes()`, then pass the same ordered statements to the existing `recordDeposit` command through `executeStrictFinancialMutation`. Keep cash-ledger shadowing, audit and accounting queueing post-commit and best-effort.

**Tech Stack:** TypeScript, Hono, Cloudflare D1/SQLite, Vitest, canonical command batch/outbox infrastructure, pnpm.

## Global Constraints

- Base local main is `dbfcd41d068741003770612bd7fbcdecfdce5877`.
- Work only in `fix/canonical-admission-deposit-atomic-20260723` and its isolated worktree.
- Do not overwrite or discard any other worktree changes.
- Do not deploy, apply migrations, run production backfills, change feature flags, move traffic or mutate tenant data.
- Preserve admission-without-deposit as a legacy-only path.
- Preserve paid bill and existing deposit command semantics.
- Use TDD for every implementation checkpoint.
- Normal checkpoint commits are not stop points.

---

### Task 1: Generic financial batch assertion infrastructure

**Files:**
- Create: `migrations/0532_canonical_financial_batch_assertions.sql`
- Create: `src/lib/canonical/financial-batch-assertion.ts`
- Create: `test/canonical/financial-batch-assertion.test.ts`

**Interfaces:**
- Consumes: `CanonicalBatchDatabase` and `CanonicalPreparedStatement` from `src/lib/canonical/command-batch.ts`.
- Produces:
  - `prepareFinancialBatchAssertion(db, input): CanonicalPreparedStatement`
  - `prepareClearFinancialBatchAssertions(db, tenantId, operationKey): CanonicalPreparedStatement`
  - `isFinancialBatchAssertionError(error): boolean`

- [ ] **Step 1: Write the failing migration/helper tests**

Create an in-memory SQLite adapter and tests that apply migration 0532, then prove:

```ts
const statements = [
  db.prepare(`INSERT INTO target_rows (value) VALUES ('created')`),
  prepareFinancialBatchAssertion(db, {
    tenantId: 'tenant-a',
    operationKey: 'admission:ADM-1',
    stepKey: 'admission_insert',
    expectedChanges: 1,
  }),
  prepareClearFinancialBatchAssertions(db, 'tenant-a', 'admission:ADM-1'),
];
await db.batch(statements);
expect(count(sqlite, 'target_rows')).toBe(1);
expect(count(sqlite, 'canonical_financial_batch_assertions')).toBe(0);
```

Add a failure test where one insert is followed by `expectedChanges: 2`; expect the CHECK constraint to reject and the transaction to leave both tables empty. Add validation tests for negative/non-integer expected counts and recursive detection through an error `cause` chain.

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
pnpm exec vitest run test/canonical/financial-batch-assertion.test.ts
```

Expected: FAIL because migration 0532 and `financial-batch-assertion.ts` do not exist.

- [ ] **Step 3: Add migration 0532**

Create:

```sql
CREATE TABLE IF NOT EXISTS canonical_financial_batch_assertions (
  tenant_id TEXT NOT NULL,
  operation_key TEXT NOT NULL CHECK (length(trim(operation_key)) > 0),
  step_key TEXT NOT NULL CHECK (length(trim(step_key)) > 0),
  assertion_value INTEGER NOT NULL CHECK (assertion_value = 1),
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (tenant_id, operation_key, step_key)
);

CREATE INDEX IF NOT EXISTS idx_canonical_financial_batch_assertions_created
  ON canonical_financial_batch_assertions(tenant_id, created_at_utc);
```

- [ ] **Step 4: Implement the helper**

Implement exact identifier validation, non-negative integer validation and:

```ts
export function prepareFinancialBatchAssertion(
  db: CanonicalBatchDatabase,
  input: FinancialBatchAssertionInput,
): CanonicalPreparedStatement {
  const expectedChanges = nonNegativeInteger(input.expectedChanges, 'expectedChanges');
  return db.prepare(`
    INSERT INTO canonical_financial_batch_assertions (
      tenant_id,operation_key,step_key,assertion_value
    ) VALUES (?,?,?,CASE WHEN changes()=? THEN 1 ELSE 0 END)
  `).bind(
    exact(input.tenantId, 'tenantId'),
    exact(input.operationKey, 'operationKey'),
    exact(input.stepKey, 'stepKey'),
    expectedChanges,
  );
}
```

Cleanup must delete only the exact tenant and operation key. Error detection must walk up to eight nested `cause` objects and match `canonical_financial_batch_assertions` or `assertion_value` without exposing SQL to callers.

- [ ] **Step 5: Run tests to verify GREEN**

Run:

```bash
pnpm exec vitest run test/canonical/financial-batch-assertion.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Run migration and governance checks**

Run:

```bash
pnpm build:migrations
pnpm canonical:check
```

Expected: migration manifest includes 0532 and governance reports zero issues.

- [ ] **Step 7: Commit**

```bash
git add migrations/0532_canonical_financial_batch_assertions.sql \
  src/lib/canonical/financial-batch-assertion.ts \
  test/canonical/financial-batch-assertion.test.ts
git commit -m "feat(canonical): add financial batch assertions"
```

---

### Task 2: Prove admission and deposit atomicity at command-batch level

**Files:**
- Create: `test/canonical/admission-deposit-atomic.test.ts`
- Read: `src/lib/canonical/commands/apply-deposit.ts`
- Read: `src/lib/canonical/live-financial-projection.ts`

**Interfaces:**
- Consumes: Task 1 assertion helpers, `buildLiveDepositProjection`, `recordDeposit`.
- Produces: executable proof that authoritative legacy statements and canonical deposit writes roll back together.

- [ ] **Step 1: Write the failing strict atomic success test**

Create a SQLite harness applying canonical migrations `0505` through `0515` plus `0532`, and minimal legacy tables:

```sql
CREATE TABLE admissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  admission_no TEXT NOT NULL,
  patient_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'admitted',
  UNIQUE(tenant_id, admission_no)
);
CREATE TABLE billing_deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  patient_id INTEGER NOT NULL,
  admission_id INTEGER NOT NULL,
  deposit_receipt_no TEXT NOT NULL,
  amount REAL NOT NULL
);
```

Build authoritative statements in exact order:

```ts
const authoritativeStatements = [
  db.prepare(`
    INSERT INTO admissions (tenant_id,admission_no,patient_id)
    SELECT 'tenant-a','ADM-1',101
    WHERE NOT EXISTS (
      SELECT 1 FROM admissions
      WHERE tenant_id='tenant-a' AND patient_id=101 AND status='admitted'
    )
  `),
  prepareFinancialBatchAssertion(db, {
    tenantId: 'tenant-a', operationKey: 'ADM-1:DEP-1',
    stepKey: 'admission_insert', expectedChanges: 1,
  }),
  db.prepare(`
    INSERT INTO billing_deposits (
      tenant_id,patient_id,admission_id,deposit_receipt_no,amount
    )
    SELECT tenant_id,patient_id,id,'DEP-1',300
    FROM admissions WHERE tenant_id='tenant-a' AND admission_no='ADM-1'
  `),
  prepareFinancialBatchAssertion(db, {
    tenantId: 'tenant-a', operationKey: 'ADM-1:DEP-1',
    stepKey: 'deposit_insert', expectedChanges: 1,
  }),
  prepareClearFinancialBatchAssertions(db, 'tenant-a', 'ADM-1:DEP-1'),
];
```

Call `recordDeposit` with deterministic projection and `{ authoritativeStatements }`. Assert one admission, one legacy deposit, one canonical receipt, one tender, one canonical deposit, one source mapping and one outbox event.

- [ ] **Step 2: Run the success test**

Run:

```bash
pnpm exec vitest run test/canonical/admission-deposit-atomic.test.ts
```

Expected: PASS if Task 1 infrastructure composes correctly; fix only harness/schema mismatches, not production code.

- [ ] **Step 3: Add duplicate-admission rollback test**

Seed an existing active admission for patient 101, execute the same command with a new admission/deposit identity and expect rejection. Assert zero rows for the attempted admission/deposit and zero new canonical receipt, tender, deposit, mapping or outbox rows.

- [ ] **Step 4: Add bed-loss rollback test**

Extend the harness with `beds` and `patient_bed_infos`. Seed an occupied bed, make the conditional admission claim require `status='available'`, guard the admission/bed steps and assert the entire command leaves no attempted legacy or canonical rows.

- [ ] **Step 5: Run atomic tests**

```bash
pnpm exec vitest run \
  test/canonical/financial-batch-assertion.test.ts \
  test/canonical/admission-deposit-atomic.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add test/canonical/admission-deposit-atomic.test.ts
git commit -m "test(canonical): prove atomic admission deposits"
```

---

### Task 3: Refactor reception admission deposit into one strict mutation

**Files:**
- Modify: `src/routes/tenant/reception.ts:1242-1598`
- Modify: `src/lib/canonical/financial-route-coverage.ts:77-84`
- Modify: `test/integration/routes/tenant-100-strict-financial.test.ts:77-89`
- Modify: `test/reception-admit-idempotency.test.ts`
- Create: `test/integration/routes/reception-admission-deposit-atomic.test.ts`

**Interfaces:**
- Consumes: assertion helpers, `executeStrictFinancialMutation`, `buildLiveDepositProjection`, `recordDeposit`.
- Produces: integrated boundary `reception.admission.deposit.collect` with canonical command `recordDeposit`.

- [ ] **Step 1: Write RED route contract tests**

Assert the admission-deposit function contains:

```ts
expect(flow).toContain("boundary: 'reception.admission.deposit.collect'");
expect(flow).toContain('prepareFinancialBatchAssertion');
expect(flow).toContain('prepareClearFinancialBatchAssertions');
expect(flow).toContain('legacyStatements: statements');
expect(flow).toMatch(/executeStrictFinancialMutation[\s\S]*recordDeposit/);
expect(flow).not.toContain('legacyStatements: []');
```

Assert the route places `executeStrictFinancialMutation` before `shadowCreateCashLedgerEntry`, includes `coreCommitted`, catches cash-ledger shadow failure, and includes admission-fee provisional insertion before the strict mutation.

Update the registry expectation to:

```ts
expect(FINANCIAL_ROUTE_COVERAGE['reception.admission.deposit.collect']).toMatchObject({
  status: 'integrated',
  routeFile: 'src/routes/tenant/reception.ts',
  canonicalCommand: 'recordDeposit',
});
```

- [ ] **Step 2: Run route contract tests to verify RED**

```bash
pnpm exec vitest run \
  test/integration/routes/reception-admission-deposit-atomic.test.ts \
  test/integration/routes/tenant-100-strict-financial.test.ts \
  test/reception-admit-idempotency.test.ts
```

Expected: FAIL because the route still performs a legacy batch followed by `legacyStatements: []` canonical projection and the registry is blocked.

- [ ] **Step 3: Add helper imports and build ordered guarded statements**

Import:

```ts
import {
  isFinancialBatchAssertionError,
  prepareClearFinancialBatchAssertions,
  prepareFinancialBatchAssertion,
} from '../../lib/canonical/financial-batch-assertion';
```

For positive deposits set:

```ts
const financialOperationKey = `reception-admission-deposit:${admissionNo}:${receiptNo}`;
```

Immediately append an assertion after every critical insert/update. Change the bed update to include `AND status = 'available'`. Move the optional `billing_provisional_items` admission-fee insert into the ordered statements and guard it when the financial operation key exists. Append the exact assertion cleanup last.

- [ ] **Step 4: Replace split execution with one coordinator call**

Use:

```ts
let coreCommitted = false;
if (data.depositAmount > 0 && receiptNo && activeCounter && depositCollectedAtUtc) {
  await executeStrictFinancialMutation({
    db: c.env.DB,
    tenantId: String(tenantId),
    boundary: 'reception.admission.deposit.collect',
    legacyStatements: statements,
    canonical: async (options) => {
      const tenderType = canonicalAdmissionDepositTenderType(data.paymentMethod);
      const canonicalInput = await buildLiveDepositProjection({
        tenantId: String(tenantId),
        depositNo: receiptNo,
        patientId: data.patientId,
        amount: data.depositAmount,
        tenderType,
        methodCode: String(data.paymentMethod || tenderType),
        collectedAtUtc: depositCollectedAtUtc,
      });
      return recordDeposit(c.env.DB, canonicalInput, options);
    },
  });
} else {
  await c.env.DB.batch(statements);
}
coreCommitted = true;
```

Delete the old `await c.env.DB.batch(statements)` plus post-commit `executeStrictFinancialMutation({ legacyStatements: [] })` block.

- [ ] **Step 5: Map assertion failures safely**

In the catch block, before idempotency failure handling:

```ts
if (isFinancialBatchAssertionError(error)) {
  const duplicateAdmission = await loadActiveAdmission(...);
  if (duplicateAdmission) throw new HTTPException(409, ...);
  if (data.bedId) {
    const latestBed = await loadBed(...);
    if (!latestBed) throw new HTTPException(404, ...);
    if (latestBed.status !== 'available') throw new HTTPException(409, ...);
  }
  throw new HTTPException(409, {
    message: 'Admission or deposit state changed. Refresh and try again.',
  });
}
```

Mark the route idempotency key failed only when `!coreCommitted`.

- [ ] **Step 6: Make post-commit side effects replay-safe**

Reload admission/deposit, construct `responseBody`, complete the idempotency key immediately, then:

```ts
await createAuditLog(...).catch((error) =>
  console.error('Failed to audit admission with deposit:', error),
);
await shadowCreateCashLedgerEntry(...).catch((error) =>
  console.error('Failed to write admission deposit cash-ledger shadow:', error),
);
```

Do not reinsert the admission fee after commit. Queue accounting only after a successful financial commit.

- [ ] **Step 7: Mark route integrated**

Set registry entry:

```ts
'reception.admission.deposit.collect': {
  boundary: 'reception.admission.deposit.collect',
  status: 'integrated',
  routeFile: 'src/routes/tenant/reception.ts',
  canonicalCommand: 'recordDeposit',
  reason: 'Conditional admission, dependent legacy deposit authority and canonical deposit commit through one guarded strict financial mutation.',
},
```

- [ ] **Step 8: Run route and atomic tests**

```bash
pnpm exec vitest run \
  test/canonical/financial-batch-assertion.test.ts \
  test/canonical/admission-deposit-atomic.test.ts \
  test/canonical/financial-route-coverage.test.ts \
  test/canonical/strict-financial-mutation.test.ts \
  test/integration/routes/reception-admission-deposit-atomic.test.ts \
  test/integration/routes/tenant-100-strict-financial.test.ts \
  test/integration/routes/reception.test.ts \
  test/reception-admit-idempotency.test.ts
```

Expected: all tests pass.

- [ ] **Step 9: Run TypeScript**

```bash
pnpm exec tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 10: Commit**

```bash
git add src/routes/tenant/reception.ts \
  src/lib/canonical/financial-route-coverage.ts \
  test/integration/routes/reception-admission-deposit-atomic.test.ts \
  test/integration/routes/tenant-100-strict-financial.test.ts \
  test/reception-admit-idempotency.test.ts
git commit -m "feat(canonical): integrate admission deposits atomically"
```

---

### Task 4: Adversarial review, verification and tracker evidence

**Files:**
- Create: `docs/database/migration-runs/P10-admission-deposit-atomic-verification.md`
- Modify: `task-progress.yaml`
- Modify only if stale: `test/canonical/main-based-continuation-contract.test.ts`

**Interfaces:**
- Consumes: all implementation commits.
- Produces: CDB-105 evidence and the exact CDB-106 next action.

- [ ] **Step 1: Review the complete branch diff**

Run:

```bash
git diff --check
git diff dbfcd41d068741003770612bd7fbcdecfdce5877...HEAD -- \
  migrations/0532_canonical_financial_batch_assertions.sql \
  src/lib/canonical/financial-batch-assertion.ts \
  src/routes/tenant/reception.ts \
  src/lib/canonical/financial-route-coverage.ts \
  test
```

Review statement adjacency, `changes()` ownership, strict/shadow/disabled ordering, idempotency completion and post-commit failures. Add a regression test before fixing every High or Critical finding.

- [ ] **Step 2: Run complete verification**

```bash
pnpm exec vitest run test/canonical
pnpm exec vitest run \
  test/integration/routes/reception-admission-deposit-atomic.test.ts \
  test/integration/routes/reception.test.ts \
  test/reception-admit-idempotency.test.ts
pnpm exec tsc --noEmit
pnpm canonical:check
pnpm build
git diff --check
```

Expected: all tests pass, TypeScript exits 0, governance reports zero issues and production build exits 0.

- [ ] **Step 3: Write verification evidence**

Record:

- exact base and branch commits;
- assertion schema and helper behavior;
- strict/shadow/disabled data flow;
- race and rollback tests;
- canonical and route test counts;
- migration count;
- TypeScript, governance and build results;
- confirmation that no production action occurred.

- [ ] **Step 4: Update tracker**

Remove `reception.admission.deposit.collect` from `remaining_runtime_boundaries` and `explicit_strict_blockers`. Set:

```yaml
current_checkpoint: CDB-106-CREDIT-NOTE-CASH-REFUND-NEXT
last_completed_checkpoint: CDB-105_admission_deposit_atomic_integrated
next_exact_action: design_and_integrate_credit_note_cash_refund_tender_attribution_from_latest_local_main
```

Point `verification_report`, `design` and `plan` to the CDB-105 artifacts.

- [ ] **Step 5: Validate and commit evidence**

```bash
python3 -c "import yaml; yaml.safe_load(open('task-progress.yaml'))"
pnpm exec vitest run test/canonical/main-based-continuation-contract.test.ts
git diff --check
git add docs/database/migration-runs/P10-admission-deposit-atomic-verification.md \
  task-progress.yaml test/canonical/main-based-continuation-contract.test.ts
git commit -m "docs(canonical): verify atomic admission deposits"
```

- [ ] **Step 6: Rebase, merge and verify local main**

If local `main` advanced, rebase the clean branch onto current local `main`, rerun focused tests and TypeScript, then fast-forward merge into the dedicated local-main worktree without touching its `.ai-bridge` files. Run focused tests, full canonical suite and TypeScript on merged local main, then remove this worktree and delete the merged branch.
