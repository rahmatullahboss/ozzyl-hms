# Doctor Clawback Compatibility Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore safe consumption of the existing doctor commission recovery ledger across all active payout paths without restoring abandoned clawback generation or performing production mutation.

**Architecture:** A focused compatibility helper reads existing outstanding recovery obligations, allocates FIFO deductions, and returns guarded D1 statements that are committed with the settlement transition. Existing settlement gross/net fields plus exact application rows preserve legacy authority; accounting posts gross payable, recovery receivable, and net cash separately; canonical shadow receives the same gross-to-net deduction through the existing live compensation settlement command.

**Tech Stack:** TypeScript, Hono, Cloudflare D1, Drizzle schema declarations, SQLite migrations, Vitest, canonical strict/shadow mutation framework.

## Global Constraints

- Production deploy, migration application, feature-flag change, traffic change, data repair, and deletion are not authorised.
- Do not restore historical credit-note clawback creation or `accrual_key` identity.
- Do not drop any existing production object.
- Tenant scope is mandatory in every read and write.
- Application rows are authoritative recovery evidence; adjustment status is a projection.
- Recovery must preserve at least BDT 0.01 positive net payout.
- Canonical shadow must receive the same gross and net amounts as the authoritative legacy settlement.
- Existing simple commission accounting callers must remain backward compatible.

---

### Task 1: Formalise the Compatibility Ledger Schema

**Files:**
- Create: `migrations/0538_doctor_commission_recovery_compatibility.sql`
- Modify: `src/db/schema/finance.ts`
- Modify: `tenant-schema.sql`
- Create: `test/doctor-commission-recovery-schema.test.ts`

**Interfaces:**
- Produces tables `doctor_commission_adjustments` and `doctor_commission_adjustment_applications` with the production-compatible columns, uniqueness, checks, and indexes.
- Does not produce or depend on the abandoned accrual identity columns.

- [ ] **Step 1: Write the failing schema test**

The test must read the migration, Drizzle schema, and tenant baseline and assert:

```ts
expect(migration).toContain('CREATE TABLE IF NOT EXISTS doctor_commission_adjustments');
expect(migration).toContain('CREATE TABLE IF NOT EXISTS doctor_commission_adjustment_applications');
expect(migration).not.toContain('ALTER TABLE doctor_commission_accruals ADD COLUMN accrual_key');
expect(financeSchema).toContain("sqliteTable('doctor_commission_adjustments'");
expect(financeSchema).toContain("sqliteTable('doctor_commission_adjustment_applications'");
expect(tenantSchema).toContain('CREATE TABLE IF NOT EXISTS doctor_commission_adjustments');
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm exec vitest run test/doctor-commission-recovery-schema.test.ts
```

Expected: failure because migration `0538` and current schema declarations do not exist.

- [ ] **Step 3: Add the idempotent migration**

Create both tables using the exact production-compatible column names and checks from historical `0430`/`0431`, but do not add any accrual or settlement columns. Add these indexes with `IF NOT EXISTS`:

```sql
idx_doctor_commission_adjustments_doctor_status
idx_doctor_commission_adjustments_credit_note
idx_doctor_commission_adjustment_applications_adjustment
idx_doctor_commission_adjustment_applications_settlement
```

- [ ] **Step 4: Add matching Drizzle declarations and tenant baseline SQL**

Export:

```ts
export const doctorCommissionAdjustments = sqliteTable('doctor_commission_adjustments', ...);
export const doctorCommissionAdjustmentApplications = sqliteTable('doctor_commission_adjustment_applications', ...);
```

Keep money fields as `real` because the existing production ledger uses major-unit REAL values; this compatibility task must not silently reinterpret stored values.

- [ ] **Step 5: Run schema and governance tests**

Run:

```bash
pnpm exec vitest run test/doctor-commission-recovery-schema.test.ts test/canonical/schema-governance.test.ts test/production-schema-drift-disposition.test.ts
```

Expected: all tests pass and the drift disposition still rejects restoration of old `0424`–`0432` files.

- [ ] **Step 6: Commit**

```bash
git add migrations/0538_doctor_commission_recovery_compatibility.sql src/db/schema/finance.ts tenant-schema.sql test/doctor-commission-recovery-schema.test.ts
git commit -m "feat(finance): formalize doctor recovery compatibility ledger"
```

