# Amount-Based Partial Refund Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure amount-based partial refund request to reception without changing item-return semantics, and remove unauthorized credit-note creation actions from reception.

**Architecture:** Extend the structured refund approval contract with `amount_partial_refund`. Reuse the existing cash-hold and approval execution path, branching only where refund value is derived: item modes calculate from item quantities; amount mode uses a canonical server-validated amount and creates a header-only credit note. The frontend adds a third mode and continues displaying cash-versus-receivable impact.

**Tech Stack:** TypeScript, React, Hono, Zod, Cloudflare D1, Vitest, Testing Library.

## Global Constraints

- Preserve full and item-based refund behavior.
- No database migration or new dependency.
- Reception amount requests require positive cash impact and an active current-workstation counter.
- Amount-based approval must not reserve/return item quantities or trigger clinical item cancellation.
- Server calculations and stored canonical request data are authoritative.

---

### Task 1: Approval contract

**Files:**
- Modify: `src/schemas/approval.ts`
- Test: `test/unit/approval-schemas.test.ts`

**Interfaces:**
- Consumes: existing `createApprovalRequestSchema`.
- Produces: `refundKind: "amount_partial_refund"` with positive `requestedRefundAmount` and no required items.

- [x] Write failing schema tests that accept a positive amount request and reject missing, zero, non-finite, or item-bearing amount requests.
- [x] Run `pnpm exec vitest run test/unit/approval-schemas.test.ts` and confirm the new tests fail for the missing enum/validation.
- [x] Extend the schema enum and refund-specific refinement with exact amount validation.
- [x] Re-run the unit test and confirm it passes.

### Task 2: Server-side request and approval execution

**Files:**
- Modify: `src/routes/tenant/approvals.ts`
- Test: `test/integration/routes/refund-approval-cash-holds.test.ts`

**Interfaces:**
- Consumes: `requestData.requestedRefundAmount`, `calculateRefundFinancialImpact`, existing cash-hold helpers.
- Produces: canonical approval request with `requestedRefundAmount`, `cashRefundAmount`, `receivableReduction`; approval creates a header-only approved credit note and consumes the hold.

- [x] Add failing integration tests for creating an amount request, rejecting invalid/excess/no-cash amounts, and approving it without credit-note item rows.
- [x] Run the targeted integration test and confirm expected failures.
- [x] Include `amount_partial_refund` in the structured refund branch.
- [x] At request creation, derive total credit from the manual amount for amount mode; retain item calculation for full/item modes.
- [x] At approval, revalidate the canonical manual amount and cash hold; skip item eligibility and clinical side effects for amount mode.
- [x] Create a clearly labelled header-only credit note and post its accounting amount as other revenue reversal.
- [x] Re-run the targeted integration test and confirm all cases pass.

### Task 3: Reception amount-entry UI

**Files:**
- Modify: `web/src/components/reception/ReceptionPatientDrawer.tsx`
- Test: `web/src/components/reception/ReceptionPatientDrawer.test.tsx`

**Interfaces:**
- Consumes: the invoice's current total/paid values and active-counter cash response.
- Produces: an approval payload with `refundKind: "amount_partial_refund"`, `requestedRefundAmount`, no item selections, and the existing idempotency key.

- [x] Add a failing UI test that selects Amount-based refund, enters a partial amount, and asserts the approval payload.
- [x] Add failing validation assertions for zero/excess/no-cash amount and submit-button state.
- [x] Run the targeted frontend test and confirm failures.
- [x] Add `amount` to `RefundMode`, manual amount state/reset logic, and amount-based selected-total calculation.
- [x] Render a three-mode selector, manual amount input, maximum value/help, and hide the item list in amount mode.
- [x] Submit the amount request without items while preserving the existing cash/receivable summary and safety gates.
- [x] Re-run the targeted frontend test and confirm it passes.

### Task 4: Credit Notes role-aware actions

**Files:**
- Modify: `web/src/pages/CreditNotesPage.tsx`
- Test: `web/src/pages/CreditNotesPage.test.tsx`

**Interfaces:**
- Consumes: existing `CREDIT_NOTE_WRITE_ROLES` and page `role` prop.
- Produces: create controls only for authorized admin/accounts roles; reception retains list and payout actions.

- [x] Add a failing render test showing reception does not see New/Create Credit Note while an authorized role does.
- [x] Run the page test and confirm failure.
- [x] Gate page-header and empty-state create actions with `canApprove`/write authorization.
- [x] Re-run the page test and confirm it passes.

### Task 5: Verification and review

**Files:**
- Review all modified files.

**Interfaces:**
- Produces: verified feature branch ready for integration.

- [x] Run targeted backend tests for approval schema, refund cash holds, approvals, credit notes, and accounting.
- [x] Run targeted frontend tests for ReceptionPatientDrawer and CreditNotesPage.
- [x] Run `pnpm exec tsc --noEmit`.
- [x] Run `pnpm --filter web build`.
- [x] Review the diff for unintended item-refund, cash-hold, accounting, role, or clinical-side-effect changes.
- [x] Commit the focused changes and leave the branch clean.
