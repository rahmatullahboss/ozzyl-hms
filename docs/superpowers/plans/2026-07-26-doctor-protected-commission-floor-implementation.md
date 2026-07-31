# Doctor Protected Commission Floor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add doctor/service-specific protected commission floors so doctor-authorized waiver cannot reduce payable commission below the configured floor, with one calculation contract projected consistently into legacy and canonical ledgers.

**Architecture:** A pure shared waiver-policy calculator resolves protected amount, waiver capacity, applied waiver, payable, and overflow from the resolved doctor commission rule. Legacy billing remains the operational write authority, while the existing strict dual-write path receives the same calculated snapshot and stores equivalent canonical rule/accrual evidence. Existing rules default to `full_earned`, preserving current behavior until a hospital explicitly creates or updates a protected-floor rule.

**Tech Stack:** TypeScript, Hono, Zod, Cloudflare D1, Drizzle schema declarations, Vitest, React.

## Global Constraints

- Base all work on reviewed local `main` in `feature/doctor-protected-commission-floor-20260726`.
- Do not touch the unrelated dirty root checkout.
- Existing rules must remain `full_earned` after migration.
- The same resolved doctor/service rule must provide both commission rate and waiver policy.
- `protected_floor` percentage values are basis points and may not exceed the commission rate.
- `protected_floor` flat values may not exceed the flat commission amount.
- `no_doctor_waiver` protects the full earned commission.
- Legacy and canonical accruals must receive the same earned, protected, waived, and payable values.
- Zero-payable accruals must remain auditable.
- No production migration, deployment, push, or feature-flag mutation is authorized.

---

### Task 1: Shared protected-floor calculation contract

**Files:**
- Create: `src/lib/doctor-commission-waiver-policy.ts`
- Create: `test/doctor-commission-waiver-policy.test.ts`

**Interfaces:**
- Produces: `DoctorCommissionWaiverPolicy`, `normalizeDoctorCommissionWaiverPolicy`, and `calculateDoctorCommissionWaiver(input)`.
- `calculateDoctorCommissionWaiver` returns `earnedCommissionAmount`, `protectedCommissionAmount`, `maximumWaiverAmount`, `requestedWaiverAmount`, `doctorWaiverAmount`, `payableCommissionAmount`, and `overflowWaiverAmount`.

- [ ] **Step 1: Write failing percentage-floor tests**

```ts
expect(calculateDoctorCommissionWaiver({
  commissionBaseAmount: 1000,
  earnedCommissionAmount: 250,
  rateType: 'percent',
  waiverPolicy: 'protected_floor',
  protectedRateBps: 500,
  requestedWaiverAmount: 500,
})).toMatchObject({
  protectedCommissionAmount: 50,
  maximumWaiverAmount: 200,
  doctorWaiverAmount: 200,
  payableCommissionAmount: 50,
  overflowWaiverAmount: 300,
});
```

- [ ] **Step 2: Run red test**

Run: `pnpm vitest run test/doctor-commission-waiver-policy.test.ts`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement minimal pure calculator**

Implement explicit behavior for `full_earned`, `protected_floor`, and `no_doctor_waiver`, money rounding, and protected amount capping at earned commission.

- [ ] **Step 4: Add validation tests**

Cover protected basis points greater than commission rate, protected flat amount greater than flat commission, negative values, and legacy defaults.

- [ ] **Step 5: Run green test and commit**

Run: `pnpm vitest run test/doctor-commission-waiver-policy.test.ts`
Commit: `feat(commission): add protected waiver calculation contract`

### Task 2: Legacy and canonical schema snapshots

**Files:**
- Create: `migrations/0539_doctor_protected_commission_floor.sql`
- Modify: `src/db/schema/finance.ts`
- Modify: `tenant-schema.sql`
- Modify: `migrations/0513_canonical_practitioner_compensation.sql` only if the repository's canonical fresh-schema generation requires historical source updates; otherwise leave historical migration immutable and put all runtime changes in `0539`.
- Test: `test/canonical/schema-contract.test.ts` or the closest existing migration contract test.