### Task 2: Build the Guarded FIFO Recovery Allocator

**Files:**
- Create: `src/lib/doctor-commission-recovery.ts`
- Create: `test/unit/doctor-commission-recovery.test.ts`

**Interfaces:**
- Produces:

```ts
export type DoctorCommissionRecoveryApplication = {
  adjustmentId: number;
  amount: number;
};

export function allocateDoctorCommissionRecoveries(
  rows: Array<{ adjustmentId: number; outstandingAmount: number }>,
  maxDeduction: number,
): { applications: DoctorCommissionRecoveryApplication[]; totalDeduction: number };

export async function prepareDoctorCommissionRecoveryStatements(
  db: D1Database,
  input: {
    tenantId: string;
    doctorId: number;
    settlementIdempotencyKey: string;
    maxDeduction: number;
    createdBy: string | number;
  },
): Promise<{
  statements: D1PreparedStatement[];
  applications: DoctorCommissionRecoveryApplication[];
  totalDeduction: number;
}>;
```

- [ ] **Step 1: Write pure RED tests**

Cover:

```ts
expect(allocateDoctorCommissionRecoveries([
  { adjustmentId: 1, outstandingAmount: 10 },
  { adjustmentId: 2, outstandingAmount: 20 },
], 15)).toEqual({
  applications: [
    { adjustmentId: 1, amount: 10 },
    { adjustmentId: 2, amount: 5 },
  ],
  totalDeduction: 15,
});
```

Also assert zero/negative maximum produces no applications, fractional money rounds to two decimals, and allocation never exceeds an obligation.

- [ ] **Step 2: Run the unit test and verify RED**

```bash
pnpm exec vitest run test/unit/doctor-commission-recovery.test.ts
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the pure allocator**

Use a local `money()` normaliser based on `Math.round(value * 100) / 100`. Allocate in supplied order and stop when remaining maximum is zero.

- [ ] **Step 4: Add D1 preparation tests**

Use the existing in-memory SQLite D1 harness pattern. Seed two obligations and a settlement row. Assert prepared statements:

- insert exact application rows;
- update fully consumed adjustment to `applied`;
- leave partially consumed adjustment `outstanding`;
- fail the transition guard if another application consumes the prepared balance before execution;
- are tenant scoped.

- [ ] **Step 5: Implement guarded statement preparation**

The read query must calculate:

```sql
MAX(0, adjustment.amount - COALESCE(SUM(application.amount), 0)) AS outstanding_amount
```

Each application insert must re-check committed remaining amount in its `SELECT ... WHERE` clause. Append a fail-closed guard statement that attempts an invalid insert only when committed application count or sum for the target settlement differs from the prepared allocation.

- [ ] **Step 6: Run the allocator test**

```bash
pnpm exec vitest run test/unit/doctor-commission-recovery.test.ts
```

Expected: all cases pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/doctor-commission-recovery.ts test/unit/doctor-commission-recovery.test.ts
git commit -m "feat(finance): add guarded doctor recovery allocator"
```

### Task 3: Extend Commission Settlement Accounting

**Files:**
- Modify: `src/lib/accounting-posting.ts`
- Modify: `test/accounting-posting.test.ts`

**Interfaces:**
- Extend the existing commission settlement payload with optional:

```ts
grossCommissionAmount?: number;
advanceDeduction?: number;
clawbackDeduction?: number;
otherAdjustment?: number;
roundingAdjustment?: number;
netPaidAmount?: number;
```

- [ ] **Step 1: Add failing accounting tests**

Assert a BDT 1,000 gross settlement with BDT 100 clawback and BDT 900 net produces:

```ts
[
  { mapping: 'doctor_commission_payable', debit: 1000, credit: 0 },
  { mapping: 'cash', debit: 0, credit: 900 },
  { mapping: 'doctor_advance_receivable', debit: 0, credit: 100 },
]
```

Assert an unbalanced payload throws and the old `{ amount: 250, paymentMethod: 'cash' }` call remains unchanged.

- [ ] **Step 2: Run accounting tests and verify RED**

```bash
pnpm exec vitest run test/accounting-posting.test.ts
```

Expected: new clawback assertions fail.

- [ ] **Step 3: Implement backward-compatible accounting**

Calculate:

```ts
calculatedNet = gross - advance - clawback + other + rounding;
```

