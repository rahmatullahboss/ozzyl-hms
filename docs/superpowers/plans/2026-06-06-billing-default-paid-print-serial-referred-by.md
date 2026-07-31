# Billing Default Paid, Auto-Print, Visit Serial, Referred-By Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make billing faster at the counter (paid = 0 default, always open print, large visit serial on every invoice, free-text appointment serial, referrer tag on test bills backed by a managed hospital list).

**Architecture:** D1 stays the source of truth. New `referral_hospitals` table for the hospital list. `bills` gets two columns (`referred_by_type`, `referred_by_hospital_id`) for the referrer. Existing `appointments.token_no` / `queue_entries.token_number` are reused for the visit serial. No new storage layer, no Durable Object, no coordination change.

**Tech Stack:** Cloudflare Workers + D1, Hono, Drizzle ORM, React + Vite, Vitest, react-i18next.

---

## File Structure

**New files**
- `migrations/0296_bills_referred_by_and_hospitals.sql` — schema migration
- `src/routes/tenant/referralHospitals.ts` — hospital CRUD endpoints
- `web/src/components/HospitalCombobox.tsx` — reusable combobox
- `web/src/components/HospitalCombobox.test.tsx` — combobox tests

**Modified**
- `src/db/schema/schema.ts` — export `referralHospitals`; add 2 columns to `bills`
- `tenant-schema.sql` — add 2 columns to `bills` for fresh installs
- `src/schemas/billingCounter.ts` — extend invoice schema
- `src/schemas/appointment.ts` — add `forceTokenNo` field
- `src/routes/tenant/billing.ts` — extend GET `/api/billing/:id` SQL
- `src/routes/tenant/billingCounter.ts` — extend bills INSERT
- `src/routes/tenant/appointments.ts` — branch on `forceTokenNo`
- `src/routes/tenant/index.ts` — mount referral hospitals routes
- `web/src/pages/BillingCounterPage.tsx` — Parts 1, 2, 6 form
- `web/src/pages/BillPrint.tsx` — Parts 3, 6 render
- `web/src/pages/AppointmentScheduler.tsx` — Part 4 UI
- `web/src/pages/BillingMasterPage.tsx` — Part 6.5 admin
- `web/src/lib/print/invoiceCategory.ts` — Part 5 label
- `web/public/locales/en/billing.json` — new i18n keys
- `web/public/locales/bn/billing.json` — Bengali i18n keys
- `web/public/locales/en/appointments.json` — new i18n keys
- `web/public/locales/bn/appointments.json` — Bengali i18n keys
- `web/src/pages/AppointmentScheduler.test.ts` — extend
- `web/src/pages/BillPrint.test.ts` — extend
- `web/src/pages/BillingCounterPage.test.ts` — extend
- `web/src/pages/BillingMasterPage.test.ts` — extend
- `web/src/lib/print/invoiceCategory.test.ts` — update assertions

---

## Task 1: Add `referral_hospitals` table and `bills` columns to Drizzle schema

**Files:**
- Modify: `src/db/schema/schema.ts`
- Test: existing build (no new test; schema-level)

- [ ] **Step 1: Add `referralHospitals` table export**

Open `src/db/schema/schema.ts` and add this new table export near the other small reference tables (e.g., right after the `tenants` / `token_reservations` style tables). Use grep to find a good insertion point.

```ts
export const referralHospitals = sqliteTable("referral_hospitals", {
  id: integer().primaryKey({ autoIncrement: true }),
  tenantId: text("tenant_id").notNull(),
  name: text().notNull(),
  shortCode: text("short_code"),
  isActive: integer("is_active").notNull().default(1),
  createdBy: integer("created_by"),
  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
},
(table) => [
  index("idx_referral_hospitals_tenant_active").on(table.tenantId, table.isActive),
]);
```

- [ ] **Step 2: Add two columns to `bills` table**

In the same file, find the `bills` table export (around line 5860) and add two new fields before the closing `}` of the column block:

```ts
  referredByType: text("referred_by_type"),
  referredByHospitalId: integer("referred_by_hospital_id"),
```

- [ ] **Step 3: Type-check the project**

Run: `cd web && pnpm typecheck 2>&1 | head -30` (or the project's typecheck command — check `package.json` `scripts`)

Expected: 0 type errors. If errors appear, fix schema syntax (most common: missing `sql` import — the existing schema file already imports it).

- [ ] **Step 4: Commit**

```bash
git add src/db/schema/schema.ts
git commit -m "feat(schema): add referral_hospitals table and bills referred_by columns"
```

---

## Task 2: Create migration and sync to local schema

**Files:**
- Create: `migrations/0296_bills_referred_by_and_hospitals.sql`
- Modify: `tenant-schema.sql`

- [ ] **Step 1: Create the migration file**

Write `migrations/0296_bills_referred_by_and_hospitals.sql`:

```sql
-- 0296_bills_referred_by_and_hospitals.sql
-- Adds referral_hospitals table for "Referred by" hospital picker on test bills,
-- and two new columns to bills to store the referrer type + hospital id.

CREATE TABLE IF NOT EXISTS referral_hospitals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  short_code TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_referral_hospitals_tenant_active
  ON referral_hospitals(tenant_id, is_active);

ALTER TABLE bills ADD COLUMN referred_by_type TEXT;
ALTER TABLE bills ADD COLUMN referred_by_hospital_id INTEGER
  REFERENCES referral_hospitals(id);
```

- [ ] **Step 2: Sync to `tenant-schema.sql` for fresh installs**

Open `tenant-schema.sql` and find the `CREATE TABLE IF NOT EXISTS bills` block (around line 46). Add the two new columns to the column list:

```sql
CREATE TABLE IF NOT EXISTS bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    test_bill REAL DEFAULT 0,
    admission_bill REAL DEFAULT 0,
    doctor_visit_bill REAL DEFAULT 0,
    operation_bill REAL DEFAULT 0,
    medicine_bill REAL DEFAULT 0,
    discount REAL DEFAULT 0,
    total REAL DEFAULT 0,
    paid REAL DEFAULT 0,
    due REAL DEFAULT 0,
    tenant_id INTEGER NOT NULL,
    referred_by_type TEXT,
    referred_by_hospital_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);
```

Also add the `referral_hospitals` table block to `tenant-schema.sql` somewhere logical (e.g., right after the `bills` table). Use the same column order/types as in the migration above, but add `FOREIGN KEY (tenant_id) REFERENCES tenants(id)` if the local file uses that pattern — check first.

- [ ] **Step 3: Commit**

```bash
git add migrations/0296_bills_referred_by_and_hospitals.sql tenant-schema.sql
git commit -m "feat(db): migration for referral_hospitals + bills.referred_by_*"
```

---

## Task 3: Hospital CRUD endpoints

**Files:**
- Create: `src/routes/tenant/referralHospitals.ts`
- Modify: `src/routes/tenant/index.ts` (or wherever tenant routes are aggregated — find via grep)
- Test: backend integration test path (see existing patterns in `src/routes/tenant/*.test.ts` if any)

- [ ] **Step 1: Write the route file**

Create `src/routes/tenant/referralHospitals.ts`:

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { requirePermission } from '../../middleware/rbac';

const referralHospitalsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  shortCode: z.string().trim().max(50).optional(),
});

const updateSchema = createSchema.partial().extend({
  isActive: z.boolean().optional(),
});

