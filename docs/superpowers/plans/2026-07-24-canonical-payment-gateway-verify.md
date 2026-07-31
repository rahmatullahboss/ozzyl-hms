# Canonical Payment Gateway Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate `payment-gateway.verify` with one strict atomic canonical payment-and-advance settlement while preserving the exact legacy/off and shadow contracts.

**Architecture:** Keep external gateway verification and the transient gateway-log claim outside the financial transaction. Use a new `settleGatewayPayment()` composite command for canonical payment plus optional advance-deposit authority, and a separate legacy adapter whose strict statements are evaluated lazily only in strict mode.

**Tech Stack:** TypeScript, Hono, Cloudflare D1, SQLite test adapter, Vitest, canonical command batch/idempotency infrastructure.

## Global Constraints

- Base all work on local `main` commit `8e2429e6bc156a3f4fd63168251cbca1155b6f8d`.
- Work only on branch `fix/canonical-payment-gateway-verify-20260724` in its isolated worktree.
- Disabled and shadow modes must execute the original legacy financial statements without strict-only validation or schema dependencies.
- Strict statement preparation must remain lazy until strict policy is resolved.
- Gateway verification and `pending -> verifying` claim behavior remain unchanged.
- Strict failure must roll back legacy and canonical settlement facts together; the route may then release `verifying` back to `pending`.
- No deploy, push, production migration, backfill, flag change, traffic movement, tenant mutation, observation, rollback, or legacy retirement.
- Use TDD and commit each coherent checkpoint.

---

### Task 1: Composite canonical gateway settlement command

**Files:**
- Create: `src/lib/canonical/commands/settle-gateway-payment.ts`
- Create: `test/canonical/settle-gateway-payment.test.ts`

**Interfaces:**
- Consumes: `CanonicalBatchDatabase`, `CanonicalCommandExecutionOptions`, `CollectPaymentInput`, `RecordDepositInput`, `runCanonicalBatch()`.
- Produces:

```ts
export interface SettleGatewayPaymentInput {
  tenantId: string;
  commandIdempotencyKey: string;
  commandOutboxEventPublicId: string;
  occurredAtUtc: string;
  businessDate: string;
  payment: CollectPaymentInput | null;
  advanceDeposit: RecordDepositInput | null;
}

export interface SettleGatewayPaymentResult {
  paymentReceiptPublicId: string | null;
  advanceDepositPublicId: string | null;
  appliedToBillMinor: number;
  depositMinor: number;
  totalMinor: number;
}

export async function settleGatewayPayment(
  db: CanonicalBatchDatabase,
  input: SettleGatewayPaymentInput,
  execution?: CanonicalCommandExecutionOptions,
): Promise<CanonicalCommandResult<SettleGatewayPaymentResult>>;
```

- [ ] **Step 1: Write RED tests for invoice-only, advance-only, and split settlement**

Create a real SQLite harness with the canonical invoice, receipt, tender, allocation, deposit, source-mapping, outbox, and financial assertion tables. Seed a posted canonical invoice for payment cases.

Assert invoice-only settlement inserts one posted receipt/tender/allocation, updates invoice paid/due, and creates no deposit.

Assert advance-only settlement inserts one fully unallocated receipt/tender and one posted canonical deposit.

Assert split settlement commits both authorities and the supplied authoritative legacy statements in one batch.

- [ ] **Step 2: Run RED verification**

Run:

```bash
pnpm vitest run test/canonical/settle-gateway-payment.test.ts
```

Expected: FAIL because `settleGatewayPayment` does not exist.

- [ ] **Step 3: Implement minimal composite command**

Validate that at least one portion exists. Require payment input to contain one captured gateway tender, one invoice allocation, and zero unallocated balance. Require advance input to contain complete receipt authority.

Read and validate the mapped canonical invoice before preparing payment allocation statements. Prepare deterministic payment rows, optional advance receipt/deposit rows, source mappings, child outbox events, reconciliation guards, and one outer command envelope:

```ts
return runCanonicalBatch(db, {
  tenantId: input.tenantId,
  commandName: 'canonical.gateway_payment.settle',
  idempotencyKey: input.commandIdempotencyKey,
  authoritativeStatements: execution.authoritativeStatements,
  request,
  statements,
  reconciliationStatements: mappings,
  result,
  event: {
    eventPublicId: input.commandOutboxEventPublicId,
    aggregateType: 'canonical_gateway_payment',
    aggregatePublicId: input.commandIdempotencyKey,
    eventType: 'canonical.gateway_payment.settled',
    occurredAtUtc: input.occurredAtUtc,
    businessDate: input.businessDate,
    payload: result,
  },
});
```

