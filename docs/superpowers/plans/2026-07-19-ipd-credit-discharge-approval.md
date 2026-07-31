# IPD Credit Discharge Approval Implementation Plan

> **Required process:** test-first for every behavior change; verify each focused suite before broader verification.

**Goal:** Deliver a canonical-aware discharge financial summary, executed-pending credit discharge approval, accurate discharge printing, and IPD lab-only printing.

**Architecture:** Add a small financial-clearance service over the existing receivable authority adapters. Keep financial balances in legacy/canonical invoice sources. Extend the existing approval center rather than creating another workflow table. Preserve clinical discharge while approval is pending or rejected.

**Tech:** Cloudflare Workers/Hono, D1/SQLite, TypeScript, React, TanStack Query, Vitest.

---

## Task 1: Authority-aware patient outstanding summary

**Files**
- Create: `src/lib/ipd-discharge-financial-clearance.ts`
- Test: `test/unit/ipd-discharge-financial-clearance.test.ts`
- Modify: `src/routes/tenant/ipBilling.ts`
- Modify: `test/integration/routes/ip-billing.test.ts`

**Steps**
1. Write failing tests for legacy, shadow/canonical selection, patient filtering, open-due filtering, category breakdown, and safe minor-unit totals.
2. Implement the minimal service using existing receivable adapters and optional legacy metadata enrichment.
3. Extend `GET /api/ip-billing/pending/:admissionId` with `financial_clearance`.
4. Verify focused unit and route tests.

## Task 2: Approval schema and financial state migration

**Files**
- Create: `migrations/0520_credit_discharge_approval.sql`
- Modify: `src/db/schema/approval-requests.ts`
- Test: `test/credit-discharge-approval-migration.test.ts`

**Steps**
1. Write a migration test proving existing approval rows and execution fields survive the rebuild.
2. Rebuild `approval_requests` with all existing types plus `credit_discharge`.
3. Preserve indexes and constraints.
4. Update Drizzle comments/types where needed.
5. Verify the migration test.

## Task 3: Atomic credit discharge request

**Files**
- Modify: `src/routes/tenant/ipBilling.ts`
- Modify: `test/integration/routes/ip-billing.test.ts`

**Steps**
1. Write failing tests:
   - normal discharge blocks external due
   - unresolved services always block
   - credit mode requires reason/date/confirmation
   - server recomputes total due
   - discharge, bill, approval request, approval event, notifications, bed release, and `credit_pending` state are emitted in the same batch
2. Extend the request schema with `discharge_mode`, `credit_reason`, `expected_payment_date`, and `confirm_credit_discharge`.
3. Include current final-bill due plus other invoices in the approval snapshot.
4. Return approval metadata and the correct print target.
5. Verify focused route tests.

## Task 4: Approval review state transitions

**Files**
- Modify: `src/routes/tenant/approvals.ts`
- Modify: `src/schemas/approval.ts` only if required by existing validation
- Modify: `test/integration/routes/approvals.test.ts`

**Steps**
1. Write failing approve/reject tests for `credit_discharge`.
2. Require review notes and separation of duties.
3. Atomically update approval status and admission `bill_status_on_discharge`:
   - approve → `credit_approved`
   - reject → `credit_rejected`
4. Prove clinical discharge and bed state are not reversed.
5. Verify focused approval tests.

## Task 5: Discharge modal redesign

**Files**
- Modify: `web/src/lib/ipdDischargeFinancial.ts`
- Modify: `web/src/lib/ipdDischargeFinancial.test.ts`
- Modify: `web/src/components/reception/DischargeModal.tsx`
- Modify: `web/src/components/reception/DischargeModal.test.tsx`
- Modify: `web/src/pages/AdmissionIPD.tsx`

**Steps**
1. Write failing UI tests for:
   - separate current IPD and other invoice sections
   - visible invoice/category/due breakdown
   - status not `Ready` when due exists
   - normal settlement and credit-discharge actions
   - explicit credit confirmation form
2. Extend frontend types/derived financial calculations.
3. Replace the ambiguous checkbox with explicit action buttons and a confirmation panel.
4. For legacy/shadow mapped invoices, use the existing settlement command before normal discharge; fail closed for canonical-only inline collection.
5. Refresh financial data after settlement and proceed to discharge only after server-confirmed zero external due.
6. Verify focused web tests.

## Task 6: Approval Center presentation

**Files**
- Modify: `web/src/pages/admin/PendingApprovals.tsx`
- Modify: `web/src/components/admin/ApprovalDetailDrawer.tsx`
- Modify: related tests and locale files

**Steps**
1. Add failing tests for credit-discharge labels, patient/admission context, invoice snapshot, due amount, requester acknowledgement, and approve/reject notes.
2. Add the type label/icon/risk presentation.
3. Ensure requests appear in counts and worklists without a parallel dashboard.
4. Verify focused tests.

## Task 7: Discharge clearance print

**Files**
- Modify: `src/routes/tenant/ipBilling.ts`
- Modify: `test/integration/routes/ip-billing.test.ts`

**Steps**
1. Write failing print tests for `CREDIT APPROVAL PENDING`, total outstanding, approval ID, and expected payment date.
2. Enhance discharge-clearance data using the authority-aware financial summary and approval request.
3. Keep normal fully-settled print unchanged.
4. Verify focused tests.

## Task 8: IPD laboratory-only print

**Files**
- Modify: `src/routes/tenant/ipBilling.ts`
- Modify: `test/integration/routes/ip-billing.test.ts`
- Modify the running-bill UI entry point used by IPD/reception
- Add/modify web tests

**Steps**
1. Write a failing route test that mixed IPD items produce a print containing only test/lab items.
2. Add `GET /api/ip-billing/:admissionId/print-tests` or an equivalent explicit route.
3. Print patient/admission/doctor and test requisition rows; exclude price totals, bed, package, and unrelated services.
4. Add a `Print Lab Tests` button when printable test items exist.
5. Verify route and UI tests.

## Task 9: Final verification and branch review

1. Run focused unit/integration/web suites.
2. Run TypeScript checks for API and web.
3. Run relevant broader billing/approval tests.
4. Review the branch diff for unrelated changes and canonical conflicts.
5. Load and follow `verification-before-completion` before claiming completion.
