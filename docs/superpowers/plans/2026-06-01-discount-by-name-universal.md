# Discount By Name — Universal Authorization Field

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `discount_by_name` field to Appointments, Reception (visit bill generation), and Settlements so every discount across the system tracks who authorized it.

**Architecture:** Extend existing `discount_by_name` pattern (already on `bills` table) to `appointments` and `billing_settlements` tables via migration. Update backend schemas/routes to accept and store the field. Update frontend to show an input field next to every discount input.

**Tech Stack:** Hono (backend), Drizzle ORM, Zod schemas, React + TypeScript (frontend), Cloudflare D1 (SQLite)

---

## File Map

| Action | File | What changes |
|--------|------|-------------|
| Create | `migrations/0283_discount_by_name_universal.sql` | Add `discount_by_name` to `appointments` and `billing_settlements` |
| Modify | `src/db/schema/schema.ts` | Add `discountByName` column to appointments (~line 649) and billingSettlements (~line 2554) |
| Modify | `src/schemas/appointment.ts` | Add `discountByName` to create/update schemas |
| Modify | `src/routes/tenant/appointments.ts` | Store `discountByName` in INSERT (line 1311) and UPDATE (line 1534) |
| Modify | `src/routes/tenant/reception.ts` | Add `discountByName` to `generateBillSchema` (line 95) and store on bill insert (line 1397) |
| Modify | `src/routes/tenant/settlements.ts` | Add `discount_by_name` to settlement schema (line 174) and INSERT (line 268) |
| Modify | `web/src/pages/ReceptionDashboard.tsx` | Add "Discount By" input for appointment + bill generation |
| Modify | `web/src/pages/PatientSettlementsPage.tsx` | Add "Discount By" input for settlements |

---

### Task 1: Database Migration

**Files:**
- Create: `migrations/0283_discount_by_name_universal.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Add discount_by_name to appointments and billing_settlements
-- to track who authorized discounts at every discount point in the system.

ALTER TABLE appointments ADD COLUMN discount_by_name TEXT;
ALTER TABLE billing_settlements ADD COLUMN discount_by_name TEXT;
```

- [ ] **Step 2: Run migration**

```bash
npx wrangler d1 execute hms-saas-db --local --file=migrations/0283_discount_by_name_universal.sql
```

- [ ] **Step 3: Commit**

```bash
git add migrations/0283_discount_by_name_universal.sql
git commit -m "feat: add discount_by_name columns to appointments and billing_settlements"
```

---

### Task 2: Update Drizzle Schema

**Files:**
- Modify: `src/db/schema/schema.ts`

- [ ] **Step 1: Add discountByName to appointments table**

In `src/db/schema/schema.ts`, find the `appointments` table definition (around line 649, after `discountReason`), add:

```typescript
discountByName: text("discount_by_name"),
```

- [ ] **Step 2: Add discountByName to billingSettlements table**

Find the `billingSettlements` table definition (around line 2554, after `discountAmount`), add:

```typescript
discountByName: text("discount_by_name"),
```

- [ ] **Step 3: Generate Drizzle migration (optional, for type sync)**

```bash
npx drizzle-kit generate
```

- [ ] **Step 4: Commit**

```bash
git add src/db/schema/schema.ts
git commit -m "feat: add discountByName to appointments and billingSettlements schema"
```

---

### Task 3: Update Appointment Schema + Route

**Files:**
- Modify: `src/schemas/appointment.ts`
- Modify: `src/routes/tenant/appointments.ts`

- [ ] **Step 1: Add discountByName to createAppointmentSchema**

In `src/schemas/appointment.ts`, find `createAppointmentSchema` (line 30), add after `discountReason` (line 38):

```typescript
discountByName: z.string().trim().max(200).optional(),
```

- [ ] **Step 2: Add discountByName to updateAppointmentSchema**

In the same file, find `updateAppointmentSchema` (line 46), add after `discountReason` (line 56):

```typescript
discountByName: z.string().trim().max(200).optional(),
```

- [ ] **Step 3: Store discountByName in appointment CREATE**

In `src/routes/tenant/appointments.ts`, find the INSERT into appointments (around line 1311-1334). Add `discountByName` to the `.values()` object, after `discountReason` (line 1328):

```typescript
discountByName: data.discountByName ?? null,
```

- [ ] **Step 4: Store discountByName in appointment UPDATE**

In the same file, find the UPDATE logic (around line 1534). After `updateData.discountReason = ...`, add:

```typescript
updateData.discountByName = data.discountByName ?? (existing as any).discountByName ?? null;
```

- [ ] **Step 5: Return discountByName in GET responses**

