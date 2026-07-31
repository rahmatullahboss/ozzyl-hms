# HMS Starter UI/UX Launch Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current broad HMS UI into a focused production/demo surface for Accounting-first HIS + billing-time reagent stock control, while keeping advanced LIS/result automation secondary.

**Architecture:** Reuse the existing React + route-permission structure. Do not create duplicate pages when current pages already exist; add owner-friendly command centers, quick actions, labels, and guardrail states on top of existing Admin/MD, billing, inventory, and Lab Monitoring pages. Keep backend contracts stable and prefer small UI helpers with unit tests.

**Tech Stack:** React, TypeScript, Vite, React Router, TanStack Query wrapper `useApiQuery`, Tailwind/design-token classes, Vitest.

## Global Constraints

- Current commercial scope is **Accounting-first HIS + Reagent Stock Management**.
- Core launch modules: patient management, billing/payment, cash control, inventory/reagent stock, owner dashboard.
- Manual LIS/result entry, report approval, analyzer integration, HL7/ASTM parser are **not** primary launch features.
- Default reagent deduction story is **billing-time semi-auto**; strict mode only after test-to-reagent mapping coverage is complete.
- Use existing pages/routes before creating new ones.
- Work should be test-driven; add helper/unit tests before UI behavior changes when possible.
- Do not change unrelated dirty files.

---

## Existing Page / Branch Audit

### Pages already present in current branch and main

- `web/src/pages/inventory/InventoryDashboard.tsx`
  - Existing since inventory module history; latest inventory intelligence hardening commit is contained by both `feature/lab-reagent-mis-ready-inventory` and `main`.
- `web/src/pages/LabMonitoringDashboard.tsx`
  - Existing page with stock locations, reagent mapping, readiness, exceptions, and billing-time reagent reconciliation.
  - History shows many reagent commits including `add lab reagent readiness dashboard`, `default-reagent-catalog`, `reagent-setup-checklist`, and later dashboard fixes.
- `web/src/pages/AdminTransactionControlCenter.tsx`
  - Existing cash/drawer control page.
- `web/src/pages/admin/widgets/KPISummaryCards.tsx`
  - Existing admin dashboard KPI + cash reconciliation snapshot.
- `web/src/pages/MDDashboard.tsx`
  - Existing owner/MD dashboard with cash-control and operational KPI history.

### Branch result

- `git branch --all --contains HEAD` returned current branch and `main`.
- `git branch --all --contains 0cac0e6fd` also returned current branch and `main`.
- Conclusion: the relevant reagent/inventory work is **not stuck only in a separate branch**. The pages exist in the current branch and are also contained in `main`.

---

## UI/UX Design Direction

### Product posture

Use a **mission-control dashboard** pattern for hospital owners and operators:

- One page should answer: “আজ টাকা কত উঠলো, stock কত কমলো, কোনো গ্যাপ আছে কি?”
- Avoid LIS terminology unless the hospital explicitly enables machine integration.
- Put billing-first reagent flow above manual/result workflows.
- Each card must include a clear next action.

### Visual/interaction rules from UI/UX skill

- Minimum touch targets: 44px+.
- No icon-only critical actions without labels/aria labels.
- Use text + color together for status; never color-only.
- Use predictable navigation: quick action buttons open existing tabs/pages.
- Use progressive disclosure: show daily command center first, detailed tables below.
- Use responsive card grids for 360px Android screens.
- Use visible focus states and loading/empty states.

---

## File Structure

### Modify

- `web/src/pages/LabMonitoringDashboard.tsx`
  - Add starter command center above the lab/reagent tabs.
  - Reuse existing `reagentStarterCommandState` helper to summarize mapping/reconciliation/exception status.
  - Quick actions jump to existing tabs: mappings, readiness, exceptions, stock.

- `web/src/pages/LabMonitoringDashboard.test.ts`
  - Add helper test for billing-first command state and quick actions.

### Future planned modifications

- `web/src/pages/admin/widgets/KPISummaryCards.tsx`
  - Add owner-facing Cash + Reagent control strip if reagent summary endpoint is available at dashboard level.

- `web/src/components/dashboard/adminSidebarConfig.tsx`
  - Create a Starter HIS navigation bundle that puts Billing, Cash, Reagent Control, Inventory, Reports first and hides manual LIS/result-heavy pages unless enabled.

- `src/routes/tenant/dashboard.ts` or a new dashboard summary route
  - Optional: expose a compact reagent summary for owner dashboard without loading the full lab monitoring page.

---

## Task 1: Lab Reagent Starter Command Center

