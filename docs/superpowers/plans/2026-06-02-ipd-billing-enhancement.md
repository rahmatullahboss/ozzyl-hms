# IPD Billing Enhancement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add searchable category dropdowns to F4 provisional billing modal + seed 8 new billing categories + add existing deposit balance display to F3 admission modal

**Architecture:** Use existing `billing_service_departments` + `billing_service_items` master tables. Seed new departments via migration. Enhance frontend dropdowns with search. Add deposit balance query to F3 modal.

**Tech Stack:** React, TypeScript, Hono, D1 (SQLite), Tailwind CSS

---

## File Structure

| File | Change |
|------|--------|
| `migrations/XXXX_ipd_billing_categories.sql` | **Create** — Seed 8 new service departments + sample items |
| `web/src/pages/ReceptionDashboard.tsx` | **Modify** — Add existing deposit balance display in F3 right column |
| `web/src/components/reception/ProvisionalBillingModal.tsx` | **Modify** — Replace plain dropdowns with searchable dropdowns, add category badge colors |

---

## Task 1: Seed Migration — New Service Departments + Sample Items

**Files:**
- Create: `migrations/XXXX_ipd_billing_categories.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- IPD Billing Categories: Add missing service departments + sample items
-- These departments support comprehensive IPD provisional billing

-- New service departments (tenant_id = 0 = system defaults, copied to tenants on use)
INSERT OR IGNORE INTO billing_service_departments (tenant_id, department_name, department_code, is_active, created_at)
VALUES
  (0, 'OT/Operation', 'OT', 1, datetime('now', '+6 hours')),
  (0, 'Nursing Charges', 'NURS', 1, datetime('now', '+6 hours')),
  (0, 'Medicine/Pharmacy', 'PHRM', 1, datetime('now', '+6 hours')),
  (0, 'Consumables', 'CONS', 1, datetime('now', '+6 hours')),
  (0, 'Ambulance', 'AMBU', 1, datetime('now', '+6 hours')),
  (0, 'Blood Bank', 'BLOODB', 1, datetime('now', '+6 hours')),
  (0, 'Doctor Consultation', 'CONSULT', 1, datetime('now', '+6 hours')),
  (0, 'General Service', 'SERV', 1, datetime('now', '+6 hours'));

-- Sample items for OT/Operation
INSERT OR IGNORE INTO billing_service_items (tenant_id, item_name, item_code, service_department_id, price, is_active, created_at)
SELECT 0, 'Major Surgery', 'OT001', id, 15000, 1, datetime('now', '+6 hours')
FROM billing_service_departments WHERE department_code = 'OT' AND tenant_id = 0;

INSERT OR IGNORE INTO billing_service_items (tenant_id, item_name, item_code, service_department_id, price, is_active, created_at)
SELECT 0, 'Minor Surgery', 'OT002', id, 5000, 1, datetime('now', '+6 hours')
FROM billing_service_departments WHERE department_code = 'OT' AND tenant_id = 0;

INSERT OR IGNORE INTO billing_service_items (tenant_id, item_name, item_code, service_department_id, price, is_active, created_at)
SELECT 0, 'OT Charge (per hour)', 'OT003', id, 2000, 1, datetime('now', '+6 hours')
FROM billing_service_departments WHERE department_code = 'OT' AND tenant_id = 0;

INSERT OR IGNORE INTO billing_service_items (tenant_id, item_name, item_code, service_department_id, price, is_active, created_at)
SELECT 0, 'Anaesthesia Charge', 'OT004', id, 3000, 1, datetime('now', '+6 hours')
FROM billing_service_departments WHERE department_code = 'OT' AND tenant_id = 0;

-- Sample items for Nursing Charges
INSERT OR IGNORE INTO billing_service_items (tenant_id, item_name, item_code, service_department_id, price, is_active, created_at)
SELECT 0, 'Nursing Charge (per day)', 'NURS001', id, 200, 1, datetime('now', '+6 hours')
FROM billing_service_departments WHERE department_code = 'NURS' AND tenant_id = 0;

INSERT OR IGNORE INTO billing_service_items (tenant_id, item_name, item_code, service_department_id, price, is_active, created_at)
SELECT 0, 'Special Nursing (per day)', 'NURS002', id, 500, 1, datetime('now', '+6 hours')
FROM billing_service_departments WHERE department_code = 'NURS' AND tenant_id = 0;

INSERT OR IGNORE INTO billing_service_items (tenant_id, item_name, item_code, service_department_id, price, is_active, created_at)
SELECT 0, 'ICU Nursing (per day)', 'NURS003', id, 800, 1, datetime('now', '+6 hours')
FROM billing_service_departments WHERE department_code = 'NURS' AND tenant_id = 0;

-- Sample items for Medicine/Pharmacy
INSERT OR IGNORE INTO billing_service_items (tenant_id, item_name, item_code, service_department_id, price, is_active, created_at)
SELECT 0, 'General Medicine', 'PHRM001', id, 0, 1, datetime('now', '+6 hours')
FROM billing_service_departments WHERE department_code = 'PHRM' AND tenant_id = 0;

INSERT OR IGNORE INTO billing_service_items (tenant_id, item_name, item_code, service_department_id, price, is_active, created_at)
SELECT 0, 'IV Fluid', 'PHRM002', id, 150, 1, datetime('now', '+6 hours')
FROM billing_service_departments WHERE department_code = 'PHRM' AND tenant_id = 0;

INSERT OR IGNORE INTO billing_service_items (tenant_id, item_name, item_code, service_department_id, price, is_active, created_at)
SELECT 0, 'Injection', 'PHRM003', id, 50, 1, datetime('now', '+6 hours')
FROM billing_service_departments WHERE department_code = 'PHRM' AND tenant_id = 0;

-- Sample items for Consumables
INSERT OR IGNORE INTO billing_service_items (tenant_id, item_name, item_code, service_department_id, price, is_active, created_at)
SELECT 0, 'Surgical Glove (pair)', 'CONS001', id, 20, 1, datetime('now', '+6 hours')
FROM billing_service_departments WHERE department_code = 'CONS' AND tenant_id = 0;

INSERT OR IGNORE INTO billing_service_items (tenant_id, item_name, item_code, service_department_id, price, is_active, created_at)
SELECT 0, 'Syringe', 'CONS002', id, 15, 1, datetime('now', '+6 hours')
FROM billing_service_departments WHERE department_code = 'CONS' AND tenant_id = 0;

INSERT OR IGNORE INTO billing_service_items (tenant_id, item_name, item_code, service_department_id, price, is_active, created_at)
SELECT 0, 'Bandage', 'CONS003', id, 30, 1, datetime('now', '+6 hours')
FROM billing_service_departments WHERE department_code = 'CONS' AND tenant_id = 0;

INSERT OR IGNORE INTO billing_service_items (tenant_id, item_name, item_code, service_department_id, price, is_active, created_at)
SELECT 0, 'Cannula', 'CONS004', id, 60, 1, datetime('now', '+6 hours')
FROM billing_service_departments WHERE department_code = 'CONS' AND tenant_id = 0;

INSERT OR IGNORE INTO billing_service_items (tenant_id, item_name, item_code, service_department_id, price, is_active, created_at)
SELECT 0, 'Urinary Catheter', 'CONS005', id, 100, 1, datetime('now', '+6 hours')
FROM billing_service_departments WHERE department_code = 'CONS' AND tenant_id = 0;

-- Sample items for Ambulance
INSERT OR IGNORE INTO billing_service_items (tenant_id, item_name, item_code, service_department_id, price, is_active, created_at)
SELECT 0, 'Ambulance (within city)', 'AMBU001', id, 1000, 1, datetime('now', '+6 hours')
FROM billing_service_departments WHERE department_code = 'AMBU' AND tenant_id = 0;

INSERT OR IGNORE INTO billing_service_items (tenant_id, item_name, item_code, service_department_id, price, is_active, created_at)
SELECT 0, 'Ambulance (outside city)', 'AMBU002', id, 2500, 1, datetime('now', '+6 hours')
FROM billing_service_departments WHERE department_code = 'AMBU' AND tenant_id = 0;

-- Sample items for Blood Bank
INSERT OR IGNORE INTO billing_service_items (tenant_id, item_name, item_code, service_department_id, price, is_active, created_at)
SELECT 0, 'Whole Blood (1 unit)', 'BLOODB001', id, 1200, 1, datetime('now', '+6 hours')
FROM billing_service_departments WHERE department_code = 'BLOODB' AND tenant_id = 0;

INSERT OR IGNORE INTO billing_service_items (tenant_id, item_name, item_code, service_department_id, price, is_active, created_at)
SELECT 0, 'Packed RBC (1 unit)', 'BLOODB002', id, 1500, 1, datetime('now', '+6 hours')
FROM billing_service_departments WHERE department_code = 'BLOODB' AND tenant_id = 0;

INSERT OR IGNORE INTO billing_service_items (tenant_id, item_name, item_code, service_department_id, price, is_active, created_at)
SELECT 0, 'FFP (1 unit)', 'BLOODB003', id, 800, 1, datetime('now', '+6 hours')
FROM billing_service_departments WHERE department_code = 'BLOODB' AND tenant_id = 0;

INSERT OR IGNORE INTO billing_service_items (tenant_id, item_name, item_code, service_department_id, price, is_active, created_at)
SELECT 0, 'Platelet (1 unit)', 'BLOODB004', id, 2000, 1, datetime('now', '+6 hours')
FROM billing_service_departments WHERE department_code = 'BLOODB' AND tenant_id = 0;

INSERT OR IGNORE INTO billing_service_items (tenant_id, item_name, item_code, service_department_id, price, is_active, created_at)
SELECT 0, 'Cross Match', 'BLOODB005', id, 300, 1, datetime('now', '+6 hours')
FROM billing_service_departments WHERE department_code = 'BLOODB' AND tenant_id = 0;

-- Sample items for Doctor Consultation
INSERT OR IGNORE INTO billing_service_items (tenant_id, item_name, item_code, service_department_id, price, is_active, created_at)
SELECT 0, 'Consultant Visit', 'CONSULT001', id, 500, 1, datetime('now', '+6 hours')
FROM billing_service_departments WHERE department_code = 'CONSULT' AND tenant_id = 0;

INSERT OR IGNORE INTO billing_service_items (tenant_id, item_name, item_code, service_department_id, price, is_active, created_at)
SELECT 0, 'Specialist Visit', 'CONSULT002', id, 1000, 1, datetime('now', '+6 hours')
FROM billing_service_departments WHERE department_code = 'CONSULT' AND tenant_id = 0;

INSERT OR IGNORE INTO billing_service_items (tenant_id, item_name, item_code, service_department_id, price, is_active, created_at)
SELECT 0, 'Professor Visit', 'CONSULT003', id, 1500, 1, datetime('now', '+6 hours')
FROM billing_service_departments WHERE department_code = 'CONSULT' AND tenant_id = 0;

INSERT OR IGNORE INTO billing_service_items (tenant_id, item_name, item_code, service_department_id, price, is_active, created_at)
SELECT 0, 'Daily Round Visit', 'CONSULT004', id, 300, 1, datetime('now', '+6 hours')
FROM billing_service_departments WHERE department_code = 'CONSULT' AND tenant_id = 0;

-- Sample items for General Service
INSERT OR IGNORE INTO billing_service_items (tenant_id, item_name, item_code, service_department_id, price, is_active, created_at)
SELECT 0, 'ECG', 'SERV001', id, 200, 1, datetime('now', '+6 hours')
FROM billing_service_departments WHERE department_code = 'SERV' AND tenant_id = 0;

INSERT OR IGNORE INTO billing_service_items (tenant_id, item_name, item_code, service_department_id, price, is_active, created_at)
SELECT 0, 'Nebulization', 'SERV002', id, 150, 1, datetime('now', '+6 hours')
FROM billing_service_departments WHERE department_code = 'SERV' AND tenant_id = 0;

INSERT OR IGNORE INTO billing_service_items (tenant_id, item_name, item_code, service_department_id, price, is_active, created_at)
SELECT 0, 'Dressing', 'SERV003', id, 100, 1, datetime('now', '+6 hours')
FROM billing_service_departments WHERE department_code = 'SERV' AND tenant_id = 0;

INSERT OR IGNORE INTO billing_service_items (tenant_id, item_name, item_code, service_department_id, price, is_active, created_at)
SELECT 0, 'Injection (administer)', 'SERV004', id, 30, 1, datetime('now', '+6 hours')
FROM billing_service_departments WHERE department_code = 'SERV' AND tenant_id = 0;

INSERT OR IGNORE INTO billing_service_items (tenant_id, item_name, item_code, service_department_id, price, is_active, created_at)
SELECT 0, 'Ryle Tube Insertion', 'SERV005', id, 200, 1, datetime('now', '+6 hours')
FROM billing_service_departments WHERE department_code = 'SERV' AND tenant_id = 0;

INSERT OR IGNORE INTO billing_service_items (tenant_id, item_name, item_code, service_department_id, price, is_active, created_at)
SELECT 0, 'Urinary Catheterization', 'SERV006', id, 250, 1, datetime('now', '+6 hours')
FROM billing_service_departments WHERE department_code = 'SERV' AND tenant_id = 0;

INSERT OR IGNORE INTO billing_service_items (tenant_id, item_name, item_code, service_department_id, price, is_active, created_at)
SELECT 0, 'Oxygen (per hour)', 'SERV007', id, 100, 1, datetime('now', '+6 hours')
FROM billing_service_departments WHERE department_code = 'SERV' AND tenant_id = 0;

INSERT OR IGNORE INTO billing_service_items (tenant_id, item_name, item_code, service_department_id, price, is_active, created_at)
SELECT 0, 'Physiotherapy Session', 'SERV008', id, 500, 1, datetime('now', '+6 hours')
FROM billing_service_departments WHERE department_code = 'SERV' AND tenant_id = 0;
```