Find `getAppointmentBillingRow` (around line 338-359). Add `a.discount_by_name` to the SELECT query. Then find where the response is mapped (around line 327) and include `discountByName` in the returned object.

Also find the list query that returns appointments (search for `discount_reason` in SELECT statements) and add `discount_by_name` there too.

- [ ] **Step 6: Commit**

```bash
git add src/schemas/appointment.ts src/routes/tenant/appointments.ts
git commit -m "feat: accept and store discountByName for appointments"
```

---

### Task 4: Update Reception Bill Generation

**Files:**
- Modify: `src/routes/tenant/reception.ts`

- [ ] **Step 1: Add discountByName to generateBillSchema**

In `src/routes/tenant/reception.ts`, find `generateBillSchema` (line 95-98). Add `discountByName`:

```typescript
const generateBillSchema = z.object({
  discount: z.number().min(0).default(0),
  discountByName: z.string().trim().max(200).optional(),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});
```

- [ ] **Step 2: Store discountByName on bill INSERT**

Find the bill INSERT in the generate-bill handler (around line 1397-1409). Add `discountByName` to the values:

```typescript
const [billResult] = await db.insert(bills).values({
  patientId: visit.patient_id,
  visitId,
  invoiceNo,
  ...categoryTotals,
  discount,
  discountByName: data.discountByName ?? null,
  total,
  paid: 0,
  due: total,
  status: 'open',
  tenantId,
  createdBy: Number(userId),
}).returning({ id: bills.id });
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/tenant/reception.ts
git commit -m "feat: accept and store discountByName for reception visit bill generation"
```

---

### Task 5: Update Settlement Schema + Route

**Files:**
- Modify: `src/routes/tenant/settlements.ts`

- [ ] **Step 1: Add discount_by_name to settlement creation schema**

In `src/routes/tenant/settlements.ts`, find the settlement creation schema (line 174-182). Add `discount_by_name`:

```typescript
settlements.post('/', requireRole(...SETTLEMENT_WRITE_ROLES), zValidator('json', z.object({
  patient_id: z.number().int().positive(),
  bill_ids: z.array(z.number().int().positive()).min(1),
  paid_amount: z.number().min(0).default(0),
  deposit_deducted: z.number().min(0).default(0),
  discount_amount: z.number().min(0).default(0),
  discount_by_name: z.string().trim().max(200).optional(),
  payment_mode: z.string().default('cash'),
  remarks: z.string().optional(),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
})), async (c) => {
```

- [ ] **Step 2: Store discount_by_name in settlement INSERT**

Find the settlement INSERT (around line 268-274). Add `discount_by_name` to the INSERT statement:

```typescript
const batchStmts: D1PreparedStatement[] = [
  db.$client.prepare(`
    INSERT INTO billing_settlements (tenant_id, patient_id, settlement_receipt_no, payable_amount, paid_amount,
      deposit_deducted, discount_amount, discount_by_name, payment_mode, remarks, created_by, counter_id, counter_session_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(tenantId, data.patient_id, receiptNo, totalDue, data.paid_amount,
    data.deposit_deducted, data.discount_amount, data.discount_by_name ?? null, data.payment_mode, data.remarks || null, userId,
    activeCounterSession.counter_id, activeCounterSession.id),
];
```

- [ ] **Step 3: Return discount_by_name in settlement GET responses**

Find the settlements GET endpoint (search for `SELECT` queries that return settlement data). Add `discount_by_name` to the SELECT columns.

- [ ] **Step 4: Commit**

```bash
git add src/routes/tenant/settlements.ts
git commit -m "feat: accept and store discount_by_name for settlements"
```

---

### Task 6: Frontend — Appointment Discount By Name

**Files:**
- Modify: `web/src/pages/ReceptionDashboard.tsx`

- [ ] **Step 1: Add state for appointment discountByName**

In `ReceptionDashboard.tsx`, find where `appointmentDiscountReason` state is defined. Add a new state:

```typescript
const [appointmentDiscountByName, setAppointmentDiscountByName] = useState('');
```

- [ ] **Step 2: Add "Discount By" input next to appointment discount**

Find the appointment discount input (around line 3377). After the discount reason section (around line 3398), add a "Discount By" input that's always visible when discount > 0:

```tsx
{Number(appointmentDiscount || 0) > 0 && (
  <div>
    <label className="label">Discount By (who authorized)</label>
    <input
      className="input"
      placeholder="e.g. MD, Chairman, Dr. Rahim"
      value={appointmentDiscountByName}
      onChange={(e) => setAppointmentDiscountByName(e.target.value)}
    />
  </div>
)}
```

- [ ] **Step 3: Send discountByName in appointment create API**

Find where the appointment create mutation is called (around line 3469). Add `discountByName` to the payload:

```typescript
discountByName: appointmentDiscountByName.trim() || undefined,
```

- [ ] **Step 4: Reset discountByName when appointment is submitted**

After successful appointment creation, reset `appointmentDiscountByName` to `''`.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/ReceptionDashboard.tsx
git commit -m "feat: add discount by name input for appointments in reception"
```

