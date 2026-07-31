# Item-Based Partial Refund with Cash Hold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an item-based full/partial refund request flow in the reception patient drawer where the canonical cash refund amount is held from the requester's active counter at submission, finalized once on approval, and released on rejection.

**Architecture:** Introduce a durable `billing_refund_cash_holds` table and two focused domain modules: one for item eligibility/refund calculation and one for hold lifecycle/counter availability. The approvals route remains the workflow orchestrator, but it delegates canonical calculations and cash-hold transitions. Approved refund requests create and process one credit note for the selected invoice items in the same approval execution, using the originating counter session rather than the reviewer's counter.

**Tech Stack:** Cloudflare Workers, Hono, D1/SQLite, Drizzle schema declarations, TypeScript, Zod, React, TanStack Query wrappers, Vitest, Testing Library.

## Global Constraints

- D1 is the financial source of truth; no client-calculated amount is trusted.
- Request submission creates a cash reservation only. It must not create a credit note, `SalesReturn`, income reversal, accounting posting event, commission reversal, or clinical cancellation.
- Approval consumes the originating counter hold and posts the refund exactly once; it must not debit the reviewer’s counter and must not decrease available cash a second time.
- Rejection releases the hold and creates no refund/accounting/clinical side effects.
- Completed or verified diagnostic services are blocked from the standard reception refund flow.
- The same invoice quantity cannot be reserved or refunded twice.
- Cash-handling mutations require the requester's active counter session on the current workstation.
- A counter session with an active refund hold cannot close or auto-close.
- Existing full-refund, direct Credit Notes, bill-cancellation, and payment-void workflows must continue to work.
- Tenant scope and maker-checker separation must be enforced on every read and write.
- Do not modify unrelated dirty files already present in the source workspace.

---

## File Map

**Create**

- `migrations/0421_billing_refund_cash_holds.sql` — durable refund hold table and indexes.
- `src/lib/billing-refund.ts` — canonical item loading, clinical eligibility, pending/approved quantity accounting, and selected refund calculation.
- `src/lib/billing-refund-cash-hold.ts` — create/load/consume/release holds and calculate counter available cash.
- `test/billing-refund-cash-hold-migration.test.ts` — migration, tenant schema, and Drizzle parity checks.
- `test/billing-refund-domain.test.ts` — pure/domain refund selection tests.
- `test/integration/routes/refund-approval-cash-holds.test.ts` — request/approve/reject/idempotency/tenant isolation workflow tests.

**Modify**

- `tenant-schema.sql` — fresh local tenant table parity.
- `src/db/schema/schema.ts` — Drizzle declaration for the hold table.
- `src/data/schema-migrations.generated.ts` — generated migration manifest after adding migration 0421.
- `src/schemas/approval.ts` — typed item-based refund request schema and request idempotency key.
- `src/lib/billing-counter-session.ts` — hold-aware operational cash summary and stale-session guard.
- `src/routes/tenant/billingCounter.ts` — active-session hold fields and close guard.
- `src/routes/tenant/creditNotes.ts` — use shared canonical refund helpers and support processing against an originating hold/session without a second payout step.
- `src/routes/tenant/approvals.ts` — request+hold creation, selected-item approval, hold consumption, and rejection release.
- `test/billing-refund-approval.test.ts` — preserve direct credit-note behavior while covering hold-origin processing.
- `test/integration/routes/approvals.test.ts` — approval worklist hold hydration and rejection behavior.
- `test/unit/billing-counter-session.test.ts` — hold-aware available cash and auto-close behavior.
- `web/src/components/reception/ReceptionPatientDrawer.tsx` — full/partial selector, item loading/selection, canonical preview, active-counter/hold messaging, request payload.
- `web/src/components/reception/ReceptionPatientDrawer.test.tsx` — item selection, blocked services, amount calculation, and payload tests.
- `web/src/components/admin/ApprovalDetailDrawer.tsx` — show selected items and cash-hold state in reviewer details.
- `web/src/components/admin/ApprovalDetailDrawer.test.tsx` — reviewer-facing refund hold presentation.
- `web/src/pages/ApprovalCenter.tsx` — count pending refund approval requests rather than only pending direct credit notes.
- `web/src/pages/ApprovalCenter.test.tsx` — approval-center refund queue count contract.

---

### Task 1: Add the durable refund cash-hold schema

**Files:**
- Create: `migrations/0421_billing_refund_cash_holds.sql`
- Modify: `tenant-schema.sql`
- Modify: `src/db/schema/schema.ts`
- Modify: `src/data/schema-migrations.generated.ts`
- Test: `test/billing-refund-cash-hold-migration.test.ts`

**Interfaces:**
- Produces table `billing_refund_cash_holds` with one durable lifecycle row per approval request.
- Later tasks rely on statuses `held | consumed | released` and unique `(tenant_id, approval_request_id)` / `(tenant_id, idempotency_key)` constraints.

- [x] **Step 1: Write the failing migration parity test**