- [ ] **Step 2: Run the migration**

```bash
cd /Users/rahmatullahzisan/Desktop/Dev/hms
# Rename file with proper sequence number first
# Then run migration
npx wrangler d1 execute hms-saas-db --local --file=migrations/XXXX_ipd_billing_categories.sql
```

- [ ] **Step 3: Verify departments were seeded**

```bash
npx wrangler d1 execute hms-saas-db --local --command="SELECT id, department_name, department_code FROM billing_service_departments WHERE tenant_id = 0 ORDER BY id"
```

Expected: Should show all departments including the new ones (OT, NURS, PHRM, CONS, AMBU, BLOODB, CONSULT, SERV).

- [ ] **Step 4: Verify items were seeded**

```bash
npx wrangler d1 execute hms-saas-db --local --command="SELECT i.item_name, i.item_code, i.price, d.department_code FROM billing_service_items i JOIN billing_service_departments d ON i.service_department_id = d.id WHERE i.tenant_id = 0 AND d.department_code IN ('OT','NURS','PHRM','CONS','AMBU','BLOODB','CONSULT','SERV') ORDER BY d.department_code, i.item_code"
```

Expected: Should show all sample items grouped by department.

- [ ] **Step 5: Commit**

```bash
git add migrations/XXXX_ipd_billing_categories.sql
git commit -m "feat: seed IPD billing categories - OT, nursing, medicine, consumables, ambulance, blood bank, consultation, service"
```

