# Canonical Appointment Billing Finalize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate appointment credit billing and pay-now under one strict canonical financial boundary, with atomic legacy/canonical authority for paid invoices.

**Architecture:** Add a reusable `issueInvoiceWithFullPayment` command for one invoice paid in full by one captured tender. Add a deterministic appointment projection that represents provisional consultation items as evidence-rich `other_adjustment` invoice lines, then route both credit and paid modes through `executeStrictFinancialMutation` with row-count-guarded legacy statements.

**Tech Stack:** TypeScript, Hono, Cloudflare D1, Vitest, `node:sqlite`, canonical command batch/idempotency/outbox framework.

## Global Constraints

- Production mutation authorization is false.
- Do not deploy, apply migrations, backfill, change feature flags, change traffic, observe production or mutate tenant data.
- Do not invent canonical service-event authority from appointment doctor IDs.
- Paid mode supports one newly issued invoice, one captured tender, one full allocation and zero unallocated balance only.
- Credit mode continues to use `issueInvoice`.
- Every production behavior change follows RED → GREEN → refactor.
- Preserve existing request idempotency and post-commit queue, audit, commission, scheme and cash-ledger behavior.
- Existing unrelated dirty work in other worktrees must remain untouched.

---

### Task 1: Atomic full-payment invoice command

**Files:**
- Create: `src/lib/canonical/commands/issue-invoice-full-payment.ts`
- Create: `test/canonical/issue-invoice-full-payment.test.ts`
- Modify: `src/lib/canonical/accounting-poster.ts`
- Modify: `test/canonical/accounting-reconciliation.test.ts`

**Interfaces:**
- Consumes: canonical command-batch primitives and invoice/payment schemas from `issue-invoice.ts` and `collect-payment.ts`.
- Produces: `issueInvoiceWithFullPayment(db, input, execution?)` returning `{ invoicePublicId, receiptPublicId, invoiceTotalMinor, paidMinor, cashTenderMinor, status: 'paid' }`.

- [ ] **Step 1: Write a real SQLite RED test for cash payment**

Create a fixture using migrations `0505` through the latest canonical billing/payment tables. Call the wished-for API:

```ts
const result = await issueInvoiceWithFullPayment(db, {
  tenantId: '100',
  commandIdempotencyKey: 'appointment-paid:100:77:INV-1:RCP-1',
  invoice: {
    tenantId: '100',
    invoicePublicId: 'inv-full-1',
    invoiceNumber: 'INV-1',
    legacyPatientId: 501,
    currencyCode: 'BDT',
    issuedAtUtc: '2026-07-23T10:00:00.000Z',
    businessDate: '2026-07-23',
    lines: [{
      linePublicId: 'line-full-1',
      lineType: 'other_adjustment',
      serviceEventPublicId: null,
      adjustmentCode: 'APPOINTMENT_DOCTOR_VISIT',
      quantity: 1,
      unitAmountMinor: 100000,
      sourceEvidenceSha256: HASH_A,
    }],
    sourceType: 'legacy_appointment_bill',
    sourcePublicId: 'appointment:77:INV-1',
    sourceTable: 'bills',
    sourceEvidenceSha256: HASH_B,
    idempotencyKey: 'unused-inner-invoice-key',
    outboxEventPublicId: 'evt-invoice-full-1',
  },
  payment: {
    receiptPublicId: 'receipt-full-1',
    receiptNumber: 'RCP-1',
    tenderPublicId: 'tender-full-1',
    allocationPublicId: 'alloc-full-1',
    tenderType: 'cash',
    methodCode: 'cash',
    externalTransactionId: null,
    legacyCollectorId: 9,
    legacyCounterId: 3,
    legacyCounterSessionId: 30,
    receivedAtUtc: '2026-07-23T10:00:00.000Z',
    sourceType: 'legacy_appointment_payment',
    sourcePublicId: 'RCP-1',
    sourceTable: 'payments',
    sourceEvidenceSha256: HASH_C,
    paymentOutboxEventPublicId: 'evt-payment-full-1',
    cashCustodyEventPublicId: 'evt-cash-full-1',
  },
});

expect(result.result.status).toBe('paid');
expect(readInvoice(sqlite)).toMatchObject({ paid_minor: 100000, due_minor: 0, net_due_minor: 0 });
expect(readReceipt(sqlite)).toMatchObject({ total_minor: 100000, allocated_total_minor: 100000, reconciliation_guard: 1 });
expect(countEvents(sqlite, 'canonical.invoice.issued')).toBe(1);
expect(countEvents(sqlite, 'canonical.payment.received')).toBe(1);
expect(countEvents(sqlite, 'canonical.cash.received')).toBe(1);
```

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm exec vitest run test/canonical/issue-invoice-full-payment.test.ts
```

Expected: failure because `issue-invoice-full-payment.ts` or the exported function does not exist.

- [ ] **Step 3: Add RED validation and rollback cases**

Add focused tests proving:

```ts
await expect(issueInvoiceWithFullPayment(db, nonCashWithoutReference)).rejects.toThrow(/external transaction/i);
await expect(issueInvoiceWithFullPayment(db, paymentAmountDifferentFromInvoice)).rejects.toThrow(/equal invoice total/i);
await expect(issueInvoiceWithFullPayment(db, changedReplayRequest)).rejects.toThrow(/idempotency/i);
```

Add an authoritative legacy fixture row and force a canonical duplicate to prove both legacy and canonical rows roll back.

- [ ] **Step 4: Implement minimal combined command**

Create these exported types:

```ts
export interface FullPaymentAuthorityInput {
  receiptPublicId: string;
  receiptNumber: string;
  tenderPublicId: string;
  allocationPublicId: string;
  tenderType: PaymentTenderType;
  methodCode: string;
  externalTransactionId?: string | null;
  legacyCollectorId?: number | null;
  legacyCounterId?: number | null;
  legacyCounterSessionId?: number | null;
  receivedAtUtc: string;
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
  paymentOutboxEventPublicId: string;
  cashCustodyEventPublicId?: string | null;
}