**Interfaces:**
- Legacy rule columns: `waiver_policy`, `protected_rate_bps`, `protected_flat_amount`.
- Legacy accrual snapshot columns: `waiver_policy_snapshot`, `protected_rate_bps_snapshot`, `protected_flat_amount_snapshot`, `protected_commission_amount`, `maximum_waiver_amount`, `requested_waiver_amount`, `hospital_funded_overflow_amount`.
- Canonical rule columns: `waiver_policy`, `protected_rate_value`.
- Canonical accrual columns: `protected_minor`, `waiver_capacity_minor`, `requested_waiver_minor`, `hospital_funded_overflow_minor`.

- [ ] **Step 1: Add a failing migration/schema contract assertion**

Assert the new migration contains every legacy and canonical column and defaults existing rules to `full_earned`.

- [ ] **Step 2: Run red schema test**

Run the focused canonical/migration contract test and verify the missing columns cause failure.

- [ ] **Step 3: Add migration and Drizzle declarations**

Use additive `ALTER TABLE` statements with non-null defaults. Add indexes only when required for lookup; do not duplicate existing rule indexes.

- [ ] **Step 4: Update fresh tenant baseline**

Add the same legacy columns to the fresh-install schema while preserving existing table constraints.

- [ ] **Step 5: Run migration build/governance checks and commit**

Run: `pnpm build:migrations`
Run: `pnpm canonical:check`
Commit: `feat(database): add protected commission snapshots`

### Task 3: Rule API validation and persistence

**Files:**
- Modify: `src/schemas/commission.ts`
- Modify: `src/routes/tenant/commissions.ts`
- Test: `test/doctor-commission-routes.test.ts`

**Interfaces:**
- API accepts `waiverPolicy`, `protectedRate`, and `protectedFlatAmount`.
- API stores normalized basis points for percentage floors and money values for flat floors.
- GET rule responses continue returning `r.*`, including new fields.

- [ ] **Step 1: Write failing API validation tests**

Cover a 25% rule with 5% protected floor, invalid protected rate above 25%, flat protected amount above flat commission, and default `full_earned` behavior.

- [ ] **Step 2: Run red route tests**

Run: `pnpm vitest run test/doctor-commission-routes.test.ts`

- [ ] **Step 3: Extend Zod schema and route normalization**

Normalize the commission rate first, validate the protected value against it, and persist all waiver-policy fields on create/update.

- [ ] **Step 4: Preserve audit evidence**

Include the waiver-policy fields in before/after audit payloads.

- [ ] **Step 5: Run green route tests and commit**

Commit: `feat(commission): persist doctor waiver policies`

### Task 4: Legacy preview and accrual calculation

**Files:**
- Modify: `src/lib/lab-finance.ts`
- Modify: `src/routes/tenant/discounts.ts`
- Test: `test/lab-finance.test.ts`
- Test: `test/integration/routes/discounts-doctor-waiver-preview.test.ts`

**Interfaces:**
- Resolved rule rows include `waiver_policy`, `protected_rate_bps`, and `protected_flat_amount`.
- Preview lines expose earned, protected, capacity, applied waiver, payable, and rule policy.
- Aggregate preview exposes `protectedCommissionAmount`, `maximumDoctorWaiverAmount`, `doctorWaiverAmount`, `hospitalFundedAmount`, and `payableCommissionAmount`.

- [ ] **Step 1: Write failing accrual test for 25% / 5% floor**

Use commission base 1000, earned 250, requested waiver 500, expected applied waiver 200 and payable 50.

- [ ] **Step 2: Write failing preview test**

Verify the preview returns the same 250/50/200/50 bridge and classifies the remaining discount as hospital-funded.

- [ ] **Step 3: Run red tests**

Run: `pnpm vitest run test/lab-finance.test.ts test/integration/routes/discounts-doctor-waiver-preview.test.ts`

- [ ] **Step 4: Replace full-earned consumer with rule-aware consumer**

For every line, calculate the protected amount from that line's resolved rule, consume only its waiver capacity, retain deterministic doctor-level remaining waiver, and persist snapshot fields.

