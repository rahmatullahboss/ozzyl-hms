# Doctor Test Attribution and Drilldown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate referral, clinical ordering, data-entry and performer attribution while adding test commission visibility and doctor-wise test drilldowns to the executive dashboard.

**Architecture:** Add one nullable clinical-attribution column to `lab_orders` while preserving `ordered_by` as the audit user. Extend the existing legacy/canonical analytics contracts additively, build grouped detail queries on top of the same tenant/date/financial evidence, and update the existing doctor/test drawers without changing commission ownership or canonical feature flags.

**Tech Stack:** Cloudflare D1/SQLite migrations, TypeScript, Hono, Drizzle schema definitions, React, TanStack Query, Vitest, Testing Library, pnpm.

## Global Constraints

- Use local `main` as the reviewed base and implement in an isolated feature worktree.
- Preserve `lab_orders.ordered_by` as the user who entered the order; never reinterpret it as a doctor ID.
- Add only nullable, backward-compatible schema fields; the prior Worker must remain compatible during staged rollout.
- Do not alter referral commission ownership, commission percentages, waiver, payable, paid or outstanding amounts.
- Do not promote canonical reads, change shadow/strict flags or retire legacy financial authority.
- Ambiguous historical attribution must remain unassigned rather than guessed.
- All money remains major-unit BDT and all queries remain tenant/date scoped.
- Use TDD: each production behavior must have a failing test observed before implementation.
- Add English and Bangla labels together.

---

### Task 1: Add explicit ordering-clinician attribution to lab orders

**Files:**
- Create: `migrations/0534_lab_order_clinical_attribution.sql`
- Create: `test/lab-order-clinical-attribution-schema.test.ts`

`lab_orders` is a legacy raw-SQL table and has no Drizzle table definition in `src/db/schema/schema.ts`; the migration is the authoritative schema change.

**Interfaces:**
- Produces database column: `lab_orders.ordering_clinician_doctor_id INTEGER NULL`.
- Preserves `lab_orders.ordered_by` as the entered-by user ID.
- Produces index: `idx_lab_orders_ordering_clinician` on `(tenant_id, ordering_clinician_doctor_id, order_date)`.

- [x] **Step 1: Write the failing migration/schema test**

Create a test that loads the migration text and asserts the additive contracts:

```ts
expect(migration).toContain('ADD COLUMN ordering_clinician_doctor_id INTEGER');
expect(migration).toContain('idx_lab_orders_ordering_clinician');
expect(migration).not.toMatch(/UPDATE\s+lab_orders\s+SET\s+ordered_by/i);
```

Also execute the migration against an in-memory SQLite database containing `lab_orders`, `doctors` and duplicate-safe sample data. Assert:

```ts
expect(doctorCreated.ordering_clinician_doctor_id).toBe(41);
expect(receptionCreated.ordering_clinician_doctor_id).toBeNull();
expect(receptionCreated.ordered_by).toBe(9001);
```

Use an unambiguous same-tenant `doctors.user_id` match for the first row. Use a receptionist user with no doctor profile for the second row.

- [x] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm exec vitest run test/lab-order-clinical-attribution-schema.test.ts
```

Expected: FAIL because migration `0534` and the schema field do not exist.

- [x] **Step 3: Implement the additive migration**

Migration core:

```sql
ALTER TABLE lab_orders ADD COLUMN ordering_clinician_doctor_id INTEGER;

UPDATE lab_orders
SET ordering_clinician_doctor_id = (
  SELECT MIN(d.id)
  FROM doctors d
  WHERE d.tenant_id = lab_orders.tenant_id
    AND d.user_id = lab_orders.ordered_by
)
WHERE ordering_clinician_doctor_id IS NULL
  AND ordered_by IS NOT NULL
  AND (
    SELECT COUNT(*)
    FROM doctors d
    WHERE d.tenant_id = lab_orders.tenant_id
      AND d.user_id = lab_orders.ordered_by
  ) = 1;

