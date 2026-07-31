# Billing Integrity Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make doctor attribution explicit, align all paid non-cash UI flows with backend reference requirements, complete discount payloads, and make doctor-waiver preview agree with final performer-reserve-aware commission accrual.

**Architecture:** Preserve the existing billing routes and forms, but introduce two small shared authorities: a frontend payment-reference helper and a backend performer-reserve preview hydrator. Fix each entry point at its source rather than weakening backend validation. Use focused TDD tests before every production change.

**Tech Stack:** TypeScript, React, Hono, Zod, Cloudflare D1, Vitest, pnpm.

## Global Constraints

- Base every edit on reviewed local `main` commit `6a932aa97d415f52a498165e2c53a49b83dd470a` in branch `fix/billing-integrity-hardening-20260725`.
- Do not touch or clean unrelated dirty worktrees.
- Do not infer a referring doctor in `POST /api/billing`.
- Require an external reference only for a positive immediate non-cash payment.
- Preserve credit/provisional and zero-net invoice behavior.
- Preserve two-decimal money.
- No push, deploy, production migration, or historical mutation.

---

### Task 1: Remove implicit direct-billing doctor attribution

**Files:**
- Modify: `src/routes/tenant/billing.ts:1054-1077`
- Test: `test/integration/routes/billing-direct-counter.test.ts`

**Interfaces:**
- Consumes: `createBillSchema.referringDoctorId?: number`
- Produces: `referringDoctorId: number | undefined` that is explicit-only.

- [ ] **Step 1: Write the failing integration test**