---

## Task 2: Enhance ProvisionalBillingModal — Searchable Dropdowns + Category Badge Colors

**Files:**
- Modify: `web/src/components/reception/ProvisionalBillingModal.tsx`

- [ ] **Step 1: Add searchable category dropdown component**

Replace the plain `<select>` for category (lines 496-499) with a searchable input + dropdown. Add this state and helper near the existing state declarations (around line 136):

```typescript
// Add after line 139 (const [newPrice, setNewPrice] = useState('');)
const [deptSearch, setDeptSearch] = useState('');
const [showDeptDropdown, setShowDeptDropdown] = useState(false);
const [itemSearch, setItemSearch] = useState('');
const [showItemDropdown, setShowItemDropdown] = useState(false);
```

- [ ] **Step 2: Add category badge color helper function**

Add this helper function inside the component, before the `return` statement (around line 317):

```typescript
const getCategoryBadgeClass = (category: string): string => {
  const c = category.toLowerCase();
  if (c.includes('bed') || c.includes('room')) return 'bg-blue-50 text-blue-700';
  if (c.includes('lab') || c.includes('investigation') || c.includes('diagnostic')) return 'bg-purple-50 text-purple-700';
  if (c.includes('ot') || c.includes('operation') || c.includes('surgery')) return 'bg-red-50 text-red-700';
  if (c.includes('nurs')) return 'bg-green-50 text-green-700';
  if (c.includes('pharm') || c.includes('medicine') || c.includes('drug')) return 'bg-orange-50 text-orange-700';
  if (c.includes('consum')) return 'bg-yellow-50 text-yellow-700';
  if (c.includes('ambu') || c.includes('transport')) return 'bg-cyan-50 text-cyan-700';
  if (c.includes('blood')) return 'bg-pink-50 text-pink-700';
  if (c.includes('consult')) return 'bg-indigo-50 text-indigo-700';
  if (c.includes('service')) return 'bg-gray-100 text-gray-700';
  return 'bg-blue-50 text-blue-700';
};
```