CREATE INDEX IF NOT EXISTS idx_lab_orders_ordering_clinician
ON lab_orders (tenant_id, ordering_clinician_doctor_id, order_date);
```

Do not update `ordered_by`. Do not add a parallel Drizzle table for this legacy raw-SQL table.

- [x] **Step 4: Verify GREEN and migration manifest**

Run:

```bash
pnpm exec vitest run test/lab-order-clinical-attribution-schema.test.ts
pnpm build:migrations
```

Expected: schema test PASS and migration manifest generation succeeds.

- [x] **Step 5: Commit**

```bash
git add migrations/0534_lab_order_clinical_attribution.sql test/lab-order-clinical-attribution-schema.test.ts docs/superpowers/plans/2026-07-23-doctor-test-attribution-drilldown-implementation.md
git commit -m "feat(lab): add explicit ordering clinician attribution"
```

---

### Task 2: Correct all lab-order write paths

**Files:**
- Create: `src/lib/lab-order-attribution.ts`
- Create: `test/unit/lab-order-attribution.test.ts`
- Modify: `src/lib/prescription-lab-orders.ts`
- Modify: `src/routes/tenant/doctors.ts`
- Modify: `src/routes/tenant/prescriptions.ts`
- Modify: `src/routes/tenant/reception.ts`
- Modify: `src/routes/tenant/lab.ts`
- Modify: `src/routes/tenant/orderSets.ts`
- Modify: `test/lab-order-from-prescription.test.ts`
- Modify: `test/integration/routes/reception.test.ts`
- Modify: `test/integration/routes/final-round-5.test.ts`
- Modify: `test/order-sets.test.ts`

**Interfaces:**
- Produces:

```ts
export async function resolveOrderingClinicianDoctorId(
  db: D1Database,
  tenantId: string,
  input: { enteredByUserId: string | number | null; explicitDoctorId?: number | null },
): Promise<number | null>;
```

- `ensurePendingPrescriptionLabOrder` accepts:

```ts
orderingClinicianDoctorId?: number | null;
```

- Every insert keeps `ordered_by = enteredByUserId` and separately writes `ordering_clinician_doctor_id`.

- [x] **Step 1: Write failing resolver tests**

Cover:

```ts
it('prefers an explicit same-tenant doctor id');
it('maps an entered-by user only when exactly one same-tenant doctor profile exists');
it('returns null for a receptionist without a doctor profile');
it('returns null for ambiguous duplicate doctor profiles');
it('rejects an explicit doctor from another tenant');
```

- [x] **Step 2: Verify resolver tests fail**

Run:

```bash
pnpm exec vitest run test/unit/lab-order-attribution.test.ts
```

Expected: FAIL because the resolver does not exist.

- [x] **Step 3: Implement the minimal resolver**

Use tenant-scoped queries only. Explicit doctor ID is accepted only when an active doctor row exists in the same tenant. User mapping is accepted only when one row exists.

- [x] **Step 4: Write failing write-path tests**

Add route/helper tests proving:

```ts
// Doctor prescription
expect(order.ordered_by).toBe(doctorUserId);
expect(order.ordering_clinician_doctor_id).toBe(doctorId);

// Reception entry for a visit with a doctor
expect(order.ordered_by).toBe(receptionUserId);
expect(order.ordering_clinician_doctor_id).toBe(visitDoctorId);

