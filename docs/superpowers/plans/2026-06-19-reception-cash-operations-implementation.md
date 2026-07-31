# Reception Cash Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated reception Cash Operations workspace where cashiers execute doctor payouts, expenses, transfers, bank deposits, and shift close actions while admins/MD/directors/accountants monitor without moving drawer cash.

**Architecture:** Keep D1 as the financial source of truth, with `cash_drawer_movements` as the canonical drawer ledger and domain workflow tables as state owners. Use guarded D1 `batch()` transitions for money movement, keep route handlers thin, and add one focused reception page that reuses the current design system instead of expanding the dashboard.

**Tech Stack:** Cloudflare Workers, D1 SQLite, Drizzle schema definitions, Hono route modules, TanStack Query, React, TypeScript, Vitest, Playwright.

---

## File Structure

- Modify `migrations/0363_reception_cash_operations.sql`: additive schema, indexes, triggers, and backfills for payout snapshots, expense execution state, transfer acceptance metadata, and cash operation settings.
- Modify `tenant-schema.sql`: fresh local install parity for every migration object.
- Modify `src/db/schema/finance.ts`: Drizzle definitions for `doctor_commission_settlements`, new `doctor_commission_settlement_items`, and finance settings if finance-specific.
- Modify `src/db/schema/schema.ts`: generated or hand-maintained schema parity for `expenses`, `billing_counter_cash_transfers`, and new settings table.
- Modify `src/data/schema-migrations.generated.ts`: migration manifest rebuilt with `pnpm build:migrations`.
- Create `src/schemas/cash-operations.ts`: request/response schemas for overview, activity, doctor payout execution, expense execution, and cash operation settings.
- Modify `src/schemas/commission.ts`: selection, adjustment, receiver, and receipt fields for doctor payout.
- Modify `src/schemas/expense.ts`: payee, approval state, payment state, execution, and receipt requirement fields.
- Create `src/routes/tenant/cashOperations.ts`: overview, recent activity, settings, and thin orchestration endpoints.
- Modify `src/routes/tenant/receptionDoctorPayouts.ts`: richer payable read model and atomic payout execution.
- Modify `src/routes/tenant/commissions.ts`: admin/finance monitoring read model backed by accruals, settlement items, and settlements.
- Modify `src/routes/admin/index.ts`: remove old `doctor_commissions` read path for payout detail and read the accrual/settlement ledger instead.
- Modify `src/routes/tenant/expenses.ts`: approve-then-execute flow for over-threshold expenses and cashier-only drawer execution.
- Modify `src/routes/tenant/payment-methods.ts`: keep route mounting thin and point payout/custody flows to the hardened implementations.
- Modify `src/index.ts`: mount `/api/cash-operations`.
- Modify `web/src/lib/queryKeys.ts`: add `cashOperations` and richer `doctorPayouts` keys.
- Modify `web/src/App.tsx`: add `/h/:tenantSlug/reception/cash-operations` route.
- Modify `web/src/components/reception/ReceptionTopBar.tsx`: remove the dashboard outflow panel.
- Modify `web/src/components/reception/ReceptionTopBarBase.tsx`: replace counter dropdown handover action with Cash Operations navigation and keep handover focused.
- Create `web/src/pages/reception/CashOperationsPage.tsx`: dedicated workspace shell.
- Create `web/src/components/reception/cash-operations/CashOverviewCards.tsx`: active drawer summary.
- Create `web/src/components/reception/cash-operations/DoctorPayoutWorkspace.tsx`: selection, source breakdown, receiver, adjustment, and receipt controls.
- Create `web/src/components/reception/cash-operations/ExpensePaymentPanel.tsx`: petty cash request and cashier execution.
- Create `web/src/components/reception/cash-operations/CashTransferPanel.tsx`: MD/admin/accountant/counter transfer request and acceptance visibility.
- Create `web/src/components/reception/cash-operations/BankDepositPanel.tsx`: existing bank custody request UI moved from handover.
- Create `web/src/components/reception/cash-operations/CloseShiftPanel.tsx`: close-session/handover actions.
- Create `web/src/components/reception/cash-operations/RecentCashActivity.tsx`: audit timeline.
- Create `test/integration/routes/reception-doctor-payouts.test.ts`: payout item selection, idempotency, atomicity, and negative-drawer guards.
- Modify `test/doctor-commission-routes.test.ts`: admin monitoring and settlement detail consistency.
- Modify `test/expenses.test.ts`: approve-then-execute behavior.
- Create `test/integration/routes/cash-operations.test.ts`: overview and activity aggregation.
- Modify `test/integration/routes/billing-counter.test.ts`: transfer acceptance and active-session interactions.
- Modify `web/src/components/reception/ReceptionTopBar.test.tsx`: dashboard panel removal and Cash Operations link.
- Create `web/src/pages/reception/CashOperationsPage.test.tsx`: page shell, filters, selected payout summary, and cashier/admin mode behavior.
- Modify `web/src/pages/CommissionManagement.test.tsx` if present; otherwise add targeted tests beside the page currently covering commission management.

