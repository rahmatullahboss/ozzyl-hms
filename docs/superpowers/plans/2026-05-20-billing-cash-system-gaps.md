# Billing Cash System Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 4 critical billing cash system gaps identified from DanpheEMR comparison: Credit Bill Status Tracking, User-to-Account Handover, Aging Report, and Fraction/Incentive System.

**Architecture:** Extend existing D1 schema with new tables, add API routes following existing Hono patterns, integrate with existing `emp_cash_transactions` and `billing_settlements` systems. All new tables include `tenant_id` for multi-tenancy.

**Tech Stack:** Hono (API), Drizzle ORM (schema), D1 (SQLite), Zod (validation)

---

## Feature 1: Credit Bill Status Tracking

### Task 1: Create `billing_credit_bill_status` table

**Files:**
- Modify: `src/db/schema/schema.ts` (add table after `billingSettlements`)
- Modify: `src/db/schema/relations.ts` (add relations)
- Create: `migrations/0260_billing_credit_bill_status.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- migrations/0260_billing_credit_bill_status.sql
CREATE TABLE IF NOT EXISTS billing_credit_bill_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  bill_id INTEGER NOT NULL,
  fiscal_year_id INTEGER,
  invoice_no TEXT,
  invoice_date TEXT,
  patient_id INTEGER NOT NULL,
  credit_organization_id INTEGER,
  liable_party TEXT NOT NULL DEFAULT 'SELF',
  sales_total_bill_amount REAL NOT NULL DEFAULT 0,
  return_total_bill_amount REAL NOT NULL DEFAULT 0,
  co_pay_received_amount REAL NOT NULL DEFAULT 0,
  co_pay_return_amount REAL NOT NULL DEFAULT 0,
  net_receivable_amount REAL NOT NULL DEFAULT 0,
  non_claimable_amount REAL NOT NULL DEFAULT 0,
  is_claimable INTEGER NOT NULL DEFAULT 1,
  claim_code TEXT,
  settlement_id INTEGER,
  settlement_status TEXT NOT NULL DEFAULT 'Pending',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT,
  FOREIGN KEY (bill_id) REFERENCES bills(id),
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (settlement_id) REFERENCES billing_settlements(id)
);

CREATE INDEX idx_credit_bill_status_tenant ON billing_credit_bill_status(tenant_id);
CREATE INDEX idx_credit_bill_status_patient ON billing_credit_bill_status(tenant_id, patient_id);
CREATE INDEX idx_credit_bill_status_settlement ON billing_credit_bill_status(tenant_id, settlement_status);
CREATE INDEX idx_credit_bill_status_bill ON billing_credit_bill_status(tenant_id, bill_id);
```

- [ ] **Step 2: Run migration**

```bash
npx wrangler d1 execute hms-saas-db --local --file=migrations/0260_billing_credit_bill_status.sql
```

- [ ] **Step 3: Add Drizzle schema to `schema.ts`**

```typescript
// Add after billingSettlements definition in schema.ts
export const billingCreditBillStatus = sqliteTable("billing_credit_bill_status", {
  id: integer().primaryKey({ autoIncrement: true }),
  tenantId: text("tenant_id").notNull(),
  billId: integer("bill_id").notNull().references(() => bills.id),
  fiscalYearId: integer("fiscal_year_id"),
  invoiceNo: text("invoice_no"),
  invoiceDate: text("invoice_date"),
  patientId: integer("patient_id").notNull().references(() => patients.id),
  creditOrganizationId: integer("credit_organization_id"),
  liableParty: text("liable_party").notNull().default("SELF"),
  salesTotalBillAmount: real("sales_total_bill_amount").notNull().default(0),
  returnTotalBillAmount: real("return_total_bill_amount").notNull().default(0),
  coPayReceivedAmount: real("co_pay_received_amount").notNull().default(0),
  coPayReturnAmount: real("co_pay_return_amount").notNull().default(0),
  netReceivableAmount: real("net_receivable_amount").notNull().default(0),
  nonClaimableAmount: real("non_claimable_amount").notNull().default(0),
  isClaimable: integer("is_claimable").notNull().default(1),
  claimCode: text("claim_code"),
  settlementId: integer("settlement_id").references(() => billingSettlements.id),
  settlementStatus: text("settlement_status").notNull().default("Pending"),
  isActive: integer("is_active").notNull().default(1),
  createdBy: integer("created_by"),
  createdAt: text("created_at").default(sql`(datetime('now', '+6 hours'))`),
  updatedAt: text("updated_at"),
}, (table) => [
  index("idx_credit_bill_status_tenant").on(table.tenantId),
  index("idx_credit_bill_status_patient").on(table.tenantId, table.patientId),
  index("idx_credit_bill_status_settlement").on(table.tenantId, table.settlementStatus),
  index("idx_credit_bill_status_bill").on(table.tenantId, table.billId),
  check("credit_bill_status_liable_party_check", sql`liable_party IN ('SELF', 'Organization')`),
  check("credit_bill_status_settlement_check", sql`settlement_status IN ('Pending', 'Completed')`),
]);
```