export interface IssueInvoiceWithFullPaymentInput {
  tenantId: string;
  commandIdempotencyKey: string;
  invoice: IssueInvoiceInput;
  payment: FullPaymentAuthorityInput;
}
```

Validate invoice lines with the same rules as `issueInvoice`, calculate total in minor units, require `totalMinor > 0`, and create one `runCanonicalBatch` containing:

```sql
INSERT INTO canonical_invoices (... paid_minor,due_minor,credited_minor,net_due_minor,status ...)
VALUES (..., total_minor, 0, 0, 0, 'posted', ...);

INSERT INTO canonical_payment_receipts (... total_minor,allocated_total_minor,unallocated_minor,refunded_minor,net_received_minor,status,reconciliation_guard ...)
VALUES (..., total_minor,total_minor,0,0,total_minor,'posted',1,...);

INSERT INTO canonical_payment_tenders (... amount_minor,status,reversed_minor,remaining_minor ...)
VALUES (..., total_minor,'captured',0,total_minor,...);

INSERT INTO canonical_payment_allocations (... amount_minor,invoice_due_before_minor,invoice_due_after_minor,status,reversed_minor,remaining_minor,balance_guard ...)
VALUES (..., total_minor,total_minor,0,'active',0,total_minor,1,...);
```

Insert invoice/receipt/payment mappings and three deterministic outbox events. Use one combined request shape and `commandName: 'canonical.invoice.issue_full_payment'`.

- [ ] **Step 5: Run GREEN and accounting regression**

Run:

```bash
pnpm exec vitest run test/canonical/issue-invoice-full-payment.test.ts test/canonical/accounting-reconciliation.test.ts
```

Expected: all tests pass and invoice/payment vouchers balance with net accounts receivable zero.

- [ ] **Step 6: Commit**

```bash
git add src/lib/canonical/commands/issue-invoice-full-payment.ts src/lib/canonical/accounting-poster.ts test/canonical/issue-invoice-full-payment.test.ts test/canonical/accounting-reconciliation.test.ts
git commit -m "feat(canonical): issue fully paid invoices atomically"
```

---

### Task 2: Deterministic appointment financial projection

**Files:**
- Create: `src/lib/canonical/live-appointment-billing.ts`
- Create: `test/canonical/live-appointment-billing.test.ts`

**Interfaces:**
- Consumes: validated appointment/provisional-item values from the route.
- Produces: `buildAppointmentInvoiceProjection(input)` and `buildAppointmentFullPaymentProjection(input)`.

- [ ] **Step 1: Write RED projection tests**

Define the wished-for input:

```ts
const invoice = await buildAppointmentInvoiceProjection({
  tenantId: '100',
  appointmentId: 77,
  patientId: 501,
  invoiceNo: 'INV-A-1',
  issuedAtUtc: '2026-07-23T10:00:00.000Z',
  businessDate: '2026-07-23',
  items: [{
    provisionalItemId: 901,
    category: 'doctor_visit',
    description: 'Consultation - Dr. A',
    quantity: 1,
    unitPrice: 1000,
    discountAmount: 300,
    totalAmount: 700,
    doctorId: 101,
    referenceId: 101,
  }],
});
```

Assert:

```ts
expect(invoice.lines).toHaveLength(2);
expect(invoice.lines[0]).toMatchObject({
  lineType: 'other_adjustment',
  adjustmentCode: 'APPOINTMENT_DOCTOR_VISIT',
  quantity: 1,
  unitAmountMinor: 100000,
  serviceEventPublicId: null,
});
expect(invoice.lines[1]).toMatchObject({ lineType: 'discount', unitAmountMinor: -30000 });
expect(totalFromProjection(invoice)).toBe(70000);
```

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm exec vitest run test/canonical/live-appointment-billing.test.ts
```