## Task 1: Schema, Fresh Install Parity, and Migration Manifest

**Files:**
- Create: `migrations/0363_reception_cash_operations.sql`
- Modify: `tenant-schema.sql`
- Modify: `src/db/schema/finance.ts`
- Modify: `src/db/schema/schema.ts`
- Modify: `src/data/schema-migrations.generated.ts`

- [ ] **Step 1: Write a migration smoke test command**

Run this command before editing so the current duplicate `0362` state is visible in the terminal history:

```bash
ls migrations | sort | tail -n 20
```

Expected: `0363_reception_cash_operations.sql` is absent and can be created.

- [ ] **Step 2: Add payout snapshot schema**

Add this shape to `migrations/0363_reception_cash_operations.sql`:

```sql
ALTER TABLE doctor_commission_settlements ADD COLUMN settlement_no TEXT;
ALTER TABLE doctor_commission_settlements ADD COLUMN gross_commission_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE doctor_commission_settlements ADD COLUMN advance_deduction REAL NOT NULL DEFAULT 0;
ALTER TABLE doctor_commission_settlements ADD COLUMN other_adjustment REAL NOT NULL DEFAULT 0;
ALTER TABLE doctor_commission_settlements ADD COLUMN rounding_adjustment REAL NOT NULL DEFAULT 0;
ALTER TABLE doctor_commission_settlements ADD COLUMN net_paid_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE doctor_commission_settlements ADD COLUMN receiver_type TEXT NOT NULL DEFAULT 'doctor' CHECK (receiver_type IN ('doctor', 'assistant', 'representative'));
ALTER TABLE doctor_commission_settlements ADD COLUMN receiver_name TEXT;
ALTER TABLE doctor_commission_settlements ADD COLUMN receiver_reference TEXT;
ALTER TABLE doctor_commission_settlements ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'bank', 'mobile_banking'));
ALTER TABLE doctor_commission_settlements ADD COLUMN counter_session_id INTEGER REFERENCES billing_counter_sessions(id);
ALTER TABLE doctor_commission_settlements ADD COLUMN counter_id INTEGER REFERENCES billing_counters(id);
ALTER TABLE doctor_commission_settlements ADD COLUMN cash_movement_id INTEGER REFERENCES cash_drawer_movements(id);
ALTER TABLE doctor_commission_settlements ADD COLUMN attachment_key TEXT;
ALTER TABLE doctor_commission_settlements ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_doctor_commission_settlements_no
  ON doctor_commission_settlements(tenant_id, settlement_no)
  WHERE settlement_no IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_doctor_commission_settlements_idempotency
  ON doctor_commission_settlements(tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS doctor_commission_settlement_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  settlement_id INTEGER NOT NULL REFERENCES doctor_commission_settlements(id) ON DELETE CASCADE,
  accrual_id INTEGER NOT NULL REFERENCES doctor_commission_accruals(id) ON DELETE RESTRICT,
  doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL,
  invoice_id INTEGER,
  bill_id INTEGER,
  patient_id INTEGER,
  service_date TEXT,
  gross_amount REAL NOT NULL DEFAULT 0,
  commission_amount REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, accrual_id)
);

CREATE INDEX IF NOT EXISTS idx_doctor_commission_settlement_items_settlement
  ON doctor_commission_settlement_items(tenant_id, settlement_id);

CREATE INDEX IF NOT EXISTS idx_doctor_commission_settlement_items_doctor_date
  ON doctor_commission_settlement_items(tenant_id, doctor_id, service_date);
```

- [ ] **Step 3: Normalize settlement voucher linkage safely**

Add an additive column instead of relying on the stale production `voucher_id` foreign key shape:

```sql
ALTER TABLE doctor_commission_settlements ADD COLUMN accounting_voucher_id INTEGER REFERENCES accounting_vouchers(id);
CREATE INDEX IF NOT EXISTS idx_doctor_commission_settlements_accounting_voucher
  ON doctor_commission_settlements(tenant_id, accounting_voucher_id);
```

