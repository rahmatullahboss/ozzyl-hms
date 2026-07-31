# Billing Counter Paid/Credit Mode Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve finalized unpaid test workflows while ensuring requested paid/credit modes, legacy transactions, laboratory billing status, audits, responses, and canonical projections all use one consistent effective settlement state.

**Architecture:** Add a small server-side mode normalizer as the financial source of truth and use its output throughout billing-counter finalization. Add a frontend submission normalizer for immediate feedback and stale-field prevention, while retaining backend normalization for non-web/API clients. Cover the contract with pure unit tests, route integration tests, UI tests, and canonical route-coverage verification.

**Tech Stack:** TypeScript, Hono, Zod, Cloudflare D1, Vitest, React, TanStack Query.

## Global Constraints

- Finalized unpaid diagnostic invoices must continue creating lab orders and appearing in the unpaid list.
- `credit` must never create cash, payment, or deposit-adjustment transactions.
- Partial payment and deposit-only settlement remain valid in effective `paid` mode.
- A zero-net-total full-discount invoice remains settled without a payment row.
- Canonical strict policy must not be weakened or bypassed.
- Existing due-collection and provisional workflows remain unchanged.
- Use TDD: each behavior test must fail before production code is changed.

---

### Task 1: Server settlement-mode normalization

**Files:**
- Create: `src/lib/billing-counter-invoice-mode.ts`
- Create: `test/unit/billing-counter-invoice-mode.test.ts`

**Interfaces:**
- Produces: `resolveBillingCounterInvoiceMode(input): BillingCounterInvoiceModeResolution`
- Input fields: `requestedMode`, `total`, `paidAmount`, `depositDeducted`
- Output fields: `requestedMode`, `effectiveMode`, `paidAmount`, `depositDeducted`, `modeAdjusted`, `modeAdjustmentReason`

- [ ] Write failing unit tests for zero-settlement paid normalization, explicit credit stale-field removal, partial paid preservation, deposit-only preservation, and full-discount paid preservation.
- [ ] Run `pnpm exec vitest run test/unit/billing-counter-invoice-mode.test.ts` and confirm failure because the helper does not exist.
- [ ] Implement the pure normalizer with stable adjustment reasons.
- [ ] Rerun the unit test and confirm all cases pass.

### Task 2: Use one effective state in billing-counter finalization

**Files:**
- Modify: `src/routes/tenant/billingCounter.legacy.ts:4229-4710`
- Modify: `test/integration/routes/billing-counter-legacy.test.ts`

**Interfaces:**
- Consumes: `resolveBillingCounterInvoiceMode`
- Produces response/audit fields: `requestedMode`, `mode`, `modeAdjusted`, `modeAdjustmentReason`

- [ ] Add a failing integration test where requested `paid` has zero payment/deposit; expect effective `credit`, open/full due, no payment/cash/deposit rows, and finalized unpaid lab workflow.
- [ ] Add a failing integration test where explicit `credit` contains stale payment/deposit values; expect those values to be ignored and no settlement transactions written.
- [ ] Add a failing integration test for a zero-net-total full-discount paid invoice; expect effective paid, status paid, due zero, and no payment row.
- [ ] Run the three focused integration tests and confirm the current route fails the new assertions.
- [ ] Resolve the mode after server pricing, calculate payment from normalized amounts, and derive `effectiveDue`/`effectiveStatus` once.
- [ ] Replace every requested-mode branch in bill insert, strict-policy check, payment/deposit statements, canonical projection, lab-order status, response, and audit with the normalized values.
- [ ] Rerun `pnpm exec vitest run test/integration/routes/billing-counter-legacy.test.ts` and confirm the complete route suite passes.

### Task 3: Billing Counter frontend semantics

**Files:**
- Create: `web/src/lib/billingInvoiceMode.ts`
- Create: `web/src/lib/billingInvoiceMode.test.ts`
- Modify: `web/src/pages/BillingCounterPage.tsx`
- Modify: `web/src/pages/BillingCounterPage.test.ts`

**Interfaces:**
- Produces: `resolveBillingInvoiceSubmissionMode({ selectedMode, total, paidAmount, depositDeducted })`

- [ ] Write failing frontend helper tests matching the server mode matrix.
- [ ] Run `pnpm --dir web exec vitest run src/lib/billingInvoiceMode.test.ts` and confirm failure because the helper does not exist.
- [ ] Implement the minimal frontend helper.
- [ ] Use the helper for totals and submit payload so credit/provisional modes never carry settlement values and zero-settlement Pay now submits as credit.
- [ ] Clear stale payment, deposit, and transaction-reference fields when switching to Credit or Provisional.
- [ ] Make success feedback distinguish credit/open, partial payment, and paid invoices using the authoritative response.
- [ ] Add source/component assertions covering mode normalization and stale-field clearing.
- [ ] Run the helper and BillingCounterPage tests and confirm they pass.

### Task 4: Reception Patient Drawer consistency

**Files:**
- Modify: `web/src/components/reception/ReceptionPatientDrawer.tsx`
- Modify: `web/src/components/reception/ReceptionPatientDrawer.test.tsx`

**Interfaces:**
- Consumes: existing `billMode`, payment, and deposit state.
- Produces: credit payload with zero immediate settlement.

- [ ] Add a failing test proving credit mode cannot submit a deposit deduction or immediate payment.
- [ ] Make `depositApplied` and `cashPaidNow` zero in credit mode.
- [ ] Clear payment/deposit values when switching to credit and disable settlement controls where appropriate.
- [ ] Rerun the drawer tests and confirm they pass.

### Task 5: Retry and idempotency safety

**Files:**
- Create: `web/src/lib/invoiceIdempotency.ts`
- Create: `web/src/lib/invoiceIdempotency.test.ts`
- Modify: `web/src/pages/BillingCounterPage.tsx`
- Modify: `web/src/components/reception/ReceptionPatientDrawer.tsx`

**Interfaces:**
- Produces: `shouldRotateInvoiceAttemptKey(error)`

- [ ] Add failing tests for network errors, 5xx errors, in-progress 409 responses, and definitive 4xx errors.
- [ ] Preserve the current idempotency key for ambiguous outcomes and rotate only after success or a definitive client error.
- [ ] Replace the Patient Drawer per-click UUID with stable attempt state.
- [ ] Verify the original cashier-selected mode is retained in the request so backend audit can record requested versus effective mode.

### Task 6: Canonical and regression verification

**Files:**
- Modify only if required by failing coverage: `test/canonical/financial-route-coverage.test.ts`

**Interfaces:**
- Verifies billing-counter invoice creation still uses `billing-counter.invoice.create` and passes normalized settlement only to `projectBillingCounterSettlement`.

- [ ] Run `pnpm exec vitest run test/canonical/financial-route-coverage.test.ts`.
- [ ] Run `pnpm exec vitest run test/unit/billing-counter-invoice-mode.test.ts test/integration/routes/billing-counter-legacy.test.ts`.
- [ ] Run `pnpm --dir web exec vitest run src/lib/billingInvoiceMode.test.ts src/lib/invoiceIdempotency.test.ts src/pages/BillingCounterPage.test.ts src/components/reception/ReceptionPatientDrawer.test.tsx src/components/dashboard/AdminKpiInvoiceModal.test.tsx`.
- [ ] Run root and web typechecks/builds required by the repository.
- [ ] Review the final diff for accidental schema, migration, accounting, due-collection, or provisional-flow changes.
- [ ] Commit the focused implementation and leave the branch clean for integration.
