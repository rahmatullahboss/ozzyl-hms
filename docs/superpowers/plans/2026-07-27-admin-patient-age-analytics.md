# Admin Patient Age Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans`. Follow TDD, tenant scoping, and server-side privacy enforcement.

**Goal:** Replace the inactive/redirected Patient Analytics surface with supported age-at-service analytics that show demand, services, doctors, departments, collections, and repeat visits by age group, while keeping patient identity behind `patients:read`.

**Architecture:** Add a focused patient-age reporting service under `src/services/dashboard/`. Calculate completed age using the service date from visit/admission/invoice-linked activity, not the patient’s current age. Return aggregate summaries without patient identity. Add a separately guarded detail endpoint for patient rows. Wire the existing `/h/:slug/analytics/patients` route to a real command-center Patients workspace or supported page instead of the current redirect.

**Tech Stack:** Hono/Cloudflare Workers, D1 SQL, TypeScript, React, React Query, Vitest, Testing Library.

## Global constraints

- Aggregate responses contain no patient name, code, phone, address, or clinical free text.
- Patient view requires `patients:read`; redaction is performed by the server.
- Age is calculated on service date.
- Invalid, null, future, or impossible dates of birth are grouped as `unknown`.
- Free-text age is never used to infer a date of birth.
- Visits, admissions, and services must have explicit declared grains to prevent duplicate joins.
- Existing patient and billing tables remain source of truth.
- The old `/api/admin/analytics/patients` call is removed; no compatibility endpoint is invented unless another verified consumer requires it.

---

## Task 1: Add age-at-service calculation and bucket tests

**Files:**

- Create: `src/services/dashboard/patientAge.ts`
- Create: `test/unit/patient-age.test.ts`
- Modify: `web/src/types/executiveDashboard.ts`

**Buckets:**

```ts
export type PatientAgeBucket =
  | '0_5'
  | '6_17'
  | '18_30'
  | '31_45'
  | '46_60'
  | '61_plus'
  | 'unknown';
```

- [ ] Test newborn/age zero.
- [ ] Test age 5 and 6 boundary.
- [ ] Test age 17 and 18 boundary.
- [ ] Test age 30 and 31 boundary.
- [ ] Test age 45 and 46 boundary.
- [ ] Test age 60 and 61 boundary.
- [ ] Test birthday on service date.
- [ ] Test day before birthday.
- [ ] Test leap-day birth date against leap and non-leap service dates.
- [ ] Test null, invalid, and future date of birth.
- [ ] Implement completed-year age and bucket helpers.

**Commit:**

```bash
git add src/services/dashboard/patientAge.ts test/unit/patient-age.test.ts web/src/types/executiveDashboard.ts
git commit -m "feat(patient-analytics): define age-at-service buckets"
```

---

## Task 2: Define aggregate analytics contract

**Files:**

- Create: `src/services/dashboard/patientAgeContract.ts`
- Create: `test/unit/patient-age-contract.test.ts`
- Modify: `web/src/types/executiveDashboard.ts`

**Response fields by bucket:**

- Unique patients
- Visits
- Admissions
- Services/tests
- Collection
- Average bill
- Repeat-visit rate
- Share of unique patients

- [ ] Test all seven buckets are returned in stable order, including zero rows.
- [ ] Test totals equal bucket sums for additive measures.
- [ ] Test average bill uses total collection divided by bill/visit grain defined by the contract.
- [ ] Test repeat-visit rate denominator is explicit and zero-safe.
- [ ] Test contract contains `service_date` and Asia/Dhaka metadata.
- [ ] Test no patient identity field exists in aggregate types.
- [ ] Implement response builders.

**Commit:**

```bash
git add src/services/dashboard/patientAgeContract.ts test/unit/patient-age-contract.test.ts web/src/types/executiveDashboard.ts
git commit -m "feat(patient-analytics): define aggregate reporting contract"
```

---

## Task 3: Build patient age summary service and endpoint

**Files:**

- Create: `src/services/dashboard/patientAgeAnalytics.ts`
- Create: `test/integration/routes/dashboard-patient-age-analytics.test.ts`
- Modify: `src/routes/tenant/dashboard.ts`

**Endpoint:**

```text
GET /dashboard/patient-age-analytics?startDate=...&endDate=...
```

**Source strategy:**

- Build one normalized service-activity grain from visits/consultations, admissions, and invoice/service lines.
- Deduplicate a patient’s same source fact with stable source identity.
- Aggregate unique patients separately from service quantity.
- Use service date, not payment date, for bucket assignment.
- Collection values may use linked payment allocation only when the source contract can attribute them safely; otherwise return collection with an explicit warning/data-source limitation.