Then update application code in Task 2 to write `accounting_voucher_id` and leave `voucher_id` unchanged for old rows.

- [ ] **Step 4: Add expense execution state**

Add these columns and indexes:

```sql
ALTER TABLE expenses ADD COLUMN payee_name TEXT;
ALTER TABLE expenses ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved'
  CHECK (approval_status IN ('pending', 'approved', 'rejected'));
ALTER TABLE expenses ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'paid'
  CHECK (payment_status IN ('unpaid', 'paid', 'void'));
ALTER TABLE expenses ADD COLUMN approval_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE expenses ADD COLUMN approval_threshold REAL NOT NULL DEFAULT 1000;
ALTER TABLE expenses ADD COLUMN counter_session_id INTEGER REFERENCES billing_counter_sessions(id);
ALTER TABLE expenses ADD COLUMN cash_movement_id INTEGER REFERENCES cash_drawer_movements(id);
ALTER TABLE expenses ADD COLUMN execution_idempotency_key TEXT;
ALTER TABLE expenses ADD COLUMN executed_by INTEGER REFERENCES users(id);
ALTER TABLE expenses ADD COLUMN executed_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_execution_idempotency
  ON expenses(tenant_id, execution_idempotency_key)
  WHERE execution_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_approval_payment_status
  ON expenses(tenant_id, approval_status, payment_status, date);
```

- [ ] **Step 5: Add transfer acceptance and settings schema**

Add destination/acceptance fields and a small settings table:

```sql
ALTER TABLE billing_counter_cash_transfers ADD COLUMN destination_type TEXT NOT NULL DEFAULT 'admin_custody'
  CHECK (destination_type IN ('admin_custody', 'counter_session', 'bank_deposit'));
ALTER TABLE billing_counter_cash_transfers ADD COLUMN destination_counter_id INTEGER REFERENCES billing_counters(id);
ALTER TABLE billing_counter_cash_transfers ADD COLUMN destination_counter_session_id INTEGER REFERENCES billing_counter_sessions(id);
ALTER TABLE billing_counter_cash_transfers ADD COLUMN custody_label TEXT;
ALTER TABLE billing_counter_cash_transfers ADD COLUMN accepted_cash_movement_id INTEGER REFERENCES cash_drawer_movements(id);
ALTER TABLE billing_counter_cash_transfers ADD COLUMN cancelled_by INTEGER REFERENCES users(id);
ALTER TABLE billing_counter_cash_transfers ADD COLUMN cancelled_at TEXT;
ALTER TABLE billing_counter_cash_transfers ADD COLUMN cancel_reason TEXT;

CREATE TABLE IF NOT EXISTS cash_operation_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  petty_cash_auto_approve_limit REAL NOT NULL DEFAULT 1000,
  receipt_required_limit REAL NOT NULL DEFAULT 1000,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id)
);
```

- [ ] **Step 6: Add cash-out non-negative guard**

Add a trigger that aborts only drawer-reducing movement types:

```sql
CREATE TRIGGER IF NOT EXISTS trg_cash_drawer_movements_no_negative_cash_out
BEFORE INSERT ON cash_drawer_movements
WHEN NEW.movement_type IN ('cash_out', 'cash_drop')
BEGIN
  SELECT CASE
    WHEN (
      COALESCE((
        SELECT SUM(CASE
          WHEN movement_type IN ('cash_in', 'opening_balance') THEN amount
          WHEN movement_type IN ('cash_out', 'cash_drop') THEN -amount
          ELSE 0
        END)
        FROM cash_drawer_movements
        WHERE tenant_id = NEW.tenant_id
          AND counter_session_id = NEW.counter_session_id
      ), 0) - NEW.amount
    ) < 0
    THEN RAISE(ABORT, 'INSUFFICIENT_DRAWER_CASH')
  END;
END;
```

- [ ] **Step 7: Mirror schema into fresh install files**

Copy the migration objects into `tenant-schema.sql`. Update Drizzle schema files with the same columns, table, indexes, and enum-like checks used by existing Drizzle style in `src/db/schema/finance.ts` and `src/db/schema/schema.ts`.

- [ ] **Step 8: Rebuild migration manifest**

Run:

```bash
pnpm build:migrations
```

Expected: `src/data/schema-migrations.generated.ts` changes and includes `0363_reception_cash_operations.sql`.

- [ ] **Step 9: Verify migration syntax**

Run:

```bash
pnpm exec wrangler d1 execute DB --local --file=migrations/0363_reception_cash_operations.sql
```