Expected: missing module/export failure.

- [ ] **Step 3: Add method and authority tests**

Cover `cash`, `card`, `bkash`, `nagad`, `rocket`, `bank_transfer`, `bank`, `cheque`, and `other`. Assert that doctor/reference IDs occur only inside source evidence input and never as `serviceEventPublicId`.

Require:

```ts
await expect(buildAppointmentFullPaymentProjection(nonCashWithoutExternalReference))
  .rejects.toThrow(/transaction\/reference/i);
```

- [ ] **Step 4: Implement minimal projection**

Use `createDeterministicSourceId`, `createSourceEvidenceSha256`, `toMinorUnits`, `toUtcIso` and `deriveBusinessDate`.

Normalize adjustment codes with:

```ts
function appointmentAdjustmentCode(category: string): string {
  const suffix = category.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `APPOINTMENT_${suffix || 'OTHER'}`;
}
```

Generate stable identities from appointment ID, invoice number, provisional item ID and receipt number. Build one `IssueInvoiceInput` and, for paid mode, one `IssueInvoiceWithFullPaymentInput`.

- [ ] **Step 5: Run GREEN**

Run:

```bash
pnpm exec vitest run test/canonical/live-appointment-billing.test.ts test/canonical/live-financial-projection.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/canonical/live-appointment-billing.ts test/canonical/live-appointment-billing.test.ts
git commit -m "feat(canonical): project appointment billing authority"
```

---

### Task 3: Guarded appointment route integration

**Files:**
- Modify: `src/routes/tenant/appointments.ts:710-1092`
- Create: `test/integration/routes/appointment-billing-canonical.test.ts`
- Modify: `test/integration/routes/appointment-billing-handoff.test.ts`
- Modify: `src/lib/billing-refund-batch-guard.ts` only if the existing nested assertion helper is reusable and needs no behavior expansion.

**Interfaces:**
- Consumes: projection functions from Task 2 and canonical commands from Tasks 1-2.
- Produces: direct route integration for both `paid` and `credit` modes.

- [ ] **Step 1: Write RED source-contract tests**

Assert the route source contains:

```ts
expect(source).toContain("executeStrictFinancialMutation");
expect(source).toContain("'appointment.billing.finalize'");
expect(source).toContain('issueInvoiceWithFullPayment');
expect(source).toContain('issueInvoice');
expect(source).toContain('canonical_financial_batch_assertions');
```