- [ ] Test tenant scoping.
- [ ] Test service-date range boundaries.
- [ ] Test one patient with several services counts once in unique patients and several times in services.
- [ ] Test a patient can appear in different age buckets across historical periods when appropriate.
- [ ] Test visits and admissions do not duplicate invoice lines.
- [ ] Test unknown DOB count and warning.
- [ ] Test empty result.
- [ ] Test invalid and overlong period.
- [ ] Test response has no patient identity fields.
- [ ] Run and verify RED.
- [ ] Implement the reporting service with bound parameters.
- [ ] Add a thin route adapter.
- [ ] Run and verify GREEN.

**Commit:**

```bash
git add src/services/dashboard/patientAgeAnalytics.ts src/routes/tenant/dashboard.ts test/integration/routes/dashboard-patient-age-analytics.test.ts
git commit -m "feat(dashboard): add patient age analytics summary"
```

---

## Task 4: Add age-bucket aggregate drill views

**Files:**

- Modify: `src/services/dashboard/patientAgeAnalytics.ts`
- Create: `test/integration/routes/dashboard-patient-age-details.test.ts`
- Modify: `src/routes/tenant/dashboard.ts`

**Endpoint:**

```text
GET /dashboard/patient-age-analytics/details?ageBucket=18_30&view=services|doctors|departments&startDate=...&endDate=...
```

- [ ] Test service view: name, category, quantity, unique patients, collection.
- [ ] Test doctor view: stable doctor ID/name, visits/services, collection.
- [ ] Test department view: stable department ID/name, visits/services, collection.
- [ ] Test pagination and sorting allowlists.
- [ ] Test bucket filter uses age at each matching service date.
- [ ] Test no patient identity in aggregate drill views.
- [ ] Test summary/detail additive measures reconcile.
- [ ] Implement server-side grouping and pagination.

**Commit:**

```bash
git add src/services/dashboard/patientAgeAnalytics.ts src/routes/tenant/dashboard.ts test/integration/routes/dashboard-patient-age-details.test.ts
git commit -m "feat(dashboard): add age bucket aggregate drilldowns"
```

---

## Task 5: Add permission-gated patient detail view

**Files:**

- Modify: `src/services/dashboard/patientAgeAnalytics.ts`
- Modify: `src/routes/tenant/dashboard.ts`
- Create: `test/integration/routes/dashboard-patient-age-privacy.test.ts`

**Endpoint view:**

```text
view=patients
```

**Patient row:**

```ts
interface PatientAgeDetailRow {
  patientId: number;
  patientCode: string | null;
  patientName: string | null;
  ageAtService: number | null;
  bucket: PatientAgeBucket;
  latestServiceAt: string;
  visits: number;
  admissions: number;
  services: number;
  collection: number;
}
```

- [ ] Test caller with `patients:read` receives patient view.
- [ ] Test caller without `patients:read` receives HTTP 403 for `view=patients`.
- [ ] Test aggregate views remain available without patient detail permission.
- [ ] Test patient phone, address, national identifier, medical narrative, and clinical result are never returned.
- [ ] Test audit/log output excludes patient identity.
- [ ] Implement server-side permission check before patient query execution.

**Commit:**

```bash
git add src/services/dashboard/patientAgeAnalytics.ts src/routes/tenant/dashboard.ts test/integration/routes/dashboard-patient-age-privacy.test.ts
git commit -m "feat(dashboard): protect patient age detail identity"
```

---

## Task 6: Build Patients workspace summary UI

**Files:**

- Create: `web/src/pages/admin/command-center/workspaces/PatientsWorkspace.tsx` if not created by the shell plan; otherwise modify it
- Create: `web/src/pages/admin/command-center/workspaces/PatientsWorkspace.test.tsx`
- Create: `web/src/components/dashboard/PatientAgeSummary.tsx`
- Create: `web/src/components/dashboard/PatientAgeSummary.test.tsx`
- Modify: `web/src/hooks/useExecutiveDashboardAnalytics.ts`
- Modify: `web/src/lib/queryKeys.ts`

- [ ] Test selected period is sent to summary endpoint.
- [ ] Test all buckets render in stable order.
- [ ] Test horizontal bars/table communicate count and share without relying on color alone.
- [ ] Test unique patients, visits/services, collection, and average bill are visible.
- [ ] Test unknown DOB warning is visible.
- [ ] Test selecting a bucket updates URL state and opens details.
- [ ] Test loading, empty, unavailable, and retry states.
- [ ] Test no call to `/api/admin/analytics/patients`.
- [ ] Implement active-workspace-only query loading.

**Commit:**

