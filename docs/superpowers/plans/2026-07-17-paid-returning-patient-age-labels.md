# Paid Returning-Patient Eligibility and Patient Age Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make any positive doctor-visit payment qualify a patient for returning-patient pricing within the configured window and show patient age consistently in reception patient search/selection rows.

**Architecture:** Split appointment eligibility by appointment type. `report_show` retains the completed-visit/same-doctor query; `old_patient` uses a payment-backed consultation bill query. Frontend identity rows reuse existing age helpers and add an optional age segment without changing patient lookup APIs.

**Tech Stack:** TypeScript, Hono, Cloudflare D1/SQLite, React, Vitest, React Testing Library, pnpm.

## Global Constraints

- Work only in the isolated `task/paid-returning-patient-age-labels` worktree.
- Do not modify the dirty review workspace, push, deploy, or write production data.
- A qualifying returning-patient event requires `payments.amount > 0` against a non-cancelled OPD/doctor-visit consultation bill inside the configured eligibility period.
- Appointment/visit completion, prescription, and clinical-note state must not affect `old_patient` eligibility.
- `report_show` behavior must remain unchanged.
- Age is optional display metadata; missing age must not block patient selection.
- Follow TDD and make scoped commits.

---

### Task 1: Replace Returning-Patient Completed-Visit Guard with Positive-Payment Guard

**Files:**
- Modify: `src/routes/tenant/appointments.ts`
- Modify: `test/appointment-eligibility.test.ts`

**Interfaces:**
- Consumes: `evaluateAppointmentEligibility(d1, input)` and configured eligibility days.
- Produces: `old_patient` eligibility based on a positive consultation payment; unchanged `report_show` completed-visit behavior.

- [ ] **Step 1: Add failing positive-payment tests**

Add tests proving:
- a prior non-completed appointment with a paid doctor-visit bill qualifies;
- a positive partial payment qualifies;
- no payment, zero payment, cancelled/refunded-only payment, credit/due-only invoice, outside-window payment, wrong patient, and wrong tenant do not qualify;
- report-show still requires a completed same-doctor visit.

- [ ] **Step 2: Run the eligibility tests and verify RED**

Run:
```bash
pnpm exec vitest run test/appointment-eligibility.test.ts
```
Expected: positive-payment/non-completed scenario fails because the implementation queries only completed visits.

- [ ] **Step 3: Split the eligibility query by appointment type**

For `report_show`, keep the existing visit-status query.

For `old_patient`, query a prior consultation bill/payment chain using tenant and patient predicates, inclusive configured date boundaries, `b.status <> 'cancelled'`, consultation category evidence (`doctor_visit_bill > 0` or an active `invoice_items.item_category = 'doctor_visit'` row), and an `EXISTS` positive payment predicate:

```sql
EXISTS (
  SELECT 1
  FROM payments p
  WHERE p.tenant_id = b.tenant_id
    AND p.bill_id = b.id
    AND p.amount > 0
)
```

Do not accept `billing_status = 'paid'` without payment evidence, and do not require completed visit status.

- [ ] **Step 4: Run backend tests**

Run:
```bash
pnpm exec vitest run test/appointment-eligibility.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/tenant/appointments.ts test/appointment-eligibility.test.ts
git commit -m "fix(appointments): qualify returning patients by payment"
```

---

### Task 2: Show Age in Reception Patient Identity Rows

**Files:**
- Create: `web/src/lib/patientIdentity.ts`
- Create: `web/src/lib/patientIdentity.test.ts`
- Modify: `web/src/pages/ReceptionDashboard.tsx`
- Modify: `web/src/pages/BillingCounterPage.tsx`
- Modify: `web/src/pages/ReceptionDashboard.test.tsx`
- Modify: `web/src/pages/BillingCounterPage.test.ts`
- Verify: `web/src/components/reception/ReceptionTopBar.test.tsx`

**Interfaces:**
- Consumes: `buildPatientAgeLabel(age, dateOfBirth)` and `calculateAgeLabel(dateOfBirth)`.
- Produces: reception patient result rows containing optional age metadata next to patient code/mobile.

- [ ] **Step 1: Add failing UI tests**

Seed patients with age/date of birth and assert age appears in:
- test/service bill patient search;
- OPD serial patient search;
- IPD admission patient search;
- reception top-bar local search;
- reception top-bar global registry search;
- Billing Counter patient search and selected-patient label.

Also assert a patient with no age/date of birth renders normally without `undefined`, `null`, or an empty age badge.

- [ ] **Step 2: Run targeted frontend tests and verify RED**

Run:
```bash
pnpm --filter web exec vitest run src/pages/ReceptionDashboard.test.tsx src/components/reception/ReceptionTopBar.test.tsx
```
Expected: rows that currently show only code/mobile fail age assertions.

- [ ] **Step 3: Reuse the shared age helpers in every reception patient row**

Use the shared `formatPatientIdentityText` utility. It derives age from DOB first, falls back to stored age, and omits missing values. For each local patient row:

```ts
formatPatientIdentityText(patient, fallbackCode);
```

Render identity segments with separators only for present values:

```tsx
{formatPatientIdentityText(patient, fallbackCode)}
```

Top-bar global registry rows retain their existing DOB-derived age badge. Billing Counter imports the same shared formatter; it must not import the Reception Dashboard page.

- [ ] **Step 4: Run targeted frontend tests**

Run:
```bash
pnpm --filter web exec vitest run src/pages/ReceptionDashboard.test.tsx src/components/reception/ReceptionTopBar.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/patientIdentity.ts web/src/lib/patientIdentity.test.ts web/src/pages/ReceptionDashboard.tsx web/src/pages/BillingCounterPage.tsx web/src/pages/ReceptionDashboard.test.tsx web/src/pages/BillingCounterPage.test.ts
git commit -m "feat(reception): show age in patient search results"
```

---

### Task 3: Verification and Review

**Files:**
- No planned source files; fix only verified scoped defects.

**Interfaces:**
- Produces: clean feature branch with test evidence and review findings resolved.

- [ ] **Step 1: Run targeted regressions**

```bash
pnpm exec vitest run test/appointment-eligibility.test.ts
pnpm --filter web exec vitest run src/pages/ReceptionDashboard.test.tsx src/components/reception/ReceptionTopBar.test.tsx
```

- [ ] **Step 2: Run broader appointment/reception regressions**

Run the related appointment billing/payment tests and reception modal/top-bar suites discovered in the repository.

- [ ] **Step 3: Run TypeScript and production build**

```bash
pnpm build:migrations
pnpm exec tsc --noEmit
pnpm --filter web build
```

- [ ] **Step 4: Review adversarially**

Check:
- no completed-visit predicate remains in the `old_patient` path;
- no unpaid/credit-only row qualifies;
- payment, bill, patient, and tenant joins are correctly scoped;
- report-show behavior is unchanged;
- age is derived consistently and not duplicated or rendered as stale text;
- no unrelated UI or workflow changes are included.

- [ ] **Step 5: Run `git diff --check` and report exact commits/tests**