// Reception/manual lab entry without clinical evidence
expect(order.ordered_by).toBe(receptionUserId);
expect(order.ordering_clinician_doctor_id).toBeNull();
```

- [x] **Step 5: Verify write-path tests fail**

Run:

```bash
pnpm exec vitest run test/unit/lab-order-attribution.test.ts test/lab-order-from-prescription.test.ts test/integration/routes/reception.test.ts test/integration/routes/final-round-5.test.ts test/order-sets.test.ts
```

Expected: FAIL because inserts do not write the new field.

- [x] **Step 6: Update insert paths**

Use the resolver before inserts. For prescription finalization, pass the known `doctorId`. For reception creation, pass `visit.doctor_id` only as explicit clinical evidence; keep the receptionist user ID in `ordered_by`. For manual lab/order-set creation, derive a clinician only from an explicit doctor or unambiguous linked doctor profile.

Example insert shape:

```sql
INSERT INTO lab_orders (
  order_no, patient_id, visit_id, ordered_by,
  ordering_clinician_doctor_id, order_date, tenant_id
) VALUES (?, ?, ?, ?, ?, ?, ?)
```

- [x] **Step 7: Verify GREEN**

Run:

```bash
pnpm exec vitest run test/unit/lab-order-attribution.test.ts test/lab-order-from-prescription.test.ts test/integration/routes/reception.test.ts test/integration/routes/final-round-5.test.ts test/order-sets.test.ts
```

Expected: all affected suites PASS.

- [x] **Step 8: Commit**

```bash
git add src/lib/lab-order-attribution.ts src/lib/prescription-lab-orders.ts src/routes/tenant/doctors.ts src/routes/tenant/prescriptions.ts src/routes/tenant/reception.ts src/routes/tenant/lab.ts src/routes/tenant/orderSets.ts test
git commit -m "fix(lab): separate clinical ordering from data entry"
```

---

### Task 3: Extend doctor detail attribution contracts

**Files:**
- Modify: `src/lib/executive-doctor-analytics.ts`
- Modify: `src/lib/canonical/reporting/executive-doctor-analytics.ts`
- Modify: `web/src/types/executiveDashboard.ts`
- Modify: `test/integration/executive-dashboard-analytics-sqlite.test.ts`
- Modify: `test/canonical/executive-doctor-analytics.test.ts`
- Modify: `test/canonical/doctor-analytics-provider.test.ts`
- Modify: `test/integration/routes/dashboard-doctor-performance.test.ts`

**Interfaces:**
- Replace ambiguous display use with additive fields:

```ts
orderingClinicianId: number | null;
orderingClinicianName: string | null;
enteredByUserId: number | null;
enteredByName: string | null;
performingDoctorId: number | null;
performingDoctorName: string | null;
```

- Keep legacy `orderingDoctorName` temporarily only if required for backward compatibility; new UI must not consume it.

- [x] **Step 1: Write failing analytics tests**

Build real SQLite fixtures for:

1. `ordered_by` points to a receptionist and `ordering_clinician_doctor_id` is null;
2. `ordered_by` points to a receptionist and explicit clinician points to a doctor;
3. doctor-created order has both clinician and entered-by identities;
4. referral attribution differs from ordering clinician;
5. performer accrual differs from referral accrual.

Assert:

```ts
expect(row.referringDoctorName).toBe('Dr Referrer');
expect(row.orderingClinicianName).toBeNull();
expect(row.enteredByName).toBe('Reception User');
expect(row.performingDoctorName).toBe('Dr Performer');
```

The second fixture must resolve `orderingClinicianName` to the explicit doctor while still returning the receptionist in `enteredByName`.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm exec vitest run test/integration/executive-dashboard-analytics-sqlite.test.ts test/canonical/executive-doctor-analytics.test.ts test/canonical/doctor-analytics-provider.test.ts test/integration/routes/dashboard-doctor-performance.test.ts
```

Expected: FAIL because explicit attribution fields are absent and generic users currently fall back into the ordering-doctor label.

- [x] **Step 3: Correct legacy SQL resolution**

Join clinician only through:

```sql
LEFT JOIN doctors ordering_clinician
  ON ordering_clinician.id = lo.ordering_clinician_doctor_id
 AND ordering_clinician.tenant_id = lo.tenant_id
LEFT JOIN users entered_by
  ON entered_by.id = lo.ordered_by
 AND entered_by.tenant_id = lo.tenant_id
```

Remove `users.name` fallback from the clinician value. Preserve referral attribution precedence and financial calculations unchanged. Resolve performer identity only from explicit performer/accrual evidence, excluding referral-only rows.

- [x] **Step 4: Align canonical provider contract**

Return the same additive fields. Where canonical evidence lacks a valid ordering clinician or entered-by identity, return null instead of copying the referring doctor into another semantic role.

- [x] **Step 5: Verify GREEN and provider parity**

Run:

```bash
pnpm exec vitest run test/integration/executive-dashboard-analytics-sqlite.test.ts test/canonical/executive-doctor-analytics.test.ts test/canonical/doctor-analytics-provider.test.ts test/integration/routes/dashboard-doctor-performance.test.ts
```

Expected: PASS with unchanged compensation totals.

- [x] **Step 6: Commit**

```bash
git add src/lib/executive-doctor-analytics.ts src/lib/canonical/reporting/executive-doctor-analytics.ts web/src/types/executiveDashboard.ts test
git commit -m "fix(dashboard): separate doctor test attribution roles"
```