```bash
git add web/src/pages/admin/command-center/workspaces/PatientsWorkspace.tsx web/src/pages/admin/command-center/workspaces/PatientsWorkspace.test.tsx web/src/components/dashboard/PatientAgeSummary.tsx web/src/components/dashboard/PatientAgeSummary.test.tsx web/src/hooks/useExecutiveDashboardAnalytics.ts web/src/lib/queryKeys.ts
git commit -m "feat(admin-dashboard): add patient age workspace"
```

---

## Task 7: Build age-bucket detail drawer

**Files:**

- Create: `web/src/components/dashboard/PatientAgeDetailDrawer.tsx`
- Create: `web/src/components/dashboard/PatientAgeDetailDrawer.test.tsx`
- Modify: `web/src/pages/admin/command-center/workspaces/PatientsWorkspace.tsx`
- Modify: `web/src/pages/admin/command-center/commandCenterUrlState.ts`
- Modify: `web/src/pages/admin/command-center/commandCenterUrlState.test.ts`

**Views:**

- Services
- Doctors
- Departments
- Patients, only when authorized

- [ ] Test direct `ageBucket` URL restoration.
- [ ] Test aggregate tabs do not show patient identity.
- [ ] Test patient tab is hidden or disabled when the API/permission state disallows it.
- [ ] Test a 403 patient response does not affect aggregate tabs.
- [ ] Test pagination and sorting.
- [ ] Test mobile uses stacked rows and no mandatory wide table.
- [ ] Test close restores focus and preserves period.

**Commit:**

```bash
git add web/src/components/dashboard/PatientAgeDetailDrawer.tsx web/src/components/dashboard/PatientAgeDetailDrawer.test.tsx web/src/pages/admin/command-center/workspaces/PatientsWorkspace.tsx web/src/pages/admin/command-center/commandCenterUrlState.ts web/src/pages/admin/command-center/commandCenterUrlState.test.ts
git commit -m "feat(admin-dashboard): add age bucket drilldown"
```

---

## Task 8: Activate the existing analytics route safely

**Files:**

- Modify: `web/src/App.tsx`
- Modify: `web/src/pages/analytics/PatientAnalytics.tsx`
- Modify: `web/src/pages/analytics/PatientAnalytics.test.tsx`
- Modify: `web/src/components/dashboard/adminSidebarConfig.tsx`
- Add or modify app route tests that cover `/h/:slug/analytics/patients`

**Decision:**

`/h/:slug/analytics/patients` becomes a tenant redirect to:

```text
/h/:slug/dashboard?tab=patients
```

The old standalone `PatientAnalytics.tsx` is removed if no remaining consumer imports it, or converted into a thin redirect component during compatibility migration.

- [ ] Test the route opens the Patients workspace.
- [ ] Test the sidebar link remains valid.
- [ ] Test no dead API request remains.
- [ ] Search imports before deletion.
- [ ] Remove obsolete code/tests only after route parity passes.

**Commit:**

```bash
git add web/src/App.tsx web/src/pages/analytics/PatientAnalytics.tsx web/src/pages/analytics/PatientAnalytics.test.tsx web/src/components/dashboard/adminSidebarConfig.tsx web/src/App*.test.tsx
git commit -m "refactor(admin-dashboard): route patient analytics to command center"
```

Stage only exact route test files modified.

---

## Task 9: Verification

- [ ] Run backend tests:

```bash
pnpm exec vitest run \
  test/unit/patient-age.test.ts \
  test/unit/patient-age-contract.test.ts \
  test/integration/routes/dashboard-patient-age-analytics.test.ts \
  test/integration/routes/dashboard-patient-age-details.test.ts \
  test/integration/routes/dashboard-patient-age-privacy.test.ts
```

- [ ] Run frontend tests:

```bash
pnpm --dir web exec vitest run \
  src/components/dashboard/PatientAgeSummary.test.tsx \
  src/components/dashboard/PatientAgeDetailDrawer.test.tsx \
  src/pages/admin/command-center/workspaces/PatientsWorkspace.test.tsx \
  src/pages/analytics/PatientAnalytics.test.tsx
```

- [ ] Run root/web typecheck and web build.
- [ ] Verify every age boundary fixture manually against completed-year expectation.
- [ ] Inspect API JSON to confirm aggregate responses contain no identity.
- [ ] Verify `view=patients` is denied without `patients:read` before querying identity rows.
- [ ] Verify old dead endpoint usage is absent with repository search.
- [ ] Inspect scoped diff.

## Completion evidence

- Patient age analytics is a supported routed feature.
- Age is calculated on service date.
- Seven stable buckets include Unknown.
- Aggregate drilldowns reveal services/doctors/departments without patient identity.
- Patient rows require `patients:read`.
- The old nonexistent `/api/admin/analytics/patients` dependency is removed.