**Files:**
- Modify: `web/src/pages/LabMonitoringDashboard.tsx`
- Test: `web/src/pages/LabMonitoringDashboard.test.ts`

**Interfaces:**
- Consumes: `mappingCoverageSummary`, `reagentReconciliationSummary`, `inventoryPolicy`, `openInventoryExceptions`.
- Produces: top-page command center with headline, setup status, and quick action buttons.

- [x] **Step 1: Add failing helper test**

Add test to verify `reagentStarterCommandState()` returns:

```ts
headline: 'Billing-first reagent control is active'
tone: 'warning'
actions: ['mappings', 'readiness', 'exceptions']
```

- [x] **Step 2: Implement minimal UI/helper wiring**

Use existing `reagentStarterCommandState()` and compute:

```ts
const reagentStarterState = reagentStarterCommandState({
  policyTiming: inventoryPolicy.reagent_consumption_timing,
  inventoryMode: inventoryPolicy.lab_inventory_mode,
  mappedTests: mappingCoverageSummary?.mapped_tests,
  missingTests: mappingCoverageSummary?.missing_tests,
  openExceptions: openInventoryExceptions.length,
  reconciliationMissing: reagentReconciliationSummary?.missing,
  reconciliationExceptions: reagentReconciliationSummary?.exception,
});
```

- [x] **Step 3: Add command center section**

Add a section above alert banners with:

- Starter HIS reagent control label
- Billing-first headline
- Explanation that manual LIS/result automation is secondary
- Status badge: setup attention needed vs ready
- Quick actions opening mapping/readiness/exceptions/stock tabs

- [x] **Step 4: Verify targeted tests**

Run:

```bash
cd web
pnpm exec vitest run src/pages/LabMonitoringDashboard.test.ts
```

Expected: pass.

- [x] **Step 5: Verify web build**

Run:

```bash
pnpm --filter web build
```

Expected: TypeScript + Vite build pass.

---

## Task 2: Starter HIS Navigation Bundle

**Files:**
- Modify: `web/src/components/dashboard/adminSidebarConfig.tsx`
- Test: `web/src/components/dashboard/adminSidebarConfig.test.ts`

**Goal:** Make the sales/demo menu focused and less confusing.

- [ ] Put these pages first for hospital admin/owner demo:
  1. Dashboard
  2. Reception / Billing Counter
  3. Cash Operations / Handover
  4. Lab Reagent Control
  5. Inventory Stock
  6. Reports
  7. Settings

- [ ] Move manual LIS/result/machine-heavy routes lower or behind advanced/lab settings grouping.

- [ ] Add tests that assert Starter menu includes Billing, Cash, Reagent Control, Inventory, Reports in top grouping.

---

## Task 3: Owner Dashboard Cash + Reagent Control Strip

**Files:**
- Modify: `web/src/pages/admin/widgets/KPISummaryCards.tsx`
- Test: `web/src/pages/admin/widgets/KPISummaryCards.test.tsx`

**Goal:** Owner dashboard should immediately explain business control value.

- [ ] Add compact strip under KPI cards:
  - Cash received
  - Cash out/expense
  - Pending handover
  - Discount/reference risk
  - Reagent exceptions/missing mapping if available

- [ ] If reagent data is not available on dashboard route, show deep link: “Open Reagent Control”.

---

## Task 4: Reagent Setup Wizard Polish

**Files:**
- Modify: `web/src/pages/LabMonitoringDashboard.tsx`
- Test: `web/src/pages/LabMonitoringDashboard.test.ts`

**Goal:** Make test-to-reagent mapping easier for non-technical staff.

- [ ] Split mapping area into 3 visible steps:
  1. Select test
  2. Select reagent/tube/kit
  3. Set quantity per billed test

- [ ] Add helper text:
  - “Use 1 test-equivalent unit for simple rollout.”
  - “Edit later when exact reagent consumption is known.”

- [ ] Keep advanced notes optional.

---

## Task 5: Production Smoke Checklist UI/Docs

**Files:**
- Create: `docs/operations/starter-his-production-smoke-checklist.md`

**Goal:** Before aggressive marketing, every pilot hospital gets the same smoke checklist.

- [ ] Add checklist for login, patient create, billing, payment, reagent deduction, stock ledger, reconciliation, handover, expense, print, backup.

---

## Current Implementation Status

Implemented in this pass:

- `LabMonitoringDashboard.test.ts` helper test for billing-first command state.
- `LabMonitoringDashboard.tsx` command center section on the existing lab monitoring page.
- No new duplicate page was created.

Pending verification:

- Targeted web test.
- Web production build.

