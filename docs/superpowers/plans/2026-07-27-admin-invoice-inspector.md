# Shared Admin Invoice Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans`. Follow TDD. Keep all inspector actions read-only.

**Goal:** Replace the dashboard-only invoice modal with a common, deep-linkable invoice inspector that explains invoice identity, items/tests, payments/deposits, discount/referral allocation, doctor compensation, and audit history, and can be opened consistently from every admin dashboard drill surface.

**Architecture:** Add a focused invoice-inspector read service under `src/services/billing/` and expose a composite route beside the existing `/api/billing/:billId` route. The composite service queries existing source tables and services; it does not mutate or duplicate invoice facts. The frontend owns a URL-driven `InvoiceInspector` with tabbed progressive loading and a compatibility adapter for existing `AdminKpiInvoiceModal` consumers.

**Tech Stack:** Hono/Cloudflare Workers, D1, TypeScript, React, React Router, React Query, Vitest, Testing Library.

## Global constraints

- Read-only inspector; no approval, cancellation, refund, payment, settlement, or commission mutation.
- Existing billing authorization applies before any patient or financial detail is returned.
- Existing `/api/billing/:billId` response remains backward-compatible.
- Optional sources return empty sections with warnings; they do not break the entire inspector.
- Every source query is tenant-scoped and parameter-bound.
- Patient identity is not returned when the existing billing/patient permissions do not allow it.
- Full-page billing, print, and PDF actions link to existing routes; they are not reimplemented.
- All dashboard surfaces open invoices using stable `billId`, never invoice-number matching.

---

## Task 1: Define invoice-inspector contracts

**Files:**

- Create: `src/services/billing/invoiceInspectorContract.ts`
- Create: `test/unit/invoice-inspector-contract.test.ts`
- Create: `web/src/types/invoiceInspector.ts`

**Sections:**

- Invoice summary
- Items/tests and doctor roles
- Payments
- Deposit adjustments
- Discount/referral allocations
- Doctor compensation
- Audit timeline
- Reconciliation
- Navigation/print actions

- [ ] Test numeric normalization and two-decimal response rounding.
- [ ] Test missing optional arrays normalize to empty arrays.
- [ ] Test invoice reconciliation: gross minus discount equals net.
- [ ] Test settlement reconciliation: payments plus deposit applied versus settled/due.
- [ ] Test compensation reconciliation by payable and paid measures.
- [ ] Test warnings are additive and do not replace valid sections.
- [ ] Implement pure response mapping helpers.

**Commit:**

```bash
git add src/services/billing/invoiceInspectorContract.ts test/unit/invoice-inspector-contract.test.ts web/src/types/invoiceInspector.ts
git commit -m "feat(billing): define invoice inspector contract"
```

---

## Task 2: Build the invoice-inspector read service

**Files:**

- Create: `src/services/billing/invoiceInspector.ts`
- Create: `test/integration/routes/billing-invoice-inspector.test.ts`
- Modify: `src/routes/tenant/billing.ts`

**Endpoint:**

```text
GET /billing/:billId/inspector
```

- [ ] Test invoice/patient summary from the existing bill source.
- [ ] Test items include category, description, quantity, rate, line total, and available ordering/referring/performing/verifying doctor identities.
- [ ] Test payments include receipt, method, type, amount, collector, and counter.
- [ ] Test deposit adjustments remain separate from cash payments.
- [ ] Test discount reference, reason, and source allocations.
- [ ] Test doctor compensation rows include rule, reserve, base, earned, waiver, adjustment, payable, paid, outstanding, reason, and status.
- [ ] Test cancellation/refund/reversal and audit events are ordered chronologically.
- [ ] Test unsupported optional tables produce warnings and empty sections.
- [ ] Test invalid bill ID, missing bill, wrong tenant, and unauthorized caller.
- [ ] Test patient identity redaction for a caller without required patient/billing detail access.
- [ ] Run and verify RED.
- [ ] Implement the service by composing focused query functions; keep the route handler small.
- [ ] Reuse existing billing and compensation amount-selection helpers where available.
- [ ] Run and verify GREEN.

**Commit:**

```bash
git add src/services/billing/invoiceInspector.ts src/routes/tenant/billing.ts test/integration/routes/billing-invoice-inspector.test.ts
git commit -m "feat(billing): add read-only invoice inspector API"
```

---

## Task 3: Add inspector URL-state hook

**Files:**

- Create: `web/src/components/invoice-inspector/useInvoiceInspectorState.ts`
- Create: `web/src/components/invoice-inspector/useInvoiceInspectorState.test.tsx`
- Modify: `web/src/pages/admin/command-center/commandCenterUrlState.ts`
- Modify: `web/src/pages/admin/command-center/commandCenterUrlState.test.ts`

**Interface:**