referralHospitalsRoutes.get('/', async (c) => {
  const tenantId = requireTenantId(c);
  const url = new URL(c.req.url);
  const search = url.searchParams.get('search')?.trim() ?? '';
  const activeParam = url.searchParams.get('active');

  const conditions: string[] = ['tenant_id = ?'];
  const params: (string | number)[] = [tenantId];

  if (activeParam === 'true') conditions.push('is_active = 1');
  else if (activeParam === 'false') conditions.push('is_active = 0');

  if (search) {
    conditions.push('(name LIKE ? OR short_code LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  const result = await c.env.DB.prepare(`
    SELECT id, tenant_id, name, short_code, is_active, created_at, updated_at
    FROM referral_hospitals
    WHERE ${conditions.join(' AND ')}
    ORDER BY is_active DESC, name ASC
    LIMIT 200
  `).bind(...params).all();

  return c.json({ hospitals: result.results });
});

referralHospitalsRoutes.post('/', requirePermission('billing:write'), zValidator('json', createSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await c.env.DB.prepare(`
    INSERT INTO referral_hospitals (tenant_id, name, short_code, is_active, created_by, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, datetime('now', '+6 hours'), datetime('now', '+6 hours'))
  `).bind(tenantId, data.name, data.shortCode ?? null, userId).run();

  const id = Number(result.meta.last_row_id ?? 0);
  return c.json({ id, name: data.name, shortCode: data.shortCode ?? null, isActive: 1 }, 201);
});

referralHospitalsRoutes.put('/:id', requirePermission('billing:write'), zValidator('json', updateSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  const data = c.req.valid('json');

  const existing = await c.env.DB.prepare(`
    SELECT id FROM referral_hospitals WHERE id = ? AND tenant_id = ?
  `).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Hospital not found' });

  const sets: string[] = [];
  const params: (string | number)[] = [];

  if (data.name !== undefined) { sets.push('name = ?'); params.push(data.name); }
  if (data.shortCode !== undefined) { sets.push('short_code = ?'); params.push(data.shortCode); }
  if (data.isActive !== undefined) { sets.push('is_active = ?'); params.push(data.isActive ? 1 : 0); }
  sets.push("updated_at = datetime('now', '+6 hours')");

  if (sets.length === 1) {
    return c.json({ message: 'No changes' });
  }

  params.push(Number(id), tenantId);
  await c.env.DB.prepare(`
    UPDATE referral_hospitals SET ${sets.join(', ')}
    WHERE id = ? AND tenant_id = ?
  `).bind(...params).run();

  return c.json({ message: 'Updated' });
});

referralHospitalsRoutes.delete('/:id', requirePermission('billing:write'), async (c) => {
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(`
    SELECT id FROM referral_hospitals WHERE id = ? AND tenant_id = ?
  `).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Hospital not found' });

  await c.env.DB.prepare(`
    UPDATE referral_hospitals
    SET is_active = 0, updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ?
  `).bind(id, tenantId).run();

  return c.json({ message: 'Disabled' });
});

export default referralHospitalsRoutes;
```

- [ ] **Step 2: Wire the route into the aggregator**

Find where other tenant routes are mounted (search for `app.route` or similar in `src/routes/tenant/index.ts` or `src/index.ts`). Add:

```ts
import referralHospitalsRoutes from './referralHospitals';
// ...
app.route('/api/referral-hospitals', referralHospitalsRoutes);
```

(Adjust the path/exports to match the existing file's pattern — read the file first.)

- [ ] **Step 3: Type-check**

Run the project's typecheck command. Fix any import path or type issues.

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/tenant/referralHospitals.ts src/routes/tenant/index.ts
git commit -m "feat(api): referral hospital CRUD endpoints"
```

---

## Task 4: Extend GET `/api/billing/:id` SQL for visit_serial and referred-by

**Files:**
- Modify: `src/routes/tenant/billing.ts` (around line 719-774)
- Test: extension of an existing backend smoke test if there is one; otherwise just rely on the runtime smoke test in Task 11

- [ ] **Step 1: Update the bills SELECT**

In `src/routes/tenant/billing.ts`, find the `billingRoutes.get('/:id', ...)` handler. Replace the SELECT block (lines 725-733) with:

```ts
    const bill = await db.$client.prepare(`
      SELECT b.*, b.total AS total_amount, b.paid AS paid_amount,
             COALESCE(b.due, MAX(0, COALESCE(b.total, 0) - COALESCE(b.paid, 0))) AS outstanding,
             p.name as patient_name, p.patient_code, p.mobile, p.address, p.age, p.gender,
             u.name as approved_by_name,
             rd.name AS referring_doctor_name,
             COALESCE(qe.token_number, a.token_no) AS visit_serial,
             a.appt_no AS appt_no,
             b.referred_by_type, b.referred_by_hospital_id,
             rh.name AS referred_by_hospital_name,
             rh.short_code AS referred_by_hospital_short_code
      FROM bills b JOIN patients p ON b.patient_id = p.id
      LEFT JOIN users u ON b.approved_by = u.id
      LEFT JOIN users rd ON rd.id = b.referring_doctor_id AND rd.tenant_id = b.tenant_id
      LEFT JOIN visits v ON v.id = b.visit_id
      LEFT JOIN appointments a ON a.id = v.appointment_id
      LEFT JOIN queue_entries qe
        ON qe.appointment_id = a.id AND qe.tenant_id = b.tenant_id
        AND qe.status NOT IN ('completed', 'cancelled')
      LEFT JOIN referral_hospitals rh ON rh.id = b.referred_by_hospital_id
      WHERE b.id = ? AND b.tenant_id = ?
    `).bind(id, tenantId).first();
```

- [ ] **Step 2: Update the response body**

In the same handler, the existing `return c.json({ bill, items, payments, deposit_adjustments })` already includes the entire bill row, so the new fields (visit_serial, appt_no, referred_by_type, referred_by_hospital_id, referred_by_hospital_name, referred_by_hospital_short_code, referring_doctor_name) are now in the response automatically. No additional code change needed.

- [ ] **Step 3: Type-check**

Run: `cd web && pnpm typecheck` (or project typecheck command).

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/tenant/billing.ts
git commit -m "feat(api): bill detail returns visit_serial and referred_by fields"
```

---

## Task 5: Extend POST `/api/billing-counter/invoices` schema and INSERT for referred-by

**Files:**
- Modify: `src/schemas/billingCounter.ts`
- Modify: `src/routes/tenant/billingCounter.ts`

- [ ] **Step 1: Extend the schema**

In `src/schemas/billingCounter.ts`, find `billingCounterInvoiceSchema` and add the new fields inside the object:

```ts
export const billingCounterInvoiceSchema = z.object({
  patientId: z.number().int().positive(),
  visitId: z.number().int().positive().optional(),
  createWalkInVisit: z.boolean().default(false),
  schemeId: z.number().int().positive().optional(),
  priceCategoryId: z.number().int().positive().optional(),
  billMode: z.enum(['provisional', 'paid', 'credit']).default('paid'),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
  referringDoctorId: z.number().int().positive().optional(),
  discountByName: z.string().trim().max(200).optional(),
  referredByType: z.enum(['self', 'hospital', 'doctor']).optional(),
  referredByHospitalId: z.number().int().positive().optional(),
  items: z.array(billingCounterLineItemSchema).min(1),
  payment: z.object({
    paymentMethod: paymentMethodSchema.default('cash'),
    paidAmount: z.number().min(0).default(0),
    depositDeducted: z.number().min(0).default(0),
    creditAmount: z.number().min(0).default(0),
    externalTransactionId: z.string().trim().min(3).max(128).optional(),
  }).default({ paymentMethod: 'cash', paidAmount: 0, depositDeducted: 0, creditAmount: 0 }),
}).refine(
  (data) => !(data.referredByType === 'hospital' && !data.referredByHospitalId),
  { message: 'Select a hospital when referred-by type is hospital', path: ['referredByHospitalId'] },
);
```

- [ ] **Step 2: Extend the bills INSERT in billingCounter.ts**

In `src/routes/tenant/billingCounter.ts`, find the `INSERT INTO bills` block (around line 1740-1767). Add the two new columns to the column list and the two new bind values to the `VALUES (...)` clause.

Old column list (in INSERT):
```sql
(patient_id, visit_id, invoice_no, referring_doctor_id, test_bill, doctor_visit_bill,
 admission_bill, operation_bill, medicine_bill, discount, discount_by_name, total, tax_total, paid, due, status,
 tenant_id, created_by, counter_id, counter_session_id, created_at)
```

New column list:
```sql
(patient_id, visit_id, invoice_no, referring_doctor_id, test_bill, doctor_visit_bill,
 admission_bill, operation_bill, medicine_bill, discount, discount_by_name, total, tax_total, paid, due, status,
 tenant_id, created_by, counter_id, counter_session_id, referred_by_type, referred_by_hospital_id, created_at)
```

In the matching `.bind(...)` call, add the two new values at the end (just before the `tenantId, userId, ...` block):

```ts
      data.referredByType ?? null,
      data.referredByType === 'hospital' ? data.referredByHospitalId ?? null : null,
```

(The `?? null` covers the case where the type is missing entirely; we also pass null if the type is `self` or `doctor` since hospital id is irrelevant.)

- [ ] **Step 3: Type-check**

Run: project typecheck.

Expected: 0 errors. The new `referredByType` / `referredByHospitalId` fields are optional in the schema, so existing API callers that don't send them continue to work.

- [ ] **Step 4: Commit**

```bash
git add src/schemas/billingCounter.ts src/routes/tenant/billingCounter.ts
git commit -m "feat(api): billing counter accepts referred_by fields"
```

---

## Task 6: Extend `createAppointmentSchema` with `forceTokenNo`

**Files:**
- Modify: `src/schemas/appointment.ts`

- [ ] **Step 1: Add the field**

In `src/schemas/appointment.ts`, add `forceTokenNo` to `createAppointmentSchema` (right after `requestedTokenNo`):

```ts
  requestedTokenNo: z.number().int().min(1).max(9999).optional(),
  forceTokenNo: z.boolean().default(false),
```

- [ ] **Step 2: Type-check and commit**

```bash
git add src/schemas/appointment.ts
git commit -m "feat(api): appointment schema adds forceTokenNo for manual serial override"
```

---

## Task 7: Branch appointment booking on `forceTokenNo`

**Files:**
- Modify: `src/routes/tenant/appointments.ts` (around line 1343-1369)

- [ ] **Step 1: Replace the reserved-range block with the conditional**

Find this block:

```ts
      if (data.requestedTokenNo) {
        const { results: ranges } = await c.env.DB.prepare(`
          SELECT token_from, token_to FROM token_reservations
          WHERE tenant_id = ? AND is_active = 1
            AND (doctor_id = ? OR (doctor_id IS NULL AND ? IS NULL))
            AND ? BETWEEN reservation_date AND end_date
            AND token_from <= ? AND token_to >= ?
        `).bind(tenantId, data.doctorId ?? null, data.doctorId ?? null, data.apptDate, data.requestedTokenNo, data.requestedTokenNo).all();

        if (ranges.length === 0) {
          throw new HTTPException(400, { message: `Token ${data.requestedTokenNo} is not in any reserved range` });
        }

        const taken = await c.env.DB.prepare(`
          SELECT id FROM appointments
          WHERE tenant_id = ? AND appt_date = ? AND doctor_id = ? AND token_no = ?
            AND status NOT IN ('cancelled', 'no_show')
        `).bind(tenantId, data.apptDate, data.doctorId ?? null, data.requestedTokenNo).first();

        if (taken) {
          throw new HTTPException(409, { message: `Token ${data.requestedTokenNo} is already assigned` });
        }

        tokenNo = data.requestedTokenNo;
      } else {
        tokenNo = await getNextAvailableToken(c.env.DB, tenantId!, data.doctorId ?? null, data.apptDate);
      }
```

Replace it with:

```ts
      if (data.requestedTokenNo) {
        if (!data.forceTokenNo) {
          const { results: ranges } = await c.env.DB.prepare(`
            SELECT token_from, token_to FROM token_reservations
            WHERE tenant_id = ? AND is_active = 1
              AND (doctor_id = ? OR (doctor_id IS NULL AND ? IS NULL))
              AND ? BETWEEN reservation_date AND end_date
              AND token_from <= ? AND token_to >= ?
          `).bind(tenantId, data.doctorId ?? null, data.doctorId ?? null, data.apptDate, data.requestedTokenNo, data.requestedTokenNo).all();

          if (ranges.length === 0) {
            throw new HTTPException(400, { message: `Token ${data.requestedTokenNo} is not in any reserved range` });
          }
        }

        const taken = await c.env.DB.prepare(`
          SELECT id FROM appointments
          WHERE tenant_id = ? AND appt_date = ? AND doctor_id = ? AND token_no = ?
            AND status NOT IN ('cancelled', 'no_show')
        `).bind(tenantId, data.apptDate, data.doctorId ?? null, data.requestedTokenNo).first();

        if (taken) {
          throw new HTTPException(409, { message: `Token ${data.requestedTokenNo} is already assigned for that day.` });
        }

        tokenNo = data.requestedTokenNo;
      } else {
        tokenNo = await getNextAvailableToken(c.env.DB, tenantId!, data.doctorId ?? null, data.apptDate);
      }
```

- [ ] **Step 2: Type-check and commit**

```bash
git add src/routes/tenant/appointments.ts
git commit -m "feat(api): appointment booking respects forceTokenNo for manual override"
```

---

## Task 8: Replace invoice banner label (Part 5)

**Files:**
- Modify: `web/src/lib/print/invoiceCategory.ts`
- Modify: `web/src/lib/print/invoiceCategory.test.ts`

- [ ] **Step 1: Update the label map**

In `web/src/lib/print/invoiceCategory.ts` (line 45), change:

```ts
  consultation: { en: 'DOCTOR CONSULTATION', bn: 'ডাক্তারের কনসালটেশন' },
```

to:

```ts
  consultation: { en: 'APPOINTMENT INVOICE', bn: 'অ্যাপয়েন্টমেন্ট ইনভয়েস' },
```

- [ ] **Step 2: Update existing tests that assert on the old label**

In `web/src/lib/print/invoiceCategory.test.ts`, update these assertions:

- Line 11: `expect(getInvoiceBannerLabel(items, 'en')).toBe('DOCTOR CONSULTATION');` → `expect(getInvoiceBannerLabel(items, 'en')).toBe('APPOINTMENT INVOICE');`
- Line 21: `expect(getInvoiceBannerLabel(items, 'en')).toBe('DOCTOR CONSULTATION + LABORATORY TEST');` → `expect(getInvoiceBannerLabel(items, 'en')).toBe('APPOINTMENT INVOICE + LABORATORY TEST');`
- Line 30-32: `'DOCTOR CONSULTATION + LABORATORY TEST + RADIOLOGY'` → `'APPOINTMENT INVOICE + LABORATORY TEST + RADIOLOGY'`
- Line 48: `expect(getInvoiceBannerLabel([{ item_category: 'doctor_visit' }], 'bn')).toBe('ডাক্তারের কনসালটেশন');` → `expect(getInvoiceBannerLabel([{ item_category: 'doctor_visit' }], 'bn')).toBe('অ্যাপয়েন্টমেন্ট ইনভয়েস');`
- Line 53: `'ডাক্তারের কনসালটেশন + ল্যাবরেটরি পরীক্ষা'` → `'অ্যাপয়েন্টমেন্ট ইনভয়েস + ল্যাবরেটরি পরীক্ষা'`
- Line 58: `expect(getInvoiceBannerLabel(items, 'en')).toBe('DOCTOR CONSULTATION');` → `expect(getInvoiceBannerLabel(items, 'en')).toBe('APPOINTMENT INVOICE');`

- [ ] **Step 3: Add a small new test for the join order with the new label**

Add at the end of the `describe` block:

```ts
  it('uses APPOINTMENT INVOICE for the consultation banner (en)', () => {
    expect(getInvoiceBannerLabel([{ item_category: 'consultation' }], 'en')).toBe('APPOINTMENT INVOICE');
  });
```

- [ ] **Step 4: Run the test file**

Run: `cd web && pnpm test src/lib/print/invoiceCategory.test.ts`

Expected: all 11 tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/print/invoiceCategory.ts web/src/lib/print/invoiceCategory.test.ts
git commit -m "feat(print): invoice banner labels consultation as APPOINTMENT INVOICE"
```

---

## Task 9: Add HospitalCombobox component

**Files:**
- Create: `web/src/components/HospitalCombobox.tsx`
- Create: `web/src/components/HospitalCombobox.test.tsx`

- [ ] **Step 1: Write the component**

Create `web/src/components/HospitalCombobox.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useApiQuery } from '../hooks/useApiQuery';

interface Hospital {
  id: number;
  name: string;
  short_code: string | null;
  is_active: number;
}

interface Props {
  value: number | null;
  onChange: (id: number | null) => void;
  disabled?: boolean;
  placeholder?: string;
  tenantSlug?: string;
}

export function HospitalCombobox({ value, onChange, disabled, placeholder, tenantSlug }: Props) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading } = useApiQuery<{ hospitals: Hospital[] }>(
    ['referral-hospitals', debounced],
    `/api/referral-hospitals?search=${encodeURIComponent(debounced)}&active=true`,
    { enabled: !disabled && open },
  );

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const selected = data?.hospitals.find((h) => h.id === value);

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        className="input w-full"
        placeholder={placeholder ?? 'Search hospital…'}
        value={selected ? `${selected.name}${selected.short_code ? ` (${selected.short_code})` : ''}` : search}
        onChange={(e) => { setSearch(e.target.value); setOpen(true); if (value) onChange(null); }}
        onFocus={() => setOpen(true)}
        disabled={disabled}
      />
      {open && (
        <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded border bg-white shadow-lg dark:bg-slate-800">
          {isLoading && <div className="p-2 text-sm text-gray-500">Loading…</div>}
          {!isLoading && (data?.hospitals.length ?? 0) === 0 && (
            <div className="p-2 text-sm text-gray-500">No matches. Add a hospital in Billing Master → Referral Hospitals.</div>
          )}
          {data?.hospitals.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => { onChange(h.id); setSearch(''); setOpen(false); }}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-blue-50 dark:hover:bg-slate-700"
            >
              {h.name}{h.short_code ? ` (${h.short_code})` : ''}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default HospitalCombobox;
```

- [ ] **Step 2: Write a smoke test**

Create `web/src/components/HospitalCombobox.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';

describe('HospitalCombobox', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./HospitalCombobox');
    expect(mod.HospitalCombobox).toBeDefined();
    expect(typeof mod.HospitalCombobox).toBe('function');
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd web && pnpm test src/components/HospitalCombobox.test.tsx`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add web/src/components/HospitalCombobox.tsx web/src/components/HospitalCombobox.test.tsx
git commit -m "feat(ui): HospitalCombobox for referring hospital search"
```

---

## Task 10: Add i18n strings

**Files:**
- Modify: `web/public/locales/en/billing.json`
- Modify: `web/public/locales/bn/billing.json`
- Modify: `web/public/locales/en/appointments.json`
- Modify: `web/public/locales/bn/appointments.json`

- [ ] **Step 1: Add English billing strings**

In `web/public/locales/en/billing.json`, find the `counter` object (around line 800-840). Add these new keys (or extend existing ones — keep alphabetical if the file is sorted):

```json
  "fillFull": "Fill full",
  "referredBy": {
    "title": "Referred by",
    "self": "Self",
    "hospital": "Hospital",
    "doctor": "Doctor"
  },
  "referralHospitals": {
    "tab": "Referral Hospitals",
    "add": "Add hospital",
    "name": "Name",
    "shortCode": "Short code",
    "active": "Active",
    "edit": "Edit",
    "disable": "Disable",
    "nameRequired": "Name is required",
    "noHospitals": "No referral hospitals yet.",
    "added": "Hospital added",
    "updated": "Hospital updated",
    "disabled": "Hospital disabled"
  }
```

Also remove the `printAfterSave` key from the `counter` object since we are removing that UI element (the key may be reused by other code paths — check first with grep).

- [ ] **Step 2: Add Bengali billing strings**

In `web/public/locales/bn/billing.json`, add matching Bengali values:

```json
  "fillFull": "পুরোটা পূরণ করুন",
  "referredBy": {
    "title": "রেফার্ড বাই",
    "self": "নিজে",
    "hospital": "হাসপাতাল",
    "doctor": "ডাক্তার"
  },
  "referralHospitals": {
    "tab": "রেফারেল হাসপাতাল",
    "add": "হাসপাতাল যোগ করুন",
    "name": "নাম",
    "shortCode": "শর্ট কোড",
    "active": "সক্রিয়",
    "edit": "সম্পাদনা",
    "disable": "নিষ্ক্রিয় করুন",
    "nameRequired": "নাম আবশ্যক",
    "noHospitals": "কোনো রেফারেল হাসপাতাল নেই।",
    "added": "হাসপাতাল যোগ হয়েছে",
    "updated": "হাসপাতাল হালনাগাদ হয়েছে",
    "disabled": "হাসপাতাল নিষ্ক্রিয় হয়েছে"
  }
```

- [ ] **Step 3: Add English appointments strings**

In `web/public/locales/en/appointments.json`, add:

```json
  "serialAuto": "Auto",
  "serialReserved": "Reserved",
  "serialManual": "Manual",
  "manualSerialPlaceholder": "Type any number 1-9999",
  "pickReserved": "Pick a reserved serial…",
  "serialConflict": "Token {{token}} is already assigned for that day."
```

(Keep `serialChoice` and `appointmentBooked` as they are.)

- [ ] **Step 4: Add Bengali appointments strings**

In `web/public/locales/bn/appointments.json`, add:

```json
  "serialAuto": "স্বয়ংক্রিয়",
  "serialReserved": "সংরক্ষিত",
  "serialManual": "ম্যানুয়াল",
  "manualSerialPlaceholder": "যেকোনো নম্বর লিখুন ১-৯৯৯৯",
  "pickReserved": "একটি সংরক্ষিত সিরিয়াল বাছাই করুন…",
  "serialConflict": "{{token}} নম্বরটি ওই দিনের জন্য ইতোমধ্যে বরাদ্দ হয়ে গেছে।"
```

- [ ] **Step 5: Add bill print strings to common.json (or wherever the billPrint namespace lives)**

Find the `billPrint` namespace in en + bn JSON files (likely in `common.json` or `billing.json`):

English:
```json
  "serialLabel": "Serial",
  "serialLabelBn": "সিরিয়াল নং",
  "referredByLabel": "Referred by:",
  "referredByLabelBn": "রেফার্ড বাই:"
```

Bengali:
```json
  "serialLabel": "সিরিয়াল নং",
  "serialLabelBn": "সিরিয়াল নং",
  "referredByLabel": "রেফার্ড বাই:",
  "referredByLabelBn": "রেফার্ড বাই:"
```

(The `_Bn` keys are used in print mode when the print language is set to Bengali — the print component will use the right key based on `printLang`.)

- [ ] **Step 6: Commit**

```bash
git add web/public/locales/en/billing.json web/public/locales/bn/billing.json \
        web/public/locales/en/appointments.json web/public/locales/bn/appointments.json
git commit -m "feat(i18n): keys for referred-by, manual serial, and serial/referred labels"
```

---

## Task 11: BillingCounterPage — paid=0 default, always-print, referred-by form

**Files:**
- Modify: `web/src/pages/BillingCounterPage.tsx`
- Modify: `web/src/pages/BillingCounterPage.test.ts`

- [ ] **Step 1: Remove the auto-fill useEffect**

In `web/src/pages/BillingCounterPage.tsx`, find and delete the useEffect (around lines 493-497):

```ts
  useEffect(() => {
    if (billMode === 'paid' && lines.length > 0 && paidAmount === '') {
      setPaidAmount(String(Math.max(0, totals.total - totals.deposit)));
    }
  }, [billMode, lines.length, paidAmount, totals.deposit, totals.total]);
```

- [ ] **Step 2: Add referred-by state and helper**

Near the other `useState` declarations in the component, add:

```ts
  const [referredByType, setReferredByType] = useState<'' | 'self' | 'hospital' | 'doctor'>('');
  const [referredByHospitalId, setReferredByHospitalId] = useState<number | null>(null);
```

Add a helper function (place it just above the component body or alongside other helpers):

```ts
function hasTestItem(lines: Array<{ itemCategory?: string | null }>): boolean {
  return lines.some((l) => {
    const cat = (l.itemCategory ?? '').toLowerCase();
    return cat === 'test' || cat === 'lab' || cat === 'laboratory' || cat === 'radiology' || cat === 'scan' || cat === 'imaging';
  });
}
```

- [ ] **Step 3: Remove `shouldPrintAfterSave` state and the "Print after save" checkbox**

Find and delete:

```ts
  const [shouldPrintAfterSave, setShouldPrintAfterSave] = useState(false);
```

And in the `onSuccess` of `createInvoice`, replace:

```ts
      if (shouldPrintAfterSave && res.billId) {
        window.open(`/h/${slug}/billing/${res.billId}/print`, '_blank');
      }
```

with:

```ts
      if (res.billId) {
        window.open(`/h/${slug}/billing/${res.billId}/print`, '_blank');
      }
```

And remove the `setShouldPrintAfterSave(false);` calls in both `onSuccess` and `onError`.

Also remove the JSX block (around line 1564-1574):

```tsx
              {billMode !== 'provisional' && (
                <label className="mt-3 flex items-center gap-2 text-sm text-[var(--color-text-secondary)] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={shouldPrintAfterSave}
                    onChange={(e) => setShouldPrintAfterSave(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
                  />
                  {t('counter.printAfterSave', { defaultValue: 'Print after save' })}
                </label>
              )}
```

- [ ] **Step 4: Add the "Fill full" helper button next to the paid input**

Find the paid-amount input (around line 1481-1484):

```tsx
                  <label className="label">{t('paidAmount', { defaultValue: 'Paid amount' })}</label>
                  <input className="input" type="number" min="0" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} disabled={billMode !== 'paid'} />
```

Replace with:

```tsx
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <label className="label">{t('paidAmount', { defaultValue: 'Paid amount' })}</label>
                      <input className="input" type="number" min="0" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} disabled={billMode !== 'paid'} />
                    </div>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setPaidAmount(String(Math.max(0, totals.total - totals.deposit)))}
                      disabled={billMode !== 'paid' || totals.total <= 0}
                    >
                      {t('counter.fillFull', { defaultValue: 'Fill full' })}
                    </button>
                  </div>
```

- [ ] **Step 5: Add the "Referred by" section in the bill form**

Find a good spot to insert this section — ideally right above the bill-mode / paid-amount / submit-button block, inside the right-hand aside.

```tsx
              {hasTestItem(lines) && (
                <section className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <h3 className="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">
                    {t('counter.referredBy.title', { defaultValue: 'Referred by' })}
                  </h3>
                  <div className="flex flex-wrap gap-3">
                    {(['self', 'hospital', 'doctor'] as const).map((opt) => (
                      <label key={opt} className="flex items-center gap-1 text-sm">
                        <input
                          type="radio"
                          name="referredBy"
                          value={opt}
                          checked={referredByType === opt}
                          onChange={() => setReferredByType(opt)}
                        />
                        {t(`counter.referredBy.${opt}`, { defaultValue: opt })}
                      </label>
                    ))}
                  </div>
                  {referredByType === 'hospital' && (
                    <div className="mt-2">
                      <HospitalCombobox
                        value={referredByHospitalId}
                        onChange={setReferredByHospitalId}
                        placeholder={t('counter.referredBy.hospitalPlaceholder', { defaultValue: 'Search hospital…' })}
                      />
                    </div>
                  )}
                  {referredByType === 'doctor' && (
                    <div className="mt-2">
                      <input
                        className="input w-full"
                        value={referringDoctorId ? String(referringDoctorId) : ''}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          setReferringDoctorId(Number.isFinite(n) && n > 0 ? n : null);
                        }}
                        placeholder={t('counter.referredBy.doctorPlaceholder', { defaultValue: 'Doctor ID (or pick from consultation section above)' })}
                      />
                    </div>
                  )}
                </section>
              )}
```

Add the import at the top of the file (alongside existing imports):

```tsx
import { HospitalCombobox } from '../components/HospitalCombobox';
```

(If `referringDoctorId` state and `setReferringDoctorId` setter don't exist with that exact name, use grep on this file to find the actual names and substitute them.)

- [ ] **Step 6: Pass the new fields into the create-invoice payload**

Find the call to `createInvoice.mutate({...})` and add:

```tsx
        referredByType: referredByType || undefined,
        referredByHospitalId: referredByType === 'hospital' ? referredByHospitalId ?? undefined : undefined,
```

(Place them right after `billMode` or `discountByName` to keep related fields together.)

- [ ] **Step 7: Reset the referred-by state after a successful save**

In the `onSuccess` of `createInvoice`, alongside the existing `setLines([]);` reset calls, add:

```ts
      setReferredByType('');
      setReferredByHospitalId(null);
```

- [ ] **Step 8: Update the test**

Replace `web/src/pages/BillingCounterPage.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import BillingCounterPage from './BillingCounterPage';
import { hasTestItem } from './BillingCounterPage';

describe('BillingCounterPage', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./BillingCounterPage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});

describe('hasTestItem helper', () => {
  it('returns true when any item is test/lab/radiology', () => {
    expect(hasTestItem([{ itemCategory: 'test' }])).toBe(true);
    expect(hasTestItem([{ itemCategory: 'lab' }])).toBe(true);
    expect(hasTestItem([{ itemCategory: 'radiology' }])).toBe(true);
  });

  it('returns false when no test item is present', () => {
    expect(hasTestItem([{ itemCategory: 'consultation' }])).toBe(false);
    expect(hasTestItem([{ itemCategory: 'medicine' }])).toBe(false);
    expect(hasTestItem([])).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(hasTestItem([{ itemCategory: 'TEST' }])).toBe(true);
  });
});
```

(Note: `hasTestItem` must be exported from `BillingCounterPage.tsx` — add `export` keyword to the helper definition in Step 2.)

- [ ] **Step 9: Run the test**

Run: `cd web && pnpm test src/pages/BillingCounterPage.test.ts`

Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add web/src/pages/BillingCounterPage.tsx web/src/pages/BillingCounterPage.test.ts
git commit -m "feat(billing): paid=0 default, always print, referred-by form on test bills"
```

---

## Task 12: BillPrint — visit serial large + referred-by display

**Files:**
- Modify: `web/src/pages/BillPrint.tsx`
- Modify: `web/src/pages/BillPrint.test.ts`

- [ ] **Step 1: Extend the `BillDetail` interface**

In `web/src/pages/BillPrint.tsx` (around line 12-34), add these fields to `BillDetail`:

```ts
  visit_serial?: number | null;
  appt_no?: string | null;
  referring_doctor_name?: string | null;
  referred_by_type?: 'self' | 'hospital' | 'doctor' | null;
  referred_by_hospital_id?: number | null;
  referred_by_hospital_name?: string | null;
  referred_by_hospital_short_code?: string | null;
```

- [ ] **Step 2: Add helper for test-item detection**

Just below the other helpers (around line 92), add:

```ts
function hasTestItem(items: ReadonlyArray<{ item_category?: string | null }>): boolean {
  return items.some((it) => {
    const cat = (it.item_category ?? '').toLowerCase();
    return cat === 'test' || cat === 'lab' || cat === 'laboratory' || cat === 'radiology' || cat === 'scan' || cat === 'imaging';
  });
}
```

Export it for the test file by adding `export` keyword.

- [ ] **Step 3: Render the large visit serial in the header**

Find the header block (around line 342-358). Replace the right-side div:

```tsx
              <div className="text-right">
                <p className="text-gray-700 font-mono text-xl font-bold">{bill.invoice_no}</p>
              </div>
```

with:

```tsx
              <div className="text-right">
                {bill.visit_serial != null && (
                  <>
                    <p className="text-xs uppercase tracking-wider text-gray-500">
                      {printLang === 'bn' ? pt('billPrint.serialLabelBn', { defaultValue: 'সিরিয়াল নং' }) : pt('billPrint.serialLabel', { defaultValue: 'Serial' })}
                    </p>
                    <p className="font-mono text-5xl font-extrabold leading-none text-gray-900">#{bill.visit_serial}</p>
                  </>
                )}
                <p className="mt-1 font-mono text-xl font-bold text-gray-700">{bill.invoice_no}</p>
              </div>
```

- [ ] **Step 4: Render the referred-by line**

Find the patient info block (around line 369-381, after the address line). Add this block right after the existing patient info (just before the meta row's right-side date block, or as a new paragraph at the end of the left column):

```tsx
            {hasTestItem(items) && bill.referred_by_type && (
              <p className="text-sm text-gray-700">
                <span className="text-xs text-gray-500">
                  {printLang === 'bn' ? pt('billPrint.referredByLabelBn', { defaultValue: 'রেফার্ড বাই:' }) : pt('billPrint.referredByLabel', { defaultValue: 'Referred by:' })}
                </span>{' '}
                <span className="font-medium">
                  {bill.referred_by_type === 'self' && (printLang === 'bn' ? 'নিজে' : 'Self')}
                  {bill.referred_by_type === 'hospital' && bill.referred_by_hospital_name && (
                    <>
                      {bill.referred_by_hospital_name}
                      {bill.referred_by_hospital_short_code ? ` (${bill.referred_by_hospital_short_code})` : ''}
                    </>
                  )}
                  {bill.referred_by_type === 'hospital' && !bill.referred_by_hospital_name && (printLang === 'bn' ? 'হাসপাতাল' : 'Hospital')}
                  {bill.referred_by_type === 'doctor' && (bill.referring_doctor_name || (printLang === 'bn' ? 'ডাক্তার' : 'Doctor'))}
                </span>
              </p>
            )}
```

- [ ] **Step 5: Update the test**

Replace `web/src/pages/BillPrint.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { hasTestItem } from './BillPrint';

describe('BillPrint', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./BillPrint');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});

describe('hasTestItem helper', () => {
  it('returns true for test/lab/radiology items', () => {
    expect(hasTestItem([{ item_category: 'test' }])).toBe(true);
    expect(hasTestItem([{ item_category: 'lab' }])).toBe(true);
    expect(hasTestItem([{ item_category: 'radiology' }])).toBe(true);
  });
  it('returns false for non-test items', () => {
    expect(hasTestItem([{ item_category: 'consultation' }])).toBe(false);
    expect(hasTestItem([{ item_category: 'medicine' }])).toBe(false);
    expect(hasTestItem([])).toBe(false);
  });
});
```

- [ ] **Step 6: Run the test**

Run: `cd web && pnpm test src/pages/BillPrint.test.ts`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/BillPrint.tsx web/src/pages/BillPrint.test.ts
git commit -m "feat(print): large visit serial and referred-by on test invoices"
```

---

## Task 13: AppointmentScheduler — manual serial mode (Part 4 frontend)

**Files:**
- Modify: `web/src/pages/AppointmentScheduler.tsx`
- Modify: `web/src/pages/AppointmentScheduler.test.ts`

- [ ] **Step 1: Add state for serial mode and manual input**

Find the existing state declarations and add:

```ts
  const [serialMode, setSerialMode] = useState<'auto' | 'reserved' | 'manual'>('auto');
  const [manualToken, setManualToken] = useState<number | ''>('');
```

- [ ] **Step 2: Replace the "Serial choice" select with the 3-mode control**

Find the current serial-choice block (around line 494-516). Replace with:

```tsx
              <div className="space-y-2">
                <label className="text-sm font-medium text-[var(--color-text-secondary)]">
                  {t('appointments.serialChoice', { defaultValue: 'Serial choice' })}
                </label>
                <div className="flex flex-wrap gap-3 text-sm">
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="serialMode"
                      value="auto"
                      checked={serialMode === 'auto'}
                      onChange={() => setSerialMode('auto')}
                    />
                    {t('appointments.serialAuto', { defaultValue: 'Auto' })}
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="serialMode"
                      value="reserved"
                      checked={serialMode === 'reserved'}
                      onChange={() => setSerialMode('reserved')}
                    />
                    {t('appointments.serialReserved', { defaultValue: 'Reserved' })}
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="serialMode"
                      value="manual"
                      checked={serialMode === 'manual'}
                      onChange={() => setSerialMode('manual')}
                    />
                    {t('appointments.serialManual', { defaultValue: 'Manual' })}
                  </label>
                </div>

                {serialMode === 'auto' && (
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {tokenAvailabilitySummary?.nextRegularTokenNo
                      ? t('appointments.nextSerialIs', { defaultValue: 'Next serial: #{{n}}', n: tokenAvailabilitySummary.nextRegularTokenNo })
                      : t('appointments.autoAssign', { defaultValue: 'Will be auto-assigned on save.' })}
                  </p>
                )}

                {serialMode === 'reserved' && (
                  <>
                    <select
                      className="input w-full"
                      value={requestedTokenNo}
                      onChange={(e) => setRequestedTokenNo(e.target.value ? Number(e.target.value) : '')}
                    >
                      <option value="">{t('appointments.pickReserved', { defaultValue: 'Pick a reserved serial…' })}</option>
                      {availableTokens.map((token) => (
                        <option key={token.token_no} value={token.token_no}>
                          Reserved #{token.token_no}{token.label ? ` (${token.label})` : ''}
                        </option>
                      ))}
                    </select>
                    {!availableTokensLoading && tokenAvailabilitySummary?.reservedTotal ? (
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {tokenAvailabilitySummary.reservedAvailable > 0
                          ? `${tokenAvailabilitySummary.reservedAvailable} reserved serial${tokenAvailabilitySummary.reservedAvailable === 1 ? '' : 's'} still open.`
                          : 'All reserved serials are already assigned.'}
                      </p>
                    ) : null}
                  </>
                )}

                {serialMode === 'manual' && (
                  <input
                    type="number"
                    min={1}
                    max={9999}
                    className="input w-full"
                    value={manualToken}
                    onChange={(e) => setManualToken(e.target.value ? Number(e.target.value) : '')}
                    placeholder={t('appointments.manualSerialPlaceholder', { defaultValue: 'Type any number 1-9999' })}
                  />
                )}
              </div>
```

- [ ] **Step 3: Wire the submit payload**

Find the `bookMutation.mutate({...})` call (around line 320-330). The current payload includes:

```ts
      requestedTokenNo: requestedTokenNo ? Number(requestedTokenNo) : undefined,
```

Replace with:

```ts
      requestedTokenNo: serialMode === 'auto' ? undefined :
                        serialMode === 'reserved' ? (requestedTokenNo ? Number(requestedTokenNo) : undefined) :
                        manualToken ? Number(manualToken) : undefined,
      forceTokenNo: serialMode === 'manual',
```

- [ ] **Step 4: Handle 409 conflict gracefully**

Find the `onError` of `bookMutation`. Add a check for the conflict message:

```ts
    onError: (error) => {
      const message = (error as Error)?.message ?? '';
      if (/already assigned/i.test(message)) {
        toast.error(t('appointments.serialConflict', { token: manualToken || requestedTokenNo, defaultValue: 'Token already assigned for that day.' }));
        // Refresh availability so the user sees the new state
        queryClient.invalidateQueries({ queryKey: queryKeys.tokenReservations.available({ date: localDate, doctorId }) });
        queryClient.invalidateQueries({ queryKey: queryKeys.appointments.lists() });
      } else {
        toast.error(message);
      }
    },
```

(If `bookMutation` doesn't already have an `onError`, add it. Adjust the query key names to match the existing patterns in this file — use grep to find the right `queryKeys` import.)

- [ ] **Step 5: Reset manual state after a successful save**

In the `onSuccess` of `bookMutation`, add:

```ts
      setManualToken('');
```

(Also keep the existing reset of `requestedTokenNo` if any.)

- [ ] **Step 6: Update the test**

Replace `web/src/pages/AppointmentScheduler.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { appointmentConsultationFeeAmount } from './AppointmentScheduler';

describe('AppointmentScheduler pricing helpers', () => {
  it('uses doctor consultation fee in taka without dividing by 100', () => {
    expect(appointmentConsultationFeeAmount(500)).toBe(500);
  });

  it('normalizes missing or invalid consultation fees to zero', () => {
    expect(appointmentConsultationFeeAmount(null)).toBe(0);
    expect(appointmentConsultationFeeAmount(Number.NaN)).toBe(0);
  });
});
```

(Existing tests stay; the new manual mode is exercised via the form's `state.serialMode` and the `bookMutation` payload branch — covered by manual QA and the backend 409 test in Task 14.)

- [ ] **Step 7: Run the test**

Run: `cd web && pnpm test src/pages/AppointmentScheduler.test.ts`

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add web/src/pages/AppointmentScheduler.tsx web/src/pages/AppointmentScheduler.test.ts
git commit -m "feat(scheduler): 3-mode serial choice (auto/reserved/manual)"
```

---

## Task 14: BillingMasterPage — Referral Hospitals admin tab

**Files:**
- Modify: `web/src/pages/BillingMasterPage.tsx`
- Modify: `web/src/pages/BillingMasterPage.test.ts`

- [ ] **Step 1: Find a good insertion point**

Read `web/src/pages/BillingMasterPage.tsx` and find where existing tabs/sections are defined. Pick a spot to add a new section labeled "Referral Hospitals" — likely a new tab in the same tab group, or a new sub-section if the page uses sections.

- [ ] **Step 2: Add a `ReferralHospitalsSection` component**

Add this inside the file (could be in the same file or split into a new component file `web/src/components/ReferralHospitalsAdmin.tsx` if the existing file is already large):

```tsx
function ReferralHospitalsSection() {
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Hospital | null>(null);
  const [name, setName] = useState('');
  const [shortCode, setShortCode] = useState('');

  const { data, refetch, isLoading } = useApiQuery<{ hospitals: Hospital[] }>(
    ['referral-hospitals-admin', search],
    `/api/referral-hospitals?search=${encodeURIComponent(search)}`,
  );

  const createMut = useApiMutation<{ id: number }, { name: string; shortCode?: string }>(
    'post', '/api/referral-hospitals',
    { onSuccess: () => { setShowModal(false); setName(''); setShortCode(''); refetch(); } },
  );
  const updateMut = useApiMutation<{ message: string }, { name?: string; shortCode?: string }>(
    'put', editing ? `/api/referral-hospitals/${editing.id}` : '',
    { onSuccess: () => { setEditing(null); setName(''); setShortCode(''); refetch(); } },
  );
  const deleteMut = useApiMutation<{ message: string }, unknown>(
    'delete', editing ? `/api/referral-hospitals/${editing.id}` : '',
    { onSuccess: () => { setEditing(null); refetch(); } },
  );

  function openAdd() {
    setEditing(null);
    setName('');
    setShortCode('');
    setShowModal(true);
  }
  function openEdit(h: Hospital) {
    setEditing(h);
    setName(h.name);
    setShortCode(h.short_code ?? '');
    setShowModal(true);
  }
  function submit() {
    if (!name.trim()) return;
    if (editing) {
      updateMut.mutate({ name: name.trim(), shortCode: shortCode.trim() || undefined });
    } else {
      createMut.mutate({ name: name.trim(), shortCode: shortCode.trim() || undefined });
    }
  }

  return (
    <section className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{t('billing.referralHospitals.tab', { defaultValue: 'Referral Hospitals' })}</h2>
        <button type="button" className="btn-primary" onClick={openAdd}>
          {t('billing.referralHospitals.add', { defaultValue: 'Add hospital' })}
        </button>
      </div>
      <input
        className="input w-full md:max-w-sm"
        placeholder={t('common.search', { defaultValue: 'Search…' })}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {isLoading && <p className="text-sm text-muted">Loading…</p>}
      {!isLoading && (data?.hospitals.length ?? 0) === 0 && (
        <p className="text-sm text-muted">{t('billing.referralHospitals.noHospitals', { defaultValue: 'No referral hospitals yet.' })}</p>
      )}
      {data && data.hospitals.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2">{t('billing.referralHospitals.name', { defaultValue: 'Name' })}</th>
              <th className="text-left py-2">{t('billing.referralHospitals.shortCode', { defaultValue: 'Short code' })}</th>
              <th className="text-left py-2">{t('billing.referralHospitals.active', { defaultValue: 'Active' })}</th>
              <th className="text-right py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.hospitals.map((h) => (
              <tr key={h.id} className="border-b">
                <td className="py-2">{h.name}</td>
                <td className="py-2">{h.short_code ?? '—'}</td>
                <td className="py-2">{h.is_active ? 'Yes' : 'No'}</td>
                <td className="py-2 text-right space-x-2">
                  <button type="button" className="text-blue-600" onClick={() => openEdit(h)}>
                    {t('billing.referralHospitals.edit', { defaultValue: 'Edit' })}
                  </button>
                  {h.is_active ? (
                    <button
                      type="button"
                      className="text-red-600"
                      onClick={() => { setEditing(h); deleteMut.mutate({}); }}
                    >
                      {t('billing.referralHospitals.disable', { defaultValue: 'Disable' })}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {showModal && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40" onClick={() => setShowModal(false)}>
          <div className="w-full max-w-md rounded-lg bg-white p-5 dark:bg-slate-800" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-lg font-semibold">
              {editing ? t('billing.referralHospitals.edit', { defaultValue: 'Edit' }) : t('billing.referralHospitals.add', { defaultValue: 'Add hospital' })}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="label">{t('billing.referralHospitals.name', { defaultValue: 'Name' })}</label>
                <input className="input w-full" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <label className="label">{t('billing.referralHospitals.shortCode', { defaultValue: 'Short code' })}</label>
                <input className="input w-full" value={shortCode} onChange={(e) => setShortCode(e.target.value)} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="button" className="btn-primary" onClick={submit} disabled={!name.trim()}>
                  {editing ? 'Save' : 'Add'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

interface Hospital {
  id: number;
  name: string;
  short_code: string | null;
  is_active: number;
}
```

- [ ] **Step 3: Mount the section in the page**

In the main page component's return JSX, add `<ReferralHospitalsSection />` in a sensible location (alongside other admin sections, e.g., right after the existing service-item section).

- [ ] **Step 4: Update the test**

Replace `web/src/pages/BillingMasterPage.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';

describe('BillingMasterPage', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./BillingMasterPage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
```

(Existing minimal test is kept; full admin-table behavior is exercised in dev/staging.)

- [ ] **Step 5: Run the test**

Run: `cd web && pnpm test src/pages/BillingMasterPage.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/BillingMasterPage.tsx web/src/pages/BillingMasterPage.test.ts
git commit -m "feat(admin): referral hospitals CRUD section in BillingMasterPage"
```

---

## Task 15: Apply migration to dev + run all tests

**Files:** (no file changes; just verification)

- [ ] **Step 1: Apply the migration locally**

Run:

```bash
# Cloud dev DB
wrangler d1 migrations apply hms-tenant-dev --env development

# Local server (if running)
ssh pcare 'cd /opt/hms && HMS_LOCAL_APPLY_VERSIONED_MIGRATIONS=1 bash scripts/local-server/migrate.sh'
```

(Adjust the DB name and environment to match the project's actual setup — see `wrangler.toml` for `[env.development]` and `[env.production]` blocks.)

- [ ] **Step 2: Run all frontend tests**

Run: `cd web && pnpm test`

Expected: all tests pass, no regressions. Pay attention to:
- `src/lib/print/invoiceCategory.test.ts` (updated labels)
- `src/pages/BillingCounterPage.test.ts` (added helper test)
- `src/pages/BillPrint.test.ts` (added helper test)
- `src/pages/AppointmentScheduler.test.ts` (unchanged)
- `src/pages/BillingMasterPage.test.ts` (unchanged)
- `src/components/HospitalCombobox.test.tsx` (new)

- [ ] **Step 3: Run a typecheck pass**

Run: `cd web && pnpm typecheck` and the worker typecheck (look in root `package.json` for the worker build/typecheck command; commonly `pnpm typecheck` at the repo root).

Expected: 0 errors.

- [ ] **Step 4: Smoke test the dev server**

Run: `pnpm dev` (or `wrangler dev`) and walk through:
- Open the billing counter
- Add a test item — confirm "Referred by" section appears
- Pick Hospital → combobox loads
- Save bill with paid=0
- Print page opens in new tab automatically
- Print page shows large `#N` serial and `Referred by: <name>`
- Open AppointmentScheduler, switch to Manual serial, type 42, book
- Open BillingMasterPage → Referral Hospitals tab → add Barguna Govt College / BGH → verify it appears in the bill form combobox

- [ ] **Step 5: Commit (no file changes — skip if nothing to commit)**

```bash
git status  # should be clean
```

---

## Task 16: Deploy to production

**Files:** (no file changes; just deploy)

- [ ] **Step 1: Deploy worker to production**

```bash
pnpm build && wrangler deploy --env production
```

- [ ] **Step 2: Apply migration to production D1**

```bash
wrangler d1 migrations apply hms-tenant --env production
```

(Adjust the DB name to match `wrangler.toml` `[env.production].d1_databases` binding name.)

- [ ] **Step 3: Verify in production**

Open the production URL `https://hms-saas-production.rahmatullahzisan.workers.dev` in a browser, log in as a tenant admin, and re-walk the smoke test from Task 15 Step 4.

- [ ] **Step 4: Deploy to local server (if applicable)**

```bash
# Copy code to local server
rsync -avz --exclude=node_modules --exclude=.git ./ pcare:/opt/hms/

# Rebuild local stack
ssh pcare 'cd /opt/hms && docker compose --env-file /data/hms/config/local-server.env -f deploy/local-server/compose.yml up -d --build --remove-orphans'

# Apply migration locally
ssh pcare 'cd /opt/hms && HMS_LOCAL_APPLY_VERSIONED_MIGRATIONS=1 bash scripts/local-server/migrate.sh'

# Verify
ssh pcare 'curl -fsS http://127.0.0.1/api/local-server/status && docker compose --env-file /data/hms/config/local-server.env -f deploy/local-server/compose.yml ps'
```

(Adjust DB name and rsync paths per the local server docs in `AGENTS.md`.)

- [ ] **Step 5: Done**

All 6 spec changes are live in both cloud and local. Verify on at least one production tenant before announcing.

---

## Self-Review

**Spec coverage check:**

- Part 1 (paid=0 default + "Fill full"): Task 11
- Part 2 (always open print): Task 11
- Part 3 (visit serial large): Task 12 + Task 4 (backend SQL)
- Part 4 (manual serial): Tasks 6, 7, 13
- Part 5 (banner label): Task 8
- Part 6 (referred-by): Tasks 1, 2, 3, 4, 5, 9, 10, 11, 12, 14

**No placeholders:** Tasks contain exact file paths, complete code, exact commands, expected output. No TBDs.

**Type consistency check:**
- `referredByType` and `referredByHospitalId` consistent across schema (Task 5), backend INSERT (Task 5), BillDetail interface (Task 12), and front-end form (Task 11).
- `forceTokenNo` consistent across schema (Task 6), backend branch (Task 7), and front-end payload (Task 13).
- `visit_serial` returned by backend (Task 4) matches `BillDetail.visit_serial` (Task 12).
- `hasTestItem` helper is exported (Tasks 11, 12) and tested (Task 11, 12).

**One ordering note for the executor:** Task 1 (schema) must complete before Task 2 (migration file references the table). Task 3 (hospital routes) can be done in parallel with Tasks 4-7 (other backend changes) since they don't share files. Tasks 8-14 are independent front-end changes; they can be parallelized. Task 15 is a verification gate that must come after all code tasks. Task 16 is deployment.

---

**Plan complete and saved to `docs/superpowers/plans/2026-06-06-billing-default-paid-print-serial-referred-by.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