Assert `recordAccountingPostingEvent` is no longer called post-commit for bill-created/payment-received events in this function.

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm exec vitest run test/integration/routes/appointment-billing-canonical.test.ts
```

Expected: missing strict coordinator/command integration.

- [ ] **Step 3: Add RED route behavior tests**

Cover:

```ts
expect(await payNow('cash')).toMatchObject({ status: 201, billingStatus: 'paid' });
expect(await dueApproval()).toMatchObject({ status: 201, billingStatus: 'due_approved' });
expect(await payNow('card', undefined)).toMatchObject({ status: 400 });
expect(await concurrentFinalize()).toMatchObject({ status: 409 });
```

Verify the canonical command failure leaves no legacy bill/payment/appointment transition in a real batch fixture or strict coordinator harness.

- [ ] **Step 4: Build guarded legacy statements**

Replace the direct `DB.batch(coreBatch)` with statements that insert an assertion row before each critical statement and update it from `changes()` afterward. Guard:

```sql
INSERT INTO bills ... SELECT ...
WHERE NOT EXISTS (SELECT 1 FROM bills WHERE tenant_id=? AND invoice_no=?);

UPDATE appointments
SET billing_status=?, ...
WHERE id=? AND tenant_id=? AND COALESCE(billing_status,'unpaid')=?
  AND EXISTS (...new bill...);