---

### Task 4: Add a distinct performed-tests doctor detail view

**Files:**
- Modify: `src/lib/executive-doctor-analytics.ts`
- Modify: `src/lib/canonical/reporting/executive-doctor-analytics.ts`
- Modify: `src/routes/tenant/dashboard.ts`
- Modify: `web/src/types/executiveDashboard.ts`
- Modify: `web/src/components/dashboard/DoctorPerformanceDrawer.tsx`
- Modify: `web/src/components/dashboard/DoctorPerformanceDrawer.test.tsx`
- Modify: `test/integration/executive-dashboard-analytics-sqlite.test.ts`
- Modify: `test/integration/routes/dashboard-doctor-performance.test.ts`
- Modify: `test/canonical/executive-doctor-analytics.test.ts`

**Interfaces:**
- Extend doctor details tab type:

```ts
export type DoctorPerformanceDetailsTab =
  | 'visits'
  | 'tests' // backward-compatible alias for referred-tests
  | 'referred-tests'
  | 'performed-tests'
  | 'commissions';
```

- Details endpoint accepts explicit tab/view without mixing rows.

- [x] **Step 1: Write failing backend tests**

Assert a referral-only accrual appears only in `referred-tests`, and a performer accrual appears only in `performed-tests`. Assert grouped totals reconcile to the selected doctor's summary fields.

- [x] **Step 2: Verify backend RED**

Run:

```bash
pnpm exec vitest run test/integration/executive-dashboard-analytics-sqlite.test.ts test/integration/routes/dashboard-doctor-performance.test.ts test/canonical/executive-doctor-analytics.test.ts
```

Expected: FAIL because performed tests are not a separate view.

- [x] **Step 3: Implement performed-test query**

Use performer accrual or explicit performed-by evidence. Do not infer performer from referrer or entered-by user. Include patient, test, invoice, referring doctor, performer reserve/compensation and status.

- [x] **Step 4: Write failing drawer tests**

Assert tabs:

```ts
expect(screen.getByRole('tab', { name: 'Referred Tests' })).toBeInTheDocument();
expect(screen.getByRole('tab', { name: 'Performed Tests' })).toBeInTheDocument();
expect(screen.getByRole('tab', { name: 'Compensation Ledger' })).toBeInTheDocument();
```

Assert referred rows show `Ordering Clinician` and an expandable/secondary `Entered By`, and that a receptionist name is never rendered under `Ordering Clinician`.

- [x] **Step 5: Verify frontend RED**

Run:

```bash
pnpm --filter web exec vitest run src/components/dashboard/DoctorPerformanceDrawer.test.tsx
```

Expected: FAIL because performed tab and corrected labels are absent.

- [x] **Step 6: Implement the drawer tabs and columns**

Keep each tab's page state independent or reset page to 1 when switching. Provide independent loading/error/empty states. Render `Not recorded` for null clinician; render `Entered By` only as audit metadata.

- [x] **Step 7: Verify GREEN**

Run:

```bash
pnpm exec vitest run test/integration/executive-dashboard-analytics-sqlite.test.ts test/integration/routes/dashboard-doctor-performance.test.ts test/canonical/executive-doctor-analytics.test.ts
pnpm --filter web exec vitest run src/components/dashboard/DoctorPerformanceDrawer.test.tsx
```

Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add src/lib/executive-doctor-analytics.ts src/lib/canonical/reporting/executive-doctor-analytics.ts src/routes/tenant/dashboard.ts web/src/types/executiveDashboard.ts web/src/components/dashboard/DoctorPerformanceDrawer.tsx web/src/components/dashboard/DoctorPerformanceDrawer.test.tsx test
git commit -m "feat(dashboard): split referred and performed doctor tests"
```

---

### Task 5: Add doctor-wise test drilldown summaries

**Files:**
- Modify: `src/lib/executive-test-analytics.ts`
- Modify: `src/routes/tenant/dashboard.ts`
- Modify: `web/src/types/executiveDashboard.ts`
- Modify: `test/integration/executive-dashboard-analytics-sqlite.test.ts`
- Modify: `test/integration/routes/dashboard-test-performance.test.ts`
- Modify: `test/canonical/capture-reporting-route-evidence.test.ts`

**Interfaces:**
- Test detail view accepts the additive `view` query parameter and defaults to the current line-level response when omitted:

```ts
type TestDetailView = 'referred' | 'performed' | 'lines';
const view: TestDetailView = requestedView ?? 'lines';
```

- Referred grouped row:

```ts
{
  doctorId: number | null;
  doctorName: string;
  quantity: number;
  billed: number;
  collected: number;
  due: number;
  testCommission: number;
  discountedQuantity: number;
  discountAmount: number;
}
```

- Performed grouped row:

```ts
{
  doctorId: number | null;
  doctorName: string;
  quantity: number;
  performerReserve: number;
  completed: number;
  pending: number;
}
```

- [x] **Step 1: Write failing grouping tests**

Use fixtures where two doctors refer the same test, one doctor performs it, and one line is unassigned. Assert explicit unassigned rows and exact reconciliation:

```ts
expect(sum(referred.map(r => r.quantity))).toBe(lineTotals.quantity);
expect(sum(referred.map(r => r.testCommission))).toBe(lineTotals.testCommission);
expect(sum(performed.map(r => r.performerReserve))).toBe(lineTotals.performerReserve);
```

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm exec vitest run test/integration/executive-dashboard-analytics-sqlite.test.ts test/integration/routes/dashboard-test-performance.test.ts test/canonical/capture-reporting-route-evidence.test.ts
```

Expected: FAIL because grouped views do not exist.

- [x] **Step 3: Implement grouped queries**

Reuse the same selected-period line evidence as the existing detail endpoint. Group referral by resolved referral attribution and performer by explicit performer attribution. Return `Unassigned Referring Doctor` and `Unassigned Performing Doctor` rows instead of dropping null identities.

- [x] **Step 4: Add line-level attribution fields**

Extend `lines` rows with ordering clinician, entered by, performing doctor and performer reserve while preserving existing billed/collected/due/test commission fields.

- [x] **Step 5: Verify GREEN**

Run:

```bash
pnpm exec vitest run test/integration/executive-dashboard-analytics-sqlite.test.ts test/integration/routes/dashboard-test-performance.test.ts test/canonical/capture-reporting-route-evidence.test.ts
```

Expected: PASS, including tenant/date/pagination authorization cases.

- [x] **Step 6: Commit**

```bash
git add src/lib/executive-test-analytics.ts src/routes/tenant/dashboard.ts web/src/types/executiveDashboard.ts test
git commit -m "feat(dashboard): add doctor-wise test drilldowns"
```

---

### Task 6: Upgrade Test Performance drawer UI

**Files:**
- Modify: `web/src/components/dashboard/TestPerformanceDrawer.tsx`
- Modify: `web/src/components/dashboard/TestPerformanceDrawer.test.tsx`
- Modify: `web/src/types/executiveDashboard.ts`
- Modify: `web/public/locales/en/dashboard.json`
- Modify: `web/public/locales/bn/dashboard.json`

**Interfaces:**
- Drawer tabs: `Referred By`, `Performed By`, `All Test Lines`.
- Summary cards: quantity, billed, collected, due, test commission, referring doctor count, performing doctor count.

- [x] **Step 1: Write failing drawer tests**

Assert summary cards and all three tabs. Assert each tab calls the endpoint with the correct `view` and has independent empty/error states. Assert `All Test Lines` renders `Ordering Clinician`, `Entered By` and `Performing Doctor` separately.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter web exec vitest run src/components/dashboard/TestPerformanceDrawer.test.tsx
```

Expected: FAIL because current drawer only renders line rows.

- [x] **Step 3: Implement summary and tabs**

Use one selected test and period query. Keep page reset on test or tab change. Use horizontally scrollable tables and sticky identity columns. Add explanatory copy that referral, ordering, entry and performance are different roles.

- [x] **Step 4: Add English and Bangla copy**

Add matching keys for all new tab, role, empty-state and summary labels. Do not hard-code Bangla/English in the component where the dashboard already uses i18n.

- [x] **Step 5: Verify GREEN and locale validity**

Run drawer tests and parse the edited JSON locale files. Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add web/src/components/dashboard/TestPerformanceDrawer.tsx web/src/components/dashboard/TestPerformanceDrawer.test.tsx web/src/types/executiveDashboard.ts web/public/locales/en/dashboard.json web/public/locales/bn/dashboard.json
git commit -m "feat(dashboard): show test referral and performer evidence"
```