Expected: migration applies cleanly to local D1 or reports only duplicate-column errors if a developer reruns it on the same local database after the first successful apply.

- [ ] **Step 10: Commit schema work**

```bash
git add migrations/0363_reception_cash_operations.sql tenant-schema.sql src/db/schema/finance.ts src/db/schema/schema.ts src/data/schema-migrations.generated.ts
git commit -m "feat: add reception cash operations schema"
```

## Task 2: Doctor Payout Atomic Execution

**Files:**
- Create: `src/schemas/cash-operations.ts`
- Modify: `src/schemas/commission.ts`
- Modify: `src/routes/tenant/receptionDoctorPayouts.ts`
- Modify: `src/routes/tenant/commissions.ts`
- Modify: `src/routes/admin/index.ts`
- Test: `test/integration/routes/reception-doctor-payouts.test.ts`
- Test: `test/doctor-commission-routes.test.ts`

- [ ] **Step 1: Write failing payout tests**

Add tests that prove these contracts:

```ts
it('pays selected unpaid accruals once and writes settlement items plus one cash movement', async () => {
  const response = await app.request('/api/payment-methods/doctor-payouts/sessions/1/pay', {
    method: 'POST',
    headers: cashierHeaders,
    body: JSON.stringify({
      accrualIds: [101, 102],
      receiverType: 'doctor',
      receiverName: 'Dr. Aminul Islam',
      paymentMethod: 'cash',
      adjustments: { advanceDeduction: 0, otherAdjustment: 0, roundingAdjustment: 0 },
      note: 'Paid after morning OPD',
      idempotencyKey: 'payout-test-101-102',
    }),
  });

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.settlement.settlementNo).toMatch(/^DPS-\d{4}-\d{6}$/);
  expect(body.settlement.netPaidAmount).toBe(300);
});

it('does not create a partial settlement when one selected accrual is stale', async () => {
  const response = await app.request('/api/payment-methods/doctor-payouts/sessions/1/pay', {
    method: 'POST',
    headers: cashierHeaders,
    body: JSON.stringify({
      accrualIds: [101, 999],
      receiverType: 'doctor',
      receiverName: 'Dr. Aminul Islam',
      paymentMethod: 'cash',
      adjustments: { advanceDeduction: 0, otherAdjustment: 0, roundingAdjustment: 0 },
      idempotencyKey: 'payout-stale-test',
    }),
  });

  expect(response.status).toBe(409);
  await expectNoRows('doctor_commission_settlements', { idempotency_key: 'payout-stale-test' });
});
```

- [ ] **Step 2: Add payout request schema**

Define schema fields in `src/schemas/commission.ts`:

```ts
export const receptionDoctorPayoutSchema = z.object({
  accrualIds: z.array(z.number().int().positive()).min(1),
  receiverType: z.enum(['doctor', 'assistant', 'representative']).default('doctor'),
  receiverName: z.string().trim().min(1).max(120),
  receiverReference: z.string().trim().max(160).optional(),
  paymentMethod: z.enum(['cash']).default('cash'),
  adjustments: z.object({
    advanceDeduction: z.number().min(0).default(0),
    otherAdjustment: z.number().default(0),
    roundingAdjustment: z.number().default(0),
  }).default({ advanceDeduction: 0, otherAdjustment: 0, roundingAdjustment: 0 }),
  adjustmentReason: z.string().trim().max(240).optional(),
  note: z.string().trim().max(500).optional(),
  attachmentKey: z.string().trim().max(300).optional(),
  idempotencyKey: z.string().trim().min(8).max(120),
}).superRefine((value, ctx) => {
  const hasAdjustment = value.adjustments.advanceDeduction !== 0
    || value.adjustments.otherAdjustment !== 0
    || value.adjustments.roundingAdjustment !== 0;
  if (hasAdjustment && !value.adjustmentReason) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['adjustmentReason'], message: 'Adjustment reason is required' });
  }
});
```

- [ ] **Step 3: Add deterministic settlement number generation**

In `src/routes/tenant/receptionDoctorPayouts.ts`, add a small helper:

```ts
async function nextDoctorPayoutSettlementNo(db: D1Database, tenantId: number, now = new Date()): Promise<string> {
  const year = now.getUTCFullYear();
  const prefix = `DPS-${year}-`;
  const row = await db.prepare(`
    SELECT settlement_no
    FROM doctor_commission_settlements
    WHERE tenant_id = ? AND settlement_no LIKE ?
    ORDER BY settlement_no DESC
    LIMIT 1
  `).bind(tenantId, `${prefix}%`).first<{ settlement_no: string | null }>();
  const next = row?.settlement_no ? Number(row.settlement_no.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(next).padStart(6, '0')}`;
}
```

- [ ] **Step 4: Replace two-batch execution with one guarded batch**

Build one `db.batch([...])` containing settlement insert, settlement item inserts, accrual updates, linked cash movement, accounting event, and audit row. Use subqueries by `(tenant_id, idempotency_key)` instead of relying on an insert result between batch statements.

The cash movement insert must use:

```sql
INSERT INTO cash_drawer_movements (
  tenant_id, counter_session_id, counter_id, user_id, movement_type,
  amount, description, reference_type, reference_id, created_at
)
SELECT
  ?, ?, ?, ?, 'cash_out',
  ?, ?, 'doctor_commission_settlement', s.id, CURRENT_TIMESTAMP
FROM doctor_commission_settlements s
WHERE s.tenant_id = ? AND s.idempotency_key = ?;
```

After batch completion, verify affected accrual count equals selected count and settlement-item count equals selected count. If mismatch is detected, return `409` and ensure no partial rows exist by relying on the batch abort guard.

- [ ] **Step 5: Add richer payable read model**

Return doctor groups with these fields:

```ts
type ReceptionDoctorPayoutGroup = {
  doctorId: number;
  doctorName: string;
  eligibleItemCount: number;
  grossAmount: number;
  consultationCommission: number;
  testCommission: number;
  otherCommission: number;
  previouslyPaidAmount: number;
  payableAmount: number;
  items: Array<{
    accrualId: number;
    serviceDate: string;
    invoiceNo: string | null;
    patientName: string | null;
    sourceType: string;
    serviceName: string;
    grossAmount: number;
    commissionAmount: number;
    status: 'pending' | 'paid';
  }>;
};
```

- [ ] **Step 6: Unify admin monitoring**

Update `src/routes/tenant/commissions.ts` and `src/routes/admin/index.ts` so settlement details come from `doctor_commission_settlements` plus `doctor_commission_settlement_items` and never from stale `doctor_commissions`.

- [ ] **Step 7: Run payout route tests**

```bash
pnpm vitest run test/integration/routes/reception-doctor-payouts.test.ts test/doctor-commission-routes.test.ts
```

Expected: payout success, duplicate idempotency replay, stale accrual conflict, insufficient drawer cash, and admin detail tests pass.

- [ ] **Step 8: Commit payout backend work**

```bash
git add src/schemas/cash-operations.ts src/schemas/commission.ts src/routes/tenant/receptionDoctorPayouts.ts src/routes/tenant/commissions.ts src/routes/admin/index.ts test/integration/routes/reception-doctor-payouts.test.ts test/doctor-commission-routes.test.ts
git commit -m "feat: harden reception doctor payouts"
```

## Task 3: Expense Approve-Then-Execute Flow

**Files:**
- Modify: `src/schemas/expense.ts`
- Modify: `src/routes/tenant/expenses.ts`
- Modify: `src/routes/tenant/cash-book.ts`
- Test: `test/expenses.test.ts`
- Test: `test/integration/routes/direct-income-expense-accounting.test.ts`

- [ ] **Step 1: Write failing expense tests**

Add assertions:

```ts
it('does not write drawer movement when over-threshold expense is created', async () => {
  const response = await createExpense({ amount: 1500, category: 'Utilities', payeeName: 'Generator vendor' });
  expect(response.status).toBe(201);
  const body = await response.json();
  expect(body.expense.approvalStatus).toBe('pending');
  expect(body.expense.paymentStatus).toBe('unpaid');
  await expectNoCashMovement({ reference_type: 'expense', reference_id: body.expense.id });
});