---

### Task 7: Frontend — Reception Bill Generation Discount By Name

**Files:**
- Modify: `web/src/pages/ReceptionDashboard.tsx`

- [ ] **Step 1: Add state for bill discountByName**

Find where `billDiscount` state is defined. Add:

```typescript
const [billDiscountByName, setBillDiscountByName] = useState('');
```

- [ ] **Step 2: Add "Discount By" input next to bill discount**

Find the bill discount input (around line 4060). After it, add:

```tsx
{billDiscount > 0 && (
  <div>
    <label className="label">Discount By (who authorized)</label>
    <input
      className="input"
      placeholder="e.g. MD, Chairman, Dr. Rahim"
      value={billDiscountByName}
      onChange={(e) => setBillDiscountByName(e.target.value)}
    />
  </div>
)}
```

- [ ] **Step 3: Send discountByName in generate bill API**

Find the generate bill mutation call (around line 4079-4081). Add `discountByName`:

```typescript
generateBillMutation.mutate({
  discount: billDiscount,
  discountByName: billDiscountByName.trim() || undefined,
  idempotencyKey: `reception-bill-${selectedVisit.id}-${crypto.randomUUID()}`,
});
```

- [ ] **Step 4: Reset billDiscountByName after success**

In the generateBillMutation `onSuccess` callback, reset `setBillDiscountByName('')`.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/ReceptionDashboard.tsx
git commit -m "feat: add discount by name input for bill generation in reception"
```

---

### Task 8: Frontend — Settlement Discount By Name

**Files:**
- Modify: `web/src/pages/PatientSettlementsPage.tsx`

- [ ] **Step 1: Add discount_by_name to settleForm state**

Find `settleForm` state (line 52-58). Add `discount_by_name`:

```typescript
const [settleForm, setSettleForm] = useState({
  deposit_deducted: '',
  discount_amount: '',
  discount_by_name: '',
  paid_amount: '',
  payment_mode: 'cash',
  remarks: '',
});
```

- [ ] **Step 2: Add "Discount By" input next to settlement discount**

Find the settlement discount input (around line 294-298). After it, add:

```tsx
<div className="col-span-2">
  <label className="label">Discount By (who authorized)</label>
  <input className="input" placeholder="e.g. MD, Chairman, Dr. Rahim"
    value={settleForm.discount_by_name}
    onChange={e => setSettleForm(f => ({ ...f, discount_by_name: e.target.value }))} />
</div>
```

- [ ] **Step 3: Send discount_by_name in settlement API**

Find the settlement API call (around line 119-128). Add `discount_by_name`:

```typescript
await api.post('/api/settlements', {
  patient_id: selectedBill.patient_id,
  bill_ids: settleInfo.pending_bills.map(b => b.id),
  paid_amount: paidAmount,
  deposit_deducted: depositDeducted,
  discount_amount: discountAmount,
  discount_by_name: settleForm.discount_by_name.trim() || undefined,
  payment_mode: settleForm.payment_mode,
  remarks: settleForm.remarks || undefined,
  idempotencyKey: `settlement-${crypto.randomUUID()}`,
});
```

- [ ] **Step 4: Reset discount_by_name on success**

After settlement success (around line 130), the form reset should include `discount_by_name: ''`.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/PatientSettlementsPage.tsx
git commit -m "feat: add discount by name input for settlements"
```

---

### Task 9: Verification

- [ ] **Step 1: Build check**

```bash
pnpm build
```

Expected: No TypeScript errors.

- [ ] **Step 2: Lint check**

```bash
pnpm lint
```

Expected: No lint errors.

- [ ] **Step 3: Manual verification checklist**

1. Create appointment with discount > 0 → verify `discount_by_name` field appears and is stored
2. Reception: add services with discount, generate bill → verify `discount_by_name` is on the bill
3. Create settlement with discount > 0 → verify `discount_by_name` is stored
4. Print bill → verify `discount_by_name` shows on printed invoice (already works via existing BillPrint.tsx)
5. Admin dashboard → verify `discount_by_name` visible on bills (already works via existing HospitalAdminDashboard.tsx)

- [ ] **Step 4: Final commit (if any fixes needed)**

```bash
git add -A && git commit -m "fix: verification fixes for discount_by_name universal"
```
