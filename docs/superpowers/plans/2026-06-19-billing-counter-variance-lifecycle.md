# Billing Counter Variance Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden high-variance billing-counter close so final cash custody records are only created after supervisor approval.

**Architecture:** Keep `billing_counter_sessions.status` compatible with the current schema and use `variance_approval_status='pending'` as the temporary lock. Store intended handover details on `cash_variance_approvals`, then have the supervisor approval endpoint atomically finalize the close and custody rows.

**Tech Stack:** Hono route handlers, Cloudflare D1 batch statements, Vitest route integration tests, additive SQLite/D1 migrations.

---

### Task 1: Add failing high-variance lifecycle tests

**Files:**
- Modify: `test/integration/routes/billing-counter.test.ts`

- [ ] **Step 1: Add helper fixtures near the existing close tests**

```ts
const HIGH_VARIANCE_PENDING_APPROVAL = {
  id: 7001,
  tenant_id: TENANT_1.id,
  counter_session_id: ACTIVE_SESSION.id,
  variance: -80,
  threshold: 50,
  requested_by: ACTIVE_SESSION.employee_id,
  handover_to: HANDOVER_RECIPIENT.id,
  handover_amount: 20,
  handover_due_amount: 0,
  handover_total: 20,
  handover_status: 'pending',
  status: 'pending',
  reason: 'Short cash after recount',
};
```

- [ ] **Step 2: Add a high-variance close test**

```ts
it('parks high-variance close without handover or drawer movement until approval', async () => {
  const { app, mockDB } = createTestApp({
    route: billingCounterRoutes,
    routePath: '/billing-counter',
    role: 'receptionist',
    tenantId: TENANT_1.id,
    tables: {
      billing_counters: [COUNTER],
      billing_counter_sessions: [ACTIVE_SESSION],
      users: [HANDOVER_RECIPIENT],
    },
    queryOverride(sql) {
      const normalized = sql.toLowerCase();
      if (normalized.includes('from billing_counter_sessions s') && normalized.includes('appointment_cash')) {
        return { first: { opening_cash: 100, cash_in: 0, cash_out: 0, appointment_cash: 0, test_cash: 0, total_discount: 0, free_appointment_count: 0, doctor_payable_total: 0, commission_payable_total: 0 } };
      }
      return null;
    },
  });

  const close = await jsonRequest(app, '/billing-counter/sessions/17/close', {
    method: 'POST',
    body: { closingCash: 20, handoverTo: HANDOVER_RECIPIENT.id, remarks: 'Short cash after recount' },
  });

  expect(close.status).toBe(202);
  const body = await close.json() as { handoverCreated: boolean; varianceApprovalStatus: string };
  expect(body).toMatchObject({ handoverCreated: false, varianceApprovalStatus: 'pending' });
  const handoverInserts = mockDB.queries.filter((q) => q.sql.toLowerCase().includes('insert into billing_handovers'));
  const drawerHandoverInserts = mockDB.queries.filter((q) => q.sql.toLowerCase().includes('insert into cash_drawer_movements') && q.params.includes('handover'));
  expect(handoverInserts).toHaveLength(0);
  expect(drawerHandoverInserts).toHaveLength(0);
});
```

- [ ] **Step 3: Add supervisor approve, reject, and normal close assertions**

