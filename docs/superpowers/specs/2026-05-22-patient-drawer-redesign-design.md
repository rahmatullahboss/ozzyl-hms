# Patient Context Sidebar Redesign

**Date:** 2026-05-22
**Approach:** Incremental Enhancement (Approach A)
**Component:** `ReceptionPatientDrawer.tsx`
**Backend:** `reception.ts` (`/api/reception/patients/:id/context`)

---

## Problem

The patient context sidebar (drawer) currently mixes OPD and IPD billing data without clear separation. The "OPD Visits" tab shows only visit history with no billing information. The "Total Ledger" tab shows payments but not invoices with status. This causes confusion for receptionists who need to quickly distinguish between outpatient bills and inpatient charges.

## Goal

Redesign the drawer into 4 clear tabs with OPD/IPD separation, visual status badges, and smart defaults based on patient admission status. A receptionist should be able to open the drawer and immediately understand the patient's complete billing picture without confusion.

---

## Design

### 1. Tab Structure

**Current tabs:**
- `Profile & Timeline` (default) — billing timeline + mixed outstanding dues
- `OPD Visits` — visit history only, no bills
- `IPD Admissions` — active admission + IPD billing controls
- `Total Ledger` — payment history + deposit ledger

**New tabs:**
- `Overview` (default for discharged patients) — billing timeline + outstanding dues with OPD/IPD badges
- `OPD History` — visit list with per-visit bill details + action buttons
- `IPD & Admissions` (default for admitted patients) — current admission card + past admissions list
- `Total Financials` — all invoices (OPD + IPD + Pharmacy) with type/status badges + collect/print actions

**Type change:**
```typescript
// Before
type DrawerTab = 'profile' | 'opd' | 'ipd' | 'ledger' | 'overview' | 'timeline' | 'payments';
// After
type DrawerTab = 'overview' | 'opd' | 'ipd' | 'financials';
```

### 2. Sticky Header

Current header shows only "Patient context" title. New header:

- **Avatar:** Colored circle with patient name's first letter
- **Identity:** Bold patient name, `patient_code`, mobile number
- **Demographics:** `age · gender` (blood group if available)
- **Live Status Badge:** If `activeAdmission` exists, show blue badge: "Active Inpatient: {ward}-{bed}"
- **Quick Actions:** Keep existing "Add bill" and "Deposit" buttons in place

### 3. Tab Content

#### Tab 1: Overview (Default for discharged patients)

Content from current `profile` tab, enhanced:

- **Outstanding Dues section:** Each bill gets an OPD/IPD color-coded badge
  - IPD running bill at top if exists
  - OPD due bills below
- **Billing Timeline:** Unchanged from current implementation

#### Tab 2: OPD History

Enhanced from current `opd` tab:

- Visit list with dates, doctor name, specialty
- **Per-visit bill details:** Each visit shows its related bills with:
  - Invoice number, amount
  - Status badge: `Paid` (green), `Due` (red), `Partial` (yellow)
- **Action buttons per visit:**
  - `[View Prescription]` — navigate to `${basePath}/patients/${patientId}` (PatientDetail page, prescriptions tab)
  - `[Lab Reports]` — navigate to `${basePath}/patients/${patientId}` (PatientDetail page, tests tab)

#### Tab 3: IPD & Admissions

Enhanced from current `ipd` tab:

- **Current Admission card** (if admitted):
  - Admission number, bed, doctor, admission date
  - Finance summary: Total Deposit, Current Cost, Current Due
  - `[Manage Provisional Bill]` button
- **Past Admissions list** (NEW):
  - Past discharged admissions with date range, bed, doctor, status

#### Tab 4: Total Financials

Restructured from current `ledger` tab:

- **All invoices list** (OPD + IPD + Pharmacy combined):
  - Invoice number, date, type badge (`OPD` blue / `IPD` orange / `Pharmacy` purple)
  - Bills without `visit_id` or `admission_id` get type badge based on bill amount fields (`test_bill`, `doctor_visit_bill`, etc.)
  - Status badge: `Paid` (green), `Due` (red), `Running` (yellow)
  - `[Collect]` button for due bills, `[Receipt]` button for paid bills
- **Deposit Ledger section** (existing, unchanged)

### 4. Smart Default Tab

```typescript
const defaultTab: DrawerTab = data?.activeAdmission ? 'ipd' : 'overview';
```

When patient is admitted, drawer opens to IPD tab. When discharged/no admission, opens to Overview.

### 5. Backend API Changes

**File:** `src/routes/tenant/reception.ts` — `GET /api/reception/patients/:id/context`

| Change | Description |
|---|---|
| Past admissions query | New query: `SELECT ... FROM admissions WHERE patient_id = ? AND status = 'discharged' ORDER BY admission_date DESC LIMIT 5` |
| Bill type classification | Add `bill_type` field to each bill. Derivation logic: (1) If bill has a related `admission_id` via `billing_provisional_items`, classify as `'ipd'`. (2) If bill has a `visit_id` whose visit has `appointment_id IS NOT NULL` OR `visit_type = 'opd'`, classify as `'opd'`. (3) If bill has `test_bill > 0` and no visit, classify as `'pharmacy'`. (4) Default to `'opd'`. |
| Visit-level bills | New query: `SELECT b.*, v.id AS v_id FROM bills b LEFT JOIN visits v ON v.id = b.visit_id AND v.tenant_id = b.tenant_id WHERE b.patient_id = ? AND b.tenant_id = ? ORDER BY b.created_at DESC`. Frontend groups by `visit_id`. |

**New response fields:**
```typescript
type PatientContext = {
  // ... existing fields ...
  pastAdmissions?: Array<{
    id: number;
    admission_no?: string | null;
    admission_date?: string | null;
    discharge_date?: string | null;
    ward_name?: string | null;
    bed_number?: string | null;
    doctor_name?: string | null;
    status?: string | null;
  }>;
  visitBills?: Array<{
    visit_id: number;
    bills: Array<{
      id: number;
      invoice_no?: string | null;
      total_amount: number;
      paid_amount: number;
      due: number;
      status?: string | null;
      bill_type: 'opd' | 'ipd' | 'pharmacy';
    }>;
  }>;
};
```

---

## Files to Modify

### Frontend (Primary)
- `web/src/components/reception/ReceptionPatientDrawer.tsx` — Tab restructure, header enhancement, content updates

### Backend (Primary)
- `src/routes/tenant/reception.ts` — Past admissions query, bill type tagging, visit-level bills

### Frontend (Reference, no changes)
- `web/src/pages/PatientDetail.tsx` — Reference for billing patterns
- `web/src/pages/IPBillingPage.tsx` — Reference for IPD billing patterns

---

## Out of Scope

- Changes to `PatientDetail.tsx` (full page view)
- Changes to `BillingCounterPage.tsx` or `IPBillingPage.tsx`
- New database schema or migrations
- New API routes (all changes fit within existing endpoint)

---

## Success Criteria

1. Receptionist opens drawer for admitted patient → IPD tab opens by default with clear admission info
2. Receptionist opens drawer for discharged patient → Overview tab opens with outstanding dues clearly tagged OPD/IPD
3. OPD History tab shows visit + bill data together, no IPD data mixed in
4. IPD tab shows current + past admissions
5. Total Financials tab shows all invoices with type badges, collect/print actions
6. No existing billing/deposit/IPD action functionality is broken