- [ ] **Step 3: Replace category dropdown with searchable version**

Replace lines 494-499 (the category `<select>`) with:

```tsx
<div className="col-span-3 relative">
  <label className="label text-xs">{t('table.category', { ns: 'reception' })}</label>
  <input
    className="input h-9 text-sm"
    type="text"
    value={deptSearch || (newDept ? departments.find(d => String(d.id) === newDept)?.department_name ?? '' : '')}
    onChange={e => {
      setDeptSearch(e.target.value);
      setShowDeptDropdown(true);
      if (!e.target.value) { setNewDept(''); setNewItem(''); setNewPrice(''); }
    }}
    onFocus={() => setShowDeptDropdown(true)}
    onBlur={() => setTimeout(() => setShowDeptDropdown(false), 200)}
    placeholder={t('select.selectCategory', { ns: 'reception' })}
  />
  {showDeptDropdown && (
    <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-white shadow-lg">
      {departments
        .filter(d => !deptSearch || d.department_name.toLowerCase().includes(deptSearch.toLowerCase()))
        .map(d => (
          <button
            key={d.id}
            type="button"
            className={`block w-full px-3 py-2 text-left text-sm hover:bg-[var(--color-bg-secondary)] ${String(d.id) === newDept ? 'bg-blue-50' : ''}`}
            onMouseDown={e => {
              e.preventDefault();
              setNewDept(String(d.id));
              setDeptSearch('');
              setNewItem('');
              setNewPrice('');
              setShowDeptDropdown(false);
            }}
          >
            {d.department_name}
          </button>
        ))
      }
      {departments.filter(d => !deptSearch || d.department_name.toLowerCase().includes(deptSearch.toLowerCase())).length === 0 && (
        <div className="px-3 py-2 text-sm text-[var(--color-text-muted)]">No matching category</div>
      )}
    </div>
  )}
</div>
```