Reject a difference greater than `0.009`. Debit gross payable, credit net payment asset, credit doctor advance receivable for advance and clawback, and preserve the existing doctor settlement adjustment mapping for signed other/rounding values.

- [ ] **Step 4: Include required account mappings conditionally**

`resolveRequiredMappingKeys` must request `doctor_advance_receivable` only when advance or clawback is positive and request `doctor_settlement_adjustment` only when a signed adjustment is non-zero.

- [ ] **Step 5: Run tests**

```bash
pnpm exec vitest run test/accounting-posting.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/accounting-posting.ts test/accounting-posting.test.ts
git commit -m "fix(accounting): post doctor recovery deductions"
```

### Task 4: Integrate Recovery into Reception Doctor Payout

**Files:**
- Modify: `src/routes/tenant/receptionDoctorPayouts.ts`
- Modify: `test/integration/routes/reception-doctor-payouts.test.ts`
- Modify: `test/canonical/live-compensation-settlement.test.ts` only if an additional parity assertion is required

**Interfaces:**
- Consumes `prepareDoctorCommissionRecoveryStatements`.
- Response adds `clawbackDeduction` and `clawbackApplications` without removing existing fields.

- [ ] **Step 1: Add a failing route test**

Seed one doctor with a BDT 100 outstanding obligation and a BDT 500 payable. Submit a payout and assert:

- settlement gross is BDT 500;
- settlement/net cash is BDT 400;
- one application row records BDT 100;
- adjustment status becomes `applied`;
- accounting payload includes gross 500, clawback 100, net 400;
- canonical command receives gross 500 and net 400;
- response reports BDT 100 deduction.

- [ ] **Step 2: Run the route test and verify RED**

```bash
pnpm exec vitest run test/integration/routes/reception-doctor-payouts.test.ts
```

Expected: current route pays BDT 500 and creates no application.

- [ ] **Step 3: Prepare recovery before building authoritative statements**

After calculating existing line/advance/other/rounding amounts:

```ts
const preRecoveryNetAmount = amount(grossCommissionAmount - advanceDeduction + otherAdjustment + roundingAdjustment);
const recovery = await prepareDoctorCommissionRecoveryStatements(c.env.DB, {
  tenantId,
  doctorId,
  settlementIdempotencyKey: data.idempotencyKey,
  maxDeduction: Math.max(0, preRecoveryNetAmount - 0.01),
  createdBy: userId,
});
const clawbackDeduction = recovery.totalDeduction;
const netPaidAmount = amount(preRecoveryNetAmount - clawbackDeduction);
```

- [ ] **Step 4: Add recovery statements to the authoritative legacy batch**

Append `...recovery.statements` after settlement insertion and before transition guards. Preserve existing idempotency and cash movement statements.

- [ ] **Step 5: Pass gross/net parity to canonical and accounting**

Keep canonical `grossAmount` equal to selected gross and pass recovery-adjusted `netPaidAmount`. Post accounting with gross, advance, clawback, other, rounding, and net fields.

- [ ] **Step 6: Return exact recovery evidence**

Add:

```ts
clawbackDeduction,
clawbackApplications: recovery.applications,
```

- [ ] **Step 7: Run focused tests**

```bash
pnpm exec vitest run test/integration/routes/reception-doctor-payouts.test.ts test/canonical/live-compensation-settlement.test.ts test/accounting-posting.test.ts
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/routes/tenant/receptionDoctorPayouts.ts test/integration/routes/reception-doctor-payouts.test.ts test/canonical/live-compensation-settlement.test.ts
git commit -m "fix(payout): recover outstanding doctor clawbacks"
```

### Task 5: Integrate Recovery into Commission Management Payouts

**Files:**
- Modify: `src/routes/tenant/commissions.ts`
- Modify: `test/doctor-commission-routes.test.ts`
- Create: `test/integration/routes/doctor-commission-recovery.test.ts`

**Interfaces:**
- Single-pay and bulk-settle routes consume the same recovery helper.
- Both responses expose gross, clawback deduction, and net paid.

- [ ] **Step 1: Add failing single-pay and bulk-settle tests**

For each route seed an approved paid-bill accrual plus outstanding recovery. Assert settlement, accrual transition, application, accounting, and response values reconcile.

- [ ] **Step 2: Verify RED**

```bash
pnpm exec vitest run test/doctor-commission-routes.test.ts test/integration/routes/doctor-commission-recovery.test.ts
```

