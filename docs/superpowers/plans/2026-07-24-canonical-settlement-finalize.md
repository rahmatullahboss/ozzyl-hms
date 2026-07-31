# Canonical Settlement Finalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The program contract forbids subagent spawning or delegation, so execute serially in this session.

**Goal:** Integrate `settlement.finalize` so multi-bill cash, deposit and discount settlement commits guarded legacy and canonical authority atomically in strict mode while preserving original disabled/shadow behavior.

**Architecture:** Add a dedicated multi-invoice `finalizeSettlement()` canonical command with an internal working-balance planner. Move the existing settlement legacy batch into a split original/strict adapter, then invoke both through `executeStrictFinancialMutation()`. Canonical cash receipts, deposit applications and credit notes share one outer command batch and map only to the matching committed legacy settlement source rows.

**Tech Stack:** TypeScript, Hono, Cloudflare D1/SQLite, Vitest, existing canonical command-batch/idempotency/source-mapping/financial-assertion helpers.

## Global Constraints

- Base all work on reviewed local `main` commit `d6f45d78ee07a181114c86d6a88689d86d311e96` in `fix/canonical-settlement-finalize-20260724`.
- Preserve the owner dirty root without reset, clean, stash, overwrite or opportunistic commit.
- Do not spawn or delegate to other agents.
- Do not push, deploy, mutate production, change production flags, observe production, or retire legacy behavior.
- Preserve disabled and shadow settlement statement order, source receipt identities, request idempotency, response shape, accounting queue and cash-ledger behavior.
- Strict mode must use one outer canonical command batch containing guarded legacy statements and all canonical payment/deposit/discount facts.
- Canonical payment/deposit/credit semantics must match existing generic commands.
- Settlement cancellation is out of scope and must not be described as integrated.
- Every implementation slice follows RED → GREEN → regression → exact-file commit.

---

## File map

- Create `src/lib/canonical/commands/finalize-settlement.ts`: canonical multi-invoice planner, validation and one-batch command.
- Create `test/canonical/finalize-settlement.test.ts`: executable SQLite contract for the composite command.
- Create `src/lib/canonical/settlement-finalization.ts`: shared allocation plan, original legacy executor and strict statement preparation.
- Create `test/canonical/settlement-finalization.test.ts`: original parity and strict race/trigger tests.
- Modify `src/routes/tenant/settlements.ts`: orchestration-only integration through the financial coordinator.
- Create `test/integration/routes/settlement-finalization-canonical.test.ts`: route source/runtime policy tests.
- Modify `test/integration/routes/settlements.test.ts`: preserve existing response and mutation behavior under the adapter owner.
- Modify `src/lib/canonical/financial-route-coverage.ts`: mark the boundary integrated.
- Modify `test/canonical/financial-route-coverage.test.ts`: remove the final blocked writer and assert command ownership.
- Modify `test/integration/routes/financial-shadow-route-isolation.test.ts`: prove original settlement authority is canonical-free.
- Modify `scripts/canonical/legacy-financial-writer-disposition.json`: transfer only required writer ownership from route to adapter.
- Modify `test/canonical/main-based-continuation-contract.test.ts`: no registered P11 runtime boundaries remain.
- Modify `task-progress.yaml`: CDB-117 receipt and next checkpoint.
- Create `docs/database/migration-runs/P11-settlement-finalize-verification.md`: final evidence.

---

### Task 1: Composite settlement command contract

**Files:**
- Create: `src/lib/canonical/commands/finalize-settlement.ts`
- Create: `test/canonical/finalize-settlement.test.ts`

**Interfaces:**

- Produces:

```ts
export type SettlementTenderType =
  | 'cash'
  | 'card'
  | 'mobile_wallet'
  | 'bank_transfer'
  | 'gateway'
  | 'other';

export interface FinalizeSettlementBillInput {
  billId: number;
  invoicePublicId: string;
  invoiceNumber: string;
  legacyTotalMinor: number;
  legacyPaidBeforeMinor: number;
  legacyDueBeforeMinor: number;
  canonicalPaidBeforeMinor: number;
  canonicalDueBeforeMinor: number;
  canonicalCreditedBeforeMinor: number;
  canonicalNetDueBeforeMinor: number;
  cashMinor: number;
  depositMinor: number;
  discountMinor: number;
  paymentReceiptNumber: string | null;
  depositAdjustmentReceiptNumber: string | null;
  discountNumber: string | null;
  discountReasonCode: string | null;
  discountAllocationType: string | null;
  discountReferenceName: string | null;
  discountNote: string | null;
}

export interface FinalizeSettlementInput {
  tenantId: string;
  commandIdempotencyKey: string;
  settlementPublicId: string;
  settlementReceiptNumber: string;
  legacyPatientId: number;
  currencyCode: 'BDT';
  occurredAtUtc: string;
  businessDate: string;
  legacyCollectorId: number;
  legacyCounterId: number;
  legacyCounterSessionId: number;
  paymentMethod: string;
  tenderType: SettlementTenderType;
  bills: readonly FinalizeSettlementBillInput[];
}

export interface FinalizeSettlementDepositApplicationResult {
  applicationPublicId: string;
  depositPublicId: string;
  invoicePublicId: string;
  amountMinor: number;
}

export interface FinalizeSettlementBillResult {
  billId: number;
  invoicePublicId: string;
  paymentReceiptPublicId: string | null;
  creditNotePublicId: string | null;
  depositApplications: FinalizeSettlementDepositApplicationResult[];
  paidMinor: number;
  dueMinor: number;
  creditedMinor: number;
  netDueMinor: number;
}

export interface FinalizeSettlementResult {
  settlementPublicId: string;
  settlementReceiptNumber: string;
  cashMinor: number;
  depositMinor: number;
  discountMinor: number;
  bills: FinalizeSettlementBillResult[];
}

export async function finalizeSettlement(
  db: CanonicalBatchDatabase,
  input: FinalizeSettlementInput,
  execution?: CanonicalCommandExecutionOptions,
): Promise<CanonicalCommandResult<FinalizeSettlementResult>>;
```

- The command resolves source rows from the committed legacy tables using receipt/source identities; no route-invented row ID is required.

- [ ] **Step 1: Create the SQLite harness and write the RED cash-only test**

Create canonical migrations plus minimal legacy tables:

```sql
CREATE TABLE billing_settlements (
  id INTEGER PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  patient_id INTEGER NOT NULL,
  settlement_receipt_no TEXT NOT NULL,
  payable_amount REAL NOT NULL,
  paid_amount REAL NOT NULL,
  deposit_deducted REAL NOT NULL,
  discount_amount REAL NOT NULL,
  payment_mode TEXT NOT NULL,
  created_by INTEGER NOT NULL,
  counter_id INTEGER NOT NULL,
  counter_session_id INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE bills (
  id INTEGER PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  patient_id INTEGER NOT NULL,
  invoice_no TEXT NOT NULL,
  total REAL NOT NULL,
  paid REAL NOT NULL,
  due REAL NOT NULL,
  status TEXT NOT NULL,
  settlement_id INTEGER
);
CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  bill_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  receipt_no TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  received_by INTEGER,
  counter_id INTEGER,
  counter_session_id INTEGER
);
CREATE TABLE billing_deposits (
  id INTEGER PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  patient_id INTEGER NOT NULL,
  deposit_receipt_no TEXT NOT NULL,
  amount REAL NOT NULL,
  transaction_type TEXT NOT NULL,
  reference_bill_id INTEGER,
  created_by INTEGER,
  counter_id INTEGER,
  counter_session_id INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE bill_discount_allocations (
  id INTEGER PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  bill_id INTEGER NOT NULL,
  settlement_id INTEGER,
  allocation_type TEXT NOT NULL,
  discount_reason TEXT NOT NULL,
  amount REAL NOT NULL,
  reference_name TEXT,
  note TEXT
);
```

Seed two posted canonical invoices mapped to two legacy bills and matching committed legacy settlement/payment rows. Assert:

```ts
const result = await finalizeSettlement(db, cashOnlyInput());
expect(result.status).toBe('applied');
expect(result.result.cashMinor).toBe(80_000);
expect(count(sqlite, 'canonical_payment_receipts')).toBe(2);
expect(count(sqlite, 'canonical_payment_allocations')).toBe(2);
expect(invoiceBalances(sqlite)).toEqual([
  { invoice_number: 'INV-1', paid_minor: 50_000, due_minor: 0, credited_minor: 0, net_due_minor: 0 },
  { invoice_number: 'INV-2', paid_minor: 30_000, due_minor: 20_000, credited_minor: 0, net_due_minor: 20_000 },
]);
```

- [ ] **Step 2: Run the RED test**

Run:

```bash
pnpm vitest run test/canonical/finalize-settlement.test.ts
```

Expected: FAIL because `finalize-settlement` does not exist.

- [ ] **Step 3: Implement validation, replay and canonical invoice loading**

Implement:

```ts
const replay = await readCanonicalCommandReplay<FinalizeSettlementResult>(db, {
  tenantId: input.tenantId,
  commandName: 'canonical.settlement.finalize',
  idempotencyKey: input.commandIdempotencyKey,
  request: requestShape(input),
});
if (replay) return replay;
```