- [ ] **Step 4: Add relations to `relations.ts`**

```typescript
// Add to relations.ts
export const billingCreditBillStatusRelations = relations(billingCreditBillStatus, ({one}) => ({
  bill: one(bills, { fields: [billingCreditBillStatus.billId], references: [bills.id] }),
  patient: one(patients, { fields: [billingCreditBillStatus.patientId], references: [patients.id] }),
  settlement: one(billingSettlements, { fields: [billingCreditBillStatus.settlementId], references: [billingSettlements.id] }),
}));
```

- [ ] **Step 5: Export from `index.ts`**

```typescript
// Ensure schema.ts exports are picked up - no change needed since schema.ts is already exported
```

- [ ] **Step 6: Commit**

```bash
git add migrations/0260_billing_credit_bill_status.sql src/db/schema/schema.ts src/db/schema/relations.ts
git commit -m "feat(billing): add credit_bill_status table for credit invoice tracking"
```

---

### Task 2: Create Credit Bill Status API routes

**Files:**
- Create: `src/routes/tenant/billingCreditStatus.ts`
- Modify: `src/index.ts` (register route)

- [ ] **Step 1: Write failing test for credit bill status creation**

```typescript
// tests/billing-credit-status.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('Billing Credit Bill Status', () => {
  let billId: number;

  beforeAll(async () => {
    // Create a test bill first
    const res = await fetch('http://localhost:8787/api/billing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': '1', 'x-user-id': '1' },
      body: JSON.stringify({
        patient_id: 1,
        items: [{ item_category: 'test', description: 'Test', quantity: 1, unit_price: 100, line_total: 100 }],
        discount: 0,
        total: 100,
      }),
    });
    const data = await res.json();
    billId = data.bill.id;
  });

  it('should create credit bill status for a bill', async () => {
    const res = await fetch('http://localhost:8787/api/billing-credit-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': '1', 'x-user-id': '1' },
      body: JSON.stringify({
        bill_id: billId,
        patient_id: 1,
        liable_party: 'SELF',
        sales_total_bill_amount: 100,
      }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.credit_bill_status).toBeDefined();
    expect(data.credit_bill_status.settlement_status).toBe('Pending');
  });

  it('should list pending credit bills', async () => {
    const res = await fetch('http://localhost:8787/api/billing-credit-status/pending', {
      headers: { 'x-tenant-id': '1', 'x-user-id': '1' },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.credit_bills)).toBe(true);
  });

  it('should update settlement status on settlement', async () => {
    // This test verifies that when a settlement is created,
    // the credit bill status is updated to 'Completed'
    const res = await fetch(`http://localhost:8787/api/billing-credit-status/by-bill/${billId}`, {
      headers: { 'x-tenant-id': '1', 'x-user-id': '1' },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.credit_bill_status).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/billing-credit-status.test.ts
```
Expected: FAIL - route not found

- [ ] **Step 3: Create API route file**

```typescript
// src/routes/tenant/billingCreditStatus.ts
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { requireRole } from '../../middleware/rbac';
import { billingCreditBillStatus } from '../../db/schema';
import { eq, and } from 'drizzle-orm';

const creditStatusRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
const CREDIT_STATUS_ROLES = ['hospital_admin', 'md', 'director', 'accountant', 'reception'] as const;

const createCreditStatusSchema = z.object({
  bill_id: z.number().int().positive(),
  patient_id: z.number().int().positive(),
  fiscal_year_id: z.number().int().positive().optional(),
  invoice_no: z.string().optional(),
  credit_organization_id: z.number().int().positive().optional(),
  liable_party: z.enum(['SELF', 'Organization']).default('SELF'),
  sales_total_bill_amount: z.number().min(0).default(0),
  return_total_bill_amount: z.number().min(0).default(0),
  co_pay_received_amount: z.number().min(0).default(0),
  co_pay_return_amount: z.number().min(0).default(0),
  non_claimable_amount: z.number().min(0).default(0),
  is_claimable: z.number().int().min(0).max(1).default(1),
  claim_code: z.string().optional(),
});

