# Patient Context Sidebar Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the `ReceptionPatientDrawer` sidebar into 4 clear tabs (Overview, OPD History, IPD & Admissions, Total Financials) with OPD/IPD separation, visual status badges, and smart defaults.

**Architecture:** Incremental enhancement of existing drawer component. Backend changes add past admissions, bill type classification, and visit-level bills to the existing `/api/reception/patients/:id/context` endpoint. Frontend changes restructure tabs, enhance header, and update tab content.

**Tech Stack:** Hono (backend), React + Tailwind CSS (frontend), D1/SQLite (database), vitest (testing)

**Spec:** `docs/superpowers/specs/2026-05-22-patient-drawer-redesign-design.md`

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/routes/tenant/reception.ts` | Modify | Add past admissions query, bill type tagging, visit-level bills |
| `web/src/components/reception/ReceptionPatientDrawer.tsx` | Modify | Tab restructure, header enhancement, all 4 tab contents |
| `test/integration/routes/reception.test.ts` | Modify | Add tests for new context endpoint fields |

---

## Task 1: Backend — Past Admissions Query

**Files:**
- Modify: `src/routes/tenant/reception.ts:335-344`
- Test: `test/integration/routes/reception.test.ts`

- [ ] **Step 1: Add past admissions query to the context endpoint**

In `src/routes/tenant/reception.ts`, find the `Promise.all` block at line 296. Add a new query after the `admission` query (line 344):

```typescript
// Add to the Promise.all array (after admission query):
c.env.DB.prepare(`
  SELECT a.id, a.admission_no, a.status, a.admission_date, a.discharge_date,
         b.ward_name, b.bed_number, d.name AS doctor_name
  FROM admissions a
  LEFT JOIN beds b ON b.id = a.bed_id AND b.tenant_id = a.tenant_id
  LEFT JOIN doctors d ON d.id = a.doctor_id AND d.tenant_id = a.tenant_id
  WHERE a.tenant_id = ? AND a.patient_id = ? AND a.status = 'discharged'
  ORDER BY a.admission_date DESC
  LIMIT 5
`).bind(tenantId, patientId).all().catch(() => ({ results: [] })),
```

Destructure the result in the `Promise.all` at line 296. Add `pastAdmissions` to the destructuring:

```typescript
const [patient, visits, dueBills, bills, admission, deposits, labOrders, payments, depositLedger, totalPaidResult, pastAdmissions] = await Promise.all([...]);
```

Add to the response at line 471:

```typescript
return c.json({
  // ... existing fields ...
  pastAdmissions: pastAdmissions.results ?? [],
});
```

- [ ] **Step 2: Write test for past admissions**

In `test/integration/routes/reception.test.ts`, add a test:

```typescript
it('returns past discharged admissions in patient context', async () => {
  // Setup: patient with one discharged admission
  // Call GET /reception/patients/:id/context
  // Assert response.pastAdmissions contains the discharged admission
  // Assert response.pastAdmissions does not contain active admission
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run test/integration/routes/reception.test.ts`
Expected: All tests pass including the new one.

- [ ] **Step 4: Commit**

```bash
git add src/routes/tenant/reception.ts test/integration/routes/reception.test.ts
git commit -m "feat: add past admissions to patient context endpoint"
```

---

## Task 2: Backend — Bill Type Classification

**Files:**
- Modify: `src/routes/tenant/reception.ts:324-334, 390-401`

- [ ] **Step 1: Modify bills query to include visit and admission info**

In `src/routes/tenant/reception.ts`, find the `bills` query (line 324). Replace it with:

```typescript
c.env.DB.prepare(`
  SELECT b.id, b.invoice_no, b.visit_id,
         COALESCE(b.total, 0) AS total_amount,
         COALESCE(b.paid, 0) AS paid_amount,
         COALESCE(b.due, MAX(0, COALESCE(b.total, 0) - COALESCE(b.paid, 0))) AS due,
         b.status, b.created_at,
         COALESCE(b.test_bill, 0) AS test_bill,
         COALESCE(b.doctor_visit_bill, 0) AS doctor_visit_bill,
         COALESCE(b.operation_bill, 0) AS operation_bill,
         COALESCE(b.admission_bill, 0) AS admission_bill,
         COALESCE(b.medicine_bill, 0) AS medicine_bill,
         v.appointment_id AS visit_appointment_id
  FROM bills b
  LEFT JOIN visits v ON v.id = b.visit_id AND v.tenant_id = b.tenant_id
  WHERE b.tenant_id = ? AND b.patient_id = ?
  ORDER BY b.created_at DESC
  LIMIT 10
`).bind(tenantId, patientId).all(),
```

Apply the same change to the `dueBills` query (line 310):

```typescript
c.env.DB.prepare(`
  SELECT b.id, b.invoice_no, b.visit_id,
         COALESCE(b.total, 0) AS total_amount,
         COALESCE(b.paid, 0) AS paid_amount,
         COALESCE(b.due, MAX(0, COALESCE(b.total, 0) - COALESCE(b.paid, 0))) AS due,
         b.status, b.created_at,
         COALESCE(b.test_bill, 0) AS test_bill,
         COALESCE(b.doctor_visit_bill, 0) AS doctor_visit_bill,
         COALESCE(b.operation_bill, 0) AS operation_bill,
         COALESCE(b.admission_bill, 0) AS admission_bill,
         COALESCE(b.medicine_bill, 0) AS medicine_bill,
         v.appointment_id AS visit_appointment_id
  FROM bills b
  LEFT JOIN visits v ON v.id = b.visit_id AND v.tenant_id = b.tenant_id
  WHERE b.tenant_id = ?
    AND b.patient_id = ?
    AND COALESCE(b.status, 'open') NOT IN ('paid', 'cancelled', 'refunded')
    AND COALESCE(b.due, MAX(0, COALESCE(b.total, 0) - COALESCE(b.paid, 0))) > 0
  ORDER BY b.created_at DESC
  LIMIT 50
`).bind(tenantId, patientId).all(),
```

- [ ] **Step 2: Add bill_type derivation in normalization**

In the normalization functions (line 390), add `bill_type` to each bill:

```typescript
function deriveBillType(bill: Record<string, unknown>): 'opd' | 'ipd' | 'pharmacy' {
  // If bill has admission-related amounts, it's IPD
  if (Number(bill.admission_bill ?? 0) > 0) return 'ipd';
  // If visit has appointment_id, it's OPD (appointment-origin visit)
  if (bill.visit_appointment_id != null) return 'opd';
  // If bill has visit_id but no appointment, check visit_type via visit_id
  // For now, default to OPD if visit exists
  if (bill.visit_id != null) return 'opd';
  // If only test_bill or medicine_bill with no visit, it's pharmacy
  if (Number(bill.test_bill ?? 0) > 0 || Number(bill.medicine_bill ?? 0) > 0) return 'pharmacy';
  // Default to OPD
  return 'opd';
}
```

Update both `normalizedBills` and `normalizedDueBills` mappers to include `bill_type`:

```typescript
const normalizedBills = (bills.results ?? []).map((bill: Record<string, unknown>) => {
  const total = Number(bill.total_amount ?? 0);
  const paid = Number(bill.paid_amount ?? bill.paid ?? 0);
  const due = Number(bill.due ?? Math.max(0, total - paid));
  return { ...bill, paid_amount: paid, due: Math.max(0, due), bill_type: deriveBillType(bill) };
});
```

- [ ] **Step 3: Run existing tests to verify no regression**

Run: `npx vitest run test/integration/routes/reception.test.ts`
Expected: All existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/routes/tenant/reception.ts
git commit -m "feat: add bill_type classification to patient context bills"
```

---

## Task 3: Backend — Visit-Level Bills

**Files:**
- Modify: `src/routes/tenant/reception.ts`
- Test: `test/integration/routes/reception.test.ts`

- [ ] **Step 1: Add visitBills computation after the response data**

In `src/routes/tenant/reception.ts`, after the normalization block (around line 440), add:

```typescript
// Build visit-level bill mapping for OPD History tab
const allBillsWithVisits = [...normalizedBills, ...normalizedDueBills.filter((db) => !normalizedBills.some((b) => b.id === db.id))];
const visitBillsMap = new Map<number, typeof allBillsWithVisits>();
for (const bill of allBillsWithVisits) {
  const vid = Number(bill.visit_id ?? 0);
  if (vid > 0) {
    const existing = visitBillsMap.get(vid) ?? [];
    if (!existing.some((b) => b.id === bill.id)) {
      existing.push(bill);
      visitBillsMap.set(vid, existing);
    }
  }
}
const visitBills = Array.from(visitBillsMap.entries()).map(([visit_id, bills]) => ({ visit_id, bills }));
```

Add `visitBills` to the response:

```typescript
return c.json({
  // ... existing fields ...
  pastAdmissions: pastAdmissions.results ?? [],
  visitBills,
});
```

- [ ] **Step 2: Run existing tests**

Run: `npx vitest run test/integration/routes/reception.test.ts`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/routes/tenant/reception.ts
git commit -m "feat: add visit-level bill grouping to patient context"
```

---

## Task 4: Frontend — Tab Type and Structure Change

**Files:**
- Modify: `web/src/components/reception/ReceptionPatientDrawer.tsx:45, 136, 522-551`

- [ ] **Step 1: Update DrawerTab type**

In `ReceptionPatientDrawer.tsx`, replace line 45:

```typescript
// Before:
type DrawerTab = 'profile' | 'opd' | 'ipd' | 'ledger' | 'overview' | 'timeline' | 'payments';
// After:
type DrawerTab = 'overview' | 'opd' | 'ipd' | 'financials';
```

- [ ] **Step 2: Update default state**

Replace line 136:

```typescript
const [drawerTab, setDrawerTab] = useState<DrawerTab>('overview');
```

- [ ] **Step 3: Update all setDrawerTab references**

Search for all `setDrawerTab('profile')`, `setDrawerTab('ledger')`, `setDrawerTab('payments')`, `setDrawerTab('timeline')` and replace:
- `setDrawerTab('profile')` → `setDrawerTab('overview')`
- `setDrawerTab('ledger')` → `setDrawerTab('financials')`
- `setDrawerTab('payments')` → `setDrawerTab('financials')`
- `setDrawerTab('timeline')` → `setDrawerTab('overview')`

- [ ] **Step 4: Rename tab buttons**

Replace the tab buttons section (lines 522-551):

```tsx
{/* Drawer Tabs */}
<div className="flex border-b border-[var(--color-border)]">
  <button
    type="button"
    className={`flex-1 px-2 py-2 text-sm font-medium border-b-2 transition ${drawerTab === 'overview' ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
    onClick={() => setDrawerTab('overview')}
  >
    {t('tab.overview', { defaultValue: 'Overview' })}
  </button>
  <button
    type="button"
    className={`flex-1 px-2 py-2 text-sm font-medium border-b-2 transition ${drawerTab === 'opd' ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
    onClick={() => setDrawerTab('opd')}
  >
    {t('tab.opdHistory', { defaultValue: 'OPD History' })}
  </button>
  <button
    type="button"
    className={`flex-1 px-2 py-2 text-sm font-medium border-b-2 transition ${drawerTab === 'ipd' ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
    onClick={() => setDrawerTab('ipd')}
  >
    {t('tab.ipdAdmissions', { defaultValue: 'IPD & Admissions' })}
  </button>
  <button
    type="button"
    className={`flex-1 px-2 py-2 text-sm font-medium border-b-2 transition ${drawerTab === 'financials' ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
    onClick={() => setDrawerTab('financials')}
  >
    {t('tab.totalFinancials', { defaultValue: 'Total Financials' })}
  </button>
</div>
```

- [ ] **Step 5: Update all drawerTab conditionals**

Search for `drawerTab === 'profile'`, `drawerTab === 'timeline'`, `drawerTab === 'ledger'`, `drawerTab === 'payments'` and update:
- `drawerTab === 'profile' || drawerTab === 'timeline'` → `drawerTab === 'overview'`
- `drawerTab === 'profile' || drawerTab === 'overview'` → `drawerTab === 'overview'`
- `drawerTab === 'ledger' || drawerTab === 'payments'` → `drawerTab === 'financials'`

- [ ] **Step 6: Run build to verify no TypeScript errors**

Run: `cd web && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/reception/ReceptionPatientDrawer.tsx
git commit -m "refactor: rename drawer tabs to overview/opd/ipd/financials"
```

---

## Task 5: Frontend — Sticky Header Enhancement

**Files:**
- Modify: `web/src/components/reception/ReceptionPatientDrawer.tsx:455-494`

- [ ] **Step 1: Enhance the patient info section**

Replace the patient info section (lines 455-476) with enhanced header:

```tsx
<section className="card p-4">
  <div className="flex items-start justify-between gap-3">
    <div className="flex items-start gap-3">
      {/* Avatar */}
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-primary)]/10 text-lg font-bold text-[var(--color-primary)]">
        {patient.name?.charAt(0)?.toUpperCase() ?? '?'}
      </div>
      <div>
        <div className="text-xl font-semibold">{patient.name}</div>
        <div className="text-sm text-[var(--color-text-muted)]">
          {patient.patient_code ?? `Patient #${patient.id}`}
          {patient.mobile ? ` · ${patient.mobile}` : ''}
        </div>
        <div className="mt-1 text-xs text-[var(--color-text-muted)]">
          {patient.age ? `${patient.age} ${t('info.yrs', { defaultValue: 'yrs' })}` : ''}
          {patient.gender ? ` · ${patient.gender}` : ''}
        </div>
        {/* Live Status Badge */}
        {data?.activeAdmission ? (
          <div className="mt-2 inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
            🟢 {t('status.activeInpatient', { defaultValue: 'Active Inpatient' })}: {activeAdmissionLabel || t('info.activeAdmission', { defaultValue: 'Active admission' })}
          </div>
        ) : null}
      </div>
    </div>
    {/* Due badge */}
    <button
      type="button"
      className={`badge ${dueTotal > 10000 ? 'bg-red-100 text-red-800 hover:ring-2 hover:ring-red-300' : dueTotal > 0 ? 'badge-warning hover:ring-2 hover:ring-amber-300' : depositBalance > 0 ? 'bg-emerald-100 text-emerald-800' : 'badge-success'} transition`}
      onClick={() => dueTotal > 0 && setShowDueDetails((current) => !current)}
      disabled={dueTotal <= 0}
      title={dueTotal > 0 ? t('info.showDueInvoices', { defaultValue: 'Show due invoices' }) : depositBalance > 0 ? t('info.advanceBalance', { defaultValue: 'Advance balance' }) : t('info.noInvoiceDue', { defaultValue: 'No invoice due' })}
    >
      {dueTotal > 0 ? `${t('info.dueLabel', { defaultValue: 'বাকি আছে' })} ৳{money(dueTotal)}` : depositBalance !== 0 ? `${t('info.advanceLabel', { defaultValue: depositBalance > 0 ? 'অতিরিক্ত জমা' : 'বাকি আছে' })} ৳{money(Math.abs(depositBalance))}` : t('info.paidUp', { defaultValue: 'পরিশোধিত' })}
    </button>
  </div>
```

- [ ] **Step 2: Keep financial snapshot cards and action buttons unchanged**

Lines 478-518 remain as-is (financial snapshot + Add Bill / Deposit buttons).

- [ ] **Step 3: Verify visually**

Run the dev server and open the drawer for a patient. Verify:
- Avatar shows first letter of name
- Patient code and mobile visible
- Age and gender visible
- Active admission badge shows for admitted patients

- [ ] **Step 4: Commit**

```bash
git add web/src/components/reception/ReceptionPatientDrawer.tsx
git commit -m "feat: enhance patient drawer header with avatar and status badge"
```

---

## Task 6: Frontend — Overview Tab (Outstanding Dues with OPD/IPD Badges)

**Files:**
- Modify: `web/src/components/reception/ReceptionPatientDrawer.tsx` (Outstanding Dues section)

- [ ] **Step 1: Update the Outstanding Dues section to show OPD/IPD badges**

In the Outstanding Dues section (around line 744), update the due bill rendering to include type badges. Find the `dueBills.map` block and update:

```tsx
{dueBills.map((bill) => {
  const due = getBillDue(bill);
  const paid = Number(bill.paid_amount ?? bill.paid ?? 0);
  const billType = (bill as Record<string, unknown>).bill_type as string ?? 'opd';
  return (
    <div key={bill.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-white p-3 text-sm shadow-sm dark:border-amber-900 dark:bg-slate-900">
      <div>
        <div className="flex items-center gap-2">
          <span className={`badge text-xs ${billType === 'ipd' ? 'bg-orange-100 text-orange-700' : billType === 'pharmacy' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
            {billType === 'ipd' ? 'IPD' : billType === 'pharmacy' ? 'Pharmacy' : 'OPD'}
          </span>
          <span className="font-medium">{bill.invoice_no ?? `Bill #${bill.id}`}</span>
        </div>
        <div className="text-xs text-[var(--color-text-muted)]">
          {formatDate(bill.created_at) ?? t('info.dateNA', { defaultValue: 'Date N/A' })} - {bill.status ?? 'pending'} - Paid ৳{money(paid)} / Total ৳{money(bill.total_amount)}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <div className="text-xs text-[var(--color-text-muted)]">{t('info.due', { defaultValue: 'Due' })}</div>
          <div className="font-data font-semibold text-red-600">৳{money(due)}</div>
        </div>
        <button
          type="button"
          className="btn-primary px-3 py-2 text-xs"
          disabled={!activeSession}
          onClick={() => openDuePayment(bill)}
        >
          {t('btn.collect', { defaultValue: 'Collect' })}
        </button>
      </div>
    </div>
  );
})}
```

- [ ] **Step 2: Update IPD running bill badge**

The IPD running bill section (line 746) already has a label. Ensure it shows the `IPD` badge:

```tsx
<div className="flex items-center gap-2">
  <span className="badge text-xs bg-orange-100 text-orange-700">IPD</span>
  <span className="font-medium">{t('patientDrawer.ipdRunningBill', { defaultValue: 'IPD running bill' })}</span>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add web/src/components/reception/ReceptionPatientDrawer.tsx
git commit -m "feat: add OPD/IPD badges to outstanding dues in patient drawer"
```

---

## Task 7: Frontend — OPD History Tab (Visit + Bills)

**Files:**
- Modify: `web/src/components/reception/ReceptionPatientDrawer.tsx` (OPD Visits tab)

- [ ] **Step 1: Update the OPD tab to show per-visit bills**

Replace the OPD Visits tab content (lines 596-618). The new version groups bills by visit:

```tsx
{/* OPD History Tab */}
{drawerTab === 'opd' ? (
  <section className="card p-4">
    <h3 className="mb-3 font-semibold">{t('patientDrawer.opdHistory', { defaultValue: 'OPD Visit History' })}</h3>
    {(data?.visits ?? []).length === 0 ? (
      <div className="text-sm text-[var(--color-text-muted)] text-center py-4">{t('empty.noVisits', { defaultValue: 'No OPD visits found.' })}</div>
    ) : (
      <div className="space-y-3">
        {(data?.visits ?? []).map((visit) => {
          const visitBillList = (data?.visitBills ?? []).find((vb) => vb.visit_id === visit.id)?.bills ?? [];
          return (
            <div key={visit.id} className="rounded-lg border border-[var(--color-border)] p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">{visit.visit_no ?? `Visit #${visit.id}`}</div>
                  <div className="text-xs text-[var(--color-text-muted)]">
                    {visit.doctor_name ?? t('info.doctorNA', { defaultValue: 'Doctor N/A' })} · {visit.visit_type ?? t('info.opdVisit', { defaultValue: 'OPD visit' })}
                  </div>
                </div>
                <span className="text-xs text-[var(--color-text-muted)]">{formatDate(visit.visit_date) ?? t('info.dateNA', { defaultValue: 'Date N/A' })}</span>
              </div>
              {/* Visit Bills */}
              {visitBillList.length > 0 ? (
                <div className="mt-2 space-y-1 border-t border-[var(--color-border)] pt-2">
                  {visitBillList.map((bill) => (
                    <div key={bill.id} className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-[var(--color-text-muted)]">{bill.invoice_no ?? `Bill #${bill.id}`}</span>
                        <span className={`badge text-[10px] ${bill.due > 0 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          {bill.due > 0 ? `Due ৳${money(bill.due)}` : 'Paid'}
                        </span>
                      </div>
                      <span className="font-data">৳{money(bill.total_amount)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {/* Action Buttons */}
              <div className="mt-2 flex gap-2">
                <a
                  href={`${basePath}/patients/${patient?.id}`}
                  className="btn-ghost px-2 py-1 text-xs"
                >
                  {t('btn.viewPrescription', { defaultValue: 'View Prescription' })}
                </a>
                <a
                  href={`${basePath}/patients/${patient?.id}`}
                  className="btn-ghost px-2 py-1 text-xs"
                >
                  {t('btn.labReports', { defaultValue: 'Lab Reports' })}
                </a>
              </div>
            </div>
          );
        })}
      </div>
    )}
  </section>
) : null}
```

- [ ] **Step 2: Update PatientContext type to include visitBills**

At the top of the file, add `visitBills` to the `PatientContext` type (around line 39):

```typescript
visitBills?: Array<{
  visit_id: number;
  bills: Array<{
    id: number;
    invoice_no?: string | null;
    total_amount: number;
    paid_amount: number;
    due: number;
    status?: string | null;
    bill_type: string;
  }>;
}>;
```

- [ ] **Step 3: Commit**

```bash
git add web/src/components/reception/ReceptionPatientDrawer.tsx
git commit -m "feat: show per-visit bills in OPD History tab"
```

---

## Task 8: Frontend — IPD & Admissions Tab (Current + Past)

**Files:**
- Modify: `web/src/components/reception/ReceptionPatientDrawer.tsx` (IPD Admissions tab)

- [ ] **Step 1: Add pastAdmissions to PatientContext type**

Add to the `PatientContext` type:

```typescript
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
```

- [ ] **Step 2: Add past admissions list below current admission**

In the IPD tab content (lines 666-721), add after the current admission card (after line 715):

```tsx
{/* Past Admissions */}
<div className="mt-4">
  <h4 className="mb-2 text-sm font-semibold text-[var(--color-text-muted)]">{t('patientDrawer.pastAdmissions', { defaultValue: 'Past Admissions' })}</h4>
  {(data?.pastAdmissions ?? []).length === 0 ? (
    <div className="text-xs text-[var(--color-text-muted)] text-center py-2">{t('empty.noPastAdmissions', { defaultValue: 'No past admissions.' })}</div>
  ) : (
    <div className="space-y-2">
      {(data?.pastAdmissions ?? []).map((adm) => (
        <div key={adm.id} className="rounded-lg border border-[var(--color-border)] p-3 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-medium">{adm.admission_no ?? `Admission #${adm.id}`}</div>
              <div className="text-xs text-[var(--color-text-muted)]">
                {adm.ward_name && adm.bed_number ? `${adm.ward_name}-${adm.bed_number}` : t('info.bedNA', { defaultValue: 'Bed N/A' })}
                {adm.doctor_name ? ` · ${adm.doctor_name}` : ''}
              </div>
            </div>
            <span className="badge text-xs">{t('status.discharged', { defaultValue: 'Discharged' })}</span>
          </div>
          <div className="text-xs text-[var(--color-text-muted)] mt-1">
            {formatDate(adm.admission_date)}{adm.discharge_date ? ` — ${formatDate(adm.discharge_date)}` : ''}
          </div>
        </div>
      ))}
    </div>
  )}
</div>
```

- [ ] **Step 3: Commit**

```bash
git add web/src/components/reception/ReceptionPatientDrawer.tsx
git commit -m "feat: add past admissions list to IPD tab in patient drawer"
```

---

## Task 9: Frontend — Total Financials Tab (All Invoices)

**Files:**
- Modify: `web/src/components/reception/ReceptionPatientDrawer.tsx` (Total Ledger tab)

- [ ] **Step 1: Replace the ledger/payments tab with Total Financials**

Replace the `drawerTab === 'ledger' || drawerTab === 'payments'` block (lines 622-663):

```tsx
{/* Total Financials Tab */}
{drawerTab === 'financials' ? (
  <section className="card p-4">
    <h3 className="mb-3 font-semibold">{t('patientDrawer.allInvoices', { defaultValue: 'All Invoices' })}</h3>
    {(data?.bills ?? []).length === 0 ? (
      <div className="text-sm text-[var(--color-text-muted)] text-center py-4">{t('empty.noInvoices', { defaultValue: 'No invoices yet' })}</div>
    ) : (
      <div className="space-y-2">
        {(data?.bills ?? []).map((bill) => {
          const billType = (bill as Record<string, unknown>).bill_type as string ?? 'opd';
          const due = getBillDue(bill);
          const paid = Number(bill.paid_amount ?? bill.paid ?? 0);
          const isPaid = due <= 0;
          return (
            <div key={bill.id} className="rounded-lg border border-[var(--color-border)] p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{bill.invoice_no ?? `Bill #${bill.id}`}</span>
                    <span className={`badge text-[10px] ${billType === 'ipd' ? 'bg-orange-100 text-orange-700' : billType === 'pharmacy' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                      {billType === 'ipd' ? 'IPD' : billType === 'pharmacy' ? 'Pharmacy' : 'OPD'}
                    </span>
                    <span className={`badge text-[10px] ${isPaid ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                      {isPaid ? 'Paid' : `Due ৳${money(due)}`}
                    </span>
                  </div>
                  <div className="text-xs text-[var(--color-text-muted)] mt-1">
                    {formatDate(bill.created_at)} · Total ৳{money(bill.total_amount)} · Paid ৳{money(paid)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!isPaid ? (
                    <button
                      type="button"
                      className="btn-primary px-3 py-2 text-xs"
                      disabled={!activeSession}
                      onClick={() => openDuePayment(bill)}
                    >
                      {t('btn.collect', { defaultValue: 'Collect' })}
                    </button>
                  ) : (
                    <a
                      href={`${basePath}/billing/invoices/${bill.id}/print`}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-ghost px-3 py-2 text-xs"
                    >
                      {t('btn.receipt', { defaultValue: 'Receipt' })}
                    </a>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    )}

    {/* Deposit Ledger */}
    {(data?.depositLedger ?? []).length > 0 ? (
      <div className="mt-4">
        <h4 className="mb-2 text-sm font-semibold">{t('patientDrawer.depositLedger', { defaultValue: 'Deposit Ledger' })}</h4>
        <div className="space-y-2">
          {(data?.depositLedger ?? []).map((d) => (
            <div key={d.id} className="flex items-center justify-between rounded-lg border border-[var(--color-border)] p-3 text-sm">
              <div>
                <div className="font-medium">৳{money(d.amount)}</div>
                <div className="text-xs text-[var(--color-text-muted)]">
                  {d.transaction_type} · {d.payment_method ?? 'cash'}
                </div>
                <div className="text-xs text-[var(--color-text-muted)]">{formatDate(d.created_at)}</div>
              </div>
              {d.deposit_receipt_no ? <span className="badge text-xs">{d.deposit_receipt_no}</span> : null}
            </div>
          ))}
        </div>
      </div>
    ) : null}
  </section>
) : null}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/reception/ReceptionPatientDrawer.tsx
git commit -m "feat: implement Total Financials tab with type badges and actions"
```

---

## Task 10: Frontend — Smart Default Tab

**Files:**
- Modify: `web/src/components/reception/ReceptionPatientDrawer.tsx`

- [ ] **Step 1: Add smart default tab logic**

Find the `useEffect` or the data fetch success handler. Add a `useEffect` that sets the default tab based on admission status:

```typescript
useEffect(() => {
  if (data?.activeAdmission) {
    setDrawerTab('ipd');
  } else {
    setDrawerTab('overview');
  }
}, [data?.activeAdmission?.id]);
```

Add this after the existing `useEffect` hooks (around line 434).

- [ ] **Step 2: Verify behavior**

- Open drawer for a patient with active admission → IPD tab should be default
- Open drawer for a patient without admission → Overview tab should be default
- Switch tabs manually → should not auto-switch back

- [ ] **Step 3: Commit**

```bash
git add web/src/components/reception/ReceptionPatientDrawer.tsx
git commit -m "feat: smart default tab based on patient admission status"
```

---

## Task 11: Integration Testing and Cleanup

**Files:**
- Run: `test/integration/routes/reception.test.ts`
- Run: `web/src/components/reception/ReceptionPatientDrawer.tsx`

- [ ] **Step 1: Run all backend tests**

Run: `npx vitest run test/integration/routes/reception.test.ts`
Expected: All tests pass.

- [ ] **Step 2: Run TypeScript check on frontend**

Run: `cd web && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Run full lint**

Run: `pnpm lint`
Expected: No errors.

- [ ] **Step 4: Final commit if needed**

If any fixes were needed:

```bash
git add -A
git commit -m "fix: cleanup and lint fixes for patient drawer redesign"
```

---

## Commit Summary

| Task | Commit Message |
|---|---|
| 1 | `feat: add past admissions to patient context endpoint` |
| 2 | `feat: add bill_type classification to patient context bills` |
| 3 | `feat: add visit-level bill grouping to patient context` |
| 4 | `refactor: rename drawer tabs to overview/opd/ipd/financials` |
| 5 | `feat: enhance patient drawer header with avatar and status badge` |
| 6 | `feat: add OPD/IPD badges to outstanding dues in patient drawer` |
| 7 | `feat: show per-visit bills in OPD History tab` |
| 8 | `feat: add past admissions list to IPD tab in patient drawer` |
| 9 | `feat: implement Total Financials tab with type badges and actions` |
| 10 | `feat: smart default tab based on patient admission status` |
| 11 | `fix: cleanup and lint fixes for patient drawer redesign` |