For every bill, load:

```sql
SELECT legacy_patient_id,currency_code,total_minor,paid_minor,due_minor,
       credited_minor,net_due_minor,status
FROM canonical_invoices
WHERE tenant_id=? AND invoice_public_id=?
LIMIT 1
```

Reject unless the stored row exactly equals the supplied pre-settlement snapshot, is posted, belongs to the patient, uses BDT, reconciles `paid + due = total`, and has `net_due = due - credited`.

- [ ] **Step 4: Implement one working-state planner**

Use one mutable state per invoice:

```ts
interface InvoiceWorkingState {
  paidMinor: number;
  dueMinor: number;
  creditedMinor: number;
  netDueMinor: number;
}
```

Apply in this order:

```ts
applyCash();
applyDepositFragments();
applyDiscount();
```

After planning assert:

```ts
legacyDueAfterMinor === state.netDueMinor
```

and total component sums equal the outer settlement evidence.

- [ ] **Step 5: Implement canonical payment statements**

For each `cashMinor > 0`, create deterministic IDs using `createDeterministicSourceId()`:

```ts
receiptPublicId = source('payrcpt', 'legacy_settlement_payment', paymentReceiptNumber);
tenderPublicId = source('paytnd', 'legacy_settlement_payment_tender', paymentReceiptNumber);
allocationPublicId = source('payalloc', 'legacy_settlement_payment_allocation', paymentReceiptNumber);
```

Insert payment receipt, captured tender and invoice allocation using the same columns/guards as `collectPayment()`. Add:

- optimistic invoice update from the current working state;
- receipt reconciliation statement;
- payment child outbox event;
- optional cash-custody child event;
- `INSERT ... SELECT` source mapping requiring the exact committed `payments` row.

- [ ] **Step 6: Implement FIFO deposit-application statements**

Load all posted patient deposits:

```sql
SELECT deposit_public_id,legacy_patient_id,currency_code,amount_minor,
       applied_minor,refunded_minor,available_minor,status,received_at_utc
FROM canonical_deposits
WHERE tenant_id=? AND legacy_patient_id=? AND currency_code='BDT'
  AND status='posted' AND available_minor>0
ORDER BY received_at_utc,deposit_public_id
```

Consume FIFO across bills and create one application per source fragment. Use the same application, deposit update, invoice update and balance guard columns as `applyDeposit()`.

Map each fragment with source public ID:

```ts
`${depositAdjustmentReceiptNumber}:${fragmentIndex}`
```

and require the matching committed legacy adjustment row before mapping.

- [ ] **Step 7: Implement discount credit-note statements**

For each `discountMinor > 0`, create one credit note and one line using the same schema and reconciliation guard as `issueCreditNote()`.

Before preparing a discount, run compensation-safety queries equivalent to `issueCreditNote()` for canonical settled compensation and paid legacy performer/doctor facts.

Use:

```ts
creditNoteNumber = discountNumber;
reasonCode = discountReasonCode;
```

Map only through an `INSERT ... SELECT` from the matching settlement and `bill_discount_allocations` row.

- [ ] **Step 8: Add the outer settlement source mapping and command event**

The mapping must require:

```sql
billing_settlements.tenant_id = ?
AND settlement_receipt_no = ?
AND patient_id = ?
AND ROUND(payable_amount * 100) = ?
AND ROUND(paid_amount * 100) = ?
AND ROUND(deposit_deducted * 100) = ?
AND ROUND(discount_amount * 100) = ?
AND payment_mode = ?
AND created_by = ?
AND counter_id = ?
AND counter_session_id = ?
AND is_active = 1
```

Run one outer command:

```ts
return runCanonicalBatch(db, {
  tenantId: input.tenantId,
  commandName: 'canonical.settlement.finalize',
  idempotencyKey: input.commandIdempotencyKey,
  authoritativeStatements: execution.authoritativeStatements,
  request,
  statements,
  reconciliationStatements,
  result,
  event: {
    eventPublicId,
    aggregateType: 'canonical_settlement',
    aggregatePublicId: input.settlementPublicId,
    eventType: 'canonical.settlement.finalized',
    occurredAtUtc: input.occurredAtUtc,
    businessDate: input.businessDate,
    payload: {
      settlementPublicId: input.settlementPublicId,
      settlementReceiptNumber: input.settlementReceiptNumber,
      legacyPatientId: input.legacyPatientId,
      cashMinor,
      depositMinor,
      discountMinor,
      billCount: input.bills.length,
    },
  },
});
```