```ts
interface InvoiceInspectorState {
  billId: number | null;
  openInvoice: (billId: number) => void;
  closeInvoice: () => void;
}
```

- [ ] Test `invoiceId` opens after direct navigation.
- [ ] Test close removes only `invoiceId`.
- [ ] Test browser Back closes the inspector.
- [ ] Test browser Forward reopens it.
- [ ] Test invalid invoice IDs are normalized out of the URL.
- [ ] Test period/tab/doctor/test filters are preserved.
- [ ] Implement using React Router search parameters and replace/push semantics appropriate for open/close.

**Commit:**

```bash
git add web/src/components/invoice-inspector/useInvoiceInspectorState.ts web/src/components/invoice-inspector/useInvoiceInspectorState.test.tsx web/src/pages/admin/command-center/commandCenterUrlState.ts web/src/pages/admin/command-center/commandCenterUrlState.test.ts
git commit -m "feat(admin-dashboard): make invoice state deep linkable"
```

---

## Task 4: Build the inspector shell and summary tab

**Files:**

- Create: `web/src/components/invoice-inspector/InvoiceInspector.tsx`
- Create: `web/src/components/invoice-inspector/InvoiceInspector.test.tsx`
- Create: `web/src/components/invoice-inspector/InvoiceInspectorHeader.tsx`
- Create: `web/src/components/invoice-inspector/InvoiceSummaryTab.tsx`
- Create: `web/src/components/invoice-inspector/InvoiceReconciliationPanel.tsx`
- Modify: `web/src/lib/queryKeys.ts`

- [ ] Test direct bill fetch from `/api/billing/:billId/inspector`.
- [ ] Test loading, not found, unauthorized, partial-warning, and retry states.
- [ ] Test header displays invoice number, status, copy action, close, full billing, print, and PDF actions when available.
- [ ] Test summary displays patient, time, gross, discount, net, paid, deposit applied, and due.
- [ ] Test reconciliation warning shows exact difference.
- [ ] Test focus moves into the inspector and returns to trigger.
- [ ] Test Escape closes on desktop.
- [ ] Test mobile uses a full-screen sheet.
- [ ] Implement a full-height right drawer on desktop and full-screen mobile layout.

**Commit:**

```bash
git add web/src/components/invoice-inspector/InvoiceInspector.tsx web/src/components/invoice-inspector/InvoiceInspector.test.tsx web/src/components/invoice-inspector/InvoiceInspectorHeader.tsx web/src/components/invoice-inspector/InvoiceSummaryTab.tsx web/src/components/invoice-inspector/InvoiceReconciliationPanel.tsx web/src/lib/queryKeys.ts
git commit -m "feat(admin-dashboard): add invoice inspector shell"
```

---

## Task 5: Add inspector detail tabs

**Files:**

- Create: `web/src/components/invoice-inspector/InvoiceItemsTab.tsx`
- Create: `web/src/components/invoice-inspector/InvoicePaymentsTab.tsx`
- Create: `web/src/components/invoice-inspector/InvoiceDiscountTab.tsx`
- Create: `web/src/components/invoice-inspector/InvoiceCompensationTab.tsx`
- Create: `web/src/components/invoice-inspector/InvoiceAuditTab.tsx`
- Create focused tests for each tab
- Modify: `web/src/components/invoice-inspector/InvoiceInspector.tsx`

- [ ] Test items display ordering, referring, performing, and verifying roles separately.
- [ ] Test payments and deposits are separated.
- [ ] Test discount allocations show source/funder rather than only one reference name.
- [ ] Test compensation uses the shared calculation-bridge presentation.
- [ ] Test audit events show time, event, actor, and reference.
- [ ] Test empty sections explain that no matching source rows were found.
- [ ] Test tabs use accessible tab semantics and keyboard navigation.
- [ ] Avoid a mandatory wide table on mobile; use responsive detail cards.

**Commit:**

```bash
git add web/src/components/invoice-inspector
git commit -m "feat(admin-dashboard): add invoice inspector evidence tabs"
```

---

## Task 6: Add a compatibility adapter and migrate admin KPI usage

**Files:**

- Modify: `web/src/components/dashboard/AdminKpiInvoiceModal.tsx`
- Modify: `web/src/pages/admin/widgets/KPISummaryCards.tsx`
- Modify: `web/src/components/dashboard/KpiBreakdownDrawer.tsx` only if its callback contract needs a stable bill action
- Modify relevant tests

- [ ] Convert `AdminKpiInvoiceModal` into a temporary adapter that renders `InvoiceInspector` or mark it deprecated with no duplicate fetch logic.
- [ ] Test KPI invoice number, row click, and View invoice action open the inspector.
- [ ] Test invoice URL state is updated.
- [ ] Test the old `/api/billing/:billId` modal fetch is not duplicated when the inspector is active.
- [ ] Preserve all non-invoice KPI drawer behavior.

