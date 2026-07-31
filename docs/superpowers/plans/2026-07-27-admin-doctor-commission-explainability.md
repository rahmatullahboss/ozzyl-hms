# Admin Doctor and Commission Explainability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans`. Follow TDD and the canonical compensation cutover rules.

**Goal:** Improve the existing doctor-performance implementation so an administrator can move from doctor summary to responsive activity, visit/test evidence, the full commission calculation bridge, and the linked invoice without reading extremely wide tables or guessing why a commission is zero.

**Architecture:** Extend the existing doctor-performance services and contracts rather than building a second doctor report. Add a composed activity timeline endpoint, explicit reason codes, stable bill links, overall reconciliation, and rule snapshot exposure. Preserve legacy/canonical provider selection. Store missing historical rule-version snapshots additively for newly created accruals; never backfill a guessed version.

**Tech Stack:** Cloudflare Workers, D1/Drizzle migrations, TypeScript, React, React Query, Vitest, Testing Library.

## Global constraints

- `doctor_commission_accruals` and canonical compensation facts remain authoritative.
- The browser never recalculates commission.
- `earned`, `waiver`, `payable`, `paid`, and `outstanding` remain separate.
- Performer reserve remains a distinct source/role.
- Referring, ordering, entering, performing, and verifying identities remain separate.
- Historical rule version is never inferred from the current rule.
- Zero commission rows must have an explicit reason code when the source can provide one.
- Existing Commission Management settlement actions remain outside this dashboard plan.
- Every invoice-bearing row exposes `billId` and opens the shared invoice inspector when that plan is available; until then it may use the existing invoice modal adapter.

---

## Task 1: Extend doctor contracts with reconciliation, activity, and explanation fields

**Files:**

- Modify: `web/src/types/executiveDashboard.ts`
- Create: `src/services/dashboard/doctorReportingContract.ts`
- Create: `test/unit/doctor-reporting-contract.test.ts`

**Interfaces:**

```ts
export type CommissionReasonCode =
  | 'rule_matched'
  | 'no_matching_rule'
  | 'doctor_missing'
  | 'bill_unpaid'
  | 'cancelled'
  | 'refunded'
  | 'eligible_base_zero'
  | 'doctor_waived'
  | 'manual_adjustment'
  | 'reversal'
  | 'held_for_review';
```

Add to doctor summary/details:

- `lastActivityAt`
- `lastActivityType`
- `billId` on invoice-bearing detail rows
- `ruleId`
- `ruleVersion`
- `adjustmentAmount`
- `reasonCode`
- `reasonLabel`
- reconciliation metadata

- [ ] Test reason-code label mapping.
- [ ] Test unknown internal statuses map to `held_for_review`, not an invented successful reason.
- [ ] Test commission bridge arithmetic validation.
- [ ] Test null historical rule version remains null with a warning.
- [ ] Implement pure mapping/validation helpers.

**Commit:**

```bash
git add web/src/types/executiveDashboard.ts src/services/dashboard/doctorReportingContract.ts test/unit/doctor-reporting-contract.test.ts
git commit -m "feat(doctor-reporting): define explainable compensation contract"
```

---

## Task 2: Snapshot legacy commission rule version for new accruals

**Files:**

- Create: `migrations/0570_doctor_commission_rule_version_snapshot.sql`; stop and renumber before editing if `0553` has been claimed on the implementation base
- Modify: `src/db/schema/finance.ts`
- Modify the existing commission-accrual creation service in `src/routes/tenant/commissions.ts` or its extracted service owner
- Modify: `test/doctor-commission-routes.test.ts`
- Create: `test/migrations/doctor-commission-rule-version-snapshot.test.ts`

**Schema:**

Add nullable:

```text
commission_rule_version_snapshot INTEGER
commission_reason_code TEXT
```

Rules:

- New matched-rule accruals store the rule version available at creation.
- Existing rows remain null; no current-rule guess is backfilled.
- New no-payable/zero rows store the exact supported reason code where an accrual/fact row exists.
- Canonical compensation continues to use its existing rule-version facts.

- [ ] Test a matched legacy accrual stores `commission_rule_id` and version snapshot.
- [ ] Test no-rule/held cases store reason code where the current workflow records a fact.
- [ ] Test existing null snapshots remain readable.
- [ ] Test migration checks only allowed reason codes.
- [ ] Build migration manifest.
- [ ] Run focused commission route tests.

**Commit:**

```bash
git add migrations/0570_doctor_commission_rule_version_snapshot.sql src/db/schema/finance.ts src/routes/tenant/commissions.ts test/doctor-commission-routes.test.ts test/migrations/doctor-commission-rule-version-snapshot.test.ts
git commit -m "feat(compensation): snapshot commission rule explanation"
```

Do not use bulk staging in a dirty worktree; stage the exact migration and exact test files created by the implementation.

