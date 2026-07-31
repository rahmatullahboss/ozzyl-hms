# Tenant Admin Pages i18n Coverage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Translate all tenant/hospital admin pages to Bangla so the UI is fully bilingual (en + bn).

**Architecture:** Add 6 new locale namespaces grouped by tenant area. For each page, extract hardcoded English UI strings, wrap them with `t()` calls, and add corresponding keys (with Bangla translations) to the relevant JSON files. Register the new namespaces in `web/src/lib/i18n.ts`.

**Tech Stack:** React 18, react-i18next, i18next, TypeScript, Vitest

**Reference spec:** `docs/superpowers/specs/2026-06-12-tenant-admin-i18n-coverage-design.md`

---

## File Structure

### Files to create (12 total)

**6 new locale files (en + bn pairs):**
- `web/public/locales/en/tenantDashboard.json`
- `web/public/locales/bn/tenantDashboard.json`
- `web/public/locales/en/tenantBilling.json`
- `web/public/locales/bn/tenantBilling.json`
- `web/public/locales/en/tenantClinical.json`
- `web/public/locales/bn/tenantClinical.json`
- `web/public/locales/en/tenantLab.json`
- `web/public/locales/bn/tenantLab.json`
- `web/public/locales/en/tenantPharmacy.json`
- `web/public/locales/bn/tenantPharmacy.json`
- `web/public/locales/en/tenantAdmin.json`
- `web/public/locales/bn/tenantAdmin.json`

### Files to modify (1)
- `web/src/lib/i18n.ts` — add 6 new namespaces to the `ns:` array

### Tenant pages to translate (42 total)

**Root-level tenant pages (22):**
- `AdminModuleCatalog.tsx` → tenantAdmin
- `AdminTransactionControlCenter.tsx` → tenantAdmin
- `ApprovalCenter.tsx` → tenantAdmin
- `BillVersionHistory.tsx` → tenantBilling
- `BillingReportsPage.tsx` → tenantBilling
- `CashBankBook.tsx` → tenantBilling
- `CommissionRules.tsx` → tenantBilling
- `DoctorLabResults.tsx` → tenantClinical
- `DueAgingReport.tsx` → tenantBilling
- `IPDRunningBillPrint.tsx` → tenantBilling
- `IntraOpCanvas.tsx` → tenantClinical
- `LaboratoryDashboard.tsx` → tenantLab
- `OTCalendar.tsx` → tenantClinical
- `OTSettings.tsx` → tenantClinical
- `OTReports.tsx` → tenantClinical
- `PatientPortal.tsx` → tenantClinical
- `SettingsPage.tsx` → tenantAdmin (verify — may already use t)
- `PermissionManagement.tsx` → tenantAdmin (verify)
- `DepartmentSettings.tsx` → tenantAdmin (verify)
- `HospitalAdminDashboard.tsx` → tenantDashboard (verify)
- `ReceptionDashboard.tsx` → tenantDashboard (verify)
- `BillingCounterPage.tsx` → tenantBilling (verify)

**Subdirectory tenant pages (20):**
- `accounting/AuditLogs.tsx` → tenantAdmin
- `accounting/Reports.tsx` → tenantBilling
- `accounting/ExpenseList.tsx` → tenantBilling
- `accounting/IncomeList.tsx` → tenantBilling
- `accounting/AccountingDashboard.tsx` → tenantDashboard
- `accounting/ChartOfAccounts.tsx` → tenantAdmin
- `accounting/JournalEntries.tsx` → tenantBilling
- `accounting/ProfitLoss.tsx` → tenantBilling
- `accounting/RecurringExpenses.tsx` → tenantBilling
- `accounting/VoucherVerification.tsx` → tenantBilling
- `accounting/ShareholderManagement.tsx` → tenantAdmin
- `accounting/FiscalYearSettings.tsx` → tenantAdmin
- `doctor/DoctorReportReview.tsx` → tenantClinical
- `doctor/DoctorCertificates.tsx` → tenantClinical
- `doctor/DoctorDashboard.tsx` → tenantDashboard
- `inventory/InventoryMasterDataPage.tsx` → tenantPharmacy
- `inventory/InventoryWriteOffPage.tsx` → tenantPharmacy
- `inventory/InventoryImportExportPage.tsx` → tenantPharmacy
- `inventory/InventoryReturnPage.tsx` → tenantPharmacy
- `inventory/InventoryTransferPage.tsx` → tenantPharmacy
- `inventory/InventoryAdjustmentRequestPage.tsx` → tenantPharmacy
- `inventory/InventoryCountPage.tsx` → tenantPharmacy
- `inventory/InventoryReportsPage.tsx` → tenantPharmacy
- `inventory/InventoryIssuePage.tsx` → tenantPharmacy
- `inventory/InventoryReturnToVendorPage.tsx` → tenantPharmacy
- `inventory/InventoryDonationPage.tsx` → tenantPharmacy
- `inventory/InventoryTraceability.tsx` → tenantPharmacy
- `inventory/InventoryRFQPage.tsx` → tenantPharmacy
- `analytics/CustomReportBuilder.tsx` → tenantAdmin
- `analytics/ExecutiveOverview.tsx` → tenantDashboard
- `analytics/RevenueAnalytics.tsx` → tenantBilling