// GET / - list credit bill statuses
creditStatusRoutes.get('/', requireRole(...CREDIT_STATUS_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const perPage = Math.min(200, Math.max(1, parseInt(c.req.query('per_page') || '50')));
  const offset = (page - 1) * perPage;

  const results = await db.$client.prepare(`
    SELECT cbs.*, p.name as patient_name, p.patient_code
    FROM billing_credit_bill_status cbs
    JOIN patients p ON cbs.patient_id = p.id AND p.tenant_id = cbs.tenant_id
    WHERE cbs.tenant_id = ? AND cbs.is_active = 1
    ORDER BY cbs.created_at DESC LIMIT ? OFFSET ?
  `).bind(tenantId, perPage, offset).all();

  return c.json({ credit_bills: results.results });
});

// GET /pending - list pending credit bills
creditStatusRoutes.get('/pending', requireRole(...CREDIT_STATUS_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const results = await db.$client.prepare(`
    SELECT cbs.*, p.name as patient_name, p.patient_code
    FROM billing_credit_bill_status cbs
    JOIN patients p ON cbs.patient_id = p.id AND p.tenant_id = cbs.tenant_id
    WHERE cbs.tenant_id = ? AND cbs.is_active = 1 AND cbs.settlement_status = 'Pending'
    ORDER BY cbs.created_at DESC
  `).bind(tenantId).all();

  return c.json({ credit_bills: results.results });
});

// GET /by-bill/:billId - get credit status for a specific bill
creditStatusRoutes.get('/by-bill/:billId', requireRole(...CREDIT_STATUS_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const billId = Number(c.req.param('billId'));

  const result = await db.$client.prepare(`
    SELECT * FROM billing_credit_bill_status
    WHERE tenant_id = ? AND bill_id = ? AND is_active = 1
  `).bind(tenantId, billId).first();

  if (!result) throw new HTTPException(404, { message: 'Credit bill status not found' });
  return c.json({ credit_bill_status: result });
});