---

## Task 3: Extend doctor-performance summary reconciliation

**Files:**

- Create: `src/services/dashboard/doctorPerformance.ts` by extracting the existing doctor query ownership from `src/routes/tenant/dashboard.ts`
- Modify: `src/routes/tenant/dashboard.ts`
- Modify: `test/integration/routes/dashboard-doctor-performance.test.ts`
- Modify: `test/integration/routes/dashboard-doctor-compensation-details.test.ts`

- [ ] Test total visit collection equals all matching visit detail rows.
- [ ] Test test collection reconciliation.
- [ ] Test payable and paid commission reconciliation.
- [ ] Test `lastActivityAt` and type are selected without an N+1 query.
- [ ] Test unassigned doctor rows remain stable.
- [ ] Test canonical/legacy provider metadata is preserved.
- [ ] Test pagination does not change overall totals.
- [ ] Extract service logic and keep route handlers thin.
- [ ] Return overall reconciliation envelopes.

**Commit:**

```bash
git add src/services/dashboard/doctorPerformance.ts src/routes/tenant/dashboard.ts test/integration/routes/dashboard-doctor-performance.test.ts test/integration/routes/dashboard-doctor-compensation-details.test.ts
git commit -m "refactor(dashboard): reconcile doctor performance service"
```

---

## Task 4: Add doctor activity timeline endpoint

**Files:**

- Create: `src/services/dashboard/doctorActivity.ts`
- Create: `test/integration/routes/dashboard-doctor-activity.test.ts`
- Modify: `src/routes/tenant/dashboard.ts`

**Endpoint:**

```text
GET /dashboard/doctor-performance/activity?doctorId=17&startDate=...&endDate=...&page=1&pageSize=50
```

**Sources:**

- Visits/consultation invoice items
- Referred tests
- Performed/verified diagnostic facts when recorded
- Commission accruals
- Waiver/adjustment facts
- Settlements
- Cancellation/refund/reversal audit facts

- [ ] Test events are sorted by occurrence time descending.
- [ ] Test source IDs produce stable event IDs.
- [ ] Test duplicate joins do not duplicate an event.
- [ ] Test bill ID and invoice number are returned when available.
- [ ] Test patient identity is redacted when the caller lacks `patients:read`.
- [ ] Test source rows without patient identity still remain visible.
- [ ] Test invalid doctor ID and period validation.
- [ ] Implement a UNION/read-model service with bound tenant/period parameters.

**Commit:**

```bash
git add src/services/dashboard/doctorActivity.ts src/routes/tenant/dashboard.ts test/integration/routes/dashboard-doctor-activity.test.ts
git commit -m "feat(dashboard): add doctor activity timeline"
```

---

## Task 5: Extend commission detail explanation

**Files:**

- Modify: `src/services/dashboard/doctorPerformance.ts`
- Modify: `test/integration/routes/dashboard-doctor-compensation-details.test.ts`
- Modify: `test/integration/routes/dashboard-management-kpis.test.ts`

- [ ] Test detail rows include `billId`.
- [ ] Test legacy rows expose stored `commissionRuleId` and nullable version snapshot.
- [ ] Test canonical rows expose canonical rule ID/version.
- [ ] Test `adjustmentAmount` includes immutable settlement/adjustment facts only.
- [ ] Test doctor waiver reason code.
- [ ] Test cancelled, reversed, unpaid, and zero-base reason codes.
- [ ] Test no row is labeled `rule_matched` when no rule identity exists and payable is zero for another reason.
- [ ] Test compensation detail total reconciles to summary payable or selected measure, with the measure named explicitly.
- [ ] Implement mapping in the server service; do not derive reason codes from display text.

**Commit:**

```bash
git add src/services/dashboard/doctorPerformance.ts test/integration/routes/dashboard-doctor-compensation-details.test.ts test/integration/routes/dashboard-management-kpis.test.ts
git commit -m "feat(dashboard): explain doctor commission calculations"
```

---

## Task 6: Make doctor summary responsive

**Files:**

- Modify: `web/src/components/dashboard/DoctorPerformancePanel.tsx`
- Modify or create: `web/src/components/dashboard/DoctorPerformancePanel.test.tsx`
- Create: `web/src/components/dashboard/DoctorPerformanceRowDetails.tsx`
- Modify: `web/src/pages/admin/command-center/workspaces/DoctorsWorkspace.tsx`

- [ ] Test priority desktop columns: Doctor, Visits, Referred, Performed, Collection, Payable, Paid, Outstanding, Last activity.
- [ ] Test secondary values are available in expandable detail.
- [ ] Test mobile renders card/expandable rows without a 1,800 px minimum table.
- [ ] Test sortable headers expose `aria-sort`.
- [ ] Test doctor link updates URL `doctorId`.
- [ ] Preserve server-side sorting and pagination.
- [ ] Implement responsive priority fields and progressive disclosure.