- [ ] **Step 4: Replace item dropdown with searchable version**

Replace lines 501-506 (the item `<select>`) with:

```tsx
<div className="col-span-4 relative">
  <label className="label text-xs">{t('table.item', { ns: 'reception' })}</label>
  <input
    className="input h-9 text-sm"
    type="text"
    value={itemSearch || (newItem ? serviceItems.find(si => String(si.id) === newItem)?.item_name ?? '' : '')}
    onChange={e => {
      setItemSearch(e.target.value);
      setShowItemDropdown(true);
      if (!e.target.value) { setNewItem(''); setNewPrice(''); }
    }}
    onFocus={() => setShowItemDropdown(true)}
    onBlur={() => setTimeout(() => setShowItemDropdown(false), 200)}
    placeholder={newDept ? t('select.searchOrSelectItem', { ns: 'reception' }) : 'Select category first'}
    disabled={!newDept}
  />
  {showItemDropdown && newDept && (
    <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-white shadow-lg">
      {serviceItems
        .filter(si => !itemSearch || si.item_name.toLowerCase().includes(itemSearch.toLowerCase()))
        .map(si => (
          <button
            key={si.id}
            type="button"
            className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-[var(--color-bg-secondary)] ${String(si.id) === newItem ? 'bg-blue-50' : ''}`}
            onMouseDown={e => {
              e.preventDefault();
              setNewItem(String(si.id));
              setItemSearch('');
              setNewPrice(String(si.price ?? si.unit_price ?? 0));
              setShowItemDropdown(false);
            }}
          >
            <span>{si.item_name}</span>
            <span className="font-data text-xs text-[var(--color-text-muted)]">{formatBDT(si.price ?? si.unit_price ?? 0)}</span>
          </button>
        ))
      }
      {serviceItems.filter(si => !itemSearch || si.item_name.toLowerCase().includes(itemSearch.toLowerCase())).length === 0 && (
        <div className="px-3 py-2 text-sm text-[var(--color-text-muted)]">No matching item</div>
      )}
    </div>
  )}