Add a direct service-bill case with a same-day doctor visit but no `referringDoctorId`. Assert the bill insert receives `null` for the referrer and no doctor commission query is attributable to the historical/current visit.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run test/integration/routes/billing-direct-counter.test.ts`

Expected: FAIL because the route currently queries today's visit and uses its doctor.

- [ ] **Step 3: Remove the visit fallback**

Keep tenant/active-doctor validation for explicitly supplied IDs, but delete the `else` block that queries `visits`.

- [ ] **Step 4: Run focused test and verify GREEN**

Run the same test file and expect all tests to pass.

### Task 2: Make frontend referral state deterministic

**Files:**
- Modify: `web/src/pages/BillingCounterPage.tsx`
- Modify: `web/src/components/reception/ReceptionPatientDrawer.tsx`
- Test: `web/src/pages/BillingCounterPage.test.ts`
- Test: `web/src/components/reception/ReceptionPatientDrawer.test.tsx`

**Interfaces:**
- Produces: `resolveTodayVisitReferringDoctorId(visits, today): number | ''` in Patient Drawer.
- Produces: visit-change behavior that clears stale patient-context doctor state.

- [ ] **Step 1: Add failing Billing Counter test**

Assert the visit `onChange` branch clears referral, waiver, and line prescriber state when the selected visit has no doctor or walk-in is selected.

- [ ] **Step 2: Add failing Patient Drawer helper tests**

Cover historical visit -> no default, cancelled today visit -> no default, valid today visit -> doctor ID.

- [ ] **Step 3: Run both test files and verify RED**

Run: `cd web && pnpm exec vitest run src/pages/BillingCounterPage.test.ts src/components/reception/ReceptionPatientDrawer.test.tsx`

- [ ] **Step 4: Implement deterministic referral resolution**

Add the pure same-day helper, use Bangladesh business date, and clear stale Billing Counter referral data on walk-in/no-doctor visit selection.

- [ ] **Step 5: Re-run and verify GREEN**

### Task 3: Complete direct discount contracts and Patient Drawer high-discount approval

**Files:**
- Modify: `web/src/pages/BillingDashboard.tsx`
- Modify: `web/src/components/reception/ReceptionPatientDrawer.tsx`
- Test: `web/src/pages/BillingDashboard.test.ts`
- Test: `web/src/components/reception/ReceptionPatientDrawer.test.tsx`
- Test: `test/integration/routes/billing-direct-counter.test.ts`

**Interfaces:**
- Billing Dashboard sends `discountReason` and `discountByName` with positive discount.
- Patient Drawer sends `discountByName` when required.

- [ ] **Step 1: Add failing source/behavior tests**

Assert Billing Dashboard renders reason/approved-by fields and sends both fields. Assert Patient Drawer blocks above-20% discount without a name and sends the name when present.

- [ ] **Step 2: Add authorized backend success test**

Create a positive-discount direct bill as an authorized role with reason/name and assert `201`.

- [ ] **Step 3: Run focused tests and verify RED**

- [ ] **Step 4: Implement minimal form state, validation, and payload fields**

- [ ] **Step 5: Re-run and verify GREEN**

### Task 4: Add one shared non-cash reference rule

**Files:**
- Create: `web/src/lib/paymentReference.ts`
- Create: `web/src/lib/paymentReference.test.ts`

**Interfaces:**
- Produces: `requiresPaymentReference(method: string, paidAmount: number): boolean`
- Produces: `normalizeExternalTransactionId(method: string, paidAmount: number, value: string): string | undefined`

- [ ] **Step 1: Write failing helper tests**

Cover cash, zero-payment credit, bKash/card/bank positive payment, trimming, and blank references.

- [ ] **Step 2: Run test and verify RED**

- [ ] **Step 3: Implement helper**

Use the same non-cash set as backend schemas.

- [ ] **Step 4: Run test and verify GREEN**

### Task 5: Wire non-cash references into Billing and Reception screens

**Files:**
- Modify: `web/src/pages/BillingDashboard.tsx`
- Modify: `web/src/components/reception/ReceptionPatientDrawer.tsx`
- Modify: `web/src/pages/ReceptionDashboard.tsx`
- Modify: `web/src/pages/BillingCounterPage.tsx`
- Test: `web/src/pages/BillingDashboard.test.ts`
- Test: `web/src/components/reception/ReceptionPatientDrawer.test.tsx`
- Test: `web/src/pages/ReceptionDashboard.test.tsx`
- Test: `web/src/pages/BillingCounterPage.test.ts`

**Interfaces:**
- Consumes: Task 4 helper.
- Sends: `externalTransactionId?: string` on positive paid non-cash mutations.

- [ ] **Step 1: Add failing tests for every affected payload**

Cover Billing Dashboard due pay; Patient Drawer due pay and quick bill; Reception quick service, visit service, pending lab, appointment pay-now, single due pay, and batch due pay; Billing Counter conditional required copy.

- [ ] **Step 2: Run focused web tests and verify RED**

- [ ] **Step 3: Add per-flow reference state and conditional inputs**

Clear reference when switching to cash or resetting/closing each flow. Block submission when the helper says a reference is required and the trimmed value is empty.

- [ ] **Step 4: Include normalized reference in each mutation**

Credit/due creation with zero paid amount must omit the reference.

- [ ] **Step 5: Re-run and verify GREEN**

### Task 6: Make waiver preview performer-reserve-aware and cent-precise

**Files:**
- Modify: `src/lib/diagnostic-performer-reserve.ts`
- Modify: `src/routes/tenant/discounts.ts`
- Modify: `src/lib/lab-finance.ts`
- Test: `test/integration/routes/diagnostic-performer-reserves.test.ts`
- Create: `test/integration/routes/discounts-doctor-waiver-preview.test.ts`
- Modify: `web/src/pages/BillingCounterPage.tsx`
- Modify: `web/src/components/reception/ReceptionPatientDrawer.tsx`

**Interfaces:**
- Produces: `hydrateDiagnosticPerformerPreviewReserves(db, { tenantId, billDate, items })`.
- Preview item adds `quantity?: number`.

- [ ] **Step 1: Write failing reserve-hydration tests**

Use gross 1,000, discounted net 900, quantity 1, flat reserve 200 and assert hydrated reserve 200. Cover percent and explicit-reserve preservation.

- [ ] **Step 2: Write failing route preview test**

Assert a 25% doctor rule receives commission base 700 and eligible commission 175, and a fractional result preserves two decimals.

- [ ] **Step 3: Run tests and verify RED**

- [ ] **Step 4: Export/reuse effective performer rules and payout split**

Hydrate server-side reserve by billing service item reference and quantity before calling commission preview.

- [ ] **Step 5: Replace whole-taka rounding with `roundMoney`**

- [ ] **Step 6: Send quantity from Billing Counter and Patient Drawer preview payloads**

- [ ] **Step 7: Re-run and verify GREEN**

### Task 7: Correct Bangladesh currency copy and run full verification

**Files:**
- Modify: `web/src/components/reception/DiscountAllocationEditor.tsx`
- Test: `web/src/components/reception/DiscountAllocationEditor.test.tsx`

**Interfaces:**
- Produces Bangladesh `৳` copy only.

- [ ] **Step 1: Add failing currency assertion**

Assert the source contains `৳` and no `₱`.

- [ ] **Step 2: Replace incorrect symbols and verify GREEN**

- [ ] **Step 3: Run focused backend suite**

Run the billing, referrer, discount-allocation, commission, direct-counter, billing-counter, reserve, and preview tests.

- [ ] **Step 4: Run focused web suite**

Run Billing Counter, Billing Dashboard, Reception Dashboard, Patient Drawer, Discount Allocation Editor, and payment-reference tests.

- [ ] **Step 5: Run TypeScript and builds**

Run:

- `pnpm exec tsc --noEmit`
- `pnpm --filter web exec tsc --noEmit`
- `pnpm build:web`

- [ ] **Step 6: Review complete diff and commit exact task files**

Use focused commits for docs, referrer/discount contracts, payment references, and waiver preview. Do not stage generated or unrelated files.

- [ ] **Step 7: Integrate into local main**

From the clean `main` worktree run `pnpm worktree:check -- --mode=integration`, review commits, fast-forward/merge the single-purpose branch, and run fresh post-merge focused verification.