- [ ] **Step 5: Persist zero-payable rows for all roles**

Remove performer and consultation short-circuits that currently hide fully waived earned commission.

- [ ] **Step 6: Run green tests and commit**

Commit: `feat(billing): enforce protected doctor commission floor`

### Task 5: Canonical parity and evidence

**Files:**
- Modify: `src/lib/canonical/live-doctor-compensation.ts`
- Modify: `src/lib/lab-finance.ts`
- Test: `test/canonical/live-doctor-compensation.test.ts`

**Interfaces:**
- `LiveDoctorCommissionRuleInput` carries `waiverPolicy` and `protectedRateValue`.
- `LiveDoctorCommissionAccrualInput` carries protected/capacity/requested/overflow amounts.
- Canonical rule evidence includes waiver policy and protected value.
- Canonical accrual evidence and columns contain the same snapshot as legacy.

- [ ] **Step 1: Write failing dual-write parity test**

Create a canonical-capable bill with a 25% rule, 5% floor, and excess waiver. Assert legacy and canonical rows both show earned 250, protected 50, adjusted/waived 200, and payable 50.

- [ ] **Step 2: Run red canonical test**

Run: `pnpm vitest run test/canonical/live-doctor-compensation.test.ts`

- [ ] **Step 3: Extend canonical rule/accrual input and validation**

Require protected amount not to exceed earned amount, capacity to equal earned minus protected, adjusted amount not to exceed capacity, and payable to equal earned minus adjusted.

- [ ] **Step 4: Store canonical fields and evidence**

Bind the new migration columns on rule and accrual inserts without changing legacy/canonical authority selection.

- [ ] **Step 5: Run green canonical test and commit**

Commit: `feat(canonical): project protected commission floor`

### Task 6: Commission rule UI

**Files:**
- Modify: `web/src/lib/commissionRuleForm.ts`
- Modify: `web/src/lib/commissionRuleForm.test.ts`
- Modify: `web/src/pages/CommissionManagement.tsx`

**Interfaces:**
- Form fields: `waiverPolicy`, `protectedRate`, `protectedFlatAmount`.
- The derived maximum waiver is read-only: commission rate minus protected rate for percentages, or flat commission minus protected flat amount.

- [ ] **Step 1: Write failing form-state tests**

Verify defaults use `full_earned`, switching to `protected_floor` retains the appropriate protected field, and changing rate type clears the incompatible protected field.

- [ ] **Step 2: Run red web unit test**

Run: `pnpm --filter web exec vitest run src/lib/commissionRuleForm.test.ts`

- [ ] **Step 3: Add rule controls and live explanation**

Add policy select, protected rate/amount input, derived maximum waiver display, payload fields, and active-rule table columns.

- [ ] **Step 4: Run green web tests and build**

Run: `pnpm --filter web exec vitest run src/lib/commissionRuleForm.test.ts`
Run: `pnpm --filter web build`

- [ ] **Step 5: Commit**

Commit: `feat(web): configure protected doctor commission`

### Task 7: Verification, integration, and rescue-branch cleanup

**Files:**
- Review all task-owned diffs.
- Do not modify unrelated root files.

- [ ] **Step 1: Run focused regression suite**

Run legacy calculator, route, preview, canonical dual-write, and web form tests.

- [ ] **Step 2: Run static and migration verification**

Run: `pnpm exec tsc --noEmit`
Run: `pnpm build:migrations`
Run: `pnpm canonical:check`
Run: `pnpm --filter web build`

- [ ] **Step 3: Review complete branch diff**

Confirm no production commands, unrelated files, or hidden fallback calculations were added.

- [ ] **Step 4: Integrate from the clean local-main worktree when available**

Run `pnpm worktree:check -- --mode=integration`, then fast-forward or cherry-pick verified task commits, followed by fresh verification on local `main`.

- [ ] **Step 5: Remove the rescue branch without losing unrelated commits or dirty files**

Preserve the rescue tip with a non-branch archival reference if necessary, detach or safely move the dirty root checkout without changing its files, and delete only `rescue/review-all-branches-20260711-20260725`.