Create `test/billing-refund-cash-hold-migration.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('migrations/0421_billing_refund_cash_holds.sql', 'utf8');
const tenantSchema = readFileSync('tenant-schema.sql', 'utf8');
const drizzle = readFileSync('src/db/schema/schema.ts', 'utf8');

describe('billing refund cash hold schema', () => {
  it('creates the durable hold table with lifecycle and uniqueness guards', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS billing_refund_cash_holds');
    expect(migration).toMatch(/status\s+TEXT\s+NOT NULL\s+DEFAULT 'held'/);
    expect(migration).toContain("CHECK (status IN ('held', 'consumed', 'released'))");
    expect(migration).toContain('UNIQUE (tenant_id, approval_request_id)');
    expect(migration).toContain('UNIQUE (tenant_id, idempotency_key)');
    expect(migration).toContain('counter_session_id INTEGER NOT NULL');
    expect(migration).toContain('amount REAL NOT NULL CHECK (amount > 0)');
  });

  it('mirrors the table in fresh-install and Drizzle schemas', () => {
    expect(tenantSchema).toContain('CREATE TABLE IF NOT EXISTS billing_refund_cash_holds');
    expect(drizzle).toContain('export const billingRefundCashHolds');
    expect(drizzle).toContain('"billing_refund_cash_holds"');
    expect(drizzle).toContain('uniqueIndex("uq_refund_hold_approval")');
    expect(drizzle).toContain('uniqueIndex("uq_refund_hold_idempotency")');
  });
});
```