- [ ] **Step 9: Add the full command test matrix**

Add tests for:

- deposit-only FIFO over two sources and two invoices;
- discount-only credit notes;
- mixed cash/deposit/discount order;
- existing invoice credits;
- replay and changed-evidence conflict;
- authoritative statement rollback;
- invoice race rollback;
- deposit race rollback;
- missing mapping/source row rejection;
- compensation-safety rejection.

- [ ] **Step 10: Run command and generic-command regressions**

Run:

```bash
pnpm vitest run \
  test/canonical/finalize-settlement.test.ts \
  test/canonical/collect-payment.test.ts \
  test/canonical/adjustment-lifecycle.test.ts \
  test/canonical/compensation-lifecycle.test.ts
pnpm exec tsc --noEmit
```

Expected: all pass.

- [ ] **Step 11: Commit the composite command**

```bash
git add src/lib/canonical/commands/finalize-settlement.ts test/canonical/finalize-settlement.test.ts
git commit -m "feat(canonical): add settlement finalization command"
```

---

### Task 2: Original legacy settlement adapter

**Files:**
- Create: `src/lib/canonical/settlement-finalization.ts`
- Create: `test/canonical/settlement-finalization.test.ts`

**Interfaces:**

```ts
export interface SettlementBillSnapshot {
  id: number;
  patientId: number;
  total: number;
  paid: number;
  due: number;
  status: string;
  settlementId: number | null;
}

export interface SettlementPreparationInput {
  tenantId: string;
  userId: number;
  patientId: number;
  bills: readonly SettlementBillSnapshot[];
  paidAmount: number;
  depositDeducted: number;
  discountAmount: number;
  discountByName: string | null;
  discountReasonCode: string;
  discountAllocationType: string;
  paymentMode: string;
  remarks: string | null;
  businessDate: string;
  occurredAtUtc: string;
  counterId: number;
  counterSessionId: number;
  dependencies: {
    nextReceiptNo(): Promise<string>;
  };
}

export interface SettlementBillPlan extends SettlementBillSnapshot {
  cashApplied: number;
  depositApplied: number;
  discountApplied: number;
  paidAfter: number;
  dueAfter: number;
  statusAfter: 'paid' | 'partially_paid';
  paymentReceiptNo: string | null;
  depositReceiptNo: string | null;
  discountReceiptNo: string | null;
}

export interface SettlementContext extends Omit<SettlementPreparationInput, 'dependencies' | 'bills'> {
  receiptNo: string;
  payableAmount: number;
  billPlans: readonly SettlementBillPlan[];
}

export interface SettlementLegacyResult {
  results: unknown[];
  context: SettlementContext;
  settlementId: number;
}

export async function executeSettlementOriginalLegacy(
  db: CanonicalBatchDatabase,
  input: SettlementPreparationInput,
): Promise<SettlementLegacyResult>;
```

- [ ] **Step 1: Write RED original-order tests**

Assert the prepared/executed SQL order is:

```text
settlement insert
bill updates / payment inserts / deposit inserts in bill order
bill discount allocations
credit bill status update
counter cash transaction
payment accounting events
deposit accounting events
discount accounting events
audit log
```

Assert receipt formats and cash → deposit → discount allocation for two bills.

- [ ] **Step 2: Run the RED adapter test**

```bash
pnpm vitest run test/canonical/settlement-finalization.test.ts
```

Expected: module missing.

- [ ] **Step 3: Implement pure plan creation**

Implement `buildSettlementPlan()` using exact two-decimal rounding and sorted bill IDs. Reject leftover component amounts after all bills:

```ts
if (remainingCash !== 0 || remainingDeposit !== 0 || remainingDiscount !== 0) {
  throw new Error('Settlement allocation does not reconcile to selected bill due');
}
```

- [ ] **Step 4: Move the original legacy SQL unchanged into the adapter**

Use the same subquery:

```ts
const settlementIdLookup =
  '(SELECT id FROM billing_settlements WHERE tenant_id = ? AND settlement_receipt_no = ? LIMIT 1)';
```

Do not add canonical tables, financial assertions, stronger predicates or `changes()` to the original executor.

- [ ] **Step 5: Preserve result-ID fallback**

After `db.batch()`:

```ts
let settlementId = Number(result[0]?.meta?.last_row_id ?? 0);
if (!settlementId) {
  settlementId = Number((await db.prepare(
    'SELECT id FROM billing_settlements WHERE tenant_id=? AND settlement_receipt_no=? LIMIT 1',
  ).bind(context.tenantId, context.receiptNo).first<{ id: number }>())?.id ?? 0);
}
if (!(settlementId > 0)) throw new SettlementFinalizationError(409, 'Settlement changed concurrently');
```

