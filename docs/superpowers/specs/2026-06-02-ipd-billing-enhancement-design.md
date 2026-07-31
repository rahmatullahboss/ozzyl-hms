# IPD Billing Enhancement — Design Spec

**Date:** 2026-06-02
**Status:** Pending Approval
**Goal:** Add advance deposit to F3 admission modal + comprehensive provisional billing categories to F4 modal

---

## Problem Statement

### F3 Modal (IPD Admission)
The right column only has "Admission Fee" and "Billing Package". There is no way to collect an advance deposit at admission time, and no visibility into existing deposit balance.

### F4 Modal (Provisional Billing)
Only bed charges (auto) and catalog service items (manual) are supported. Real hospitals need many more charge categories for admitted patients:
- OT/Operation charges
- Nursing charges
- Medicine/Pharmacy
- Consumable supplies
- Ambulance/Transport
- Blood bank products
- Doctor consultation fees
- General service charges (ECG, injection, dressing, nebulization, etc.)

---

## Design Decisions

### 1. F3 Modal — Advance Deposit

**Add to right column (after Admission Fee):**
- **Advance Deposit amount** input (৳)
- **Payment Method** dropdown (Cash, bKash, Nagad, Card, Bank)
- **Existing Deposit Balance** display (if patient has prior deposits)

On submit: admission is created + deposit is recorded in `billing_deposits` table.

### 2. F4 Modal — Comprehensive Billing Categories

**Use existing `billing_service_departments` + `billing_service_items` master tables.**

New service departments to seed:

| Department Name | Code | Description |
|----------------|------|-------------|
| Bed/Room Charges | BED | Auto-calculated bed charges |
| Investigation/Lab | LAB | Lab tests, diagnostics |
| OT/Operation | OT | Surgery, procedures |
| Nursing Charges | NURS | Nursing services |
| Medicine/Pharmacy | PHRM | Drugs, medicines |
| Consumables | CONS | Surgical supplies, disposables |
| Ambulance | AMBU | Transport services |
| Blood Bank | BLOODB | Blood products |
| Doctor Consultation | CONSULT | Doctor visit/round fees |
| General Service | SERV | ECG, injection, dressing, nebulization etc. |

**All charges are manually added** by operator. No auto-generation from clinical orders.

**Category UI:** Single searchable dropdown (not tabs). User selects category → item dropdown populates → quantity + price → Add Charge.

---

## Component Changes

### F3 Modal — `ReceptionDashboard.tsx`

**Current right column (lines 4225-4232):**
```
┌─────────────────────────────┐
│ Admission Fee               │
│ [____0__] ৳                 │
│ One-time registration fee   │
└─────────────────────────────┘
```

**New right column:**
```
┌─────────────────────────────┐
│ Admission Fee               │
│ [____0__] ৳                 │
│                             │
│ Advance Deposit             │
│ [____0__] ৳                 │
│ [Cash ▼] Payment method     │
│                             │
│ ℹ️ Existing Deposit: ৳5,000 │
│   (if patient has deposits) │
│                             │
│ Billing Package (optional)  │
│ [No package ▼]              │
└─────────────────────────────┘
```

**State additions:**
- `advanceDeposit: string` — amount input
- `advancePaymentMethod: string` — payment method dropdown

**Existing Deposit Balance display:**
- Query: `SELECT SUM(CASE WHEN transaction_type = 'deposit' THEN amount ELSE 0 END) - SUM(CASE WHEN transaction_type IN ('refund', 'adjustment') THEN amount ELSE 0 END) as balance FROM billing_deposits WHERE patient_id = ? AND tenant_id = ? AND is_active = 1`
- Only shown if balance > 0
- Read-only display, not editable

**On submit logic:**
1. Create admission (existing)
2. If `advanceDeposit > 0`: POST `/api/deposits` with `patient_id`, `amount`, `payment_method`, `transaction_type: 'deposit'`

### F4 Modal — `ProvisionalBillingModal.tsx`

**Current Quick Add section (lines 490-526):**
```
[Category ▼] [Item Search] [Qty] [Add Charge]
```

**Enhanced Quick Add section:**
```
[🔍 Category dropdown with search ▼] [🔍 Item dropdown with search ▼] [Qty] [Price] [Add Charge]
```