- [x] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm vitest run test/billing-refund-cash-hold-migration.test.ts
```

Expected: FAIL because migration `0421_billing_refund_cash_holds.sql` and the Drizzle table do not exist.

- [x] **Step 3: Create migration 0421**

Create `migrations/0421_billing_refund_cash_holds.sql` with:

```sql
CREATE TABLE IF NOT EXISTS billing_refund_cash_holds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  approval_request_id INTEGER NOT NULL,
  bill_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method = 'cash'),
  employee_id INTEGER NOT NULL,
  counter_id INTEGER NOT NULL,
  counter_session_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'consumed', 'released')),
  idempotency_key TEXT NOT NULL,
  credit_note_id INTEGER,
  held_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  consumed_at TEXT,
  released_at TEXT,
  resolved_by INTEGER,
  resolution_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  UNIQUE (tenant_id, approval_request_id),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_refund_holds_tenant_status
  ON billing_refund_cash_holds(tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_refund_holds_counter_session
  ON billing_refund_cash_holds(tenant_id, counter_session_id, status);
CREATE INDEX IF NOT EXISTS idx_refund_holds_bill_status
  ON billing_refund_cash_holds(tenant_id, bill_id, status);
```

Mirror the exact table and indexes in `tenant-schema.sql`. Add the Drizzle declaration using `integer`, `real`, `text`, `index`, `uniqueIndex`, and `check` in `src/db/schema/schema.ts`.

- [x] **Step 4: Regenerate the migration manifest**

Run:

```bash
pnpm build:migrations
```

Expected: PASS and `src/data/schema-migrations.generated.ts` includes migration `0421_billing_refund_cash_holds.sql`.

- [x] **Step 5: Run the schema tests**

Run:

```bash
pnpm vitest run test/billing-refund-cash-hold-migration.test.ts test/build-migration-manifest.test.ts test/production-migration-guard.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add migrations/0421_billing_refund_cash_holds.sql tenant-schema.sql src/db/schema/schema.ts src/data/schema-migrations.generated.ts test/billing-refund-cash-hold-migration.test.ts
git commit -m "feat: add durable billing refund cash holds"
```

---

### Task 2: Build canonical item eligibility and refund calculation

**Files:**
- Create: `src/lib/billing-refund.ts`
- Test: `test/billing-refund-domain.test.ts`
- Modify: `src/routes/tenant/creditNotes.ts`
- Test: `test/integration/routes/credit-notes.test.ts`

**Interfaces:**

```ts
export type RefundSelectionInput = {
  invoiceItemId: number;
  returnQuantity: number;
};

export type RefundableInvoiceItem = {
  invoiceItemId: number;
  description: string;
  itemCategory: string;
  quantity: number;
  approvedReturnedQuantity: number;
  pendingReservedQuantity: number;
  availableQuantity: number;
  refundableUnitAmount: number;
  clinicalStatus: string | null;
  eligible: boolean;
  blockReason: string | null;
};

export type RefundCalculation = {
  items: Array<RefundableInvoiceItem & {
    returnQuantity: number;
    refundAmount: number;
  }>;
  totalRefund: number;
};

export async function loadRefundableInvoiceItems(
  db: D1Database,
  tenantId: string,
  billId: number,
  options?: { excludeApprovalRequestId?: number },
): Promise<RefundableInvoiceItem[]>;

export function calculateRefundSelection(
  items: RefundableInvoiceItem[],
  selections: RefundSelectionInput[],
): RefundCalculation;
```

- [x] **Step 1: Write failing domain tests**

Create `test/billing-refund-domain.test.ts` with tests that prove:

```ts
it('calculates item-based refund from net line amount and selected quantity', () => {
  const result = calculateRefundSelection([
    {
      invoiceItemId: 101,
      description: 'CBC',
      itemCategory: 'test',
      quantity: 2,
      approvedReturnedQuantity: 0,
      pendingReservedQuantity: 0,
      availableQuantity: 2,
      refundableUnitAmount: 400,
      clinicalStatus: 'pending',
      eligible: true,
      blockReason: null,
    },
  ], [{ invoiceItemId: 101, returnQuantity: 1 }]);

  expect(result.totalRefund).toBe(400);
  expect(result.items[0].refundAmount).toBe(400);
});

it('rejects completed or verified diagnostic items', () => {
  expect(() => calculateRefundSelection([
    {
      invoiceItemId: 102,
      description: 'LFT',
      itemCategory: 'test',
      quantity: 1,
      approvedReturnedQuantity: 0,
      pendingReservedQuantity: 0,
      availableQuantity: 1,
      refundableUnitAmount: 800,
      clinicalStatus: 'verified',
      eligible: false,
      blockReason: 'Completed or verified services cannot be refunded',
    },
  ], [{ invoiceItemId: 102, returnQuantity: 1 }])).toThrow(/completed|verified/i);
});

it('rejects quantities already approved or pending', () => {
  expect(() => calculateRefundSelection([
    {
      invoiceItemId: 103,
      description: 'X-Ray',
      itemCategory: 'test',
      quantity: 2,
      approvedReturnedQuantity: 1,
      pendingReservedQuantity: 1,
      availableQuantity: 0,
      refundableUnitAmount: 500,
      clinicalStatus: 'pending',
      eligible: false,
      blockReason: 'No refundable quantity remains',
    },
  ], [{ invoiceItemId: 103, returnQuantity: 1 }])).toThrow(/quantity|refundable/i);
});
```

- [x] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm vitest run test/billing-refund-domain.test.ts
```

Expected: FAIL because `src/lib/billing-refund.ts` does not exist.

- [x] **Step 3: Implement the domain module**

Implement `roundMoney`, duplicate-selection rejection, integer quantity validation, and the two exported functions. `loadRefundableInvoiceItems` must:

- select invoice items for the tenant/bill;
- count approved returned quantity only from active credit notes in `approved` status;
- count pending quantity from active direct credit notes in `pending` status;
- count pending approval request quantities from `request_data.items`, excluding `options.excludeApprovalRequestId`;
- derive `refundableUnitAmount` from `line_total / quantity`, falling back to `unit_price`;
- resolve lab status from `lab_order_items` when an invoice item references a lab item;
- resolve radiology status from `radiology_requisitions` when an invoice item references a radiology requisition;
- mark `completed`, `verified`, `reported`, `cancelled`, and fully reserved/refunded rows ineligible;
- return generic non-diagnostic active invoice items as eligible when quantity remains.

Use stable user-facing block reasons, not raw SQL status strings.

- [x] **Step 4: Make the credit-note invoice endpoint use the shared loader**

Replace the ad-hoc returned-quantity query in `GET /api/credit-notes/invoice/:billId` with `loadRefundableInvoiceItems`. Keep existing response compatibility and add:

```ts
{
  id: item.invoiceItemId,
  description: item.description,
  item_category: item.itemCategory,
  quantity: item.quantity,
  returned_qty: item.approvedReturnedQuantity,
  pending_qty: item.pendingReservedQuantity,
  available_qty: item.availableQuantity,
  refundable_unit_amount: item.refundableUnitAmount,
  clinical_status: item.clinicalStatus,
  eligible: item.eligible,
  block_reason: item.blockReason,
}
```

Make direct credit-note creation call `calculateRefundSelection` so it shares the same quantity and amount rules.

- [x] **Step 5: Run domain and credit-note tests**

Run:

```bash
pnpm vitest run test/billing-refund-domain.test.ts test/integration/routes/credit-notes.test.ts test/billing-refund-approval.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/lib/billing-refund.ts src/routes/tenant/creditNotes.ts test/billing-refund-domain.test.ts test/integration/routes/credit-notes.test.ts test/billing-refund-approval.test.ts
git commit -m "feat: centralize refundable invoice item rules"
```

---

### Task 3: Build the cash-hold lifecycle and hold-aware counter availability

**Files:**
- Create: `src/lib/billing-refund-cash-hold.ts`
- Modify: `src/lib/billing-counter-session.ts`
- Test: `test/unit/billing-counter-session.test.ts`
- Test: `test/integration/routes/refund-approval-cash-holds.test.ts`

**Interfaces:**

```ts
export type RefundCashHold = {
  id: number;
  approvalRequestId: number;
  billId: number;
  patientId: number;
  amount: number;
  paymentMethod: 'cash';
  employeeId: number;
  counterId: number;
  counterSessionId: number;
  status: 'held' | 'consumed' | 'released';
  creditNoteId: number | null;
};

export async function getActiveRefundHoldTotal(
  db: D1Database,
  tenantId: string,
  counterSessionId: number,
): Promise<number>;

export async function getCounterAvailableCash(
  db: D1Database,
  tenantId: string,
  counterSessionId: number,
): Promise<{ expectedCash: number; heldRefundCash: number; availableCash: number }>;

export async function loadHeldRefundCashHold(
  db: D1Database,
  tenantId: string,
  approvalRequestId: number,
): Promise<RefundCashHold | null>;
```

The approvals route creates the approval and hold in one D1 batch. The hold module supplies statement builders:

```ts
export function prepareCreateRefundHold(
  db: D1Database,
  input: {
    tenantId: string;
    approvalRequestIdLookupSql: string;
    approvalLookupBindings: unknown[];
    billId: number;
    patientId: number;
    amount: number;
    employeeId: number;
    counterId: number;
    counterSessionId: number;
    idempotencyKey: string;
  },
): D1PreparedStatement;

export function prepareConsumeRefundHold(
  db: D1Database,
  input: { tenantId: string; holdId: number; reviewerId: number; creditNoteId: number },
): D1PreparedStatement;

export function prepareReleaseRefundHold(
  db: D1Database,
  input: { tenantId: string; holdId: number; reviewerId: number; reason: string },
): D1PreparedStatement;
```

- [x] **Step 1: Write failing cash-summary tests**

Add tests asserting:

```ts
expect(summary.expectedCash).toBe(5000);
expect(summary.heldRefundCash).toBe(1200);
expect(summary.availableCash).toBe(3800);
```

Also assert consumed/released rows are excluded and active holds prevent stale auto-close.

- [x] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm vitest run test/unit/billing-counter-session.test.ts test/integration/routes/refund-approval-cash-holds.test.ts
```

Expected: FAIL because hold-aware summary functions do not exist.

- [x] **Step 3: Implement hold-aware summary**

In `calculateBillingCounterSessionCashSummary`, include:

```sql
COALESCE((
  SELECT SUM(h.amount)
  FROM billing_refund_cash_holds h
  WHERE h.tenant_id = s.tenant_id
    AND h.counter_session_id = s.id
    AND h.status = 'held'
), 0) AS held_refund_cash
```

Return:

```ts
{
  ...existingFields,
  heldRefundCash,
  availableCash: expectedCash - heldRefundCash,
}
```

Update `autoCloseStaleCounterSessions` with a `NOT EXISTS` guard for `held` rows.

- [x] **Step 4: Implement the hold module**

`getCounterAvailableCash` must use the existing counter summary and subtract only `held` rows. Before statement preparation, the approvals route rejects when `availableCash < amount`. Hold lookup and lifecycle helpers must require tenant, hold ID/request ID, and current status so retries cannot consume or release twice.

- [x] **Step 5: Run tests**

Run:

```bash
pnpm vitest run test/unit/billing-counter-session.test.ts test/integration/routes/refund-approval-cash-holds.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/lib/billing-refund-cash-hold.ts src/lib/billing-counter-session.ts test/unit/billing-counter-session.test.ts test/integration/routes/refund-approval-cash-holds.test.ts
git commit -m "feat: reserve refund cash in billing counters"
```

---

### Task 4: Create item-based approval requests and holds atomically

**Files:**
- Modify: `src/schemas/approval.ts`
- Modify: `src/routes/tenant/approvals.ts`
- Test: `test/integration/routes/refund-approval-cash-holds.test.ts`
- Test: `test/unit/approval-schemas.test.ts`

**Interfaces:**

Extend the request schema with:

```ts
const refundItemSchema = z.object({
  invoiceItemId: z.number().int().positive(),
  returnQuantity: z.number().int().positive(),
});

const itemRefundRequestDataSchema = z.object({
  refundKind: z.enum(['item_partial_refund', 'bill_refund']),
  paymentMethod: z.literal('cash'),
  items: z.array(refundItemSchema).min(1),
  reason: z.string().trim().min(3).max(1000),
  oldValue: z.unknown().optional(),
  newValue: z.unknown().optional(),
});
```

`createApprovalRequestSchema` accepts `idempotencyKey` at the root and keeps non-refund request compatibility.

- [x] **Step 1: Write failing schema and route tests**

Cover:

- item refund requires at least one item;
- duplicate invoice item IDs are rejected;
- only `cash` is accepted in this first version;
- current-workstation active session is required;
- amount is recalculated server-side;
- insufficient available cash returns 409;
- request row and hold row are created together;
- idempotent replay returns the same request and hold;
- no credit note/cash transaction/accounting/clinical update exists after submission.

Use a request body shaped as:

```ts
{
  type: 'refund',
  entityId: 16,
  entityNo: 'INV-D-2026-000016',
  idempotencyKey: 'refund-request-16-550e8400-e29b-41d4-a716-446655440000',
  requestData: {
    refundKind: 'item_partial_refund',
    paymentMethod: 'cash',
    reason: 'Two tests were not performed',
    items: [
      { invoiceItemId: 101, returnQuantity: 1 },
      { invoiceItemId: 102, returnQuantity: 1 },
    ],
    oldValue: { patientId: 9 },
    newValue: { status: 'refund_requested' },
  },
}
```

- [x] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm vitest run test/unit/approval-schemas.test.ts test/integration/routes/refund-approval-cash-holds.test.ts
```

Expected: FAIL because item refund payloads and holds are not supported.

- [x] **Step 3: Implement schema validation**

Use a discriminated/refined schema so existing approval types retain their current request-data flexibility while `type === 'refund'` requires the item-refund contract. Reject duplicate item IDs with a custom issue.

- [x] **Step 4: Implement request + hold creation**

For refund requests in `POST /api/approvals`:

1. load the bill and validate tenant/patient;
2. load canonical refundable items;
3. convert `bill_refund` to all currently eligible quantities;
4. calculate canonical selected amount;
5. load the requester's active counter with `requireCurrentWorkstation: true`;
6. calculate `availableCash` from the active session and active holds;
7. create approval request and hold in one `DB.batch()` using the approval ID lookup from a generated operation key stored in canonical `request_data`;
8. add `requestedRefundAmount`, canonical items, `cashHoldStatus: 'held'`, `counterSessionId`, and `counterId` to persisted request data;
9. return `{ data, cashHold: { id, amount, status, availableCash } }`.

Idempotent replay first loads by `(tenant_id, idempotency_key)` and returns the same approval+hold only when the request hash matches. Do not run the generic one-row INSERT before refund-specific validation.

- [x] **Step 5: Run tests**

Run:

```bash
pnpm vitest run test/unit/approval-schemas.test.ts test/integration/routes/refund-approval-cash-holds.test.ts test/integration/routes/approvals.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/schemas/approval.ts src/routes/tenant/approvals.ts test/unit/approval-schemas.test.ts test/integration/routes/refund-approval-cash-holds.test.ts test/integration/routes/approvals.test.ts
git commit -m "feat: create item refund approvals with cash holds"
```

---

### Task 5: Finalize approved refunds once and release rejected holds

**Files:**
- Modify: `src/routes/tenant/creditNotes.ts`
- Modify: `src/routes/tenant/approvals.ts`
- Modify: `src/lib/lab-finance.ts`
- Test: `test/integration/routes/refund-approval-cash-holds.test.ts`
- Test: `test/billing-refund-approval.test.ts`
- Test: `test/integration/routes/credit-notes-accounting.test.ts`
- Test: `test/integration/routes/refund-discount-cancellation-report-reconciliation.test.ts`

**Interfaces:**

Extract/reuse one processing function:

```ts
export async function processCreditNoteRefund(input: {
  env: Env;
  tenantId: string;
  actorId: string;
  creditNoteId: number;
  expectedStatus: 'pending' | 'ready_for_payout';
  originatingHold?: {
    id: number;
    counterId: number;
    counterSessionId: number;
    employeeId: number;
    amount: number;
  };
  approvalRequestId?: number;
}): Promise<{
  creditNoteId: number;
  creditNoteNo: string;
  totalRefund: number;
  cashRefund: number;
  receivableReduction: number;
}>;
```

When `originatingHold` is supplied, the function must use its employee/counter/session for `SalesReturn` and must not load/debit the reviewer's counter.

- [x] **Step 1: Write failing approval/rejection tests**

Cover:

- approval creates only selected credit-note items;
- credit note ends `approved`, not `ready_for_payout`;
- one `SalesReturn` references the originating counter/session and hold-linked credit note;
- hold becomes `consumed` with `credit_note_id`;
- available cash stays unchanged across held → consumed + `SalesReturn` transition;
- bill totals, paid/due/status, income reversal, accounting event, selected commissions, and cancellable lab/radiology orders update once;
- completed/verified/reported item discovered at approval returns 409/controlled execution failure and leaves request+hold pending;
- rejection atomically marks request `rejected` and hold `released` with notes;
- rejection creates no credit note, `SalesReturn`, income, accounting event, commission reversal, or clinical cancellation;
- duplicate approve/reject and approve/reject races have one winner.

- [x] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm vitest run test/integration/routes/refund-approval-cash-holds.test.ts test/billing-refund-approval.test.ts test/integration/routes/credit-notes-accounting.test.ts
```

Expected: FAIL because approval currently creates a full `ready_for_payout` credit note and rejection does not release a hold.

- [x] **Step 3: Create selected-item credit note during approval**

Replace the paid-bill refund path that calls `createCreditNoteFromBillCancel(..., 'ready_for_payout')` with a selected-item helper that:

- reloads canonical items with `excludeApprovalRequestId`;
- recalculates and exactly matches the active hold amount;
- creates one credit note and selected item rows;
- processes it immediately as approved;
- binds `SalesReturn` to hold employee/counter/session;
- includes `approvalRequestId` and `refundCashHoldId` in the accounting payload and audit records;
- consumes the hold in the same D1 batch as the final financial writes.

- [x] **Step 4: Add clinical and commission side effects**

For selected lab invoice items, use the existing helper exactly as currently defined:

```ts
await cancelLabOrderItemsForInvoiceItems(env.DB, {
  tenantId,
  userId: actorId,
  invoiceItemIds,
  reason,
});
```

The helper already calls `cancelLabOrderItem(..., { skipInvoiceUpdate: true })` and uses the existing cancellation operation/saga. Add a guarded radiology requisition cancellation helper in a focused module or the radiology route library for statuses that are not scanned/reported/completed/cancelled. Cancel commissions only for selected invoice items; add a selected-item helper in `lab-finance.ts` rather than calling full-bill commission cancellation.

- [x] **Step 5: Implement rejection release**

In individual review, refund rejection uses one batch containing:

```sql
UPDATE approval_requests
SET status = 'rejected', reviewed_by = ?, reviewed_at = datetime('now', '+6 hours'), review_notes = ?
WHERE id = ? AND tenant_id = ? AND status = 'pending';

UPDATE billing_refund_cash_holds
SET status = 'released', released_at = datetime('now', '+6 hours'), resolved_by = ?,
    resolution_reason = ?, updated_at = datetime('now', '+6 hours')
WHERE tenant_id = ? AND approval_request_id = ? AND status = 'held';
```

Refund requests remain disallowed from bulk approval and bulk rejection unless the same atomic hold-release semantics are explicitly implemented there. The minimal safe change is to keep them individual-review-only.

- [x] **Step 6: Run reconciliation tests**

Run:

```bash
pnpm vitest run test/integration/routes/refund-approval-cash-holds.test.ts test/billing-refund-approval.test.ts test/integration/routes/credit-notes-accounting.test.ts test/integration/routes/refund-discount-cancellation-report-reconciliation.test.ts test/lab-cancellation-workflow.test.ts
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add src/routes/tenant/creditNotes.ts src/routes/tenant/approvals.ts src/lib/lab-finance.ts test/integration/routes/refund-approval-cash-holds.test.ts test/billing-refund-approval.test.ts test/integration/routes/credit-notes-accounting.test.ts test/integration/routes/refund-discount-cancellation-report-reconciliation.test.ts
git commit -m "feat: finalize approved item refunds from held cash"
```

---

### Task 6: Expose hold-aware counter and approval data, and block counter closure

**Files:**
- Modify: `src/routes/tenant/billingCounter.ts`
- Modify: `src/routes/tenant/approvals.ts`
- Test: `test/integration/routes/billing-counter.test.ts`
- Test: `test/integration/routes/approvals.test.ts`
- Test: `test/integration/routes/refund-approval-cash-holds.test.ts`

**Interfaces:**

`GET /api/billing-counter/sessions/active` adds:

```ts
{
  active: true,
  session: {
    ...existingSession,
    expectedCash: number,
    heldRefundCash: number,
    availableCash: number,
  },
}
```

Approval rows add:

```ts
cash_hold: {
  id: number;
  amount: number;
  status: 'held' | 'consumed' | 'released';
  counter_session_id: number;
  held_at: string;
  consumed_at: string | null;
  released_at: string | null;
} | null;
```

- [x] **Step 1: Write failing route tests**

Assert active-session response exposes all three values, approval list/detail hydration includes the hold, and close returns 409 with:

```json
{
  "error": "This counter has pending refund holds and cannot be closed yet."
}
```

- [x] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm vitest run test/integration/routes/billing-counter.test.ts test/integration/routes/approvals.test.ts test/integration/routes/refund-approval-cash-holds.test.ts
```

Expected: FAIL.

- [x] **Step 3: Add active-session summary fields and close guard**

Before normal counter close processing, query:

```sql
SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount
FROM billing_refund_cash_holds
WHERE tenant_id = ? AND counter_session_id = ? AND status = 'held';
```

Return 409 when `count > 0`.

- [x] **Step 4: Hydrate approval rows with holds**

Load holds in one batched query for the page's approval IDs and merge them into list, summary, and detail data. Never expose unnecessary patient clinical details.

- [x] **Step 5: Run tests and commit**

Run:

```bash
pnpm vitest run test/integration/routes/billing-counter.test.ts test/integration/routes/approvals.test.ts test/integration/routes/refund-approval-cash-holds.test.ts
```

Expected: PASS.

```bash
git add src/routes/tenant/billingCounter.ts src/routes/tenant/approvals.ts test/integration/routes/billing-counter.test.ts test/integration/routes/approvals.test.ts test/integration/routes/refund-approval-cash-holds.test.ts
git commit -m "feat: expose refund holds in counters and approvals"
```

---

### Task 7: Add the item-based partial refund UI in the reception drawer

**Files:**
- Modify: `web/src/components/reception/ReceptionPatientDrawer.tsx`
- Modify: `web/src/components/reception/ReceptionPatientDrawer.test.tsx`

**Interfaces:**

Add local types:

```ts
type RefundMode = 'full' | 'partial';

type RefundableBillItem = {
  id: number;
  description: string;
  item_category: string;
  quantity: number;
  returned_qty: number;
  pending_qty: number;
  available_qty: number;
  refundable_unit_amount: number;
  clinical_status: string | null;
  eligible: boolean;
  block_reason: string | null;
};

type RefundInvoiceResponse = {
  bill: Record<string, unknown>;
  items: RefundableBillItem[];
};
```

- [x] **Step 1: Write failing UI tests**

Extend the API mock to return refund invoice items for `/api/credit-notes/invoice/:billId`. Add tests proving:

- refund panel shows Full refund / Partial refund controls;
- partial mode lists each item and its clinical status;
- completed/verified rows are disabled with a reason;
- selecting eligible rows and quantities updates the calculated total;
- there is no manual refund amount input;
- submit is disabled without active counter, sufficient available cash, selected items, or valid reason;
- payload includes `refundKind: 'item_partial_refund'`, `paymentMethod: 'cash'`, selected item IDs/quantities, and an idempotency key;
- full mode submits all eligible quantities with `refundKind: 'bill_refund'`;
- successful submission shows `Pending approval — cash held` and invalidates active-session/approval/patient queries.

- [x] **Step 2: Run the UI test and verify RED**

Run:

```bash
pnpm --filter web exec vitest run src/components/reception/ReceptionPatientDrawer.test.tsx
```

Expected: FAIL because the current panel only sends a full-bill amount.

- [x] **Step 3: Implement refund state and invoice-item loading**

Add state:

```ts
const [refundMode, setRefundMode] = useState<RefundMode>('full');
const [refundSelections, setRefundSelections] = useState<Record<number, number>>({});
```

Load invoice data only while the refund panel is open:

```ts
const { data: refundInvoice, isLoading: refundItemsLoading } = useApiQuery<RefundInvoiceResponse>(
  ['credit-notes', 'invoice', billReviewTarget?.id],
  `/api/credit-notes/invoice/${billReviewTarget?.id}`,
  { enabled: actionMode === 'refundRequest' && Boolean(billReviewTarget?.id) },
);
```

Use server-provided `refundable_unit_amount` only for preview; the server still recalculates on submit.

- [x] **Step 4: Implement the panel**

Render:

- Full / Partial segmented buttons;
- active counter badge with counter name;
- Expected cash, Held refunds, Available cash;
- item rows with checkbox, description, status, available quantity, quantity control, and calculated amount;
- blocked rows with disabled controls and `block_reason`;
- a summary showing selected item count, refund amount, and “This amount will be held after request submission”; and
- a clear note: “Do not hand cash to the patient until approval.”

Submit payload:

```ts
billReviewRequestMutation.mutate({
  type: 'refund',
  entityId: billReviewTarget.id,
  entityNo: billReviewTarget.invoice_no ?? `Bill #${billReviewTarget.id}`,
  idempotencyKey: `refund-request-${billReviewTarget.id}-${crypto.randomUUID()}`,
  requestData: {
    refundKind: refundMode === 'full' ? 'bill_refund' : 'item_partial_refund',
    paymentMethod: 'cash',
    reason,
    items: selectedItems.map(({ id, quantity }) => ({
      invoiceItemId: id,
      returnQuantity: quantity,
    })),
    oldValue: {
      status: billReviewTarget.status ?? null,
      patientId: patient?.id ?? null,
      patientName: patient?.name ?? null,
    },
    newValue: { status: 'refund_requested' },
  },
});
```

- [x] **Step 5: Run UI tests**

Run:

```bash
pnpm --filter web exec vitest run src/components/reception/ReceptionPatientDrawer.test.tsx
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add web/src/components/reception/ReceptionPatientDrawer.tsx web/src/components/reception/ReceptionPatientDrawer.test.tsx
git commit -m "feat: request item-based refunds from reception drawer"
```

---

### Task 8: Show selected items and held cash in reviewer UI

**Files:**
- Modify: `web/src/components/admin/ApprovalDetailDrawer.tsx`
- Modify: `web/src/components/admin/ApprovalDetailDrawer.test.tsx`
- Modify: `web/src/pages/ApprovalCenter.tsx`
- Modify: `web/src/pages/ApprovalCenter.test.tsx`

**Interfaces:**
- Approval detail displays canonical selected items, quantities, server-calculated refund amount, originating counter, and hold state.
- Approval Center refund queue includes pending `type=refund` approval requests; it no longer relies only on pending direct credit notes.

- [x] **Step 1: Write failing reviewer UI tests**

Assert the detail drawer renders:

- `Pending approval — cash held` for `held`;
- item names/IDs, quantities, and total;
- counter session reference;
- `Cash will not be deducted again on approval`;
- `Cash hold released` for rejected rows; and
- no separate “Pay refund” action for an approval-generated refund.

Assert Approval Center uses `/api/approvals?type=refund&status=pending` or `summary.pendingByType.refund` for the refund queue count.

- [x] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter web exec vitest run src/components/admin/ApprovalDetailDrawer.test.tsx src/pages/ApprovalCenter.test.tsx
```