- [ ] **Step 6: Verify original isolation**

The original helper/executor section must not contain:

```text
canonical_
prepareFinancialBatchAssertion
changes()
```

- [ ] **Step 7: Run adapter and existing route regression**

```bash
pnpm vitest run test/canonical/settlement-finalization.test.ts test/integration/routes/settlements.test.ts
pnpm exec tsc --noEmit
```

- [ ] **Step 8: Commit original legacy adapter**

```bash
git add src/lib/canonical/settlement-finalization.ts test/canonical/settlement-finalization.test.ts
git commit -m "feat(canonical): preserve settlement legacy authority"
```

---

### Task 3: Strict settlement context and compatibility statements

**Files:**
- Modify: `src/lib/canonical/settlement-finalization.ts`
- Modify: `test/canonical/settlement-finalization.test.ts`
- Modify: `scripts/canonical/legacy-financial-writer-disposition.json`

**Interfaces:**

```ts
export interface SettlementCanonicalInvoiceSnapshot {
  invoicePublicId: string;
  legacyPatientId: number;
  currencyCode: string;
  totalMinor: number;
  paidMinor: number;
  dueMinor: number;
  creditedMinor: number;
  netDueMinor: number;
  status: string;
}

export interface SettlementCanonicalDepositSnapshot {
  depositPublicId: string;
  appliedMinor: number;
  refundedMinor: number;
  availableMinor: number;
  receivedAtUtc: string;
  status: string;
}

export interface SettlementStrictContext extends SettlementContext {
  canonicalInvoices: ReadonlyMap<number, SettlementCanonicalInvoiceSnapshot>;
  canonicalDeposits: readonly SettlementCanonicalDepositSnapshot[];
  legacyDepositBalanceMinor: number;
}

export async function prepareSettlementStrictContext(
  db: CanonicalBatchDatabase,
  input: SettlementPreparationInput,
): Promise<SettlementStrictContext>;

export function prepareSettlementStrictStatements(
  db: Pick<CanonicalBatchDatabase, 'prepare'>,
  context: SettlementStrictContext,
): readonly CanonicalPreparedStatement[];
```

- [ ] **Step 1: Add RED preflight tests**

Verify rejection before `nextReceiptNo()` for:

- missing invoice mapping;
- non-posted invoice;
- patient/currency mismatch;
- legacy/canonical total mismatch;
- canonical paid/due/credit/net-due mismatch;
- legacy/canonical deposit balance mismatch;
- insufficient canonical deposit coverage;
- duplicate bill IDs.

Use a `calls` array and assert it remains empty.

- [ ] **Step 2: Implement exact invoice mapping lookup**

Resolve through `canonical_source_mappings` requiring:

```sql
entity_type='invoice'
AND mapping_status='mapped'
AND source_table='bills'
AND (
  (source_type='legacy_live_bill' AND source_public_id=b.invoice_no)
  OR (source_type='legacy_bill' AND source_public_id=CAST(b.id AS TEXT))
)
```

Reject multiple conflicting canonical IDs.

- [ ] **Step 3: Implement strict deposit equivalence**

Read legacy active balance and canonical FIFO rows. Convert all values to exact minor units and require:

```ts
legacyDepositBalanceMinor === canonicalAvailableMinor;
canonicalAvailableMinor >= requestedDepositMinor;
```

- [ ] **Step 4: Allocate the receipt only after canonical preflight**

Call:

```ts
const receiptNo = await input.dependencies.nextReceiptNo();
```

only after every invoice/deposit check passes, then build the shared bill plan.

- [ ] **Step 5: Write RED strict atomic success and race tests**

Install minimal legacy tables, `0532_canonical_financial_batch_assertions.sql`, and production accounting-event table/constraints. Test successful mixed settlement and full rollback for mutations between preflight and batch:

- bill paid/due/status/settlement ID;
- bill patient/total;
- invoice paid/due/credited/net-due/status;
- invoice mapping deletion/change;
- canonical deposit applied/refunded/available/status;
- legacy deposit source balance;
- active counter/session state;
- conflicting payment receipt;
- conflicting deposit receipt;
- conflicting discount allocation;
- conflicting settlement receipt.

- [ ] **Step 6: Implement guarded strict statements**

Use `prepareFinancialBatchAssertion()` after every required one-row mutation. Bill update shape:

```sql
UPDATE bills
SET paid=?,due=?,status=?,settlement_id=${settlementIdLookup}
WHERE id=? AND CAST(tenant_id AS TEXT)=?
  AND patient_id=? AND total=? AND paid=? AND due=? AND status=?
  AND settlement_id IS NULL
```