---

## Task 1: Create 6 new locale JSON files (en + bn)

**Files:**
- Create: `web/public/locales/en/tenantDashboard.json`
- Create: `web/public/locales/bn/tenantDashboard.json`
- Create: `web/public/locales/en/tenantBilling.json`
- Create: `web/public/locales/bn/tenantBilling.json`
- Create: `web/public/locales/en/tenantClinical.json`
- Create: `web/public/locales/bn/tenantClinical.json`
- Create: `web/public/locales/en/tenantLab.json`
- Create: `web/public/locales/bn/tenantLab.json`
- Create: `web/public/locales/en/tenantPharmacy.json`
- Create: `web/public/locales/bn/tenantPharmacy.json`
- Create: `web/public/locales/en/tenantAdmin.json`
- Create: `web/public/locales/bn/tenantAdmin.json`

- [ ] **Step 1: Create empty tenantDashboard.json (en)**

Create file `web/public/locales/en/tenantDashboard.json` with content:
```json
{}
```

- [ ] **Step 2: Create empty tenantDashboard.json (bn)**

Create file `web/public/locales/bn/tenantDashboard.json` with content:
```json
{}
```

- [ ] **Step 3: Create empty tenantBilling.json (en)**

Create file `web/public/locales/en/tenantBilling.json` with content:
```json
{}
```

- [ ] **Step 4: Create empty tenantBilling.json (bn)**

Create file `web/public/locales/bn/tenantBilling.json` with content:
```json
{}
```

- [ ] **Step 5: Create empty tenantClinical.json (en)**

Create file `web/public/locales/en/tenantClinical.json` with content:
```json
{}
```

- [ ] **Step 6: Create empty tenantClinical.json (bn)**

Create file `web/public/locales/bn/tenantClinical.json` with content:
```json
{}
```

- [ ] **Step 7: Create empty tenantLab.json (en)**

Create file `web/public/locales/en/tenantLab.json` with content:
```json
{}
```

- [ ] **Step 8: Create empty tenantLab.json (bn)**

Create file `web/public/locales/bn/tenantLab.json` with content:
```json
{}
```

- [ ] **Step 9: Create empty tenantPharmacy.json (en)**

Create file `web/public/locales/en/tenantPharmacy.json` with content:
```json
{}
```

- [ ] **Step 10: Create empty tenantPharmacy.json (bn)**

Create file `web/public/locales/bn/tenantPharmacy.json` with content:
```json
{}
```

- [ ] **Step 11: Create empty tenantAdmin.json (en)**

Create file `web/public/locales/en/tenantAdmin.json` with content:
```json
{}
```

- [ ] **Step 12: Create empty tenantAdmin.json (bn)**

Create file `web/public/locales/bn/tenantAdmin.json` with content:
```json
{}
```

- [ ] **Step 13: Commit**

```bash
git add web/public/locales/en/tenantDashboard.json web/public/locales/bn/tenantDashboard.json \
        web/public/locales/en/tenantBilling.json web/public/locales/bn/tenantBilling.json \
        web/public/locales/en/tenantClinical.json web/public/locales/bn/tenantClinical.json \
        web/public/locales/en/tenantLab.json web/public/locales/bn/tenantLab.json \
        web/public/locales/en/tenantPharmacy.json web/public/locales/bn/tenantPharmacy.json \
        web/public/locales/en/tenantAdmin.json web/public/locales/bn/tenantAdmin.json
git commit -m "feat(i18n): scaffold 6 new tenant locale namespaces"
```

---

## Task 2: Register new namespaces in i18n.ts

**Files:**
- Modify: `web/src/lib/i18n.ts:33-39`

- [ ] **Step 1: Add namespaces to the ns array**