Expected: FAIL.

- [x] **Step 3: Implement reviewer presentation and count**

Render item/hold details only for `type === 'refund'`. Keep generic approval detail behavior unchanged for other approval types. Update the refund queue path to the pending approvals worklist filtered to Refund, not the direct Credit Notes page.

- [x] **Step 4: Run tests and commit**

Run:

```bash
pnpm --filter web exec vitest run src/components/admin/ApprovalDetailDrawer.test.tsx src/pages/ApprovalCenter.test.tsx src/pages/__tests__/ApprovalCenter.test.tsx
```

Expected: PASS.

```bash
git add web/src/components/admin/ApprovalDetailDrawer.tsx web/src/components/admin/ApprovalDetailDrawer.test.tsx web/src/pages/ApprovalCenter.tsx web/src/pages/ApprovalCenter.test.tsx
git commit -m "feat: review held item refunds in approval center"
```

---

### Task 9: End-to-end verification and regression gates

**Files:**
- Modify only files required by failures directly caused by this feature.
- Do not modify unrelated production migration guard or reagent-stock work already dirty in the source workspace.

- [x] **Step 1: Run focused backend tests**

```bash
pnpm vitest run \
  test/billing-refund-cash-hold-migration.test.ts \
  test/billing-refund-domain.test.ts \
  test/integration/routes/refund-approval-cash-holds.test.ts \
  test/integration/routes/approvals.test.ts \
  test/integration/routes/credit-notes.test.ts \
  test/integration/routes/credit-notes-accounting.test.ts \
  test/billing-refund-approval.test.ts \
  test/integration/routes/refund-discount-cancellation-report-reconciliation.test.ts \
  test/unit/billing-counter-session.test.ts \
  test/lab-cancellation-workflow.test.ts
```