**Changes:**
1. Category dropdown: fetches from `/api/billing-master/service-departments` — shows all departments including new ones
2. Item dropdown: fetches from `/api/billing-master/service-items?department_id=X` — filtered by selected department
3. Price: auto-filled from catalog, editable
4. Category badge colors in ledger table:
   - Bed: blue
   - Lab: purple
   - OT: red
   - Nursing: green
   - Medicine: orange
   - Consumable: yellow
   - Ambulance: cyan
   - Blood Bank: pink
   - Consultation: indigo
   - Service: gray

---

## Backend Changes

### 1. Seed Migration — New Service Departments + Sample Items

**New migration file:** `migrations/XXXX_ipd_billing_categories.sql`

```sql
-- New service departments
INSERT OR IGNORE INTO billing_service_departments (tenant_id, department_name, department_code, is_active)
VALUES
  (0, 'OT/Operation', 'OT', 1),
  (0, 'Nursing Charges', 'NURS', 1),
  (0, 'Medicine/Pharmacy', 'PHRM', 1),
  (0, 'Consumables', 'CONS', 1),
  (0, 'Ambulance', 'AMBU', 1),
  (0, 'Blood Bank', 'BLOODB', 1),
  (0, 'Doctor Consultation', 'CONSULT', 1),
  (0, 'General Service', 'SERV', 1);

-- Sample service items for each department
-- OT/Operation
INSERT OR IGNORE INTO billing_service_items (tenant_id, item_name, item_code, service_department_id, price, is_active)
SELECT 0, 'Major Surgery', 'OT001', id, 15000, 1 FROM billing_service_departments WHERE department_code = 'OT' AND tenant_id = 0;
-- ... more items per department
```

### 2. Admission Endpoint — Accept Advance Deposit

**File:** `src/routes/tenant/admissions.ts` (POST `/`)

**Schema change:** `src/schemas/admission.ts`
```typescript
// Add to createAdmissionSchema:
advance_deposit: z.number().min(0).default(0),
advance_payment_method: z.enum(['cash', 'bkash', 'nagad', 'card', 'bank']).optional(),
```

**Logic change:** After admission insert, if `advance_deposit > 0`:
```typescript
// Insert deposit into billing_deposits
await db.$client.prepare(`
  INSERT INTO billing_deposits (tenant_id, patient_id, deposit_receipt_no, amount, transaction_type, payment_method, remarks, counter_id, is_active, created_at, created_by)
  VALUES (?, ?, ?, ?, 'deposit', ?, 'Advance deposit at admission', ?, 1, datetime('now', '+6 hours'), ?)
`).bind(tenantId, data.patient_id, receiptNo, advanceDeposit, paymentMethod, counterId, userId).run();
```

### 3. Deposit Balance Endpoint for F3

**Already exists:** `GET /api/deposits?patient_id=X` returns deposit history.
**Need:** A lightweight endpoint or query to get current deposit balance for a patient.

**Option:** Add query param to existing deposits endpoint or use the balance from `billing_deposits` aggregation.

---

## Files to Modify

| File | Change |
|------|--------|
| `web/src/pages/ReceptionDashboard.tsx` | Add advance deposit fields to F3 right column, submit deposit on admission |
| `web/src/components/reception/ProvisionalBillingModal.tsx` | Enhance category dropdown with search, add category badge colors |
| `src/schemas/admission.ts` | Add `advance_deposit`, `advance_payment_method` to createAdmissionSchema |
| `src/routes/tenant/admissions.ts` | Handle deposit creation in POST `/` endpoint |
| `migrations/XXXX_ipd_billing_categories.sql` | New migration: seed service departments + sample items |

---

## Non-Goals

- No auto-charge from clinical orders (lab, pharmacy) — all manual
- No changes to bed charge auto-calculation
- No changes to discharge flow
- No changes to existing billing master data UI
- No changes to OPD billing

---

## Success Criteria

1. F3 modal shows advance deposit input + payment method + existing balance
2. Submitting admission with deposit creates a `billing_deposits` entry
3. F4 modal category dropdown shows all 10+ departments with search
4. Items from any category can be added to provisional billing
5. Ledger table shows color-coded category badges
6. All new categories have sample items seeded via migration
