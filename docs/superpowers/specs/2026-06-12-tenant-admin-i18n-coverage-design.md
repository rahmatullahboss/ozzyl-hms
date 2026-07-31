# Tenant Admin Pages i18n Coverage — Design

**Date:** 2026-06-12
**Status:** Approved (user confirmed all 5 sections)

## Goal

Translate all tenant/hospital admin pages to Bangla (`bn`) so that hospital admins using the system in Bangla see a fully translated UI. The pages under `web/src/pages/admin/` (platform admin / super admin) are out of scope for this design.

## Scope

- **In scope:** All pages under `web/src/pages/` (root level and subdirectories: `accounting/`, `doctor/`, `inventory/`, `pharmacy/`, `analytics/`, `marketplace/`) — i.e. tenant-facing pages.
- **Out of scope:** `web/src/pages/admin/` (platform admin), `web/src/pages/__tests__/`, and any `.test.tsx` files in the page directories.

22 root-level tenant pages were identified as having no `useTranslation` and contain hardcoded English. Many more already use translation and may need key additions.

## Architecture

Add 6 new locale namespaces grouped by tenant functional area:

| Namespace             | Coverage                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| `tenantDashboard`     | HospitalAdminDashboard, ReceptionDashboard, DoctorDashboard, LabDashboard, PharmacyDashboard, etc.      |
| `tenantBilling`       | BillingCounter, BillingMaster, BillingReports, BillPrint, BillCancellation, BillingHandover, etc.        |
| `tenantClinical`      | AdmissionIPD, PatientList, PatientDetail, DischargeSummary, NurseWorkload, etc.                         |
| `tenantLab`           | LaboratoryDashboard, LabSettings, LabReportPrint, TestCatalog, etc.                                     |
| `tenantPharmacy`      | PharmacyDashboard, and other pharmacy-root pages                                                        |
| `tenantAdmin`         | SettingsPage, PermissionManagement, DepartmentSettings, ApprovalCenter, AdminModuleCatalog, etc.        |

Each namespace has both `en` and `bn` JSON files at `web/public/locales/{en,bn}/{namespace}.json`.

**i18n registration:** Update `web/src/lib/i18n.ts` `ns:` array to add the 6 new namespaces.

## Component & Data Flow

**Pattern per page** (matches existing `AlertsExceptions.tsx`):
```tsx
import { useTranslation } from 'react-i18next';
const { t } = useTranslation(['tenantBilling']);
// or useTranslation('tenantBilling') — single namespace
```

**Translation key naming convention:**
- Flat keys (matches existing `superAdmin.json` style): `dashboardTitle`, `totalHospitals`
- Grouped by area prefix where helpful: `billing.invoiceTitle`, `lab.testName`
- Interpolation for dynamic values: `{{count}} items`, `{{name}} updated`

**Per-page workflow:**
1. Read each tenant `.tsx` file
2. Extract all hardcoded English UI strings (labels, titles, placeholders, button text, empty states, error messages)
3. Skip: data values from API, prop types, console logs, comments, route paths
4. Add t() call wrapping each string
5. Add key to appropriate JSON file
6. Add Bangla translation in `bn/*.json`

**String categorization per file:**
- Page title / heading
- Section headers
- Table column headers
- Button labels
- Empty state messages
- Filter/tab labels
- Status badges
- Form labels and placeholders
- Toast/alert messages

## Error Handling

**Missing key fallback:**
- i18next falls back to `en` when `bn` key is missing (`fallbackLng: 'en'` in `i18n.ts`)
- A missing key renders the raw key in dev (e.g., `billing.invoiceTitle`) — this is a smoke-test signal

**Test files (.test.tsx):**
- Many tenant pages have `.test.tsx` files
- If they look for English text, they'll break after translation
- **Solution:** Update affected tests to use `i18n.changeLanguage('en')` before assertions, or check for translation key strings
- Existing i18n-mock pattern at `web/src/test/i18n-mock.ts` already supports this

**Build-time check:**
- TypeScript catches wrong-namespace `t()` calls
- Missing keys are runtime errors (silent fallback) — manual smoke test catches these

**Empty translation handling:**
- If a `bn` key is missing, the page renders in `en` — visible to bn users as a partial translation
- Cross-check that every `en/*.json` key has a corresponding `bn/*.json` key before finishing

## Testing

**Per user choice: Smoke test each page in browser (load, switch language, verify).**

**Manual smoke test workflow:**
1. Start dev server: `cd web && npm run dev`
2. Open `http://localhost:5173` in browser
3. Log in as admin
4. Visit each translated page → confirm English renders correctly
5. Open language switcher → select "বাংলা" (Bangla)
6. Re-visit each translated page → confirm Bangla renders
7. Check `localStorage.hms_language` = `'bn'`
8. Toggle back to English → confirm keys with no bn translation fall back to en gracefully

**What to verify per page:**
- No raw `t('key')` strings visible (means a key is missing)
- All buttons, labels, headers translated
- Numbers/dates still format correctly
- Forms still submit
- No console errors

**Existing test compatibility:**
- Run `cd web && npx vitest run` after changes
- Fix any failing tests by updating assertions to use translation keys instead of literal strings

**No new automated tests added** (per user choice).

## Implementation Order

**Phase 1: Setup (foundation)**
1. Create 6 new locale JSON files (en + bn for each)
2. Register namespaces in `web/src/lib/i18n.ts`

**Phase 2: Translate tenant pages in this order (highest impact first):**
1. `HospitalAdminDashboard.tsx` + any untranslated widgets — most visible page
2. `BillingCounterPage.tsx` + `BillingMasterPage.tsx` — high traffic
3. `PatientList.tsx` + `PatientDetail.tsx` — daily use
4. `AdmissionIPD.tsx` + `DischargeSummary.tsx`
5. `LaboratoryDashboard.tsx` + `PharmacyDashboard.tsx`
6. `ReceptionDashboard.tsx` + `BillingReportsPage.tsx`
7. The 22 hardcoded pages identified at design time (from the initial scan)
8. Anything else with missing keys (caught during smoke test — likely more pages in accounting/, doctor/, inventory/, pharmacy/ subdirectories)

**Phase 3: Verification**
1. Run `cd web && npx vitest run` to catch broken tests
2. Fix any tests that hardcode English
3. Browser smoke test (15-20 min): open each translated page, switch language, verify
4. Commit with conventional message: `feat(i18n): translate tenant admin pages to Bangla`

**Phase 4: Final cleanup**
- Cross-check that every `en/*.json` key has a `bn/*.json` key
- Remove any unused keys
- Update memory file with what was done