- [ ] **Step 4: Add replay, conflict, and rollback tests**

Assert exact replay returns `replayed`, changed evidence with the same idempotency key throws `CanonicalIdempotencyConflictError`, stale invoice balance rolls back all canonical and authoritative legacy rows, and a duplicate child identity rolls back the outer command claim.

- [ ] **Step 5: Run GREEN verification and commit**

Run:

```bash
pnpm vitest run test/canonical/settle-gateway-payment.test.ts test/canonical/collect-payment.test.ts test/canonical/apply-deposit.test.ts
```

Commit:

```bash
git add src/lib/canonical/commands/settle-gateway-payment.ts test/canonical/settle-gateway-payment.test.ts
git commit -m "feat(canonical): add gateway payment settlement command"
```

---

### Task 2: Shadow-isolated gateway legacy adapter

**Files:**
- Create: `src/lib/canonical/gateway-payment-verification.ts`
- Create: `test/canonical/gateway-payment-verification.test.ts`

**Interfaces:**
- Consumes: current financial SQL from `src/routes/tenant/payments.ts`, `prepareFinancialBatchAssertion()`, `prepareClearFinancialBatchAssertions()`, and legacy accounting-event helpers.
- Produces:

```ts
export interface GatewayPaymentLegacyInput {
  tenantId: string;
  userId: string;
  gatewayLogId: number;
  billId: number;
  patientId: number;
  expectedBillTotal: number;
  expectedBillPaid: number;
  expectedBillStatus: string;
  confirmedAmount: number;
  amountForBill: number;
  depositAmount: number;
  newPaid: number;
  newBillStatus: string;
  receiptNo: string;
  advanceReceiptNo: string;
  gateway: string;
  paymentId: string;
  externalTransactionId: string;
  businessDate: string;
  rawResponseJson: string;
}

export function prepareGatewayPaymentOriginalLegacyStatements(
  db: D1Database,
  input: GatewayPaymentLegacyInput,
): D1PreparedStatement[];

export function prepareGatewayPaymentStrictStatements(
  db: D1Database,
  input: GatewayPaymentLegacyInput,
): D1PreparedStatement[];

export function prepareGatewayPaymentLegacyStatements(
  db: D1Database,
  input: GatewayPaymentLegacyInput,
): D1PreparedStatement[];
```

- [ ] **Step 1: Write RED legacy-contract tests**

Assert original statements match current route behavior and contain no `canonical_financial_batch_assertions`, `accounting_posting_events`, strict optimistic bill predicate, or `changes()` dependency.

Assert the returned legacy array carries a lazy `strictAuthoritativeStatements` factory and `legacyPostCommit` function.

- [ ] **Step 2: Run RED verification**

Run:

```bash
pnpm vitest run test/canonical/gateway-payment-verification.test.ts
```

Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement original and strict statement builders**

The original builder copies the existing payment, bill update, income, optional deposit, employee cash transaction, and gateway-log success SQL exactly.

The strict builder adds optimistic bill predicates, payment/deposit/log idempotency predicates, one-row assertions after every required mutation, atomic payment/deposit accounting-event inserts, and final assertion cleanup.

- [ ] **Step 4: Implement legacy post-commit accounting parity**

Use `recordAccountingPostingEvent()` for payment and optional advance deposit. Keep failures best-effort through the coordinator metadata hook.

- [ ] **Step 5: Add stale-state rollback tests**

Assert strict statements roll back all writes when expected bill paid/status changes or when the gateway log is no longer `verifying`.

- [ ] **Step 6: Run GREEN verification and commit**

Run:

```bash
pnpm vitest run test/canonical/gateway-payment-verification.test.ts test/canonical/strict-financial-mutation-isolation.test.ts
```

Commit:

```bash
git add src/lib/canonical/gateway-payment-verification.ts test/canonical/gateway-payment-verification.test.ts
git commit -m "feat(canonical): guard gateway legacy settlement"
```

---

### Task 3: Route integration and governance

**Files:**
- Modify: `src/routes/tenant/payments.ts:247-451`
- Modify: `src/lib/canonical/financial-route-coverage.ts:154-160`
- Create: `test/integration/routes/payment-gateway-canonical.test.ts`
- Modify: `test/integration/routes/financial-shadow-route-isolation.test.ts`
- Modify: `test/canonical/financial-route-coverage.test.ts`