In `web/src/lib/i18n.ts`, modify the `ns:` array (around line 33-39). Replace the current ns array with:

```typescript
    ns: ['common', 'sidebar', 'dashboard', 'auth', 'patients', 'billing',
         'pharmacy', 'laboratory', 'appointments', 'staff', 'accounting',
         'reports', 'settings', 'telemedicine', 'ipd', 'notifications', 'director',
          'emergency', 'ot', 'vitals', 'nursing', 'super-admin', 'inventory', 'hr', 'clinical', 'radiology', 'helpCenter', 'roleGuides', 'pageHelp', 'patientPortal',
         'maternity', 'ward_supply', 'setup_wizard', 'quality_kpi', 'mlc', 'mortuary', 'laundry', 'biomedical_waste', 'blood_bank',
         'reminders', 'documents', 'dental', 'doctor', 'reception',
         'tenantDashboard', 'tenantBilling', 'tenantClinical', 'tenantLab', 'tenantPharmacy', 'tenantAdmin'
    ],
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit 2>&1 | head -30`
Expected: No errors related to i18n.ts (other unrelated errors may exist)

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/i18n.ts
git commit -m "feat(i18n): register 6 new tenant namespaces in i18n config"
```

---

## Task 3: Translate a single page (template) — BillVersionHistory.tsx

**Files:**
- Modify: `web/src/pages/BillVersionHistory.tsx`
- Modify: `web/public/locales/en/tenantBilling.json`
- Modify: `web/public/locales/bn/tenantBilling.json`

This task establishes the per-page pattern. Repeat for all 41 other pages.

- [ ] **Step 1: Read the file to find hardcoded strings**

```bash
wc -l web/src/pages/BillVersionHistory.tsx
head -50 web/src/pages/BillVersionHistory.tsx
```

- [ ] **Step 2: Add useTranslation import and t() call**

In `web/src/pages/BillVersionHistory.tsx`, add the import after existing React imports:

```tsx
import { useTranslation } from 'react-i18next';
```

Inside the component function (the one returning JSX), add at the top:
```tsx
  const { t } = useTranslation(['tenantBilling']);
```

- [ ] **Step 3: Wrap hardcoded strings with t() calls**

Find all hardcoded English UI strings in the file (labels, headings, button text, empty states) and wrap them with `t('keyName')`. For example, change:

```tsx
<h1>Bill Version History</h1>
```

to:

```tsx
<h1>{t('billVersionHistory.title')}</h1>
```

Use this key naming pattern: `billVersionHistory.title`, `billVersionHistory.emptyState`, `billVersionHistory.column.version`, etc.

- [ ] **Step 4: Add English keys to tenantBilling.json**

Edit `web/public/locales/en/tenantBilling.json`. Add the keys used in Step 3:

```json
{
  "billVersionHistory": {
    "title": "Bill Version History",
    "emptyState": "No bill versions found",
    "column": {
      "version": "Version",
      "date": "Date",
      "user": "User",
      "amount": "Amount"
    },
    "back": "Back"
  }
}
```

- [ ] **Step 5: Add Bangla keys to tenantBilling.json**

Edit `web/public/locales/bn/tenantBilling.json`. Add the same keys with Bangla translations:

```json
{
  "billVersionHistory": {
    "title": "বিল সংস্করণ ইতিহাস",
    "emptyState": "কোনো বিল সংস্করণ পাওয়া যায়নি",
    "column": {
      "version": "সংস্করণ",
      "date": "তারিখ",
      "user": "ব্যবহারকারী",
      "amount": "পরিমাণ"
    },
    "back": "পিছনে"
  }
}
```

- [ ] **Step 6: Run tests for the page**

Run: `cd web && npx vitest run src/pages/BillVersionHistory.test.tsx 2>&1 | tail -30`
Expected: Tests pass (if tests existed). If tests fail because they look for English strings, update test assertions.

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/BillVersionHistory.tsx \
        web/public/locales/en/tenantBilling.json \
        web/public/locales/bn/tenantBilling.json
git commit -m "feat(i18n): translate BillVersionHistory to bn"
```

---

## Task 4-44: Translate remaining 41 pages using the Task 3 pattern

For each page listed below, repeat the Task 3 workflow (read → wrap strings → add en keys → add bn keys → run tests → commit).

**Pages to translate (each is a separate task):**