it('writes drawer movement only when cashier executes an approved expense', async () => {
  const approved = await approveExpense(overThresholdExpenseId, adminHeaders);
  expect(approved.status).toBe(200);
  await expectNoCashMovement({ reference_type: 'expense', reference_id: overThresholdExpenseId });

  const executed = await executeExpense(overThresholdExpenseId, cashierHeaders, 'expense-exec-key-1');
  expect(executed.status).toBe(200);
  await expectCashMovement({ reference_type: 'expense', reference_id: overThresholdExpenseId, movement_type: 'cash_out' });
});
```

- [ ] **Step 2: Update create expense route**

For `amount <= petty_cash_auto_approve_limit`, create approved and paid expense plus cash movement in one batch. For `amount > petty_cash_auto_approve_limit`, create pending/unpaid expense with no cash movement.

- [ ] **Step 3: Update approve and reject routes**

Approval only changes `approval_status` to `approved` and metadata. Rejection changes `approval_status` to `rejected` and keeps `payment_status = 'unpaid'`; it must not reverse a movement because no movement exists before execution.

- [ ] **Step 4: Add execute route**

Add `POST /api/expenses/:id/execute` for cashier execution. It must require an active billing counter session, require `approval_status = 'approved'`, require `payment_status = 'unpaid'`, and batch the expense update, `cash_drawer_movements` insert, accounting posting event, and audit log.

- [ ] **Step 5: Update cash-book aggregation**

Ensure `src/routes/tenant/cash-book.ts` counts drawer-linked expenses from `cash_drawer_movements` and does not double-count approved but unpaid expense rows.

- [ ] **Step 6: Run expense tests**

```bash
pnpm vitest run test/expenses.test.ts test/integration/routes/direct-income-expense-accounting.test.ts
```

Expected: old pending-expense cash reduction behavior is gone and approved execution posts once.

- [ ] **Step 7: Commit expense work**

```bash
git add src/schemas/expense.ts src/routes/tenant/expenses.ts src/routes/tenant/cash-book.ts test/expenses.test.ts test/integration/routes/direct-income-expense-accounting.test.ts
git commit -m "feat: separate expense approval from cash execution"
```

## Task 4: Cash Operations Aggregate API

**Files:**
- Create: `src/routes/tenant/cashOperations.ts`
- Modify: `src/index.ts`
- Modify: `src/schemas/cash-operations.ts`
- Test: `test/integration/routes/cash-operations.test.ts`

- [ ] **Step 1: Write overview and activity tests**

Add tests for `GET /api/cash-operations/overview` and `GET /api/cash-operations/activity`:

```ts
expect(body.overview).toMatchObject({
  openingCash: 1000,
  patientCashCollection: 5000,
  refundCashOut: 200,
  doctorPayout: 300,
  expenseCashOut: 150,
  transferOut: 250,
  acceptedTransferIn: 100,
  bankDepositCustody: 400,
  currentDrawerBalance: 4800,
});
expect(body.activity[0]).toHaveProperty('referenceType');
```

- [ ] **Step 2: Implement overview query**

Aggregate from `cash_drawer_movements`, patient payment rows, refund rows, `billing_counter_cash_transfers`, and bank deposit request state for the caller's active counter session. Never compute money totals from browser-provided state.

- [ ] **Step 3: Implement activity query**

Return a normalized list:

```ts
type CashActivityRow = {
  id: string;
  createdAt: string;
  actorName: string | null;
  movementType: string;
  referenceType: string;
  referenceId: number | null;
  amount: number;
  status: string;
  description: string | null;
};
```

- [ ] **Step 4: Implement settings endpoints**

Add `GET /api/cash-operations/settings` and `PATCH /api/cash-operations/settings` for admin/MD/director/accountant roles. Cashiers may read effective settings through overview but cannot patch them.

- [ ] **Step 5: Mount route**

In `src/index.ts`:

```ts
tenantRoutes.route('/api/cash-operations', cashOperationsRoutes);
```

Use the same import/mount style as nearby tenant finance routes.

- [ ] **Step 6: Run aggregate API tests**

```bash
pnpm vitest run test/integration/routes/cash-operations.test.ts
```

Expected: cashier overview is scoped to active session; admin monitoring reads without creating drawer movement.

- [ ] **Step 7: Commit aggregate API work**

```bash
git add src/routes/tenant/cashOperations.ts src/index.ts src/schemas/cash-operations.ts test/integration/routes/cash-operations.test.ts
git commit -m "feat: add reception cash operations API"
```

## Task 5: Reception Navigation and Dashboard Cleanup

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/lib/queryKeys.ts`
- Modify: `web/src/components/reception/ReceptionTopBar.tsx`
- Modify: `web/src/components/reception/ReceptionTopBarBase.tsx`
- Test: `web/src/components/reception/ReceptionTopBar.test.tsx`

- [ ] **Step 1: Write failing navigation tests**

Assert the dashboard no longer renders the large outflow panel and the counter dropdown contains Cash Operations:

```ts
expect(screen.queryByText('Controlled Drawer Outflows')).not.toBeInTheDocument();
await user.click(screen.getByRole('button', { name: /active shift/i }));
expect(screen.getByRole('button', { name: /cash operations/i })).toBeInTheDocument();
```