</div>
```

- [ ] **Step 5: Update category badge in ledger table**

Replace the category badge in the ledger (line 578) with the color-coded version:

```tsx
<td className="px-4 py-2">
  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${getCategoryBadgeClass(item.item_category)}`}>{item.item_category}</span>
</td>
```

- [ ] **Step 6: Verify the changes compile**

```bash
cd /Users/rahmatullahzisan/Desktop/Dev/hms && pnpm build
```

Expected: Build succeeds with no errors.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/reception/ProvisionalBillingModal.tsx
git commit -m "feat: searchable category/item dropdowns + color-coded badges in provisional billing"
```

---

## Task 3: Add Existing Deposit Balance Display to F3 Modal

**Files:**
- Modify: `web/src/pages/ReceptionDashboard.tsx`

- [ ] **Step 1: Add state for patient deposit balance**

Add near the existing admission state declarations (around line 669):

```typescript
const [patientDepositBalance, setPatientDepositBalance] = useState<number | null>(null);
```

- [ ] **Step 2: Fetch deposit balance when patient is selected**

Add a useEffect to fetch deposit balance when `admissionPatient` changes. Place it near other useEffects:

```typescript
useEffect(() => {
  if (!admissionPatient) { setPatientDepositBalance(null); return; }
  const fetchBalance = async () => {
    try {
      const data = await api.get<{ balance?: number }>(`/api/deposits?patient_id=${admissionPatient.id}&balance_only=1`);
      setPatientDepositBalance(data.balance ?? 0);
    } catch { setPatientDepositBalance(null); }
  };
  fetchBalance();
}, [admissionPatient]);
```

- [ ] **Step 3: Display deposit balance in the right column**

Add the deposit balance display after the payment method dropdown (after line 4293), before the summary box:

```tsx
{patientDepositBalance !== null && patientDepositBalance > 0 && (
  <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm">
    <div className="flex items-center gap-2">
      <span className="text-emerald-600 font-medium">Existing Deposit:</span>
      <span className="font-data font-bold text-emerald-700">{formatBDT(patientDepositBalance)}</span>
    </div>
    <p className="text-xs text-emerald-600 mt-1">This patient has advance deposit from previous visits.</p>
  </div>
)}
```

- [ ] **Step 4: Verify the changes compile**

```bash
cd /Users/rahmatullahzisan/Desktop/Dev/hms && pnpm build
```

Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/ReceptionDashboard.tsx
git commit -m "feat: show existing deposit balance in F3 admission modal"
```

---

## Task 4: Verify End-to-End

- [ ] **Step 1: Start dev server**

```bash
cd /Users/rahmatullahzisan/Desktop/Dev/hms && pnpm dev
```

- [ ] **Step 2: Test F3 modal — deposit balance display**

1. Open Reception Dashboard
2. Press F3 to open IPD Admission
3. Select a patient who has existing deposits
4. Verify "Existing Deposit" badge appears with correct amount

- [ ] **Step 3: Test F4 modal — searchable dropdowns**

1. Press F4 to open Provisional Billing
2. Select an admitted patient
3. In "Add New Charge" section:
   - Click category dropdown → verify all 10+ categories appear
   - Type "OT" in category search → verify filtering works
   - Select "OT/Operation" → verify items load
   - Type "surg" in item search → verify filtering works
   - Select an item → verify price auto-fills
   - Click "Add Charge" → verify item appears in ledger
4. Verify category badge has correct color in ledger table

- [ ] **Step 4: Test all categories**

Add one item from each category to verify they all work:
- Bed/Room (auto, verify it shows)
- Investigation/Lab
- OT/Operation
- Nursing Charges
- Medicine/Pharmacy
- Consumables
- Ambulance
- Blood Bank
- Doctor Consultation
- General Service

- [ ] **Step 5: Final commit**

```bash
git add -A && git commit -m "feat: IPD billing enhancement complete - searchable categories + deposit balance display"
```