Expected: PASS with no unhandled promise rejections or console errors.

- [x] **Step 2: Run focused frontend tests**

```bash
pnpm --filter web exec vitest run \
  src/components/reception/ReceptionPatientDrawer.test.tsx \
  src/components/admin/ApprovalDetailDrawer.test.tsx \
  src/pages/ApprovalCenter.test.tsx \
  src/pages/__tests__/ApprovalCenter.test.tsx \
  src/pages/CreditNotesPage.test.ts
```

Expected: PASS.

- [x] **Step 3: Run typecheck and builds**

```bash
pnpm exec tsc --noEmit
pnpm build:migrations
pnpm --filter web build
```

Expected: PASS.

- [x] **Step 4: Run the complete relevant integration suite**

```bash
pnpm test:integration -- test/integration/routes/approvals.test.ts test/integration/routes/credit-notes.test.ts test/integration/routes/billing-counter.test.ts test/integration/routes/refund-approval-cash-holds.test.ts
```

Expected: PASS.

- [ ] **Step 5: Manually verify the approved scenario**

1. Open a reception counter with known expected cash.
2. Create a paid bill with five tests.
3. Complete three tests and leave two pending.
4. Open the patient drawer and choose Partial refund.
5. Confirm the completed tests are disabled.
6. Select the two pending tests and submit.
7. Confirm available cash decreases by the held amount while no credit note or `SalesReturn` exists.
8. Approve as a different admin/accounts user.
9. Confirm one approved credit note and one `SalesReturn` exist, the hold is consumed, selected tests are cancelled, and available cash does not decrease again.
10. Repeat with another request and reject it; confirm the hold is released and there are no refund side effects.