- [ ] **Step 2: Add route**

In `web/src/App.tsx`, add:

```tsx
<Route path="reception/cash-operations" element={<CashOperationsPage />} />
```

Place it beside the current reception dashboard routes.

- [ ] **Step 3: Add query keys**

In `web/src/lib/queryKeys.ts`:

```ts
cashOperations: {
  overview: () => ['cashOperations', 'overview'] as const,
  activity: (filters?: Record<string, unknown>) => ['cashOperations', 'activity', filters] as const,
  settings: () => ['cashOperations', 'settings'] as const,
},
```

- [ ] **Step 4: Remove dashboard panel**

Delete `ReceptionDoctorPayoutPanel` and `ReceptionDrawerCustodyPanel` imports/rendering from `web/src/components/reception/ReceptionTopBar.tsx`. Keep the compact active-shift amount button.

- [ ] **Step 5: Change counter dropdown action**

In `ReceptionTopBarBase.tsx`, replace the dropdown handover action label with Cash Operations and navigate to `/${tenantSlug}/reception/cash-operations` using the existing tenant route helper.

- [ ] **Step 6: Run topbar tests**

```bash
pnpm vitest run web/src/components/reception/ReceptionTopBar.test.tsx web/src/lib/queryKeys.test.ts
```

Expected: no outflow panel on dashboard and route query keys pass.

- [ ] **Step 7: Commit navigation work**

```bash
git add web/src/App.tsx web/src/lib/queryKeys.ts web/src/components/reception/ReceptionTopBar.tsx web/src/components/reception/ReceptionTopBarBase.tsx web/src/components/reception/ReceptionTopBar.test.tsx web/src/lib/queryKeys.test.ts
git commit -m "feat: move reception cash controls off dashboard"
```

## Task 6: Cash Operations Page UI

**Files:**
- Create: `web/src/pages/reception/CashOperationsPage.tsx`
- Create: `web/src/components/reception/cash-operations/CashOverviewCards.tsx`
- Create: `web/src/components/reception/cash-operations/DoctorPayoutWorkspace.tsx`
- Create: `web/src/components/reception/cash-operations/ExpensePaymentPanel.tsx`
- Create: `web/src/components/reception/cash-operations/CashTransferPanel.tsx`
- Create: `web/src/components/reception/cash-operations/BankDepositPanel.tsx`
- Create: `web/src/components/reception/cash-operations/CloseShiftPanel.tsx`
- Create: `web/src/components/reception/cash-operations/RecentCashActivity.tsx`
- Test: `web/src/pages/reception/CashOperationsPage.test.tsx`

- [ ] **Step 1: Write page behavior tests**

Cover receptionist-friendly controls:

```tsx
render(<CashOperationsPage />);
expect(await screen.findByText(/today's cash overview/i)).toBeInTheDocument();
expect(screen.getByRole('tab', { name: /doctor payout/i })).toBeInTheDocument();
expect(screen.getByText(/consultation/i)).toBeInTheDocument();
expect(screen.getByText(/test\/usg/i)).toBeInTheDocument();
```

- [ ] **Step 2: Build page shell**

Use existing card, button, badge, tab, table, and empty-state classes from nearby reception pages. The desktop layout is:

```tsx
<main className="space-y-4">
  <CashOverviewCards />
  <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4">
    <DoctorPayoutWorkspace />
    <RecentCashActivity />
  </section>
</main>
```

- [ ] **Step 3: Build doctor payout workspace**

Add doctor/date/source/status filters, grouped accrual table, row checkboxes, group select actions, and sticky selected summary. Disable confirm unless all selected items belong to one doctor and the net payable amount is positive.

- [ ] **Step 4: Build execution forms**

Use compact panels for receiver, payment method, adjustments, notes, and optional attachment key. Confirm through a small dialog that displays selected count, gross commission, adjustments, net payout, receiver, and drawer impact.

- [ ] **Step 5: Move expense, transfer, deposit, and close panels**

Reuse existing endpoint shapes where possible. Keep the UI labels simple for receptionists: `Doctor Payout`, `Petty Cash Expense`, `Cash Transfer`, `Bank Deposit`, `Close Shift`.

- [ ] **Step 6: Run page tests**

```bash
pnpm vitest run web/src/pages/reception/CashOperationsPage.test.tsx
```

Expected: page renders overview, tabs, filters, selection summary, and admin monitoring mode without payment execution buttons.

- [ ] **Step 7: Commit page work**