Expected: current sequential routes pay gross and create no applications.

- [ ] **Step 3: Use effective payable values**

Both routes must select payable using the same rule as reception:

```sql
MAX(0, CASE
  WHEN COALESCE(earned_commission_amount,0) != 0
    OR COALESCE(doctor_waiver_amount,0) != 0
    OR COALESCE(payable_commission_amount,0) != 0
  THEN COALESCE(payable_commission_amount,0)
  ELSE COALESCE(commission_amount,0)
END)
```

- [ ] **Step 4: Replace partial sequential mutation with guarded D1 batch**

Generate an idempotency key for routes that do not receive one using the existing request idempotency pattern or a deterministic settlement source stored in the settlement row. Batch settlement insert, accrual updates, settlement items, recovery statements, and a transition guard. Do not leave a settlement committed when accrual or recovery application fails.

- [ ] **Step 5: Post balanced accounting**

Use gross selected payable, recovery deduction, and net paid. Preserve payment mode mapping.

- [ ] **Step 6: Return and audit exact amounts**

Audit payload and response must include:

```ts
{
  grossCommissionAmount,
  clawbackDeduction,
  netPaidAmount,
  clawbackApplications,
}
```

- [ ] **Step 7: Run route tests**

```bash
pnpm exec vitest run test/doctor-commission-routes.test.ts test/integration/routes/doctor-commission-recovery.test.ts test/integration/routes/reception-doctor-payouts.test.ts
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/routes/tenant/commissions.ts test/doctor-commission-routes.test.ts test/integration/routes/doctor-commission-recovery.test.ts
git commit -m "fix(commissions): apply recovery ledger to settlements"
```

### Task 6: Verification, Evidence, and Local Main Integration

**Files:**
- Create: `docs/database/migration-runs/production/2026-07-25-doctor-clawback-compatibility-recovery.md`
- Modify: `docs/database/production-schema-drift-disposition.json`
- Modify: `task-progress.yaml` only if the current canonical tracker requires a local checkpoint entry

**Interfaces:**
- Evidence explicitly states local implementation only and records no production mutation.

- [ ] **Step 1: Update drift disposition**

Reclassify `0430`/`0431` objects from deletion-candidate orphan schema to `active_compatibility_recovery_ledger_pending_canonical_retirement`. Preserve the fact that the old migration files themselves remain prohibited.

- [ ] **Step 2: Write the recovery evidence report**

Record:

- 40 production obligations, BDT 1,900;
- zero canonical mappings/adjustments for those obligations;
- July 24 settlements that omitted recovery;
- local implementation commits and test commands;
- production mutation/deploy/push status false;
- retirement gates.

- [ ] **Step 3: Run focused verification**

```bash
pnpm exec vitest run test/unit/doctor-commission-recovery.test.ts test/doctor-commission-recovery-schema.test.ts test/integration/routes/reception-doctor-payouts.test.ts test/doctor-commission-routes.test.ts test/integration/routes/doctor-commission-recovery.test.ts test/canonical/live-compensation-settlement.test.ts test/accounting-posting.test.ts test/production-schema-drift-disposition.test.ts test/canonical/schema-governance.test.ts
```

Expected: all pass.

- [ ] **Step 4: Run repository verification**

```bash
pnpm build:migrations
pnpm exec tsc --noEmit
pnpm canonical:check
```

Expected: migration manifest succeeds, TypeScript passes, and canonical governance reports zero issues.

- [ ] **Step 5: Review and commit evidence**

```bash
git add docs/database/migration-runs/production/2026-07-25-doctor-clawback-compatibility-recovery.md docs/database/production-schema-drift-disposition.json task-progress.yaml
git commit -m "docs(finance): record doctor recovery compatibility evidence"
```

- [ ] **Step 6: Review complete branch**

Confirm no production command, deployment, flag mutation, generated secret, dirty-root edit, or unrelated file is present.

- [ ] **Step 7: Synchronise and integrate into local main**

From the clean main worktree run the integration policy check, integrate the reviewed commits serially, and rerun focused verification, migration build, and TypeScript. Do not push or deploy.

- [ ] **Step 8: Clean up only this task worktree**

After verified local-main integration, remove `doctor-clawback-compatibility-recovery-20260725`, delete the fully merged local branch, and prune worktree metadata.