**Commit:**

```bash
git add web/src/components/dashboard/DoctorPerformancePanel.tsx web/src/components/dashboard/DoctorPerformancePanel.test.tsx web/src/components/dashboard/DoctorPerformanceRowDetails.tsx web/src/pages/admin/command-center/workspaces/DoctorsWorkspace.tsx
git commit -m "refactor(admin-dashboard): make doctor performance responsive"
```

---

## Task 7: Rework doctor detail drawer navigation

**Files:**

- Modify: `web/src/components/dashboard/DoctorPerformanceDrawer.tsx`
- Modify or create: `web/src/components/dashboard/DoctorPerformanceDrawer.test.tsx`
- Create: `web/src/components/dashboard/DoctorActivityTimeline.tsx`
- Create: `web/src/components/dashboard/DoctorActivityTimeline.test.tsx`
- Create: `web/src/components/dashboard/CommissionCalculationBridge.tsx`
- Create: `web/src/components/dashboard/CommissionCalculationBridge.test.tsx`

**Tabs:**

- Summary
- Activity
- Visits
- Referred Tests
- Performed Tests
- Compensation

- [ ] Test Activity loads only when selected.
- [ ] Test invoice references call the invoice-open callback with `billId`.
- [ ] Test the compensation bridge displays gross, discount, reserve, base, rate/rule, earned, waiver, adjustment, payable, paid, and outstanding.
- [ ] Test reason code and reason label are visible.
- [ ] Test unknown rule version displays “Historical rule version not recorded” rather than a guessed value.
- [ ] Test mobile detail uses stacked rows instead of a 2,750–3,000 px table.
- [ ] Test focus restoration and Escape close behavior remain intact.
- [ ] Implement without duplicating backend arithmetic.

**Commit:**

```bash
git add web/src/components/dashboard/DoctorPerformanceDrawer.tsx web/src/components/dashboard/DoctorPerformanceDrawer.test.tsx web/src/components/dashboard/DoctorActivityTimeline.tsx web/src/components/dashboard/DoctorActivityTimeline.test.tsx web/src/components/dashboard/CommissionCalculationBridge.tsx web/src/components/dashboard/CommissionCalculationBridge.test.tsx
git commit -m "feat(admin-dashboard): add doctor activity and commission bridge"
```

---

## Task 8: Integrate invoice opening

**Files:**

- Modify: `web/src/pages/admin/command-center/workspaces/DoctorsWorkspace.tsx`
- Modify: `web/src/components/dashboard/DoctorPerformanceDrawer.tsx`
- Modify relevant tests

- [ ] Before the shared invoice inspector lands, pass the existing invoice-modal adapter from the command-center shell.
- [ ] After the inspector plan lands, update only the adapter so doctor components remain inspector-agnostic.
- [ ] Test visits, tests, activity, and compensation invoice links all open the same bill ID.
- [ ] Test rows without bill ID are not falsely interactive.

**Commit:**

```bash
git add web/src/pages/admin/command-center/workspaces/DoctorsWorkspace.tsx web/src/components/dashboard/DoctorPerformanceDrawer.tsx web/src/components/dashboard/DoctorPerformanceDrawer.test.tsx
git commit -m "feat(admin-dashboard): link doctor evidence to invoices"
```

---

## Task 9: Verification

- [ ] Build migration manifest if Task 2 changed schema.
- [ ] Run backend tests:

```bash
pnpm exec vitest run \
  test/unit/doctor-reporting-contract.test.ts \
  test/doctor-commission-routes.test.ts \
  test/integration/routes/dashboard-doctor-performance.test.ts \
  test/integration/routes/dashboard-doctor-compensation-details.test.ts \
  test/integration/routes/dashboard-doctor-activity.test.ts \
  test/integration/routes/dashboard-management-kpis.test.ts
```

- [ ] Run frontend tests:

```bash
pnpm --dir web exec vitest run \
  src/components/dashboard/DoctorPerformancePanel.test.tsx \
  src/components/dashboard/DoctorPerformanceDrawer.test.tsx \
  src/components/dashboard/DoctorActivityTimeline.test.tsx \
  src/components/dashboard/CommissionCalculationBridge.test.tsx
```

- [ ] Run root/web typecheck and web build.
- [ ] Verify no current-rule version was applied to historical null rows.
- [ ] Verify patient redaction server-side.
- [ ] Verify every invoice-bearing row contains a stable bill ID.
- [ ] Inspect scoped diff and migration numbering.

## Completion evidence

- Doctor summary is readable without a 1,800 px table.
- Activity timeline exists.
- Full commission bridge and reason are visible.
- Historical rule limitations are explicit.
- Every valid doctor invoice reference opens the common invoice viewer.
- Summary/detail reconciliation is visible.