```bash
git add web/src/pages/reception/CashOperationsPage.tsx web/src/components/reception/cash-operations web/src/pages/reception/CashOperationsPage.test.tsx
git commit -m "feat: add reception cash operations page"
```

## Task 7: Handover Modal Narrowing and Existing Workflow Wiring

**Files:**
- Modify: `web/src/components/reception/ReceptionTopBarBase.tsx`
- Modify: `src/routes/tenant/payment-methods.ts`
- Modify: `test/integration/routes/billing-counter.test.ts`
- Modify: `web/src/components/reception/ReceptionTopBar.test.tsx`

- [ ] **Step 1: Write handover regression test**

Ensure the handover modal is about close/receive/reconcile and not a mixed expense/payment workspace:

```ts
expect(screen.getByRole('heading', { name: /shift handover/i })).toBeInTheDocument();
expect(screen.queryByText(/expense payment/i)).not.toBeInTheDocument();
expect(screen.queryByText(/doctor payout/i)).not.toBeInTheDocument();
```

- [ ] **Step 2: Trim modal sections**

Remove drawer adjustment, expense payment, and bank deposit form sections from the handover modal. Keep shift cash, counted cash, variance, receiver acceptance, and close confirmation.

- [ ] **Step 3: Wire transfer acceptance**

Keep `billing_counter_cash_transfers` acceptance as a receiver-confirmed action. When destination is another counter session, create the receiver `cash_in` and sender settlement state in a single guarded transition.

- [ ] **Step 4: Run handover and billing-counter tests**

```bash
pnpm vitest run web/src/components/reception/ReceptionTopBar.test.tsx test/integration/routes/billing-counter.test.ts
```

Expected: handover stays narrow, and transfer acceptance still posts the right cash movements.

- [ ] **Step 5: Commit handover cleanup**

```bash
git add web/src/components/reception/ReceptionTopBarBase.tsx src/routes/tenant/payment-methods.ts test/integration/routes/billing-counter.test.ts web/src/components/reception/ReceptionTopBar.test.tsx
git commit -m "feat: focus reception handover on shift close"
```

## Task 8: End-to-End Verification and Production Push

**Files:**
- Verify all modified files from previous tasks.

- [ ] **Step 1: Run focused backend tests**

```bash
pnpm vitest run test/integration/routes/reception-doctor-payouts.test.ts test/integration/routes/cash-operations.test.ts test/expenses.test.ts test/doctor-commission-routes.test.ts
```

Expected: all focused finance and payout tests pass.

- [ ] **Step 2: Run focused frontend tests**

```bash
pnpm vitest run web/src/components/reception/ReceptionTopBar.test.tsx web/src/pages/reception/CashOperationsPage.test.tsx web/src/lib/queryKeys.test.ts
```

Expected: reception navigation and Cash Operations page tests pass.

- [ ] **Step 3: Run build**

```bash
pnpm build
```

Expected: worker and web builds complete. If unrelated repository-wide type errors appear, capture exact files and keep the focused test result as the merge-safety signal.

- [ ] **Step 4: Review diff**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only intended files are changed or staged.

- [ ] **Step 5: Apply production migration before relying on new routes**

```bash
pnpm exec wrangler d1 migrations apply DB --env production --remote
pnpm exec wrangler d1 migrations list DB --env production --remote
```

Expected: `0363_reception_cash_operations.sql` is applied and the list reports no pending production migrations.

- [ ] **Step 6: Deploy production worker**

```bash
pnpm build && wrangler deploy --env production
```

Expected: production deployment succeeds at `https://hms-saas-production.rahmatullahzisan.workers.dev`.

- [ ] **Step 7: Push main**

```bash
git push origin main
```

Expected: branch `main` is pushed. GitHub Actions starts the existing CI/CD workflow.

## Self-Review

- Spec coverage: The plan covers the dedicated Cash Operations page, cashier payout execution, admin/MD monitoring, doctor payout breakdown and receipt metadata, partial item settlement, expense approve-then-execute, cash transfer acceptance, bank deposit relocation, handover narrowing, overview cards, recent activity, production migration, deploy, and push.
- Source of truth: The plan keeps `cash_drawer_movements` as the canonical drawer ledger and uses domain tables for workflow state. No duplicate generic ledger is introduced.
- Security and roles: Monitoring users read and approve but do not create drawer movements. Cash execution requires active cashier counter session checks.
- Atomicity: Doctor payout and expense execution use guarded D1 batches, with item-count and state guards.
- Local parity: The plan requires both numbered migration and `tenant-schema.sql` updates for cloud and local installs.