```ts
it('supervisor approval finalizes high-variance close and creates custody records', async () => {
  const { app, mockDB } = createTestApp({
    route: billingCounterRoutes,
    routePath: '/billing-counter',
    role: 'accountant',
    tenantId: TENANT_1.id,
    tables: {
      billing_counter_sessions: [{ ...ACTIVE_SESSION, variance_approval_required: 1, variance_approval_status: 'pending', closing_cash_declared: 20, expected_cash: 100, variance: -80 }],
      cash_variance_approvals: [HIGH_VARIANCE_PENDING_APPROVAL],
    },
  });

  const approve = await jsonRequest(app, '/billing-counter/sessions/17/variance-approvals', {
    method: 'POST',
    body: { decision: 'approve', reason: 'Approved after CCTV review' },
  });

  expect(approve.status).toBe(200);
  const body = await approve.json() as { status: string; decision: string; handoverCreated: boolean };
  expect(body).toMatchObject({ status: 'closed', decision: 'approve', handoverCreated: true });
  expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into billing_handovers'))).toBe(true);
  expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into cash_drawer_movements') && q.params.includes('handover'))).toBe(true);
});

it('supervisor rejection unlocks high-variance session for recount without custody records', async () => {
  const { app, mockDB } = createTestApp({
    route: billingCounterRoutes,
    routePath: '/billing-counter',
    role: 'accountant',
    tenantId: TENANT_1.id,
    tables: {
      billing_counter_sessions: [{ ...ACTIVE_SESSION, variance_approval_required: 1, variance_approval_status: 'pending', closing_cash_declared: 20, expected_cash: 100, variance: -80 }],
      cash_variance_approvals: [HIGH_VARIANCE_PENDING_APPROVAL],
    },
  });

  const reject = await jsonRequest(app, '/billing-counter/sessions/17/variance-approvals', {
    method: 'POST',
    body: { decision: 'reject', reason: 'Recount required' },
  });

  expect(reject.status).toBe(200);
  const body = await reject.json() as { status: string; decision: string; handoverCreated: boolean };
  expect(body).toMatchObject({ status: 'active', decision: 'reject', handoverCreated: false });
  expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into billing_handovers'))).toBe(false);
  expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into cash_drawer_movements') && q.params.includes('handover'))).toBe(false);
});
```

- [ ] **Step 4: Run tests to verify RED**

Run: `pnpm exec vitest run test/integration/routes/billing-counter.test.ts`

Expected: fail because high-variance close still creates handover/drawer movement, and approval does not create custody records.

### Task 2: Add additive schema columns for pending handover intent

**Files:**
- Create: `migrations/0362_cash_variance_pending_handover.sql`

- [ ] **Step 1: Add migration**

```sql
-- Migration 0362: store pending high-variance counter close handover intent.
-- Additive only; existing approval rows remain valid.

ALTER TABLE cash_variance_approvals ADD COLUMN handover_to INTEGER;
ALTER TABLE cash_variance_approvals ADD COLUMN handover_amount REAL DEFAULT 0;
ALTER TABLE cash_variance_approvals ADD COLUMN handover_due_amount REAL DEFAULT 0;
ALTER TABLE cash_variance_approvals ADD COLUMN handover_total REAL DEFAULT 0;
ALTER TABLE cash_variance_approvals ADD COLUMN handover_status TEXT
  CHECK(handover_status IN ('pending','partial') OR handover_status IS NULL);
```

### Task 3: Implement pending close and supervisor decision finalization

**Files:**
- Modify: `src/routes/tenant/billingCounter.ts`

- [ ] **Step 1: Change high-variance close batch**

Replace the unconditional handover/drawer inserts with a conditional branch: if approval is required, update the session to locked pending and insert only `cash_variance_approvals` with handover intent columns.

- [ ] **Step 2: Keep normal close behavior**

For approval-not-required closes, keep `status='closed'`, approved variance row, `billing_handovers`, `cash_drawer_movements`, and `recordCashHandoverEvent`.

- [ ] **Step 3: Implement approval finalization**

Load the pending approval row with handover intent. On approve, batch the session close, approval-row approval, `billing_handovers` insert, and drawer movement insert. Emit the handover accounting event after the batch succeeds.

- [ ] **Step 4: Implement rejection unlock**

On reject, batch the session unlock and approval-row rejection. Clear session close snapshot fields and `variance_approval_required/status/at/reason` so the cashier can recount/re-close.

- [ ] **Step 5: Preserve idempotency**

Keep already-approved responses as no-op and ensure the approve branch only processes `status='pending'` approval rows.

### Task 4: Verify and commit

**Files:**
- Modified files from Tasks 1-3.

- [ ] **Step 1: Run targeted tests**

Run: `pnpm exec vitest run test/integration/routes/billing-counter.test.ts`

Expected: all billing-counter route tests pass.

- [ ] **Step 2: Run type/build check**

Run: `pnpm build`

Expected: build completes.

- [ ] **Step 3: Review diff**

Run: `git diff --check && git diff`

Expected: no whitespace errors; diff contains only spec/plan, migration, route, and test changes.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-06-19-billing-counter-variance-lifecycle.md migrations/0362_cash_variance_pending_handover.sql src/routes/tenant/billingCounter.ts test/integration/routes/billing-counter.test.ts
git commit -m "fix: finalize counter variance approvals safely"
```