Insert payment/deposit/discount rows with `INSERT ... SELECT ... WHERE NOT EXISTS` plus assertions.

- [ ] **Step 7: Preserve optional credit-bill updates**

Do not assert one row for `billing_credit_bill_status`. Keep the same bulk conditional update scoped to selected bills.

- [ ] **Step 8: Guard counter/session and aggregate cash authority**

The settlement insert/cash insert must require the same active billing counter session evidence used by the route:

```sql
EXISTS (
  SELECT 1 FROM billing_counter_sessions s
  WHERE s.id=? AND s.tenant_id=? AND s.counter_id=?
    AND s.user_id=? AND s.status='active'
)
```

- [ ] **Step 9: Add assertion cleanup**

Append:

```ts
prepareClearFinancialBatchAssertions(db, { tenantId, operationKey });
```

and verify zero residue after success/failure.

- [ ] **Step 10: Transfer narrow governance ownership**

Add adapter allowances only for tables actually written by `src/lib/canonical/settlement-finalization.ts`. Keep cancellation-route allowances required by `PUT /:id/cancel`; do not remove them merely because create SQL moved.

- [ ] **Step 11: Run strict adapter gates**

```bash
pnpm vitest run test/canonical/settlement-finalization.test.ts
pnpm canonical:check
pnpm exec tsc --noEmit
```

- [ ] **Step 12: Commit strict adapter**

```bash
git add \
  src/lib/canonical/settlement-finalization.ts \
  test/canonical/settlement-finalization.test.ts \
  scripts/canonical/legacy-financial-writer-disposition.json
git commit -m "feat(canonical): guard settlement finalization"
```

---

### Task 4: Route integration through the coordinator

**Files:**
- Modify: `src/routes/tenant/settlements.ts`
- Create: `test/integration/routes/settlement-finalization-canonical.test.ts`
- Modify: `test/integration/routes/settlements.test.ts`

**Interfaces:**

The route consumes Task 2/3 adapter functions and Task 1 command:

```ts
executeStrictFinancialMutation({
  db: c.env.DB,
  tenantId,
  boundary: 'settlement.finalize',
  legacyExecutor,
  strictAuthoritativeStatements,
  canonical,
});
```

- [ ] **Step 1: Write RED source-contract tests**

Assert the POST handler:

- imports `executeStrictFinancialMutation`;
- imports adapter and command functions;
- no longer calls `assertStrictFinancialBoundaryDisabledOrSupported`;
- no longer contains `INSERT INTO billing_settlements`, `INSERT INTO payments`, `INSERT INTO billing_deposits`, `UPDATE bills SET paid`, or settlement accounting-event SQL;
- creates strict statements lazily;
- passes `execution.authoritativeStatements` to `finalizeSettlement()`.

- [ ] **Step 2: Write RED runtime policy tests**

Add:

1. shadow mode canonical failure returns legacy `201`, preserves receipt response, and writes `canonical_processing_issues`;
2. strict missing invoice mapping returns sanitized `409` before sequence and legacy mutation;
3. strict mixed settlement batch contains settlement insert, bill update, canonical payment receipt, canonical deposit application and canonical credit note;
4. disabled mode preserves existing batch and response.

- [ ] **Step 3: Refactor common preparation**

Keep request replay and common policy validation in route. Build `SettlementPreparationInput` with:

```ts
occurredAtUtc: new Date().toISOString(),
dependencies: {
  nextReceiptNo: () => getNextSequence(c.env.DB, String(tenantId), 'settlement', 'STL'),
},
```

Reserve request idempotency before coordinator execution and mark failed on any coordinator/postcommit error exactly as the existing catch does.

- [ ] **Step 4: Invoke original/strict split**

Maintain refs:

```ts
const contextRef = { current: null as SettlementContext | SettlementStrictContext | null };
const legacySettlementIdRef = { current: null as number | null };
```

Legacy executor stores original context/result ID. Strict factory stores strict context and statements.

- [ ] **Step 5: Build canonical command input**

For strict context, use its mapped invoice/deposit snapshots.

For shadow context, resolve compatible existing mappings and canonical snapshots without creating missing historical authority. If unavailable, throw so the coordinator records the shadow issue.

Create deterministic settlement and child identities from tenant, receipt and bill/source identities.

- [ ] **Step 6: Preserve post-commit behavior**

After coordinator:

- resolve committed settlement ID by tenant/receipt fallback;
- queue accounting posting when any component exists;
- call `shadowWriteSettlementCollection()` only for paid cash mode as before;
- complete request idempotency;
- return the exact existing response.