**Interfaces:**
- Consumes: `executeStrictFinancialMutation()`, `settleGatewayPayment()`, `buildLivePaymentProjection()`, `buildLiveDepositProjection()`, and `prepareGatewayPaymentLegacyStatements()`.
- Produces: integrated `payment-gateway.verify` route boundary.

- [ ] **Step 1: Write RED route-contract tests**

Assert the route no longer calls `assertStrictFinancialBoundaryDisabledOrSupported()` for `payment-gateway.verify`, calls `executeStrictFinancialMutation()`, uses `prepareGatewayPaymentLegacyStatements()`, and invokes `settleGatewayPayment()`.

Assert strict projection preparation is inside the canonical callback and therefore not evaluated in legacy/shadow mode.

- [ ] **Step 2: Run RED verification**

Run:

```bash
pnpm vitest run test/integration/routes/payment-gateway-canonical.test.ts test/canonical/financial-route-coverage.test.ts
```

Expected: FAIL because the route remains blocked.

- [ ] **Step 3: Integrate the route**

After the gateway response and amount split, build one `GatewayPaymentLegacyInput`. Pass its legacy statement bundle to:

```ts
await executeStrictFinancialMutation({
  db: c.env.DB,
  tenantId: String(tenantId),
  boundary: 'payment-gateway.verify',
  legacyStatements,
  canonical: async (execution) => {
    const invoiceMapping = amountForBill > 0 ? await loadCanonicalInvoiceMapping(...) : null;
    const payment = amountForBill > 0 ? await buildLivePaymentProjection(...) : null;
    const advanceDeposit = depositAmount > 0 ? await buildLiveDepositProjection(...) : null;
    return settleGatewayPayment(c.env.DB, {
      tenantId: String(tenantId),
      commandIdempotencyKey: `gateway-payment:${gateway}:${paymentId}`,
      commandOutboxEventPublicId: await createDeterministicSourceId(...),
      occurredAtUtc,
      businessDate: today,
      payment,
      advanceDeposit,
    }, execution);
  },
});
```

Keep the existing batch-failure unlock path and paid diagnostic propagation.

- [ ] **Step 4: Mark route coverage integrated**

Set:

```ts
status: 'integrated',
canonicalCommand: 'settleGatewayPayment',
```

and update the reason to describe atomic payment plus optional advance deposit settlement.

- [ ] **Step 5: Run route and governance tests**

Run:

```bash
pnpm vitest run test/integration/routes/payment-gateway-canonical.test.ts test/integration/routes/financial-shadow-route-isolation.test.ts test/canonical/financial-route-coverage.test.ts test/reception-integrity-hardening.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/routes/tenant/payments.ts src/lib/canonical/financial-route-coverage.ts test/integration/routes/payment-gateway-canonical.test.ts test/integration/routes/financial-shadow-route-isolation.test.ts test/canonical/financial-route-coverage.test.ts
git commit -m "feat(canonical): integrate gateway payment verification"
```

---

### Task 4: Program checkpoint and final verification

**Files:**
- Modify: `task-progress.yaml`
- Create: `docs/database/migration-runs/P11-payment-gateway-verify-verification.md`
- Modify: `test/canonical/main-based-continuation-contract.test.ts` only if the new report/checkpoint requires contract coverage.

**Interfaces:**
- Produces: CDB-111 verification receipt and exact next boundary.

- [ ] **Step 1: Run full verification**

Run:

```bash
pnpm vitest run test/canonical
pnpm exec tsc --noEmit
pnpm canonical:check
pnpm build
pnpm worktree:check -- --mode=task --allow-dirty
git diff --check
```

- [ ] **Step 2: Review the complete diff**

Use `show_changes` and verify:

- no strict-only SQL is present in original legacy statements;
- strict statement factories are lazy;
- external gateway calls are not inside the D1 batch;
- no production action or flag change exists;
- route coverage is truthful.

- [ ] **Step 3: Write the verification report and update tracker**

Record fresh test/build counts, checkpoint commits, no-production statement, and set the next exact action to `patient-chart.lab-billing.create` from the latest reviewed local `main`.

- [ ] **Step 4: Run continuation contract and commit**

Run:

```bash
pnpm vitest run test/canonical/main-based-continuation-contract.test.ts
git diff --check
```

Commit:

```bash
git add task-progress.yaml docs/database/migration-runs/P11-payment-gateway-verify-verification.md test/canonical/main-based-continuation-contract.test.ts
git commit -m "docs(canonical): record gateway verification checkpoint"
```
