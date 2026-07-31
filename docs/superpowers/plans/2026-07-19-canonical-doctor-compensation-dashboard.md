# Canonical Doctor Compensation Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate referral/prescriber commission and performer reserve in the executive doctor-performance dashboard while keeping totals backward compatible and canonical-ready.

**Architecture:** Normalize current legacy compensation tables into role-specific facts inside `executive-doctor-analytics.ts`. Read referral commission from non-performer commission accruals, read performer reserve directly from reserve facts, and expose a stable response contract that maps one-to-one to future canonical compensation roles. Update the dashboard table without requiring a database migration.

**Tech Stack:** TypeScript, Cloudflare D1/SQLite SQL, Hono, React, Vitest, Testing Library.

## Global Constraints

- Performer reserve must never be used to infer the referring/prescribing doctor.
- Full-discount performer reserve remains payable and visible.
- Unassigned performer reserve remains unassigned.
- `testCommission` remains backward compatible as total test compensation.
- No production schema migration is introduced.
- Historical settlements and cash drawers are not mutated.

---

### Task 1: Add role-specific analytics regression coverage

**Files:**
- Modify: `test/integration/executive-dashboard-analytics-sqlite.test.ts`
- Modify: `test/integration/routes/dashboard-doctor-performance.test.ts`

**Interfaces:**
- Consumes: `getDoctorPerformance(args)`.
- Produces: expected response fields `referrerCommission`, `performerReserveCount`, `performerReserve`, `testCommission`, and `totalCommission`.

- [ ] **Step 1: Extend the SQLite fixture schema**

Add `incentive_type` to `doctor_commission_accruals` and create a production-shaped `diagnostic_performer_reserves` table containing tenant, bill, assigned doctor, reserved amount, status, and reserve timestamps.

- [ ] **Step 2: Write a failing role-separation test**

Create a bill set containing:

```ts
// Referrer doctor: BDT 1,800 test collection, BDT 800 assigned reserves,
// expected percentage commission BDT 300 and total test compensation BDT 1,100.
// Full-discount reserve: BDT 200 and zero referrer commission.
// Unassigned reserve: BDT 200 under the unassigned row.
```

Assert:

```ts
expect(noorsali).toMatchObject({
  referrerCommission: 300,
  performerReserveCount: 4,
  performerReserve: 800,
  testCommission: 1100,
  totalCommission: 1300,
});
expect(unassigned).toMatchObject({
  performerReserveCount: 1,
  performerReserve: 200,
  testCommission: 200,
});
```

- [ ] **Step 3: Run the focused integration test and verify RED**

Run: `pnpm vitest run test/integration/executive-dashboard-analytics-sqlite.test.ts`

Expected: FAIL because the role-specific fields and reserve-table facts are not yet returned.

---

### Task 2: Implement canonical-ready role-specific analytics

**Files:**
- Modify: `src/lib/executive-doctor-analytics.ts`

**Interfaces:**
- Produces `DoctorPerformanceRow` fields:

```ts
referrerCommission: number;
performerReserveCount: number;
performerReserve: number;
testCommission: number; // referrerCommission + performerReserve
```

- [ ] **Step 1: Extend DB and public response types**

Add row metadata for role-specific values and their overall totals.

- [ ] **Step 2: Prevent performer-to-referrer attribution**

Update `bill_commission_doctors` and `referral_attribution` so test/referrer doctor resolution only considers `source_type = 'referral'` or `source_type = 'lab_test'` with `incentive_type <> 'performer'`.

- [ ] **Step 3: Add performer reserve facts**

Create CTEs that:

```sql
-- by bill: amount reserved before percentage calculation
-- by assigned doctor: count and amount for dashboard display
```

Include non-cancelled/non-reversed paid and reserved facts. Group null `assigned_doctor_id` as the unassigned practitioner row.

- [ ] **Step 4: Read immutable referrer entitlement once**