| # | File | Namespace |
|---|------|-----------|
| 4 | web/src/pages/AdminModuleCatalog.tsx | tenantAdmin |
| 5 | web/src/pages/AdminTransactionControlCenter.tsx | tenantAdmin |
| 6 | web/src/pages/ApprovalCenter.tsx | tenantAdmin |
| 7 | web/src/pages/BillingReportsPage.tsx | tenantBilling |
| 8 | web/src/pages/CashBankBook.tsx | tenantBilling |
| 9 | web/src/pages/CommissionRules.tsx | tenantBilling |
| 10 | web/src/pages/DoctorLabResults.tsx | tenantClinical |
| 11 | web/src/pages/DueAgingReport.tsx | tenantBilling |
| 12 | web/src/pages/IPDRunningBillPrint.tsx | tenantBilling |
| 13 | web/src/pages/IntraOpCanvas.tsx | tenantClinical |
| 14 | web/src/pages/LaboratoryDashboard.tsx | tenantLab |
| 15 | web/src/pages/OTCalendar.tsx | tenantClinical |
| 16 | web/src/pages/OTSettings.tsx | tenantClinical |
| 17 | web/src/pages/OTReports.tsx | tenantClinical |
| 18 | web/src/pages/PatientPortal.tsx | tenantClinical |
| 19 | web/src/pages/accounting/AuditLogs.tsx | tenantAdmin |
| 20 | web/src/pages/accounting/Reports.tsx | tenantBilling |
| 21 | web/src/pages/accounting/ExpenseList.tsx | tenantBilling |
| 22 | web/src/pages/accounting/IncomeList.tsx | tenantBilling |
| 23 | web/src/pages/accounting/AccountingDashboard.tsx | tenantDashboard |
| 24 | web/src/pages/accounting/ChartOfAccounts.tsx | tenantAdmin |
| 25 | web/src/pages/accounting/JournalEntries.tsx | tenantBilling |
| 26 | web/src/pages/accounting/ProfitLoss.tsx | tenantBilling |
| 27 | web/src/pages/accounting/RecurringExpenses.tsx | tenantBilling |
| 28 | web/src/pages/accounting/VoucherVerification.tsx | tenantBilling |
| 29 | web/src/pages/accounting/ShareholderManagement.tsx | tenantAdmin |
| 30 | web/src/pages/accounting/FiscalYearSettings.tsx | tenantAdmin |
| 31 | web/src/pages/doctor/DoctorReportReview.tsx | tenantClinical |
| 32 | web/src/pages/doctor/DoctorCertificates.tsx | tenantClinical |
| 33 | web/src/pages/doctor/DoctorDashboard.tsx | tenantDashboard |
| 34 | web/src/pages/inventory/InventoryMasterDataPage.tsx | tenantPharmacy |
| 35 | web/src/pages/inventory/InventoryWriteOffPage.tsx | tenantPharmacy |
| 36 | web/src/pages/inventory/InventoryImportExportPage.tsx | tenantPharmacy |
| 37 | web/src/pages/inventory/InventoryReturnPage.tsx | tenantPharmacy |
| 38 | web/src/pages/inventory/InventoryTransferPage.tsx | tenantPharmacy |
| 39 | web/src/pages/inventory/InventoryAdjustmentRequestPage.tsx | tenantPharmacy |
| 40 | web/src/pages/inventory/InventoryCountPage.tsx | tenantPharmacy |
| 41 | web/src/pages/inventory/InventoryReportsPage.tsx | tenantPharmacy |
| 42 | web/src/pages/inventory/InventoryIssuePage.tsx | tenantPharmacy |
| 43 | web/src/pages/inventory/InventoryReturnToVendorPage.tsx | tenantPharmacy |
| 44 | web/src/pages/inventory/InventoryDonationPage.tsx | tenantPharmacy |
| 45 | web/src/pages/inventory/InventoryTraceability.tsx | tenantPharmacy |
| 46 | web/src/pages/inventory/InventoryRFQPage.tsx | tenantPharmacy |
| 47 | web/src/pages/analytics/CustomReportBuilder.tsx | tenantAdmin |
| 48 | web/src/pages/analytics/ExecutiveOverview.tsx | tenantDashboard |
| 49 | web/src/pages/analytics/RevenueAnalytics.tsx | tenantBilling |

For each task in the range 4-49:
- [ ] Read the file
- [ ] Add `useTranslation(['namespace'])` import and call
- [ ] Wrap all hardcoded English UI strings with `t('keyName')`
- [ ] Add corresponding keys to en JSON file
- [ ] Add Bangla translations to bn JSON file
- [ ] Run `cd web && npx vitest run <file>.test.tsx` (if test exists)
- [ ] Commit with `feat(i18n): translate <PageName> to bn`