- [x] **Step 6: Review final diff for scope and security**

Verify tenant filters on all new queries, no patient clinical details in cash-hold audit payloads, no self-approval, no raw client refund amount use, no duplicate cash debit, and no changes to unrelated dirty files.

- [x] **Step 7: Final commit**

```bash
git add migrations/0421_billing_refund_cash_holds.sql tenant-schema.sql src web test docs/superpowers/specs/2026-07-12-item-based-partial-refund-design.md docs/superpowers/plans/2026-07-12-item-based-partial-refund-cash-hold.md
git commit -m "feat: add item-based partial refunds with counter cash holds"
```

## Implementation verification — 2026-07-12

Completed implementation includes item/quantity selection, canonical server-side refund calculation, maker-checker approval, originating-counter cash holds, exactly-once `SalesReturn`, approval consumption, rejection release, counter-close guards, selected-item lab/radiology cancellation, selected lab commission reversal, reviewer visibility, and database write-boundary concurrency protection.

Verification results:

- `pnpm vitest run test/unit --reporter=dot` — **120 files, 968 tests passed**.
- `pnpm vitest run test/integration/routes --reporter=dot` — **217 files, 5,692 tests passed**.
- Focused backend refund/counter/reconciliation suites — **210 tests passed** before final hardening; all modified focused suites were rerun after hardening and passed.
- Focused frontend refund/reviewer suites — **6 files, 102 tests passed**.
- `pnpm --filter web exec vitest run src/components --reporter=dot` — **144 files, 1,016 tests passed**.
- `pnpm --filter web exec vitest run src/pages --reporter=dot` — **337 files passed, 3 skipped; 1,611 tests passed, 3 todo**.
- `pnpm --filter web exec vitest run src/lib src/hooks src/context src/utils --reporter=dot` — **34 files, 248 tests passed**.
- `pnpm exec tsc --noEmit` — PASS.
- `pnpm build:migrations` — PASS; migration manifest built with 434 migrations.
- `pnpm --filter web build` — PASS.

Final hardening added:

- an atomic D1 trigger that rejects counter-cash over-reservation under concurrent requests;
- one-active-hold-per-bill protection;
- fail-closed bill-linked diagnostic resolution to prevent lab/radiology numeric reference collisions;
- selected lab-item commission reversal instead of broad bill-level reversal; and
- guarded radiology cancellation with audit logging.

The staging/manual browser walkthrough remains intentionally unchecked because this isolated implementation session did not deploy or operate a live counter. Migration `0421_billing_refund_cash_holds.sql` must be applied before enabling the workflow in a deployed environment.