**Commit:**

```bash
git add web/src/components/dashboard/AdminKpiInvoiceModal.tsx web/src/pages/admin/widgets/KPISummaryCards.tsx web/src/components/dashboard/KpiBreakdownDrawer.tsx web/src/components/dashboard web/src/pages/admin/widgets
git commit -m "refactor(admin-dashboard): route KPI invoices through inspector"
```

Stage only exact modified tests and components after inspecting `git status`.

---

## Task 7: Migrate doctor, test, and IPD invoice links

**Files:**

- Modify: `web/src/components/dashboard/DoctorPerformanceDrawer.tsx`
- Modify: `web/src/components/dashboard/TestPerformanceDrawer.tsx`
- Modify: `web/src/components/dashboard/IPDBillingOverview.tsx`
- Modify: `web/src/pages/admin/command-center/workspaces/DoctorsWorkspace.tsx`
- Modify: `web/src/pages/admin/command-center/workspaces/DiagnosticsWorkspace.tsx`
- Modify: `web/src/pages/admin/command-center/workspaces/IPDWorkspace.tsx`
- Modify focused tests

- [ ] Test visit invoices open the inspector.
- [ ] Test referred/performed test invoices open the inspector.
- [ ] Test compensation invoices open the inspector.
- [ ] Test IPD invoice activity opens the inspector.
- [ ] Test rows without bill ID remain plain.
- [ ] Test a selected period and doctor/test identity remain in the URL after opening/closing an invoice.

**Commit:**

```bash
git add web/src/components/dashboard/DoctorPerformanceDrawer.tsx web/src/components/dashboard/TestPerformanceDrawer.tsx web/src/components/dashboard/IPDBillingOverview.tsx web/src/pages/admin/command-center/workspaces web/src/components/dashboard/*.test.tsx
git commit -m "feat(admin-dashboard): connect domain invoices to inspector"
```

Stage exact test files rather than relying on the glob in a dirty worktree.

---

## Task 8: Migrate due, discount, collection, and payment-method links

**Files:**

- Modify the existing due/discount/collection components that already return `billId`
- Modify: `web/src/pages/admin/widgets/PaymentMethodBreakdown.tsx`
- Modify: `web/src/pages/admin/command-center/workspaces/MoneyWorkspace.tsx`
- Modify focused tests

- [ ] Search all admin invoice references and inventory consumers.
- [ ] Migrate only surfaces with a stable bill ID.
- [ ] Keep source-specific mutation pages as separate links/actions.
- [ ] Test due, discount, collection, and payment method rows open the same inspector.
- [ ] Confirm no invoice-number string lookup is added.

**Commit:**

```bash
git add web/src/pages/admin web/src/components/dashboard web/src/components/invoice-inspector
git commit -m "feat(admin-dashboard): unify financial invoice drilldowns"
```

Before committing, replace broad staging with the exact files shown by `git status`.

---

## Task 9: Accessibility, privacy, and security verification

- [ ] Test dialog labeling, tab semantics, focus trapping/restoration, and Escape.
- [ ] Test direct URL authorization before patient detail render.
- [ ] Test the server response does not include patient fields when unauthorized.
- [ ] Test audit detail excludes secrets and raw internal payloads.
- [ ] Test print/PDF/full-page URLs remain tenant-scoped.
- [ ] Test 375 px and 768 px views without page-level horizontal scroll.

---

## Task 10: Regression verification

- [ ] Run backend tests:

```bash
pnpm exec vitest run \
  test/unit/invoice-inspector-contract.test.ts \
  test/integration/routes/billing-invoice-inspector.test.ts \
  test/integration/routes/dashboard-management-kpis.test.ts \
  test/integration/routes/dashboard-kpi-breakdown.test.ts
```

- [ ] Run frontend tests:

```bash
pnpm --dir web exec vitest run \
  src/components/invoice-inspector \
  src/components/dashboard/KpiBreakdownDrawer.test.tsx \
  src/pages/admin/widgets/KPISummaryCards.test.tsx \
  src/components/dashboard/DoctorPerformanceDrawer.test.tsx \
  src/components/dashboard/TestPerformanceDrawer.test.tsx
```

- [ ] Run root/web typecheck and web build.
- [ ] Search for remaining `AdminKpiInvoiceModal` imports and document intentional compatibility usage.
- [ ] Search for invoice-number-only click implementations and remove them.
- [ ] Inspect response payloads for patient privacy.
- [ ] Inspect scoped diff.

## Completion evidence

- Direct `invoiceId` URLs open the same inspector.
- Every supported admin invoice link uses stable bill ID.
- Inspector explains invoice, payment, discount, compensation, and audit evidence.
- Existing mutation workflows remain separate.
- Unauthorized patient identity is never sent to the browser.