```

Each provisional item update must include its originally read ID, `bill_status='provisional'` and `is_active=1`. Expected changes are exactly one.

- [ ] **Step 5: Integrate strict coordinator**

Import:

```ts
import { executeStrictFinancialMutation } from '../../lib/canonical/strict-financial-mutation';
import { issueInvoice } from '../../lib/canonical/commands/issue-invoice';
import { issueInvoiceWithFullPayment } from '../../lib/canonical/commands/issue-invoice-full-payment';
import { buildAppointmentInvoiceProjection, buildAppointmentFullPaymentProjection } from '../../lib/canonical/live-appointment-billing';
```

Execute:

```ts
const financialExecution = await executeStrictFinancialMutation({
  db: c.env.DB,
  tenantId,
  boundary: 'appointment.billing.finalize',
  legacyStatements,
  canonicalMutation: async ({ authoritativeStatements }) => mode === 'paid'
    ? issueInvoiceWithFullPayment(c.env.DB, paidProjection, { authoritativeStatements })
    : issueInvoice(c.env.DB, invoiceProjection, { authoritativeStatements }),
});
```

Use the coordinator result when available, then query by `(tenant_id, invoice_no)` as the strict/mock-compatible identity fallback.

- [ ] **Step 6: Run GREEN route tests**

Run:

```bash
pnpm exec vitest run test/integration/routes/appointment-billing-canonical.test.ts test/integration/routes/appointment-billing-handoff.test.ts
```

Expected: all tests pass, including existing response and HTTP idempotency tests.

- [ ] **Step 7: Commit**

```bash
git add src/routes/tenant/appointments.ts test/integration/routes/appointment-billing-canonical.test.ts test/integration/routes/appointment-billing-handoff.test.ts
git commit -m "feat(canonical): finalize appointment billing atomically"
```

---

### Task 4: Preserve commission and post-commit behavior without duplicate accounting events

**Files:**
- Modify: `src/lib/billing-finalization.ts`
- Modify: `test/billing-finalization.test.ts` or the closest existing billing-finalization test file
- Modify: `src/routes/tenant/appointments.ts`
- Modify: `test/integration/routes/appointment-billing-handoff.test.ts`

**Interfaces:**
- Consumes: existing `recordBillFinalizationSideEffects` input.
- Produces: optional `skipBillAccountingEvent?: boolean` that suppresses only the legacy bill-created posting event.

- [ ] **Step 1: Write RED unit test**

Call:

```ts
await recordBillFinalizationSideEffects(db, {
  ...input,
  skipBillAccountingEvent: true,
});
```

Assert commission/reserve calls still occur and no `bill_created` accounting event is inserted.

- [ ] **Step 2: Run RED**

Run the exact billing-finalization test file. Expected: type or behavior failure because the option does not exist.

- [ ] **Step 3: Implement the narrow option**

Extend `BillFinalizationInput`:

```ts
skipBillAccountingEvent?: boolean;
```

Wrap only the final call:

```ts
if (!input.skipBillAccountingEvent) {
  await recordAccountingPostingEvent(...);
}
```

Set `skipBillAccountingEvent: true` from appointment finalization because the guarded legacy batch already inserted the event.

- [ ] **Step 4: Verify post-commit behaviors**

Run:

```bash
pnpm exec vitest run test/integration/routes/appointment-billing-handoff.test.ts test/canonical/live-doctor-compensation.test.ts
```

Expected: queue, consultation commission, audit, scheme usage and cash-ledger assertions pass; duplicate accounting event calls are absent.

- [ ] **Step 5: Commit**

```bash
git add src/lib/billing-finalization.ts src/routes/tenant/appointments.ts test/billing-finalization.test.ts test/integration/routes/appointment-billing-handoff.test.ts
git commit -m "fix(billing): avoid duplicate appointment posting events"
```

---

### Task 5: Registry, adversarial review, evidence and merge gate

**Files:**
- Modify: `src/lib/canonical/financial-route-coverage.ts`
- Modify: `test/canonical/financial-route-coverage.test.ts`
- Modify: `test/canonical/main-based-continuation-contract.test.ts`
- Modify: `task-progress.yaml`
- Create: `docs/database/migration-runs/P10-appointment-billing-finalize-verification.md`

**Interfaces:**
- Consumes: completed route and command behavior.
- Produces: `appointment.billing.finalize` registry status `integrated`, verification evidence and next checkpoint `billing-provisional.finalize`.

- [ ] **Step 1: Write RED registry test**

Change the expected boundary status to:

```ts
expect(FINANCIAL_ROUTE_COVERAGE['appointment.billing.finalize']).toMatchObject({
  status: 'integrated',
  canonicalCommand: 'issueInvoice / issueInvoiceWithFullPayment',
});
```

Run the test and confirm it fails against `blocked_in_strict`.

- [ ] **Step 2: Update registry and route coverage**

Set the boundary to `integrated` only after both paid and credit tests are green. Keep every other remaining alternate writer blocked.

- [ ] **Step 3: Run adversarial review**

Review the diff for:

- stale appointment-status races;
- partial provisional-item finalization;
- missing non-cash external authority;
- duplicate receipt/invoice identity;
- cash custody emitted for non-cash tenders;
- original route idempotency regression;
- duplicate legacy accounting events;
- commission/queue work occurring before commit;
- any invented service authority;
- authoritative legacy rollback on canonical failure.

For every Critical/High finding, write a failing regression test before fixing it.

- [ ] **Step 4: Run focused and full verification**

Run:

```bash
pnpm exec vitest run test/canonical/issue-invoice-full-payment.test.ts test/canonical/live-appointment-billing.test.ts test/integration/routes/appointment-billing-canonical.test.ts test/integration/routes/appointment-billing-handoff.test.ts test/canonical/accounting-reconciliation.test.ts test/canonical/financial-route-coverage.test.ts
pnpm exec vitest run test/canonical
./node_modules/.bin/tsc --noEmit
pnpm canonical:check
pnpm build
```

Expected:

- all focused tests pass;
- full canonical suite passes;
- TypeScript exits 0;
- governance reports 0 issues;
- migration manifest remains 465 unless latest-main work changes it;
- production build exits 0.

- [ ] **Step 5: Write evidence and tracker**

Record exact commands, counts, commit SHAs, accounting behavior, concurrency coverage, no-production-mutation statement and next boundary in `P10-appointment-billing-finalize-verification.md`.

Remove `appointment.billing.finalize` from `remaining_runtime_boundaries`, set:

```yaml
current_checkpoint: CDB-108-BILLING-PROVISIONAL-FINALIZE-NEXT
last_completed_checkpoint: CDB-107_appointment_billing_finalize_integrated
next_exact_action: design_and_integrate_billing_provisional_finalize_from_latest_local_main
```

- [ ] **Step 6: Final diff and commit**

Run:

```bash
git diff --check
```

Commit:

```bash
git add src/lib/canonical/financial-route-coverage.ts test/canonical/financial-route-coverage.test.ts test/canonical/main-based-continuation-contract.test.ts task-progress.yaml docs/database/migration-runs/P10-appointment-billing-finalize-verification.md
git commit -m "docs(canonical): verify appointment billing finalization"
```

- [ ] **Step 7: Rebase and local-main integration**

If local `main` advanced, rebase the clean branch onto the latest local `main`, rerun focused/full gates, then fast-forward the dedicated local-main worktree. Preserve all existing `.ai-bridge` changes. Do not push or deploy without a separate explicit instruction.