Exclude performer accrual rows. In the legacy adapter, normalize each non-performer accrual from its persisted calculation inputs (`commission base × rate − doctor waiver`, or its persisted flat amount); never use report-time collection. The future canonical adapter will populate the same field from canonical earned/adjusted snapshots. Do not add performer reserve rows inside this calculation.

- [ ] **Step 5: Reconcile totals**

Build `testCommission` as `referrerCommission + performerReserve`, and `totalCommission` as visit + test total + other. Include performer-only and unassigned rows in `doctor_keys`.

- [ ] **Step 6: Run integration test and verify GREEN**

Run: `pnpm vitest run test/integration/executive-dashboard-analytics-sqlite.test.ts`

Expected: all tests pass.

---

### Task 3: Render separate dashboard columns

**Files:**
- Modify: `web/src/types/executiveDashboard.ts`
- Modify: `web/src/components/dashboard/DoctorPerformancePanel.tsx`
- Modify: `web/src/components/dashboard/DoctorPerformancePanel.test.tsx`
- Modify: `web/src/components/dashboard/DoctorPerformanceDrawer.tsx`
- Modify: `web/src/components/dashboard/DoctorPerformanceDrawer.test.tsx`

**Interfaces:**
- Consumes the role-specific fields from `DoctorPerformanceResponse`.
- Preserves existing `testCommission` for total test compensation.

- [ ] **Step 1: Write failing component assertions**

Assert headers and row values for:

```text
Referrer Commission
Performer Tests
Performer Reserve
Test Total
```

- [ ] **Step 2: Run the focused web test and verify RED**

Run: `pnpm --dir web vitest run src/components/dashboard/DoctorPerformancePanel.test.tsx`

Expected: FAIL because the new headers are absent.

- [ ] **Step 3: Extend web response types**

Add `referrerCommission`, `performerReserveCount`, and `performerReserve` to `DoctorPerformanceRow`.

- [ ] **Step 4: Update table and drill-down presentation**

Replace the ambiguous `Test Commission` column with the four canonical-semantic columns. Increase the table minimum width while retaining horizontal scrolling and existing sorting. In test details, label the amount as `Referrer Commission`; in commission details, show the practitioner role and union reserve-ledger facts so reserve-only and unassigned items are visible without duplicating linked performer accruals.

- [ ] **Step 5: Run the focused web test and verify GREEN**

Run: `pnpm --dir web vitest run src/components/dashboard/DoctorPerformancePanel.test.tsx`

Expected: all component tests pass.

---

### Task 4: Verify production-shaped behavior and finish

**Files:**
- Review: all files changed by Tasks 1–3.

**Interfaces:**
- Confirms no migration and no write path changes.

- [ ] **Step 1: Run focused tests**

```bash
pnpm vitest run test/integration/executive-dashboard-analytics-sqlite.test.ts
pnpm --dir web vitest run src/components/dashboard/DoctorPerformancePanel.test.tsx
```

- [ ] **Step 2: Run TypeScript checks**

```bash
pnpm typecheck
pnpm --dir web typecheck
```

Use the repository's actual equivalent script if either command is not defined.

- [ ] **Step 3: Run production build**

Run: `pnpm build`

Expected: exit code 0.

- [ ] **Step 4: Review diff and invariants**

Verify:

```text
referrerCommission + performerReserve = testCommission
visitCommission + testCommission + otherCommission = totalCommission
performer rows never determine referrer attribution
no migration files added
```

- [ ] **Step 5: Commit the focused change**

```bash
git add docs/superpowers/specs/2026-07-19-canonical-doctor-compensation-dashboard-design.md \
  docs/superpowers/plans/2026-07-19-canonical-doctor-compensation-dashboard.md \
  src/lib/executive-doctor-analytics.ts \
  test/integration/executive-dashboard-analytics-sqlite.test.ts \
  web/src/types/executiveDashboard.ts \
  web/src/components/dashboard/DoctorPerformancePanel.tsx \
  web/src/components/dashboard/DoctorPerformancePanel.test.tsx
git commit -m "fix: separate canonical doctor compensation facts"
```