---

### Task 7: Show Test Commission in Doctor Performance

**Files:**
- Modify: `web/src/components/dashboard/DoctorPerformancePanel.tsx`
- Modify: `web/src/components/dashboard/DoctorPerformancePanel.test.tsx`

**Interfaces:**
- Column order must be exactly:

```text
Test Collection → Test Commission → Earned → Doctor Waiver → Payable → Paid → Outstanding
```

- Use existing `DoctorPerformanceRow.testCommission`; no backend calculation change.

- [x] **Step 1: Write failing column-order test**

Read the rendered column headers and assert the indexes:

```ts
expect(headers.indexOf('Test Commission')).toBe(headers.indexOf('Test Collection') + 1);
expect(headers.indexOf('Earned')).toBe(headers.indexOf('Test Commission') + 1);
```

Assert the row displays the fixture's formatted test commission value.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter web exec vitest run src/components/dashboard/DoctorPerformancePanel.test.tsx
```

Expected: FAIL because the column is absent.

- [x] **Step 3: Implement the minimal column**

Insert:

```tsx
<th className={plainHeader}>Test Commission</th>
```

immediately after `Test Collection`, and render:

```tsx
<td className={moneyCell}>{money(doctor.testCommission)}</td>
```

immediately before `Earned`. Do not add sorting unless both analytics providers support a reviewed doctor `testCommission` sort.

- [x] **Step 4: Verify GREEN**

Run the panel test and executive dashboard consumer suites. Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add web/src/components/dashboard/DoctorPerformancePanel.tsx web/src/components/dashboard/DoctorPerformancePanel.test.tsx
git commit -m "feat(dashboard): show doctor test commission"
```

---

### Task 8: Full regression, migration rehearsal and integration evidence

**Files:**
- Create: `docs/superpowers/progress/2026-07-23-doctor-test-attribution-drilldown-progress.md`
- Update implementation plan checkboxes as completed.

**Interfaces:**
- No new API 500s.
- No financial total drift.
- No canonical flag change.

- [x] **Step 1: Run focused backend suites**

Run all new schema, attribution, write-path and analytics tests. Expected: all PASS.

- [x] **Step 2: Run focused frontend suites**

Run Doctor Performance panel/drawer, Test Performance panel/drawer, admin/MD/director dashboard suites. Expected: all PASS.

- [x] **Step 3: Run project gates**

```bash
pnpm build:migrations
pnpm exec tsc --noEmit
pnpm canonical:check
pnpm test
pnpm build
```

Expected: all exit 0. Record exact file/test counts and any existing non-blocking warnings.

- [x] **Step 4: Rehearse migration on a production export clone**

Apply `0534` to a local copy of the production D1 export. Verify:

```sql
PRAGMA integrity_check;
PRAGMA foreign_key_check;
SELECT COUNT(*) FROM lab_orders;
SELECT COUNT(*) FROM lab_orders WHERE ordering_clinician_doctor_id IS NOT NULL;
SELECT COUNT(*) FROM lab_orders lo
WHERE lo.ordering_clinician_doctor_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM doctors d
    WHERE d.tenant_id = lo.tenant_id
      AND d.id = lo.ordering_clinician_doctor_id
  );
```

Expected: integrity `ok`, no new FK/orphan issue, row count unchanged, and only unambiguous doctor-linked users backfilled.

- [x] **Step 5: Review the complete diff**

Confirm no commission formula, settlement state, canonical feature flag or authority logic changed. Confirm receptionist names occur only in entered-by/audit fields.

- [x] **Step 6: Commit evidence**

```bash
git add docs/superpowers/plans/2026-07-23-doctor-test-attribution-drilldown-implementation.md docs/superpowers/progress/2026-07-23-doctor-test-attribution-drilldown-progress.md
git commit -m "docs(dashboard): record doctor test attribution verification"
```

- [x] **Step 7: Integrate into local main**

Fetch/review concurrent local `main` changes, merge without overwriting unrelated work, rerun focused tests on the merged tree, then fast-forward or create a reviewed merge commit. Do not push, migrate or deploy without explicit authorization.
