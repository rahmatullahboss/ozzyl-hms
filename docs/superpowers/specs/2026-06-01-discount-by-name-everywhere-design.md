# Discount By Name — Universal Authorization Field

## Problem

Currently, when a discount is given at the billing counter or direct billing, a `discount_by_name` field tracks who authorized it. However, discounts can also be given at:

- **Appointments** (appointment fee discount)
- **Reception Visit Services** (service/lab/procedure discount + bill generation)
- **Settlements** (settlement discount/write-off)

These locations lack the `discount_by_name` field, so there's no audit trail for who authorized the discount.

Previously a PIN system was considered for discounts above 20%, but that creates delays. Instead, we add a free-text `discount_by_name` field everywhere — the cashier types who authorized the discount (e.g., "MD", "Chairman", "Dr. Rahim"), and admins can review all discounts by person later.

## Scope

Add `discount_by_name` to 3 locations:

### 1. Appointments

**Database:**
- Add `discount_by_name TEXT` column to `appointments` table (migration)

**Schema (`src/schemas/appointment.ts`):**
- Add `discountByName: z.string().trim().max(200).optional()` to `createAppointmentSchema` (line 37)
- Add `discountByName: z.string().trim().max(200).optional()` to `updateAppointmentSchema` (line 55)

**Route (`src/routes/tenant/appointments.ts`):**
- Store `discountByName` in INSERT at create (around line 1095)
- Store `discountByName` in UPDATE at edit (around line 1526)
- Return `discountByName` in GET responses (around line 327, 356)

**Frontend (`web/src/pages/ReceptionDashboard.tsx`):**
- Add "Discount By" input field next to appointment discount field
- Send `discountByName` in API payload

### 2. Reception Visit Services + Bill Generation

**Schema (`src/routes/tenant/reception.ts`):**
- Add `discountByName: z.string().trim().max(200).optional()` to:
  - `addServiceSchema` (line 65)
  - `addBulkServicesSchema` (line 73)
  - `addLabServiceSchema` (line 80)
  - `addProcedureSchema` (line 87)
  - `generateBillSchema` (line 95)

**Route (`src/routes/tenant/reception.ts`):**
- Pass `discountByName` through to `visit_services` table (if storing there) OR
- When generating bill (`generateBillSchema`), set `discount_by_name` on the `bills` table insert

**Database:**
- `visit_services` table does NOT need `discount_by_name` (individual service discounts are aggregated into the bill)
- The `bills` table already has `discount_by_name` — just populate it from the `generateBillSchema`

**Frontend (`web/src/pages/ReceptionDashboard.tsx`):**
- Add "Discount By" input next to the final bill discount field
- Send `discountByName` in the generate-bill API payload

### 3. Settlements

**Database:**
- Add `discount_by_name TEXT` column to `billing_settlements` table (migration)

**Schema (`src/routes/tenant/settlements.ts`):**
- Add `discount_by_name: z.string().trim().max(200).optional()` to settlement creation schema (line 174)

**Route (`src/routes/tenant/settlements.ts`):**
- Store `discount_by_name` in INSERT (around line 250)
- Return `discount_by_name` in GET responses

**Frontend (`web/src/pages/PatientSettlementsPage.tsx`):**
- Add "Discount By" input next to settlement discount field
- Send `discount_by_name` in API payload

## Database Migration

Single migration file adding `discount_by_name` to:
- `appointments` table
- `billing_settlements` table

(`bills` and `bill_versions` already have the column from migration 0282.)

## Frontend Rendering

- BillPrint.tsx already renders `discount_by_name` — no changes needed
- HospitalAdminDashboard already shows `discountByName` — no changes needed
- Settlement print/receipt should show `discount_by_name` if present

## Not In Scope

- Pharmacy sales (user excluded)
- Pharmacy purchase orders (supplier-side)
- PIN system (replaced by name field)

## Verification

1. Create appointment with discount + discount_by_name → verify stored and returned
2. Reception: add services with discount, generate bill with discount_by_name → verify on bill
3. Create settlement with discount + discount_by_name → verify stored and returned
4. Print bill → verify discount_by_name appears
5. Admin dashboard → verify discount_by_name visible on all discount entries