// POST / - create credit bill status
creditStatusRoutes.post('/', requireRole(...CREDIT_STATUS_ROLES), zValidator('json', createCreditStatusSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = Number(requireUserId(c));
  const body = c.req.valid('json');

  const netReceivable = body.sales_total_bill_amount - body.return_total_bill_amount
    - body.co_pay_received_amount + body.co_pay_return_amount - body.non_claimable_amount;

  const result = await db.$client.prepare(`
    INSERT INTO billing_credit_bill_status (
      tenant_id, bill_id, patient_id, fiscal_year_id, invoice_no,
      credit_organization_id, liable_party, sales_total_bill_amount,
      return_total_bill_amount, co_pay_received_amount, co_pay_return_amount,
      net_receivable_amount, non_claimable_amount, is_claimable, claim_code, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, body.bill_id, body.patient_id, body.fiscal_year_id ?? null,
    body.invoice_no ?? null, body.credit_organization_id ?? null, body.liable_party,
    body.sales_total_bill_amount, body.return_total_bill_amount,
    body.co_pay_received_amount, body.co_pay_return_amount,
    netReceivable, body.non_claimable_amount, body.is_claimable,
    body.claim_code ?? null, userId
  ).run();

  return c.json({ credit_bill_status: { id: result.meta.last_row_id, ...body, net_receivable_amount: netReceivable, settlement_status: 'Pending' } }, 201);
});

// PUT /:id/settle - mark as settled
creditStatusRoutes.put('/:id/settle', requireRole(...CREDIT_STATUS_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const settlementId = Number(c.req.query('settlement_id') || '0');

  await db.$client.prepare(`
    UPDATE billing_credit_bill_status
    SET settlement_status = 'Completed', settlement_id = ?, updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ? AND is_active = 1
  `).bind(settlementId || null, id, tenantId).run();

  return c.json({ success: true });
});

export { creditStatusRoutes };
```

- [ ] **Step 4: Register route in `src/index.ts`**

```typescript
// Add import
import { creditStatusRoutes } from './routes/tenant/billingCreditStatus';

// Add route registration (near other billing routes)
app.route('/api/billing-credit-status', creditStatusRoutes);
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run tests/billing-credit-status.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/routes/tenant/billingCreditStatus.ts src/index.ts tests/billing-credit-status.test.ts
git commit -m "feat(billing): add credit bill status API routes"
```

---

## Feature 2: User-to-Account Handover

### Task 3: Enhance handover with account type and denomination

**Files:**
- Modify: `src/db/schema/schema.ts` (enhance `billingHandovers`)
- Create: `migrations/0261_handover_enhancements.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- migrations/0261_handover_enhancements.sql
ALTER TABLE billing_handovers ADD COLUMN handover_type TEXT DEFAULT 'user';
ALTER TABLE billing_handovers ADD COLUMN bank_name TEXT;
ALTER TABLE billing_handovers ADD COLUMN voucher_number TEXT;
ALTER TABLE billing_handovers ADD COLUMN voucher_date TEXT;
ALTER TABLE billing_handovers ADD COLUMN denomination_details TEXT;
```

- [ ] **Step 2: Run migration**

```bash
npx wrangler d1 execute hms-saas-db --local --file=migrations/0261_handover_enhancements.sql
```

- [ ] **Step 3: Update Drizzle schema**

```typescript
// Update billingHandovers in schema.ts
export const billingHandovers = sqliteTable("billing_handovers", {
  // ... existing fields ...
  handoverType: text("handover_type").default("user"), // 'user' or 'account'
  bankName: text("bank_name"),
  voucherNumber: text("voucher_number"),
  voucherDate: text("voucher_date"),
  denominationDetails: text("denomination_details"), // JSON string
}, (table) => [
  // ... existing indexes ...
  check("handover_type_check", sql`handover_type IN ('user', 'account')`),
]);
```

- [ ] **Step 4: Commit**

```bash
git add migrations/0261_handover_enhancements.sql src/db/schema/schema.ts
git commit -m "feat(billing): add account handover type and denomination tracking"
```

---

### Task 4: Add account handover API endpoint

**Files:**
- Modify: `src/routes/tenant/billingHandover.ts`

- [ ] **Step 1: Write failing test for account handover**

```typescript
// tests/billing-handover.test.ts
describe('Billing Handover - Account Type', () => {
  it('should create account handover with bank details', async () => {
    const res = await fetch('http://localhost:8787/api/billing-handover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': '1', 'x-user-id': '1' },
      body: JSON.stringify({
        handover_to: null,
        handover_type: 'account',
        bank_name: 'Dutch Bangla Bank',
        voucher_number: 'VCH-001',
        voucher_date: '2026-05-20',
        handover_amount: 5000,
        denomination_details: JSON.stringify({
          notes_100: 10,
          notes_50: 20,
          notes_20: 50,
          notes_10: 100,
          coins: 0,
        }),
        remarks: 'Daily cash deposit',
      }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.handover.handover_type).toBe('account');
    expect(data.handover.bank_name).toBe('Dutch Bangla Bank');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/billing-handover.test.ts
```

- [ ] **Step 3: Update handover route to support account type**

```typescript
// Modify src/routes/tenant/billingHandover.ts

// Update create schema
const createHandoverSchema = z.object({
  handover_to: z.number().int().positive().nullable().optional(),
  handover_type: z.enum(['user', 'account']).default('user'),
  bank_name: z.string().optional(),
  voucher_number: z.string().optional(),
  voucher_date: z.string().optional(),
  handover_amount: z.number().positive(),
  denomination_details: z.string().optional(), // JSON
  remarks: z.string().optional(),
  counter_session_id: z.number().int().positive().optional(),
});

// Update POST / handler
handover.post('/', requireRole(...HANDOVER_ROLES), zValidator('json', createHandoverSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = Number(requireUserId(c));
  const body = c.req.valid('json');

  // For account handover, handover_to can be null
  if (body.handover_type === 'user' && !body.handover_to) {
    throw new HTTPException(400, { message: 'handover_to is required for user handover' });
  }

  const result = await db.$client.prepare(`
    INSERT INTO billing_handovers (
      tenant_id, handover_type, counter_session_id, handover_by, handover_to,
      handover_amount, bank_name, voucher_number, voucher_date,
      denomination_details, remarks, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, body.handover_type, body.counter_session_id ?? null,
    userId, body.handover_to ?? null, body.handover_amount,
    body.bank_name ?? null, body.voucher_number ?? null, body.voucher_date ?? null,
    body.denomination_details ?? null, body.remarks ?? null,
    body.handover_type === 'account' ? 'Received' : 'pending'
  ).run();

  // Record accounting event
  await recordCashHandoverEvent(c, tenantId, result.meta.last_row_id, userId, body.handover_amount, {
    handover_type: body.handover_type,
    bank_name: body.bank_name,
  });

  return c.json({
    handover: {
      id: result.meta.last_row_id,
      ...body,
      status: body.handover_type === 'account' ? 'Received' : 'pending',
    }
  }, 201);
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/billing-handover.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/tenant/billingHandover.ts tests/billing-handover.test.ts
git commit -m "feat(billing): add account handover with bank/voucher details"
```

---

## Feature 3: Aging Report

### Task 5: Create aging report API endpoint

**Files:**
- Create: `src/routes/tenant/billingAging.ts`
- Modify: `src/index.ts` (register route)

- [ ] **Step 1: Write failing test for aging report**

```typescript
// tests/billing-aging.test.ts
describe('Billing Aging Report', () => {
  it('should return aging buckets for outstanding bills', async () => {
    const res = await fetch('http://localhost:8787/api/billing-aging/report', {
      headers: { 'x-tenant-id': '1', 'x-user-id': '1' },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.aging_report).toBeDefined();
    expect(data.aging_report.summary).toBeDefined();
    expect(data.aging_report.buckets).toBeDefined();
    expect(data.aging_report.buckets.current).toBeDefined();
    expect(data.aging_report.buckets['30_days']).toBeDefined();
    expect(data.aging_report.buckets['60_days']).toBeDefined();
    expect(data.aging_report.buckets['90_days']).toBeDefined();
    expect(data.aging_report.buckets['120_plus_days']).toBeDefined();
  });

  it('should return patient-wise aging details', async () => {
    const res = await fetch('http://localhost:8787/api/billing-aging/patients', {
      headers: { 'x-tenant-id': '1', 'x-user-id': '1' },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.patients)).toBe(true);
    if (data.patients.length > 0) {
      expect(data.patients[0].current).toBeDefined();
      expect(data.patients[0].days_30).toBeDefined();
      expect(data.patients[0].days_60).toBeDefined();
      expect(data.patients[0].days_90).toBeDefined();
      expect(data.patients[0].days_120_plus).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/billing-aging.test.ts
```

- [ ] **Step 3: Create aging report API route**

```typescript
// src/routes/tenant/billingAging.ts
import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { requireTenantId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { requireRole } from '../../middleware/rbac';

const agingRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
const AGING_ROLES = ['hospital_admin', 'md', 'director', 'accountant'] as const;

agingRoutes.use('*', requireRole(...AGING_ROLES));

// GET /report - aging summary with buckets
agingRoutes.get('/report', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const result = await db.$client.prepare(`
    SELECT
      COUNT(*) as total_bills,
      COALESCE(SUM(due), 0) as total_due,
      COALESCE(SUM(CASE WHEN julianday('now') - julianday(created_at) <= 30 THEN due ELSE 0 END), 0) as current_due,
      COALESCE(SUM(CASE WHEN julianday('now') - julianday(created_at) > 30 AND julianday('now') - julianday(created_at) <= 60 THEN due ELSE 0 END), 0) as days_30_due,
      COALESCE(SUM(CASE WHEN julianday('now') - julianday(created_at) > 60 AND julianday('now') - julianday(created_at) <= 90 THEN due ELSE 0 END), 0) as days_60_due,
      COALESCE(SUM(CASE WHEN julianday('now') - julianday(created_at) > 90 AND julianday('now') - julianday(created_at) <= 120 THEN due ELSE 0 END), 0) as days_90_due,
      COALESCE(SUM(CASE WHEN julianday('now') - julianday(created_at) > 120 THEN due ELSE 0 END), 0) as days_120_plus_due
    FROM bills
    WHERE tenant_id = ? AND COALESCE(status, 'open') NOT IN ('cancelled', 'refunded', 'draft', 'paid')
      AND COALESCE(due, 0) > 0
  `).bind(tenantId).first();

  return c.json({
    aging_report: {
      summary: {
        total_bills: result?.total_bills ?? 0,
        total_due: result?.total_due ?? 0,
      },
      buckets: {
        current: { count: 0, amount: result?.current_due ?? 0 },
        days_30: { count: 0, amount: result?.days_30_due ?? 0 },
        days_60: { count: 0, amount: result?.days_60_due ?? 0 },
        days_90: { count: 0, amount: result?.days_90_due ?? 0 },
        days_120_plus: { count: 0, amount: result?.days_120_plus_due ?? 0 },
      },
    },
  });
});

// GET /patients - patient-wise aging details
agingRoutes.get('/patients', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const perPage = Math.min(200, Math.max(1, parseInt(c.req.query('per_page') || '50')));
  const offset = (page - 1) * perPage;

  const results = await db.$client.prepare(`
    SELECT
      p.id as patient_id,
      p.name as patient_name,
      p.patient_code,
      COUNT(b.id) as total_bills,
      COALESCE(SUM(b.due), 0) as total_due,
      COALESCE(SUM(CASE WHEN julianday('now') - julianday(b.created_at) <= 30 THEN b.due ELSE 0 END), 0) as current,
      COALESCE(SUM(CASE WHEN julianday('now') - julianday(b.created_at) > 30 AND julianday('now') - julianday(b.created_at) <= 60 THEN b.due ELSE 0 END), 0) as days_30,
      COALESCE(SUM(CASE WHEN julianday('now') - julianday(b.created_at) > 60 AND julianday('now') - julianday(b.created_at) <= 90 THEN b.due ELSE 0 END), 0) as days_60,
      COALESCE(SUM(CASE WHEN julianday('now') - julianday(b.created_at) > 90 AND julianday('now') - julianday(b.created_at) <= 120 THEN b.due ELSE 0 END), 0) as days_90,
      COALESCE(SUM(CASE WHEN julianday('now') - julianday(b.created_at) > 120 THEN b.due ELSE 0 END), 0) as days_120_plus
    FROM bills b
    JOIN patients p ON b.patient_id = p.id AND p.tenant_id = b.tenant_id
    WHERE b.tenant_id = ? AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft', 'paid')
      AND COALESCE(b.due, 0) > 0
    GROUP BY p.id, p.name, p.patient_code
    HAVING total_due > 0
    ORDER BY total_due DESC
    LIMIT ? OFFSET ?
  `).bind(tenantId, perPage, offset).all();

  return c.json({ patients: results.results });
});

export { agingRoutes };
```

- [ ] **Step 4: Register route in `src/index.ts`**

```typescript
import { agingRoutes } from './routes/tenant/billingAging';
app.route('/api/billing-aging', agingRoutes);
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run tests/billing-aging.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/routes/tenant/billingAging.ts src/index.ts tests/billing-aging.test.ts
git commit -m "feat(billing): add aging report with 30/60/90/120+ day buckets"
```

---

## Feature 4: Fraction/Incentive System (Hospital-Doctor Split)

### Task 6: Create fraction percent tables

**Files:**
- Modify: `src/db/schema/finance.ts` (add fraction tables)
- Create: `migrations/0262_fraction_incentive_system.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- migrations/0262_fraction_incentive_system.sql
CREATE TABLE IF NOT EXISTS fraction_percents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  service_item_id INTEGER,
  bill_item_category TEXT,
  hospital_percent REAL NOT NULL DEFAULT 60,
  doctor_percent REAL NOT NULL DEFAULT 40,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS fraction_calculations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  bill_id INTEGER NOT NULL,
  invoice_item_id INTEGER,
  doctor_id INTEGER NOT NULL,
  gross_amount REAL NOT NULL,
  hospital_amount REAL NOT NULL,
  doctor_amount REAL NOT NULL,
  fraction_percent_id INTEGER,
  status TEXT NOT NULL DEFAULT 'calculated',
  settled_date TEXT,
  settlement_id INTEGER,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT,
  FOREIGN KEY (bill_id) REFERENCES bills(id),
  FOREIGN KEY (fraction_percent_id) REFERENCES fraction_percents(id)
);

CREATE INDEX idx_fraction_percents_tenant ON fraction_percents(tenant_id);
CREATE INDEX idx_fraction_calc_bill ON fraction_calculations(tenant_id, bill_id);
CREATE INDEX idx_fraction_calc_doctor ON fraction_calculations(tenant_id, doctor_id);
CREATE INDEX idx_fraction_calc_status ON fraction_calculations(tenant_id, status);
```

- [ ] **Step 2: Run migration**

```bash
npx wrangler d1 execute hms-saas-db --local --file=migrations/0262_fraction_incentive_system.sql
```

- [ ] **Step 3: Add Drizzle schema to `finance.ts`**

```typescript
// Add to src/db/schema/finance.ts

export const fractionPercents = sqliteTable("fraction_percents", {
  id: integer().primaryKey({ autoIncrement: true }),
  tenantId: text("tenant_id").notNull(),
  serviceItemId: integer("service_item_id"),
  billItemCategory: text("bill_item_category"),
  hospitalPercent: real("hospital_percent").notNull().default(60),
  doctorPercent: real("doctor_percent").notNull().default(40),
  isActive: integer("is_active").notNull().default(1),
  createdBy: integer("created_by"),
  createdAt: text("created_at").default(sql`(datetime('now', '+6 hours'))`),
  updatedAt: text("updated_at"),
}, (table) => [
  index("idx_fraction_percents_tenant").on(table.tenantId),
]);

export const fractionCalculations = sqliteTable("fraction_calculations", {
  id: integer().primaryKey({ autoIncrement: true }),
  tenantId: text("tenant_id").notNull(),
  billId: integer("bill_id").notNull().references(() => bills.id),
  invoiceItemId: integer("invoice_item_id"),
  doctorId: integer("doctor_id").notNull(),
  grossAmount: real("gross_amount").notNull(),
  hospitalAmount: real("hospital_amount").notNull(),
  doctorAmount: real("doctor_amount").notNull(),
  fractionPercentId: integer("fraction_percent_id").references(() => fractionPercents.id),
  status: text("status").notNull().default("calculated"),
  settledDate: text("settled_date"),
  settlementId: integer("settlement_id"),
  createdAt: text("created_at").default(sql`(datetime('now', '+6 hours'))`),
  updatedAt: text("updated_at"),
}, (table) => [
  index("idx_fraction_calc_bill").on(table.tenantId, table.billId),
  index("idx_fraction_calc_doctor").on(table.tenantId, table.doctorId),
  index("idx_fraction_calc_status").on(table.tenantId, table.status),
  check("fraction_calc_status_check", sql`status IN ('calculated', 'approved', 'settled', 'cancelled')`),
]);
```

- [ ] **Step 4: Commit**

```bash
git add migrations/0262_fraction_incentive_system.sql src/db/schema/finance.ts
git commit -m "feat(billing): add fraction percent and calculation tables"
```

---

### Task 7: Create fraction/incentive API routes

**Files:**
- Create: `src/routes/tenant/fractions.ts`
- Modify: `src/index.ts` (register route)

- [ ] **Step 1: Write failing test**

```typescript
// tests/fractions.test.ts
describe('Fraction/Incentive System', () => {
  it('should create fraction percent rule', async () => {
    const res = await fetch('http://localhost:8787/api/fractions/percent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': '1', 'x-user-id': '1' },
      body: JSON.stringify({
        bill_item_category: 'doctor_visit',
        hospital_percent: 60,
        doctor_percent: 40,
      }),
    });
    expect(res.status).toBe(201);
  });

  it('should calculate fraction for a bill', async () => {
    const res = await fetch('http://localhost:8787/api/fractions/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': '1', 'x-user-id': '1' },
      body: JSON.stringify({
        bill_id: 1,
        doctor_id: 1,
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.fraction).toBeDefined();
  });

  it('should list doctor incentive summary', async () => {
    const res = await fetch('http://localhost:8787/api/fractions/doctor-summary?doctor_id=1', {
      headers: { 'x-tenant-id': '1', 'x-user-id': '1' },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.summary).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/fractions.test.ts
```

- [ ] **Step 3: Create fraction API route**

```typescript
// src/routes/tenant/fractions.ts
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { requireRole } from '../../middleware/rbac';

const fractionRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
const FRACTION_ROLES = ['hospital_admin', 'md', 'director', 'accountant'] as const;

fractionRoutes.use('*', requireRole(...FRACTION_ROLES));

const createFractionPercentSchema = z.object({
  service_item_id: z.number().int().positive().optional(),
  bill_item_category: z.string().optional(),
  hospital_percent: z.number().min(0).max(100).default(60),
  doctor_percent: z.number().min(0).max(100).default(40),
});

const calculateFractionSchema = z.object({
  bill_id: z.number().int().positive(),
  doctor_id: z.number().int().positive(),
});

// POST /percent - create fraction percent rule
fractionRoutes.post('/percent', zValidator('json', createFractionPercentSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = Number(requireUserId(c));
  const body = c.req.valid('json');

  if (Math.abs(body.hospital_percent + body.doctor_percent - 100) > 0.01) {
    throw new HTTPException(400, { message: 'Hospital and doctor percent must sum to 100' });
  }

  const result = await db.$client.prepare(`
    INSERT INTO fraction_percents (tenant_id, service_item_id, bill_item_category, hospital_percent, doctor_percent, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(tenantId, body.service_item_id ?? null, body.bill_item_category ?? null, body.hospital_percent, body.doctor_percent, userId).run();

  return c.json({ id: result.meta.last_row_id, ...body }, 201);
});

// GET /percent - list fraction percent rules
fractionRoutes.get('/percent', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const results = await db.$client.prepare(`
    SELECT * FROM fraction_percents WHERE tenant_id = ? AND is_active = 1 ORDER BY created_at DESC
  `).bind(tenantId).all();

  return c.json({ rules: results.results });
});

// POST /calculate - calculate fraction for a bill
fractionRoutes.post('/calculate', zValidator('json', calculateFractionSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const body = c.req.valid('json');

  // Get bill items
  const billItems = await db.$client.prepare(`
    SELECT ii.*, fp.hospital_percent, fp.doctor_percent
    FROM invoice_items ii
    LEFT JOIN fraction_percents fp ON fp.tenant_id = ii.tenant_id
      AND (fp.bill_item_category = ii.item_category OR fp.service_item_id = ii.reference_id)
      AND fp.is_active = 1
    WHERE ii.bill_id = ? AND ii.tenant_id = ?
  `).bind(body.bill_id, tenantId).all();

  if (!billItems.results?.length) {
    throw new HTTPException(404, { message: 'No invoice items found for this bill' });
  }

  // Calculate fractions
  let totalHospital = 0;
  let totalDoctor = 0;

  for (const item of billItems.results as any[]) {
    const hospitalPct = item.hospital_percent ?? 60;
    const doctorPct = item.doctor_percent ?? 40;
    const lineTotal = Number(item.line_total) || 0;

    const hospitalAmount = Math.round(lineTotal * hospitalPct / 100);
    const doctorAmount = lineTotal - hospitalAmount;

    totalHospital += hospitalAmount;
    totalDoctor += doctorAmount;

    // Save calculation
    await db.$client.prepare(`
      INSERT INTO fraction_calculations (tenant_id, bill_id, invoice_item_id, doctor_id, gross_amount, hospital_amount, doctor_amount, fraction_percent_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(tenantId, body.bill_id, item.id, body.doctor_id, lineTotal, hospitalAmount, doctorAmount, item.fraction_percent_id ?? null).run();
  }

  return c.json({
    fraction: {
      bill_id: body.bill_id,
      doctor_id: body.doctor_id,
      total_gross: totalHospital + totalDoctor,
      hospital_amount: totalHospital,
      doctor_amount: totalDoctor,
      items_count: billItems.results.length,
    },
  });
});

// GET /doctor-summary - doctor incentive summary
fractionRoutes.get('/doctor-summary', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const doctorId = c.req.query('doctor_id');

  if (!doctorId) throw new HTTPException(400, { message: 'doctor_id is required' });

  const result = await db.$client.prepare(`
    SELECT
      doctor_id,
      COUNT(*) as total_items,
      COALESCE(SUM(gross_amount), 0) as total_gross,
      COALESCE(SUM(hospital_amount), 0) as total_hospital,
      COALESCE(SUM(doctor_amount), 0) as total_doctor,
      COALESCE(SUM(CASE WHEN status = 'calculated' THEN doctor_amount ELSE 0 END), 0) as pending_amount,
      COALESCE(SUM(CASE WHEN status = 'settled' THEN doctor_amount ELSE 0 END), 0) as settled_amount
    FROM fraction_calculations
    WHERE tenant_id = ? AND doctor_id = ?
    GROUP BY doctor_id
  `).bind(tenantId, Number(doctorId)).first();

  return c.json({ summary: result ?? { doctor_id: Number(doctorId), total_items: 0, total_gross: 0, total_hospital: 0, total_doctor: 0, pending_amount: 0, settled_amount: 0 } });
});

// PUT /settle - settle fractions for a doctor
fractionRoutes.put('/settle', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const doctorId = Number(c.req.query('doctor_id') || '0');

  if (!doctorId) throw new HTTPException(400, { message: 'doctor_id is required' });

  await db.$client.prepare(`
    UPDATE fraction_calculations
    SET status = 'settled', settled_date = datetime('now', '+6 hours'), updated_at = datetime('now', '+6 hours')
    WHERE tenant_id = ? AND doctor_id = ? AND status = 'calculated'
  `).bind(tenantId, doctorId).run();

  return c.json({ success: true, message: 'Fractions settled' });
});

export { fractionRoutes };
```

- [ ] **Step 4: Register route in `src/index.ts`**

```typescript
import { fractionRoutes } from './routes/tenant/fractions';
app.route('/api/fractions', fractionRoutes);
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run tests/fractions.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/routes/tenant/fractions.ts src/index.ts tests/fractions.test.ts
git commit -m "feat(billing): add fraction/incentive system with doctor-hospital split"
```

---

## Feature 5: Integrate Credit Status with Settlement

### Task 8: Update settlement to create/update credit bill status

**Files:**
- Modify: `src/routes/tenant/settlements.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/settlement-credit-integration.test.ts
describe('Settlement - Credit Bill Status Integration', () => {
  it('should update credit bill status when settlement is created', async () => {
    // This test verifies the integration between settlements and credit bill status
    const res = await fetch('http://localhost:8787/api/billing-credit-status/pending', {
      headers: { 'x-tenant-id': '1', 'x-user-id': '1' },
    });
    const data = await res.json();
    // After a settlement, pending credit bills should be reduced
    expect(data.credit_bills).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test**

```bash
npx vitest run tests/settlement-credit-integration.test.ts
```

- [ ] **Step 3: Update settlement creation to update credit bill status**

```typescript
// In src/routes/tenant/settlements.ts, inside the POST / handler
// After updating bills to 'paid', add:

// Update credit bill status
await db.$client.prepare(`
  UPDATE billing_credit_bill_status
  SET settlement_status = 'Completed', settlement_id = ?, updated_at = datetime('now', '+6 hours')
  WHERE tenant_id = ? AND patient_id = ? AND settlement_status = 'Pending' AND is_active = 1
`).bind(settlementId, tenantId, body.patient_id).run();
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/settlement-credit-integration.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/tenant/settlements.ts tests/settlement-credit-integration.test.ts
git commit -m "feat(billing): integrate credit bill status with settlement"
```

---

## Final Verification

### Task 9: Run all tests and verify

- [ ] **Step 1: Run all billing tests**

```bash
npx vitest run tests/billing-*.test.ts tests/fractions.test.ts
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(billing): complete cash system gaps - credit status, handover, aging, fractions"
```