---

## Task 50: Verify all en/bn JSON keys are in sync

**Files:**
- Read: `web/public/locales/en/tenant*.json`
- Read: `web/public/locales/bn/tenant*.json`

- [ ] **Step 1: Write a verification script**

Create `scripts/verify-i18n-keys.sh`:
```bash
#!/bin/bash
set -e
for ns in tenantDashboard tenantBilling tenantClinical tenantLab tenantPharmacy tenantAdmin; do
  en_keys=$(jq -r 'paths(scalars) | join(".")' web/public/locales/en/${ns}.json | sort)
  bn_keys=$(jq -r 'paths(scalars) | join(".")' web/public/locales/bn/${ns}.json | sort)
  if [ "$en_keys" != "$bn_keys" ]; then
    echo "MISMATCH in $ns:"
    diff <(echo "$en_keys") <(echo "$bn_keys")
    exit 1
  else
    echo "OK: $ns has $(echo "$en_keys" | wc -l) matching keys"
  fi
done
```

- [ ] **Step 2: Run the verification script**

Run: `chmod +x scripts/verify-i18n-keys.sh && bash scripts/verify-i18n-keys.sh`
Expected: All 6 namespaces show "OK" with matching key counts

- [ ] **Step 3: Fix any mismatches found**

If mismatches found, add the missing key to the appropriate bn JSON file. Repeat Step 2.

- [ ] **Step 4: Commit the verification script**

```bash
git add scripts/verify-i18n-keys.sh
git commit -m "chore(i18n): add en/bn key parity verification script"
```

---

## Task 51: Run full test suite

- [ ] **Step 1: Run all web tests**

Run: `cd web && npx vitest run 2>&1 | tail -50`
Expected: All tests pass. Any failing tests need to be updated to use translation keys instead of literal English strings.

- [ ] **Step 2: Fix any failing tests**

For each failing test:
- Read the error message
- Update the test assertion to use the translation key (e.g., `expect(screen.getByText('billing.invoiceTitle'))` instead of looking for English text)
- Or call `i18n.changeLanguage('en')` in the test before assertions
- Commit each fix separately

- [ ] **Step 3: Commit any test fixes**

```bash
git add web/src/**/*.test.tsx
git commit -m "test: fix tests broken by i18n changes"
```

---

## Task 52: Browser smoke test

- [ ] **Step 1: Start dev server**

Run in background: `cd web && npm run dev`
Wait for "Local: http://localhost:5173" to appear

- [ ] **Step 2: Test in English**

Open `http://localhost:5173` in browser
- Log in as admin
- Visit each translated page (refer to the 42-page list)
- Verify page loads, English text renders, no console errors
- Check that no raw `t('key')` strings are visible

- [ ] **Step 3: Switch to Bangla**

- Open language switcher (typically in top-right or sidebar settings)
- Select "বাংলা" (Bangla)
- Verify `localStorage.hms_language` = `'bn'` in browser devtools

- [ ] **Step 4: Test in Bangla**

Re-visit each translated page. Verify:
- All UI text appears in Bangla
- No raw `t('key')` strings visible
- Forms, buttons, navigation still work
- No console errors

- [ ] **Step 5: Document any issues found**

Note any page where translation is missing or broken. Fix in follow-up tasks.

- [ ] **Step 6: Stop dev server**

Kill the background process.

---

## Task 53: Final cleanup and commit

- [ ] **Step 1: Check for unused keys**

Run: `cd web && npx tsc --noEmit 2>&1 | head -30`
Fix any TypeScript errors.

- [ ] **Step 2: Run lint**

Run: `cd web && npm run lint 2>&1 | tail -20`
Fix any lint errors.

- [ ] **Step 3: Update memory file**

Add to `~/.claude/projects/-Users-rahmatullahzisan-Desktop-Dev-hms/memory/`:
- Create `project_tenant_i18n_complete.md` with summary of what was done

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(i18n): complete Bangla coverage for tenant admin pages"
```

---

## Acceptance Criteria

- [ ] All 42 tenant pages have `useTranslation` calls
- [ ] All 6 new locale JSON files (en + bn) are populated
- [ ] `web/src/lib/i18n.ts` registers the 6 new namespaces
- [ ] `npx vitest run` passes
- [ ] Browser smoke test passes for all 42 pages in both en and bn
- [ ] No raw `t('key')` strings visible to end users
- [ ] Memory file updated