Do not move the cash-ledger shadow write inside the financial command.

- [ ] **Step 7: Map strict canonical errors to sanitized 409**

Handle:

```ts
CanonicalStrictFinancialError
CanonicalIdempotencyConflictError
financial batch assertion errors
SettlementFinalizationError
```

without exposing internal SQL or canonical identifiers.

- [ ] **Step 8: Run route and adapter regressions**

```bash
pnpm vitest run \
  test/integration/routes/settlement-finalization-canonical.test.ts \
  test/integration/routes/settlements.test.ts \
  test/canonical/settlement-finalization.test.ts \
  test/canonical/finalize-settlement.test.ts
pnpm exec tsc --noEmit
```

- [ ] **Step 9: Commit route integration**

```bash
git add \
  src/routes/tenant/settlements.ts \
  test/integration/routes/settlement-finalization-canonical.test.ts \
  test/integration/routes/settlements.test.ts
git commit -m "feat(canonical): integrate settlement finalization"
```

---

### Task 5: Coverage, shadow isolation and continuation contract

**Files:**
- Modify: `src/lib/canonical/financial-route-coverage.ts`
- Modify: `test/canonical/financial-route-coverage.test.ts`
- Modify: `test/integration/routes/financial-shadow-route-isolation.test.ts`
- Modify: `test/canonical/main-based-continuation-contract.test.ts`

- [ ] **Step 1: Mark the boundary integrated**

Set:

```ts
'settlement.finalize': {
  boundary: 'settlement.finalize',
  status: 'integrated',
  routeFile: 'src/routes/tenant/settlements.ts',
  canonicalCommand: 'finalizeSettlement',
  reason: 'Multi-bill settlement preserves the original legacy allocation and accounting workflow in disabled and shadow modes while strict mode atomically commits guarded settlement, payment, deposit-application and discount authority with canonical invoice balances.',
}
```

- [ ] **Step 2: Remove the final alternate-writer blocker expectation**

`alternateWriterCoverage` should contain no `settlement.finalize` entry. Assert the registry entry is integrated.

- [ ] **Step 3: Add cross-route shadow isolation**

Extract the original adapter section and assert it contains legacy settlement/payment/deposit/discount SQL but not:

```text
canonical_
prepareFinancialBatchAssertion
changes()
```

- [ ] **Step 4: Update continuation expectations**

The tracker section `remaining_runtime_boundaries:` must contain no listed boundary. Update P11 phase text to:

```text
p11: all_registered_runtime_boundaries_integrated_local_verification_pending
```

and ensure all prior boundaries remain absent.

- [ ] **Step 5: Run coverage gates**

```bash
pnpm vitest run \
  test/canonical/financial-route-coverage.test.ts \
  test/integration/routes/financial-shadow-route-isolation.test.ts \
  test/canonical/main-based-continuation-contract.test.ts
pnpm canonical:check
```

- [ ] **Step 6: Commit coverage**

```bash
git add \
  src/lib/canonical/financial-route-coverage.ts \
  test/canonical/financial-route-coverage.test.ts \
  test/integration/routes/financial-shadow-route-isolation.test.ts \
  test/canonical/main-based-continuation-contract.test.ts
git commit -m "chore(canonical): register settlement authority"
```

---

### Task 6: Adversarial review and corrections

**Files:**
- Modify only files implicated by a proved finding.
- Add the failing regression to the nearest settlement command/adapter/route test before each fix.

- [ ] **Step 1: Review original legacy parity**

Compare the pre-refactor route and adapter for:

- statement order;
- bill sort order;
- component allocation order;
- receipt names;
- optional credit-bill behavior;
- accounting-event payloads;
- audit payload;
- result-ID fallback;
- request-idempotency timing;
- post-commit cash-ledger behavior.

- [ ] **Step 2: Review strict race coverage**

Verify commit-time guards cover:

- every legacy bill field used by planning;
- every canonical invoice balance field;
- every canonical deposit balance field;
- invoice mappings;
- counter/session authority;
- source-row identity;
- duplicate settlement/payment/deposit/discount receipt conflicts.

- [ ] **Step 3: Review canonical accounting semantics**

Assert:

```text
legacy paid increment = cash + deposit + discount
canonical paid increment = cash + deposit
canonical credited increment = discount
legacy due after = canonical net due after
```

for every bill, including pre-existing credits and partial settlement.

- [ ] **Step 4: Review shadow behavior**

Prove missing historical canonical authority records an issue and cannot block legacy success. Prove no strict-only query runs before the original legacy batch in disabled/shadow mode.

- [ ] **Step 5: Review source mappings**

Mutate or delete each committed legacy source row before canonical mapping and prove the outer batch fails/rolls back in strict mode.

- [ ] **Step 6: Fix each proved Critical/High finding with RED/GREEN tests**

Use one focused commit per coherent correction. For a command or adapter correction, stage only the proved implementation and regression files:

```bash
git add \
  src/lib/canonical/commands/finalize-settlement.ts \
  src/lib/canonical/settlement-finalization.ts \
  test/canonical/finalize-settlement.test.ts \
  test/canonical/settlement-finalization.test.ts
git commit -m "fix(canonical): harden settlement authority"
```

For a route-only correction, stage `src/routes/tenant/settlements.ts` and `test/integration/routes/settlement-finalization-canonical.test.ts` instead.

- [ ] **Step 7: Run the adversarial focused gate**

```bash
pnpm vitest run \
  test/canonical/finalize-settlement.test.ts \
  test/canonical/settlement-finalization.test.ts \
  test/integration/routes/settlement-finalization-canonical.test.ts \
  test/integration/routes/settlements.test.ts \
  test/canonical/financial-route-coverage.test.ts \
  test/integration/routes/financial-shadow-route-isolation.test.ts
pnpm exec tsc --noEmit
pnpm canonical:check
```

---

### Task 7: Verification report, tracker and current-main integration

**Files:**
- Create: `docs/database/migration-runs/P11-settlement-finalize-verification.md`
- Modify: `task-progress.yaml`
- Modify: `test/canonical/main-based-continuation-contract.test.ts`

- [ ] **Step 1: Run the task-branch full gate**

```bash
pnpm vitest run test/canonical --testTimeout=20000
pnpm exec tsc --noEmit
pnpm canonical:check
pnpm build:migrations
pnpm worktree:check -- --mode=task
pnpm build:web
pnpm build:patient
pnpm build:admin
git diff --check
```

Record exact file/test/migration counts.

- [ ] **Step 2: Write the verification report**

Document:

- design and commit chain;
- original legacy parity;
- strict preflight and race matrix;
- canonical payment/deposit/credit semantics;
- source mappings;
- route/idempotency behavior;
- adversarial findings and fixes;
- exact verification receipts;
- explicit cancellation non-claim;
- production safety statement.

- [ ] **Step 3: Update the tracker**

Set:

```yaml
status: cdb_117_settlement_finalize_integrated_local_gate
phase_assessment:
  p11: all_registered_runtime_boundaries_integrated_local_verification_complete
remaining_runtime_boundaries: []
production_mutation_authorized_now: false
```

Point `verification_report`, `design` and `plan` to CDB-117 documents.

- [ ] **Step 4: Run the final continuation contract and commit**

```bash
pnpm vitest run test/canonical/main-based-continuation-contract.test.ts
git diff --check
git add \
  task-progress.yaml \
  test/canonical/main-based-continuation-contract.test.ts \
  docs/database/migration-runs/P11-settlement-finalize-verification.md
git commit -m "docs(canonical): record settlement checkpoint"
```

- [ ] **Step 5: Synchronize with latest clean local main**

Discover the current `main` worktree from Git metadata. If main advanced, replay/cherry-pick the reviewed task commits serially. Preserve all parallel changes and resolve conflicts without discarding either side.

- [ ] **Step 6: Run post-integration verification on main**

```bash
pnpm worktree:check -- --mode=integration
pnpm vitest run \
  test/canonical/finalize-settlement.test.ts \
  test/canonical/settlement-finalization.test.ts \
  test/integration/routes/settlement-finalization-canonical.test.ts \
  test/integration/routes/settlements.test.ts \
  test/canonical/financial-route-coverage.test.ts \
  test/integration/routes/financial-shadow-route-isolation.test.ts \
  test/canonical/main-based-continuation-contract.test.ts
pnpm vitest run test/canonical --testTimeout=20000
pnpm exec tsc --noEmit
pnpm canonical:check
pnpm build:migrations
pnpm build:web
pnpm build:patient
pnpm build:admin
git diff --check
```

- [ ] **Step 7: Record and commit the main integration receipt**

Update tracker/report with the final main head and exact counts, then:

```bash
git add task-progress.yaml docs/database/migration-runs/P11-settlement-finalize-verification.md
git commit -m "docs(canonical): record settlement main integration"
```

- [ ] **Step 8: Stop before production actions**

Do not push, deploy, migrate, backfill or enable strict mode. Report the local completion state and any explicitly remaining non-P11 scope such as settlement cancellation or production authorization.
